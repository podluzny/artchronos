import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Actor } from '../../src/domain/authorization/actor.js'
import type { Db } from '../../src/infrastructure/db/kysely.js'
import { createServices, type Services } from '../../src/server/container.js'
import { freshDb } from '../support/db.js'
import { auditActions, ctx, makeUser, setupServices } from '../support/fixtures.js'
import { tempStorage, uploadImage } from '../support/media.js'

/**
 * AT-E2E-001-API — SC-E2E-001 через application services без UI: сценарий работает без AdminJS,
 * все отказы происходят на сервере, аудит фиксирует каждое изменение.
 */
let db: Db
let services: Services
let admin: Actor

beforeAll(async () => {
  db = await freshDb()
  ;({ admin } = await setupServices(db))
  services = createServices(db, { storage: tempStorage() })
})
afterAll(async () => db.destroy())

const codeOf = (p: Promise<unknown>) =>
  p.then(
    () => 'OK',
    (e) => e.ruleId ?? e.code,
  )

describe('AT-E2E-001-API SC-E2E-001 через application services', () => {
  it('шаги 1–18', { timeout: 60000 }, async () => {
    // 1–2: Admin создает пользователей, предмет, курс, группу
    const t1 = await makeUser(services, admin, ['TEACHER'], { displayName: 'Т1' })
    const s1 = await makeUser(services, admin, ['STUDENT'], { displayName: 'С1' })
    const { id: subjectId } = await services.education.createSubject.run(
      admin,
      { code: 'HIST', name: 'История искусства' },
      ctx,
    )
    const { id: courseId } = await services.education.createCourse.run(
      admin,
      { subjectId, code: 'RU19', name: 'История русского искусства', teacherIds: [t1.id] },
      ctx,
    )
    // 3: Teacher — тема, цель, группа, задание; активирует
    const { id: topicId } = await services.education.createTopic.run(
      t1.actor,
      { courseId, name: 'Пейзаж XIX века' },
      ctx,
    )
    const { id: objectiveId } = await services.education.createObjective.run(
      t1.actor,
      { topicId, code: 'LO-1', text: 'Атрибутировать произведение по стилю' },
      ctx,
    )
    const { id: groupId } = await services.education.createGroup.run(
      t1.actor,
      { courseId, name: 'Г-1', memberIds: [s1.id] },
      ctx,
    )
    const types = await services.education.listQuestionTypes.run(admin, { filters: {}, limit: 50, offset: 0 }, ctx)
    const qt = (code: string) => types.records.find((t) => t.code === code)!.id
    const { id: assignmentId } = await services.education.createAssignment.run(
      t1.actor,
      {
        courseId,
        title: 'Тест по пейзажу',
        minItems: 2,
        maxItems: 5,
        deadlineAt: new Date(Date.now() + 7 * 86400_000),
      },
      ctx,
    )
    await services.education.configureAssignment.run(
      t1.actor,
      {
        id: assignmentId,
        topicIds: [topicId],
        objectiveIds: [objectiveId],
        questionTypeIds: [qt('single_choice'), qt('image_choice')],
        targetUserIds: [],
        targetGroupIds: [groupId],
      },
      ctx,
    )
    await services.education.changeAssignmentStatus.run(t1.actor, { id: assignmentId, action: 'activate' }, ctx)
    // 4–5: вопросы студента (изображения с подтвержденными правами — seed сценария)
    const item1 = await services.items.createItem.run(
      s1.actor,
      {
        assignmentId,
        questionTypeId: qt('single_choice'),
        document: {
          stem: 'Кто автор «Грачи прилетели»?',
          content: { shuffleOptions: true },
          options: [
            { key: 'o1', role: 'OPTION', text: 'Саврасов', ordinal: 0 },
            { key: 'o2', role: 'OPTION', text: 'Шишкин', ordinal: 1 },
            { key: 'o3', role: 'OPTION', text: 'Левитан', ordinal: 2 },
          ],
          answerKey: { correct: ['o1'] },
        },
        meta: { topicIds: [topicId] },
      },
      ctx,
    )
    const images = []
    for (const title of ['Куинджи', 'Шишкин', 'Левитан'])
      images.push(await uploadImage(services, t1.actor, { title, cleared: true }))
    const item2 = await services.items.createItem.run(
      s1.actor,
      {
        assignmentId,
        questionTypeId: qt('image_choice'),
        document: {
          stem: 'Какая работа принадлежит А. И. Куинджи?',
          content: {},
          options: images.map((m, i) => ({ key: `o${i + 1}`, role: 'OPTION', mediaAssetId: m, ordinal: i })),
          answerKey: { correct: ['o1'] },
        },
        meta: { topicIds: [topicId] },
      },
      ctx,
    )
    // 6: неразрешенный тип — BR-018
    expect(
      await codeOf(services.items.createItem.run(s1.actor, { assignmentId, questionTypeId: qt('matching') }, ctx)),
    ).toBe('BR-018')
    // 7: тест студента
    const test = await services.tests.createTest.run(s1.actor, { assignmentId, title: 'Пейзаж XIX века' }, ctx)
    const sec = (await services.tests.getTest.run(s1.actor, { id: test.testId }, ctx)).sections[0]!.id
    for (const it of [item1, item2])
      await services.tests.addItem.run(s1.actor, { testId: test.testId, sectionId: sec, itemId: it.itemId }, ctx)
    const d7 = await services.tests.getTest.run(s1.actor, { id: test.testId }, ctx)
    await services.tests.updateDraft.run(
      s1.actor,
      { testId: test.testId, revision: d7.version.revision, settings: { timeLimitSec: 1200 } },
      ctx,
    )
    // 8: отправка, Review + PRIMARY t1
    await services.tests.submitTest.run(s1.actor, { testId: test.testId }, ctx)
    const r1 = (await services.uow.read.reviews.latestForContainer('test', test.testId))!
    expect(r1.primaryReviewerId).toBe(t1.id)
    for (const it of [item1, item2])
      expect((await services.items.getItem.run(s1.actor, { id: it.itemId }, ctx)).version.state).toBe(
        'READY_FOR_REVIEW',
      )
    // 9: изменение v1 — BR-007
    expect(await codeOf(services.tests.addSection.run(s1.actor, { testId: test.testId, title: 'x' }, ctx))).toBe(
      'BR-007',
    )
    // 10–13
    await services.reviews.startReview.run(t1.actor, { reviewId: r1.id }, ctx)
    const { issueId } = await services.reviews.addComment.run(
      t1.actor,
      {
        reviewId: r1.id,
        body: 'неоднозначный дистрактор',
        severity: 'BLOCKING',
        anchor: { itemVersionId: item1.versionId },
      },
      ctx,
    )
    expect(await codeOf(services.reviews.approve.run(t1.actor, { reviewId: r1.id }, ctx))).toBe('BR-028')
    await services.reviews.requestChanges.run(t1.actor, { reviewId: r1.id }, ctx)
    const v1 = await services.tests.getTest.run(s1.actor, { id: test.testId }, ctx)
    expect(v1.version.state).toBe('CHANGES_REQUESTED')
    // 14: v2 теста, новые версии вопросов (auto-rebind), исправление, ADDRESSED, отправка
    const nv = await services.tests.createNewVersion.run(s1.actor, { testId: test.testId }, ctx)
    expect(nv.newItemVersions).toHaveLength(2)
    const i1v2 = await services.items.getItem.run(s1.actor, { id: item1.itemId }, ctx)
    await services.items.saveDraft.run(
      s1.actor,
      {
        itemId: item1.itemId,
        document: {
          ...i1v2.version.document,
          options: i1v2.version.document.options.map((o) => (o.key === 'o3' ? { ...o, text: 'Васнецов' } : o)),
        },
        revision: i1v2.version.revision,
      },
      ctx,
    )
    await services.reviews.setIssueStatus.run(s1.actor, { issueId: issueId!, status: 'ADDRESSED' }, ctx)
    await services.tests.submitTest.run(s1.actor, { testId: test.testId }, ctx)
    const v2 = await services.tests.getTest.run(s1.actor, { id: test.testId }, ctx)
    expect(v2.version.versionNo).toBe(2)
    expect(v2.sections[0]!.items.map((x) => x.versionNo)).toEqual([2, 2])
    expect(
      (await services.tests.getTest.run(s1.actor, { id: test.testId, versionId: test.versionId }, ctx)).version
        .contentHash,
    ).toBe(v1.version.contentHash)
    // 15: перенесенное замечание закрыто, checklist, approve
    const r2 = (await services.uow.read.reviews.latestForContainer('test', test.testId))!
    await services.reviews.startReview.run(t1.actor, { reviewId: r2.id }, ctx)
    const d15 = await services.reviews.getReview.run(t1.actor, { id: r2.id }, ctx)
    expect(d15.issues.filter((i) => i.carried).map((i) => i.id)).toEqual([issueId])
    await services.reviews.setIssueStatus.run(t1.actor, { issueId: issueId!, status: 'RESOLVED' }, ctx)
    for (const c of d15.template.items.filter((x) => x.mandatory))
      await services.reviews.answerChecklist.run(t1.actor, { reviewId: r2.id, code: c.code, checked: true }, ctx)
    await services.reviews.approve.run(t1.actor, { reviewId: r2.id }, ctx)
    for (const it of [item1, item2])
      expect((await services.items.getItem.run(s1.actor, { id: it.itemId }, ctx)).version.state).toBe('APPROVED')
    // 16: студент не может approve/publish
    expect(await codeOf(services.reviews.approve.run(s1.actor, { reviewId: r2.id }, ctx))).toBe('FORBIDDEN')
    expect(await codeOf(services.tests.publishTest.run(s1.actor, { testId: test.testId }, ctx))).toBe('FORBIDDEN')
    // 17: публикация
    await services.tests.publishTest.run(admin, { testId: test.testId }, ctx)
    const pub = await services.tests.getTest.run(admin, { id: test.testId }, ctx)
    expect(pub.test.publishedVersionId).toBe(nv.versionId)
    // 18: аудит — полная цепочка шагов 7–17
    const actions = await auditActions(db, test.testId)
    for (const a of [
      'test.created',
      'test.item.added',
      'test.draft.saved',
      'test.submitted',
      'test.changes_requested',
      'test.version.created',
      'test.approved',
      'test.published',
    ])
      expect(actions).toContain(a)
    const reviewActions = [...(await auditActions(db, r1.id)), ...(await auditActions(db, r2.id))]
    for (const a of [
      'review.created',
      'review.started',
      'review.issue.raised',
      'review.changes_requested',
      'review.issue.status',
      'review.approved',
    ])
      expect(reviewActions).toContain(a)
  })
})
