import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Actor } from '../../src/domain/authorization/actor.js'
import type { Db } from '../../src/infrastructure/db/kysely.js'
import { createServices, type Services } from '../../src/server/container.js'
import { freshDb } from '../support/db.js'
import { makeCourseWorld } from '../support/education.js'
import { auditActions, ctx, makeUser, setupServices } from '../support/fixtures.js'
import { RESPONSES, validDoc } from '../support/item-docs.js'
import { tempStorage, uploadImage } from '../support/media.js'
import { approvedBankItem, approveReview, reviewIdOf, type World } from '../support/workflow.js'

let db: Db
let services: Services
let admin: Actor
let expert: { id: string; actor: Actor }
let w: World
let bankItemId: string

beforeAll(async () => {
  db = await freshDb()
  ;({ admin } = await setupServices(db))
  services = createServices(db, { storage: tempStorage() })
  expert = await makeUser(services, admin, ['EXPERT'])
  w = await makeCourseWorld(services, admin)
  bankItemId = (await approvedBankItem(services, w, admin)).itemId
})
afterAll(async () => db.destroy())

const codeOf = (p: Promise<unknown>) =>
  p.then(
    () => 'OK',
    (e) => e.ruleId ?? e.code,
  )

/** Тест преподавателя с утвержденным вопросом банка, доведенный до нужного состояния. */
async function teacherTest(stage: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'PUBLISHED' | 'ARCHIVED') {
  const t = await services.tests.createTest.run(w.teacher.actor, { courseId: w.courseId, title: `Тест ${stage}` }, ctx)
  const sec = (await services.tests.getTest.run(w.teacher.actor, { id: t.testId }, ctx)).sections[0]!.id
  await services.tests.addItem.run(w.teacher.actor, { testId: t.testId, sectionId: sec, itemId: bankItemId }, ctx)
  if (stage === 'ARCHIVED') {
    await services.tests.archiveTest.run(w.teacher.actor, { testId: t.testId, reason: 'не нужен' }, ctx)
    return t
  }
  if (stage === 'DRAFT') return t
  await services.tests.submitTest.run(w.teacher.actor, { testId: t.testId }, ctx)
  if (stage === 'SUBMITTED') return t
  const reviewId = await reviewIdOf(services, t.testId)
  await services.reviews.assignReviewer.run(admin, { reviewId, reviewerId: expert.id }, ctx)
  await approveReview(services, expert.actor, reviewId)
  if (stage === 'APPROVED') return t
  await services.tests.publishTest.run(admin, { testId: t.testId }, ctx)
  return t
}

const state = async (testId: string, versionId: string) =>
  (await services.tests.getTest.run(admin, { id: testId, versionId }, ctx)).version.state

