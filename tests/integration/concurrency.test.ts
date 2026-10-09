import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Actor } from '../../src/domain/authorization/actor.js'
import type { Db } from '../../src/infrastructure/db/kysely.js'
import { createServices, type Services } from '../../src/server/container.js'
import { freshDb } from '../support/db.js'
import { makeCourseWorld } from '../support/education.js'
import { ctx, makeUser, setupServices } from '../support/fixtures.js'
import { tempStorage } from '../support/media.js'
import {
  allowManyTests,
  approvedBankItem,
  approveReview,
  choiceDoc,
  reviewIdOf,
  studentItem,
  submittedStudentTest,
  type World,
} from '../support/workflow.js'

/** T-080: конкурентные изменения и решения (NFR-DATA-003, NFR-DATA-004). Два «пользователя» — два набора сервисов. */
let db: Db
let a: Services
let b: Services
let admin: Actor
let w: World

beforeAll(async () => {
  db = await freshDb()
  ;({ admin } = await setupServices(db))
  a = createServices(db, { storage: tempStorage() })
  b = createServices(db, { storage: tempStorage() })
  w = await makeCourseWorld(a, admin)
  await allowManyTests(db, w)
})
afterAll(async () => db.destroy())

const outcome = (p: Promise<unknown>) =>
  p.then(
    () => 'OK',
    (e) => (e.code === 'CONFLICT' ? 'CONFLICT' : (e.ruleId ?? e.code ?? String(e))),
  )

describe('NFR-DATA-003 конкурентные правки (optimistic lock)', () => {
  it('два сохранения черновика вопроса с одной revision: одно проходит, второе — CONFLICT, данные победителя целы', async () => {
    const it = await studentItem(a, w)
    const rev = (await a.items.getItem.run(w.student.actor, { id: it.itemId }, ctx)).version.revision
    const r = await Promise.all([
      outcome(
        a.items.saveDraft.run(
          w.student.actor,
          { itemId: it.itemId, document: choiceDoc('Версия A'), revision: rev },
          ctx,
        ),
      ),
      outcome(
        b.items.saveDraft.run(
          w.student.actor,
          { itemId: it.itemId, document: choiceDoc('Версия B'), revision: rev },
          ctx,
        ),
      ),
    ])
    expect(r.sort()).toEqual(['CONFLICT', 'OK'])
    const stem = (await a.items.getItem.run(w.student.actor, { id: it.itemId }, ctx)).version.document.stem
    expect(['Версия A', 'Версия B']).toContain(stem)
  })

  it('две правки настроек теста с одной revision: одна проходит, вторая — CONFLICT', async () => {
    const t = await a.tests.createTest.run(w.student.actor, { assignmentId: w.assignmentId, title: 'Гонка' }, ctx)
    const rev = (await a.tests.getTest.run(w.student.actor, { id: t.testId }, ctx)).version.revision
    const r = await Promise.all([
      outcome(
        a.tests.updateDraft.run(
          w.student.actor,
          { testId: t.testId, revision: rev, settings: { timeLimitSec: 600 } },
          ctx,
        ),
      ),
      outcome(
        b.tests.updateDraft.run(
          w.student.actor,
          { testId: t.testId, revision: rev, settings: { timeLimitSec: 1200 } },
          ctx,
        ),
      ),
    ])
    expect(r.sort()).toEqual(['CONFLICT', 'OK'])
  })
})

