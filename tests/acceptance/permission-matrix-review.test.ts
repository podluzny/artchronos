import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Actor } from '../../src/domain/authorization/actor.js'
import type { Db } from '../../src/infrastructure/db/kysely.js'
import { createServices, type Services } from '../../src/server/container.js'
import { freshDb } from '../support/db.js'
import { makeCourseWorld } from '../support/education.js'
import { ctx, makeUser, setupServices } from '../support/fixtures.js'
import { tempStorage } from '../support/media.js'
import { allowManyTests, approveReview, submittedStudentTest, type World } from '../support/workflow.js'

/**
 * AT-PERM-MATRIX AT-AUTH-003.1 — permission-model §4.6 (Review) и строки §4.4/§4.5, зависящие от экспертизы:
 * Question / approve, Test / approve, publish, withdraw, archive.
 */
type Role = 'STUDENT' | 'TEACHER' | 'EXPERT' | 'ADMIN'
const ROLES: Role[] = ['STUDENT', 'TEACHER', 'EXPERT', 'ADMIN']

let db: Db
let services: Services
let admin: Actor
let w: World
const actor = {} as Record<Role, Actor>
const ids = {} as Record<Role, string>

beforeAll(async () => {
  db = await freshDb()
  ;({ admin } = await setupServices(db))
  services = createServices(db, { storage: tempStorage() })
  w = await makeCourseWorld(services, admin)
  await allowManyTests(db, w)
  const expert = await makeUser(services, admin, ['EXPERT'])
  Object.assign(actor, { STUDENT: w.student.actor, TEACHER: w.teacher.actor, EXPERT: expert.actor, ADMIN: admin })
  Object.assign(ids, { STUDENT: w.student.id, TEACHER: w.teacher.id, EXPERT: expert.id, ADMIN: admin.userId })
})
afterAll(async () => db.destroy())

const ok = (p: Promise<unknown>) =>
  p.then(
    () => true,
    (e) => {
      if (['FORBIDDEN', 'NOT_FOUND'].includes(e.code) || ['BR-027', 'BR-030', 'BR-001'].includes(e.ruleId)) return false
      throw e
    },
  )

async function fresh() {
  // лимит BR-033: прежние тесты матрицы уходят в архив
  await sql`update tests set status = 'ARCHIVED' where assignment_id = ${w.assignmentId}`.execute(db)
  return submittedStudentTest(services, w)
}

/** Назначает роль основным экспертом (там, где это допустимо BR-027), иначе оставляет преподавателя. */
async function asPrimary(role: Role, reviewId: string) {
  if (role === 'TEACHER' || role === 'STUDENT') return
  await services.reviews.assignReviewer.run(admin, { reviewId, reviewerId: ids[role], reason: 'матрица' }, ctx)
}

async function approved() {
  const t = await fresh()
  await approveReview(services, w.teacher.actor, t.reviewId)
  return t
}

const MATRIX: { cell: string; expect: Record<Role, boolean>; run: (a: Actor, role: Role) => Promise<unknown> }[] = [
  {
    cell: 'Review / read (экспертиза теста студента курса)',
    expect: { STUDENT: true, TEACHER: true, EXPERT: false, ADMIN: true },
    run: async (a) => services.reviews.getReview.run(a, { id: (await fresh()).reviewId }, ctx),
  },
  {
    cell: 'Review / assign reviewer',
    expect: { STUDENT: false, TEACHER: true, EXPERT: false, ADMIN: true },
    run: async (a, role) => {
      const t = await fresh()
      const other = await makeUser(services, admin, ['EXPERT'])
      return services.reviews.assignReviewer
        .run(a, { reviewId: t.reviewId, reviewerId: other.id, role: 'ADVISORY' }, ctx)
        .then(() => role)
    },
  },
  {
    cell: 'Review / perform (назначенный основным экспертом)',
    expect: { STUDENT: false, TEACHER: true, EXPERT: true, ADMIN: true },
    run: async (a, role) => {
      const t = await fresh()
      await asPrimary(role, t.reviewId)
      return services.reviews.startReview.run(a, { reviewId: t.reviewId }, ctx)
    },
  },
  {
    cell: 'Review / comment (свой контент или назначенная экспертиза)',
    expect: { STUDENT: true, TEACHER: true, EXPERT: false, ADMIN: false },
    run: async (a) =>
      services.reviews.addComment.run(a, { reviewId: (await fresh()).reviewId, body: 'Комментарий' }, ctx),
  },
  {
    cell: 'Checklist template / manage',
    expect: { STUDENT: false, TEACHER: false, EXPERT: false, ADMIN: true },
    run: async (a) => {
      const cur = (await services.reviews.listTemplates.run(admin, {}, ctx)).find(
        (x) => x.appliesTo === 'ITEM_VERSION' && x.status === 'ACTIVE',
      )!
      return services.reviews.updateTemplate.run(
        a,
        { appliesTo: 'ITEM_VERSION', name: cur.name, items: cur.items },
        ctx,
      )
    },
  },
  {
    cell: 'Test, Question / approve (назначенный основным экспертом, BR-001)',
    expect: { STUDENT: false, TEACHER: true, EXPERT: true, ADMIN: true },
    run: async (a, role) => {
      const t = await fresh()
      await asPrimary(role, t.reviewId)
      return approveReview(services, a, t.reviewId)
    },
  },
  {
    cell: 'Test / publish',
    expect: { STUDENT: false, TEACHER: false, EXPERT: false, ADMIN: true },
    run: async (a) => services.tests.publishTest.run(a, { testId: (await approved()).testId }, ctx),
  },
  {
    cell: 'Test / withdraw',
    expect: { STUDENT: false, TEACHER: false, EXPERT: false, ADMIN: true },
    run: async (a) => {
      const t = await approved()
      await services.tests.publishTest.run(admin, { testId: t.testId }, ctx)
      return services.tests.withdrawTest.run(a, { testId: t.testId, reason: 'матрица' }, ctx)
    },
  },
  {
    cell: 'Test / archive (тест студента, не опубликован)',
    expect: { STUDENT: true, TEACHER: false, EXPERT: false, ADMIN: true },
    run: async (a) => {
      const t = await approved()
      return services.tests.archiveTest.run(a, { testId: t.testId, reason: 'матрица' }, ctx)
    },
  },
]

describe('AT-PERM-MATRIX AT-AUTH-003.1 permission-model §4.6 Review, §4.4–4.5 approve/publish', () => {
  for (const row of MATRIX) {
    for (const role of ROLES) {
      it(`${row.cell} — ${role}: ${row.expect[role] ? 'разрешено' : 'запрещено'}`, async () => {
        expect(await ok(row.run(actor[role], role))).toBe(row.expect[role])
      })
    }
  }
})