describe('SPEC-PUB-001 Жизненный цикл версий', () => {
  it('AT-PUB-001.3 прямой UPDATE содержимого APPROVED версии отклоняется триггером', async () => {
    const t = await teacherTest('APPROVED')
    await expect(sql`update test_versions set title = 'взлом' where id = ${t.versionId}`.execute(db)).rejects.toThrow(
      /frozen/,
    )
    const item = await services.items.getItem.run(admin, { id: bankItemId }, ctx)
    await expect(
      sql`update item_versions set stem = 'взлом' where id = ${item.version.id}`.execute(db),
    ).rejects.toThrow(/frozen/)
    await expect(
      sql`delete from test_section_items where test_version_id = ${t.versionId}`.execute(db),
    ).rejects.toThrow(/frozen/)
  })

  it('AT-PUB-001.4 Admin не может выполнить запрещенный переход (DRAFT → APPROVED)', async () => {
    const t = await teacherTest('DRAFT')
    expect(await codeOf(services.tests.publishTest.run(admin, { testId: t.testId, versionId: t.versionId }, ctx))).toBe(
      'BR-008',
    )
    await expect(
      sql`update test_versions set state = 'APPROVED' where id = ${t.versionId}`.execute(db),
    ).rejects.toThrow(/BR-013/)
    await expect(
      sql`update test_versions set state = 'PUBLISHED' where id = ${t.versionId}`.execute(db),
    ).rejects.toThrow(/BR-013/)
    const s = await teacherTest('SUBMITTED')
    const reviewId = await reviewIdOf(services, s.testId)
    await services.reviews.assignReviewer.run(admin, { reviewId, reviewerId: expert.id }, ctx)
    // решение до начала экспертизы — запрещенный переход READY_FOR_REVIEW → APPROVED
    expect(await codeOf(services.reviews.approve.run(expert.actor, { reviewId }, ctx))).toBe('INVALID_TRANSITION')
    await expect(
      sql`update test_versions set state = 'APPROVED' where id = ${s.versionId}`.execute(db),
    ).rejects.toThrow(/BR-013/)
  })

  describe('AT-PUB-001.5 availableActions совпадает с множеством переходов, разрешенных сервером', () => {
    const run: Record<string, (a: Actor, testId: string) => Promise<unknown>> = {
      edit: (a, testId) => services.tests.addSection.run(a, { testId, title: 'Новый' }, ctx),
      submit: (a, testId) => services.tests.submitTest.run(a, { testId }, ctx),
      recall: (a, testId) => services.tests.recallTest.run(a, { testId }, ctx),
      newVersion: (a, testId) => services.tests.createNewVersion.run(a, { testId }, ctx),
      publish: (a, testId) => services.tests.publishTest.run(a, { testId }, ctx),
      withdraw: (a, testId) => services.tests.withdrawTest.run(a, { testId, reason: 'проверка' }, ctx),
      archive: (a, testId) => services.tests.archiveTest.run(a, { testId, reason: 'проверка' }, ctx),
      restore: (a, testId) => services.tests.restoreTest.run(a, { testId }, ctx),
    }
    for (const stage of ['DRAFT', 'SUBMITTED', 'APPROVED', 'PUBLISHED', 'ARCHIVED'] as const) {
      for (const who of ['TEACHER', 'ADMIN'] as const) {
        it(`${stage} — ${who}`, { timeout: 120000 }, async () => {
          const actor = () => (who === 'TEACHER' ? w.teacher.actor : admin)
          for (const action of Object.keys(run)) {
            const t = await teacherTest(stage)
            const available = (await services.tests.getTest.run(actor(), { id: t.testId }, ctx)).availableActions
            const result = await codeOf(run[action]!(actor(), t.testId))
            expect(`${action}: ${result === 'OK'}`).toBe(`${action}: ${available.includes(action as never)}`)
          }
        })
      }
    }
  })
})

