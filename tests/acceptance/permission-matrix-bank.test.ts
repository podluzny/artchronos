import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Actor } from '../../src/domain/authorization/actor.js'
import type { Db } from '../../src/infrastructure/db/kysely.js'
import { createServices, type Services } from '../../src/server/container.js'
import { freshDb } from '../support/db.js'
import { makeCourseWorld } from '../support/education.js'
import { ctx, makeUser, setupServices } from '../support/fixtures.js'
import { tempStorage, uploadImage } from '../support/media.js'

/** AT-PERM-MATRIX AT-AUTH-003.1 — permission-model §4.3 (медиа, типы вопросов) и §4.4 (банк вопросов). Approve — M5. */
type Role = 'STUDENT' | 'TEACHER' | 'EXPERT' | 'ADMIN'
const ROLES: Role[] = ['STUDENT', 'TEACHER', 'EXPERT', 'ADMIN']

let db: Db
let services: Services
let admin: Actor
let w: Awaited<ReturnType<typeof makeCourseWorld>>
let other: Awaited<ReturnType<typeof makeCourseWorld>>
const actor = {} as Record<Role, Actor>

beforeAll(async () => {
  db = await freshDb()
  ;({ admin } = await setupServices(db))
  services = createServices(db, { storage: tempStorage() })
  w = await makeCourseWorld(services, admin)
  other = await makeCourseWorld(services, admin)
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

const doc = () => ({
  stem: `Кто автор «Грачи прилетели»? ${uniq()}`,
  content: { shuffleOptions: true },
  options: [
    { key: 'o1', role: 'OPTION', text: 'Саврасов', ordinal: 0 },
    { key: 'o2', role: 'OPTION', text: 'Шишкин', ordinal: 1 },
    { key: 'o3', role: 'OPTION', text: 'Левитан', ordinal: 2 },
  ],
  media: [],
  answerKey: { correct: ['o1'] },
})

async function studentItem(world = w) {
  return services.items.createItem.run(
    world.student.actor,
    {
      assignmentId: world.assignmentId,
      questionTypeId: world.qt('single_choice'),
      document: doc(),
      meta: { topicIds: [world.subtopicId], difficulty: 2 },
    },
    ctx,
  )
}

async function bankItem(a: Actor) {
  return services.items.createItem.run(
    a,
    {
      courseId: w.courseId,
      questionTypeId: w.qt('single_choice'),
      document: doc(),
      meta: { topicIds: [w.subtopicId], difficulty: 2 },
    },
    ctx,
  )
}

const MATRIX: { cell: string; expect: Record<Role, boolean>; run: (a: Actor) => Promise<unknown> }[] = [
  // §4.3 Media & Question Types
  {
    cell: 'Media / read',
    expect: { STUDENT: true, TEACHER: true, EXPERT: true, ADMIN: true },
    run: async (a) => services.media.getMedia.run(a, { id: await uploadImage(services, admin) }, ctx),
  },
  {
    cell: 'Media / upload',
    expect: { STUDENT: true, TEACHER: true, EXPERT: false, ADMIN: true },
    run: (a) => uploadImage(services, a, { title: `Загрузка ${uniq()}` }),
  },
  {
    cell: 'Media / update metadata (чужое)',
    expect: { STUDENT: false, TEACHER: true, EXPERT: false, ADMIN: true },
    run: async (a) => {
      const id = await uploadImage(services, admin)
      const m = await services.media.getMedia.run(admin, { id }, ctx)
      return services.media.updateMediaMetadata.run(a, { id, metadata: { title: 'Новое' }, revision: m.revision }, ctx)
    },
  },
  {
    cell: 'Media / archive (чужое)',
    expect: { STUDENT: false, TEACHER: false, EXPERT: false, ADMIN: true },
    run: async (a) =>
      services.media.archiveMedia.run(a, { id: await uploadImage(services, admin), reason: 'матрица' }, ctx),
  },
  {
    cell: 'Media / rights manage',
    expect: { STUDENT: false, TEACHER: true, EXPERT: false, ADMIN: true },
    run: async (a) => {
      const id = await uploadImage(services, admin)
      const m = await services.media.getMedia.run(admin, { id }, ctx)
      return services.media.setRightsStatus.run(a, { id, status: 'CLEARED', revision: m.revision }, ctx)
    },
  },
  {
    cell: 'QuestionType / read',
    expect: { STUDENT: true, TEACHER: true, EXPERT: true, ADMIN: true },
    run: (a) => services.qtypes.getQuestionType.run(a, { id: w.qt('single_choice') }, ctx),
  },
  {
    cell: 'QuestionType / manage',
    expect: { STUDENT: false, TEACHER: false, EXPERT: false, ADMIN: true },
    run: (a) =>
      services.qtypes.createQuestionType.run(
        a,
        {
          code: `matrix_${uniq()}`,
          name: 'Матрица',
          interactionKey: 'choice',
          config: { cardinality: 'single', minOptions: 2, maxOptions: 6, optionMedia: 'none', stimulus: 'none' },
          evaluation: { method: 'exact' },
        },
        ctx,
      ),
  },
  // §4.4 Item Bank
  {
    cell: 'Question / create (студент — в задании, остальные — в банк курса)',
    expect: { STUDENT: true, TEACHER: true, EXPERT: false, ADMIN: true },
    run: (a) => (a === actor.STUDENT ? studentItem() : bankItem(a)),
  },
  {
    cell: 'Question / read (вопрос студента курса)',
    expect: { STUDENT: true, TEACHER: true, EXPERT: false, ADMIN: true },
    run: async (a) => services.items.getItem.run(a, { id: (await studentItem()).itemId }, ctx),
  },
  {
    cell: 'Question / read (вопрос чужого курса)',
    expect: { STUDENT: false, TEACHER: false, EXPERT: false, ADMIN: true },
    run: async (a) => services.items.getItem.run(a, { id: (await studentItem(other)).itemId }, ctx),
  },
  {
    cell: 'Question / update (черновик студента)',
    expect: { STUDENT: true, TEACHER: false, EXPERT: false, ADMIN: true },
    run: async (a) => {
      const { itemId } = await studentItem()
      const d = await services.items.getItem.run(admin, { id: itemId }, ctx)
      return services.items.saveDraft.run(a, { itemId, document: doc(), revision: d.version.revision }, ctx)
    },
  },
  {
    cell: 'Question / submit (вопрос банка преподавателя)',
    expect: { STUDENT: false, TEACHER: true, EXPERT: false, ADMIN: false },
    run: async (a) => services.items.submitItem.run(a, { itemId: (await bankItem(actor.TEACHER)).itemId }, ctx),
  },
  {
    cell: 'Question / archive (вопрос студента)',
    expect: { STUDENT: true, TEACHER: false, EXPERT: false, ADMIN: true },
    run: async (a) =>
      services.items.archiveItem.run(a, { itemId: (await studentItem()).itemId, reason: 'матрица' }, ctx),
  },
]

describe('AT-PERM-MATRIX AT-AUTH-003.1 permission-model §4.3–4.4 Media, Question Types, Item Bank', () => {
  for (const row of MATRIX) {
    for (const role of ROLES) {
      it(`${row.cell} — ${role}: ${row.expect[role] ? 'разрешено' : 'запрещено'}`, async () => {
        expect(await ok(row.run(actor[role]))).toBe(row.expect[role])
      })
    }
  }
})
