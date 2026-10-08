import { z } from 'zod'
import { requireScope, scopeAllows, scopeFilter, type Actor } from '../../domain/authorization/actor.js'
import type { Scope } from '../../domain/authorization/scope.js'
import {
  assertCanArchive,
  assertCanRestore,
  assertDeletable,
  assertSelectable,
} from '../../domain/shared/archivable.js'
import { DomainError, type FieldError } from '../../domain/shared/errors.js'
import {
  effectiveDeadline,
  nextAssignmentStatus,
  validateActivation,
  validateExtension,
  validateLimits,
  type AssignmentStatus,
} from '../../domain/education/assignment.js'
import { validateTopicParent } from '../../domain/education/topics.js'
import { diff } from '../shared/audit.js'
import type { Clock } from '../shared/context.js'
import type { ListQuery } from '../shared/query.js'
import type { UnitOfWork } from '../shared/uow.js'
import { useCase } from '../shared/use-case.js'
import type { AssignmentRecord, EducationTx, Entity } from './ports.js'

export interface EducationDeps {
  uow: UnitOfWork<EducationTx>
  clock: Clock
}

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const r = schema.safeParse(input)
  if (!r.success) {
    throw DomainError.validation(r.error.issues.map((i) => ({ field: i.path.join('.') || 'form', message: i.message })))
  }
  return r.data
}

