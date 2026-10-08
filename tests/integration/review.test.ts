import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Actor } from '../../src/domain/authorization/actor.js'
import type { Db } from '../../src/infrastructure/db/kysely.js'
import { createServices, type Services } from '../../src/server/container.js'
import { freshDb } from '../support/db.js'
import { makeCourseWorld } from '../support/education.js'
import { auditActions, ctx, makeUser, setupServices } from '../support/fixtures.js'
import { tempStorage, uploadImage } from '../support/media.js'
import {
  allowManyTests,
  approvedBankItem,
  approveReview,
  choiceDoc,
  reviewIdOf,
  submittedStudentTest,
  type World,
} from '../support/workflow.js'

let db: Db
let services: Services
let admin: Actor
let expert: { id: string; actor: Actor }
let expert2: { id: string; actor: Actor }

beforeAll(async () => {
  db = await freshDb()
  ;({ admin } = await setupServices(db))
  services = createServices(db, { storage: tempStorage() })
  expert = await makeUser(services, admin, ['EXPERT'])
  expert2 = await makeUser(services, admin, ['EXPERT'])
})
afterAll(async () => db.destroy())

async function world(): Promise<World> {
  const w = await makeCourseWorld(services, admin)
  await allowManyTests(db, w)
  return w
}

const codeOf = (p: Promise<unknown>) =>
  p.then(
    () => 'OK',
    (e) => e.ruleId ?? e.code,
  )

const testState = async (actor: Actor, testId: string, versionId?: string) =>
  (await services.tests.getTest.run(actor, { id: testId, versionId }, ctx)).version.state
const itemState = async (id: string) => (await services.items.getItem.run(admin, { id }, ctx)).version.state

