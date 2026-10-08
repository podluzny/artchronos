import { sql } from 'kysely'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Actor } from '../../src/domain/authorization/actor.js'
import type { Db } from '../../src/infrastructure/db/kysely.js'
import { createServices, type Services } from '../../src/server/container.js'
import { freshDb } from '../support/db.js'
import { makeCourseWorld } from '../support/education.js'
import { ctx, makeUser, PASSWORD, setupServices } from '../support/fixtures.js'
import { buildTestApp, loginAgent } from '../support/http.js'
import { uploadImage } from '../support/media.js'
import { approveReview, reviewIdOf, type World } from '../support/workflow.js'

let db: Db
let services: Services
let admin: Actor
let w: World

beforeAll(async () => {
  db = await freshDb()
  ;({ admin } = await setupServices(db))
  // хранилище по умолчанию — то же, что использует HTTP-приложение в тестах
  services = createServices(db)
  w = await makeCourseWorld(services, admin)
})
afterAll(async () => db.destroy())

const codeOf = (p: Promise<unknown>) =>
  p.then(
    () => 'OK',
    (e) => e.ruleId ?? e.code,
  )

/** Вопрос банка «атрибуция» со стимулом (ItemMedia) и вопрос image_choice с изображениями в вариантах (ItemOption). */
async function itemsWithMedia(stimulus: string, optionMedia: string[]) {
  const types = await services.education.listQuestionTypes.run(admin, { filters: {}, limit: 50, offset: 0 }, ctx)
  const qt = (c: string) => types.records.find((t) => t.code === c)!.id
  const attribution = await services.items.createItem.run(
    w.teacher.actor,
    {
      courseId: w.courseId,
      questionTypeId: qt('attribution'),
      document: {
        stem: 'Кто автор произведения?',
        content: {},
        options: [
          { key: 'o1', role: 'OPTION', text: 'Левитан', ordinal: 0 },
          { key: 'o2', role: 'OPTION', text: 'Поленов', ordinal: 1 },
        ],
        media: [{ mediaAssetId: stimulus, role: 'STIMULUS', ordinal: 0 }],
        answerKey: { correct: ['o1'] },
      },
      meta: { topicIds: [w.topicId] },
    },
    ctx,
  )
  const choice = await services.items.createItem.run(
    w.teacher.actor,
    {
      courseId: w.courseId,
      questionTypeId: qt('image_choice'),
      document: {
        stem: 'Выберите работу Куинджи',
        content: {},
        options: optionMedia.map((m, i) => ({ key: `o${i + 1}`, role: 'OPTION', mediaAssetId: m, ordinal: i })),
        answerKey: { correct: ['o1'] },
      },
      meta: { topicIds: [w.topicId] },
    },
    ctx,
  )
  return { attribution, choice }
}

