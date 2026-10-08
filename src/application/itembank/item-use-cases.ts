import { createHash } from 'node:crypto'
import { z } from 'zod'
import { requireScope, scopeFilter, type Actor } from '../../domain/authorization/actor.js'
import type { Scope } from '../../domain/authorization/scope.js'
import { assertStudentCanCreate, type AssignmentStatus } from '../../domain/education/assignment.js'
import {
  canonicalJson,
  seededShuffle,
  type InteractionPlugin,
  type InteractionRegistry,
  type Issue,
  type ItemDocument,
} from '../../domain/itembank/interaction.js'
import { assertMediaSelectable, mediaIssuesForSubmit } from '../../domain/media/media-rules.js'
import { DomainError, type FieldError } from '../../domain/shared/errors.js'
import { assertEditable, canBranch, transition, type VersionState } from '../../domain/versioning/state-machine.js'
import type { AssignmentRecord } from '../education/ports.js'
import type { Clock, RequestContext } from '../shared/context.js'
import type { ListQuery } from '../shared/query.js'
import { schemaErrors } from '../shared/schema.js'
import type { UnitOfWork } from '../shared/uow.js'
import { useCase } from '../shared/use-case.js'
import type { ItemBankTx, ItemMeta, ItemRecord, ItemVersionRecord, QuestionTypeVersionRecord } from './ports.js'

export interface ItemDeps {
  uow: UnitOfWork<ItemBankTx>
  registry: InteractionRegistry
  clock: Clock
  /** Хук создания review при отправке (подключается в M5, SPEC-REVIEW-001). */
  onSubmitted?: (
    tx: ItemBankTx,
    actor: Actor,
    item: ItemRecord,
    versionId: string,
    ctx: RequestContext,
  ) => Promise<void>
}

// ---------------- схема входного документа ----------------
const optionSchema = z.object({
  key: z.string().trim().min(1).max(40),
  role: z.enum(['OPTION', 'PREMISE', 'RESPONSE', 'SEQUENCE_ELEMENT']),
  text: z
    .string()
    .max(2000)
    .nullish()
    .transform((v) => v ?? null),
  mediaAssetId: z
    .string()
    .nullish()
    .transform((v) => v || null),
  altTextOverride: z
    .string()
    .max(1000)
    .nullish()
    .transform((v) => v?.trim() || null),
  ordinal: z.coerce.number().int().min(0).max(1000),
})
const documentSchema = z.object({
  stem: z.string().max(5000, 'Формулировка не длиннее 5000 символов').default(''),
  content: z.record(z.string(), z.unknown()).default({}),
  options: z.array(optionSchema).max(60).default([]),
  media: z
    .array(
      z.object({
        mediaAssetId: z.string(),
        role: z.enum(['STIMULUS', 'ILLUSTRATION']),
        altTextOverride: z
          .string()
          .max(1000)
          .nullish()
          .transform((v) => v?.trim() || null),
        ordinal: z.coerce.number().int().min(0).default(0),
      }),
    )
    .max(10)
    .default([]),
  answerKey: z.record(z.string(), z.unknown()).default({}),
})
const metaSchema = z.object({
  defaultPoints: z.coerce.number().gt(0, 'Баллы > 0').max(100, 'Не более 100 баллов').default(1),
  difficulty: z.coerce.number().int().min(1).max(5).default(3),
  feedback: z
    .string()
    .max(5000)
    .nullish()
    .transform((v) => v?.trim() || null),
  topicIds: z.array(z.string()).default([]),
  objectiveIds: z.array(z.string()).default([]),
  tags: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
})

function zParse<T>(schema: z.ZodType<T>, input: unknown, prefix = ''): T {
  const r = schema.safeParse(input ?? {})
  if (!r.success)
    throw DomainError.validation(
      r.error.issues.map((i) => ({ field: `${prefix}${i.path.join('.')}` || 'form', message: i.message })),
    )
  return r.data
}

/** Санитизация rich text формулировки (NFR-SEC-007): разрешен минимальный набор тегов без атрибутов. */
export function sanitizeRichText(html: string): string {
  const allowed = new Set(['b', 'strong', 'i', 'em', 'u', 'p', 'br', 'ul', 'ol', 'li', 'sub', 'sup'])
  return html
    .replace(/<\s*(script|style|iframe|object|embed)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\/?([a-zA-Z0-9]+)(\s[^>]*)?>/g, (m, tag: string) => {
      const t = tag.toLowerCase()
      if (!allowed.has(t)) return ''
      return m.startsWith('</') ? `</${t}>` : `<${t}>`
    })
}

export function contentHashOf(doc: ItemDocument, meta: ItemMeta, qtvId: string): string {
  const norm = {
    qtv: qtvId,
    stem: doc.stem,
    content: doc.content,
    options: [...doc.options].sort((a, b) => a.role.localeCompare(b.role) || a.ordinal - b.ordinal),
    media: [...doc.media].sort((a, b) => a.role.localeCompare(b.role) || a.ordinal - b.ordinal),
    answerKey: doc.answerKey,
    meta: {
      ...meta,
      topicIds: [...meta.topicIds].sort(),
      objectiveIds: [...meta.objectiveIds].sort(),
      tags: [...meta.tags].sort(),
    },
  }
  return createHash('sha256').update(canonicalJson(norm)).digest('hex')
}

export interface ItemDetails {
  item: ItemRecord
  version: ItemVersionRecord
  versions: Awaited<ReturnType<ItemBankTx['items']['versions']>>
  typeVersion: QuestionTypeVersionRecord
  issues: Issue[]
  canEdit: boolean
  canSubmit: boolean
  canBranch: boolean
  canArchive: boolean
  canSeeAnswerKey: boolean
}