describe('SPEC-REVIEW-001 Назначение эксперта и очередь', () => {
  it('AT-REVIEW-001.1 после submit по заданию создается ReviewAssignment(PRIMARY) на эксперта задания', async () => {
    const w = await world()
    const t = await submittedStudentTest(services, w)
    const d = await services.reviews.getReview.run(w.teacher.actor, { id: t.reviewId }, ctx)
    expect(d.review.status).toBe('OPEN')
    expect(d.review.subjectType).toBe('TEST_VERSION')
    const primary = d.assignments.filter((a) => a.role === 'PRIMARY' && a.status === 'ACTIVE')
    expect(primary.map((a) => a.reviewerId)).toEqual([w.teacher.id])
    expect(d.myRole).toBe('PRIMARY')
    expect(d.canStart).toBe(true)
    expect(d.template.items.filter((i) => i.mandatory)).toHaveLength(8)
  })

  it('AT-REVIEW-001.2 назначение автора экспертом отклоняется (BR-027)', async () => {
    const w = await world()
    const t = await services.tests.createTest.run(w.teacher.actor, { courseId: w.courseId, title: 'Свой тест' }, ctx)
    const bank = await approvedBankItem(services, w, admin)
    const sec = (await services.tests.getTest.run(w.teacher.actor, { id: t.testId }, ctx)).sections[0]!.id
    await services.tests.addItem.run(w.teacher.actor, { testId: t.testId, sectionId: sec, itemId: bank.itemId }, ctx)
    await services.tests.submitTest.run(w.teacher.actor, { testId: t.testId }, ctx)
    const reviewId = await reviewIdOf(services, t.testId)
    // тест вне задания — без автоназначения, в очереди «Не назначено»
    const unassigned = await services.reviews.listReviews.run(
      admin,
      { filters: { queue: 'unassigned' }, limit: 100, offset: 0 },
      ctx,
    )
    expect(unassigned.records.map((r) => r.id)).toContain(reviewId)
    expect(await codeOf(services.reviews.assignReviewer.run(admin, { reviewId, reviewerId: w.teacher.id }, ctx))).toBe(
      'BR-027',
    )
    expect(await codeOf(services.reviews.assignReviewer.run(admin, { reviewId, reviewerId: w.student.id }, ctx))).toBe(
      'BR-027',
    )
    expect(await codeOf(services.reviews.assignReviewer.run(admin, { reviewId, reviewerId: expert.id }, ctx))).toBe(
      'OK',
    )
  })

  it('AT-REVIEW-001.3 одновременно может быть только один активный PRIMARY (BR-030)', async () => {
    const w = await world()
    const t = await submittedStudentTest(services, w)
    await services.reviews.assignReviewer.run(
      admin,
      { reviewId: t.reviewId, reviewerId: expert.id, reason: 'перераспределение нагрузки' },
      ctx,
    )
    const d = await services.reviews.getReview.run(admin, { id: t.reviewId }, ctx)
    const active = d.assignments.filter((a) => a.role === 'PRIMARY' && a.status === 'ACTIVE')
    expect(active.map((a) => a.reviewerId)).toEqual([expert.id])
    expect(d.assignments.find((a) => a.reviewerId === w.teacher.id)!.status).toBe('REVOKED')
    await expect(
      sql`insert into review_assignments (review_id, reviewer_id, role) values (${t.reviewId}, ${expert2.id}, 'PRIMARY')`.execute(
        db,
      ),
    ).rejects.toThrow(/review_assignments_one_primary/)
  })

  it('AT-REVIEW-001.4 эксперт видит Review в очереди; другой эксперт — нет', async () => {
    const w = await world()
    const t = await submittedStudentTest(services, w)
    await services.reviews.assignReviewer.run(
      w.teacher.actor,
      { reviewId: t.reviewId, reviewerId: expert.id, reason: 'эксперт по пейзажу' },
      ctx,
    )
    const mine = await services.reviews.listReviews.run(
      expert.actor,
      { filters: { queue: 'mine' }, limit: 100, offset: 0 },
      ctx,
    )
    expect(mine.records.map((r) => r.id)).toContain(t.reviewId)
    const other = await services.reviews.listReviews.run(expert2.actor, { filters: {}, limit: 100, offset: 0 }, ctx)
    expect(other.records.map((r) => r.id)).not.toContain(t.reviewId)
    expect(await codeOf(services.reviews.getReview.run(expert2.actor, { id: t.reviewId }, ctx))).toBe('NOT_FOUND')
    // назначенный эксперт читает тест и вопросы пакета (scope ASSIGNED)
    expect(await codeOf(services.tests.getTest.run(expert.actor, { id: t.testId }, ctx))).toBe('OK')
    expect(await codeOf(services.items.getItem.run(expert.actor, { id: t.i1.itemId }, ctx))).toBe('OK')
    expect(await codeOf(services.tests.getTest.run(expert2.actor, { id: t.testId }, ctx))).toBe('NOT_FOUND')
  })

  it('AT-REVIEW-001.5 студент не может назначать экспертов', async () => {
    const w = await world()
    const t = await submittedStudentTest(services, w)
    expect(
      await codeOf(
        services.reviews.assignReviewer.run(w.student.actor, { reviewId: t.reviewId, reviewerId: expert.id }, ctx),
      ),
    ).toBe('FORBIDDEN')
  })

  it('AT-REVIEW-001.6 переназначение журналируется с причиной', async () => {
    const w = await world()
    const t = await submittedStudentTest(services, w)
    expect(
      await codeOf(services.reviews.assignReviewer.run(admin, { reviewId: t.reviewId, reviewerId: expert.id }, ctx)),
    ).toBe('VALIDATION')
    await services.reviews.assignReviewer.run(
      admin,
      { reviewId: t.reviewId, reviewerId: expert.id, reason: 'отпуск' },
      ctx,
    )
    const row = await sql<{ reason: string }>`select reason from audit_log where resource_id = ${t.reviewId}
      and action = 'review.reassigned'`.execute(db)
    expect(row.rows[0]?.reason).toBe('отпуск')
  })
})

