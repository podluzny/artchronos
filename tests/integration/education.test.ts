import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Actor } from '../../src/domain/authorization/actor.js'
import type { Db } from '../../src/infrastructure/db/kysely.js'
import type { Services } from '../../src/server/container.js'
import { freshDb } from '../support/db.js'
import { makeCourseWorld } from '../support/education.js'
import { auditActions, ctx, makeUser, setupServices } from '../support/fixtures.js'

let db: Db
let services: Services
let admin: Actor
let w: Awaited<ReturnType<typeof makeCourseWorld>>
let other: Awaited<ReturnType<typeof makeCourseWorld>>

beforeAll(async () => {
  db = await freshDb()
  ;({ services, admin } = await setupServices(db))
  w = await makeCourseWorld(services, admin)
  other = await makeCourseWorld(services, admin)
})
afterAll(async () => db.destroy())

const all = { filters: {}, limit: 200, offset: 0 }

describe('SPEC-EDU-001 Учебная структура', () => {
  it('AT-EDU-001.1 преподаватель создает тему и подтему в своем курсе', async () => {
    const t = await services.education.getTopic.run(w.teacher.actor, { id: w.subtopicId }, ctx)
    expect(t.path).toBe('Пейзаж XIX века / Передвижники')
    expect(t.depth).toBe(2)
    expect(await auditActions(db, w.subtopicId)).toEqual(['topic.created'])
  })

  it('AT-EDU-001.2 преподаватель не может изменять темы чужого курса', async () => {
    await expect(
      services.education.createTopic.run(w.teacher.actor, { courseId: other.courseId, name: 'Чужая' }, ctx),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    const t = await services.education.getTopic.run(admin, { id: other.topicId }, ctx)
    await expect(
      services.education.updateTopic.run(
        w.teacher.actor,
        { id: other.topicId, name: 'взлом', revision: t.revision },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    // и не видит чужой курс
    await expect(services.education.getTopic.run(w.teacher.actor, { id: other.topicId }, ctx)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })

  it('преподаватель не создает предметы и курсы (только Admin)', async () => {
    await expect(
      services.education.createSubject.run(w.teacher.actor, { code: 'X', name: 'X' }, ctx),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      services.education.createCourse.run(w.teacher.actor, { subjectId: w.subjectId, code: 'X', name: 'X' }, ctx),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('AT-EDU-001.3 удаление используемой темы невозможно; доступно архивирование (BR-042)', async () => {
    await expect(services.education.deleteTopic.run(w.teacher.actor, { id: w.topicId }, ctx)).rejects.toMatchObject({
      ruleId: 'BR-042',
    })
    const { id } = await services.education.createTopic.run(
      w.teacher.actor,
      { courseId: w.courseId, name: 'Временная' },
      ctx,
    )
    await services.education.deleteTopic.run(w.teacher.actor, { id }, ctx)
    expect(await services.uow.read.education.findTopic(id)).toBeNull()
  })

  it('AT-EDU-001.4 архивированная тема недоступна для выбора в задании и как родитель', async () => {
    const { id } = await services.education.createTopic.run(
      w.teacher.actor,
      { courseId: w.courseId, name: 'Архивная' },
      ctx,
    )
    await services.education.archiveTopic.run(w.teacher.actor, { id, reason: 'устарела' }, ctx)
    await expect(
      services.education.createTopic.run(w.teacher.actor, { courseId: w.courseId, parentId: id, name: 'x' }, ctx),
    ).rejects.toMatchObject({
      ruleId: 'BR-039',
    })
    const a = await services.education.getAssignment.run(w.teacher.actor, { id: w.assignmentId }, ctx)
    await expect(
      services.education.configureAssignment.run(
        w.teacher.actor,
        {
          id: w.assignmentId,
          topicIds: [...a.topicIds, id],
          objectiveIds: a.objectiveIds,
          questionTypeIds: a.questionTypeIds,
          targetUserIds: [],
          targetGroupIds: a.targetGroupIds,
        },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION' })
    // архивные скрыты из списка по умолчанию, видны с фильтром
    const active = await services.education.listTopics.run(
      w.teacher.actor,
      { ...all, filters: { courseId: w.courseId } },
      ctx,
    )
    expect(active.records.some((t) => t.id === id)).toBe(false)
    const archived = await services.education.listTopics.run(
      w.teacher.actor,
      { ...all, filters: { courseId: w.courseId, status: 'ARCHIVED' } },
      ctx,
    )
    expect(archived.records.some((t) => t.id === id)).toBe(true)
    await services.education.restoreTopic.run(w.teacher.actor, { id }, ctx)
  })

  it('архивирование темы с активными подтемами: отказ без cascade, поддерево — с cascade', async () => {
    const { id: root } = await services.education.createTopic.run(
      w.teacher.actor,
      { courseId: w.courseId, name: 'Корень' },
      ctx,
    )
    const { id: child } = await services.education.createTopic.run(
      w.teacher.actor,
      { courseId: w.courseId, parentId: root, name: 'Ребенок' },
      ctx,
    )
    await expect(
      services.education.archiveTopic.run(w.teacher.actor, { id: root, reason: 'x' }, ctx),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' })
    const r = await services.education.archiveTopic.run(w.teacher.actor, { id: root, reason: 'x', cascade: true }, ctx)
    expect(r.archived).toBe(2)
    expect((await services.uow.read.education.findTopic(child))!.status).toBe('ARCHIVED')
    // восстановление ребенка при архивном родителе запрещено
    await expect(services.education.restoreTopic.run(w.teacher.actor, { id: child }, ctx)).rejects.toMatchObject({
      code: 'INVALID_STATE',
    })
  })

  it('AT-EDU-001.5 цикл и глубина иерархии отклоняются на уровне use case', async () => {
    const t = await services.education.getTopic.run(w.teacher.actor, { id: w.topicId }, ctx)
    await expect(
      services.education.updateTopic.run(
        w.teacher.actor,
        { id: w.topicId, parentId: w.subtopicId, name: t.name, revision: t.revision },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION' })
    const { id: l3 } = await services.education.createTopic.run(
      w.teacher.actor,
      { courseId: w.courseId, parentId: w.subtopicId, name: 'Уровень 3' },
      ctx,
    )
    await expect(
      services.education.createTopic.run(
        w.teacher.actor,
        { courseId: w.courseId, parentId: l3, name: 'Уровень 4' },
        ctx,
      ),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
    })
  })

  it('учебные цели: код уникален в курсе; цель чужого курса недоступна', async () => {
    await expect(
      services.education.createObjective.run(
        w.teacher.actor,
        {
          topicId: w.topicId,
          code: (await services.education.getObjective.run(admin, { id: w.objectiveId }, ctx)).code,
          text: 'дубль',
        },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION' })
    await expect(
      services.education.getObjective.run(w.teacher.actor, { id: other.objectiveId }, ctx),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('студент видит структуру своего курса (через группу) и не видит чужой', async () => {
    const courses = await services.education.listCourses.run(w.student.actor, all, ctx)
    expect(courses.records.map((c) => c.id)).toEqual([w.courseId])
    const topics = await services.education.listTopics.run(w.student.actor, all, ctx)
    expect(topics.records.every((t) => t.courseId === w.courseId)).toBe(true)
    await expect(
      services.education.createTopic.run(w.student.actor, { courseId: w.courseId, name: 'x' }, ctx),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})

describe('SPEC-EDU-002 Группы', () => {
  it('AT-EDU-002.1 преподаватель создает группу в своем курсе и добавляет студентов', async () => {
    const s2 = await makeUser(services, admin, ['STUDENT'])
    const { id } = await services.education.createGroup.run(
      w.teacher.actor,
      { courseId: w.courseId, name: 'Новая группа', memberIds: [s2.id] },
      ctx,
    )
    const g = await services.education.getGroup.run(w.teacher.actor, { id }, ctx)
    expect(g.memberIds).toEqual([s2.id])
    expect(await auditActions(db, id)).toEqual(['group.created'])
  })

  it('AT-EDU-002.2 пользователь без роли STUDENT не добавляется', async () => {
    const t2 = await makeUser(services, admin, ['TEACHER'])
    await expect(
      services.education.setGroupMembers.run(w.teacher.actor, { id: w.groupId, memberIds: [w.student.id, t2.id] }, ctx),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
    })
  })

  it('AT-EDU-002.3 студент видит курс через членство в группе; после исключения — нет', async () => {
    const s3 = await makeUser(services, admin, ['STUDENT'])
    expect((await services.education.listCourses.run(s3.actor, all, ctx)).total).toBe(0)
    await services.education.setGroupMembers.run(
      w.teacher.actor,
      { id: w.groupId, memberIds: [w.student.id, s3.id] },
      ctx,
    )
    expect((await services.education.listCourses.run(s3.actor, all, ctx)).records.map((c) => c.id)).toEqual([
      w.courseId,
    ])
    await services.education.setGroupMembers.run(w.teacher.actor, { id: w.groupId, memberIds: [w.student.id] }, ctx)
    expect((await services.education.listCourses.run(s3.actor, all, ctx)).total).toBe(0)
  })

  it('AT-EDU-002.4 преподаватель не управляет группами чужого курса', async () => {
    await expect(
      services.education.createGroup.run(w.teacher.actor, { courseId: other.courseId, name: 'x' }, ctx),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      services.education.setGroupMembers.run(w.teacher.actor, { id: other.groupId, memberIds: [] }, ctx),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    const mine = await services.education.listGroups.run(w.teacher.actor, all, ctx)
    expect(mine.records.every((g) => g.courseId === w.courseId)).toBe(true)
  })

  it('AT-USER-001.8 преподаватель видит в списке пользователей студентов своих курсов', async () => {
    const r = await services.identity.listUsers.run(w.teacher.actor, all, ctx)
    expect(r.records.map((u) => u.id)).toContain(w.student.id)
    expect(r.records.map((u) => u.id)).not.toContain(other.student.id)
    await expect(services.identity.getUser.run(w.teacher.actor, { id: other.student.id }, ctx)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })
})

describe('SPEC-ASSIGN-001/002 Задания', () => {
  it('AT-ASSIGN-001.1 преподаватель создает и настраивает задание в своем курсе', async () => {
    const a = await services.education.getAssignment.run(w.teacher.actor, { id: w.assignmentId }, ctx)
    expect(a.status).toBe('ACTIVE')
    expect(a.topicIds).toEqual([w.topicId])
    expect(a.objectiveIds).toEqual([w.objectiveId])
    expect(a.questionTypeIds).toHaveLength(2)
    expect(a.targetGroupIds).toEqual([w.groupId])
    expect(a.defaultReviewerId).toBe(w.teacher.id)
    expect(await auditActions(db, w.assignmentId)).toEqual([
      'assignment.created',
      'assignment.configured',
      'assignment.activate',
    ])
  })

  it('AT-ASSIGN-001.2 студент не может создать задание', async () => {
    await expect(
      services.education.createAssignment.run(w.student.actor, { courseId: w.courseId, title: 'x' }, ctx),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('AT-ASSIGN-001.3 преподаватель не может создать задание в чужом курсе', async () => {
    await expect(
      services.education.createAssignment.run(w.teacher.actor, { courseId: other.courseId, title: 'x' }, ctx),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('AT-ASSIGN-001.4 неактивный тип вопроса нельзя выбрать (BR-021)', async () => {
    const essay = w.qt('essay')
    await db.updateTable('question_types').set({ status: 'INACTIVE' }).where('id', '=', essay).execute()
    const a = await services.education.getAssignment.run(w.teacher.actor, { id: w.assignmentId }, ctx)
    await expect(
      services.education.configureAssignment.run(
        w.teacher.actor,
        {
          id: w.assignmentId,
          topicIds: a.topicIds,
          objectiveIds: [],
          questionTypeIds: [essay],
          targetUserIds: [],
          targetGroupIds: a.targetGroupIds,
        },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION' })
    await db.updateTable('question_types').set({ status: 'ACTIVE' }).where('id', '=', essay).execute()
  })

  it('AT-ASSIGN-001.5 minItems > maxItems отклоняется use case', async () => {
    await expect(
      services.education.createAssignment.run(
        w.teacher.actor,
        { courseId: w.courseId, title: 'x', minItems: 6, maxItems: 3 },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION' })
  })

  it('AT-ASSIGN-001.6 эксперт по умолчанию без review.perform отклоняется (BR-027)', async () => {
    const a = await services.education.getAssignment.run(w.teacher.actor, { id: w.assignmentId }, ctx)
    await expect(
      services.education.configureAssignment.run(
        w.teacher.actor,
        {
          id: w.assignmentId,
          topicIds: a.topicIds,
          objectiveIds: [],
          questionTypeIds: a.questionTypeIds,
          targetUserIds: [],
          targetGroupIds: a.targetGroupIds,
          defaultReviewerId: w.student.id,
        },
        ctx,
      ),
    ).rejects.toMatchObject({ ruleId: 'BR-027' })
    const expert = await makeUser(services, admin, ['EXPERT'])
    await services.education.configureAssignment.run(
      w.teacher.actor,
      {
        id: w.assignmentId,
        topicIds: a.topicIds,
        objectiveIds: a.objectiveIds,
        questionTypeIds: a.questionTypeIds,
        targetUserIds: [],
        targetGroupIds: a.targetGroupIds,
        defaultReviewerId: expert.id,
      },
      ctx,
    )
    expect(
      (await services.education.getAssignment.run(w.teacher.actor, { id: w.assignmentId }, ctx)).defaultReviewerId,
    ).toBe(expert.id)
  })

  it('цели задания должны принадлежать выбранным темам (или подтемам)', async () => {
    const { id: t2 } = await services.education.createTopic.run(
      w.teacher.actor,
      { courseId: w.courseId, name: 'Другая тема' },
      ctx,
    )
    const a = await services.education.getAssignment.run(w.teacher.actor, { id: w.assignmentId }, ctx)
    await expect(
      services.education.configureAssignment.run(
        w.teacher.actor,
        {
          id: w.assignmentId,
          topicIds: [t2],
          objectiveIds: [w.objectiveId],
          questionTypeIds: a.questionTypeIds,
          targetUserIds: [],
          targetGroupIds: a.targetGroupIds,
        },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION' })
  })

  it('AT-ASSIGN-002.1 студент видит только адресованные ему задания (лично или через группу)', async () => {
    const mine = await services.education.listAssignments.run(w.student.actor, all, ctx)
    expect(mine.records.map((a) => a.id)).toEqual([w.assignmentId])
    await expect(
      services.education.getAssignment.run(w.student.actor, { id: other.assignmentId }, ctx),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    // лично адресованный студент
    const solo = await makeUser(services, admin, ['STUDENT'])
    const a = await services.education.getAssignment.run(other.teacher.actor, { id: other.assignmentId }, ctx)
    await services.education.configureAssignment.run(
      other.teacher.actor,
      {
        id: other.assignmentId,
        topicIds: a.topicIds,
        objectiveIds: a.objectiveIds,
        questionTypeIds: a.questionTypeIds,
        targetUserIds: [solo.id],
        targetGroupIds: a.targetGroupIds,
      },
      ctx,
    )
    const soloList = await services.education.listAssignments.run(solo.actor, all, ctx)
    expect(soloList.records.map((x) => x.id)).toEqual([other.assignmentId])
    // черновик не виден адресату
    const { id: draft } = await services.education.createAssignment.run(
      w.teacher.actor,
      { courseId: w.courseId, title: 'Черновик' },
      ctx,
    )
    await services.education.configureAssignment.run(
      w.teacher.actor,
      {
        id: draft,
        topicIds: [w.topicId],
        objectiveIds: [],
        questionTypeIds: a.questionTypeIds,
        targetUserIds: [],
        targetGroupIds: [w.groupId],
      },
      ctx,
    )
    expect(
      (await services.education.listAssignments.run(w.student.actor, all, ctx)).records.map((x) => x.id),
    ).not.toContain(draft)
  })

  it('AT-ASSIGN-002.5 активация без адресатов отклоняется (use case)', async () => {
    const { id } = await services.education.createAssignment.run(
      w.teacher.actor,
      { courseId: w.courseId, title: 'Без адресатов', deadlineAt: new Date(Date.now() + 86400_000) },
      ctx,
    )
    await expect(
      services.education.changeAssignmentStatus.run(w.teacher.actor, { id, action: 'activate' }, ctx),
    ).rejects.toMatchObject({ code: 'VALIDATION' })
  })

  it('AT-ASSIGN-002.2 закрытое задание: настройки не меняются; повторное открытие требует условий', async () => {
    const { id } = await services.education.createAssignment.run(
      w.teacher.actor,
      { courseId: w.courseId, title: 'Закрываемое', deadlineAt: new Date(Date.now() + 86400_000) },
      ctx,
    )
    const a = await services.education.getAssignment.run(w.teacher.actor, { id: w.assignmentId }, ctx)
    await services.education.configureAssignment.run(
      w.teacher.actor,
      {
        id,
        topicIds: [w.topicId],
        objectiveIds: [],
        questionTypeIds: a.questionTypeIds,
        targetUserIds: [],
        targetGroupIds: [w.groupId],
      },
      ctx,
    )
    await services.education.changeAssignmentStatus.run(w.teacher.actor, { id, action: 'activate' }, ctx)
    await services.education.changeAssignmentStatus.run(w.teacher.actor, { id, action: 'close' }, ctx)
    const closed = await services.education.getAssignment.run(w.teacher.actor, { id }, ctx)
    await expect(
      services.education.updateAssignment.run(
        w.teacher.actor,
        { id, title: 'x', minItems: 1, maxItems: 2, maxTestsPerStudent: 1, revision: closed.revision },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' })
    await services.education.changeAssignmentStatus.run(w.teacher.actor, { id, action: 'reopen' }, ctx)
    await services.education.changeAssignmentStatus.run(w.teacher.actor, { id, action: 'close' }, ctx)
    await services.education.changeAssignmentStatus.run(
      w.teacher.actor,
      { id, action: 'archive', reason: 'семестр окончен' },
      ctx,
    )
    expect((await services.education.getAssignment.run(w.teacher.actor, { id }, ctx)).status).toBe('ARCHIVED')
  })

  it('AT-ASSIGN-002.3 продление дедлайна студенту: персональный срок виден студенту', async () => {
    const a = await services.education.getAssignment.run(w.teacher.actor, { id: w.assignmentId }, ctx)
    const newDeadline = new Date(a.deadlineAt!.getTime() + 3 * 86400_000)
    await expect(
      services.education.extendDeadline.run(
        w.teacher.actor,
        { id: w.assignmentId, userId: w.student.id, newDeadlineAt: new Date(a.deadlineAt!.getTime() - 1) },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION' })
    await expect(
      services.education.extendDeadline.run(
        w.teacher.actor,
        { id: w.assignmentId, userId: other.student.id, newDeadlineAt: newDeadline },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION' })
    await services.education.extendDeadline.run(
      w.teacher.actor,
      { id: w.assignmentId, userId: w.student.id, newDeadlineAt: newDeadline, reason: 'болезнь' },
      ctx,
    )
    const forStudent = await services.education.getAssignment.run(w.student.actor, { id: w.assignmentId }, ctx)
    expect(forStudent.myDeadline!.getTime()).toBe(newDeadline.getTime())
    expect(await auditActions(db, w.assignmentId)).toContain('assignment.deadline.extended')
  })

  it('студент и эксперт не управляют заданием', async () => {
    const a = await services.education.getAssignment.run(w.teacher.actor, { id: w.assignmentId }, ctx)
    await expect(
      services.education.changeAssignmentStatus.run(w.student.actor, { id: w.assignmentId, action: 'close' }, ctx),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    const expert = await makeUser(services, admin, ['EXPERT'])
    await expect(
      services.education.updateAssignment.run(
        expert.actor,
        { id: w.assignmentId, title: 'x', minItems: 1, maxItems: 2, maxTestsPerStudent: 1, revision: a.revision },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})