export function createItemUseCases(deps: ItemDeps) {
  const { uow, registry, clock } = deps
  const r = () => uow.read

  async function loadItem(id: string) {
    const item = await r().items.findById(id)
    if (!item) throw DomainError.notFound()
    return item
  }

  /** SPEC-ITEM-004: отношения пользователя к вопросу → scopes. */
  async function itemScopes(actor: Actor, item: ItemRecord): Promise<{ scopes: Set<Scope>; bankOnly: boolean }> {
    const rel = await r().items.relations(actor.userId, item.id)
    const s = new Set<Scope>()
    if (rel.own) s.add('OWN')
    if (rel.assignedViaAssignment) s.add('ASSIGNED')
    const courseVisible = rel.courseTeacher && (item.assignmentId !== null || item.latestApprovedVersionId !== null)
    if (courseVisible) s.add('COURSE')
    const scopes = actor.scopes('item.read')
    const viaOther =
      scopes.has('ANY') || (s.has('OWN') && scopes.has('OWN')) || (s.has('ASSIGNED') && scopes.has('ASSIGNED'))
    // Чужой вопрос банка, видимый только через COURSE: доступны лишь утвержденные версии.
    const bankOnly = !viaOther && s.has('COURSE') && item.assignmentId === null
    return { scopes: s, bankOnly }
  }

  async function requireRead(actor: Actor, item: ItemRecord) {
    const { scopes, bankOnly } = await itemScopes(actor, item)
    requireScope(actor, 'item.read', scopes, 'read')
    return { scopes, bankOnly }
  }

  async function typeVersionFor(qtvId: string) {
    const qtv = await r().qtypes.findVersion(qtvId)
    if (!qtv) throw new Error(`QuestionTypeVersion ${qtvId} не найдена`)
    return qtv
  }

  function pluginFor(key: string): InteractionPlugin {
    const p = registry.get(key)
    if (!p) throw new Error(`Interaction plugin ${key} не зарегистрирован (BR-023)`)
    return p
  }

  /** Контекст создания: задание (для студента — обязательное, BR-017) или курс, где пользователь преподает. */
  async function creationContext(actor: Actor, assignmentId: string | null, courseId: string | null) {
    if (assignmentId) {
      const a = await r().education.findAssignment(assignmentId)
      if (!a) throw DomainError.validation([{ field: 'assignmentId', message: 'Задание не найдено' }])
      const rel = await r().education.courseRelation(actor.userId, a.courseId)
      const manages = a.ownerId === actor.userId || rel.teaches || actor.has('item.read', 'ANY')
      if (!manages) {
        assertStudentCanCreate({
          status: a.status as AssignmentStatus,
          targeted: await r().education.isTargeted(a.id, actor.userId),
        })
      } else if (a.status !== 'ACTIVE' && a.status !== 'DRAFT') {
        throw DomainError.rule('BR-017', 'Задание закрыто')
      }
      return { assignment: a, courseId: a.courseId, student: !manages }
    }
    if (!courseId)
      throw DomainError.rule('BR-017', 'Вопрос создается в рамках задания или курса, который вы ведете', 'assignmentId')
    const course = await r().education.findCourse(courseId)
    if (!course) throw DomainError.validation([{ field: 'courseId', message: 'Курс не найден' }])
    const rel = await r().education.courseRelation(actor.userId, courseId)
    if (!rel.teaches && !actor.has('item.read', 'ANY')) {
      throw DomainError.rule('BR-017', 'Студенты создают вопросы только в рамках назначенного задания', 'assignmentId')
    }
    return { assignment: null as AssignmentRecord | null, courseId, student: false }
  }

  /** Структурная проверка черновика (блокирует сохранение). */
  async function checkStructure(args: {
    doc: ItemDocument
    meta: ItemMeta
    plugin: InteractionPlugin
    qtv: QuestionTypeVersionRecord
    courseId: string
    assignment: AssignmentRecord | null
    previous: { doc: ItemDocument; meta: ItemMeta } | null
  }) {
    const { doc, meta, plugin, qtv, courseId, assignment, previous } = args
    const e: FieldError[] = []
    for (const o of doc.options) {
      if (!plugin.optionRoles.includes(o.role))
        e.push({ field: `options.${o.key}`, message: `Роль ${o.role} не используется в этом типе` })
    }
    const keys = doc.options.map((o) => o.key)
    if (new Set(keys).size !== keys.length)
      e.push({ field: 'options', message: 'Ключи вариантов должны быть уникальны' })
    e.push(...schemaErrors(qtv.contentSchema, doc.content, 'content.'))
    e.push(...schemaErrors(qtv.answerKeySchema, doc.answerKey, 'answerKey.'))
    // Медиа: существует; новые ссылки — не архив и не RESTRICTED (BR-039, BR-024)
    const prevMedia = new Set([
      ...(previous?.doc.options ?? []).map((o) => o.mediaAssetId),
      ...(previous?.doc.media ?? []).map((m) => m.mediaAssetId),
    ])
    const mediaIds = [
      ...new Set(
        [...doc.options.map((o) => o.mediaAssetId), ...doc.media.map((m) => m.mediaAssetId)].filter(
          (x): x is string => !!x,
        ),
      ),
    ]
    const media = await r().media.findByIds(mediaIds)
    for (const id of mediaIds) {
      const m = media.find((x) => x.id === id)
      if (!m) {
        e.push({ field: 'media', message: `Медиа ${id} не найдено` })
        continue
      }
      if (!prevMedia.has(id)) {
        try {
          assertMediaSelectable(m, 'media')
        } catch (err) {
          e.push({ field: 'media', message: (err as DomainError).message })
        }
      }
    }
    // Темы: курс вопроса; для задания — темы задания и их подтемы; новые — не в архиве
    const allowedTopics = assignment
      ? new Set((await Promise.all(assignment.topicIds.map((t) => r().education.topicSubtreeIds(t)))).flat())
      : null
    const prevTopics = new Set(previous?.meta.topicIds ?? [])
    for (const tid of new Set(meta.topicIds)) {
      const t = await r().education.findTopic(tid)
      if (!t || t.courseId !== courseId) e.push({ field: 'topicIds', message: 'Тема не относится к курсу вопроса' })
      else if (allowedTopics && !allowedTopics.has(tid))
        e.push({ field: 'topicIds', message: `Тема «${t.name}» не входит в задание` })
      else if (t.status === 'ARCHIVED' && !prevTopics.has(tid))
        e.push({ field: 'topicIds', message: `Тема «${t.name}» в архиве (BR-039)` })
    }
    const prevObj = new Set(previous?.meta.objectiveIds ?? [])
    for (const oid of new Set(meta.objectiveIds)) {
      const o = await r().education.findObjective(oid)
      if (!o || o.courseId !== courseId)
        e.push({ field: 'objectiveIds', message: 'Учебная цель не относится к курсу вопроса' })
      else if (o.status === 'ARCHIVED' && !prevObj.has(oid))
        e.push({ field: 'objectiveIds', message: `Цель ${o.code} в архиве (BR-039)` })
    }
    if (e.length) throw DomainError.validation(e, 'Черновик не сохранен: исправьте ошибки')
  }

  /** Полная проверка (критерий отправки на экспертизу): плагин + темы + медиа (BR-020, BR-024, BR-025). */
  async function fullIssues(
    doc: ItemDocument,
    meta: ItemMeta,
    plugin: InteractionPlugin,
    qtv: QuestionTypeVersionRecord,
  ): Promise<Issue[]> {
    const issues: Issue[] = [...plugin.validate(doc, qtv.interactionConfig)]
    for (const f of schemaErrors(qtv.contentSchema, doc.content, 'content.'))
      issues.push({ path: f.field, code: 'SCHEMA', severity: 'ERROR', message: f.message })
    for (const f of schemaErrors(qtv.answerKeySchema, doc.answerKey, 'answerKey.'))
      issues.push({ path: f.field, code: 'SCHEMA', severity: 'ERROR', message: f.message })
    if (!meta.topicIds.length)
      issues.push({ path: 'topicIds', code: 'TOPIC_REQUIRED', severity: 'ERROR', message: 'Укажите хотя бы одну тему' })
    const refs = [
      ...doc.options
        .filter((o) => o.mediaAssetId)
        .map((o) => ({ id: o.mediaAssetId!, alt: o.altTextOverride, path: `options.${o.key}` })),
      ...doc.media.map((m) => ({ id: m.mediaAssetId, alt: m.altTextOverride, path: 'media' })),
    ]
    const media = await r().media.findByIds(refs.map((x) => x.id))
    for (const ref of refs) {
      const m = media.find((x) => x.id === ref.id)
      if (!m) continue
      for (const i of mediaIssuesForSubmit(m, ref.alt, ref.path)) issues.push({ ...i, severity: 'ERROR' })
      if (m.status === 'ARCHIVED')
        issues.push({
          path: ref.path,
          code: 'BR-039',
          severity: 'ERROR',
          message: `Медиа «${m.title}» в архиве (BR-039)`,
        })
    }
    return issues
  }

  function normalizeInput(
    raw: { document?: unknown; meta?: unknown },
    fallbackDoc: ItemDocument,
    fallbackMeta: ItemMeta,
  ) {
    const doc =
      raw.document === undefined ? fallbackDoc : (zParse(documentSchema, raw.document, 'document.') as ItemDocument)
    doc.stem = sanitizeRichText(doc.stem)
    const meta = raw.meta === undefined ? fallbackMeta : (zParse(metaSchema, raw.meta, 'meta.') as ItemMeta)
    meta.topicIds = [...new Set(meta.topicIds)]
    meta.objectiveIds = [...new Set(meta.objectiveIds)]
    meta.tags = [...new Set(meta.tags)]
    return { doc, meta }
  }

  async function details(actor: Actor, item: ItemRecord, versionId?: string): Promise<ItemDetails> {
    const { scopes, bankOnly } = await requireRead(actor, item)
    let versions = await r().items.versions(item.id)
    if (bankOnly) versions = versions.filter((v) => v.state === 'APPROVED' || v.state === 'PUBLISHED')
    const vid =
      versionId ??
      (bankOnly ? item.latestApprovedVersionId : (item.currentDraftVersionId ?? item.latestApprovedVersionId)) ??
      versions[versions.length - 1]?.id
    if (!vid || !versions.some((v) => v.id === vid)) throw DomainError.notFound()
    const version = (await r().items.findVersion(vid))!
    const qtv = await typeVersionFor(version.questionTypeVersionId)
    const plugin = pluginFor(item.interactionKey)
    const issues = await fullIssues(version.document, version.meta, plugin, qtv)
    const updScopes = actor.scopes('item.update')
    const canUpdate = updScopes.has('ANY') || (updScopes.has('OWN') && scopes.has('OWN'))
    const hasDraft = !!item.currentDraftVersionId
    return {
      item,
      version,
      versions,
      typeVersion: qtv,
      issues,
      canEdit: canUpdate && version.state === 'DRAFT' && item.status === 'ACTIVE',
      canSubmit:
        actor.has('item.submit') &&
        scopes.has('OWN') &&
        version.state === 'DRAFT' &&
        item.assignmentId === null &&
        item.status === 'ACTIVE',
      canBranch: canUpdate && !hasDraft && canBranch(version.state) && item.status === 'ACTIVE',
      canArchive: actor.has('item.archive', 'ANY') || (actor.has('item.archive', 'OWN') && scopes.has('OWN')),
      canSeeAnswerKey: true,
    }
  }

  /** Представление вопроса «как у студента»: перемешивание вариантов по seed (SPEC-ITEM-003). */
  function buildPreview(
    item: Pick<ItemRecord, 'interactionKey' | 'questionTypeName'>,
    version: ItemVersionRecord,
    qtv: QuestionTypeVersionRecord,
    issues: Issue[],
    seed: number,
    shuffleOverride?: boolean,
  ): PreviewData {
    const doc = version.document
    const shuffle =
      shuffleOverride === false ? false : doc.content.shuffleOptions === true || doc.content.shuffleResponses === true
    const roles = [...new Set(doc.options.map((o) => o.role))]
    const options = roles.flatMap((role) => {
      const list = doc.options.filter((o) => o.role === role).sort((a, b) => a.ordinal - b.ordinal)
      const doShuffle = role === 'SEQUENCE_ELEMENT' || (shuffle && (role === 'OPTION' || role === 'RESPONSE'))
      return doShuffle ? seededShuffle(list, seed + role.length) : list
    })
    return {
      interactionKey: item.interactionKey,
      typeName: item.questionTypeName,
      config: qtv.interactionConfig,
      stem: doc.stem,
      content: doc.content,
      options,
      media: doc.media,
      answerKey: doc.answerKey,
      feedback: version.meta.feedback,
      errors: issues.filter((i) => i.severity === 'ERROR'),
      versionNo: version.versionNo,
      state: version.state,
    }
  }

  /** Изменение: невидимый вопрос — 404 (не раскрываем существование), видимый без права — 403. */
  async function requireUpdate(actor: Actor, item: ItemRecord) {
    const { scopes } = await requireRead(actor, item)
    requireScope(actor, 'item.update', scopes)
  }

  return {
    // ================= Чтение =================
    listItems: useCase<ListQuery, Awaited<ReturnType<ItemBankTx['items']['list']>>>({
      name: 'item.list',
      permission: 'item.read',
      run: async (actor, q) => r().items.list(scopeFilter(actor, 'item.read'), q),
    }),

    getItem: useCase<{ id: string; versionId?: string }, ItemDetails>({
      name: 'item.get',
      permission: 'item.read',
      run: async (actor, { id, versionId }) => details(actor, await loadItem(id), versionId),
    }),

    /** Контекст редактора: допустимые типы (BR-018, BR-021), темы и цели, задания пользователя. */
    editorContext: useCase<
      { assignmentId?: string | null; courseId?: string | null; itemId?: string | null },
      EditorContext
    >({
      name: 'item.editorContext',
      permission: 'item.read',
      async run(actor, input) {
        let assignment: AssignmentRecord | null = null
        let courseId = input.courseId ?? null
        if (input.itemId) {
          const item = await loadItem(input.itemId)
          await requireRead(actor, item)
          courseId = item.courseId
          assignment = item.assignmentId ? await r().education.findAssignment(item.assignmentId) : null
        } else if (input.assignmentId) {
          const c = await creationContext(actor, input.assignmentId, null)
          assignment = c.assignment
          courseId = c.courseId
        }
        const types = await r().qtypes.list({ filters: {}, limit: 100, offset: 0 })
        const allowedTypeIds = assignment ? new Set(assignment.questionTypeIds) : null
        const typeOptions = types.records
          .filter((t) => t.status === 'ACTIVE' && (!allowedTypeIds || allowedTypeIds.has(t.id)))
          .map((t) => ({
            id: t.id,
            code: t.code,
            name: t.name,
            description: t.description,
            interactionKey: t.interactionKey,
            config: t.currentVersion?.interactionConfig ?? {},
          }))
        const topicScope = assignment
          ? new Set((await Promise.all(assignment.topicIds.map((t) => r().education.topicSubtreeIds(t)))).flat())
          : null
        const all = { kind: 'ANY' } as const
        const topics = courseId
          ? (await r().education.listTopics(all, { filters: { courseId }, limit: 1000, offset: 0 })).records
          : []
        const objectives = courseId
          ? (await r().education.listObjectives(all, { filters: { courseId }, limit: 1000, offset: 0 })).records
          : []
        const myAssignments = (
          await r().education.listAssignments(scopeFilterSafe(actor), {
            filters: { status: 'ACTIVE' },
            limit: 200,
            offset: 0,
          })
        ).records
        const myCourses = (
          await r().education.listCourses(scopeFilterSafe(actor, 'taxonomy.read'), {
            filters: {},
            limit: 200,
            offset: 0,
          })
        ).records
        const teachCourses = (await r().education.userCourseIds(actor.userId)).teaches
        return {
          assignment: assignment ? { id: assignment.id, title: assignment.title, courseId: assignment.courseId } : null,
          courseId,
          types: typeOptions,
          topics: topics
            .filter((t) => !topicScope || topicScope.has(t.id))
            .map((t) => ({ value: t.id, label: t.path })),
          objectives: objectives
            .filter((o) => !topicScope || topicScope.has(o.topicId))
            .map((o) => ({ value: o.id, label: `${o.code} — ${o.text}`, topicId: o.topicId })),
          assignments: myAssignments.map((a) => ({ value: a.id, label: `${a.title} (${a.courseName})` })),
          courses: myCourses
            .filter((c) => teachCourses.includes(c.id) || actor.has('item.read', 'ANY'))
            .map((c) => ({ value: c.id, label: c.name })),
          interactions: Object.fromEntries(
            registry
              .keys()
              .map((k) => [k, { optionRoles: registry.get(k)!.optionRoles, title: registry.get(k)!.title }]),
          ),
          emptyDocuments: Object.fromEntries(
            typeOptions.map((t) => [t.id, pluginFor(t.interactionKey).emptyDocument(t.config)]),
          ),
        }
      },
    }),

    // ================= Создание и редактирование =================
    /** SPEC-ITEM-001: Item + ItemVersion v1 DRAFT, owner = автор. */
    createItem: useCase<
      {
        assignmentId?: string | null
        courseId?: string | null
        questionTypeId: string
        document?: unknown
        meta?: unknown
      },
      { itemId: string; versionId: string; issues: Issue[] }
    >({
      name: 'item.create',
      permission: 'item.create',
      async run(actor, input, ctx) {
        const c = await creationContext(actor, input.assignmentId || null, input.courseId || null)
        const type = await r().qtypes.findById(String(input.questionTypeId ?? ''))
        if (!type || !type.currentVersion)
          throw DomainError.validation([{ field: 'questionTypeId', message: 'Выберите тип вопроса (BR-019)' }])
        if (type.status !== 'ACTIVE') throw DomainError.rule('BR-021', 'Тип вопроса неактивен', 'questionTypeId')
        if (c.assignment && !c.assignment.questionTypeIds.includes(type.id)) {
          throw DomainError.rule('BR-018', 'Этот тип вопроса не разрешен заданием', 'questionTypeId')
        }
        const plugin = pluginFor(type.interactionKey)
        const qtv = type.currentVersion
        const defaultMeta: ItemMeta = {
          defaultPoints: 1,
          difficulty: 3,
          feedback: null,
          topicIds: c.assignment && c.assignment.topicIds.length === 1 ? [...c.assignment.topicIds] : [],
          objectiveIds: [],
          tags: [],
        }
        const { doc, meta } = normalizeInput(input, plugin.emptyDocument(qtv.interactionConfig), defaultMeta)
        await checkStructure({ doc, meta, plugin, qtv, courseId: c.courseId, assignment: c.assignment, previous: null })
        const ids = await uow.transaction(async (tx) => {
          const itemId = await tx.items.insertItem({
            questionTypeId: type.id,
            ownerId: actor.userId,
            assignmentId: c.assignment?.id ?? null,
            courseId: c.courseId,
          })
          const versionId = await tx.items.insertVersion({
            itemId,
            versionNo: 1,
            basedOnVersionId: null,
            questionTypeVersionId: qtv.id,
            document: doc,
            meta,
            authorIds: [actor.userId],
          })
          await tx.items.setItemPointers(itemId, { currentDraftVersionId: versionId })
          await tx.audit.record(
            actor,
            {
              action: 'item.created',
              resourceType: 'item',
              resourceId: itemId,
              changes: { questionType: type.code, assignmentId: c.assignment?.id ?? null, versionId },
            },
            ctx,
          )
          return { itemId, versionId }
        })
        return { ...ids, issues: await fullIssues(doc, meta, plugin, qtv) }
      },
    }),

    /** SPEC-ITEM-002: сохранение черновика (только DRAFT, BR-004/006/007; optimistic lock). */
    saveDraft: useCase<
      { itemId: string; document?: unknown; meta?: unknown; revision: number },
      { issues: Issue[]; revision: number }
    >({
      name: 'item.saveDraft',
      permission: 'item.update',
      async run(actor, input, ctx) {
        const item = await loadItem(input.itemId)
        await requireUpdate(actor, item)
        if (item.status === 'ARCHIVED') throw new DomainError('INVALID_STATE', 'Вопрос в архиве')
        if (!item.currentDraftVersionId)
          throw new DomainError('INVALID_STATE', 'Нет черновика: создайте новую версию (BR-007)', { ruleId: 'BR-007' })
        const v = (await r().items.findVersion(item.currentDraftVersionId))!
        assertEditable(v.state)
        const qtv = await typeVersionFor(v.questionTypeVersionId)
        const plugin = pluginFor(item.interactionKey)
        const { doc, meta } = normalizeInput(input, v.document, v.meta)
        const assignment = item.assignmentId ? await r().education.findAssignment(item.assignmentId) : null
        await checkStructure({
          doc,
          meta,
          plugin,
          qtv,
          courseId: item.courseId,
          assignment,
          previous: { doc: v.document, meta: v.meta },
        })
        await uow.transaction(async (tx) => {
          await tx.items.replaceDraftContent(v.id, doc, meta, Number(input.revision))
          await tx.audit.record(
            actor,
            {
              action: 'item.draft.saved',
              resourceType: 'item',
              resourceId: item.id,
              changes: {
                versionId: v.id,
                versionNo: v.versionNo,
                stemChanged: v.document.stem !== doc.stem,
                optionsChanged: canonicalJson(v.document.options) !== canonicalJson(doc.options),
                answerKeyChanged: canonicalJson(v.document.answerKey) !== canonicalJson(doc.answerKey),
              },
            },
            ctx,
          )
        })
        return { issues: await fullIssues(doc, meta, plugin, qtv), revision: Number(input.revision) + 1 }
      },
    }),

    /** Новая версия на основе замороженной (BR-003, BR-041); key вариантов сохраняются (INV-008). */
    createNewVersion: useCase<
      { itemId: string; fromVersionId?: string },
      { versionId: string; versionNo: number; issues: Issue[] }
    >({
      name: 'item.newVersion',
      permission: 'item.update',
      async run(actor, input, ctx) {
        const item = await loadItem(input.itemId)
        await requireUpdate(actor, item)
        if (item.status === 'ARCHIVED')
          throw new DomainError('INVALID_STATE', 'Вопрос в архиве — сначала восстановите его')
        if (item.currentDraftVersionId) throw DomainError.rule('BR-041', 'У вопроса уже есть черновик — откройте его')
        if (item.assignmentId) {
          const a = await r().education.findAssignment(item.assignmentId)
          const rel = await r().education.courseRelation(actor.userId, item.courseId)
          if (a && a.status === 'CLOSED' && !rel.teaches && !actor.has('item.update', 'ANY'))
            throw DomainError.rule('BR-031', 'Задание закрыто — доработка невозможна')
        }
        const versions = await r().items.versions(item.id)
        const srcId = input.fromVersionId ?? versions[versions.length - 1]?.id
        const src = srcId ? await r().items.findVersion(srcId) : null
        if (!src || src.itemId !== item.id) throw DomainError.notFound()
        if (!canBranch(src.state))
          throw new DomainError(
            'INVALID_STATE',
            'Новую версию можно создать из версии, возвращенной на доработку, утвержденной или архивной',
          )
        const type = (await r().qtypes.findById(item.questionTypeId))!
        const qtv = type.currentVersion!
        const versionNo = (await r().items.maxVersionNo(item.id)) + 1
        const authors = [...new Set([...src.authorIds, actor.userId])]
        const versionId = await uow.transaction(async (tx) => {
          const id = await tx.items.insertVersion({
            itemId: item.id,
            versionNo,
            basedOnVersionId: src.id,
            questionTypeVersionId: qtv.id,
            document: src.document,
            meta: src.meta,
            authorIds: authors,
          })
          await tx.items.setItemPointers(item.id, { currentDraftVersionId: id })
          // auto-rebind (versioning-model §4 п.4): черновики тестов автора переходят на новую версию
          const rebound =
            src.state === 'CHANGES_REQUESTED' ? await tx.items.rebindDraftTests(src.id, id, actor.userId) : []
          await tx.audit.record(
            actor,
            {
              action: 'item.version.created',
              resourceType: 'item',
              resourceId: item.id,
              changes: { versionId: id, versionNo, basedOn: src.versionNo, reboundTests: rebound },
            },
            ctx,
          )
          for (const testId of rebound) {
            await tx.audit.record(
              actor,
              {
                action: 'test.item.rebound',
                resourceType: 'test',
                resourceId: testId,
                changes: { itemId: item.id, from: src.id, to: id },
              },
              ctx,
            )
          }
          return id
        })
        return {
          versionId,
          versionNo,
          issues: await fullIssues(src.document, src.meta, pluginFor(item.interactionKey), qtv),
        }
      },
    }),

    /** Самостоятельная отправка вопроса банка на экспертизу (FR-ITEM-009). Вопросы заданий — только в составе теста. */
    submitItem: useCase<{ itemId: string }, { versionId: string }>({
      name: 'item.submit',
      permission: 'item.submit',
      async run(actor, input, ctx) {
        const item = await loadItem(input.itemId)
        const { scopes } = await requireRead(actor, item)
        requireScope(actor, 'item.submit', scopes)
        if (item.assignmentId)
          throw new DomainError('INVALID_STATE', 'Вопросы заданий отправляются на экспертизу в составе теста')
        if (item.status === 'ARCHIVED') throw new DomainError('INVALID_STATE', 'Вопрос в архиве')
        if (!item.currentDraftVersionId) throw new DomainError('INVALID_STATE', 'Нет черновика для отправки')
        const v = (await r().items.findVersion(item.currentDraftVersionId))!
        const state = transition(v.state, 'submit', 'item')
        const qtv = await typeVersionFor(v.questionTypeVersionId)
        const errors = (await fullIssues(v.document, v.meta, pluginFor(item.interactionKey), qtv)).filter(
          (i) => i.severity === 'ERROR',
        )
        if (errors.length) {
          throw DomainError.validation(
            errors.map((e) => ({ field: e.path, message: e.message })),
            'Вопрос не готов к отправке (BR-020)',
          )
        }
        await uow.transaction(async (tx) => {
          await tx.items.setVersionState(v.id, {
            state,
            submittedAt: clock.now(),
            everSubmitted: true,
            contentHash: contentHashOf(v.document, v.meta, qtv.id),
          })
          await tx.items.setItemPointers(item.id, { currentDraftVersionId: null })
          await tx.audit.record(
            actor,
            {
              action: 'item.submitted',
              resourceType: 'item',
              resourceId: item.id,
              changes: { versionId: v.id, versionNo: v.versionNo },
            },
            ctx,
          )
          if (deps.onSubmitted) await deps.onSubmitted(tx, actor, item, v.id, ctx)
        })
        return { versionId: v.id }
      },
    }),

    /** BR-038: отзыв отправки до начала экспертизы. */
    recallItem: useCase<{ itemId: string; versionId: string }, void>({
      name: 'item.recall',
      permission: 'item.submit',
      async run(actor, input, ctx) {
        const item = await loadItem(input.itemId)
        const { scopes } = await requireRead(actor, item)
        requireScope(actor, 'item.submit', scopes)
        const v = await r().items.findVersion(input.versionId)
        if (!v || v.itemId !== item.id) throw DomainError.notFound()
        if (v.state === 'IN_REVIEW')
          throw DomainError.rule('BR-038', 'Экспертиза уже начата — отозвать отправку нельзя')
        if (await r().items.versionInOpenPackage(v.id))
          throw new DomainError('INVALID_STATE', 'Вопрос отправлен в составе теста — отзовите отправку теста')
        const state = transition(v.state, 'recall', 'item')
        await uow.transaction(async (tx) => {
          await tx.items.setVersionState(v.id, { state })
          await tx.items.setItemPointers(item.id, { currentDraftVersionId: v.id })
          await tx.audit.record(
            actor,
            { action: 'item.recalled', resourceType: 'item', resourceId: item.id, changes: { versionId: v.id } },
            ctx,
          )
        })
      },
    }),

    /** BR-044: черновик, никогда не отправлявшийся и без ссылок, удаляется; иначе — в архив. */
    discardDraft: useCase<{ itemId: string }, { deleted: 'version' | 'item' | 'archived' }>({
      name: 'item.discardDraft',
      permission: 'item.update',
      async run(actor, input, ctx) {
        const item = await loadItem(input.itemId)
        await requireUpdate(actor, item)
        if (!item.currentDraftVersionId) throw new DomainError('INVALID_STATE', 'Нет черновика')
        const v = (await r().items.findVersion(item.currentDraftVersionId))!
        const referenced = await r().items.versionReferencedByTests(v.id)
        return uow.transaction(async (tx) => {
          await tx.items.setItemPointers(item.id, { currentDraftVersionId: null })
          if (!v.everSubmitted && !referenced) {
            await tx.items.deleteVersion(v.id)
            if (v.versionNo === 1) {
              await tx.items.deleteItem(item.id)
              await tx.audit.record(
                actor,
                { action: 'item.discarded', resourceType: 'item', resourceId: item.id, changes: { versionNo: 1 } },
                ctx,
              )
              return { deleted: 'item' as const }
            }
            await tx.audit.record(
              actor,
              {
                action: 'item.draft.discarded',
                resourceType: 'item',
                resourceId: item.id,
                changes: { versionNo: v.versionNo },
              },
              ctx,
            )
            return { deleted: 'version' as const }
          }
          await tx.items.setVersionState(v.id, {
            state: transition(v.state, 'discard', 'item'),
            archiveReason: 'DISCARDED',
          })
          await tx.audit.record(
            actor,
            {
              action: 'item.draft.archived',
              resourceType: 'item',
              resourceId: item.id,
              changes: { versionNo: v.versionNo },
            },
            ctx,
          )
          return { deleted: 'archived' as const }
        })
      },
    }),

    archiveItem: useCase<{ itemId: string; reason?: string }, void>({
      name: 'item.archive',
      permission: 'item.archive',
      async run(actor, input, ctx) {
        const item = await loadItem(input.itemId)
        const { scopes } = await requireRead(actor, item)
        requireScope(actor, 'item.archive', scopes)
        if (item.status === 'ARCHIVED') throw new DomainError('INVALID_STATE', 'Вопрос уже в архиве')
        if (!actor.has('item.archive', 'ANY') && (await r().items.itemUsedInFrozenTestsOfOthers(item.id, actor.userId)))
          throw DomainError.rule(
            'BR-039',
            'Вопрос используется в отправленных тестах других авторов — архивация невозможна',
          )
        const reason = (input.reason ?? '').trim()
        if (!reason) throw DomainError.validation([{ field: 'reason', message: 'Укажите причину' }])
        await uow.transaction(async (tx) => {
          if (item.currentDraftVersionId) {
            await tx.items.setVersionState(item.currentDraftVersionId, {
              state: 'ARCHIVED',
              archiveReason: 'CONTAINER_ARCHIVED',
            })
            await tx.items.setItemPointers(item.id, { currentDraftVersionId: null })
          }
          await tx.items.setItemArchived(item.id, true, actor.userId, reason)
          await tx.audit.record(
            actor,
            { action: 'item.archived', resourceType: 'item', resourceId: item.id, reason },
            ctx,
          )
        })
      },
    }),

    restoreItem: useCase<{ itemId: string }, void>({
      name: 'item.restore',
      permission: 'item.archive',
      async run(actor, input, ctx) {
        const item = await loadItem(input.itemId)
        const { scopes } = await requireRead(actor, item)
        requireScope(actor, 'item.archive', scopes)
        if (item.status !== 'ARCHIVED') throw new DomainError('INVALID_STATE', 'Вопрос не в архиве')
        await uow.transaction(async (tx) => {
          await tx.items.setItemArchived(item.id, false, actor.userId, null)
          await tx.audit.record(actor, { action: 'item.restored', resourceType: 'item', resourceId: item.id }, ctx)
        })
      },
    }),

    // ================= Preview / оценка / сравнение =================
    /** SPEC-ITEM-003: представление для предпросмотра (перемешивание по seed). */
    previewItem: useCase<{ itemId: string; versionId?: string; seed?: number }, PreviewData>({
      name: 'item.preview',
      permission: 'item.read',
      async run(actor, input) {
        const d = await details(actor, await loadItem(input.itemId), input.versionId)
        const seed = Number.isFinite(input.seed) ? Number(input.seed) : 1
        return buildPreview(d.item, d.version, d.typeVersion, d.issues, seed)
      },
    }),

    /** Оценка тестового ответа (без сохранения, AC-ITEM-003.3). */
    evaluatePreview: useCase<
      { itemId: string; versionId?: string; response: Record<string, unknown> },
      { score: number | null; maxScore: number; details: Record<string, unknown> }
    >({
      name: 'item.evaluatePreview',
      permission: 'item.read',
      async run(actor, input) {
        const d = await details(actor, await loadItem(input.itemId), input.versionId)
        const plugin = pluginFor(d.item.interactionKey)
        const errs = schemaErrors(d.typeVersion.responseSchema, input.response ?? {}, 'response.')
        if (errs.length) throw DomainError.validation(errs, 'Ответ не соответствует формату типа')
        const evaluator = plugin.evaluators[d.typeVersion.evaluation.method]
        if (!evaluator) throw new Error('Evaluator не найден')
        return evaluator.evaluate(d.version.document, input.response, d.typeVersion.evaluation.params ?? {})
      },
    }),

    /** FR-ITEM-008: сравнение двух версий по нормализованному представлению. */
    compareVersions: useCase<{ itemId: string; a: string; b: string }, { field: string; from: unknown; to: unknown }[]>(
      {
        name: 'item.compare',
        permission: 'item.read',
        async run(actor, input) {
          const item = await loadItem(input.itemId)
          const da = await details(actor, item, input.a)
          const db = await details(actor, item, input.b)
          const flat = (v: ItemVersionRecord) => ({
            stem: v.document.stem,
            content: canonicalJson(v.document.content),
            answerKey: canonicalJson(v.document.answerKey),
            ...Object.fromEntries(
              v.document.options.map((o) => [
                `option ${o.key}`,
                `${o.role}: ${o.text ?? ''}${o.mediaAssetId ? ` [медиа ${o.mediaAssetId.slice(0, 8)}]` : ''}`,
              ]),
            ),
            media: v.document.media.map((m) => `${m.role}:${m.mediaAssetId.slice(0, 8)}`).join(', '),
            defaultPoints: v.meta.defaultPoints,
            difficulty: v.meta.difficulty,
            feedback: v.meta.feedback,
            topicIds: [...v.meta.topicIds].sort().join(', '),
            objectiveIds: [...v.meta.objectiveIds].sort().join(', '),
            tags: [...v.meta.tags].sort().join(', '),
          })
          const fa: Record<string, unknown> = flat(da.version)
          const fb: Record<string, unknown> = flat(db.version)
          return [...new Set([...Object.keys(fa), ...Object.keys(fb)])]
            .filter((k) => JSON.stringify(fa[k] ?? null) !== JSON.stringify(fb[k] ?? null))
            .map((k) => ({ field: k, from: fa[k] ?? null, to: fb[k] ?? null }))
        },
      },
    ),

    /**
     * Внутренний API для конструктора тестов (без проверки прав: доступ к пакету проверяет вызывающий use case).
     * Не является use case и не вызывается из UI напрямую.
     */
    internal: {
      /** Полная проверка версии (BR-020, BR-024, BR-025, BR-039). */
      async validateVersion(versionId: string): Promise<Issue[]> {
        const v = await r().items.findVersion(versionId)
        if (!v) return [{ path: 'item', code: 'NOT_FOUND', severity: 'ERROR', message: 'Версия вопроса не найдена' }]
        const item = (await r().items.findById(v.itemId))!
        return fullIssues(
          v.document,
          v.meta,
          pluginFor(item.interactionKey),
          await typeVersionFor(v.questionTypeVersionId),
        )
      },
      contentHash: async (versionId: string) => {
        const v = (await r().items.findVersion(versionId))!
        return contentHashOf(v.document, v.meta, v.questionTypeVersionId)
      },
      async previewVersion(versionId: string, seed: number, shuffleOptions?: boolean): Promise<PreviewData> {
        const v = (await r().items.findVersion(versionId))!
        const item = (await r().items.findById(v.itemId))!
        const qtv = await typeVersionFor(v.questionTypeVersionId)
        return buildPreview(item, v, qtv, [], seed, shuffleOptions)
      },
    },
  }
}

