import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { contentHashOf } from '../../src/application/itembank/item-use-cases.js'
import type { Actor } from '../../src/domain/authorization/actor.js'
import type { Db } from '../../src/infrastructure/db/kysely.js'
import type { Services } from '../../src/server/container.js'
import { freshDb } from '../support/db.js'
import { makeCourseWorld } from '../support/education.js'
import { auditActions, ctx, makeUser, setupServices } from '../support/fixtures.js'
import { tempStorage, uploadImage } from '../support/media.js'
import type { World } from '../support/workflow.js'
import { createServices } from '../../src/server/container.js'

let db: Db
let services: Services
let admin: Actor
let w: World
let expert: Actor

beforeAll(async () => {
  db = await freshDb()
  ;({ admin } = await setupServices(db))
  services = createServices(db, { storage: tempStorage() })
  w = await makeCourseWorld(services, admin)
  expert = (await makeUser(services, admin, ['EXPERT'])).actor
})
afterAll(async () => db.destroy())

const kb = () => services.knowledge
const codeOf = (p: Promise<unknown>) =>
  p.then(
    () => 'OK',
    (e) => e.ruleId ?? e.code,
  )
const create = (actor: Actor, kind: string, name: string, extra: Record<string, unknown> = {}) =>
  kb().createEntry.run(actor, { kind, name, ...extra }, ctx)
const get = (id: string) => kb().getEntry.run(admin, { id }, ctx)

