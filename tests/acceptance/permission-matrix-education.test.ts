import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Actor } from '../../src/domain/authorization/actor.js'
import type { Db } from '../../src/infrastructure/db/kysely.js'
import type { Services } from '../../src/server/container.js'
import { freshDb } from '../support/db.js'
import { makeCourseWorld } from '../support/education.js'
import { ctx, makeUser, setupServices } from '../support/fixtures.js'

/** AT-PERM-MATRIX AT-AUTH-003.1 — permission-model §4.2 (учебная структура и задания). «Свой» курс — курс, где роль преподает/учится. */
type Role = 'STUDENT' | 'TEACHER' | 'EXPERT' | 'ADMIN'
const ROLES: Role[] = ['STUDENT', 'TEACHER', 'EXPERT', 'ADMIN']

let db: Db
let services: Services
let admin: Actor
let w: Awaited<ReturnType<typeof makeCourseWorld>>
const actor = {} as Record<Role, Actor>

beforeAll(async () => {
  db = await freshDb()
  ;({ services, admin } = await setupServices(db))
  w = await makeCourseWorld(services, admin)
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
const uniq = () => `${Date.now() % 100000}${++seq}`

const MATRIX: { cell: string; expect: Record<Role, boolean>; run: (a: Actor) => Promise<unknown> }[] = [
  {
    cell: 'Course / read (свой)',
    expect: { STUDENT: true, TEACHER: true, EXPERT: true, ADMIN: true },
    run: (a) => services.education.getCourse.run(a, { id: w.courseId }, ctx),
  },
  {
    cell: 'Subject, Course / manage',
    expect: { STUDENT: false, TEACHER: false, EXPERT: false, ADMIN: true },
    run: (a) =>
      services.education.createCourse.run(a, { subjectId: w.subjectId, code: `M${uniq()}`, name: 'Матрица' }, ctx),
  },
  {
    cell: 'Topic, Objective / manage (свой курс)',
    expect: { STUDENT: false, TEACHER: true, EXPERT: false, ADMIN: true },
    run: (a) => services.education.createTopic.run(a, { courseId: w.courseId, name: `Тема ${uniq()}` }, ctx),
  },
  {
    cell: 'Group / manage (свой курс)',
    expect: { STUDENT: false, TEACHER: true, EXPERT: false, ADMIN: true },
    run: (a) => services.education.createGroup.run(a, { courseId: w.courseId, name: `Группа ${uniq()}` }, ctx),
  },
  {
    cell: 'Assignment / read (адресовано / свой курс)',
    expect: { STUDENT: true, TEACHER: true, EXPERT: false, ADMIN: true },
    run: (a) => services.education.getAssignment.run(a, { id: w.assignmentId }, ctx),
  },
  {
    cell: 'Assignment / create (свой курс)',
    expect: { STUDENT: false, TEACHER: true, EXPERT: false, ADMIN: true },
    run: (a) => services.education.createAssignment.run(a, { courseId: w.courseId, title: `Задание ${uniq()}` }, ctx),
  },
  {
    cell: 'Assignment / extend (свой курс)',
    expect: { STUDENT: false, TEACHER: true, EXPERT: false, ADMIN: true },
    run: async (a) => {
      const x = await services.education.getAssignment.run(admin, { id: w.assignmentId }, ctx)
      return services.education.extendDeadline.run(
        a,
        {
          id: w.assignmentId,
          userId: w.student.id,
          newDeadlineAt: new Date(x.deadlineAt!.getTime() + 86400_000 * (1 + seq++)),
        },
        ctx,
      )
    },
  },
]

describe('AT-PERM-MATRIX AT-AUTH-003.1 permission-model §4.2 Educational Structure & Assignments', () => {
  for (const row of MATRIX) {
    for (const role of ROLES) {
      it(`${row.cell} — ${role}: ${row.expect[role] ? 'разрешено' : 'запрещено'}`, async () => {
        expect(await ok(row.run(actor[role]))).toBe(row.expect[role])
      })
    }
  }
})