/** scopeFilter без исключения: при отсутствии права — пустая выборка. */
function scopeFilterSafe(actor: Actor, key = 'assignment.read') {
  return actor.has(key)
    ? scopeFilter(actor, key)
    : ({ kind: 'SCOPED', userId: actor.userId, scopes: new Set<Scope>() } as const)
}

export interface EditorContext {
  assignment: { id: string; title: string; courseId: string } | null
  courseId: string | null
  types: {
    id: string
    code: string
    name: string
    description: string | null
    interactionKey: string
    config: Record<string, unknown>
  }[]
  topics: { value: string; label: string }[]
  objectives: { value: string; label: string; topicId: string }[]
  assignments: { value: string; label: string }[]
  courses: { value: string; label: string }[]
  interactions: Record<string, { optionRoles: string[]; title: string }>
  emptyDocuments: Record<string, ItemDocument>
}

export interface PreviewData {
  interactionKey: string
  typeName: string
  config: Record<string, unknown>
  stem: string
  content: Record<string, unknown>
  options: ItemDocument['options']
  media: ItemDocument['media']
  answerKey: Record<string, unknown>
  feedback: string | null
  errors: Issue[]
  versionNo: number
  state: VersionState
}

export type ItemUseCases = ReturnType<typeof createItemUseCases>