describe('SPEC-KB-001 справочники базы знаний', () => {
  it('AT-KB-001.1 Teacher создает запись каждого вида; slug из названия; аудит', async () => {
    const t = w.teacher.actor
    for (const kind of ['PERSON', 'ARTWORK', 'COLLECTION', 'MOVEMENT', 'PERIOD', 'TECHNIQUE', 'TERM']) {
      const { id } = await create(t, kind, `Объект ${kind}`)
      const e = await get(id)
      expect(e.kind).toBe(kind)
      expect(e.slug).toBe(`объект-${kind.toLowerCase()}`)
      expect(await auditActions(db, id)).toContain('knowledge.created')
    }
  })

  it('AT-KB-001.2 slug уникален в виде; недопустимый slug отклоняется; в разных видах допустим', async () => {
    const t = w.teacher.actor
    await create(t, 'TERM', 'Пленэр', { slug: 'plein-air' })
    expect(await codeOf(create(t, 'TERM', 'Пленэр 2', { slug: 'plein-air' }))).toBe('VALIDATION')
    expect(await codeOf(create(t, 'TERM', 'Плохой', { slug: 'two words' }))).toBe('VALIDATION')
    expect(await codeOf(create(t, 'MOVEMENT', 'Пленэризм', { slug: 'plein-air' }))).toBe('OK')
  })

  it('AT-KB-001.3 Student и Expert читают, но не изменяют справочники', async () => {
    const { id } = await create(w.teacher.actor, 'PERSON', 'Иван Шишкин', { slug: 'shishkin' })
    for (const a of [w.student.actor, expert]) {
      expect((await kb().getEntry.run(a, { id }, ctx)).name).toBe('Иван Шишкин')
      expect(await codeOf(create(a, 'PERSON', 'Чужой'))).toBe('FORBIDDEN')
      expect(await codeOf(kb().updateEntry.run(a, { id, revision: 1, name: 'X' }, ctx))).toBe('FORBIDDEN')
      expect(await codeOf(kb().deleteEntry.run(a, { id }, ctx))).toBe('FORBIDDEN')
    }
  })

  it('AT-KB-001.4 связь с объектом не того вида, архивным или с собой отклоняется', async () => {
    const t = w.teacher.actor
    const { id: person } = await create(t, 'PERSON', 'Алексей Саврасов', { slug: 'savrasov' })
    const { id: coll } = await create(t, 'COLLECTION', 'ГТГ', { slug: 'gtg' })
    expect(await codeOf(create(t, 'ARTWORK', 'Грачи', { links: { AUTHOR: [coll] } }))).toBe('VALIDATION')
    const { id: old } = await create(t, 'COLLECTION', 'Закрытый музей')
    await kb().archiveEntry.run(t, { id: old, reason: 'дубликат' }, ctx)
    expect(await codeOf(create(t, 'ARTWORK', 'Грачи', { links: { COLLECTION: [old] } }))).toBe('VALIDATION')
    const { id: mv } = await create(t, 'MOVEMENT', 'Реализм')
    const m = await get(mv)
    expect(
      await codeOf(
        kb().updateEntry.run(t, { id: mv, revision: m.revision, name: 'Реализм', links: { PARENT: [mv] } }, ctx),
      ),
    ).toBe('VALIDATION')
    expect(
      await codeOf(
        create(t, 'ARTWORK', 'Грачи прилетели', { slug: 'grachi', links: { AUTHOR: [person], COLLECTION: [coll] } }),
      ),
    ).toBe('OK')
  })

  it('AT-KB-001.5 используемый объект не удаляется (BR-047); неиспользуемый — удаляется', async () => {
    const t = w.teacher.actor
    const { id: p } = await create(t, 'PERSON', 'Используемый автор')
    await create(t, 'ARTWORK', 'Работа', { links: { AUTHOR: [p] } })
    expect(await codeOf(kb().deleteEntry.run(t, { id: p }, ctx))).toBe('BR-047')
    const { id: free } = await create(t, 'TERM', 'Лишний термин')
    expect(await codeOf(kb().deleteEntry.run(t, { id: free }, ctx))).toBe('OK')
    expect(await auditActions(db, free)).toContain('knowledge.deleted')
  })

  it('AT-KB-001.6 slug используемого объекта не меняется (BR-048); название — меняется', async () => {
    const t = w.teacher.actor
    const { id } = await create(t, 'TERM', 'Сфумато', { slug: 'sfumato' })
    await create(t, 'TERM', 'Кьяроскуро', { description: 'Близко к @sfumato' })
    const e = await get(id)
    expect(
      await codeOf(kb().updateEntry.run(t, { id, revision: e.revision, name: 'Сфумато', slug: 'sfumato-2' }, ctx)),
    ).toBe('BR-048')
    await kb().updateEntry.run(t, { id, revision: e.revision, name: 'Сфумато (техника)' }, ctx)
    expect((await get(id)).name).toBe('Сфумато (техника)')
    expect((await get(id)).slug).toBe('sfumato')
  })

  it('AT-KB-001.7 архив и восстановление журналируются; архивный не выбирается в новых связях', async () => {
    const t = w.teacher.actor
    const { id } = await create(t, 'TECHNIQUE', 'Темпера')
    await kb().archiveEntry.run(t, { id, reason: 'объединено с «Яичная темпера»' }, ctx)
    expect((await get(id)).status).toBe('ARCHIVED')
    expect(await codeOf(create(t, 'ARTWORK', 'Икона', { links: { TECHNIQUE: [id] } }))).toBe('VALIDATION')
    await kb().restoreEntry.run(t, { id }, ctx)
    expect(await auditActions(db, id)).toEqual(['knowledge.created', 'knowledge.archived', 'knowledge.restored'])
  })

  it('AT-KB-001.8 поиск по названию, варианту написания и slug; «где используется»', async () => {
    const t = w.teacher.actor
    const { id } = await create(t, 'PERSON', 'Архип Куинджи', { slug: 'kuindzhi', altNames: 'Kuindzhi, А. И. Куинджи' })
    const find = async (q: string) =>
      (
        await kb().listEntries.run(
          w.student.actor,
          { kind: 'PERSON', query: { filters: { q }, limit: 20, offset: 0 } },
          ctx,
        )
      ).records.map((r) => r.id)
    expect(await find('Архип')).toContain(id)
    expect(await find('Kuindzhi')).toContain(id)
    expect(await find('kuindz')).toContain(id)
    await create(t, 'ARTWORK', 'Лунная ночь на Днепре', { links: { AUTHOR: [id] } })
    const u = await kb().usages.run(t, { id }, ctx)
    expect(u.map((x) => [x.sourceType, x.title])).toContainEqual(['LINK', 'Лунная ночь на Днепре'])
  })

  it('AT-KB-001.9 медиа, связанное с произведением, получает атрибутивные поля из него (BR-051)', async () => {
    const t = w.teacher.actor
    const { id: tech } = await create(t, 'TECHNIQUE', 'Холст, масло', { slug: 'oil' })
    const { id: coll } = await create(t, 'COLLECTION', 'Государственный Русский музей', { slug: 'grm' })
    const { id: author } = await create(t, 'PERSON', 'А. И. Куинджи', { slug: 'kuindzhi-ai' })
    const { id: art } = await create(t, 'ARTWORK', 'Лунная ночь', {
      slug: 'lunnaya-noch',
      yearFrom: 1880,
      attrs: { inventoryNo: 'Ж-4129' },
      links: { AUTHOR: [author], COLLECTION: [coll], TECHNIQUE: [tech] },
    })
    const mid = await uploadImage(services, t, { title: 'Лунная ночь, фото' })
    const m = await services.media.getMedia.run(t, { id: mid }, ctx)
    await services.media.updateMediaMetadata.run(
      t,
      { id: mid, metadata: { artworkId: art }, revision: m.revision },
      ctx,
    )
    const after = await services.media.getMedia.run(t, { id: mid }, ctx)
    expect(after).toMatchObject({
      artworkId: art,
      workTitle: 'Лунная ночь',
      artist: 'А. И. Куинджи',
      technique: 'Холст, масло',
      collection: 'Государственный Русский музей',
      dateText: '1880',
      inventoryNo: 'Ж-4129',
    })
    expect((await kb().usages.run(t, { id: art }, ctx)).map((x) => x.sourceType)).toContain('MEDIA_ARTWORK')
    expect(
      await codeOf(
        services.media.updateMediaMetadata.run(
          t,
          { id: mid, metadata: { artworkId: author }, revision: after.revision },
          ctx,
        ),
      ),
    ).toBe('VALIDATION')
  })
})

