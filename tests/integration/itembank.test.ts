import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Actor } from '../../src/domain/authorization/actor.js'
import type { Db } from '../../src/infrastructure/db/kysely.js'
import { createServices, type Services } from '../../src/server/container.js'
import { freshDb } from '../support/db.js'
import { makeCourseWorld } from '../support/education.js'
import { ctx, makeUser, setupServices } from '../support/fixtures.js'
import { tempStorage, uploadImage } from '../support/media.js'

let db: Db
let services: Services
let admin: Actor
let w: Awaited<ReturnType<typeof makeCourseWorld>>
let other: Awaited<ReturnType<typeof makeCourseWorld>>

beforeAll(async () => {
  db = await freshDb()
  const s = await setupServices(db)
  admin = s.admin
  services = createServices(db, { storage: tempStorage() })
  w = await makeCourseWorld(services, admin)
  other = await makeCourseWorld(services, admin)
})
afterAll(async () => db.destroy())

const singleDoc = (stem = 'Кто автор «Грачи прилетели»?') => ({
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

async function studentItem(stem?: string) {
  const r = await services.items.createItem.run(
    w.student.actor,
    {
      assignmentId: w.assignmentId,
      questionTypeId: w.qt('single_choice'),
      document: singleDoc(stem),
      meta: { topicIds: [w.subtopicId], difficulty: 2 },
    },
    ctx,
  )
  return r
}

/** Имитация решения экспертизы (Review — M5): прямой перевод состояния, допускаемый триггером. */
async function forceState(versionId: string, state: string) {
  await sql`update item_versions set state = ${state} where id = ${versionId}`.execute(db)
}

describe('SPEC-QTYPE-001 Реестр типов вопросов', () => {
  it('seed: MVP-типы активны и имеют версию v1', async () => {
    const r = await services.qtypes.listQuestionTypesFull.run(admin, { filters: {}, limit: 50, offset: 0 }, ctx)
    expect(r.records.map((t) => t.code).sort()).toEqual([
      'attribution',
      'chronology',
      'essay',
      'image_choice',
      'matching',
      'multiple_choice',
      'short_answer',
      'single_choice',
      'true_false',
    ])
    expect(r.records.every((t) => t.status === 'ACTIVE' && t.currentVersion?.versionNo === 1)).toBe(true)
  })

  it('AT-QTYPE-001.1 Admin создает тип на основе choice с обязательным стимулом; v1, INACTIVE', async () => {
    const { id } = await services.qtypes.createQuestionType.run(
      admin,
      {
        code: 'fragment_attribution',
        name: 'Атрибуция по фрагменту',
        interactionKey: 'choice',
        config: { cardinality: 'single', minOptions: 3, maxOptions: 6, optionMedia: 'none', stimulus: 'required' },
        evaluation: { method: 'exact' },
      },
      ctx,
    )
    const t = await services.qtypes.getQuestionType.run(admin, { id }, ctx)
    expect(t.status).toBe('INACTIVE')
    expect(t.currentVersion!.versionNo).toBe(1)
    expect(t.currentVersion!.interactionConfig.stimulus).toBe('required')
  })

  it('AT-QTYPE-001.2 тип с несуществующим interactionKey не создается', async () => {
    await expect(
      services.qtypes.createQuestionType.run(
        admin,
        { code: 'hotspot', name: 'Hotspot', interactionKey: 'hotspot', evaluation: { method: 'exact' } },
        ctx,
      ),
    ).rejects.toMatchObject({ ruleId: 'BR-023' })
  })

  it('AT-QTYPE-001.3 изменение конфигурации создает v2; существующие ItemVersion остаются на v1', async () => {
    const created = await studentItem('Вопрос до изменения типа')
    const v1 = (await services.items.getItem.run(w.student.actor, { id: created.itemId }, ctx)).version
      .questionTypeVersionId
    const t = await services.qtypes.getQuestionType.run(admin, { id: w.qt('single_choice') }, ctx)
    const r = await services.qtypes.updateQuestionType.run(
      admin,
      { id: t.id, config: { ...t.currentVersion!.interactionConfig, maxOptions: 6 }, revision: t.revision },
      ctx,
    )
    expect(r.versionNo).toBe(2)
    const after = await services.items.getItem.run(w.student.actor, { id: created.itemId }, ctx)
    expect(after.version.questionTypeVersionId).toBe(v1)
    const fresh = await studentItem('Вопрос после изменения типа')
    const v2 = (await services.items.getItem.run(w.student.actor, { id: fresh.itemId }, ctx)).version
      .questionTypeVersionId
    expect(v2).not.toBe(v1)
  })

  it('AT-QTYPE-001.4 деактивированный тип недоступен для новых вопросов; существующие работают', async () => {
    const existing = await services.items.createItem.run(
      w.teacher.actor,
      {
        courseId: w.courseId,
        questionTypeId: w.qt('short_answer'),
        document: { stem: 'Автор «Троицы»?', answerKey: { accepted: ['Рублев'] } },
        meta: { topicIds: [w.topicId] },
      },
      ctx,
    )
    const r = await services.qtypes.setQuestionTypeStatus.run(
      admin,
      { id: w.qt('short_answer'), status: 'INACTIVE' },
      ctx,
    )
    expect(r.activeAssignments).toBe(0)
    await expect(
      services.items.createItem.run(
        w.teacher.actor,
        { courseId: w.courseId, questionTypeId: w.qt('short_answer') },
        ctx,
      ),
    ).rejects.toMatchObject({ ruleId: 'BR-021' })
    const d = await services.items.getItem.run(w.teacher.actor, { id: existing.itemId }, ctx)
    expect(d.canEdit).toBe(true)
    await services.items.saveDraft.run(
      w.teacher.actor,
      {
        itemId: existing.itemId,
        document: { stem: 'Автор иконы «Троица»?', answerKey: { accepted: ['Рублев'] } },
        revision: d.version.revision,
      },
      ctx,
    )
    await services.qtypes.setQuestionTypeStatus.run(admin, { id: w.qt('short_answer'), status: 'ACTIVE' }, ctx)
  })

  it('AT-QTYPE-001.5 Teacher/Student/Expert не управляют типами', async () => {
    const expert = await makeUser(services, admin, ['EXPERT'])
    for (const a of [w.teacher.actor, w.student.actor, expert.actor]) {
      await expect(
        services.qtypes.createQuestionType.run(
          a,
          { code: 'x_type', name: 'x', interactionKey: 'choice', evaluation: { method: 'exact' } },
          ctx,
        ),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    }
  })

  it('AT-QTYPE-001.6 QuestionTypeVersion неизменна (прямой UPDATE отклоняется)', async () => {
    await expect(sql`update question_type_versions set evaluation = '{"method":"x"}'`.execute(db)).rejects.toThrow(
      /immutable/,
    )
  })
})

describe('SPEC-ITEM-001 Создание вопроса', () => {
  it('AT-ITEM-001.4 после сохранения создается v1 DRAFT, owner = автор', async () => {
    const r = await studentItem()
    const d = await services.items.getItem.run(w.student.actor, { id: r.itemId }, ctx)
    expect(d.item.ownerId).toBe(w.student.id)
    expect(d.item.assignmentId).toBe(w.assignmentId)
    expect(d.version.versionNo).toBe(1)
    expect(d.version.state).toBe('DRAFT')
    expect(d.version.authorIds).toEqual([w.student.id])
    expect(d.issues.filter((i) => i.severity === 'ERROR')).toEqual([])
  })

  it('AT-ITEM-001.1 single_choice: варианты из шаблона типа', async () => {
    const ctxEd = await services.items.editorContext.run(w.student.actor, { assignmentId: w.assignmentId }, ctx)
    expect(ctxEd.types.map((t) => t.code).sort()).toEqual(['image_choice', 'single_choice'])
    const empty = ctxEd.emptyDocuments[w.qt('single_choice')]!
    expect(empty.options.length).toBeGreaterThanOrEqual(2)
    expect(ctxEd.topics.map((t) => t.value)).toEqual(expect.arrayContaining([w.topicId, w.subtopicId]))
  })

  it('AT-ITEM-001.3 структурно невалидный документ не сохраняется; семантически неполный — сохраняется с ошибками и не отправляется', async () => {
    await expect(
      services.items.createItem.run(
        w.student.actor,
        { assignmentId: w.assignmentId, questionTypeId: w.qt('single_choice'), document: { options: 'не массив' } },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION' })
    await expect(
      services.items.createItem.run(
        w.student.actor,
        {
          assignmentId: w.assignmentId,
          questionTypeId: w.qt('single_choice'),
          document: { ...singleDoc(), content: { shuffleOptions: 'да' } },
        },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION' })
    const r = await services.items.createItem.run(
      w.student.actor,
      {
        assignmentId: w.assignmentId,
        questionTypeId: w.qt('single_choice'),
        document: { ...singleDoc(), answerKey: { correct: [] } },
        meta: { topicIds: [w.topicId] },
      },
      ctx,
    )
    expect(r.issues.map((i) => i.code)).toContain('NO_CORRECT')
  })

  it('AT-ITEM-001.5 без item.create (эксперт) создать нельзя', async () => {
    const expert = await makeUser(services, admin, ['EXPERT'])
    await expect(
      services.items.createItem.run(
        expert.actor,
        { assignmentId: w.assignmentId, questionTypeId: w.qt('single_choice') },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('AT-ITEM-001.6 студент не создает вопрос неразрешенного типа (BR-018)', async () => {
    await expect(
      services.items.createItem.run(
        w.student.actor,
        { assignmentId: w.assignmentId, questionTypeId: w.qt('matching') },
        ctx,
      ),
    ).rejects.toMatchObject({
      ruleId: 'BR-018',
    })
  })

  it('AT-ITEM-001.7 студент не создает вопрос вне активного адресованного задания (BR-017)', async () => {
    await expect(
      services.items.createItem.run(
        w.student.actor,
        { assignmentId: other.assignmentId, questionTypeId: w.qt('single_choice') },
        ctx,
      ),
    ).rejects.toMatchObject({
      ruleId: 'BR-017',
    })
    await expect(
      services.items.createItem.run(
        w.student.actor,
        { courseId: w.courseId, questionTypeId: w.qt('single_choice') },
        ctx,
      ),
    ).rejects.toMatchObject({
      ruleId: 'BR-017',
    })
  })

  it('AT-ITEM-001.8 ownerId/state/authorIds в payload игнорируются', async () => {
    const r = await services.items.createItem.run(
      w.student.actor,
      {
        assignmentId: w.assignmentId,
        questionTypeId: w.qt('single_choice'),
        ownerId: w.teacher.id,
        state: 'APPROVED',
        document: { ...singleDoc(), state: 'APPROVED', authorIds: [w.teacher.id] },
      } as never,
      ctx,
    )
    const d = await services.items.getItem.run(w.student.actor, { id: r.itemId }, ctx)
    expect(d.item.ownerId).toBe(w.student.id)
    expect(d.version.state).toBe('DRAFT')
    expect(d.version.authorIds).toEqual([w.student.id])
  })

  it('AT-ITEM-001.9 архивированное или RESTRICTED медиа нельзя выбрать; AT-ITEM-001.2 image_choice с изображениями', async () => {
    const ok1 = await uploadImage(services, w.student.actor, { title: 'Куинджи' })
    const ok2 = await uploadImage(services, w.student.actor, { title: 'Шишкин' })
    const doc = {
      stem: 'Выберите работу Куинджи',
      options: [
        { key: 'o1', role: 'OPTION', text: '', mediaAssetId: ok1, ordinal: 0 },
        { key: 'o2', role: 'OPTION', text: '', mediaAssetId: ok2, ordinal: 1 },
      ],
      answerKey: { correct: ['o1'] },
    }
    const r = await services.items.createItem.run(
      w.student.actor,
      {
        assignmentId: w.assignmentId,
        questionTypeId: w.qt('image_choice'),
        document: doc,
        meta: { topicIds: [w.topicId] },
      },
      ctx,
    )
    // права не подтверждены → ошибки BR-024 до отправки
    expect(r.issues.map((i) => i.code)).toContain('BR-024')
    const archived = await uploadImage(services, w.student.actor, { title: 'В архиве' })
    await services.media.archiveMedia.run(w.student.actor, { id: archived, reason: 'x' }, ctx)
    const restricted = await uploadImage(services, w.student.actor, { title: 'Ограничено' })
    const m = await services.media.getMedia.run(w.teacher.actor, { id: restricted }, ctx)
    await services.media.setRightsStatus.run(
      w.teacher.actor,
      { id: restricted, status: 'RESTRICTED', note: 'запрет', revision: m.revision },
      ctx,
    )
    for (const bad of [archived, restricted]) {
      await expect(
        services.items.createItem.run(
          w.student.actor,
          {
            assignmentId: w.assignmentId,
            questionTypeId: w.qt('image_choice'),
            document: { ...doc, options: [{ ...doc.options[0]!, mediaAssetId: bad }, doc.options[1]!] },
          },
          ctx,
        ),
      ).rejects.toMatchObject({ code: 'VALIDATION' })
    }
  })

  it('тема вопроса задания должна входить в задание', async () => {
    const { id: foreign } = await services.education.createTopic.run(
      w.teacher.actor,
      { courseId: w.courseId, name: 'Не из задания' },
      ctx,
    )
    await expect(
      services.items.createItem.run(
        w.student.actor,
        {
          assignmentId: w.assignmentId,
          questionTypeId: w.qt('single_choice'),
          document: singleDoc(),
          meta: { topicIds: [foreign] },
        },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION' })
  })

  it('NFR-SEC-007 формулировка санитизируется', async () => {
    const r = await studentItem(
      '<p onclick="x()">Кто <b>автор</b>?<script>alert(1)</script><img src=x onerror=alert(2)></p>',
    )
    const d = await services.items.getItem.run(w.student.actor, { id: r.itemId }, ctx)
    expect(d.version.document.stem).toBe('<p>Кто <b>автор</b>?</p>')
  })
})

describe('SPEC-ITEM-002 Версии', () => {
  it('AT-ITEM-002.1 владелец редактирует черновик; аудит', async () => {
    const r = await studentItem()
    const d = await services.items.getItem.run(w.student.actor, { id: r.itemId }, ctx)
    const res = await services.items.saveDraft.run(
      w.student.actor,
      { itemId: r.itemId, document: singleDoc('Исправленная формулировка'), revision: d.version.revision },
      ctx,
    )
    expect(res.revision).toBe(d.version.revision + 1)
    const after = await services.items.getItem.run(w.student.actor, { id: r.itemId }, ctx)
    expect(after.version.document.stem).toBe('Исправленная формулировка')
    const audit = await db.selectFrom('audit_log').select('action').where('resource_id', '=', r.itemId).execute()
    expect(audit.map((a) => a.action)).toEqual(['item.created', 'item.draft.saved'])
  })

  it('AT-ITEM-002.2 студент не видит и не редактирует чужой черновик (404)', async () => {
    const r = await studentItem()
    const s2 = await makeUser(services, admin, ['STUDENT'])
    await expect(services.items.getItem.run(s2.actor, { id: r.itemId }, ctx)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    await expect(
      services.items.saveDraft.run(s2.actor, { itemId: r.itemId, document: singleDoc('взлом'), revision: 1 }, ctx),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('AT-ITEM-002.3 никто (включая Admin) не редактирует отправленную/утвержденную версию; триггер БД', async () => {
    const r = await services.items.createItem.run(
      w.teacher.actor,
      {
        courseId: w.courseId,
        questionTypeId: w.qt('single_choice'),
        document: singleDoc(),
        meta: { topicIds: [w.topicId] },
      },
      ctx,
    )
    await services.items.submitItem.run(w.teacher.actor, { itemId: r.itemId }, ctx)
    await expect(
      services.items.saveDraft.run(admin, { itemId: r.itemId, document: singleDoc('x'), revision: 1 }, ctx),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' })
    await expect(sql`update item_versions set stem = 'взлом' where id = ${r.versionId}`.execute(db)).rejects.toThrow(
      /frozen/,
    )
    await expect(
      sql`update item_options set text = 'взлом' where item_version_id = ${r.versionId}`.execute(db),
    ).rejects.toThrow(/frozen/)
    await forceState(r.versionId, 'APPROVED')
    await expect(sql`delete from item_options where item_version_id = ${r.versionId}`.execute(db)).rejects.toThrow(
      /frozen/,
    )
  })

  it('AT-ITEM-002.4 AT-ITEM-002.5 новая версия: v2 DRAFT, basedOn, ключи сохранены, v1 не изменена; второй черновик нельзя', async () => {
    const r = await services.items.createItem.run(
      w.teacher.actor,
      {
        courseId: w.courseId,
        questionTypeId: w.qt('single_choice'),
        document: singleDoc(),
        meta: { topicIds: [w.topicId] },
      },
      ctx,
    )
    await services.items.submitItem.run(w.teacher.actor, { itemId: r.itemId }, ctx)
    const v1 = await services.items.getItem.run(w.teacher.actor, { id: r.itemId, versionId: r.versionId }, ctx)
    const hash = v1.version.contentHash
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    await expect(services.items.createNewVersion.run(w.teacher.actor, { itemId: r.itemId }, ctx)).rejects.toMatchObject(
      { code: 'INVALID_STATE' },
    )
    await forceState(r.versionId, 'CHANGES_REQUESTED')
    const nv = await services.items.createNewVersion.run(w.teacher.actor, { itemId: r.itemId }, ctx)
    expect(nv.versionNo).toBe(2)
    const v2 = await services.items.getItem.run(w.teacher.actor, { id: r.itemId }, ctx)
    expect(v2.version.basedOnVersionId).toBe(r.versionId)
    expect(v2.version.document.options.map((o) => o.key)).toEqual(['o1', 'o2', 'o3'])
    await expect(services.items.createNewVersion.run(w.teacher.actor, { itemId: r.itemId }, ctx)).rejects.toMatchObject(
      { ruleId: 'BR-041' },
    )
    const again = await services.items.getItem.run(w.teacher.actor, { id: r.itemId, versionId: r.versionId }, ctx)
    expect(again.version.contentHash).toBe(hash)
    expect(again.version.document).toEqual(v1.version.document)
  })

  it('AT-ITEM-002.7 конфликт revision → CONFLICT без потери данных', async () => {
    const r = await studentItem()
    const d = await services.items.getItem.run(w.student.actor, { id: r.itemId }, ctx)
    await services.items.saveDraft.run(
      w.student.actor,
      { itemId: r.itemId, document: singleDoc('Первая правка'), revision: d.version.revision },
      ctx,
    )
    await expect(
      services.items.saveDraft.run(
        w.student.actor,
        { itemId: r.itemId, document: singleDoc('Вторая правка'), revision: d.version.revision },
        ctx,
      ),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
    })
    expect((await services.items.getItem.run(w.student.actor, { id: r.itemId }, ctx)).version.document.stem).toBe(
      'Первая правка',
    )
  })

  it('AT-ITEM-002.8 отзыв отправки возможен до начала экспертизы и невозможен после', async () => {
    const r = await services.items.createItem.run(
      w.teacher.actor,
      {
        courseId: w.courseId,
        questionTypeId: w.qt('single_choice'),
        document: singleDoc(),
        meta: { topicIds: [w.topicId] },
      },
      ctx,
    )
    await services.items.submitItem.run(w.teacher.actor, { itemId: r.itemId }, ctx)
    await services.items.recallItem.run(w.teacher.actor, { itemId: r.itemId, versionId: r.versionId }, ctx)
    expect((await services.items.getItem.run(w.teacher.actor, { id: r.itemId }, ctx)).version.state).toBe('DRAFT')
    await services.items.submitItem.run(w.teacher.actor, { itemId: r.itemId }, ctx)
    await forceState(r.versionId, 'IN_REVIEW')
    await expect(
      services.items.recallItem.run(w.teacher.actor, { itemId: r.itemId, versionId: r.versionId }, ctx),
    ).rejects.toMatchObject({ ruleId: 'BR-038' })
  })

  it('отправка: невалидный вопрос не отправляется (BR-020); вопрос задания — только в составе теста', async () => {
    const bad = await services.items.createItem.run(
      w.teacher.actor,
      { courseId: w.courseId, questionTypeId: w.qt('single_choice') },
      ctx,
    )
    await expect(services.items.submitItem.run(w.teacher.actor, { itemId: bad.itemId }, ctx)).rejects.toMatchObject({
      code: 'VALIDATION',
    })
    const s = await studentItem()
    await expect(services.items.submitItem.run(w.student.actor, { itemId: s.itemId }, ctx)).rejects.toMatchObject({
      code: 'INVALID_STATE',
    })
  })

  it('AT-ITEM-002.9 архивированный вопрос скрыт из банка; восстановление', async () => {
    const r = await studentItem('Архивный вопрос')
    await services.items.archiveItem.run(w.student.actor, { itemId: r.itemId, reason: 'неудачный' }, ctx)
    const list = await services.items.listItems.run(w.student.actor, { filters: {}, limit: 200, offset: 0 }, ctx)
    expect(list.records.map((x) => x.id)).not.toContain(r.itemId)
    const arch = await services.items.listItems.run(
      w.student.actor,
      { filters: { status: 'ARCHIVED' }, limit: 200, offset: 0 },
      ctx,
    )
    expect(arch.records.map((x) => x.id)).toContain(r.itemId)
    await services.items.restoreItem.run(w.student.actor, { itemId: r.itemId }, ctx)
  })

  it('AT-ITEM-002.10 удаление черновика: неотправлявшийся — физически, отправлявшийся — в архив', async () => {
    const r = await studentItem('Удаляемый')
    expect((await services.items.discardDraft.run(w.student.actor, { itemId: r.itemId }, ctx)).deleted).toBe('item')
    await expect(services.items.getItem.run(w.student.actor, { id: r.itemId }, ctx)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    const t = await services.items.createItem.run(
      w.teacher.actor,
      {
        courseId: w.courseId,
        questionTypeId: w.qt('single_choice'),
        document: singleDoc(),
        meta: { topicIds: [w.topicId] },
      },
      ctx,
    )
    await services.items.submitItem.run(w.teacher.actor, { itemId: t.itemId }, ctx)
    await services.items.recallItem.run(w.teacher.actor, { itemId: t.itemId, versionId: t.versionId }, ctx)
    expect((await services.items.discardDraft.run(w.teacher.actor, { itemId: t.itemId }, ctx)).deleted).toBe('archived')
    await expect(sql`delete from item_versions where id = ${t.versionId}`.execute(db)).rejects.toThrow(
      /cannot be deleted/,
    )
  })

  it('FR-ITEM-008 сравнение версий', async () => {
    const r = await services.items.createItem.run(
      w.teacher.actor,
      {
        courseId: w.courseId,
        questionTypeId: w.qt('single_choice'),
        document: singleDoc(),
        meta: { topicIds: [w.topicId] },
      },
      ctx,
    )
    await services.items.submitItem.run(w.teacher.actor, { itemId: r.itemId }, ctx)
    await forceState(r.versionId, 'APPROVED')
    const nv = await services.items.createNewVersion.run(w.teacher.actor, { itemId: r.itemId }, ctx)
    const d = await services.items.getItem.run(w.teacher.actor, { id: r.itemId }, ctx)
    await services.items.saveDraft.run(
      w.teacher.actor,
      {
        itemId: r.itemId,
        document: { ...singleDoc('Новая формулировка'), answerKey: { correct: ['o2'] } },
        revision: d.version.revision,
      },
      ctx,
    )
    const diff = await services.items.compareVersions.run(
      w.teacher.actor,
      { itemId: r.itemId, a: r.versionId, b: nv.versionId },
      ctx,
    )
    expect(diff.map((x) => x.field).sort()).toEqual(['answerKey', 'stem'])
  })
})

describe('SPEC-ITEM-003 Предпросмотр', () => {
  it('AT-ITEM-003.1 AT-ITEM-003.2 AT-ITEM-003.3 предпросмотр и оценка без сохранения ответа', async () => {
    const r = await studentItem()
    const p1 = await services.items.previewItem.run(w.student.actor, { itemId: r.itemId, seed: 5 }, ctx)
    const p2 = await services.items.previewItem.run(w.student.actor, { itemId: r.itemId, seed: 5 }, ctx)
    expect(p1.interactionKey).toBe('choice')
    expect(p1.options.map((o) => o.key)).toEqual(p2.options.map((o) => o.key))
    expect(
      (
        await services.items.evaluatePreview.run(
          w.student.actor,
          { itemId: r.itemId, response: { selected: ['o1'] } },
          ctx,
        )
      ).score,
    ).toBe(1)
    expect(
      (
        await services.items.evaluatePreview.run(
          w.student.actor,
          { itemId: r.itemId, response: { selected: ['o3'] } },
          ctx,
        )
      ).score,
    ).toBe(0)
    await expect(
      services.items.evaluatePreview.run(w.student.actor, { itemId: r.itemId, response: { selected: 'o1' } }, ctx),
    ).rejects.toMatchObject({ code: 'VALIDATION' })
    const d = await services.items.getItem.run(w.student.actor, { id: r.itemId }, ctx)
    expect(d.version.revision).toBe(1)
  })

  it('AT-ITEM-003.4 предпросмотр недоступен без доступа к вопросу (404)', async () => {
    const r = await studentItem()
    await expect(services.items.previewItem.run(other.student.actor, { itemId: r.itemId }, ctx)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })
})

describe('SPEC-ITEM-004 Доступ к вопросам', () => {
  it('AT-ITEM-004.1 студент не видит вопросы другого студента ни в списке, ни по id', async () => {
    const mine = await studentItem('Мой вопрос')
    const s2 = await makeUser(services, admin, ['STUDENT'])
    const list = await services.items.listItems.run(s2.actor, { filters: {}, limit: 500, offset: 0 }, ctx)
    expect(list.records.map((x) => x.id)).not.toContain(mine.itemId)
    expect(list.total).toBe(0)
  })

  it('AT-ITEM-004.2 преподаватель видит черновики студентов своего задания и не видит в чужих курсах', async () => {
    const mine = await studentItem('Для преподавателя')
    await expect(services.items.getItem.run(w.teacher.actor, { id: mine.itemId }, ctx)).resolves.toBeTruthy()
    await expect(services.items.getItem.run(other.teacher.actor, { id: mine.itemId }, ctx)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    const list = await services.items.listItems.run(other.teacher.actor, { filters: {}, limit: 500, offset: 0 }, ctx)
    expect(list.records.every((x) => x.courseId === other.courseId)).toBe(true)
  })

  it('AT-ITEM-004.3 эксперт без назначенных экспертиз не видит вопросов', async () => {
    const expert = await makeUser(services, admin, ['EXPERT'])
    const list = await services.items.listItems.run(expert.actor, { filters: {}, limit: 500, offset: 0 }, ctx)
    expect(list.total).toBe(0)
  })

  it('AT-ITEM-004.4 преподаватель курса видит УТВЕРЖДЕННЫЕ вопросы банка другого преподавателя, но не черновики', async () => {
    const t2 = await makeUser(services, admin, ['TEACHER'])
    const c = await services.education.getCourse.run(admin, { id: w.courseId }, ctx)
    await services.education.updateCourse.run(
      admin,
      {
        id: w.courseId,
        subjectId: c.subjectId,
        code: c.code,
        name: c.name,
        teacherIds: [...c.teacherIds, t2.id],
        revision: c.revision,
      },
      ctx,
    )
    const bank = await services.items.createItem.run(
      t2.actor,
      {
        courseId: w.courseId,
        questionTypeId: w.qt('single_choice'),
        document: singleDoc('Вопрос банка'),
        meta: { topicIds: [w.topicId] },
      },
      ctx,
    )
    await expect(services.items.getItem.run(w.teacher.actor, { id: bank.itemId }, ctx)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    await services.items.submitItem.run(t2.actor, { itemId: bank.itemId }, ctx)
    await forceState(bank.versionId, 'APPROVED')
    await db
      .updateTable('items')
      .set({ latest_approved_version_id: bank.versionId })
      .where('id', '=', bank.itemId)
      .execute()
    await services.items.createNewVersion.run(t2.actor, { itemId: bank.itemId }, ctx)
    const seen = await services.items.getItem.run(w.teacher.actor, { id: bank.itemId }, ctx)
    expect(seen.version.state).toBe('APPROVED')
    expect(seen.versions.map((v) => v.state)).toEqual(['APPROVED'])
    const list = await services.items.listItems.run(w.teacher.actor, { filters: {}, limit: 500, offset: 0 }, ctx)
    const row = list.records.find((x) => x.id === bank.itemId)!
    expect(row.state).toBe('APPROVED')
  })

  it('AT-ITEM-004.5 студент не может отправить на экспертизу чужой вопрос и не имеет review.perform', async () => {
    expect(w.student.actor.has('review.perform')).toBe(false)
  })

  it('AT-ITEM-004.6 count списка соответствует видимым записям', async () => {
    for (const a of [w.student.actor, w.teacher.actor, admin]) {
      const r = await services.items.listItems.run(a, { filters: {}, limit: 1000, offset: 0 }, ctx)
      expect(r.total).toBe(r.records.length)
    }
  })
})

describe('SPEC-ITEM-005 Фильтрация банка', () => {
  it('AT-ITEM-005.1 фильтр по теме включает подтемы; AT-ITEM-005.2 комбинация фильтров', async () => {
    const r = await studentItem('В подтеме') // тема — подтема задания
    const byParent = await services.items.listItems.run(
      w.teacher.actor,
      { filters: { topicId: w.topicId }, limit: 500, offset: 0 },
      ctx,
    )
    expect(byParent.records.map((x) => x.id)).toContain(r.itemId)
    const combo = await services.items.listItems.run(
      w.teacher.actor,
      {
        filters: { topicId: w.topicId, difficulty: '2', questionTypeId: w.qt('single_choice'), state: 'DRAFT' },
        limit: 500,
        offset: 0,
      },
      ctx,
    )
    expect(combo.records.length).toBeGreaterThan(0)
    expect(
      combo.records.every(
        (x) => x.difficulty === 2 && x.state === 'DRAFT' && x.questionTypeId === w.qt('single_choice'),
      ),
    ).toBe(true)
    const none = await services.items.listItems.run(
      w.teacher.actor,
      { filters: { topicId: w.topicId, difficulty: '5' }, limit: 500, offset: 0 },
      ctx,
    )
    expect(none.records.map((x) => x.id)).not.toContain(r.itemId)
  })

  it('AT-ITEM-005.3 архивированные скрыты по умолчанию; режим выбора — только утвержденные', async () => {
    const r = await studentItem('Скрытый')
    await services.items.archiveItem.run(w.student.actor, { itemId: r.itemId, reason: 'x' }, ctx)
    const list = await services.items.listItems.run(w.teacher.actor, { filters: {}, limit: 500, offset: 0 }, ctx)
    expect(list.records.map((x) => x.id)).not.toContain(r.itemId)
    const approved = await services.items.listItems.run(
      w.teacher.actor,
      { filters: { versionMode: 'LATEST_APPROVED' }, limit: 500, offset: 0 },
      ctx,
    )
    expect(approved.records.every((x) => x.state === 'APPROVED')).toBe(true)
  })
})