describe('NFR-DATA-004 конкурентные переходы состояний', () => {
  it('двойная отправка теста: ровно одна успешна, один Review, вопросы пакета согласованы', async () => {
    const i1 = await studentItem(a, w)
    const i2 = await studentItem(a, w)
    const t = await a.tests.createTest.run(
      w.student.actor,
      { assignmentId: w.assignmentId, title: 'Двойная отправка' },
      ctx,
    )
    const sec = (await a.tests.getTest.run(w.student.actor, { id: t.testId }, ctx)).sections[0]!.id
    for (const x of [i1, i2])
      await a.tests.addItem.run(w.student.actor, { testId: t.testId, sectionId: sec, itemId: x.itemId }, ctx)
    const r = await Promise.all([
      outcome(a.tests.submitTest.run(w.student.actor, { testId: t.testId }, ctx)),
      outcome(b.tests.submitTest.run(w.student.actor, { testId: t.testId }, ctx)),
    ])
    expect(r.filter((x) => x === 'OK')).toHaveLength(1)
    const reviews = await sql<{ n: string }>`select count(*) as n from reviews where test_id = ${t.testId}`.execute(db)
    expect(Number(reviews.rows[0]!.n)).toBe(1)
    const audit = await sql<{
      n: string
    }>`select count(*) as n from audit_log where resource_id = ${t.testId} and action = 'test.submitted'`.execute(db)
    expect(Number(audit.rows[0]!.n)).toBe(1)
  })

  it('одновременные «принять» и «вернуть на доработку»: побеждает одно решение, второе отклонено', async () => {
    const t = await submittedStudentTest(a, w)
    await a.reviews.startReview.run(w.teacher.actor, { reviewId: t.reviewId }, ctx)
    const d = await a.reviews.getReview.run(w.teacher.actor, { id: t.reviewId }, ctx)
    for (const c of d.template.items.filter((x) => x.mandatory))
      await a.reviews.answerChecklist.run(w.teacher.actor, { reviewId: t.reviewId, code: c.code, checked: true }, ctx)
    const r = await Promise.all([
      outcome(a.reviews.approve.run(w.teacher.actor, { reviewId: t.reviewId }, ctx)),
      outcome(b.reviews.requestChanges.run(w.teacher.actor, { reviewId: t.reviewId, summary: 'доработать' }, ctx)),
    ])
    expect(r.filter((x) => x === 'OK')).toHaveLength(1)
    expect(r.filter((x) => x !== 'OK')[0]).toMatch(/CONFLICT|BR-040|INVALID_TRANSITION/)
    const rv = await a.reviews.getReview.run(w.teacher.actor, { id: t.reviewId }, ctx)
    const state = (await a.tests.getTest.run(admin, { id: t.testId, versionId: t.versionId }, ctx)).version.state
    expect(rv.review.status === 'APPROVED' ? state === 'APPROVED' : state === 'CHANGES_REQUESTED').toBe(true)
    const items = await sql<{
      state: string
    }>`select state from item_versions where id in (${t.i1.versionId}, ${t.i2.versionId})`.execute(db)
    expect(new Set(items.rows.map((x) => x.state)).size).toBe(1)
    expect(items.rows[0]!.state).toBe(state)
  })

  it('одновременная публикация двух утвержденных версий: опубликована ровно одна (BR-009)', async () => {
    const expert = await makeUser(a, admin, ['EXPERT'])
    const bank = await approvedBankItem(a, w, admin)
    const t = await a.tests.createTest.run(w.teacher.actor, { courseId: w.courseId, title: 'Две версии' }, ctx)
    const sec = (await a.tests.getTest.run(w.teacher.actor, { id: t.testId }, ctx)).sections[0]!.id
    await a.tests.addItem.run(w.teacher.actor, { testId: t.testId, sectionId: sec, itemId: bank.itemId }, ctx)
    const approve = async () => {
      await a.tests.submitTest.run(w.teacher.actor, { testId: t.testId }, ctx)
      const reviewId = await reviewIdOf(a, t.testId)
      await a.reviews.assignReviewer.run(admin, { reviewId, reviewerId: expert.id }, ctx)
      await approveReview(a, expert.actor, reviewId)
    }
    await approve()
    const v2 = await a.tests.createNewVersion.run(w.teacher.actor, { testId: t.testId }, ctx)
    await approve()
    const r = await Promise.all([
      outcome(a.tests.publishTest.run(admin, { testId: t.testId, versionId: t.versionId }, ctx)),
      outcome(b.tests.publishTest.run(admin, { testId: t.testId, versionId: v2.versionId }, ctx)),
    ])
    expect(r).toContain('OK')
    const pub = await sql<{
      n: string
    }>`select count(*) as n from test_versions where test_id = ${t.testId} and state = 'PUBLISHED'`.execute(db)
    expect(Number(pub.rows[0]!.n)).toBe(1)
    const ptr = await sql<{ published_version_id: string; id: string }>`select t.published_version_id, v.id from tests t
      join test_versions v on v.test_id = t.id and v.state = 'PUBLISHED' where t.id = ${t.testId}`.execute(db)
    expect(ptr.rows[0]!.published_version_id).toBe(ptr.rows[0]!.id)
  })

  it('одновременное назначение двух основных экспертов: активен ровно один (BR-030)', async () => {
    const t = await submittedStudentTest(a, w)
    const e1 = await makeUser(a, admin, ['EXPERT'])
    const e2 = await makeUser(a, admin, ['EXPERT'])
    await Promise.all([
      outcome(a.reviews.assignReviewer.run(admin, { reviewId: t.reviewId, reviewerId: e1.id, reason: 'гонка 1' }, ctx)),
      outcome(b.reviews.assignReviewer.run(admin, { reviewId: t.reviewId, reviewerId: e2.id, reason: 'гонка 2' }, ctx)),
    ])
    const n = await sql<{ n: string }>`select count(*) as n from review_assignments
      where review_id = ${t.reviewId} and role = 'PRIMARY' and status = 'ACTIVE'`.execute(db)
    expect(Number(n.rows[0]!.n)).toBe(1)
  })
})