describe('SPEC-KB-002 якоря в контенте', () => {
  let monet: string
  beforeAll(async () => {
    monet = (await create(w.teacher.actor, 'PERSON', 'Клод Моне', { slug: 'monet' })).id
    await create(w.teacher.actor, 'MOVEMENT', 'Импрессионизм', { slug: 'impressionism' })
  })

  it('AT-KB-002.7 вопрос: формулировка, варианты, пояснение нормализуются; переименование не меняет утвержденный текст и contentHash', async () => {
    const t = w.teacher.actor
    const r = await services.items.createItem.run(
      t,
      {
        courseId: w.courseId,
        questionTypeId: w.qt('single_choice'),
        document: {
          stem: 'К какому направлению относится @monet?',
          content: {},
          options: [
            { key: 'o1', role: 'OPTION', text: '@impressionism', ordinal: 0 },
            { key: 'o2', role: 'OPTION', text: 'Барокко', ordinal: 1 },
          ],
          media: [],
          answerKey: { correct: ['o1'] },
        },
        meta: { topicIds: [w.topicId], feedback: 'Моне — основоположник [импрессионизма](@impressionism)' },
      },
      ctx,
    )
    const v = (await services.uow.read.items.findVersion(r.versionId))!
    expect(v.document.stem).toBe('К какому направлению относится [Клод Моне](@person:monet)?')
    expect(v.document.options[0]!.text).toBe('[Импрессионизм](@movement:impressionism)')
    expect(v.meta.feedback).toBe('Моне — основоположник [импрессионизма](@movement:impressionism)')
    expect((await services.uow.read.knowledge.refsOf('ITEM_VERSION', r.versionId)).length).toBe(2)
    // неизвестный slug — ошибка поля
    expect(
      await codeOf(
        services.items.saveDraft.run(
          t,
          { itemId: r.itemId, document: { ...v.document, stem: 'Кто такой @nobody?' }, revision: 1 },
          ctx,
        ),
      ),
    ).toBe('VALIDATION')
    await services.items.submitItem.run(t, { itemId: r.itemId }, ctx)
    const frozen = (await services.uow.read.items.findVersion(r.versionId))!
    const hash = frozen.contentHash
    const e = await get(monet)
    await kb().updateEntry.run(t, { id: monet, revision: e.revision, name: 'Оскар-Клод Моне' }, ctx)
    const again = (await services.uow.read.items.findVersion(r.versionId))!
    expect(again.document.stem).toBe(frozen.document.stem)
    expect(contentHashOf(again.document, again.meta, again.questionTypeVersionId)).toBe(hash)
    // предпросмотр: span в формулировке, подписи в вариантах
    const pv = await services.items.previewItem.run(t, { itemId: r.itemId, versionId: r.versionId }, ctx)
    expect(pv.stem).toContain('<span class="kb-ref"')
    expect(pv.options.map((o) => o.text)).toContain('Импрессионизм')
  })

  it('AT-KB-002.8 тест, задание, медиа и справочник нормализуют якоря и записывают ссылки', async () => {
    const t = w.teacher.actor
    const test = await services.tests.createTest.run(
      t,
      { courseId: w.courseId, title: 'Импрессионисты', description: 'Про @impressionism' },
      ctx,
    )
    expect((await services.uow.read.tests.findVersion(test.versionId))!.description).toBe(
      'Про [Импрессионизм](@movement:impressionism)',
    )
    const { id: aid } = await services.education.createAssignment.run(
      t,
      {
        courseId: w.courseId,
        title: 'Моне',
        instructions: 'Вопросы о [Моне](@monet)',
        deadlineAt: new Date(Date.now() + 86400_000),
      },
      ctx,
    )
    const a = await services.education.getAssignment.run(t, { id: aid }, ctx)
    expect(a.instructions).toBe('Вопросы о [Моне](@person:monet)')
    const mid = await uploadImage(services, t, { title: 'Моне. Впечатление' })
    const m = await services.media.getMedia.run(t, { id: mid }, ctx)
    await services.media.updateMediaMetadata.run(
      t,
      { id: mid, metadata: { caption: 'Работа @monet' }, revision: m.revision },
      ctx,
    )
    expect((await services.media.getMedia.run(t, { id: mid }, ctx)).caption).toMatch(/\]\(@person:monet\)$/)
    const { id: term } = await create(t, 'TERM', 'Пленэрная живопись', {
      description: 'Метод, важный для @impressionism',
    })
    expect((await get(term)).description).toBe('Метод, важный для [Импрессионизм](@movement:impressionism)')
    for (const [type, id] of [
      ['TEST_VERSION', test.versionId],
      ['ASSIGNMENT', aid],
      ['MEDIA', mid],
      ['KNOWLEDGE', term],
    ] as const)
      expect((await services.uow.read.knowledge.refsOf(type, id)).length).toBe(1)
  })

  it('AT-KB-002.9 «где используется» перечисляет вопросы, тесты, задания, медиа и объекты', async () => {
    const u = await kb().usages.run(w.teacher.actor, { id: monet }, ctx)
    const types = new Set(u.map((x) => x.sourceType))
    for (const t of ['ITEM_VERSION', 'ASSIGNMENT', 'MEDIA']) expect(types).toContain(t)
    const imp = (
      await kb().listEntries.run(
        admin,
        { kind: 'MOVEMENT', query: { filters: { slug: 'impressionism' }, limit: 5, offset: 0 } },
        ctx,
      )
    ).records[0]!
    const ui = new Set((await kb().usages.run(admin, { id: imp.id }, ctx)).map((x) => x.sourceType))
    for (const t of ['ITEM_VERSION', 'TEST_VERSION', 'KNOWLEDGE']) expect(ui).toContain(t)
    expect(await codeOf(kb().deleteEntry.run(admin, { id: imp.id }, ctx))).toBe('BR-047')
  })
})
