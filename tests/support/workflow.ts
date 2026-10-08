import { sql } from 'kysely'
import type { Actor } from '../../src/domain/authorization/actor.js'
import type { Db } from '../../src/infrastructure/db/kysely.js'
import type { Services } from '../../src/server/container.js'
import type { makeCourseWorld } from './education.js'
import { ctx } from './fixtures.js'

export type World = Awaited<ReturnType<typeof makeCourseWorld>>

let n = 0
export const choiceDoc = (stem = `Кто автор «Грачи прилетели»? ${++n}`) => ({
  stem,
  content: { shuffleOptions: true },
  options: [
    { key: 'o1', role: 'OPTION', text: 'Саврасов', ordinal: 0 },
    { key: 'o2', role: 'OPTION', text: 'Шишкин', ordinal: 1 },
    { key: 'o3', role: 'OPTION', text: 'Левитан', ordinal: 2 },
  ],
  media: [],
  answerKey: { correct: ['o1'] },
})

export async function allowManyTests(db: Db, w: World) {
  await sql`update assignments set max_tests_per_student = 10 where id = ${w.assignmentId}`.execute(db)
}

export async function studentItem(services: Services, w: World, author?: Actor) {
  return services.items.createItem.run(
    author ?? w.student.actor,
    {
      assignmentId: w.assignmentId,
      questionTypeId: w.qt('single_choice'),
      document: choiceDoc(),
      meta: { topicIds: [w.subtopicId], difficulty: 2 },
    },
    ctx,
  )
}

/** Тест студента с двумя собственными вопросами, отправленный на экспертизу. */
export async function submittedStudentTest(services: Services, w: World) {
  const i1 = await studentItem(services, w)
  const i2 = await studentItem(services, w)
  const t = await services.tests.createTest.run(w.student.actor, { assignmentId: w.assignmentId, title: 'Пейзаж' }, ctx)
  const d = await services.tests.getTest.run(w.student.actor, { id: t.testId }, ctx)
  for (const it of [i1, i2])
    await services.tests.addItem.run(
      w.student.actor,
      { testId: t.testId, sectionId: d.sections[0]!.id, itemId: it.itemId },
      ctx,
    )
  await services.tests.submitTest.run(w.student.actor, { testId: t.testId }, ctx)
  const reviewId = await reviewIdOf(services, t.testId)
  return { ...t, sectionId: d.sections[0]!.id, i1, i2, reviewId }
}

/** Последний review теста (чтение под системным контекстом репозитория). */
export async function reviewIdOf(services: Services, testId: string): Promise<string> {
  const r = await services.uow.read.reviews.latestForContainer('test', testId)
  if (!r) throw new Error('review не создан')
  return r.id
}

/** Начать (если нужно), отметить все обязательные пункты и принять. */
export async function approveReview(services: Services, reviewer: Actor, reviewId: string) {
  let d = await services.reviews.getReview.run(reviewer, { id: reviewId }, ctx)
  if (d.review.status === 'OPEN') await services.reviews.startReview.run(reviewer, { reviewId }, ctx)
  d = await services.reviews.getReview.run(reviewer, { id: reviewId }, ctx)
  for (const i of d.template.items.filter((x) => x.mandatory))
    await services.reviews.answerChecklist.run(reviewer, { reviewId, code: i.code, checked: true }, ctx)
  await services.reviews.approve.run(reviewer, { reviewId }, ctx)
}

/** Утвержденный вопрос банка через самостоятельную экспертизу (FR-ITEM-009). */
export async function approvedBankItem(
  services: Services,
  w: World,
  reviewer: Actor,
  opts: { difficulty?: number; topicId?: string } = {},
) {
  const r = await services.items.createItem.run(
    w.teacher.actor,
    {
      courseId: w.courseId,
      questionTypeId: w.qt('single_choice'),
      document: choiceDoc(),
      meta: { topicIds: [opts.topicId ?? w.topicId], difficulty: opts.difficulty ?? 3 },
    },
    ctx,
  )
  await services.items.submitItem.run(w.teacher.actor, { itemId: r.itemId }, ctx)
  const rv = (await services.uow.read.reviews.latestForContainer('item', r.itemId))!
  await services.reviews.assignReviewer
    .run(reviewer, { reviewId: rv.id, reviewerId: reviewer.userId }, ctx)
    .catch(async () => {
      throw new Error('не удалось назначить эксперта вопроса')
    })
  await approveReview(services, reviewer, rv.id)
  return r
}
