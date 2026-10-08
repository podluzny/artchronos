import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Actor } from '../../src/domain/authorization/actor.js'
import type { Db } from '../../src/infrastructure/db/kysely.js'
import { createServices, type Services } from '../../src/server/container.js'
import { freshDb } from '../support/db.js'
import { makeCourseWorld } from '../support/education.js'
import { ctx, makeUser, setupServices } from '../support/fixtures.js'
import { tempStorage } from '../support/media.js'

/** AT-PERM-MATRIX AT-AUTH-003.1 — permission-model §4.5 (Test Authoring). Approve/publish/archive — M5. */
type Role = 'STUDENT' | 'TEACHER' | 'EXPERT' | 'ADMIN'
const ROLES: Role[] = ['STUDENT', 'TEACHER', 'EXPERT', 'ADMIN']

let db: Db
let services: Services
let admin: Actor
let w: Awaited<ReturnType<typeof makeCourseWorld>>
const actor = {} as Record<Role, Actor>

beforeAll(async () => {
  db = await freshDb()
  ;({ admin } = await setupServices(db))
  services = createServices(db, { storage: tempStorage() })
  w = await makeCourseWorld(services, admin)
  await sql`update assignments set max_tests_per_student = 10 where id = ${w.assignmentId}`.execute(db)
  actor.STUDENT = w.student.actor
  actor.TEACHER = w.teacher.actor
  actor.EXPERT = (await makeUser(services, admin, ['EXPERT'])).actor
  actor.ADMIN = admin
})
afterAll(async () => db.destroy())

const ok = (p: Promise<unknown>) =>
  p.then(
    () => true,
    (e) => {
      if (['FORBIDDEN', 'NOT_FOUND'].includes(e.code)) return false
      throw e
    },
  )

let seq = 0
async function studentTest(items = 2) {
  // лимит BR-033 (≤ 10 тестов на студента): прежние тесты матрицы уходят в архив
  await sql`update tests set status = 'ARCHIVED' where assignment_id = ${w.assignmentId}`.execute(db)
  const t = await services.tests.createTest.run(
    w.student.actor,
    { assignmentId: w.assignmentId, title: `Тест ${++seq}` },
    ctx,
  )
  const d = await services.tests.getTest.run(w.student.actor, { id: t.testId }, ctx)
  for (let i = 0; i < items; i++) {
    const it = await services.items.createItem.run(
      w.student.actor,
      {
        assignmentId: w.assignmentId,
        questionTypeId: w.qt('single_choice'),
        document: {
          stem: `Вопрос ${seq}.${i}`,
          content: {},
          options: [
            { key: 'a', role: 'OPTION', text: 'Да', ordinal: 0 },
            { key: 'b', role: 'OPTION', text: 'Нет', ordinal: 1 },
          ],
          answerKey: { correct: ['a'] },
        },
        meta: { topicIds: [w.subtopicId] },
      },
      ctx,
    )
    await services.tests.addItem.run(
      w.student.actor,
      { testId: t.testId, sectionId: d.sections[0]!.id, itemId: it.itemId },
      ctx,
    )
  }
  return { ...t, sectionId: d.sections[0]!.id }
}

async function ownTest(a: Actor) {
  return a === actor.STUDENT
    ? studentTest(0)
    : services.tests.createTest.run(a, { courseId: w.courseId, title: `Свой ${++seq}` }, ctx)
}

const MATRIX: { cell: string; expect: Record<Role, boolean>; run: (a: Actor) => Promise<unknown> }[] = [
  {
    cell: 'Test / create',
    expect: { STUDENT: true, TEACHER: true, EXPERT: false, ADMIN: true },
    run: (a) =>
      a === actor.STUDENT
        ? services.tests.createTest.run(a, { assignmentId: w.assignmentId, title: 'Матрица' }, ctx)
        : services.tests.createTest.run(a, { courseId: w.courseId, title: 'Матрица' }, ctx),
  },
  {
    cell: 'Test / read (тест студента курса)',
    expect: { STUDENT: true, TEACHER: true, EXPERT: false, ADMIN: true },
    run: async (a) => services.tests.getTest.run(a, { id: (await studentTest(0)).testId }, ctx),
  },
  {
    cell: 'Test / update (черновик студента)',
    expect: { STUDENT: true, TEACHER: false, EXPERT: false, ADMIN: true },
    run: async (a) => services.tests.addSection.run(a, { testId: (await studentTest(0)).testId, title: 'Новый' }, ctx),
  },
  {
    cell: 'Test / random selection (свой тест)',
    expect: { STUDENT: false, TEACHER: true, EXPERT: false, ADMIN: true },
    run: async (a) => {
      if (a === actor.EXPERT)
        return services.tests.poolSize.run(a, { testId: (await studentTest(0)).testId, filter: {} }, ctx)
      const t = await ownTest(a)
      const d = await services.tests.getTest.run(a, { id: t.testId }, ctx)
      return services.tests.addRule.run(
        a,
        { testId: t.testId, sectionId: d.sections[0]!.id, count: 1, filter: { topicIds: [w.topicId] } },
        ctx,
      )
    },
  },
  {
    cell: 'Test / submit (тест студента)',
    expect: { STUDENT: true, TEACHER: false, EXPERT: false, ADMIN: false },
    run: async (a) => services.tests.submitTest.run(a, { testId: (await studentTest(2)).testId }, ctx),
  },
  {
    cell: 'Test / recall (тест студента)',
    expect: { STUDENT: true, TEACHER: false, EXPERT: false, ADMIN: false },
    run: async (a) => {
      const t = await studentTest(2)
      await services.tests.submitTest.run(w.student.actor, { testId: t.testId }, ctx)
      return services.tests.recallTest.run(a, { testId: t.testId }, ctx)
    },
  },
]

describe('AT-PERM-MATRIX AT-AUTH-003.1 permission-model §4.5 Test Authoring', () => {
  for (const row of MATRIX) {
    for (const role of ROLES) {
      it(`${row.cell} — ${role}: ${row.expect[role] ? 'разрешено' : 'запрещено'}`, async () => {
        expect(await ok(row.run(actor[role]))).toBe(row.expect[role])
      })
    }
  }
})
