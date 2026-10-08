import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Actor } from '../../src/domain/authorization/actor.js'
import type { Db } from '../../src/infrastructure/db/kysely.js'
import { createServices, type Services } from '../../src/server/container.js'
import { freshDb } from '../support/db.js'
import { makeCourseWorld } from '../support/education.js'
import { auditActions, ctx, makeUser, setupServices } from '../support/fixtures.js'
import { tempStorage, uploadImage } from '../support/media.js'
import { walkState } from '../support/states.js'

let db: Db
let services: Services
let admin: Actor
let expert: Actor

beforeAll(async () => {
  db = await freshDb()
  const s = await setupServices(db)
  admin = s.admin
  services = createServices(db, { storage: tempStorage() })
  expert = (await makeUser(services, admin, ['EXPERT'])).actor
})
afterAll(async () => db.destroy())

type World = Awaited<ReturnType<typeof makeCourseWorld>>

async function world(maxTests = 10): Promise<World> {
  const w = await makeCourseWorld(services, admin)
  await sql`update assignments set max_tests_per_student = ${maxTests} where id = ${w.assignmentId}`.execute(db)
  return w
}

let n = 0
const doc = (stem = `Кто автор «Грачи прилетели»? ${++n}`) => ({
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

async function studentItem(w: World, stem?: string) {
  return services.items.createItem.run(
    w.student.actor,
    {
      assignmentId: w.assignmentId,
      questionTypeId: w.qt('single_choice'),
      document: doc(stem),
      meta: { topicIds: [w.subtopicId], difficulty: 2 },
    },
    ctx,
  )
}

/** Утвержденный вопрос банка курса (решение экспертизы имитируется — M5). */
async function approvedBankItem(w: World, opts: { difficulty?: number; author?: Actor } = {}) {
  const r = await services.items.createItem.run(
    opts.author ?? w.teacher.actor,
    {
      courseId: w.courseId,
      questionTypeId: w.qt('single_choice'),
      document: doc(),
      meta: { topicIds: [w.topicId], difficulty: opts.difficulty ?? 3 },
    },
    ctx,
  )
  await forceItemState(r.versionId, 'APPROVED')
  await sql`update items set latest_approved_version_id = ${r.versionId}, current_draft_version_id = null where id = ${r.itemId}`.execute(
    db,
  )
  return r
}

const forceItemState = (versionId: string, state: string) => walkState(db, 'item_versions', versionId, state)
const forceTestState = (versionId: string, state: string) => walkState(db, 'test_versions', versionId, state)

/** Тест студента с двумя собственными вопросами в «Разделе 1». */
async function studentTest(w: World) {
  const i1 = await studentItem(w)
  const i2 = await studentItem(w)
  const t = await services.tests.createTest.run(
    w.student.actor,
    { assignmentId: w.assignmentId, title: 'Пейзаж XIX века' },
    ctx,
  )
  const d = await services.tests.getTest.run(w.student.actor, { id: t.testId }, ctx)
  const sectionId = d.sections[0]!.id
  await services.tests.addItem.run(w.student.actor, { testId: t.testId, sectionId, itemId: i1.itemId }, ctx)
  await services.tests.addItem.run(w.student.actor, { testId: t.testId, sectionId, itemId: i2.itemId }, ctx)
  return { ...t, sectionId, i1, i2 }
}

const codeOf = (p: Promise<unknown>) =>
  p.then(
    () => 'OK',
    (e) => e.ruleId ?? e.code,
  )

describe('SPEC-TEST-001 Создание теста', () => {
  it('AT-TEST-001.1 студент создает тест из задания: Test + v1 DRAFT + раздел по умолчанию', async () => {
    const w = await world()
    const t = await services.tests.createTest.run(
      w.student.actor,
      { assignmentId: w.assignmentId, title: 'Мой тест' },
      ctx,
    )
    const d = await services.tests.getTest.run(w.student.actor, { id: t.testId }, ctx)
    expect(d.test.ownerId).toBe(w.student.id)
    expect(d.test.assignmentId).toBe(w.assignmentId)
    expect(d.version.versionNo).toBe(1)
    expect(d.version.state).toBe('DRAFT')
    expect(d.sections.map((s) => s.title)).toEqual(['Раздел 1'])
    expect(d.version.settings.navigation).toBe('FREE')
    expect(d.canEdit).toBe(true)
    expect(d.canUseRules).toBe(false)
    expect(await auditActions(db, t.testId)).toContain('test.created')
  })

  it('AT-TEST-001.2 второй тест при maxTestsPerStudent = 1 отклоняется (BR-033)', async () => {
    const w = await world(1)
    await services.tests.createTest.run(w.student.actor, { assignmentId: w.assignmentId, title: 'Первый' }, ctx)
    expect(
      await codeOf(
        services.tests.createTest.run(w.student.actor, { assignmentId: w.assignmentId, title: 'Второй' }, ctx),
      ),
    ).toBe('BR-033')
  })

  it('AT-TEST-001.3 создание теста в неадресованном/закрытом задании отклоняется (BR-017)', async () => {
    const w = await world()
    const other = await world()
    expect(
      await codeOf(
        services.tests.createTest.run(other.student.actor, { assignmentId: w.assignmentId, title: 'Чужое' }, ctx),
      ),
    ).toBe('BR-017')
    await services.education.changeAssignmentStatus.run(w.teacher.actor, { id: w.assignmentId, action: 'close' }, ctx)
    expect(
      await codeOf(
        services.tests.createTest.run(w.student.actor, { assignmentId: w.assignmentId, title: 'Поздно' }, ctx),
      ),
    ).toBe('BR-017')
    expect(
      await codeOf(services.tests.createTest.run(w.student.actor, { courseId: w.courseId, title: 'Без задания' }, ctx)),
    ).toBe('BR-017')
  })

  it('AT-TEST-001.4 Expert не может создать тест', async () => {
    const w = await world()
    expect(await codeOf(services.tests.createTest.run(expert, { courseId: w.courseId, title: 'Эксперт' }, ctx))).toBe(
      'FORBIDDEN',
    )
  })

  it('преподаватель создает тест курса без задания', async () => {
    const w = await world()
    const t = await services.tests.createTest.run(w.teacher.actor, { courseId: w.courseId, title: 'Контрольная' }, ctx)
    const d = await services.tests.getTest.run(w.teacher.actor, { id: t.testId }, ctx)
    expect(d.test.assignmentId).toBeNull()
    expect(d.canUseRules).toBe(true)
  })
})

describe('SPEC-TEST-002 Структура теста', () => {
  it('AT-TEST-002.1 добавленный вопрос хранится как ссылка на конкретную ItemVersion (BR-010)', async () => {
    const w = await world()
    const t = await studentTest(w)
    const d = await services.tests.getTest.run(w.student.actor, { id: t.testId }, ctx)
    const pinned = d.sections[0]!.items.map((x) => x.itemVersionId).sort()
    expect(pinned).toEqual([t.i1.versionId, t.i2.versionId].sort())
    expect(d.itemCount).toBe(2)
    expect(d.maxScore).toBe(2)
  })

  it('AT-TEST-002.2 один Item нельзя добавить дважды', async () => {
    const w = await world()
    const t = await studentTest(w)
    expect(
      await codeOf(
        services.tests.addItem.run(
          w.student.actor,
          { testId: t.testId, sectionId: t.sectionId, itemId: t.i1.itemId },
          ctx,
        ),
      ),
    ).toBe('VALIDATION')
    const s2 = await services.tests.addSection.run(w.student.actor, { testId: t.testId, title: 'Раздел 2' }, ctx)
    expect(
      await codeOf(
        services.tests.addItem.run(
          w.student.actor,
          { testId: t.testId, sectionId: s2.sectionId, itemId: t.i1.itemId },
          ctx,
        ),
      ),
    ).toBe('VALIDATION')
  })

  it('AT-TEST-002.3 студент не может добавить чужой вопрос (любого состояния)', async () => {
    const w = await world()
    const t = await studentTest(w)
    const classmate = await makeUser(services, admin, ['STUDENT'])
    await services.education.setGroupMembers.run(
      w.teacher.actor,
      { id: w.groupId, memberIds: [w.student.id, classmate.id] },
      ctx,
    )
    const foreign = await services.items.createItem.run(
      classmate.actor,
      {
        assignmentId: w.assignmentId,
        questionTypeId: w.qt('single_choice'),
        document: doc(),
        meta: { topicIds: [w.subtopicId] },
      },
      ctx,
    )
    const bank = await approvedBankItem(w)
    for (const itemId of [foreign.itemId, bank.itemId]) {
      expect(['NOT_FOUND', 'FORBIDDEN']).toContain(
        await codeOf(
          services.tests.addItem.run(w.student.actor, { testId: t.testId, sectionId: t.sectionId, itemId }, ctx),
        ),
      )
    }
  })

  it('AT-TEST-002.4 студент не может создать SelectionRule', async () => {
    const w = await world()
    const t = await studentTest(w)
    expect(
      await codeOf(
        services.tests.addRule.run(
          w.student.actor,
          { testId: t.testId, sectionId: t.sectionId, count: 1, filter: { topicIds: [w.topicId] } },
          ctx,
        ),
      ),
    ).toBe('FORBIDDEN')
  })

  it('AT-TEST-002.5 размер пула считается только по APPROVED активным вопросам курса (BR-012)', async () => {
    const w = await world()
    const other = await world()
    await approvedBankItem(w, { difficulty: 2 })
    await approvedBankItem(w, { difficulty: 4 })
    const archived = await approvedBankItem(w)
    await services.items.archiveItem.run(w.teacher.actor, { itemId: archived.itemId, reason: 'устарел' }, ctx)
    await services.items.createItem.run(
      w.teacher.actor,
      { courseId: w.courseId, questionTypeId: w.qt('single_choice'), document: doc(), meta: { topicIds: [w.topicId] } },
      ctx,
    ) // черновик
    await approvedBankItem(other) // другой курс
    const t = await services.tests.createTest.run(w.teacher.actor, { courseId: w.courseId, title: 'Контрольная' }, ctx)
    const sec = (await services.tests.getTest.run(w.teacher.actor, { id: t.testId }, ctx)).sections[0]!.id
    const all = await services.tests.poolSize.run(
      w.teacher.actor,
      { testId: t.testId, filter: { topicIds: [w.topicId] } },
      ctx,
    )
    expect(all.poolSize).toBe(2)
    const hard = await services.tests.poolSize.run(
      w.teacher.actor,
      { testId: t.testId, filter: { topicIds: [w.topicId], difficultyMin: 3 } },
      ctx,
    )
    expect(hard.poolSize).toBe(1)
    // пул ≥ count не обязателен для сохранения, но блокирует отправку
    const rule = await services.tests.addRule.run(
      w.teacher.actor,
      { testId: t.testId, sectionId: sec, count: 3, pointsPerItem: 2, filter: { topicIds: [w.topicId] } },
      ctx,
    )
    expect(rule.poolSize).toBe(2)
    const d = await services.tests.getTest.run(w.teacher.actor, { id: t.testId }, ctx)
    expect(d.maxScore).toBe(6)
    expect(d.issues.map((i) => i.code)).toContain('BR-012')
    // фиксированный вопрос исключается из пула
    const fixed = await approvedBankItem(w)
    await services.tests.addItem.run(w.teacher.actor, { testId: t.testId, sectionId: sec, itemId: fixed.itemId }, ctx)
    expect(
      (await services.tests.poolSize.run(w.teacher.actor, { testId: t.testId, filter: { topicIds: [w.topicId] } }, ctx))
        .poolSize,
    ).toBe(2)
  })

  it('AT-TEST-002.6 структуру не-DRAFT версии изменить нельзя (BR-007)', async () => {
    const w = await world()
    const t = await studentTest(w)
    await services.tests.submitTest.run(w.student.actor, { testId: t.testId }, ctx)
    expect(
      await codeOf(services.tests.addSection.run(w.student.actor, { testId: t.testId, title: 'Новый' }, ctx)),
    ).toBe('BR-007')
    expect(await codeOf(services.tests.addSection.run(admin, { testId: t.testId, title: 'Новый' }, ctx))).toBe('BR-007')
    await expect(
      sql`insert into test_sections (test_version_id, title, ordinal) values (${t.versionId}, 'Обход', 9)`.execute(db),
    ).rejects.toThrow(/frozen/)
    await expect(
      sql`update test_section_items set points = 50 where test_version_id = ${t.versionId}`.execute(db),
    ).rejects.toThrow(/frozen/)
    await expect(sql`delete from test_sections where test_version_id = ${t.versionId}`.execute(db)).rejects.toThrow(
      /frozen/,
    )
  })

  it('AT-TEST-002.7 архивированный Item нельзя добавить (BR-039)', async () => {
    const w = await world()
    const bank = await approvedBankItem(w)
    await services.items.archiveItem.run(w.teacher.actor, { itemId: bank.itemId, reason: 'устарел' }, ctx)
    const t = await services.tests.createTest.run(w.teacher.actor, { courseId: w.courseId, title: 'Контрольная' }, ctx)
    const sec = (await services.tests.getTest.run(w.teacher.actor, { id: t.testId }, ctx)).sections[0]!.id
    expect(
      await codeOf(
        services.tests.addItem.run(w.teacher.actor, { testId: t.testId, sectionId: sec, itemId: bank.itemId }, ctx),
      ),
    ).toBe('BR-039')
  })

  it('A5: доступна новая утвержденная версия — «обновить» перепривязывает черновик', async () => {
    const w = await world()
    const bank = await approvedBankItem(w)
    const t = await services.tests.createTest.run(w.teacher.actor, { courseId: w.courseId, title: 'Контрольная' }, ctx)
    const sec = (await services.tests.getTest.run(w.teacher.actor, { id: t.testId }, ctx)).sections[0]!.id
    const e = await services.tests.addItem.run(
      w.teacher.actor,
      { testId: t.testId, sectionId: sec, itemId: bank.itemId },
      ctx,
    )
    const v2 = await services.items.createNewVersion.run(w.teacher.actor, { itemId: bank.itemId }, ctx)
    await forceItemState(v2.versionId, 'APPROVED')
    await sql`update items set latest_approved_version_id = ${v2.versionId}, current_draft_version_id = null where id = ${bank.itemId}`.execute(
      db,
    )
    const d = await services.tests.getTest.run(w.teacher.actor, { id: t.testId }, ctx)
    expect(d.sections[0]!.items[0]!.newerApprovedVersionNo).toBe(2)
    const up = await services.tests.upgradeItem.run(w.teacher.actor, { testId: t.testId, entryId: e.entryId }, ctx)
    expect(up.itemVersionId).toBe(v2.versionId)
  })

  it('чужой неутвержденный вопрос банка нельзя добавить (BR-011)', async () => {
    const w = await world()
    const colleague = await makeUser(services, admin, ['TEACHER'])
    await sql`insert into course_teachers (course_id, user_id) values (${w.courseId}, ${colleague.id})`.execute(db)
    const draft = await services.items.createItem.run(
      colleague.actor,
      { courseId: w.courseId, questionTypeId: w.qt('single_choice'), document: doc(), meta: { topicIds: [w.topicId] } },
      ctx,
    )
    const t = await services.tests.createTest.run(w.teacher.actor, { courseId: w.courseId, title: 'Контрольная' }, ctx)
    const sec = (await services.tests.getTest.run(w.teacher.actor, { id: t.testId }, ctx)).sections[0]!.id
    expect(['BR-011', 'NOT_FOUND']).toContain(
      await codeOf(
        services.tests.addItem.run(w.teacher.actor, { testId: t.testId, sectionId: sec, itemId: draft.itemId }, ctx),
      ),
    )
  })
})

describe('SPEC-TEST-003 Настройки и предпросмотр', () => {
  it('AT-TEST-003.1 настройки сохраняются в DRAFT и неизменны после submit', async () => {
    const w = await world()
    const t = await studentTest(w)
    const d = await services.tests.getTest.run(w.student.actor, { id: t.testId }, ctx)
    await services.tests.updateDraft.run(
      w.student.actor,
      {
        testId: t.testId,
        revision: d.version.revision,
        settings: { timeLimitSec: 1200, navigation: 'LINEAR', passingScore: 1 },
      },
      ctx,
    )
    const after = await services.tests.getTest.run(w.student.actor, { id: t.testId }, ctx)
    expect(after.version.settings.timeLimitSec).toBe(1200)
    expect(after.version.settings.navigation).toBe('LINEAR')
    expect(after.version.settings.scoring.passingScore).toBe(1)
    await services.tests.submitTest.run(w.student.actor, { testId: t.testId }, ctx)
    expect(
      await codeOf(
        services.tests.updateDraft.run(
          w.student.actor,
          { testId: t.testId, revision: after.version.revision, settings: { timeLimitSec: 60 } },
          ctx,
        ),
      ),
    ).toBe('BR-007')
    await expect(
      sql`update test_versions set settings = '{}'::jsonb where id = ${t.versionId}`.execute(db),
    ).rejects.toThrow(/frozen/)
  })

  it('AT-TEST-003.2 невалидные значения настроек отклоняются', async () => {
    const w = await world()
    const t = await studentTest(w)
    const rev = (await services.tests.getTest.run(w.student.actor, { id: t.testId }, ctx)).version.revision
    for (const settings of [{ timeLimitSec: 10 }, { maxAttempts: 50 }, { passingScore: 5 }, { navigation: 'RANDOM' }]) {
      expect(
        await codeOf(
          services.tests.updateDraft.run(w.student.actor, { testId: t.testId, revision: rev, settings }, ctx),
        ),
      ).toBe('VALIDATION')
    }
    expect(await codeOf(services.tests.addSection.run(w.student.actor, { testId: t.testId, title: '' }, ctx))).toBe(
      'VALIDATION',
    )
  })

  it('AT-TEST-003.3 preview с одинаковым seed дает одинаковую выборку и порядок', async () => {
    const w = await world()
    for (let i = 0; i < 6; i++) await approvedBankItem(w)
    const t = await services.tests.createTest.run(w.teacher.actor, { courseId: w.courseId, title: 'Случайный' }, ctx)
    const d = await services.tests.getTest.run(w.teacher.actor, { id: t.testId }, ctx)
    await services.tests.addRule.run(
      w.teacher.actor,
      { testId: t.testId, sectionId: d.sections[0]!.id, count: 3, filter: { topicIds: [w.topicId] } },
      ctx,
    )
    await services.tests.updateDraft.run(
      w.teacher.actor,
      { testId: t.testId, revision: d.version.revision + 1, settings: { shuffleItems: true } },
      ctx,
    )
    const ids = async (seed: number) =>
      (await services.tests.previewTest.run(w.teacher.actor, { testId: t.testId, seed }, ctx)).sections[0]!.items.map(
        (x) => `${x.itemVersionId}:${x.preview.options.map((o) => o.key).join('')}`,
      )
    const a = await ids(7)
    expect(a).toHaveLength(3)
    expect(await ids(7)).toEqual(a)
    const variants = new Set([a.join(), (await ids(8)).join(), (await ids(9)).join(), (await ids(10)).join()])
    expect(variants.size).toBeGreaterThan(1)
  })

  it('AT-TEST-003.4 preview APPROVED версии использует замороженный пул', async () => {
    const w = await world()
    const a = await approvedBankItem(w)
    await approvedBankItem(w)
    const t = await services.tests.createTest.run(w.teacher.actor, { courseId: w.courseId, title: 'Пул' }, ctx)
    const d = await services.tests.getTest.run(w.teacher.actor, { id: t.testId }, ctx)
    const rule = await services.tests.addRule.run(
      w.teacher.actor,
      { testId: t.testId, sectionId: d.sections[0]!.id, count: 1, filter: { topicIds: [w.topicId] } },
      ctx,
    )
    await services.tests.submitTest.run(w.teacher.actor, { testId: t.testId }, ctx)
    // заморозка пула при approve (M5): разрешена только в IN_REVIEW
    await forceTestState(t.versionId, 'IN_REVIEW')
    await sql`insert into selection_pool_entries (selection_rule_id, item_version_id) values (${rule.ruleId}, ${a.versionId})`.execute(
      db,
    )
    await forceTestState(t.versionId, 'APPROVED')
    await sql`update test_versions set approved_at = now() where id = ${t.versionId}`.execute(db)
    await expect(
      sql`delete from selection_pool_entries where selection_rule_id = ${rule.ruleId}`.execute(db),
    ).rejects.toThrow(/frozen/)
    for (let i = 0; i < 3; i++) await approvedBankItem(w)
    for (const seed of [1, 2, 3, 4]) {
      const p = await services.tests.previewTest.run(w.teacher.actor, { testId: t.testId, seed }, ctx)
      expect(p.sections[0]!.items.map((x) => x.itemVersionId)).toEqual([a.versionId])
    }
    const after = await services.tests.getTest.run(w.teacher.actor, { id: t.testId }, ctx)
    expect(after.sections[0]!.rules[0]!.poolSize).toBe(1)
  })
})

describe('SPEC-TEST-004 Готовность, отправка, новые версии', () => {
  it('AT-TEST-004.1 submit замораживает TestVersion и собственные DRAFT ItemVersion (пакет review)', async () => {
    const w = await world()
    const t = await studentTest(w)
    const ready = await services.tests.checkReadiness.run(w.student.actor, { testId: t.testId }, ctx)
    expect(ready.issues).toEqual([])
    const r = await services.tests.submitTest.run(w.student.actor, { testId: t.testId }, ctx)
    expect(r.packageItemVersionIds.sort()).toEqual([t.i1.versionId, t.i2.versionId].sort())
    const d = await services.tests.getTest.run(w.student.actor, { id: t.testId }, ctx)
    expect(d.version.state).toBe('READY_FOR_REVIEW')
    expect(d.version.contentHash).toMatch(/^[0-9a-f]{64}$/)
    expect(d.test.currentDraftVersionId).toBeNull()
    for (const id of [t.i1.itemId, t.i2.itemId]) {
      const it = await services.items.getItem.run(w.student.actor, { id }, ctx)
      expect(it.version.state).toBe('READY_FOR_REVIEW')
      expect(it.item.currentDraftVersionId).toBeNull()
    }
    expect(await auditActions(db, t.testId)).toContain('test.submitted')
  })

  it('AT-TEST-004.2 после submit изменить версию нельзя никому (прямой запрос)', async () => {
    const w = await world()
    const t = await studentTest(w)
    await services.tests.submitTest.run(w.student.actor, { testId: t.testId }, ctx)
    for (const a of [w.student.actor, admin]) {
      expect(
        await codeOf(
          services.tests.addItem.run(a, { testId: t.testId, sectionId: t.sectionId, itemId: t.i1.itemId }, ctx),
        ),
      ).toBe('BR-007')
    }
    expect(
      await codeOf(
        services.items.saveDraft.run(
          w.student.actor,
          { itemId: t.i1.itemId, document: doc('правка'), revision: 1 },
          ctx,
        ),
      ),
    ).toBe('BR-007')
    await expect(sql`update test_versions set title = 'взлом' where id = ${t.versionId}`.execute(db)).rejects.toThrow(
      /frozen/,
    )
    await expect(sql`update item_versions set stem = 'взлом' where id = ${t.i1.versionId}`.execute(db)).rejects.toThrow(
      /frozen/,
    )
  })

  it('AT-TEST-004.3 submit с невалидным вопросом / без alt / с PENDING медиа отклоняется со списком причин', async () => {
    const w = await world()
    const pending = await uploadImage(services, w.student.actor, { title: 'Без прав' })
    const noAlt = await uploadImage(services, w.teacher.actor, { title: 'Без alt', alt: null, cleared: true })
    const img = await services.items.createItem.run(
      w.student.actor,
      {
        assignmentId: w.assignmentId,
        questionTypeId: w.qt('image_choice'),
        document: {
          stem: 'Какая работа принадлежит Куинджи?',
          content: {},
          options: [
            { key: 'a', role: 'OPTION', mediaAssetId: pending, ordinal: 0 },
            { key: 'b', role: 'OPTION', mediaAssetId: noAlt, ordinal: 1 },
          ],
          media: [],
          answerKey: { correct: ['a'] },
        },
        meta: { topicIds: [w.subtopicId] },
      },
      ctx,
    )
    const invalid = await services.items.createItem.run(
      w.student.actor,
      {
        assignmentId: w.assignmentId,
        questionTypeId: w.qt('single_choice'),
        document: { stem: '' },
        meta: { topicIds: [w.subtopicId] },
      },
      ctx,
    )
    const t = await services.tests.createTest.run(
      w.student.actor,
      { assignmentId: w.assignmentId, title: 'С ошибками' },
      ctx,
    )
    const sec = (await services.tests.getTest.run(w.student.actor, { id: t.testId }, ctx)).sections[0]!.id
    await services.tests.addItem.run(w.student.actor, { testId: t.testId, sectionId: sec, itemId: img.itemId }, ctx)
    await services.tests.addItem.run(w.student.actor, { testId: t.testId, sectionId: sec, itemId: invalid.itemId }, ctx)
    const err = await services.tests.submitTest.run(w.student.actor, { testId: t.testId }, ctx).catch((e) => e)
    expect(err.code).toBe('RULE_VIOLATION')
    const messages = err.fieldErrors.map((f: { message: string }) => f.message).join('\n')
    expect(messages).toMatch(/BR-024/)
    expect(messages).toMatch(/BR-025|альтернатив/i)
    expect(err.fieldErrors.length).toBeGreaterThanOrEqual(3)
    expect((await services.tests.getTest.run(w.student.actor, { id: t.testId }, ctx)).version.state).toBe('DRAFT')
  })

  it('AT-TEST-004.4 число вопросов вне [min,max] или неразрешенный тип → отказ (BR-032)', async () => {
    const w = await world()
    const one = await studentItem(w)
    const t = await services.tests.createTest.run(w.student.actor, { assignmentId: w.assignmentId, title: 'Мало' }, ctx)
    const sec = (await services.tests.getTest.run(w.student.actor, { id: t.testId }, ctx)).sections[0]!.id
    await services.tests.addItem.run(w.student.actor, { testId: t.testId, sectionId: sec, itemId: one.itemId }, ctx)
    expect(await codeOf(services.tests.submitTest.run(w.student.actor, { testId: t.testId }, ctx))).toBe('BR-032')
    const two = await studentItem(w)
    await services.tests.addItem.run(w.student.actor, { testId: t.testId, sectionId: sec, itemId: two.itemId }, ctx)
    // преподаватель запрещает single_choice в задании
    await sql`delete from assignment_question_types where assignment_id = ${w.assignmentId} and question_type_id = ${w.qt('single_choice')}`.execute(
      db,
    )
    const err = await services.tests.submitTest.run(w.student.actor, { testId: t.testId }, ctx).catch((e) => e)
    expect(err.ruleId).toBe('BR-032')
    expect(err.message).toMatch(/не разрешен/)
  })

  it('AT-TEST-004.5 первая отправка после дедлайна → отказ (BR-031); продление разрешает', async () => {
    const w = await world()
    const t = await studentTest(w)
    const late = createServices(db, {
      storage: tempStorage(),
      clock: { now: () => new Date(Date.now() + 10 * 86400_000) },
    })
    expect(await codeOf(late.tests.submitTest.run(w.student.actor, { testId: t.testId }, ctx))).toBe('BR-031')
    await services.education.extendDeadline.run(
      w.teacher.actor,
      { id: w.assignmentId, userId: w.student.id, newDeadlineAt: new Date(Date.now() + 20 * 86400_000) },
      ctx,
    )
    expect(await codeOf(late.tests.submitTest.run(w.student.actor, { testId: t.testId }, ctx))).toBe('OK')
  })

  it('AT-TEST-004.6 recall до начала review возвращает DRAFT; после — невозможен (BR-038)', async () => {
    const w = await world()
    const t = await studentTest(w)
    await services.tests.submitTest.run(w.student.actor, { testId: t.testId }, ctx)
    // вопрос пакета нельзя отозвать отдельно от теста
    expect(
      await codeOf(
        services.items.recallItem.run(w.student.actor, { itemId: t.i1.itemId, versionId: t.i1.versionId }, ctx),
      ),
    ).toBe('INVALID_STATE')
    await services.tests.recallTest.run(w.student.actor, { testId: t.testId }, ctx)
    const d = await services.tests.getTest.run(w.student.actor, { id: t.testId }, ctx)
    expect(d.version.state).toBe('DRAFT')
    expect(d.test.currentDraftVersionId).toBe(t.versionId)
    const it1 = await services.items.getItem.run(w.student.actor, { id: t.i1.itemId }, ctx)
    expect(it1.version.state).toBe('DRAFT')
    expect(it1.canEdit).toBe(true)
    await services.tests.submitTest.run(w.student.actor, { testId: t.testId }, ctx)
    await forceTestState(t.versionId, 'IN_REVIEW')
    expect(await codeOf(services.tests.recallTest.run(w.student.actor, { testId: t.testId }, ctx))).toBe('BR-038')
  })

  it('AT-TEST-004.7 новая версия после CHANGES_REQUESTED: v2 DRAFT, вопросы автора получили новые DRAFT-версии, v1 неизменна', async () => {
    const w = await world()
    const t = await studentTest(w)
    await services.tests.submitTest.run(w.student.actor, { testId: t.testId }, ctx)
    const v1 = await services.tests.getTest.run(w.student.actor, { id: t.testId }, ctx)
    // решение эксперта «на доработку» (M5): тест и пакет → CHANGES_REQUESTED
    await forceTestState(t.versionId, 'CHANGES_REQUESTED')
    for (const v of [t.i1.versionId, t.i2.versionId]) await forceItemState(v, 'CHANGES_REQUESTED')
    expect(
      await codeOf(services.tests.updateDraft.run(w.student.actor, { testId: t.testId, revision: 1, title: 'x' }, ctx)),
    ).toBe('BR-007')
    const nv = await services.tests.createNewVersion.run(w.student.actor, { testId: t.testId }, ctx)
    expect(nv.versionNo).toBe(2)
    expect(nv.newItemVersions).toHaveLength(2)
    const v2 = await services.tests.getTest.run(w.student.actor, { id: t.testId }, ctx)
    expect(v2.version.state).toBe('DRAFT')
    expect(v2.version.basedOnVersionId).toBe(t.versionId)
    const pinned = v2.sections[0]!.items
    expect(pinned.every((x) => x.versionNo === 2 && x.versionState === 'DRAFT')).toBe(true)
    const old = await services.tests.getTest.run(w.student.actor, { id: t.testId, versionId: t.versionId }, ctx)
    expect(old.version.contentHash).toBe(v1.version.contentHash)
    expect(old.sections[0]!.items.map((x) => x.itemVersionId).sort()).toEqual([t.i1.versionId, t.i2.versionId].sort())
    expect(await codeOf(services.tests.createNewVersion.run(w.student.actor, { testId: t.testId }, ctx))).toBe('BR-041')
    // доработанная версия снова отправляется (повторная отправка после дедлайна разрешена — BR-031)
    const late = createServices(db, {
      storage: tempStorage(),
      clock: { now: () => new Date(Date.now() + 10 * 86400_000) },
    })
    expect(await codeOf(late.tests.submitTest.run(w.student.actor, { testId: t.testId }, ctx))).toBe('OK')
  })

  it('AT-TEST-004.8 все изменения submit атомарны: сбой на любом шаге не оставляет частичных изменений', async () => {
    const w = await world()
    const t = await studentTest(w)
    const failing = createServices(db, { storage: tempStorage() })
    const broken = Object.assign({}, failing)
    const { createTestUseCases } = await import('../../src/application/assessment/test-use-cases.js')
    broken.tests = createTestUseCases({
      uow: failing.uow,
      clock: { now: () => new Date() },
      items: failing.items,
      onSubmitted: async () => {
        throw new Error('сбой создания review')
      },
    })
    await expect(broken.tests.submitTest.run(w.student.actor, { testId: t.testId }, ctx)).rejects.toThrow(/сбой/)
    const d = await services.tests.getTest.run(w.student.actor, { id: t.testId }, ctx)
    expect(d.version.state).toBe('DRAFT')
    expect(d.version.packageItemVersionIds).toEqual([])
    expect(d.test.currentDraftVersionId).toBe(t.versionId)
    for (const id of [t.i1.itemId, t.i2.itemId]) {
      expect((await services.items.getItem.run(w.student.actor, { id }, ctx)).version.state).toBe('DRAFT')
    }
    expect(await auditActions(db, t.testId)).not.toContain('test.submitted')
  })
})

describe('SPEC-ITEM-002 auto-rebind', () => {
  it('AT-ITEM-002.6 auto-rebind обновляет ссылку в DRAFT тесте автора и не трогает не-DRAFT тесты', async () => {
    const w = await world()
    const bank = await services.items.createItem.run(
      w.teacher.actor,
      { courseId: w.courseId, questionTypeId: w.qt('single_choice'), document: doc(), meta: { topicIds: [w.topicId] } },
      ctx,
    )
    const draftTest = await services.tests.createTest.run(
      w.teacher.actor,
      { courseId: w.courseId, title: 'Черновик' },
      ctx,
    )
    const frozenTest = await services.tests.createTest.run(
      w.teacher.actor,
      { courseId: w.courseId, title: 'Отправлен' },
      ctx,
    )
    for (const t of [draftTest, frozenTest]) {
      const sec = (await services.tests.getTest.run(w.teacher.actor, { id: t.testId }, ctx)).sections[0]!.id
      await services.tests.addItem.run(w.teacher.actor, { testId: t.testId, sectionId: sec, itemId: bank.itemId }, ctx)
    }
    await forceTestState(frozenTest.versionId, 'IN_REVIEW')
    await forceItemState(bank.versionId, 'CHANGES_REQUESTED')
    await sql`update items set current_draft_version_id = null where id = ${bank.itemId}`.execute(db)
    const v2 = await services.items.createNewVersion.run(w.teacher.actor, { itemId: bank.itemId }, ctx)
    const pinnedIn = async (testId: string) =>
      (await services.tests.getTest.run(w.teacher.actor, { id: testId }, ctx)).sections[0]!.items[0]!.itemVersionId
    expect(await pinnedIn(draftTest.testId)).toBe(v2.versionId)
    expect(await pinnedIn(frozenTest.testId)).toBe(bank.versionId)
    expect(await auditActions(db, draftTest.testId)).toContain('test.item.rebound')
  })
})

describe('SPEC-ASSIGN-002 сводка по заданию', () => {
  it('AT-ASSIGN-002.6 сводка показывает состояние последней версии теста каждого адресата', async () => {
    const w = await world()
    const silent = await makeUser(services, admin, ['STUDENT'], { displayName: 'Яковлев' })
    await services.education.setGroupMembers.run(
      w.teacher.actor,
      { id: w.groupId, memberIds: [w.student.id, silent.id] },
      ctx,
    )
    const t = await studentTest(w)
    await services.tests.submitTest.run(w.student.actor, { testId: t.testId }, ctx)
    const rows = await services.tests.assignmentSummary.run(w.teacher.actor, { assignmentId: w.assignmentId }, ctx)
    const me = rows.find((r) => r.userId === w.student.id)!
    expect(me.testCount).toBe(1)
    expect(me.latestState).toBe('READY_FOR_REVIEW')
    expect(me.latestVersionNo).toBe(1)
    const other = rows.find((r) => r.userId === silent.id)!
    expect(other.testCount).toBe(0)
    expect(other.latestState).toBeNull()
    expect(
      await codeOf(services.tests.assignmentSummary.run(w.student.actor, { assignmentId: w.assignmentId }, ctx)),
    ).toBe('NOT_FOUND')
  })
})