describe('SPEC-PUB-002 Публикация, отзыв, архив', () => {
  it('AT-PUB-002.1 Admin публикует APPROVED версию', async () => {
    const t = await teacherTest('APPROVED')
    await services.tests.publishTest.run(admin, { testId: t.testId }, ctx)
    const d = await services.tests.getTest.run(admin, { id: t.testId }, ctx)
    expect(d.version.state).toBe('PUBLISHED')
    expect(d.test.publishedVersionId).toBe(t.versionId)
    expect(await auditActions(db, t.testId)).toContain('test.published')
  })

  it('AT-PUB-002.2 публикация не-APPROVED версии отклоняется (BR-008)', async () => {
    const t = await teacherTest('SUBMITTED')
    expect(await codeOf(services.tests.publishTest.run(admin, { testId: t.testId, versionId: t.versionId }, ctx))).toBe(
      'BR-008',
    )
  })

  it('AT-PUB-002.3 публикация новой версии архивирует предыдущую (SUPERSEDED); ≤ 1 PUBLISHED', async () => {
    const t = await teacherTest('PUBLISHED')
    const v2 = await services.tests.createNewVersion.run(w.teacher.actor, { testId: t.testId }, ctx)
    await services.tests.submitTest.run(w.teacher.actor, { testId: t.testId }, ctx)
    const reviewId = await reviewIdOf(services, t.testId)
    await services.reviews.assignReviewer.run(admin, { reviewId, reviewerId: expert.id }, ctx)
    await approveReview(services, expert.actor, reviewId)
    const r = await services.tests.publishTest.run(admin, { testId: t.testId }, ctx)
    expect(r.superseded).toBe(t.versionId)
    expect(await state(t.testId, t.versionId)).toBe('ARCHIVED')
    expect(await state(t.testId, v2.versionId)).toBe('PUBLISHED')
    const n = await sql<{
      n: string
    }>`select count(*) as n from test_versions where test_id = ${t.testId} and state = 'PUBLISHED'`.execute(db)
    expect(Number(n.rows[0]!.n)).toBe(1)
    const hist = await services.tests.publicationHistory.run(admin, { testId: t.testId }, ctx)
    expect(hist.map((h) => `${h.versionNo}:${h.archiveReason ?? ''}`)).toEqual(['1:SUPERSEDED', '2:'])
    await expect(
      sql`update test_versions set state = 'PUBLISHED' where id = ${t.versionId}`.execute(db),
    ).rejects.toThrow(/BR-013/)
  })

  it('AT-PUB-002.4 withdraw без причины отклоняется; с причиной — версия ARCHIVED (WITHDRAWN)', async () => {
    const t = await teacherTest('PUBLISHED')
    expect(await codeOf(services.tests.withdrawTest.run(admin, { testId: t.testId, reason: '' }, ctx))).toBe('BR-036')
    await services.tests.withdrawTest.run(admin, { testId: t.testId, reason: 'ошибка в ключе' }, ctx)
    const d = await services.tests.getTest.run(admin, { id: t.testId, versionId: t.versionId }, ctx)
    expect(d.version.state).toBe('ARCHIVED')
    expect(d.version.archiveReason).toBe('WITHDRAWN')
    expect(d.test.publishedVersionId).toBeNull()
  })

  it('AT-PUB-002.5 Teacher/Student не могут публиковать (прямой запрос)', async () => {
    const t = await teacherTest('APPROVED')
    expect(await codeOf(services.tests.publishTest.run(w.teacher.actor, { testId: t.testId }, ctx))).toBe('FORBIDDEN')
    expect(await codeOf(services.tests.publishTest.run(w.student.actor, { testId: t.testId }, ctx))).toBe('FORBIDDEN')
    expect(await codeOf(services.tests.withdrawTest.run(w.teacher.actor, { testId: t.testId, reason: 'x' }, ctx))).toBe(
      'FORBIDDEN',
    )
  })

  it('AT-PUB-002.6 физическое удаление опубликованной/архивированной версии невозможно', async () => {
    const t = await teacherTest('PUBLISHED')
    await expect(sql`delete from test_versions where id = ${t.versionId}`.execute(db)).rejects.toThrow(
      /cannot be deleted/,
    )
    await services.tests.withdrawTest.run(admin, { testId: t.testId, reason: 'устарел' }, ctx)
    await expect(sql`delete from test_versions where id = ${t.versionId}`.execute(db)).rejects.toThrow(
      /cannot be deleted/,
    )
    await expect(sql`delete from tests where id = ${t.testId}`.execute(db)).rejects.toThrow()
  })

  it('AT-PUB-002.7 архив теста с PUBLISHED версией отклоняется', async () => {
    const t = await teacherTest('PUBLISHED')
    expect(await codeOf(services.tests.archiveTest.run(admin, { testId: t.testId, reason: 'x' }, ctx))).toBe(
      'INVALID_STATE',
    )
    await services.tests.withdrawTest.run(admin, { testId: t.testId, reason: 'устарел' }, ctx)
    await services.tests.archiveTest.run(w.teacher.actor, { testId: t.testId, reason: 'устарел' }, ctx)
    expect((await services.tests.getTest.run(admin, { id: t.testId }, ctx)).test.status).toBe('ARCHIVED')
    await services.tests.restoreTest.run(w.teacher.actor, { testId: t.testId }, ctx)
  })
})

