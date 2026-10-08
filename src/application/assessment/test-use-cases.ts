import { createHash } from 'node:crypto'
import { z } from 'zod'
import { requireScope, scopeFilter, type Actor } from '../../domain/authorization/actor.js'
import type { Scope } from '../../domain/authorization/scope.js'
import {
  DEFAULT_TEST_SETTINGS,
  itemCount,
  maxScore,
  validateSectionLimit,
  validateSettings,
  type SelectionFilter,
  type TestSettings,
} from '../../domain/assessment/test-rules.js'
import { assertStudentCanCreate, effectiveDeadline, type AssignmentStatus } from '../../domain/education/assignment.js'
import { canonicalJson, seededShuffle, type Issue } from '../../domain/itembank/interaction.js'
import { DomainError } from '../../domain/shared/errors.js'
import { canBranch, transition, type VersionState } from '../../domain/versioning/state-machine.js'
import type { AssignmentRecord } from '../education/ports.js'
import { sanitizeRichText, type ItemUseCases, type PreviewData } from '../itembank/item-use-cases.js'
import type { Clock, RequestContext } from '../shared/context.js'
import type { ListQuery } from '../shared/query.js'
import type { UnitOfWork } from '../shared/uow.js'
import { useCase } from '../shared/use-case.js'
import type {
  AssessmentTx,
  AssignmentSummaryRow,
  FixedItemRecord,
  RuleRecord,
  SectionRecord,
  TestRecord,
  TestStructure,
  TestVersionRecord,
} from './ports.js'

export interface TestDeps {
  uow: UnitOfWork<AssessmentTx>
  clock: Clock
  items: ItemUseCases
  /** Создание Review + ReviewAssignment при отправке (M5, SPEC-REVIEW-001). Выполняется в транзакции отправки. */
  onSubmitted?: (
    tx: AssessmentTx,
    actor: Actor,
    test: TestRecord,
    version: { id: string; packageItemVersionIds: string[] },
    ctx: RequestContext,
  ) => Promise<void>
  /** Отмена review при отзыве (BR-038, M5). */
  onRecalled?: (
    tx: AssessmentTx,
    actor: Actor,
    test: TestRecord,
    versionId: string,
    ctx: RequestContext,
  ) => Promise<void>
}

// ---------------- входные схемы ----------------
const titleSchema = z.string().trim().min(1, 'Укажите название').max(200, 'Не длиннее 200 символов')
const nullableInt = z.preprocess(
  (v) => (v === '' || v === undefined ? null : v),
  z.coerce.number().int().nullable(),
) as z.ZodType<number | null>
const nullableNum = z.preprocess(
  (v) => (v === '' || v === undefined ? null : v),
  z.coerce.number().nullable(),
) as z.ZodType<number | null>
const boolish = z.preprocess((v) => v === true || v === 'true', z.boolean())

const settingsSchema = z.object({
  timeLimitSec: nullableInt.optional(),
  navigation: z.enum(['LINEAR', 'FREE']).optional(),
  maxAttempts: nullableInt.optional(),
  shuffleSections: boolish.optional(),
  shuffleItems: boolish.optional(),
  shuffleOptions: boolish.optional(),
  feedbackMode: z.enum(['NONE', 'AFTER_SUBMIT', 'AFTER_CLOSE']).optional(),
  passingScore: nullableNum.optional(),
})

const filterSchema = z.object({
  topicIds: z.array(z.string()).default([]),
  objectiveIds: z.array(z.string()).default([]),
  tags: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  questionTypeIds: z.array(z.string()).default([]),
  difficultyMin: nullableInt.default(null),
  difficultyMax: nullableInt.default(null),
})

function zParse<T>(schema: z.ZodType<T>, input: unknown, prefix = ''): T {
  const r = schema.safeParse(input === undefined ? {} : input)
  if (!r.success)
    throw DomainError.validation(
      r.error.issues.map((i) => ({ field: `${prefix}${i.path.join('.')}` || 'form', message: i.message })),
    )
  return r.data
}

const points = (v: unknown, field = 'points') => {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0 || n > 100)
    throw DomainError.validation([{ field, message: 'Баллы — число больше 0 и не более 100' }])
  return Math.round(n * 100) / 100
}

export interface SectionView extends SectionRecord {
  items: (FixedItemRecord & { newerApprovedVersionNo: number | null })[]
  rules: (RuleRecord & { poolSize: number })[]
}

export interface TestDetails {
  test: TestRecord
  version: TestVersionRecord
  versions: { id: string; versionNo: number; state: VersionState; createdAt: Date }[]
  sections: SectionView[]
  maxScore: number
  itemCount: number
  issues: Issue[]
  assignment: Pick<AssignmentRecord, 'id' | 'title' | 'minItems' | 'maxItems' | 'status' | 'deadlineAt'> | null
  canEdit: boolean
  canUseRules: boolean
  canSubmit: boolean
  canRecall: boolean
  canBranch: boolean
}

export interface TestPreview {
  title: string
  versionNo: number
  state: VersionState
  settings: TestSettings
  maxScore: number
  warnings: string[]
  sections: {
    title: string
    instructions: string | null
    timeLimitSec: number | null
    items: { itemVersionId: string; points: number; source: 'FIXED' | 'RULE'; preview: PreviewData }[]
  }[]
}

export function testContentHash(version: TestVersionRecord, s: TestStructure): string {
  const norm = {
    title: version.title,
    description: version.description,
    instructions: version.instructions,
    settings: version.settings,
    sections: s.sections.map((sec) => ({
      title: sec.title,
      instructions: sec.instructions,
      ordinal: sec.ordinal,
      timeLimitSec: sec.timeLimitSec,
      shuffleItems: sec.shuffleItems,
      items: s.fixed
        .filter((f) => f.sectionId === sec.id)
        .map((f) => ({ itemVersionId: f.itemVersionId, points: f.points, ordinal: f.ordinal })),
      rules: s.rules
        .filter((r) => r.sectionId === sec.id)
        .map((r) => ({ count: r.count, pointsPerItem: r.pointsPerItem, filter: r.filter, ordinal: r.ordinal })),
    })),
  }
  return createHash('sha256').update(canonicalJson(norm)).digest('hex')
}