describe('SPEC-REVIEW-002 Проведение экспертизы', () => {
  it('AT-REVIEW-002.1 start переводит версию в IN_REVIEW; recall после этого невозможен', async () => {
    const w = await world()
    const t = await submittedStudentTest(services, w)
    await services.reviews.startReview.run(w.teacher.actor, { reviewId: t.reviewId }, ctx)
    expect(await testState(w.student.actor, t.testId, t.versionId)).toBe('IN_REVIEW')
    expect(await itemState(t.i1.itemId)).toBe('IN_REVIEW')
    expect(await codeOf(services.tests.recallTest.run(w.student.actor, { testId: t.testId }, ctx))).toBe('BR-038')
  })

  it('AT-REVIEW-002.2 комментарий привязывается к вопросу/полю и отображается в этом месте', async () => {
    const w = await world()
    const t = await submittedStudentTest(services, w)
    await services.reviews.startReview.run(w.teacher.actor, { reviewId: t.reviewId }, ctx)
    const c = await services.reviews.addComment.run(
      w.teacher.actor,
      {
        reviewId: t.reviewId,
        body: 'Дистрактор «Левитан» неоднозначен',
        anchor: { itemVersionId: t.i1.versionId, fieldPath: 'options.o3' },
      },
      ctx,
    )
    const reply = await services.reviews.addComment.run(
      w.student.actor,
      { reviewId: t.reviewId, body: 'Заменю на Васнецова', parentId: c.commentId },
      ctx,
    )
    const d = await services.reviews.getReview.run(w.student.actor, { id: t.reviewId }, ctx)
    const found = d.comments.find((x) => x.id === c.commentId)!
    expect(found.anchor).toMatchObject({ itemVersionId: t.i1.versionId, fieldPath: 'options.o3' })
    expect(d.comments.find((x) => x.id === reply.commentId)!.parentId).toBe(c.commentId)
    expect(
      await codeOf(
        services.reviews.addComment.run(
          w.teacher.actor,
          { reviewId: t.reviewId, body: 'x', anchor: { itemVersionId: t.testId } },
          ctx,
        ),
      ),
    ).toBe('VALIDATION')
  })

  it('AT-REVIEW-002.3 ADVISORY не может отмечать checklist (BR-030)', async () => {
    const w = await world()
    const t = await submittedStudentTest(services, w)
    await services.reviews.assignReviewer.run(
      w.teacher.actor,
      { reviewId: t.reviewId, reviewerId: expert.id, role: 'ADVISORY' },
      ctx,
    )
    await services.reviews.startReview.run(w.teacher.actor, { reviewId: t.reviewId }, ctx)
    expect(
      await codeOf(
        services.reviews.answerChecklist.run(expert.actor, { reviewId: t.reviewId, code: 'KEYS', checked: true }, ctx),
      ),
    ).toBe('BR-030')
    // консультант комментирует и создает замечания
    const r = await services.reviews.addComment.run(
      expert.actor,
      { reviewId: t.reviewId, body: 'Проверьте датировку', severity: 'MINOR' },
      ctx,
    )
    expect(r.issueId).toBeTruthy()
  })

  it('AT-REVIEW-002.4 автор не может закрыть замечание, может пометить ADDRESSED', async () => {
    const w = await world()
    const t = await submittedStudentTest(services, w)
    await services.reviews.startReview.run(w.teacher.actor, { reviewId: t.reviewId }, ctx)
    const { issueId } = await services.reviews.addComment.run(
      w.teacher.actor,
      {
        reviewId: t.reviewId,
        body: 'Неоднозначный дистрактор',
        severity: 'BLOCKING',
        anchor: { itemVersionId: t.i1.versionId },
      },
      ctx,
    )
    expect(
      await codeOf(
        services.reviews.setIssueStatus.run(w.student.actor, { issueId: issueId!, status: 'RESOLVED' }, ctx),
      ),
    ).toBe('FORBIDDEN')
    await services.reviews.setIssueStatus.run(
      w.student.actor,
      { issueId: issueId!, status: 'ADDRESSED', note: 'исправлю' },
      ctx,
    )
    await services.reviews.setIssueStatus.run(w.teacher.actor, { issueId: issueId!, status: 'RESOLVED' }, ctx)
    const d = await services.reviews.getReview.run(w.teacher.actor, { id: t.reviewId }, ctx)
    expect(d.issues.find((i) => i.id === issueId)!.status).toBe('RESOLVED')
  })

  it('AT-REVIEW-002.5 незакрытые замечания переносятся в review следующей версии', async () => {
    const w = await world()
    const t = await submittedStudentTest(services, w)
    await services.reviews.startReview.run(w.teacher.actor, { reviewId: t.reviewId }, ctx)
    const open = await services.reviews.addComment.run(
      w.teacher.actor,
      {
        reviewId: t.reviewId,
        body: 'Неоднозначный дистрактор',
        severity: 'BLOCKING',
        anchor: { itemVersionId: t.i1.versionId },
      },
      ctx,
    )
    const closed = await services.reviews.addComment.run(
      w.teacher.actor,
      { reviewId: t.reviewId, body: 'Опечатка', severity: 'MINOR' },
      ctx,
    )
    await services.reviews.setIssueStatus.run(w.teacher.actor, { issueId: closed.issueId!, status: 'WONT_FIX' }, ctx)
    await services.reviews.requestChanges.run(w.teacher.actor, { reviewId: t.reviewId }, ctx)
    const nv = await services.tests.createNewVersion.run(w.student.actor, { testId: t.testId }, ctx)
    await services.reviews.setIssueStatus.run(w.student.actor, { issueId: open.issueId!, status: 'ADDRESSED' }, ctx)
    await services.tests.submitTest.run(w.student.actor, { testId: t.testId }, ctx)
    const r2 = await reviewIdOf(services, t.testId)
    expect(r2).not.toBe(t.reviewId)
    const d = await services.reviews.getReview.run(w.teacher.actor, { id: r2 }, ctx)
    const carried = d.issues.filter((i) => i.carried)
    expect(carried.map((i) => i.id)).toEqual([open.issueId])
    expect(carried[0]!.status).toBe('ADDRESSED')
    expect(carried[0]!.linkedVersionId).toBe(nv.versionId)
    expect(d.openBlocking).toBe(1)
  })

  it('AT-REVIEW-002.6 комментарии закрытого Review не изменяются (BR-040)', async () => {
    const w = await world()
    const t = await submittedStudentTest(services, w)
    await services.reviews.startReview.run(w.teacher.actor, { reviewId: t.reviewId }, ctx)
    await services.reviews.requestChanges.run(
      w.teacher.actor,
      { reviewId: t.reviewId, summary: 'Доработать формулировки' },
      ctx,
    )
    expect(
      await codeOf(services.reviews.addComment.run(w.teacher.actor, { reviewId: t.reviewId, body: 'Еще' }, ctx)),
    ).toBe('BR-040')
    expect(
      await codeOf(
        services.reviews.answerChecklist.run(
          w.teacher.actor,
          { reviewId: t.reviewId, code: 'KEYS', checked: true },
          ctx,
        ),
      ),
    ).toBe('BR-040')
    await expect(
      sql`insert into review_comments (review_id, author_id, body) values (${t.reviewId}, ${w.teacher.id}, 'обход')`.execute(
        db,
      ),
    ).rejects.toThrow(/BR-040/)
    await expect(sql`update reviews set summary = 'правка' where id = ${t.reviewId}`.execute(db)).rejects.toThrow(
      /BR-040/,
    )
  })

  it('AT-REVIEW-002.7 студент-автор не видит review чужих тестов', async () => {
    const w = await world()
    const t = await submittedStudentTest(services, w)
    const other = await makeUser(services, admin, ['STUDENT'])
    expect(await codeOf(services.reviews.getReview.run(other.actor, { id: t.reviewId }, ctx))).toBe('NOT_FOUND')
    expect(await codeOf(services.reviews.getReview.run(w.student.actor, { id: t.reviewId }, ctx))).toBe('OK')
  })
})