describe('SPEC-DELIV-001 Модель прохождения (прототип без UI)', () => {
  const CODES = [
    'single_choice',
    'multiple_choice',
    'true_false',
    'image_choice',
    'attribution',
    'matching',
    'chronology',
    'short_answer',
    'essay',
  ]
  let testId: string
  let versionId: string
  const codeByVersion = new Map<string, string>()
  let student: { id: string; actor: Actor }

  beforeAll(async () => {
    student = await makeUser(services, admin, ['STUDENT'])
    const m1 = await uploadImage(services, w.teacher.actor, { title: 'Куинджи', cleared: true })
    const m2 = await uploadImage(services, w.teacher.actor, { title: 'Шишкин', cleared: true })
    const types = await services.qtypes.listQuestionTypesFull.run(admin, { filters: {}, limit: 50, offset: 0 }, ctx)
    const t = await services.tests.createTest.run(w.teacher.actor, { courseId: w.courseId, title: 'Все типы MVP' }, ctx)
    testId = t.testId
    versionId = t.versionId
    let d = await services.tests.getTest.run(w.teacher.actor, { id: testId }, ctx)
    const sec = d.sections[0]!.id
    for (const code of CODES) {
      const doc = JSON.parse(JSON.stringify(validDoc(code)).replaceAll('"m1"', `"${m1}"`).replaceAll('"m2"', `"${m2}"`))
      const qt = types.records.find((x) => x.code === code)!
      const r = await services.items.createItem.run(
        w.teacher.actor,
        { courseId: w.courseId, questionTypeId: qt.id, document: doc, meta: { topicIds: [w.subtopicId] } },
        ctx,
      )
      expect(
        (await services.items.getItem.run(w.teacher.actor, { id: r.itemId }, ctx)).issues.filter(
          (i) => i.severity === 'ERROR',
        ),
      ).toEqual([])
      await services.tests.addItem.run(w.teacher.actor, { testId, sectionId: sec, itemId: r.itemId }, ctx)
      codeByVersion.set(r.versionId, code)
    }
    for (let i = 0; i < 3; i++) await approvedBankItem(services, w, admin, { topicId: w.topicId })
    const s2 = await services.tests.addSection.run(w.teacher.actor, { testId, title: 'Случайные' }, ctx)
    await services.tests.addRule.run(
      w.teacher.actor,
      { testId, sectionId: s2.sectionId, count: 2, pointsPerItem: 2, filter: { topicIds: [w.topicId] } },
      ctx,
    )
    d = await services.tests.getTest.run(w.teacher.actor, { id: testId }, ctx)
    await services.tests.updateDraft.run(
      w.teacher.actor,
      { testId, revision: d.version.revision, settings: { maxAttempts: null, shuffleItems: true, passingScore: 5 } },
      ctx,
    )
    // до публикации попытка невозможна (AC-DELIV-001.2)
    await services.tests.submitTest.run(w.teacher.actor, { testId }, ctx)
    const reviewId = await reviewIdOf(services, testId)
    await services.reviews.assignReviewer.run(admin, { reviewId, reviewerId: expert.id }, ctx)
    await approveReview(services, expert.actor, reviewId)
  })

  it('AT-DELIV-001.2 Attempt по не-PUBLISHED версии невозможен', async () => {
    expect(
      await codeOf(services.delivery.startAttempt({ userId: student.id, testVersionId: versionId, seed: 1 })),
    ).toBe('BR-037')
    await expect(
      sql`insert into attempts (test_version_id, user_id, attempt_no, seed, delivered_items) values (${versionId}, ${student.id}, 1, 1, '[]')`.execute(
        db,
      ),
    ).rejects.toThrow(/BR-037/)
    await services.tests.publishTest.run(admin, { testId }, ctx)
  })

  it('AT-DELIV-001.1 прототип создает Attempt по PUBLISHED версии, отвечает на все MVP-типы и получает Result', async () => {
    const a = await services.delivery.startAttempt({ userId: student.id, testVersionId: versionId, seed: 42 })
    expect(a.items).toHaveLength(CODES.length + 2)
    for (const it of a.items) {
      const code = codeByVersion.get(it.itemVersionId) ?? 'single_choice'
      await services.delivery.answer({
        attemptId: a.attemptId,
        itemVersionId: it.itemVersionId,
        payload: RESPONSES[code]!.right,
      })
    }
    await expect(
      services.delivery.answer({
        attemptId: a.attemptId,
        itemVersionId: a.items[0]!.itemVersionId,
        payload: { foo: 1 },
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' })
    const r = await services.delivery.submit(a.attemptId)
    // 8 автоматически оцениваемых вопросов × 1 + 2 случайных × 2; эссе ждет ручной оценки
    expect(r).toMatchObject({ score: 12, maxScore: 13, pendingManual: 1, passed: null })
    const evals = await sql<{ method: string; n: string }>`select e.method, count(*) as n from response_evaluations e
      join responses rs on rs.id = e.response_id where rs.attempt_id = ${a.attemptId} group by e.method order by e.method`.execute(
      db,
    )
    expect(evals.rows.map((x) => `${x.method}:${x.n}`)).toEqual(['AUTO:10', 'MANUAL:1'])
  })

  it('AT-DELIV-001.3 одинаковый seed дает одинаковую выборку', async () => {
    const a = await services.delivery.startAttempt({ userId: student.id, testVersionId: versionId, seed: 7 })
    const b = await services.delivery.startAttempt({ userId: student.id, testVersionId: versionId, seed: 7 })
    const order = (x: typeof a) => x.items.map((i) => `${i.itemVersionId}:${i.options.map((o) => o.key).join('')}`)
    expect(order(b)).toEqual(order(a))
    const seeds = new Set<string>()
    for (const seed of [1, 2, 3, 4, 5])
      seeds.add(
        order(await services.delivery.startAttempt({ userId: student.id, testVersionId: versionId, seed })).join(),
      )
    expect(seeds.size).toBeGreaterThan(1)
  })

  it('AT-DELIV-001.4 delivery-сериализатор не содержит answerKey', async () => {
    const a = await services.delivery.startAttempt({ userId: student.id, testVersionId: versionId, seed: 3 })
    const json = JSON.stringify(a.items)
    expect(json).not.toMatch(/answerKey|"correct"|"accepted"|"pairs"|"order"|feedback|rubric/)
    expect(a.items.every((i) => !('answerKey' in i))).toBe(true)
  })

  it('AT-DELIV-001.5 withdraw версии не изменяет существующие Attempt/Result', async () => {
    const snapshot = async () =>
      (
        await sql<any>`select a.id, a.test_version_id, a.status, a.delivered_items, r.score, r.max_score from attempts a
          left join results r on r.attempt_id = a.id where a.test_version_id = ${versionId} order by a.id`.execute(db)
      ).rows
    const before = await snapshot()
    expect(before.length).toBeGreaterThan(0)
    await services.tests.withdrawTest.run(admin, { testId, reason: 'конец семестра' }, ctx)
    expect(await snapshot()).toEqual(before)
    expect(
      await codeOf(services.delivery.startAttempt({ userId: student.id, testVersionId: versionId, seed: 9 })),
    ).toBe('BR-037')
    await expect(
      sql`update attempts set test_version_id = test_version_id, delivered_items = '[]' where test_version_id = ${versionId}`.execute(
        db,
      ),
    ).rejects.toThrow(/BR-037/)
  })
})