describe('SPEC-MEDIA-001/002 выдача файлов и использование медиа', () => {
  it('AT-MEDIA-001.7 файл недоступен без аутентификации; прямой URL storage недоступен', async () => {
    const id = await uploadImage(services, w.teacher.actor, { title: 'Закрытый файл' })
    const { app } = await buildTestApp(db)
    for (const path of [`/admin/media-file/${id}/thumb`, `/admin/media-file/${id}`]) {
      const r = await request(app).get(path)
      // без сессии — редирект на вход (HTML) или 401, но не файл
      expect([302, 401]).toContain(r.status)
      expect(String(r.headers['content-type'] ?? '')).not.toMatch(/^image\//)
    }
    const key = (await sql<{ storage_key: string }>`select storage_key from media_assets where id = ${id}`.execute(db))
      .rows[0]!.storage_key
    for (const path of [`/${key}`, `/media/${key}`, `/.data/media/${key}`, `/admin/${key}`, `/uploads/${key}`]) {
      const r = await request(app).get(path)
      expect([302, 401, 404]).toContain(r.status)
      expect(String(r.headers['content-type'] ?? '')).not.toMatch(/^image\//)
    }
    const agent = await loginAgent(app, 'root@test.local', PASSWORD)
    const ok = await agent.get(`/admin/media-file/${id}/thumb`).expect(200)
    expect(ok.headers['content-type']).toMatch(/^image\//)
    expect(ok.headers['cache-control']).toMatch(/private/)
  })

  it('AT-MEDIA-002.6 «где используется» показывает ссылки через ItemOption и ItemMedia', async () => {
    const m = await uploadImage(services, w.teacher.actor, { title: 'Общий', cleared: true })
    const m2 = await uploadImage(services, w.teacher.actor, { title: 'Второй', cleared: true })
    const { attribution, choice } = await itemsWithMedia(m, [m, m2])
    const usage = await services.media.mediaUsage.run(w.teacher.actor, { id: m }, ctx)
    expect(usage.map((u) => `${u.itemId}:${u.via}`).sort()).toEqual(
      [`${attribution.itemId}:MEDIA`, `${choice.itemId}:OPTION`].sort(),
    )
  })

  it('AT-MEDIA-002.4 удаление медиа, используемого не-DRAFT версией, отклоняется (BR-026)', async () => {
    const m = await uploadImage(services, w.teacher.actor, { title: 'Стимул', cleared: true })
    const { attribution } = await itemsWithMedia(m, [
      await uploadImage(services, w.teacher.actor, { cleared: true }),
      await uploadImage(services, w.teacher.actor, { cleared: true }),
    ])
    await services.items.submitItem.run(w.teacher.actor, { itemId: attribution.itemId }, ctx)
    expect(await codeOf(services.media.deleteMedia.run(admin, { id: m }, ctx))).toBe('BR-026')
    await expect(sql`delete from media_assets where id = ${m}`.execute(db)).rejects.toThrow()
  })

  it('AT-MEDIA-002.5 архивированное медиа нельзя выбрать в новом вопросе (BR-039)', async () => {
    const m = await uploadImage(services, w.teacher.actor, { title: 'В архив', cleared: true })
    await services.media.archiveMedia.run(w.teacher.actor, { id: m, reason: 'плохое качество' }, ctx)
    const err = await itemsWithMedia(m, [m, m]).catch((e) => e)
    expect(err.code).toBe('VALIDATION')
    expect(JSON.stringify(err.fieldErrors)).toMatch(/архив/i)
  })

  it('AT-MEDIA-002.7 RESTRICTED показывает затронутые опубликованные тесты', async () => {
    const expert = await makeUser(services, admin, ['EXPERT'])
    const m = await uploadImage(services, w.teacher.actor, { title: 'Левитан. Над вечным покоем', cleared: true })
    const { attribution } = await itemsWithMedia(m, [
      await uploadImage(services, w.teacher.actor, { cleared: true }),
      await uploadImage(services, w.teacher.actor, { cleared: true }),
    ])
    const t = await services.tests.createTest.run(
      w.teacher.actor,
      { courseId: w.courseId, title: 'Атрибуция пейзажа' },
      ctx,
    )
    const sec = (await services.tests.getTest.run(w.teacher.actor, { id: t.testId }, ctx)).sections[0]!.id
    await services.tests.addItem.run(
      w.teacher.actor,
      { testId: t.testId, sectionId: sec, itemId: attribution.itemId },
      ctx,
    )
    await services.tests.submitTest.run(w.teacher.actor, { testId: t.testId }, ctx)
    const reviewId = await reviewIdOf(services, t.testId)
    await services.reviews.assignReviewer.run(admin, { reviewId, reviewerId: expert.id }, ctx)
    await approveReview(services, expert.actor, reviewId)
    await services.tests.publishTest.run(admin, { testId: t.testId }, ctx)
    const media = await services.media.getMedia.run(w.teacher.actor, { id: m }, ctx)
    const r = await services.media.setRightsStatus.run(
      w.teacher.actor,
      { id: m, status: 'RESTRICTED', note: 'Запрос музея', revision: media.revision },
      ctx,
    )
    expect(r.affectedTests).toEqual([
      { testId: t.testId, title: 'Атрибуция пейзажа', versionNo: 1, state: 'PUBLISHED' },
    ])
  })
})

describe('SPEC-QTYPE-002 старт приложения', () => {
  it('AT-QTYPE-002.3 отсутствующий плагин для существующего типа → ошибка старта', async () => {
    const { id } = await services.qtypes.createQuestionType.run(
      admin,
      {
        code: 'ghost_type',
        name: 'Тип без плагина',
        interactionKey: 'choice',
        config: { cardinality: 'single', minOptions: 2, maxOptions: 4, optionMedia: 'none', stimulus: 'none' },
        evaluation: { method: 'exact' },
      },
      ctx,
    )
    // плагин «исчез» из кода (например, удален при обновлении): тип ссылается на незарегистрированный interaction
    await sql`update question_types set interaction_key = 'hotspot' where id = ${id}`.execute(db)
    await expect(buildTestApp(db)).rejects.toThrow(/ghost_type \(hotspot\)/)
    await sql`update question_types set interaction_key = 'choice' where id = ${id}`.execute(db)
    await expect(buildTestApp(db)).resolves.toBeTruthy()
  })
})