const req = (max: number) => z.string().trim().min(1, 'Обязательное поле').max(max, `Не более ${max} символов`)
const opt = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Не более ${max} символов`)
    .nullish()
    .transform((v) => (v ? v : null))
const ids = z.array(z.string()).default([])
const intField = (def: number) => z.coerce.number().int('Целое число').default(def)
const dateField = z
  .union([z.string(), z.date()])
  .nullish()
  .transform((v, c) => {
    if (v === null || v === undefined || v === '') return null
    const d = v instanceof Date ? v : new Date(v)
    if (Number.isNaN(d.getTime())) {
      c.addIssue({ code: 'custom', message: 'Некорректная дата' })
      return z.NEVER
    }
    return d
  })

const ENTITY_LABEL: Record<Entity, { type: string; title: string }> = {
  subjects: { type: 'subject', title: 'Предмет' },
  courses: { type: 'course', title: 'Курс' },
  topics: { type: 'topic', title: 'Тема' },
  learning_objectives: { type: 'objective', title: 'Учебная цель' },
  student_groups: { type: 'group', title: 'Группа' },
}

export function createEducationUseCases(deps: EducationDeps) {
  const { uow, clock } = deps
  const repo = () => uow.read.education

  /** Отношение актора к курсу для scope COURSE. */
  async function courseScopes(actor: Actor, courseId: string, mode: 'read' | 'manage'): Promise<Set<Scope>> {
    const rel = await repo().courseRelation(actor.userId, courseId)
    const s = new Set<Scope>()
    if (rel.teaches || (mode === 'read' && rel.studies)) s.add('COURSE')
    return s
  }

  /** Предметы и курсы ведет только Admin (taxonomy.manage ANY), темы и цели — преподаватель курса (COURSE). */
  function requireGlobalTaxonomy(actor: Actor) {
    if (!actor.has('taxonomy.manage', 'ANY')) throw DomainError.forbidden('Предметы и курсы ведет администратор')
  }

  async function requireCourseManage(actor: Actor, courseId: string, key = 'taxonomy.manage') {
    requireScope(actor, key, await courseScopes(actor, courseId, 'manage'))
  }

  async function archiveGeneric(
    actor: Actor,
    entity: Entity,
    id: string,
    status: 'ACTIVE' | 'ARCHIVED',
    reason: string | undefined,
    ctx: Parameters<typeof uow.read.audit.record>[2],
  ) {
    const r = assertCanArchive(status, reason)
    await uow.transaction(async (tx) => {
      await tx.education.setArchived(entity, id, true, actor.userId, r)
      await tx.audit.record(
        actor,
        {
          action: `${ENTITY_LABEL[entity].type}.archived`,
          resourceType: ENTITY_LABEL[entity].type,
          resourceId: id,
          reason: r,
        },
        ctx,
      )
    })
  }

  async function restoreGeneric(
    actor: Actor,
    entity: Entity,
    id: string,
    status: 'ACTIVE' | 'ARCHIVED',
    parentArchived: boolean,
    ctx: Parameters<typeof uow.read.audit.record>[2],
  ) {
    assertCanRestore(status, parentArchived)
    await uow.transaction(async (tx) => {
      await tx.education.setArchived(entity, id, false, actor.userId, null)
      await tx.audit.record(
        actor,
        { action: `${ENTITY_LABEL[entity].type}.restored`, resourceType: ENTITY_LABEL[entity].type, resourceId: id },
        ctx,
      )
    })
  }

  async function deleteGeneric(
    actor: Actor,
    entity: Entity,
    id: string,
    ctx: Parameters<typeof uow.read.audit.record>[2],
  ) {
    await uow.transaction(async (tx) => {
      assertDeletable(await tx.education.usageCount(entity, id), ENTITY_LABEL[entity].title)
      await tx.education.deleteRow(entity, id)
      await tx.audit.record(
        actor,
        { action: `${ENTITY_LABEL[entity].type}.deleted`, resourceType: ENTITY_LABEL[entity].type, resourceId: id },
        ctx,
      )
    })
  }

  // ---------------- Assignments: доступ ----------------

  async function assignmentScopes(actor: Actor, a: AssignmentRecord): Promise<Set<Scope>> {
    const s = new Set<Scope>()
    if (a.ownerId === actor.userId) s.add('OWN')
    const rel = await repo().courseRelation(actor.userId, a.courseId)
    if (rel.teaches) s.add('COURSE')
    if (a.status !== 'DRAFT' && (await repo().isTargeted(a.id, actor.userId))) s.add('ASSIGNED')
    return s
  }

  async function loadAssignment(id: string) {
    const a = await repo().findAssignment(id)
    if (!a) throw DomainError.notFound()
    return a
  }

  async function validateLinks(
    a: AssignmentRecord,
    input: {
      topicIds: string[]
      objectiveIds: string[]
      questionTypeIds: string[]
      targetUserIds: string[]
      targetGroupIds: string[]
    },
  ) {
    const e: FieldError[] = []
    const topics = await Promise.all(input.topicIds.map((id) => repo().findTopic(id)))
    const topicAncestry = new Map<string, string[]>()
    topics.forEach((t, i) => {
      if (!t || t.courseId !== a.courseId)
        e.push({ field: 'topics', message: `Тема ${input.topicIds[i]} не принадлежит курсу` })
      else if (t.status === 'ARCHIVED') e.push({ field: 'topics', message: `Тема «${t.name}» в архиве (BR-039)` })
    })
    for (const id of input.topicIds) topicAncestry.set(id, await repo().topicSubtreeIds(id))
    const allowedTopics = new Set([...topicAncestry.values()].flat())
    for (const oid of input.objectiveIds) {
      const o = await repo().findObjective(oid)
      if (!o || o.courseId !== a.courseId) e.push({ field: 'objectives', message: `Цель ${oid} не принадлежит курсу` })
      else if (o.status === 'ARCHIVED') e.push({ field: 'objectives', message: `Цель ${o.code} в архиве (BR-039)` })
      else if (!allowedTopics.has(o.topicId))
        e.push({ field: 'objectives', message: `Цель ${o.code} не относится к выбранным темам` })
    }
    const types = await repo().findQuestionTypes(input.questionTypeIds)
    for (const id of input.questionTypeIds) {
      const t = types.find((x) => x.id === id)
      if (!t) e.push({ field: 'questionTypes', message: `Неизвестный тип вопроса ${id}` })
      else if (t.status !== 'ACTIVE') e.push({ field: 'questionTypes', message: `Тип «${t.name}» неактивен (BR-021)` })
    }
    for (const gid of input.targetGroupIds) {
      const g = await repo().findGroup(gid)
      if (!g || g.courseId !== a.courseId) e.push({ field: 'targets', message: `Группа ${gid} не относится к курсу` })
      else if (g.status === 'ARCHIVED') e.push({ field: 'targets', message: `Группа «${g.name}» в архиве` })
    }
    const students = await repo().usersWithRole(input.targetUserIds, 'STUDENT')
    for (const uid of input.targetUserIds)
      if (!students.includes(uid)) e.push({ field: 'targets', message: `Пользователь ${uid} не студент` })
    if (e.length) throw DomainError.validation(e)
  }

  return {
    // ================= Subjects =================
    listSubjects: useCase<
      ListQuery,
      { records: Awaited<ReturnType<ReturnType<typeof repo>['listSubjects']>>['records']; total: number }
    >({
      name: 'education.listSubjects',
      permission: 'taxonomy.read',
      run: async (actor, q) => repo().listSubjects(scopeFilter(actor, 'taxonomy.read'), q),
    }),
    getSubject: useCase<{ id: string }, NonNullable<Awaited<ReturnType<ReturnType<typeof repo>['findSubject']>>>>({
      name: 'education.getSubject',
      permission: 'taxonomy.read',
      async run(actor, { id }) {
        const s = await repo().findSubject(id)
        if (!s) throw DomainError.notFound()
        if (!actor.has('taxonomy.read', 'ANY')) {
          const r = await repo().listSubjects(scopeFilter(actor, 'taxonomy.read'), {
            filters: { id },
            limit: 1,
            offset: 0,
          })
          if (!r.total) throw DomainError.notFound()
        }
        return s
      },
    }),
    createSubject: useCase<{ code: string; name: string }, { id: string }>({
      name: 'education.createSubject',
      permission: 'taxonomy.manage',
      async run(actor, raw, ctx) {
        requireGlobalTaxonomy(actor)
        const d = parse(z.object({ code: req(40), name: req(200) }), raw)
        return uow.transaction(async (tx) => {
          const id = await tx.education.insertSubject(d)
          await tx.audit.record(
            actor,
            { action: 'subject.created', resourceType: 'subject', resourceId: id, changes: d },
            ctx,
          )
          return { id }
        })
      },
    }),
    updateSubject: useCase<{ id: string; code: string; name: string; revision: number }, void>({
      name: 'education.updateSubject',
      permission: 'taxonomy.manage',
      async run(actor, raw, ctx) {
        requireGlobalTaxonomy(actor)
        const d = parse(z.object({ id: z.string(), code: req(40), name: req(200), revision: z.coerce.number() }), raw)
        await uow.transaction(async (tx) => {
          const before = await tx.education.findSubject(d.id)
          if (!before) throw DomainError.notFound()
          await tx.education.updateSubject(d.id, { code: d.code, name: d.name }, d.revision)
          await tx.audit.record(
            actor,
            {
              action: 'subject.updated',
              resourceType: 'subject',
              resourceId: d.id,
              changes: diff({ code: before.code, name: before.name }, { code: d.code, name: d.name }),
            },
            ctx,
          )
        })
      },
    }),
    archiveSubject: useCase<{ id: string; reason?: string }, void>({
      name: 'education.archiveSubject',
      permission: 'taxonomy.manage',
      async run(actor, { id, reason }, ctx) {
        requireGlobalTaxonomy(actor)
        const s = await repo().findSubject(id)
        if (!s) throw DomainError.notFound()
        await archiveGeneric(actor, 'subjects', id, s.status, reason, ctx)
      },
    }),
    restoreSubject: useCase<{ id: string }, void>({
      name: 'education.restoreSubject',
      permission: 'taxonomy.manage',
      async run(actor, { id }, ctx) {
        requireGlobalTaxonomy(actor)
        const s = await repo().findSubject(id)
        if (!s) throw DomainError.notFound()
        await restoreGeneric(actor, 'subjects', id, s.status, false, ctx)
      },
    }),
    deleteSubject: useCase<{ id: string }, void>({
      name: 'education.deleteSubject',
      permission: 'taxonomy.manage',
      async run(actor, { id }, ctx) {
        requireGlobalTaxonomy(actor)
        if (!(await repo().findSubject(id))) throw DomainError.notFound()
        await deleteGeneric(actor, 'subjects', id, ctx)
      },
    }),

    // ================= Courses =================
    listCourses: useCase<ListQuery, Awaited<ReturnType<ReturnType<typeof repo>['listCourses']>>>({
      name: 'education.listCourses',
      permission: 'taxonomy.read',
      run: async (actor, q) => repo().listCourses(scopeFilter(actor, 'taxonomy.read'), q),
    }),
    getCourse: useCase<{ id: string }, NonNullable<Awaited<ReturnType<ReturnType<typeof repo>['findCourse']>>>>({
      name: 'education.getCourse',
      permission: 'taxonomy.read',
      async run(actor, { id }) {
        const c = await repo().findCourse(id)
        if (!c) throw DomainError.notFound()
        requireScope(actor, 'taxonomy.read', await courseScopes(actor, id, 'read'), 'read')
        return c
      },
    }),
    createCourse: useCase<
      { subjectId: string; code: string; name: string; academicPeriod?: string | null; teacherIds?: string[] },
      { id: string }
    >({
      name: 'education.createCourse',
      permission: 'taxonomy.manage',
      async run(actor, raw, ctx) {
        requireGlobalTaxonomy(actor)
        const d = parse(
          z.object({ subjectId: z.string(), code: req(40), name: req(200), academicPeriod: opt(100), teacherIds: ids }),
          raw,
        )
        const subject = await repo().findSubject(d.subjectId)
        if (!subject) throw DomainError.validation([{ field: 'subjectId', message: 'Предмет не найден' }])
        assertSelectable(subject.status, 'Предмет', 'subjectId')
        const teachers = await repo().usersWithRole(d.teacherIds, 'TEACHER')
        const bad = d.teacherIds.filter((t) => !teachers.includes(t))
        if (bad.length)
          throw DomainError.validation([
            { field: 'teacherIds', message: 'Преподавателями курса могут быть только пользователи с ролью TEACHER' },
          ])
        return uow.transaction(async (tx) => {
          const id = await tx.education.insertCourse({
            subjectId: d.subjectId,
            code: d.code,
            name: d.name,
            academicPeriod: d.academicPeriod,
          })
          await tx.education.setCourseTeachers(id, d.teacherIds)
          await tx.audit.record(
            actor,
            { action: 'course.created', resourceType: 'course', resourceId: id, changes: d },
            ctx,
          )
          return { id }
        })
      },
    }),
    updateCourse: useCase<
      {
        id: string
        subjectId: string
        code: string
        name: string
        academicPeriod?: string | null
        teacherIds?: string[]
        revision: number
      },
      void
    >({
      name: 'education.updateCourse',
      permission: 'taxonomy.manage',
      async run(actor, raw, ctx) {
        requireGlobalTaxonomy(actor)
        const d = parse(
          z.object({
            id: z.string(),
            subjectId: z.string(),
            code: req(40),
            name: req(200),
            academicPeriod: opt(100),
            teacherIds: z.array(z.string()).optional(),
            revision: z.coerce.number(),
          }),
          raw,
        )
        const before = await repo().findCourse(d.id)
        if (!before) throw DomainError.notFound()
        if (d.subjectId !== before.subjectId) {
          const s = await repo().findSubject(d.subjectId)
          if (!s) throw DomainError.validation([{ field: 'subjectId', message: 'Предмет не найден' }])
          assertSelectable(s.status, 'Предмет', 'subjectId')
        }
        if (d.teacherIds) {
          const teachers = await repo().usersWithRole(d.teacherIds, 'TEACHER')
          if (d.teacherIds.some((t) => !teachers.includes(t))) {
            throw DomainError.validation([
              { field: 'teacherIds', message: 'Преподавателями курса могут быть только пользователи с ролью TEACHER' },
            ])
          }
        }
        await uow.transaction(async (tx) => {
          await tx.education.updateCourse(
            d.id,
            { subjectId: d.subjectId, code: d.code, name: d.name, academicPeriod: d.academicPeriod },
            d.revision,
          )
          if (d.teacherIds) await tx.education.setCourseTeachers(d.id, d.teacherIds)
          await tx.audit.record(
            actor,
            {
              action: 'course.updated',
              resourceType: 'course',
              resourceId: d.id,
              changes: diff(
                {
                  subjectId: before.subjectId,
                  code: before.code,
                  name: before.name,
                  academicPeriod: before.academicPeriod,
                  teacherIds: [...before.teacherIds].sort(),
                },
                {
                  subjectId: d.subjectId,
                  code: d.code,
                  name: d.name,
                  academicPeriod: d.academicPeriod,
                  teacherIds: [...(d.teacherIds ?? before.teacherIds)].sort(),
                },
              ),
            },
            ctx,
          )
        })
      },
    }),
    archiveCourse: useCase<{ id: string; reason?: string }, void>({
      name: 'education.archiveCourse',
      permission: 'taxonomy.manage',
      async run(actor, { id, reason }, ctx) {
        requireGlobalTaxonomy(actor)
        const c = await repo().findCourse(id)
        if (!c) throw DomainError.notFound()
        await archiveGeneric(actor, 'courses', id, c.status, reason, ctx)
      },
    }),
    restoreCourse: useCase<{ id: string }, void>({
      name: 'education.restoreCourse',
      permission: 'taxonomy.manage',
      async run(actor, { id }, ctx) {
        requireGlobalTaxonomy(actor)
        const c = await repo().findCourse(id)
        if (!c) throw DomainError.notFound()
        await restoreGeneric(actor, 'courses', id, c.status, c.subjectStatus === 'ARCHIVED', ctx)
      },
    }),
    deleteCourse: useCase<{ id: string }, void>({
      name: 'education.deleteCourse',
      permission: 'taxonomy.manage',
      async run(actor, { id }, ctx) {
        requireGlobalTaxonomy(actor)
        if (!(await repo().findCourse(id))) throw DomainError.notFound()
        await deleteGeneric(actor, 'courses', id, ctx)
      },
    }),

    // ================= Topics =================
    listTopics: useCase<ListQuery, Awaited<ReturnType<ReturnType<typeof repo>['listTopics']>>>({
      name: 'education.listTopics',
      permission: 'taxonomy.read',
      run: async (actor, q) => repo().listTopics(scopeFilter(actor, 'taxonomy.read'), q),
    }),
    getTopic: useCase<{ id: string }, NonNullable<Awaited<ReturnType<ReturnType<typeof repo>['findTopic']>>>>({
      name: 'education.getTopic',
      permission: 'taxonomy.read',
      async run(actor, { id }) {
        const t = await repo().findTopic(id)
        if (!t) throw DomainError.notFound()
        requireScope(actor, 'taxonomy.read', await courseScopes(actor, t.courseId, 'read'), 'read')
        return t
      },
    }),
    createTopic: useCase<
      { courseId: string; parentId?: string | null; name: string; ordinal?: number },
      { id: string }
    >({
      name: 'education.createTopic',
      permission: 'taxonomy.manage',
      async run(actor, raw, ctx) {
        const d = parse(
          z.object({
            courseId: z.string(),
            parentId: z
              .string()
              .nullish()
              .transform((v) => v || null),
            name: req(200),
            ordinal: intField(0),
          }),
          raw,
        )
        const course = await repo().findCourse(d.courseId)
        if (!course) throw DomainError.validation([{ field: 'courseId', message: 'Курс не найден' }])
        await requireCourseManage(actor, d.courseId)
        assertSelectable(course.status, 'Курс', 'courseId')
        const parent = d.parentId ? await repo().findTopic(d.parentId) : null
        if (d.parentId && !parent)
          throw DomainError.validation([{ field: 'parentId', message: 'Родительская тема не найдена' }])
        if (parent) assertSelectable(parent.status, 'Родительская тема', 'parentId')
        validateTopicParent({
          topicId: null,
          courseId: d.courseId,
          parent: parent ? { id: parent.id, courseId: parent.courseId } : null,
          ancestorIds: parent ? [parent.id, ...(await repo().topicAncestorIds(parent.id))] : [],
          subtreeDepth: 1,
        })
        return uow.transaction(async (tx) => {
          const id = await tx.education.insertTopic({
            courseId: d.courseId,
            parentId: d.parentId,
            name: d.name,
            ordinal: d.ordinal,
          })
          await tx.audit.record(
            actor,
            { action: 'topic.created', resourceType: 'topic', resourceId: id, changes: d },
            ctx,
          )
          return { id }
        })
      },
    }),
    updateTopic: useCase<
      { id: string; parentId?: string | null; name: string; ordinal?: number; revision: number },
      void
    >({
      name: 'education.updateTopic',
      permission: 'taxonomy.manage',
      async run(actor, raw, ctx) {
        const d = parse(
          z.object({
            id: z.string(),
            parentId: z
              .string()
              .nullish()
              .transform((v) => v || null),
            name: req(200),
            ordinal: intField(0),
            revision: z.coerce.number(),
          }),
          raw,
        )
        const t = await repo().findTopic(d.id)
        if (!t) throw DomainError.notFound()
        await requireCourseManage(actor, t.courseId)
        const parent = d.parentId ? await repo().findTopic(d.parentId) : null
        if (d.parentId && !parent)
          throw DomainError.validation([{ field: 'parentId', message: 'Родительская тема не найдена' }])
        if (parent && parent.id !== t.parentId) assertSelectable(parent.status, 'Родительская тема', 'parentId')
        validateTopicParent({
          topicId: t.id,
          courseId: t.courseId,
          parent: parent ? { id: parent.id, courseId: parent.courseId } : null,
          ancestorIds: parent ? [parent.id, ...(await repo().topicAncestorIds(parent.id))] : [],
          subtreeDepth: await repo().topicSubtreeDepth(t.id),
        })
        await uow.transaction(async (tx) => {
          await tx.education.updateTopic(d.id, { parentId: d.parentId, name: d.name, ordinal: d.ordinal }, d.revision)
          await tx.audit.record(
            actor,
            {
              action: 'topic.updated',
              resourceType: 'topic',
              resourceId: d.id,
              changes: diff(
                { parentId: t.parentId, name: t.name, ordinal: t.ordinal },
                { parentId: d.parentId, name: d.name, ordinal: d.ordinal },
              ),
            },
            ctx,
          )
        })
      },
    }),
    /** SPEC-EDU-001 A2: при активных подтемах — отказ, либо cascade=true архивирует поддерево. */
    archiveTopic: useCase<{ id: string; reason?: string; cascade?: boolean }, { archived: number }>({
      name: 'education.archiveTopic',
      permission: 'taxonomy.manage',
      async run(actor, { id, reason, cascade }, ctx) {
        const t = await repo().findTopic(id)
        if (!t) throw DomainError.notFound()
        await requireCourseManage(actor, t.courseId)
        const r = assertCanArchive(t.status, reason)
        const subtree = (await repo().topicSubtreeIds(id)).filter((x) => x !== id)
        const activeChildren: { id: string }[] = []
        for (const cid of subtree) {
          const c = await repo().findTopic(cid)
          if (c?.status === 'ACTIVE') activeChildren.push(c)
        }
        if (activeChildren.length && !cascade) {
          throw new DomainError(
            'INVALID_STATE',
            `У темы есть активные подтемы (${activeChildren.length}). Архивируйте поддерево целиком.`,
          )
        }
        return uow.transaction(async (tx) => {
          for (const x of [id, ...activeChildren.map((c) => c.id)]) {
            await tx.education.setArchived('topics', x, true, actor.userId, r)
            await tx.audit.record(
              actor,
              { action: 'topic.archived', resourceType: 'topic', resourceId: x, reason: r },
              ctx,
            )
          }
          return { archived: 1 + activeChildren.length }
        })
      },
    }),
    restoreTopic: useCase<{ id: string }, void>({
      name: 'education.restoreTopic',
      permission: 'taxonomy.manage',
      async run(actor, { id }, ctx) {
        const t = await repo().findTopic(id)
        if (!t) throw DomainError.notFound()
        await requireCourseManage(actor, t.courseId)
        await restoreGeneric(
          actor,
          'topics',
          id,
          t.status,
          t.parentStatus === 'ARCHIVED' || t.courseStatus === 'ARCHIVED',
          ctx,
        )
      },
    }),
    deleteTopic: useCase<{ id: string }, void>({
      name: 'education.deleteTopic',
      permission: 'taxonomy.manage',
      async run(actor, { id }, ctx) {
        const t = await repo().findTopic(id)
        if (!t) throw DomainError.notFound()
        await requireCourseManage(actor, t.courseId)
        await deleteGeneric(actor, 'topics', id, ctx)
      },
    }),

    // ================= Learning objectives =================
    listObjectives: useCase<ListQuery, Awaited<ReturnType<ReturnType<typeof repo>['listObjectives']>>>({
      name: 'education.listObjectives',
      permission: 'taxonomy.read',
      run: async (actor, q) => repo().listObjectives(scopeFilter(actor, 'taxonomy.read'), q),
    }),
    getObjective: useCase<{ id: string }, NonNullable<Awaited<ReturnType<ReturnType<typeof repo>['findObjective']>>>>({
      name: 'education.getObjective',
      permission: 'taxonomy.read',
      async run(actor, { id }) {
        const o = await repo().findObjective(id)
        if (!o) throw DomainError.notFound()
        requireScope(actor, 'taxonomy.read', await courseScopes(actor, o.courseId, 'read'), 'read')
        return o
      },
    }),
    createObjective: useCase<
      { topicId: string; code: string; text: string; bloomLevel?: string | null },
      { id: string }
    >({
      name: 'education.createObjective',
      permission: 'taxonomy.manage',
      async run(actor, raw, ctx) {
        const d = parse(z.object({ topicId: z.string(), code: req(40), text: req(1000), bloomLevel: opt(20) }), raw)
        const topic = await repo().findTopic(d.topicId)
        if (!topic) throw DomainError.validation([{ field: 'topicId', message: 'Тема не найдена' }])
        await requireCourseManage(actor, topic.courseId)
        assertSelectable(topic.status, 'Тема', 'topicId')
        return uow.transaction(async (tx) => {
          const id = await tx.education.insertObjective({
            courseId: topic.courseId,
            topicId: d.topicId,
            code: d.code,
            text: d.text,
            bloomLevel: d.bloomLevel,
          })
          await tx.audit.record(
            actor,
            { action: 'objective.created', resourceType: 'objective', resourceId: id, changes: d },
            ctx,
          )
          return { id }
        })
      },
    }),
    updateObjective: useCase<
      { id: string; topicId: string; code: string; text: string; bloomLevel?: string | null; revision: number },
      void
    >({
      name: 'education.updateObjective',
      permission: 'taxonomy.manage',
      async run(actor, raw, ctx) {
        const d = parse(
          z.object({
            id: z.string(),
            topicId: z.string(),
            code: req(40),
            text: req(1000),
            bloomLevel: opt(20),
            revision: z.coerce.number(),
          }),
          raw,
        )
        const o = await repo().findObjective(d.id)
        if (!o) throw DomainError.notFound()
        await requireCourseManage(actor, o.courseId)
        if (d.topicId !== o.topicId) {
          const topic = await repo().findTopic(d.topicId)
          if (!topic || topic.courseId !== o.courseId)
            throw DomainError.validation([{ field: 'topicId', message: 'Тема должна быть в том же курсе' }])
          assertSelectable(topic.status, 'Тема', 'topicId')
        }
        await uow.transaction(async (tx) => {
          await tx.education.updateObjective(
            d.id,
            { topicId: d.topicId, code: d.code, text: d.text, bloomLevel: d.bloomLevel },
            d.revision,
          )
          await tx.audit.record(
            actor,
            {
              action: 'objective.updated',
              resourceType: 'objective',
              resourceId: d.id,
              changes: diff(
                { topicId: o.topicId, code: o.code, text: o.text, bloomLevel: o.bloomLevel },
                { topicId: d.topicId, code: d.code, text: d.text, bloomLevel: d.bloomLevel },
              ),
            },
            ctx,
          )
        })
      },
    }),
    archiveObjective: useCase<{ id: string; reason?: string }, void>({
      name: 'education.archiveObjective',
      permission: 'taxonomy.manage',
      async run(actor, { id, reason }, ctx) {
        const o = await repo().findObjective(id)
        if (!o) throw DomainError.notFound()
        await requireCourseManage(actor, o.courseId)
        await archiveGeneric(actor, 'learning_objectives', id, o.status, reason, ctx)
      },
    }),
    restoreObjective: useCase<{ id: string }, void>({
      name: 'education.restoreObjective',
      permission: 'taxonomy.manage',
      async run(actor, { id }, ctx) {
        const o = await repo().findObjective(id)
        if (!o) throw DomainError.notFound()
        await requireCourseManage(actor, o.courseId)
        await restoreGeneric(actor, 'learning_objectives', id, o.status, o.topicStatus === 'ARCHIVED', ctx)
      },
    }),
    deleteObjective: useCase<{ id: string }, void>({
      name: 'education.deleteObjective',
      permission: 'taxonomy.manage',
      async run(actor, { id }, ctx) {
        const o = await repo().findObjective(id)
        if (!o) throw DomainError.notFound()
        await requireCourseManage(actor, o.courseId)
        await deleteGeneric(actor, 'learning_objectives', id, ctx)
      },
    }),

    // ================= Groups =================
    listGroups: useCase<ListQuery, Awaited<ReturnType<ReturnType<typeof repo>['listGroups']>>>({
      name: 'education.listGroups',
      permission: 'group.read',
      run: async (actor, q) => repo().listGroups(scopeFilter(actor, 'group.read'), q),
    }),
    getGroup: useCase<{ id: string }, NonNullable<Awaited<ReturnType<ReturnType<typeof repo>['findGroup']>>>>({
      name: 'education.getGroup',
      permission: 'group.read',
      async run(actor, { id }) {
        const g = await repo().findGroup(id)
        if (!g) throw DomainError.notFound()
        requireScope(actor, 'group.read', await courseScopes(actor, g.courseId, 'manage'), 'read')
        return g
      },
    }),
    createGroup: useCase<{ courseId: string; name: string; memberIds?: string[] }, { id: string }>({
      name: 'education.createGroup',
      permission: 'group.manage',
      async run(actor, raw, ctx) {
        const d = parse(z.object({ courseId: z.string(), name: req(100), memberIds: ids }), raw)
        const course = await repo().findCourse(d.courseId)
        if (!course) throw DomainError.validation([{ field: 'courseId', message: 'Курс не найден' }])
        await requireCourseManage(actor, d.courseId, 'group.manage')
        assertSelectable(course.status, 'Курс', 'courseId')
        const students = await repo().usersWithRole(d.memberIds, 'STUDENT')
        if (d.memberIds.some((m) => !students.includes(m))) {
          throw DomainError.validation([
            { field: 'memberIds', message: 'В группу можно добавить только студентов (AC-EDU-002.2)' },
          ])
        }
        return uow.transaction(async (tx) => {
          const id = await tx.education.insertGroup({ courseId: d.courseId, name: d.name })
          await tx.education.setGroupMembers(id, d.memberIds)
          await tx.audit.record(
            actor,
            { action: 'group.created', resourceType: 'group', resourceId: id, changes: d },
            ctx,
          )
          return { id }
        })
      },
    }),
    updateGroup: useCase<{ id: string; name: string; revision: number }, void>({
      name: 'education.updateGroup',
      permission: 'group.manage',
      async run(actor, raw, ctx) {
        const d = parse(z.object({ id: z.string(), name: req(100), revision: z.coerce.number() }), raw)
        const g = await repo().findGroup(d.id)
        if (!g) throw DomainError.notFound()
        await requireCourseManage(actor, g.courseId, 'group.manage')
        await uow.transaction(async (tx) => {
          await tx.education.updateGroup(d.id, { name: d.name }, d.revision)
          await tx.audit.record(
            actor,
            {
              action: 'group.updated',
              resourceType: 'group',
              resourceId: d.id,
              changes: diff({ name: g.name }, { name: d.name }),
            },
            ctx,
          )
        })
      },
    }),
    setGroupMembers: useCase<{ id: string; memberIds: string[] }, void>({
      name: 'education.setGroupMembers',
      permission: 'group.manage',
      async run(actor, raw, ctx) {
        const d = parse(z.object({ id: z.string(), memberIds: ids }), raw)
        const g = await repo().findGroup(d.id)
        if (!g) throw DomainError.notFound()
        await requireCourseManage(actor, g.courseId, 'group.manage')
        const unique = [...new Set(d.memberIds)]
        const students = await repo().usersWithRole(unique, 'STUDENT')
        if (unique.some((m) => !students.includes(m))) {
          throw DomainError.validation([
            { field: 'memberIds', message: 'В группу можно добавить только студентов (AC-EDU-002.2)' },
          ])
        }
        await uow.transaction(async (tx) => {
          await tx.education.setGroupMembers(d.id, unique)
          await tx.audit.record(
            actor,
            {
              action: 'group.members.changed',
              resourceType: 'group',
              resourceId: d.id,
              changes: diff({ memberIds: [...g.memberIds].sort() }, { memberIds: [...unique].sort() }),
            },
            ctx,
          )
        })
      },
    }),
    archiveGroup: useCase<{ id: string; reason?: string }, void>({
      name: 'education.archiveGroup',
      permission: 'group.manage',
      async run(actor, { id, reason }, ctx) {
        const g = await repo().findGroup(id)
        if (!g) throw DomainError.notFound()
        await requireCourseManage(actor, g.courseId, 'group.manage')
        await archiveGeneric(actor, 'student_groups', id, g.status, reason, ctx)
      },
    }),
    restoreGroup: useCase<{ id: string }, void>({
      name: 'education.restoreGroup',
      permission: 'group.manage',
      async run(actor, { id }, ctx) {
        const g = await repo().findGroup(id)
        if (!g) throw DomainError.notFound()
        await requireCourseManage(actor, g.courseId, 'group.manage')
        await restoreGeneric(actor, 'student_groups', id, g.status, g.courseStatus === 'ARCHIVED', ctx)
      },
    }),

    /** Кандидаты для форм: преподаватели (для курсов, Admin) и студенты (для групп, преподаватель курса). */
    userCandidates: useCase<{ role: 'TEACHER' | 'STUDENT' }, { value: string; label: string }[]>({
      name: 'education.userCandidates',
      permission: 'AUTHENTICATED',
      async run(actor, { role }) {
        if (role === 'TEACHER' ? !actor.has('taxonomy.manage', 'ANY') : !actor.has('group.manage'))
          throw DomainError.forbidden()
        const users = await repo().listUsersByRole(role, 5000)
        return users.map((u) => ({ value: u.id, label: `${u.displayName} <${u.email}>` }))
      },
    }),

    // ================= Question types (чтение; управление — M3) =================
    listQuestionTypes: useCase<ListQuery, Awaited<ReturnType<ReturnType<typeof repo>['listQuestionTypes']>>>({
      name: 'education.listQuestionTypes',
      permission: 'qtype.read',
      run: async (_actor, q) => repo().listQuestionTypes(q),
    }),

    // ================= Assignments =================
    listAssignments: useCase<ListQuery, Awaited<ReturnType<ReturnType<typeof repo>['listAssignments']>>>({
      name: 'education.listAssignments',
      permission: 'assignment.read',
      run: async (actor, q) => repo().listAssignments(scopeFilter(actor, 'assignment.read'), q),
    }),
    getAssignment: useCase<{ id: string }, AssignmentRecord & { myDeadline: Date | null; canManage: boolean }>({
      name: 'education.getAssignment',
      permission: 'assignment.read',
      async run(actor, { id }) {
        const a = await loadAssignment(id)
        const rel = await assignmentScopes(actor, a)
        // владелец задания читает его по OWN-отношению к assignment.update (SPEC-ASSIGN-001)
        if (!(rel.has('OWN') && actor.has('assignment.update', 'OWN')))
          requireScope(actor, 'assignment.read', rel, 'read')
        const ext = rel.has('ASSIGNED') ? await repo().findExtension(id, actor.userId) : null
        return {
          ...a,
          myDeadline: effectiveDeadline(a.deadlineAt, ext),
          canManage: scopeAllows(actor, 'assignment.update', rel),
        }
      },
    }),
    createAssignment: useCase<
      {
        courseId: string
        title: string
        instructions?: string | null
        minItems?: number
        maxItems?: number
        maxTestsPerStudent?: number
        deadlineAt?: string | Date | null
      },
      { id: string }
    >({
      name: 'education.createAssignment',
      permission: 'assignment.create',
      async run(actor, raw, ctx) {
        const d = parse(
          z.object({
            courseId: z.string(),
            title: req(200),
            instructions: opt(10000),
            minItems: intField(1),
            maxItems: intField(10),
            maxTestsPerStudent: intField(1),
            deadlineAt: dateField,
          }),
          raw,
        )
        const course = await repo().findCourse(d.courseId)
        if (!course) throw DomainError.validation([{ field: 'courseId', message: 'Курс не найден' }])
        requireScope(actor, 'assignment.create', await courseScopes(actor, d.courseId, 'manage'))
        assertSelectable(course.status, 'Курс', 'courseId')
        const errs = validateLimits(d.minItems, d.maxItems, d.maxTestsPerStudent)
        if (errs.length) throw DomainError.validation(errs)
        return uow.transaction(async (tx) => {
          const id = await tx.education.insertAssignment({ ...d, ownerId: actor.userId })
          await tx.education.updateAssignment(id, { defaultReviewerId: actor.userId })
          await tx.audit.record(
            actor,
            {
              action: 'assignment.created',
              resourceType: 'assignment',
              resourceId: id,
              changes: { ...d, deadlineAt: d.deadlineAt?.toISOString() ?? null },
            },
            ctx,
          )
          return { id }
        })
      },
    }),
    updateAssignment: useCase<
      {
        id: string
        title: string
        instructions?: string | null
        minItems: number
        maxItems: number
        maxTestsPerStudent: number
        deadlineAt?: string | Date | null
        revision: number
      },
      void
    >({
      name: 'education.updateAssignment',
      permission: 'assignment.update',
      async run(actor, raw, ctx) {
        const d = parse(
          z.object({
            id: z.string(),
            title: req(200),
            instructions: opt(10000),
            minItems: z.coerce.number().int(),
            maxItems: z.coerce.number().int(),
            maxTestsPerStudent: z.coerce.number().int(),
            deadlineAt: dateField,
            revision: z.coerce.number(),
          }),
          raw,
        )
        const a = await loadAssignment(d.id)
        requireScope(actor, 'assignment.update', await assignmentScopes(actor, a))
        if (a.status !== 'DRAFT' && a.status !== 'ACTIVE')
          throw new DomainError('INVALID_STATE', 'Закрытое задание не редактируется')
        const errs = validateLimits(d.minItems, d.maxItems, d.maxTestsPerStudent)
        if (errs.length) throw DomainError.validation(errs)
        if (a.status === 'ACTIVE' && d.deadlineAt && d.deadlineAt <= clock.now()) {
          throw DomainError.validation([
            { field: 'deadlineAt', message: 'Дедлайн активного задания должен быть в будущем' },
          ])
        }
        await uow.transaction(async (tx) => {
          const { id, revision, ...patch } = d
          await tx.education.updateAssignment(id, patch, revision)
          await tx.audit.record(
            actor,
            {
              action: 'assignment.updated',
              resourceType: 'assignment',
              resourceId: id,
              changes: diff(
                {
                  title: a.title,
                  instructions: a.instructions,
                  minItems: a.minItems,
                  maxItems: a.maxItems,
                  maxTestsPerStudent: a.maxTestsPerStudent,
                  deadlineAt: a.deadlineAt?.toISOString() ?? null,
                },
                { ...patch, deadlineAt: patch.deadlineAt?.toISOString() ?? null },
              ),
            },
            ctx,
          )
        })
      },
    }),
    /** Темы, цели, типы, адресаты, эксперт по умолчанию (SPEC-ASSIGN-001). */
    configureAssignment: useCase<
      {
        id: string
        topicIds: string[]
        objectiveIds: string[]
        questionTypeIds: string[]
        targetUserIds: string[]
        targetGroupIds: string[]
        defaultReviewerId?: string | null
      },
      void
    >({
      name: 'education.configureAssignment',
      permission: 'assignment.update',
      async run(actor, raw, ctx) {
        const d = parse(
          z.object({
            id: z.string(),
            topicIds: ids,
            objectiveIds: ids,
            questionTypeIds: ids,
            targetUserIds: ids,
            targetGroupIds: ids,
            defaultReviewerId: z
              .string()
              .nullish()
              .transform((v) => v || null),
          }),
          raw,
        )
        const a = await loadAssignment(d.id)
        requireScope(actor, 'assignment.update', await assignmentScopes(actor, a))
        if (a.status !== 'DRAFT' && a.status !== 'ACTIVE')
          throw new DomainError('INVALID_STATE', 'Закрытое задание не редактируется')
        const links = {
          topicIds: [...new Set(d.topicIds)],
          objectiveIds: [...new Set(d.objectiveIds)],
          questionTypeIds: [...new Set(d.questionTypeIds)],
          targetUserIds: [...new Set(d.targetUserIds)],
          targetGroupIds: [...new Set(d.targetGroupIds)],
        }
        await validateLinks(a, links)
        const reviewer = d.defaultReviewerId ?? a.ownerId
        if (!(await repo().userHasPermission(reviewer, 'review.perform'))) {
          throw DomainError.rule(
            'BR-027',
            'Эксперт по умолчанию должен иметь право проведения экспертизы',
            'defaultReviewerId',
          )
        }
        if (a.status === 'ACTIVE') {
          const probe = { ...a, ...links }
          validateActivation(
            {
              status: 'ACTIVE',
              minItems: a.minItems,
              maxItems: a.maxItems,
              deadlineAt: new Date(8.64e15),
              topicCount: probe.topicIds.length,
              targetCount: probe.targetUserIds.length + probe.targetGroupIds.length,
              questionTypeCount: probe.questionTypeIds.length,
            },
            clock.now(),
          )
        }
        await uow.transaction(async (tx) => {
          await tx.education.setAssignmentLinks(d.id, links)
          await tx.education.updateAssignment(d.id, { defaultReviewerId: reviewer })
          await tx.audit.record(
            actor,
            {
              action: 'assignment.configured',
              resourceType: 'assignment',
              resourceId: d.id,
              changes: diff(
                {
                  topicIds: [...a.topicIds].sort(),
                  objectiveIds: [...a.objectiveIds].sort(),
                  questionTypeIds: [...a.questionTypeIds].sort(),
                  targetUserIds: [...a.targetUserIds].sort(),
                  targetGroupIds: [...a.targetGroupIds].sort(),
                  defaultReviewerId: a.defaultReviewerId,
                },
                {
                  topicIds: [...links.topicIds].sort(),
                  objectiveIds: [...links.objectiveIds].sort(),
                  questionTypeIds: [...links.questionTypeIds].sort(),
                  targetUserIds: [...links.targetUserIds].sort(),
                  targetGroupIds: [...links.targetGroupIds].sort(),
                  defaultReviewerId: reviewer,
                },
              ),
            },
            ctx,
          )
        })
      },
    }),
    changeAssignmentStatus: useCase<
      { id: string; action: 'activate' | 'close' | 'reopen' | 'archive'; reason?: string },
      { status: AssignmentStatus }
    >({
      name: 'education.changeAssignmentStatus',
      permission: 'assignment.update',
      async run(actor, { id, action, reason }, ctx) {
        const a = await loadAssignment(id)
        requireScope(actor, 'assignment.update', await assignmentScopes(actor, a))
        const status = nextAssignmentStatus(action, a.status)
        if (action === 'activate' || action === 'reopen') {
          validateActivation(
            {
              status: a.status,
              minItems: a.minItems,
              maxItems: a.maxItems,
              deadlineAt: action === 'reopen' ? new Date(8.64e15) : a.deadlineAt,
              topicCount: a.topicIds.length,
              targetCount: a.targetUserIds.length + a.targetGroupIds.length,
              questionTypeCount: a.questionTypeIds.length,
            },
            clock.now(),
          )
        }
        await uow.transaction(async (tx) => {
          await tx.education.updateAssignment(id, { status })
          await tx.audit.record(
            actor,
            {
              action: `assignment.${action}`,
              resourceType: 'assignment',
              resourceId: id,
              changes: diff({ status: a.status }, { status }),
              reason: reason?.trim() || null,
            },
            ctx,
          )
        })
        return { status }
      },
    }),
    extendDeadline: useCase<{ id: string; userId: string; newDeadlineAt: string | Date; reason?: string }, void>({
      name: 'education.extendDeadline',
      permission: 'assignment.update',
      async run(actor, raw, ctx) {
        const d = parse(
          z.object({ id: z.string(), userId: z.string(), newDeadlineAt: dateField, reason: opt(500) }),
          raw,
        )
        if (!d.newDeadlineAt) throw DomainError.validation([{ field: 'newDeadlineAt', message: 'Укажите новый срок' }])
        const a = await loadAssignment(d.id)
        requireScope(actor, 'assignment.update', await assignmentScopes(actor, a))
        if (a.status !== 'ACTIVE')
          throw new DomainError('INVALID_STATE', 'Продление возможно только для активного задания')
        if (!(await repo().isTargeted(d.id, d.userId)))
          throw DomainError.validation([{ field: 'userId', message: 'Задание не назначено этому студенту' }])
        validateExtension(a.deadlineAt, d.newDeadlineAt)
        await uow.transaction(async (tx) => {
          await tx.education.upsertExtension({
            assignmentId: d.id,
            userId: d.userId,
            newDeadlineAt: d.newDeadlineAt!,
            reason: d.reason,
            grantedBy: actor.userId,
          })
          await tx.audit.record(
            actor,
            {
              action: 'assignment.deadline.extended',
              resourceType: 'assignment',
              resourceId: d.id,
              changes: { userId: d.userId, newDeadlineAt: d.newDeadlineAt!.toISOString() },
              reason: d.reason,
            },
            ctx,
          )
        })
      },
    }),
    /** Варианты для формы настройки задания (темы/цели/типы/группы/студенты/эксперты курса). */
    assignmentOptions: useCase<{ id: string }, AssignmentOptions>({
      name: 'education.assignmentOptions',
      permission: 'assignment.update',
      async run(actor, { id }) {
        const a = await loadAssignment(id)
        requireScope(actor, 'assignment.update', await assignmentScopes(actor, a))
        const all = { kind: 'ANY' } as const
        const big = { filters: { courseId: a.courseId, status: 'ACTIVE' }, limit: 1000, offset: 0 }
        const [topics, objectives, groups, types] = await Promise.all([
          repo().listTopics(all, big),
          repo().listObjectives(all, big),
          repo().listGroups(all, big),
          repo().listQuestionTypes({ filters: { status: 'ACTIVE' }, limit: 100, offset: 0 }),
        ])
        const students = await repo().listUsersByRole('STUDENT', 2000)
        const reviewers = [
          ...(await repo().listUsersByRole('TEACHER', 2000)),
          ...(await repo().listUsersByRole('EXPERT', 2000)),
        ]
        return {
          topics: topics.records.map((t) => ({ value: t.id, label: t.path })),
          objectives: objectives.records.map((o) => ({
            value: o.id,
            label: `${o.code} — ${o.text}`,
            group: o.topicName,
          })),
          questionTypes: types.records.map((t) => ({ value: t.id, label: t.name })),
          groups: groups.records.map((g) => ({ value: g.id, label: `${g.name} (${g.memberIds.length})` })),
          students: students.map((s) => ({ value: s.id, label: `${s.displayName} <${s.email}>` })),
          reviewers: [
            ...new Map(reviewers.map((r) => [r.id, { value: r.id, label: `${r.displayName} <${r.email}>` }])).values(),
          ],
        }
      },
    }),
  }
}

export interface AssignmentOptions {
  topics: { value: string; label: string }[]
  objectives: { value: string; label: string; group: string }[]
  questionTypes: { value: string; label: string }[]
  groups: { value: string; label: string }[]
  students: { value: string; label: string }[]
  reviewers: { value: string; label: string }[]
}

export type EducationUseCases = ReturnType<typeof createEducationUseCases>