export function createTestUseCases(deps: TestDeps) {
  const { uow, clock } = deps
  const r = () => uow.read

  async function loadTest(id: string) {
    const t = await r().tests.findById(id)
    if (!t) throw DomainError.notFound()
    return t
  }

  async function testScopes(actor: Actor, test: TestRecord): Promise<Set<Scope>> {
    const rel = await r().tests.relations(actor.userId, test.id)
    const s = new Set<Scope>()
    if (rel.own) s.add('OWN')
    if (rel.assignedViaAssignment) s.add('ASSIGNED')
    if (rel.courseTeacher) s.add('COURSE')
    return s
  }

  /** Невидимый тест — 404 (не раскрываем существование). */
  async function requireRead(actor: Actor, test: TestRecord) {
    const scopes = await testScopes(actor, test)
    requireScope(actor, 'test.read', scopes, 'read')
    return scopes
  }

  async function requireUpdate(actor: Actor, test: TestRecord) {
    const scopes = await requireRead(actor, test)
    requireScope(actor, 'test.update', scopes)
    return scopes
  }

  /** Черновик теста для изменения (BR-004, BR-007). */
  async function editableDraft(actor: Actor, testId: string) {
    const test = await loadTest(testId)
    const scopes = await requireUpdate(actor, test)
    if (test.status === 'ARCHIVED') throw new DomainError('INVALID_STATE', 'Тест в архиве')
    if (!test.currentDraftVersionId)
      throw new DomainError(
        'INVALID_STATE',
        'Версия теста заморожена: изменения — только через новую версию (BR-007)',
        { ruleId: 'BR-007' },
      )
    const version = (await r().tests.findVersion(test.currentDraftVersionId))!
    if (version.state !== 'DRAFT')
      throw new DomainError('INVALID_STATE', 'Версия теста заморожена (BR-007)', { ruleId: 'BR-007' })
    return { test, version, scopes }
  }

  /** Структурное изменение черновика: optimistic lock + revision++ + аудит в одной транзакции. */
  async function mutate<R>(
    actor: Actor,
    ctx: RequestContext,
    d: { test: TestRecord; version: TestVersionRecord; revision?: number | string | null },
    action: string,
    changes: Record<string, unknown>,
    fn: (tx: AssessmentTx) => Promise<R>,
  ): Promise<R & { revision: number }> {
    const expected =
      d.revision === undefined || d.revision === null || d.revision === '' ? undefined : Number(d.revision)
    return uow.transaction(async (tx) => {
      const revision = await tx.tests.touch(d.version.id, expected)
      const res = await fn(tx)
      await tx.audit.record(
        actor,
        { action, resourceType: 'test', resourceId: d.test.id, changes: { versionId: d.version.id, ...changes } },
        ctx,
      )
      return { ...(res as R), revision }
    })
  }

  function sectionOf(s: TestStructure, sectionId: string) {
    const sec = s.sections.find((x) => x.id === sectionId)
    if (!sec) throw DomainError.validation([{ field: 'sectionId', message: 'Раздел не найден в этой версии теста' }])
    return sec
  }

  async function poolFor(courseId: string, s: TestStructure, filter: SelectionFilter) {
    return r().tests.poolCandidates(
      courseId,
      filter,
      s.fixed.map((f) => f.itemId),
    )
  }

  /** Фильтр правила: в пределах курса теста (SPEC-TEST-002). */
  async function checkFilter(courseId: string, f: SelectionFilter) {
    const e: { field: string; message: string }[] = []
    for (const tid of f.topicIds) {
      const t = await r().education.findTopic(tid)
      if (!t || t.courseId !== courseId)
        e.push({ field: 'filter.topicIds', message: 'Тема не относится к курсу теста' })
    }
    for (const oid of f.objectiveIds) {
      const o = await r().education.findObjective(oid)
      if (!o || o.courseId !== courseId)
        e.push({ field: 'filter.objectiveIds', message: 'Учебная цель не относится к курсу теста' })
    }
    for (const qid of f.questionTypeIds) {
      if (!(await r().qtypes.findById(qid)))
        e.push({ field: 'filter.questionTypeIds', message: 'Тип вопроса не найден' })
    }
    for (const [k, v] of [
      ['difficultyMin', f.difficultyMin],
      ['difficultyMax', f.difficultyMax],
    ] as const) {
      if (v !== null && (v < 1 || v > 5)) e.push({ field: `filter.${k}`, message: 'Сложность — от 1 до 5' })
    }
    if (f.difficultyMin !== null && f.difficultyMax !== null && f.difficultyMin > f.difficultyMax)
      e.push({ field: 'filter.difficultyMax', message: 'Максимальная сложность меньше минимальной' })
    if (e.length) throw DomainError.validation(e, 'Правило отбора не сохранено')
  }

  /** SPEC-TEST-004: проверка готовности. Возвращает список замечаний с указанием места. */
  async function readiness(test: TestRecord, version: TestVersionRecord, s: TestStructure): Promise<Issue[]> {
    const issues: Issue[] = []
    const err = (path: string, code: string, message: string) => issues.push({ path, code, severity: 'ERROR', message })
    if (!s.sections.length) err('sections', 'NO_SECTIONS', 'В тесте нет ни одного раздела')
    for (const sec of s.sections) {
      if (!s.fixed.some((f) => f.sectionId === sec.id) && !s.rules.some((x) => x.sectionId === sec.id))
        err(`section:${sec.id}`, 'SECTION_EMPTY', `Раздел «${sec.title}» пуст: добавьте вопрос или правило отбора`)
    }
    for (const f of s.fixed) {
      const where = `item:${f.id}`
      const label = `Вопрос v${f.versionNo} «${stripTags(f.stem).slice(0, 60) || 'без формулировки'}»`
      if (f.itemStatus === 'ARCHIVED') err(where, 'BR-039', `${label}: вопрос в архиве (BR-039)`)
      const ownDraft =
        f.versionState === 'DRAFT' && (f.itemOwnerId === test.ownerId || f.versionAuthorIds.includes(test.ownerId))
      if (f.versionState !== 'APPROVED' && !ownDraft)
        err(
          where,
          'BR-011',
          `${label}: версия в состоянии ${f.versionState} — нужна утвержденная или свой черновик (BR-011)`,
        )
      for (const i of await deps.items.internal.validateVersion(f.itemVersionId)) {
        if (i.severity === 'ERROR') err(where, i.code, `${label}: ${i.message}`)
      }
    }
    for (const rule of s.rules) {
      const pool = await poolFor(test.courseId, s, rule.filter)
      if (pool.length < rule.count)
        err(
          `rule:${rule.id}`,
          'BR-012',
          `Правило отбора: в пуле ${pool.length} вопросов, требуется ${rule.count} (BR-012)`,
        )
    }
    const max = maxScore({ fixed: s.fixed, rules: s.rules })
    if (version.settings.scoring.passingScore !== null && version.settings.scoring.passingScore > max)
      err('settings', 'PASSING_SCORE', `Проходной балл больше максимального (${max})`)
    if (test.assignmentId) {
      const a = (await r().education.findAssignment(test.assignmentId))!
      if (a.status !== 'ACTIVE') err('assignment', 'BR-031', 'Задание не активно — отправка невозможна (BR-031)')
      const firstSubmission =
        !(await r().tests.versions(test.id)).some((v) => v.state !== 'DRAFT') && !version.everSubmitted
      if (firstSubmission && a.status === 'ACTIVE') {
        const deadline = effectiveDeadline(a.deadlineAt, await r().education.findExtension(a.id, test.ownerId))
        if (deadline && clock.now() > deadline)
          err('assignment', 'BR-031', 'Срок задания истек — первая отправка невозможна (BR-031)')
      }
      const n = itemCount({ fixed: s.fixed, rules: s.rules })
      if (n < a.minItems || n > a.maxItems)
        err('assignment', 'BR-032', `Число вопросов ${n} вне диапазона задания ${a.minItems}–${a.maxItems} (BR-032)`)
      const allowed = new Set(a.questionTypeIds)
      for (const f of s.fixed) {
        if (!allowed.has(f.questionTypeId))
          err(`item:${f.id}`, 'BR-032', `Тип «${f.questionTypeName}» не разрешен заданием (BR-032)`)
      }
      for (const rule of s.rules) {
        if (!rule.filter.questionTypeIds.length || rule.filter.questionTypeIds.some((q) => !allowed.has(q)))
          err(
            `rule:${rule.id}`,
            'BR-032',
            'Правило отбора должно ограничиваться типами, разрешенными заданием (BR-032)',
          )
      }
      const topicScope = new Set((await Promise.all(a.topicIds.map((t) => r().education.topicSubtreeIds(t)))).flat())
      for (const f of s.fixed) {
        if (!f.topicIds.some((t) => topicScope.has(t)))
          err(`item:${f.id}`, 'BR-032', 'Вопрос не связан ни с одной темой задания (BR-032)')
      }
    }
    return issues
  }

  async function details(actor: Actor, test: TestRecord, versionId?: string): Promise<TestDetails> {
    const scopes = await requireRead(actor, test)
    const versions = await r().tests.versions(test.id)
    const vid = versionId ?? test.currentDraftVersionId ?? versions[versions.length - 1]?.id
    if (!vid || !versions.some((v) => v.id === vid)) throw DomainError.notFound()
    const version = (await r().tests.findVersion(vid))!
    const s = await r().tests.structure(version.id)
    const draft = version.state === 'DRAFT'
    const sections: SectionView[] = []
    for (const sec of s.sections) {
      const rules = []
      for (const rule of s.rules.filter((x) => x.sectionId === sec.id)) {
        const size = draft
          ? (await poolFor(test.courseId, s, rule.filter)).length
          : (await r().tests.frozenPool(rule.id)).length
        rules.push({ ...rule, poolSize: size })
      }
      sections.push({
        ...sec,
        items: s.fixed
          .filter((f) => f.sectionId === sec.id)
          .map((f) => ({
            ...f,
            newerApprovedVersionNo:
              f.latestApprovedVersionNo !== null && f.latestApprovedVersionNo > f.versionNo
                ? f.latestApprovedVersionNo
                : null,
          })),
        rules,
      })
    }
    const a = test.assignmentId ? await r().education.findAssignment(test.assignmentId) : null
    const updScopes = actor.scopes('test.update')
    const canUpdate = updScopes.has('ANY') || (updScopes.has('OWN') && scopes.has('OWN'))
    const rndScopes = actor.scopes('test.random_selection')
    const active = test.status === 'ACTIVE'
    const canSubmitBase = actor.has('test.submit') && scopes.has('OWN') && active
    return {
      test,
      version,
      versions,
      sections,
      maxScore: maxScore(s),
      itemCount: itemCount(s),
      issues: draft ? await readiness(test, version, s) : [],
      assignment: a
        ? {
            id: a.id,
            title: a.title,
            minItems: a.minItems,
            maxItems: a.maxItems,
            status: a.status,
            deadlineAt: a.deadlineAt,
          }
        : null,
      canEdit: canUpdate && draft && active,
      canUseRules:
        canUpdate && draft && active && (rndScopes.has('ANY') || (rndScopes.has('OWN') && scopes.has('OWN'))),
      canSubmit: canSubmitBase && draft,
      canRecall: canSubmitBase && version.state === 'READY_FOR_REVIEW',
      canBranch: canUpdate && active && !test.currentDraftVersionId && canBranch(version.state),
    }
  }

  async function creationContext(actor: Actor, assignmentId: string | null, courseId: string | null) {
    if (assignmentId) {
      const a = await r().education.findAssignment(assignmentId)
      if (!a) throw DomainError.validation([{ field: 'assignmentId', message: 'Задание не найдено' }])
      const rel = await r().education.courseRelation(actor.userId, a.courseId)
      const manages = a.ownerId === actor.userId || rel.teaches || actor.has('test.read', 'ANY')
      if (!manages) {
        assertStudentCanCreate({
          status: a.status as AssignmentStatus,
          targeted: await r().education.isTargeted(a.id, actor.userId),
        })
        const n = await r().tests.countActiveTestsInAssignment(a.id, actor.userId)
        if (n >= a.maxTestsPerStudent)
          throw DomainError.rule(
            'BR-033',
            `По заданию можно создать не более ${a.maxTestsPerStudent} тест(ов) — используйте существующий`,
          )
      } else if (a.status !== 'ACTIVE' && a.status !== 'DRAFT') {
        throw DomainError.rule('BR-017', 'Задание закрыто')
      }
      return { assignment: a, courseId: a.courseId }
    }
    if (!courseId)
      throw DomainError.rule('BR-017', 'Тест создается в рамках задания или курса, который вы ведете', 'assignmentId')
    const course = await r().education.findCourse(courseId)
    if (!course) throw DomainError.validation([{ field: 'courseId', message: 'Курс не найден' }])
    const rel = await r().education.courseRelation(actor.userId, courseId)
    if (!rel.teaches && !actor.has('test.read', 'ANY'))
      throw DomainError.rule('BR-017', 'Студенты создают тесты только в рамках назначенного задания', 'assignmentId')
    return { assignment: null as AssignmentRecord | null, courseId }
  }

  /** Выбор версии вопроса для добавления (SPEC-TEST-002, правила добавления фиксированного вопроса). */
  async function resolveItemVersion(
    actor: Actor,
    test: TestRecord,
    itemId: string,
    itemVersionId: string | null,
    ctx: RequestContext,
  ) {
    // item.read на добавляемый вопрос: невидимый — 404
    const d = await deps.items.getItem.run(actor, { id: itemId }, ctx)
    const item = d.item
    if (item.status === 'ARCHIVED') throw DomainError.rule('BR-039', 'Вопрос в архиве — его нельзя добавить', 'itemId')
    if (item.courseId !== test.courseId)
      throw DomainError.validation([{ field: 'itemId', message: 'Вопрос относится к другому курсу' }])
    const studentAuthor = !actor.has('test.random_selection')
    if (studentAuthor && item.ownerId !== test.ownerId)
      throw DomainError.forbidden('Студент составляет тест только из собственных вопросов (AC-TEST-002.3)')
    const ownsItem = item.ownerId === test.ownerId
    const vid =
      itemVersionId ||
      (ownsItem && item.currentDraftVersionId ? item.currentDraftVersionId : null) ||
      item.latestApprovedVersionId
    if (!vid) throw DomainError.rule('BR-011', 'У вопроса нет утвержденной версии', 'itemId')
    if (!d.versions.some((v) => v.id === vid)) throw DomainError.notFound()
    const v = (await r().items.findVersion(vid))!
    const ownDraft = v.state === 'DRAFT' && (ownsItem || v.authorIds.includes(test.ownerId))
    if (v.state !== 'APPROVED' && !ownDraft)
      throw DomainError.rule('BR-011', 'Можно добавить утвержденную версию или собственный черновик (BR-011)', 'itemId')
    return { item, version: v }
  }

  return {
    // ================= Чтение =================
    listTests: useCase<ListQuery, Awaited<ReturnType<AssessmentTx['tests']['list']>>>({
      name: 'test.list',
      permission: 'test.read',
      run: async (actor, q) => r().tests.list(scopeFilter(actor, 'test.read'), q),
    }),

    getTest: useCase<{ id: string; versionId?: string }, TestDetails>({
      name: 'test.get',
      permission: 'test.read',
      run: async (actor, { id, versionId }) => details(actor, await loadTest(id), versionId),
    }),

    /** Отдельное действие «Проверить готовность» без отправки (SPEC-TEST-004). */
    checkReadiness: useCase<{ testId: string }, { issues: Issue[]; ready: boolean }>({
      name: 'test.readiness',
      permission: 'test.read',
      async run(actor, { testId }) {
        const test = await loadTest(testId)
        await requireRead(actor, test)
        if (!test.currentDraftVersionId) throw new DomainError('INVALID_STATE', 'Нет черновика теста')
        const v = (await r().tests.findVersion(test.currentDraftVersionId))!
        const issues = await readiness(test, v, await r().tests.structure(v.id))
        return { issues, ready: !issues.some((i) => i.severity === 'ERROR') }
      },
    }),

    // ================= Создание и метаданные =================
    /** SPEC-TEST-001: Test + TestVersion v1 DRAFT + «Раздел 1». */
    createTest: useCase<
      {
        assignmentId?: string | null
        courseId?: string | null
        title: string
        description?: string | null
        instructions?: string | null
      },
      { testId: string; versionId: string }
    >({
      name: 'test.create',
      permission: 'test.create',
      async run(actor, input, ctx) {
        const title = zParse(titleSchema, input.title, 'title')
        const description = input.description ? sanitizeRichText(String(input.description)).slice(0, 5000) : null
        const instructions = input.instructions ? sanitizeRichText(String(input.instructions)).slice(0, 5000) : null
        const c = await creationContext(actor, input.assignmentId || null, input.courseId || null)
        return uow.transaction(async (tx) => {
          const testId = await tx.tests.insertTest({
            title,
            ownerId: actor.userId,
            assignmentId: c.assignment?.id ?? null,
            courseId: c.courseId,
          })
          const versionId = await tx.tests.insertVersion({
            testId,
            versionNo: 1,
            basedOnVersionId: null,
            title,
            description,
            instructions,
            settings: DEFAULT_TEST_SETTINGS,
            authorIds: [actor.userId],
          })
          await tx.tests.insertSection({
            testVersionId: versionId,
            title: 'Раздел 1',
            instructions: null,
            ordinal: 0,
            timeLimitSec: null,
            shuffleItems: null,
          })
          await tx.tests.setTestPointers(testId, { currentDraftVersionId: versionId })
          await tx.audit.record(
            actor,
            {
              action: 'test.created',
              resourceType: 'test',
              resourceId: testId,
              changes: { title, assignmentId: c.assignment?.id ?? null, versionId },
            },
            ctx,
          )
          return { testId, versionId }
        })
      },
    }),

    /** Метаданные и настройки черновика (SPEC-TEST-003). */
    updateDraft: useCase<
      {
        testId: string
        revision: number
        title?: string
        description?: string | null
        instructions?: string | null
        settings?: Record<string, unknown>
      },
      { revision: number }
    >({
      name: 'test.updateDraft',
      permission: 'test.update',
      async run(actor, input, ctx) {
        const { test, version } = await editableDraft(actor, input.testId)
        const patch: Parameters<AssessmentTx['tests']['updateDraft']>[1] = {}
        if (input.title !== undefined) patch.title = zParse(titleSchema, input.title, 'title')
        if (input.description !== undefined)
          patch.description = input.description ? sanitizeRichText(String(input.description)).slice(0, 5000) : null
        if (input.instructions !== undefined)
          patch.instructions = input.instructions ? sanitizeRichText(String(input.instructions)).slice(0, 5000) : null
        const s = await r().tests.structure(version.id)
        if (input.settings !== undefined) {
          const p = zParse(settingsSchema, input.settings, 'settings.')
          const cur = version.settings
          const next: TestSettings = {
            timeLimitSec: p.timeLimitSec !== undefined ? p.timeLimitSec : cur.timeLimitSec,
            navigation: p.navigation ?? cur.navigation,
            maxAttempts: p.maxAttempts !== undefined ? p.maxAttempts : cur.maxAttempts,
            shuffleSections: p.shuffleSections ?? cur.shuffleSections,
            shuffleItems: p.shuffleItems ?? cur.shuffleItems,
            shuffleOptions: p.shuffleOptions ?? cur.shuffleOptions,
            feedbackMode: p.feedbackMode ?? cur.feedbackMode,
            scoring: {
              method: 'SUM',
              passingScore: p.passingScore !== undefined ? p.passingScore : cur.scoring.passingScore,
            },
          }
          const e = validateSettings(next, {
            maxScore: maxScore(s),
            sectionLimits: s.sections.map((x) => x.timeLimitSec),
          })
          if (e.length) throw DomainError.validation(e, 'Настройки не сохранены')
          patch.settings = next
        }
        await uow.transaction(async (tx) => {
          await tx.tests.updateDraft(version.id, patch, Number(input.revision))
          if (patch.title && patch.title !== test.title) await tx.tests.updateTestTitle(test.id, patch.title)
          await tx.audit.record(
            actor,
            {
              action: 'test.draft.saved',
              resourceType: 'test',
              resourceId: test.id,
              changes: { versionId: version.id, fields: Object.keys(patch), settings: patch.settings ?? undefined },
            },
            ctx,
          )
        })
        return { revision: Number(input.revision) + 1 }
      },
    }),

    // ================= Разделы =================
    addSection: useCase<
      { testId: string; title: string; instructions?: string | null; timeLimitSec?: unknown; revision?: number },
      { sectionId: string; revision: number }
    >({
      name: 'test.section.add',
      permission: 'test.update',
      async run(actor, input, ctx) {
        const d = await editableDraft(actor, input.testId)
        const title = zParse(titleSchema, input.title, 'title')
        const limit = zParse(nullableInt, input.timeLimitSec ?? null, 'timeLimitSec')
        const e = validateSectionLimit(limit, d.version.settings)
        if (e.length) throw DomainError.validation(e)
        const s = await r().tests.structure(d.version.id)
        const ordinal = Math.max(-1, ...s.sections.map((x) => x.ordinal)) + 1
        return mutate(actor, ctx, { ...d, revision: input.revision }, 'test.section.added', { title }, async (tx) => ({
          sectionId: await tx.tests.insertSection({
            testVersionId: d.version.id,
            title,
            instructions: input.instructions ? sanitizeRichText(String(input.instructions)) : null,
            ordinal,
            timeLimitSec: limit,
            shuffleItems: null,
          }),
        }))
      },
    }),

    updateSection: useCase<
      {
        testId: string
        sectionId: string
        title?: string
        instructions?: string | null
        timeLimitSec?: unknown
        shuffleItems?: boolean | null
        revision?: number
      },
      { revision: number }
    >({
      name: 'test.section.update',
      permission: 'test.update',
      async run(actor, input, ctx) {
        const d = await editableDraft(actor, input.testId)
        sectionOf(await r().tests.structure(d.version.id), input.sectionId)
        const patch: Partial<SectionRecord> = {}
        if (input.title !== undefined) patch.title = zParse(titleSchema, input.title, 'title')
        if (input.instructions !== undefined)
          patch.instructions = input.instructions ? sanitizeRichText(String(input.instructions)) : null
        if (input.timeLimitSec !== undefined) {
          patch.timeLimitSec = zParse(nullableInt, input.timeLimitSec, 'timeLimitSec')
          const e = validateSectionLimit(patch.timeLimitSec, d.version.settings)
          if (e.length) throw DomainError.validation(e)
        }
        if (input.shuffleItems !== undefined) patch.shuffleItems = input.shuffleItems
        return mutate(
          actor,
          ctx,
          { ...d, revision: input.revision },
          'test.section.updated',
          { sectionId: input.sectionId },
          (tx) => tx.tests.updateSection(input.sectionId, patch).then(() => ({})),
        )
      },
    }),

    removeSection: useCase<{ testId: string; sectionId: string; revision?: number }, { revision: number }>({
      name: 'test.section.remove',
      permission: 'test.update',
      async run(actor, input, ctx) {
        const d = await editableDraft(actor, input.testId)
        sectionOf(await r().tests.structure(d.version.id), input.sectionId)
        return mutate(
          actor,
          ctx,
          { ...d, revision: input.revision },
          'test.section.removed',
          { sectionId: input.sectionId },
          (tx) => tx.tests.deleteSection(input.sectionId).then(() => ({})),
        )
      },
    }),

    moveSection: useCase<
      { testId: string; sectionId: string; direction: number; revision?: number },
      { revision: number }
    >({
      name: 'test.section.move',
      permission: 'test.update',
      async run(actor, input, ctx) {
        const d = await editableDraft(actor, input.testId)
        const s = await r().tests.structure(d.version.id)
        const i = s.sections.findIndex((x) => x.id === input.sectionId)
        if (i < 0) throw DomainError.notFound()
        const j = i + (Number(input.direction) < 0 ? -1 : 1)
        return mutate(
          actor,
          ctx,
          { ...d, revision: input.revision },
          'test.section.moved',
          { sectionId: input.sectionId },
          async (tx) => {
            if (j < 0 || j >= s.sections.length) return {}
            const a = s.sections[i]!
            const b = s.sections[j]!
            await tx.tests.updateSection(a.id, { ordinal: b.ordinal })
            await tx.tests.updateSection(b.id, { ordinal: a.ordinal })
            return {}
          },
        )
      },
    }),

    // ================= Фиксированные вопросы =================
    /** SPEC-TEST-002: вопрос добавляется как ссылка на конкретную ItemVersion (BR-010). */
    addItem: useCase<
      {
        testId: string
        sectionId: string
        itemId: string
        itemVersionId?: string | null
        points?: unknown
        revision?: number
      },
      { entryId: string; itemVersionId: string; revision: number }
    >({
      name: 'test.item.add',
      permission: 'test.update',
      async run(actor, input, ctx) {
        const d = await editableDraft(actor, input.testId)
        const s = await r().tests.structure(d.version.id)
        sectionOf(s, input.sectionId)
        if (s.fixed.some((f) => f.itemId === input.itemId))
          throw DomainError.validation([{ field: 'itemId', message: 'Этот вопрос уже есть в тесте (AC-TEST-002.2)' }])
        const { item, version } = await resolveItemVersion(
          actor,
          d.test,
          input.itemId,
          input.itemVersionId ?? null,
          ctx,
        )
        const pts =
          input.points === undefined || input.points === '' ? version.meta.defaultPoints : points(input.points)
        const ordinal =
          Math.max(-1, ...s.fixed.filter((f) => f.sectionId === input.sectionId).map((f) => f.ordinal)) + 1
        return mutate(
          actor,
          ctx,
          { ...d, revision: input.revision },
          'test.item.added',
          { itemId: item.id, itemVersionId: version.id, versionNo: version.versionNo, sectionId: input.sectionId },
          async (tx) => ({
            entryId: await tx.tests.insertFixed({
              testVersionId: d.version.id,
              sectionId: input.sectionId,
              itemId: item.id,
              itemVersionId: version.id,
              ordinal,
              points: pts,
            }),
            itemVersionId: version.id,
          }),
        )
      },
    }),

    updateItem: useCase<
      { testId: string; entryId: string; points?: unknown; sectionId?: string; revision?: number },
      { revision: number }
    >({
      name: 'test.item.update',
      permission: 'test.update',
      async run(actor, input, ctx) {
        const d = await editableDraft(actor, input.testId)
        const s = await r().tests.structure(d.version.id)
        const entry = s.fixed.find((f) => f.id === input.entryId)
        if (!entry) throw DomainError.notFound()
        const patch: { points?: number; sectionId?: string; ordinal?: number } = {}
        if (input.points !== undefined) patch.points = points(input.points)
        if (input.sectionId && input.sectionId !== entry.sectionId) {
          sectionOf(s, input.sectionId)
          patch.sectionId = input.sectionId
          patch.ordinal =
            Math.max(-1, ...s.fixed.filter((f) => f.sectionId === input.sectionId).map((f) => f.ordinal)) + 1
        }
        return mutate(
          actor,
          ctx,
          { ...d, revision: input.revision },
          'test.item.updated',
          { entryId: entry.id, ...patch },
          (tx) => tx.tests.updateFixed(entry.id, patch).then(() => ({})),
        )
      },
    }),

    moveItem: useCase<{ testId: string; entryId: string; direction: number; revision?: number }, { revision: number }>({
      name: 'test.item.move',
      permission: 'test.update',
      async run(actor, input, ctx) {
        const d = await editableDraft(actor, input.testId)
        const s = await r().tests.structure(d.version.id)
        const entry = s.fixed.find((f) => f.id === input.entryId)
        if (!entry) throw DomainError.notFound()
        const list = s.fixed.filter((f) => f.sectionId === entry.sectionId)
        const i = list.findIndex((f) => f.id === entry.id)
        const j = i + (Number(input.direction) < 0 ? -1 : 1)
        return mutate(
          actor,
          ctx,
          { ...d, revision: input.revision },
          'test.item.moved',
          { entryId: entry.id },
          async (tx) => {
            if (j < 0 || j >= list.length) return {}
            await tx.tests.updateFixed(list[i]!.id, { ordinal: list[j]!.ordinal })
            await tx.tests.updateFixed(list[j]!.id, { ordinal: list[i]!.ordinal })
            return {}
          },
        )
      },
    }),

    removeItem: useCase<{ testId: string; entryId: string; revision?: number }, { revision: number }>({
      name: 'test.item.remove',
      permission: 'test.update',
      async run(actor, input, ctx) {
        const d = await editableDraft(actor, input.testId)
        const entry = (await r().tests.structure(d.version.id)).fixed.find((f) => f.id === input.entryId)
        if (!entry) throw DomainError.notFound()
        return mutate(
          actor,
          ctx,
          { ...d, revision: input.revision },
          'test.item.removed',
          { itemId: entry.itemId, itemVersionId: entry.itemVersionId },
          (tx) => tx.tests.deleteFixed(entry.id).then(() => ({})),
        )
      },
    }),

    /** A5: «обновить до версии N» — перепривязка к последней утвержденной версии (только DRAFT теста). */
    upgradeItem: useCase<
      { testId: string; entryId: string; revision?: number },
      { itemVersionId: string; revision: number }
    >({
      name: 'test.item.upgrade',
      permission: 'test.update',
      async run(actor, input, ctx) {
        const d = await editableDraft(actor, input.testId)
        const entry = (await r().tests.structure(d.version.id)).fixed.find((f) => f.id === input.entryId)
        if (!entry) throw DomainError.notFound()
        if (!entry.latestApprovedVersionId || entry.latestApprovedVersionId === entry.itemVersionId)
          throw new DomainError('INVALID_STATE', 'Новой утвержденной версии нет')
        const to = entry.latestApprovedVersionId
        return mutate(
          actor,
          ctx,
          { ...d, revision: input.revision },
          'test.item.upgraded',
          { itemId: entry.itemId, from: entry.itemVersionId, to },
          async (tx) => {
            await tx.tests.updateFixed(entry.id, { itemVersionId: to })
            return { itemVersionId: to }
          },
        )
      },
    }),

    // ================= Правила случайного отбора =================
    poolSize: useCase<{ testId: string; filter: unknown }, { poolSize: number }>({
      name: 'test.pool.size',
      permission: 'test.random_selection',
      async run(actor, input) {
        const test = await loadTest(input.testId)
        const scopes = await requireRead(actor, test)
        requireScope(actor, 'test.random_selection', scopes)
        const filter = zParse(filterSchema, input.filter, 'filter.') as SelectionFilter
        const vid = test.currentDraftVersionId
        const s = vid ? await r().tests.structure(vid) : { sections: [], fixed: [], rules: [] }
        return { poolSize: (await poolFor(test.courseId, s, filter)).length }
      },
    }),

    addRule: useCase<
      {
        testId: string
        sectionId: string
        count: unknown
        pointsPerItem?: unknown
        filter: unknown
        revision?: number
      },
      { ruleId: string; poolSize: number; revision: number }
    >({
      name: 'test.rule.add',
      permission: 'test.random_selection',
      async run(actor, input, ctx) {
        const d = await editableDraft(actor, input.testId)
        requireScope(actor, 'test.random_selection', d.scopes)
        const s = await r().tests.structure(d.version.id)
        sectionOf(s, input.sectionId)
        const filter = zParse(filterSchema, input.filter, 'filter.') as SelectionFilter
        await checkFilter(d.test.courseId, filter)
        const count = Number(input.count)
        if (!Number.isInteger(count) || count < 1 || count > 100)
          throw DomainError.validation([{ field: 'count', message: 'Количество — целое число от 1 до 100' }])
        const ppi =
          input.pointsPerItem === undefined || input.pointsPerItem === ''
            ? 1
            : points(input.pointsPerItem, 'pointsPerItem')
        const poolSize = (await poolFor(d.test.courseId, s, filter)).length
        const ordinal =
          Math.max(-1, ...s.rules.filter((x) => x.sectionId === input.sectionId).map((x) => x.ordinal)) + 1
        return mutate(
          actor,
          ctx,
          { ...d, revision: input.revision },
          'test.rule.added',
          { sectionId: input.sectionId, count, pointsPerItem: ppi, filter, poolSize },
          async (tx) => ({
            ruleId: await tx.tests.insertRule({
              testVersionId: d.version.id,
              sectionId: input.sectionId,
              ordinal,
              count,
              pointsPerItem: ppi,
              filter,
            }),
            poolSize,
          }),
        )
      },
    }),

    updateRule: useCase<
      { testId: string; ruleId: string; count?: unknown; pointsPerItem?: unknown; filter?: unknown; revision?: number },
      { poolSize: number; revision: number }
    >({
      name: 'test.rule.update',
      permission: 'test.random_selection',
      async run(actor, input, ctx) {
        const d = await editableDraft(actor, input.testId)
        requireScope(actor, 'test.random_selection', d.scopes)
        const s = await r().tests.structure(d.version.id)
        const rule = s.rules.find((x) => x.id === input.ruleId)
        if (!rule) throw DomainError.notFound()
        const patch: Partial<RuleRecord> = {}
        if (input.filter !== undefined) {
          patch.filter = zParse(filterSchema, input.filter, 'filter.') as SelectionFilter
          await checkFilter(d.test.courseId, patch.filter)
        }
        if (input.count !== undefined) {
          const count = Number(input.count)
          if (!Number.isInteger(count) || count < 1 || count > 100)
            throw DomainError.validation([{ field: 'count', message: 'Количество — целое число от 1 до 100' }])
          patch.count = count
        }
        if (input.pointsPerItem !== undefined) patch.pointsPerItem = points(input.pointsPerItem, 'pointsPerItem')
        const poolSize = (await poolFor(d.test.courseId, s, patch.filter ?? rule.filter)).length
        return mutate(
          actor,
          ctx,
          { ...d, revision: input.revision },
          'test.rule.updated',
          { ruleId: rule.id, ...patch, poolSize },
          async (tx) => {
            await tx.tests.updateRule(rule.id, patch)
            return { poolSize }
          },
        )
      },
    }),

    removeRule: useCase<{ testId: string; ruleId: string; revision?: number }, { revision: number }>({
      name: 'test.rule.remove',
      permission: 'test.update',
      async run(actor, input, ctx) {
        const d = await editableDraft(actor, input.testId)
        const rule = (await r().tests.structure(d.version.id)).rules.find((x) => x.id === input.ruleId)
        if (!rule) throw DomainError.notFound()
        return mutate(actor, ctx, { ...d, revision: input.revision }, 'test.rule.removed', { ruleId: rule.id }, (tx) =>
          tx.tests.deleteRule(rule.id).then(() => ({})),
        )
      },
    }),

    // ================= Жизненный цикл версии =================
    /** SPEC-TEST-004: отправка — заморозка версии и каскад собственных черновиков вопросов (атомарно). */
    submitTest: useCase<{ testId: string }, { versionId: string; packageItemVersionIds: string[] }>({
      name: 'test.submit',
      permission: 'test.submit',
      async run(actor, input, ctx) {
        const test = await loadTest(input.testId)
        const scopes = await requireRead(actor, test)
        requireScope(actor, 'test.submit', scopes)
        if (test.status === 'ARCHIVED') throw new DomainError('INVALID_STATE', 'Тест в архиве')
        if (!test.currentDraftVersionId) throw new DomainError('INVALID_STATE', 'Нет черновика для отправки')
        const v = (await r().tests.findVersion(test.currentDraftVersionId))!
        const state = transition(v.state, 'submit', 'test')
        const s = await r().tests.structure(v.id)
        const errors = (await readiness(test, v, s)).filter((i) => i.severity === 'ERROR')
        if (errors.length) {
          const rule = errors.find((e) => e.code.startsWith('BR-'))?.code
          throw new DomainError(
            rule ? 'RULE_VIOLATION' : 'VALIDATION',
            `Тест не готов к отправке: ${errors[0]!.message}`,
            {
              ...(rule ? { ruleId: rule } : {}),
              fieldErrors: errors.map((e) => ({ field: e.path, message: e.message })),
            },
          )
        }
        const cascade = s.fixed.filter((f) => f.versionState === 'DRAFT')
        const hashes = new Map<string, string>()
        for (const f of cascade) hashes.set(f.itemVersionId, await deps.items.internal.contentHash(f.itemVersionId))
        const packageIds = cascade.map((f) => f.itemVersionId)
        const now = clock.now()
        await uow.transaction(async (tx) => {
          for (const f of cascade) {
            await tx.items.setVersionState(f.itemVersionId, {
              state: transition(f.versionState, 'submit', 'item'),
              submittedAt: now,
              everSubmitted: true,
              contentHash: hashes.get(f.itemVersionId)!,
            })
            await tx.items.setItemPointers(f.itemId, { currentDraftVersionId: null })
            await tx.audit.record(
              actor,
              {
                action: 'item.submitted',
                resourceType: 'item',
                resourceId: f.itemId,
                changes: { versionId: f.itemVersionId, versionNo: f.versionNo, viaTest: test.id },
              },
              ctx,
            )
          }
          // пакет фиксируется, пока версия еще DRAFT (триггер запрещает менять его после заморозки)
          await tx.tests.setVersionState(v.id, { state: 'DRAFT', packageItemVersionIds: packageIds })
          await tx.tests.setVersionState(v.id, {
            state,
            submittedAt: now,
            everSubmitted: true,
            contentHash: testContentHash(v, s),
          })
          await tx.tests.setTestPointers(test.id, { currentDraftVersionId: null })
          await tx.audit.record(
            actor,
            {
              action: 'test.submitted',
              resourceType: 'test',
              resourceId: test.id,
              changes: { versionId: v.id, versionNo: v.versionNo, packageItemVersionIds: packageIds },
            },
            ctx,
          )
          if (deps.onSubmitted)
            await deps.onSubmitted(tx, actor, test, { id: v.id, packageItemVersionIds: packageIds }, ctx)
        })
        return { versionId: v.id, packageItemVersionIds: packageIds }
      },
    }),

    /** BR-038: отзыв до начала экспертизы; обратный каскад для вопросов пакета. */
    recallTest: useCase<{ testId: string }, { versionId: string }>({
      name: 'test.recall',
      permission: 'test.submit',
      async run(actor, input, ctx) {
        const test = await loadTest(input.testId)
        const scopes = await requireRead(actor, test)
        requireScope(actor, 'test.submit', scopes)
        const versions = await r().tests.versions(test.id)
        const last = versions[versions.length - 1]
        if (!last) throw DomainError.notFound()
        if (last.state === 'IN_REVIEW')
          throw DomainError.rule('BR-038', 'Экспертиза уже начата — отозвать отправку нельзя')
        const state = transition(last.state, 'recall', 'test')
        const v = (await r().tests.findVersion(last.id))!
        await uow.transaction(async (tx) => {
          await tx.tests.setVersionState(v.id, { state })
          await tx.tests.setVersionState(v.id, { state, packageItemVersionIds: [] })
          for (const ivId of v.packageItemVersionIds) {
            const iv = await tx.items.findVersion(ivId)
            if (!iv || iv.state !== 'READY_FOR_REVIEW') continue
            await tx.items.setVersionState(ivId, { state: transition(iv.state, 'recall', 'item') })
            await tx.items.setItemPointers(iv.itemId, { currentDraftVersionId: ivId })
          }
          await tx.tests.setTestPointers(test.id, { currentDraftVersionId: v.id })
          await tx.audit.record(
            actor,
            {
              action: 'test.recalled',
              resourceType: 'test',
              resourceId: test.id,
              changes: { versionId: v.id, items: v.packageItemVersionIds },
            },
            ctx,
          )
          if (deps.onRecalled) await deps.onRecalled(tx, actor, test, v.id, ctx)
        })
        return { versionId: v.id }
      },
    }),

    /**
     * Новая версия теста (BR-003, BR-041). Вопросы автора в CHANGES_REQUESTED получают новые DRAFT-версии,
     * ссылка в новой версии указывает на них; утвержденные остаются pinned (SPEC-TEST-004 п.3).
     */
    createNewVersion: useCase<
      { testId: string; fromVersionId?: string },
      { versionId: string; versionNo: number; newItemVersions: string[] }
    >({
      name: 'test.newVersion',
      permission: 'test.update',
      async run(actor, input, ctx) {
        const test = await loadTest(input.testId)
        await requireUpdate(actor, test)
        if (test.status === 'ARCHIVED') throw new DomainError('INVALID_STATE', 'Тест в архиве')
        if (test.currentDraftVersionId) throw DomainError.rule('BR-041', 'У теста уже есть черновик — откройте его')
        const versions = await r().tests.versions(test.id)
        const srcId = input.fromVersionId ?? versions[versions.length - 1]?.id
        const src = srcId ? await r().tests.findVersion(srcId) : null
        if (!src || src.testId !== test.id) throw DomainError.notFound()
        if (!canBranch(src.state))
          throw new DomainError(
            'INVALID_STATE',
            'Новую версию можно создать из версии, возвращенной на доработку, утвержденной, опубликованной или архивной',
          )
        if (test.assignmentId && src.state === 'CHANGES_REQUESTED') {
          const a = await r().education.findAssignment(test.assignmentId)
          if (a && a.status === 'CLOSED') throw DomainError.rule('BR-031', 'Задание закрыто — доработка невозможна')
        }
        const s = await r().tests.structure(src.id)
        const versionNo = (await r().tests.maxVersionNo(test.id)) + 1
        return uow.transaction(async (tx) => {
          const versionId = await tx.tests.insertVersion({
            testId: test.id,
            versionNo,
            basedOnVersionId: src.id,
            title: src.title,
            description: src.description,
            instructions: src.instructions,
            settings: src.settings,
            authorIds: [...new Set([...src.authorIds, actor.userId])],
          })
          const sectionMap = new Map<string, string>()
          for (const sec of s.sections) {
            sectionMap.set(
              sec.id,
              await tx.tests.insertSection({
                testVersionId: versionId,
                title: sec.title,
                instructions: sec.instructions,
                ordinal: sec.ordinal,
                timeLimitSec: sec.timeLimitSec,
                shuffleItems: sec.shuffleItems,
              }),
            )
          }
          const newItemVersions: string[] = []
          for (const f of s.fixed) {
            let ivId = f.itemVersionId
            const mine = f.itemOwnerId === actor.userId || f.versionAuthorIds.includes(actor.userId)
            if (mine && f.versionState === 'CHANGES_REQUESTED' && f.itemStatus === 'ACTIVE') {
              const item = (await tx.items.findById(f.itemId))!
              if (item.currentDraftVersionId) ivId = item.currentDraftVersionId
              else {
                const iv = (await tx.items.findVersion(f.itemVersionId))!
                const qtv = (await tx.qtypes.findById(item.questionTypeId))!.currentVersion!
                const no = (await tx.items.maxVersionNo(item.id)) + 1
                ivId = await tx.items.insertVersion({
                  itemId: item.id,
                  versionNo: no,
                  basedOnVersionId: iv.id,
                  questionTypeVersionId: qtv.id,
                  document: iv.document,
                  meta: iv.meta,
                  authorIds: [...new Set([...iv.authorIds, actor.userId])],
                })
                await tx.items.setItemPointers(item.id, { currentDraftVersionId: ivId })
                await tx.audit.record(
                  actor,
                  {
                    action: 'item.version.created',
                    resourceType: 'item',
                    resourceId: item.id,
                    changes: { versionId: ivId, versionNo: no, basedOn: iv.versionNo, viaTest: test.id },
                  },
                  ctx,
                )
              }
              newItemVersions.push(ivId)
            }
            await tx.tests.insertFixed({
              testVersionId: versionId,
              sectionId: sectionMap.get(f.sectionId)!,
              itemId: f.itemId,
              itemVersionId: ivId,
              ordinal: f.ordinal,
              points: f.points,
            })
          }
          for (const rule of s.rules) {
            await tx.tests.insertRule({
              testVersionId: versionId,
              sectionId: sectionMap.get(rule.sectionId)!,
              ordinal: rule.ordinal,
              count: rule.count,
              pointsPerItem: rule.pointsPerItem,
              filter: rule.filter,
            })
          }
          await tx.tests.setTestPointers(test.id, { currentDraftVersionId: versionId })
          await tx.audit.record(
            actor,
            {
              action: 'test.version.created',
              resourceType: 'test',
              resourceId: test.id,
              changes: { versionId, versionNo, basedOn: src.versionNo, newItemVersions },
            },
            ctx,
          )
          return { versionId, versionNo, newItemVersions }
        })
      },
    }),

    // ================= Предпросмотр =================
    /** SPEC-TEST-003: «виртуальная попытка» по seed; DRAFT — текущий пул, иначе — замороженный. Ничего не сохраняется. */
    previewTest: useCase<{ testId: string; versionId?: string; seed?: number }, TestPreview>({
      name: 'test.preview',
      permission: 'test.read',
      async run(actor, input) {
        const test = await loadTest(input.testId)
        const d = await details(actor, test, input.versionId)
        const v = d.version
        const seed = Number.isFinite(Number(input.seed)) ? Number(input.seed) : 1
        const s = await r().tests.structure(v.id)
        const warnings: string[] = []
        const used = new Set(s.fixed.map((f) => f.itemId))
        const sections = v.settings.shuffleSections ? seededShuffle(s.sections, seed) : s.sections
        const out: TestPreview['sections'] = []
        let ruleNo = 0
        for (const sec of sections) {
          const entries: { itemVersionId: string; points: number; source: 'FIXED' | 'RULE' }[] = s.fixed
            .filter((f) => f.sectionId === sec.id)
            .map((f) => ({ itemVersionId: f.itemVersionId, points: f.points, source: 'FIXED' as const }))
          for (const rule of s.rules.filter((x) => x.sectionId === sec.id)) {
            ruleNo += 1
            const candidates =
              v.state === 'DRAFT'
                ? (await poolFor(test.courseId, s, rule.filter)).filter((c) => !used.has(c.itemId))
                : (await r().tests.frozenPool(rule.id)).map((id) => ({ itemId: id, itemVersionId: id }))
            const picked = seededShuffle(candidates, seed * 31 + ruleNo).slice(0, rule.count)
            if (picked.length < rule.count)
              warnings.push(`Раздел «${sec.title}»: в пуле ${picked.length} из ${rule.count} вопросов (BR-012)`)
            for (const p of picked) {
              used.add(p.itemId)
              entries.push({ itemVersionId: p.itemVersionId, points: rule.pointsPerItem, source: 'RULE' })
            }
          }
          const shuffle = sec.shuffleItems ?? v.settings.shuffleItems
          const ordered = shuffle ? seededShuffle(entries, seed + sec.ordinal + 7) : entries
          const items = []
          for (const e of ordered) {
            items.push({
              ...e,
              preview: await deps.items.internal.previewVersion(e.itemVersionId, seed, v.settings.shuffleOptions),
            })
          }
          out.push({ title: sec.title, instructions: sec.instructions, timeLimitSec: sec.timeLimitSec, items })
        }
        return {
          title: v.title,
          versionNo: v.versionNo,
          state: v.state,
          settings: v.settings,
          maxScore: d.maxScore,
          warnings,
          sections: out,
        }
      },
    }),

    // ================= Сводка по заданию =================
    /** AC-ASSIGN-002.6: состояние последней версии теста каждого адресата. */
    assignmentSummary: useCase<{ assignmentId: string }, (AssignmentSummaryRow & { deadline: Date | null })[]>({
      name: 'assignment.summary',
      permission: 'assignment.read',
      async run(actor, input) {
        const a = await r().education.findAssignment(input.assignmentId)
        if (!a) throw DomainError.notFound()
        const rel = await r().education.courseRelation(actor.userId, a.courseId)
        if (!(
          a.ownerId === actor.userId ||
          a.defaultReviewerId === actor.userId ||
          rel.teaches ||
          actor.has('assignment.read', 'ANY')
        ))
          throw DomainError.notFound()
        const rows = await r().tests.assignmentSummary(a.id)
        return rows.map((x) => ({ ...x, deadline: effectiveDeadline(a.deadlineAt, x.extendedUntil) }))
      },
    }),
  }
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export type TestUseCases = ReturnType<typeof createTestUseCases>