describe('SPEC-REVIEW-003 Решения экспертизы', () => {
  it('AT-REVIEW-003.1 request changes переводит тест и вопросы пакета в CHANGES_REQUESTED; Review закрыт', async () => {
    const w = await world()
    const t = await submittedStudentTest(services, w)
    await services.reviews.startReview.run(w.teacher.actor, { reviewId: t.reviewId }, ctx)
    await services.reviews.addComment.run(
      w.teacher.actor,
      { reviewId: t.reviewId, body: 'Неточная атрибуция', severity: 'MAJOR' },
      ctx,
    )
    await services.reviews.requestChanges.run(w.teacher.actor, { reviewId: t.reviewId }, ctx)
    expect(await testState(w.student.actor, t.testId, t.versionId)).toBe('CHANGES_REQUESTED')
    expect(await itemState(t.i1.itemId)).toBe('CHANGES_REQUESTED')
    expect(await itemState(t.i2.itemId)).toBe('CHANGES_REQUESTED')
    const d = await services.reviews.getReview.run(w.teacher.actor, { id: t.reviewId }, ctx)
    expect(d.review.status).toBe('CHANGES_REQUESTED')
    expect(d.review.decision).toBe('REQUEST_CHANGES')
    expect(d.canComment).toBe(false)
    expect(d.assignments.every((a) => a.status !== 'ACTIVE')).toBe(true)
  })

  it('AT-REVIEW-003.2 request changes без замечания и summary отклоняется (BR-029)', async () => {
    const w = await world()
    const t = await submittedStudentTest(services, w)
    await services.reviews.startReview.run(w.teacher.actor, { reviewId: t.reviewId }, ctx)
    expect(
      await codeOf(services.reviews.requestChanges.run(w.teacher.actor, { reviewId: t.reviewId, summary: ' ' }, ctx)),
    ).toBe('BR-029')
  })

  it('AT-REVIEW-003.3 approve с незаполненным обязательным checklist отклоняется (BR-028)', async () => {
    const w = await world()
    const t = await submittedStudentTest(services, w)
    await services.reviews.startReview.run(w.teacher.actor, { reviewId: t.reviewId }, ctx)
    await services.reviews.answerChecklist.run(
      w.teacher.actor,
      { reviewId: t.reviewId, code: 'KEYS', checked: true },
      ctx,
    )
    const e = await services.reviews.approve.run(w.teacher.actor, { reviewId: t.reviewId }, ctx).catch((x) => x)
    expect(e.ruleId).toBe('BR-028')
    expect(e.fieldErrors.length).toBe(7)
  })

  it('AT-REVIEW-003.4 approve при открытом BLOCKING замечании отклоняется (BR-028)', async () => {
    const w = await world()
    const t = await submittedStudentTest(services, w)
    await services.reviews.startReview.run(w.teacher.actor, { reviewId: t.reviewId }, ctx)
    await services.reviews.addComment.run(
      w.teacher.actor,
      { reviewId: t.reviewId, body: 'Ошибка в ключе', severity: 'BLOCKING' },
      ctx,
    )
    const e = await approveReview(services, w.teacher.actor, t.reviewId).catch((x) => x)
    expect(e.ruleId).toBe('BR-028')
    expect(e.message).toMatch(/блокирующее/)
  })

  it('AT-REVIEW-003.5 автор (включая Admin-автора, назначившего себя) не может approve / request changes (BR-001)', async () => {
    const w = await world()
    const t = await services.tests.createTest.run(admin, { courseId: w.courseId, title: 'Тест администратора' }, ctx)
    const bank = await approvedBankItem(services, w, admin)
    const sec = (await services.tests.getTest.run(admin, { id: t.testId }, ctx)).sections[0]!.id
    await services.tests.addItem.run(admin, { testId: t.testId, sectionId: sec, itemId: bank.itemId }, ctx)
    await services.tests.submitTest.run(admin, { testId: t.testId }, ctx)
    const reviewId = await reviewIdOf(services, t.testId)
    expect(await codeOf(services.reviews.assignReviewer.run(admin, { reviewId, reviewerId: admin.userId }, ctx))).toBe(
      'BR-027',
    )
    // даже при обходе назначения (прямая запись) решение автора отклоняется
    await sql`insert into review_assignments (review_id, reviewer_id, role) values (${reviewId}, ${admin.userId}, 'PRIMARY')`.execute(
      db,
    )
    expect(await codeOf(services.reviews.startReview.run(admin, { reviewId }, ctx))).toBe('BR-001')
    await sql`update review_assignments set status = 'REVOKED' where review_id = ${reviewId}`.execute(db)
    await services.reviews.assignReviewer.run(admin, { reviewId, reviewerId: expert.id }, ctx)
    await services.reviews.startReview.run(expert.actor, { reviewId }, ctx)
    await sql`insert into review_assignments (review_id, reviewer_id, role) values (${reviewId}, ${admin.userId}, 'ADVISORY')`.execute(
      db,
    )
    expect(await codeOf(services.reviews.approve.run(admin, { reviewId }, ctx))).toBe('BR-030')
    expect(await codeOf(services.reviews.requestChanges.run(admin, { reviewId, summary: 'x' }, ctx))).toBe('BR-030')
  })

  it('AT-REVIEW-003.6 approve переводит тест и каскадные вопросы в APPROVED и замораживает пулы (BR-012)', async () => {
    const w = await world()
    for (let i = 0; i < 3; i++) await approvedBankItem(services, w, admin)
    const t = await services.tests.createTest.run(w.teacher.actor, { courseId: w.courseId, title: 'Случайный' }, ctx)
    const d = await services.tests.getTest.run(w.teacher.actor, { id: t.testId }, ctx)
    const rule = await services.tests.addRule.run(
      w.teacher.actor,
      { testId: t.testId, sectionId: d.sections[0]!.id, count: 2, filter: { topicIds: [w.topicId] } },
      ctx,
    )
    const own = await services.items.createItem.run(
      w.teacher.actor,
      {
        courseId: w.courseId,
        questionTypeId: w.qt('single_choice'),
        document: choiceDoc(),
        meta: { topicIds: [w.subtopicId] },
      },
      ctx,
    )
    await services.tests.addItem.run(
      w.teacher.actor,
      { testId: t.testId, sectionId: d.sections[0]!.id, itemId: own.itemId },
      ctx,
    )
    await services.tests.submitTest.run(w.teacher.actor, { testId: t.testId }, ctx)
    const reviewId = await reviewIdOf(services, t.testId)
    await services.reviews.assignReviewer.run(admin, { reviewId, reviewerId: expert.id }, ctx)
    await approveReview(services, expert.actor, reviewId)
    expect(await testState(w.teacher.actor, t.testId, t.versionId)).toBe('APPROVED')
    expect(await itemState(own.itemId)).toBe('APPROVED')
    const item = await services.items.getItem.run(w.teacher.actor, { id: own.itemId }, ctx)
    expect(item.item.latestApprovedVersionId).toBe(own.versionId)
    const pool = await sql<{
      n: string
    }>`select count(*) as n from selection_pool_entries where selection_rule_id = ${rule.ruleId}`.execute(db)
    expect(Number(pool.rows[0]!.n)).toBe(3)
    expect(await auditActions(db, t.testId)).toContain('test.approved')
  })

  it('AT-REVIEW-003.7 approve с медиа не CLEARED отклоняется (BR-024)', async () => {
    const w = await world()
    const m1 = await uploadImage(services, w.teacher.actor, { title: 'Куинджи', cleared: true })
    const m2 = await uploadImage(services, w.teacher.actor, { title: 'Шишкин', cleared: true })
    const img = await services.items.createItem.run(
      w.student.actor,
      {
        assignmentId: w.assignmentId,
        questionTypeId: w.qt('image_choice'),
        document: {
          stem: 'Какая работа принадлежит Куинджи?',
          content: {},
          options: [
            { key: 'a', role: 'OPTION', mediaAssetId: m1, ordinal: 0 },
            { key: 'b', role: 'OPTION', mediaAssetId: m2, ordinal: 1 },
          ],
          answerKey: { correct: ['a'] },
        },
        meta: { topicIds: [w.subtopicId] },
      },
      ctx,
    )
    const other = await services.items.createItem.run(
      w.student.actor,
      {
        assignmentId: w.assignmentId,
        questionTypeId: w.qt('single_choice'),
        document: choiceDoc(),
        meta: { topicIds: [w.subtopicId] },
      },
      ctx,
    )
    const t = await services.tests.createTest.run(
      w.student.actor,
      { assignmentId: w.assignmentId, title: 'С изображениями' },
      ctx,
    )
    const sec = (await services.tests.getTest.run(w.student.actor, { id: t.testId }, ctx)).sections[0]!.id
    for (const it of [img, other])
      await services.tests.addItem.run(w.student.actor, { testId: t.testId, sectionId: sec, itemId: it.itemId }, ctx)
    await services.tests.submitTest.run(w.student.actor, { testId: t.testId }, ctx)
    const reviewId = await reviewIdOf(services, t.testId)
    // права отозваны после отправки
    const m = await services.media.getMedia.run(w.teacher.actor, { id: m1 }, ctx)
    await services.media.setRightsStatus.run(
      w.teacher.actor,
      { id: m1, status: 'RESTRICTED', note: 'правообладатель запретил', revision: m.revision },
      ctx,
    )
    const e = await approveReview(services, w.teacher.actor, reviewId).catch((x) => x)
    expect(e.ruleId).toBe('BR-024')
    expect(await testState(w.student.actor, t.testId, t.versionId)).toBe('IN_REVIEW')
  })

  it('AT-REVIEW-003.8 ADVISORY не может принять решение (BR-030)', async () => {
    const w = await world()
    const t = await submittedStudentTest(services, w)
    await services.reviews.assignReviewer.run(
      w.teacher.actor,
      { reviewId: t.reviewId, reviewerId: expert.id, role: 'ADVISORY' },
      ctx,
    )
    await services.reviews.startReview.run(w.teacher.actor, { reviewId: t.reviewId }, ctx)
    expect(await codeOf(services.reviews.approve.run(expert.actor, { reviewId: t.reviewId }, ctx))).toBe('BR-030')
    expect(
      await codeOf(services.reviews.requestChanges.run(expert.actor, { reviewId: t.reviewId, summary: 'x' }, ctx)),
    ).toBe('BR-030')
    expect(await codeOf(services.reviews.startReview.run(expert.actor, { reviewId: t.reviewId }, ctx))).toBe('BR-030')
  })

  it('AT-REVIEW-003.9 AT-PERM-002 студент не может approve (прямой запрос)', async () => {
    const w = await world()
    const t = await submittedStudentTest(services, w)
    await services.reviews.startReview.run(w.teacher.actor, { reviewId: t.reviewId }, ctx)
    expect(await codeOf(services.reviews.approve.run(w.student.actor, { reviewId: t.reviewId }, ctx))).toBe('FORBIDDEN')
    expect(await codeOf(services.tests.publishTest.run(w.student.actor, { testId: t.testId }, ctx))).toBe('FORBIDDEN')
  })

  it('отзыв отправки отменяет review (T4)', async () => {
    const w = await world()
    const t = await submittedStudentTest(services, w)
    await services.tests.recallTest.run(w.student.actor, { testId: t.testId }, ctx)
    const d = await services.reviews.getReview.run(w.teacher.actor, { id: t.reviewId }, ctx)
    expect(d.review.status).toBe('CANCELLED')
    expect(d.assignments.every((a) => a.status === 'REVOKED')).toBe(true)
  })

  it('шаблон checklist: новая версия применяется к новым Review, старые хранят свою', async () => {
    const w = await world()
    const t1 = await submittedStudentTest(services, w)
    expect(
      await codeOf(
        services.reviews.updateTemplate.run(w.teacher.actor, { appliesTo: 'TEST_VERSION', name: 'x', items: [] }, ctx),
      ),
    ).toBe('FORBIDDEN')
    const before = await services.reviews.listTemplates.run(admin, {}, ctx)
    const cur = before.find((x) => x.appliesTo === 'TEST_VERSION' && x.status === 'ACTIVE')!
    await services.reviews.updateTemplate.run(
      admin,
      {
        appliesTo: 'TEST_VERSION',
        name: cur.name,
        items: [...cur.items, { code: 'ACCESS', text: 'Доступность для незрячих', mandatory: true }],
      },
      ctx,
    )
    const t2 = await submittedStudentTest(services, w)
    const d1 = await services.reviews.getReview.run(admin, { id: t1.reviewId }, ctx)
    const d2 = await services.reviews.getReview.run(admin, { id: t2.reviewId }, ctx)
    expect(d1.template.items.map((i) => i.code)).not.toContain('ACCESS')
    expect(d2.template.items.map((i) => i.code)).toContain('ACCESS')
    // вернуть исходный шаблон для остальных тестов
    await services.reviews.updateTemplate.run(
      admin,
      { appliesTo: 'TEST_VERSION', name: cur.name, items: cur.items },
      ctx,
    )
  })
})
