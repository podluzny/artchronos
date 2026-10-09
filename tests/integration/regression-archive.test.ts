import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Actor } from '../../src/domain/authorization/actor.js'
import type { Db } from '../../src/infrastructure/db/kysely.js'
import { createServices, type Services } from '../../src/server/container.js'
import { freshDb } from '../support/db.js'
import { makeCourseWorld } from '../support/education.js'
import { ctx, makeUser, setupServices } from '../support/fixtures.js'
import { tempStorage, uploadImage } from '../support/media.js'
import { approveReview, reviewIdOf, type World } from '../support/workflow.js'

/**
 * T-086: регрессия архивации/восстановления и прав на медиа на опубликованном контенте
 * (SPEC-AUDIT-002, SPEC-MEDIA-002, BR-005, BR-036, BR-039). Архив скрывает объект из новых ссылок,
 * но не меняет то, что уже утверждено и опубликовано.
 */
let db: Db
let services: Services
let admin: Actor
let expert: { id: string; actor: Actor }
let w: World
let published: { testId: string; versionId: string; itemId: string; mediaId: string }

beforeAll(async () => {
  db = await freshDb()
  ;({ admin } = await setupServices(db))
  services = createServices(db, { storage: tempStorage() })
  expert = await makeUser(services, admin, ['EXPERT'])
  w = await makeCourseWorld(services, admin)
  // опубликованный тест с вопросом-атрибуцией по изображению
  const mediaId = await uploadImage(services, w.teacher.actor, { title: 'Левитан. Март', cleared: true })
  const types = await services.education.listQuestionTypes.run(admin, { filters: {}, limit: 50, offset: 0 }, ctx)
  const item = await services.items.createItem.run(
    w.teacher.actor,
    {
      courseId: w.courseId,
      questionTypeId: types.records.find((t) => t.code === 'attribution')!.id,
      document: {
        stem: 'Кто автор?',
        content: {},
        options: [
          { key: 'o1', role: 'OPTION', text: 'Левитан', ordinal: 0 },
          { key: 'o2', role: 'OPTION', text: 'Шишкин', ordinal: 1 },
        ],
        media: [{ mediaAssetId: mediaId, role: 'STIMULUS', ordinal: 0 }],
        answerKey: { correct: ['o1'] },
      },
      meta: { topicIds: [w.subtopicId] },
    },
    ctx,
  )
  const t = await services.tests.createTest.run(w.teacher.actor, { courseId: w.courseId, title: 'Опубликованный' }, ctx)
  const sec = (await services.tests.getTest.run(w.teacher.actor, { id: t.testId }, ctx)).sections[0]!.id
  await services.tests.addItem.run(w.teacher.actor, { testId: t.testId, sectionId: sec, itemId: item.itemId }, ctx)
  await services.tests.submitTest.run(w.teacher.actor, { testId: t.testId }, ctx)
  const reviewId = await reviewIdOf(services, t.testId)
  await services.reviews.assignReviewer.run(admin, { reviewId, reviewerId: expert.id }, ctx)
  await approveReview(services, expert.actor, reviewId)
  await services.tests.publishTest.run(admin, { testId: t.testId }, ctx)
  published = { testId: t.testId, versionId: t.versionId, itemId: item.itemId, mediaId }
})
afterAll(async () => db.destroy())

const snapshot = async () =>
  (
    await sql<{
      state: string
      content_hash: string
    }>`select state, content_hash from test_versions where id = ${published.versionId}`.execute(db)
  ).rows[0]

describe('T-086 регрессия архива и прав на опубликованном контенте', () => {
  it('AT-AUDIT-002.3 архив вопроса: опубликованный тест не меняется, предпросмотр работает; новые ссылки запрещены; restore возвращает', async () => {
    const before = await snapshot()
    await services.items.archiveItem.run(admin, { itemId: published.itemId, reason: 'регрессия' }, ctx)
    expect(await snapshot()).toEqual(before)
    const p = await services.tests.previewTest.run(admin, { testId: published.testId, seed: 1 }, ctx)
    expect(p.sections[0]!.items).toHaveLength(1)
    const t2 = await services.tests.createTest.run(w.teacher.actor, { courseId: w.courseId, title: 'Новый' }, ctx)
    const sec = (await services.tests.getTest.run(w.teacher.actor, { id: t2.testId }, ctx)).sections[0]!.id
    await expect(
      services.tests.addItem.run(w.teacher.actor, { testId: t2.testId, sectionId: sec, itemId: published.itemId }, ctx),
    ).rejects.toMatchObject({ ruleId: 'BR-039' })
    await services.items.restoreItem.run(admin, { itemId: published.itemId }, ctx)
    await services.tests.addItem.run(
      w.teacher.actor,
      { testId: t2.testId, sectionId: sec, itemId: published.itemId },
      ctx,
    )
  })

  it('архив медиа и темы не затрагивает утвержденные версии; восстановление возвращает их в выбор', async () => {
    const before = await snapshot()
    await services.media.archiveMedia.run(admin, { id: published.mediaId, reason: 'регрессия' }, ctx)
    await services.education.archiveTopic.run(admin, { id: w.subtopicId, reason: 'регрессия' }, ctx)
    expect(await snapshot()).toEqual(before)
    const it = await services.items.getItem.run(admin, { id: published.itemId }, ctx)
    expect(it.version.state).toBe('APPROVED')
    expect(it.version.document.media[0]!.mediaAssetId).toBe(published.mediaId)
    // архивированное медиа не выбирается в новом вопросе
    const types = await services.education.listQuestionTypes.run(admin, { filters: {}, limit: 50, offset: 0 }, ctx)
    const err = await services.items.createItem
      .run(
        w.teacher.actor,
        {
          courseId: w.courseId,
          questionTypeId: types.records.find((t) => t.code === 'attribution')!.id,
          document: {
            stem: 'x',
            options: [
              { key: 'o1', role: 'OPTION', text: 'a', ordinal: 0 },
              { key: 'o2', role: 'OPTION', text: 'b', ordinal: 1 },
            ],
            media: [{ mediaAssetId: published.mediaId, role: 'STIMULUS', ordinal: 0 }],
          },
          meta: { topicIds: [w.topicId] },
        },
        ctx,
      )
      .catch((e) => e)
    expect(err.code).toBe('VALIDATION')
    await services.media.restoreMedia.run(admin, { id: published.mediaId }, ctx)
    await services.education.restoreTopic.run(admin, { id: w.subtopicId }, ctx)
  })

  it('отзыв прав на медиа опубликованного теста: тест виден в «затронутых», содержимое не меняется, новая отправка блокируется (BR-024)', async () => {
    const before = await snapshot()
    const m = await services.media.getMedia.run(admin, { id: published.mediaId }, ctx)
    const r = await services.media.setRightsStatus.run(
      w.teacher.actor,
      { id: published.mediaId, status: 'RESTRICTED', note: 'истек договор', revision: m.revision },
      ctx,
    )
    expect(r.affectedTests.map((t) => `${t.testId}:${t.state}`)).toEqual([`${published.testId}:PUBLISHED`])
    expect(await snapshot()).toEqual(before)
    const nv = await services.tests.createNewVersion.run(w.teacher.actor, { testId: published.testId }, ctx)
    const issues = (await services.tests.checkReadiness.run(w.teacher.actor, { testId: published.testId }, ctx)).issues
    expect(issues.map((i) => i.code)).toContain('BR-024')
    // права восстановлены — версия снова готова
    const m2 = await services.media.getMedia.run(admin, { id: published.mediaId }, ctx)
    await services.media.setRightsStatus.run(
      w.teacher.actor,
      { id: published.mediaId, status: 'CLEARED', revision: m2.revision },
      ctx,
    )
    expect((await services.tests.checkReadiness.run(w.teacher.actor, { testId: published.testId }, ctx)).ready).toBe(
      true,
    )
    expect(nv.versionNo).toBe(2)
  })

  it('AT-AUDIT-002.4 используемые объекты нельзя удалить физически ни одним путем', async () => {
    expect(await services.media.deleteMedia.run(admin, { id: published.mediaId }, ctx).catch((e) => e.ruleId)).toBe(
      'BR-026',
    )
    for (const q of [
      sql`delete from media_assets where id = ${published.mediaId}`,
      sql`delete from items where id = ${published.itemId}`,
      sql`delete from item_versions where item_id = ${published.itemId}`,
      sql`delete from test_versions where id = ${published.versionId}`,
      sql`delete from tests where id = ${published.testId}`,
      sql`delete from topics where id = ${w.subtopicId}`,
      sql`delete from courses where id = ${w.courseId}`,
      sql`delete from users where id = ${w.teacher.id}`,
      sql`delete from audit_log where resource_id = ${published.testId}`,
    ])
      await expect(q.execute(db)).rejects.toThrow()
  })

  it('архив и восстановление теста: опубликованный — только после отзыва; попытки и история сохраняются', async () => {
    const student = await makeUser(services, admin, ['STUDENT'])
    const a = await services.delivery.startAttempt({ userId: student.id, testVersionId: published.versionId, seed: 1 })
    await expect(
      services.tests.archiveTest.run(admin, { testId: published.testId, reason: 'x' }, ctx),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' })
    await services.tests.withdrawTest.run(admin, { testId: published.testId, reason: 'конец курса' }, ctx)
    await services.tests.archiveTest.run(admin, { testId: published.testId, reason: 'конец курса' }, ctx)
    const att = await sql<{ n: string }>`select count(*) as n from attempts where id = ${a.attemptId}`.execute(db)
    expect(Number(att.rows[0]!.n)).toBe(1)
    await services.tests.restoreTest.run(admin, { testId: published.testId }, ctx)
    const hist = await services.tests.publicationHistory.run(admin, { testId: published.testId }, ctx)
    expect(hist[0]!.archiveReason).toBe('WITHDRAWN')
  })
})
