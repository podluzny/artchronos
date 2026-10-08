import type { ActionContext, ActionRequest, ResourceWithOptions } from 'adminjs'
import type { TestDetails, TestUseCases } from '../../application/assessment/test-use-cases.js'
import type { TestListRow } from '../../application/assessment/ports.js'
import type { EducationUseCases } from '../../application/education/use-cases.js'
import type { ItemUseCases } from '../../application/itembank/item-use-cases.js'
import { isDomainError } from '../../domain/shared/errors.js'
import { VERSION_STATE_LABEL, type VersionState } from '../../domain/versioning/state-machine.js'
import { formAction, visibleIf } from '../actions.js'
import { Components } from '../component-loader.js'
import { currentScope } from '../context.js'
import { DomainResource, type ResourceGateway } from './domain-resource.js'
import { hidden } from './helpers.js'

const STATES = (Object.keys(VERSION_STATE_LABEL) as VersionState[]).map((s) => ({
  value: s,
  label: VERSION_STATE_LABEL[s],
}))

function plain(html: string, max = 90): string {
  const t = html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t || '(без формулировки)'
}

function listRecord(r: TestListRow) {
  return {
    id: r.id,
    title: r.title,
    state: r.state,
    versionNo: r.versionNo,
    owner: r.ownerName,
    ownerId: r.ownerId,
    assignment: r.assignmentTitle ?? '',
    assignmentId: r.assignmentId ?? '',
    course: r.courseName,
    courseId: r.courseId,
    status: r.status,
    updatedAt: r.updatedAt,
  }
}

function detailRecord(d: TestDetails) {
  const v = d.version
  const structure = d.sections
    .map(
      (s, i) =>
        `${i + 1}. ${s.title}\n` +
        [
          ...s.items.map(
            (it) =>
              `   • ${plain(it.stem)} — ${it.questionTypeName}, v${it.versionNo} (${VERSION_STATE_LABEL[it.versionState]}), ${it.points} б.`,
          ),
          ...s.rules.map((r) => `   • случайно ${r.count} вопр. × ${r.pointsPerItem} б. (в пуле ${r.poolSize})`),
        ].join('\n'),
    )
    .join('\n')
  return {
    id: d.test.id,
    title: v.title,
    state: v.state,
    versionNo: v.versionNo,
    versionId: v.id,
    owner: d.test.ownerName,
    ownerId: d.test.ownerId,
    assignment: d.test.assignmentTitle ?? '',
    assignmentId: d.test.assignmentId ?? '',
    course: d.test.courseName,
    courseId: d.test.courseId,
    itemCount: d.itemCount,
    maxScore: d.maxScore,
    structure,
    issues:
      v.state !== 'DRAFT'
        ? ''
        : d.issues.length
          ? d.issues.map((i) => `✖ ${i.message}`).join('\n')
          : 'Ошибок нет — тест готов к отправке на экспертизу',
    versions: d.versions.map((x) => `v${x.versionNo} — ${VERSION_STATE_LABEL[x.state]}`).join('\n'),
    contentHash: v.contentHash ?? '',
    status: d.test.status,
    canEdit: d.canEdit,
    canSubmit: d.canSubmit,
    canRecall: d.canRecall,
    canBranch: d.canBranch,
    hasErrors: d.issues.length > 0,
    actions: d.availableActions.join(','),
    updatedAt: d.test.updatedAt,
  }
}

const can = (r: Record<string, any> | null, action: string) =>
  String(r?.actions ?? '')
    .split(',')
    .includes(action)

function failure(e: unknown) {
  if (!isDomainError(e)) throw e
  const errors: Record<string, string> = {}
  for (const f of e.fieldErrors) errors[f.field] = f.message
  return { ok: false, message: e.ruleId ? `${e.message} (${e.ruleId})` : e.message, errors, code: e.code }
}

export function testResources(
  uc: TestUseCases,
  items: ItemUseCases,
  education: EducationUseCases,
): ResourceWithOptions[] {
  const gateway: ResourceGateway = {
    list: async (a, q, c) => {
      const r = await uc.listTests.run(a, q, c)
      return { records: r.records.map(listRecord), total: r.total }
    },
    get: async (a, id, c) => detailRecord(await uc.getTest.run(a, { id }, c)),
  }

  /** API конструктора и предпросмотра (TestBuilder.jsx, TestPreview.jsx): операции в теле POST. */
  const builderHandler = async (request: ActionRequest, _res: unknown, context: ActionContext) => {
    const { actor, ctx } = currentScope()
    const recordJson = context.record ? { record: context.record.toJSON(context.currentAdmin) } : {}
    if (request.method !== 'post' || !actor) return recordJson
    const p = (request.payload ?? {}) as Record<string, any>
    const json = (k: string) => (typeof p[k] === 'string' && /^[[{]/.test(p[k]) ? JSON.parse(p[k]) : p[k])
    const testId = String(context.record?.id() ?? p.testId)
    const rev = p.revision
    const run = async (): Promise<Record<string, unknown>> => {
      switch (p.op) {
        case 'load': {
          const details = await uc.getTest.run(actor, { id: testId }, ctx)
          const topics = details.canUseRules
            ? (
                await education.listTopics.run(
                  actor,
                  { filters: { courseId: details.test.courseId }, limit: 500, offset: 0 },
                  ctx,
                )
              ).records.map((t) => ({ value: t.id, label: t.path }))
            : []
          const assignment = details.test.assignmentId
            ? await education.getAssignment.run(actor, { id: details.test.assignmentId }, ctx).catch(() => null)
            : null
          const existing = details.sections.flatMap((s) => s.items.map((i) => i.itemId))
          const candidates = details.canEdit
            ? (
                await items.listItems.run(
                  actor,
                  {
                    filters: { courseId: details.test.courseId, excludeItemIds: existing.join(',') },
                    limit: 100,
                    offset: 0,
                    sortBy: 'updatedAt',
                    direction: 'desc',
                  },
                  ctx,
                )
              ).records.map((r) => ({
                id: r.id,
                stem: plain(r.stem, 140),
                questionType: r.questionTypeName,
                versionNo: r.versionNo,
                state: r.state,
                owner: r.ownerName,
              }))
            : []
          return {
            details,
            candidates,
            context: { topics, assignmentTypeIds: assignment?.questionTypeIds ?? [] },
          }
        }
        case 'saveSettings':
          return uc.updateDraft.run(
            actor,
            { testId, revision: Number(rev), title: p.title, settings: json('settings') },
            ctx,
          )
        case 'addSection':
          return uc.addSection.run(actor, { testId, title: p.title, revision: rev }, ctx)
        case 'renameSection':
          return uc.updateSection.run(actor, { testId, sectionId: p.sectionId, title: p.title, revision: rev }, ctx)
        case 'moveSection':
          return uc.moveSection.run(
            actor,
            { testId, sectionId: p.sectionId, direction: Number(p.direction), revision: rev },
            ctx,
          )
        case 'removeSection':
          return uc.removeSection.run(actor, { testId, sectionId: p.sectionId, revision: rev }, ctx)
        case 'addItem':
          return uc.addItem.run(actor, { testId, sectionId: p.sectionId, itemId: p.itemId, revision: rev }, ctx)
        case 'updateItem':
          return uc.updateItem.run(actor, { testId, entryId: p.entryId, points: p.points, revision: rev }, ctx)
        case 'moveItem':
          return uc.moveItem.run(
            actor,
            { testId, entryId: p.entryId, direction: Number(p.direction), revision: rev },
            ctx,
          )
        case 'removeItem':
          return uc.removeItem.run(actor, { testId, entryId: p.entryId, revision: rev }, ctx)
        case 'upgradeItem':
          return uc.upgradeItem.run(actor, { testId, entryId: p.entryId, revision: rev }, ctx)
        case 'addRule':
          return uc.addRule.run(
            actor,
            {
              testId,
              sectionId: p.sectionId,
              count: p.count,
              pointsPerItem: p.pointsPerItem,
              filter: json('filter'),
              revision: rev,
            },
            ctx,
          )
        case 'removeRule':
          return uc.removeRule.run(actor, { testId, ruleId: p.ruleId, revision: rev }, ctx)
        case 'poolSize':
          return uc.poolSize.run(actor, { testId, filter: json('filter') }, ctx)
        case 'preview':
          return { preview: await uc.previewTest.run(actor, { testId, seed: Number(p.seed ?? 1) }, ctx) }
        default:
          return { ok: false, message: 'Неизвестная операция' }
      }
    }
    try {
      return { ...recordJson, ok: true, ...(await run()) }
    } catch (e) {
      return { ...recordJson, ...failure(e) }
    }
  }

  const back = (h: ActionContext['h'], id: string) =>
    h.recordActionUrl({ resourceId: 'Test', recordId: id, actionName: 'show' })

  return [
    {
      resource: new DomainResource({
        id: 'Test',
        gateway,
        properties: [
          { path: 'id', isId: true, type: 'uuid' },
          { path: 'title', isSortable: true },
          { path: 'state', availableValues: STATES },
          { path: 'versionNo', type: 'number' },
          { path: 'versionId' },
          { path: 'owner' },
          { path: 'ownerId' },
          { path: 'assignment' },
          { path: 'assignmentId', type: 'reference', reference: 'Assignment' },
          { path: 'course' },
          { path: 'courseId', type: 'reference', reference: 'Course' },
          { path: 'itemCount', type: 'number' },
          { path: 'maxScore', type: 'number' },
          { path: 'structure', type: 'textarea' },
          { path: 'issues', type: 'textarea' },
          { path: 'versions', type: 'textarea' },
          { path: 'contentHash' },
          { path: 'status' },
          { path: 'updatedAt', type: 'datetime', isSortable: true },
          { path: 'canEdit', type: 'boolean' },
          { path: 'canSubmit', type: 'boolean' },
          { path: 'canRecall', type: 'boolean' },
          { path: 'canBranch', type: 'boolean' },
          { path: 'hasErrors', type: 'boolean' },
          { path: 'actions' },
        ],
      }),
      options: {
        id: 'Test',
        navigation: { name: 'Тесты', icon: 'FileText' },
        titleProperty: 'title',
        sort: { sortBy: 'updatedAt', direction: 'desc' },
        listProperties: ['title', 'state', 'versionNo', 'assignment', 'course', 'owner', 'updatedAt'],
        showProperties: [
          'title',
          'state',
          'versionNo',
          'issues',
          'structure',
          'itemCount',
          'maxScore',
          'assignment',
          'course',
          'owner',
          'versions',
          'contentHash',
        ],
        filterProperties: ['title', 'state', 'assignmentId', 'courseId', 'status'],
        properties: {
          assignmentId: { isVisible: { list: false, show: false, edit: false, filter: true } },
          courseId: { isVisible: { list: false, show: false, edit: false, filter: true } },
          state: { availableValues: STATES },
          status: {
            availableValues: [
              { value: 'ACTIVE', label: 'Активен' },
              { value: 'ARCHIVED', label: 'В архиве' },
            ],
          },
          ownerId: hidden,
          versionId: hidden,
          canEdit: hidden,
          canSubmit: hidden,
          canRecall: hidden,
          canBranch: hidden,
          hasErrors: hidden,
          actions: hidden,
          issues: { components: { show: Components.JsonView } },
          structure: { components: { show: Components.JsonView } },
          versions: { components: { show: Components.JsonView } },
        },
        actions: {
          list: { isAccessible: visibleIf((a) => a.has('test.read')) },
          search: { isAccessible: visibleIf((a) => a.has('test.read')) },
          show: { isAccessible: visibleIf((a) => a.has('test.read')) },
          edit: { isAccessible: false, isVisible: false },
          delete: { isAccessible: false, isVisible: false },
          bulkDelete: { isAccessible: false, isVisible: false },
          new: formAction({
            actionType: 'resource',
            icon: 'Plus',
            isAccessible: visibleIf((a) => a.has('test.create')),
            description:
              'Студент создает тест в рамках назначенного активного задания (BR-017); преподаватель — в задании или в своем курсе.',
            submitLabel: 'Создать тест',
            fields: [
              { name: 'where', label: 'Задание или курс', type: 'select', required: true },
              { name: 'title', label: 'Название', required: true },
              { name: 'description', label: 'Описание', type: 'textarea' },
            ],
            load: async (actor) => {
              const c = await items.editorContext.run(actor, {}, currentScope().ctx)
              return {
                options: {
                  where: [
                    ...c.assignments.map((a) => ({ value: `a:${a.value}`, label: a.label, group: 'Задания' })),
                    ...c.courses.map((x) => ({ value: `c:${x.value}`, label: `Курс: ${x.label}`, group: 'Курсы' })),
                  ],
                },
              }
            },
            submit: async (actor, p, _id, c, h) => {
              const where = String(p.where ?? '')
              const r = await uc.createTest.run(
                actor,
                {
                  assignmentId: where.startsWith('a:') ? where.slice(2) : null,
                  courseId: where.startsWith('c:') ? where.slice(2) : null,
                  title: p.title,
                  description: p.description,
                },
                c,
              )
              return {
                redirectUrl: h.recordActionUrl({ resourceId: 'Test', recordId: r.testId, actionName: 'builder' }),
                notice: 'Тест создан',
              }
            },
          }),
          builder: {
            actionType: 'record',
            icon: 'Layers',
            component: Components.TestBuilder,
            isAccessible: visibleIf((a) => a.has('test.read')),
            handler: builderHandler,
          },
          preview: {
            actionType: 'record',
            icon: 'Eye',
            component: Components.TestPreview,
            isAccessible: visibleIf((a) => a.has('test.read')),
            handler: builderHandler,
          },
          submit: formAction({
            actionType: 'record',
            icon: 'Send',
            isAccessible: visibleIf((_a, r) => !!r?.canSubmit),
            description:
              'Версия теста и ваши черновики вопросов в ней будут заморожены и отправлены на экспертизу (BR-007). ' +
              'Отозвать отправку можно, пока экспертиза не начата (BR-038).',
            submitLabel: 'Отправить на экспертизу',
            fields: [],
            submit: async (actor, _p, id, c, h) => {
              await uc.submitTest.run(actor, { testId: id! }, c)
              return { redirectUrl: back(h, id!), notice: 'Тест отправлен на экспертизу' }
            },
          }),
          recall: formAction({
            actionType: 'record',
            icon: 'CornerUpLeft',
            isAccessible: visibleIf((_a, r) => !!r?.canRecall),
            description: 'Версия и вопросы пакета вернутся в черновик.',
            submitLabel: 'Отозвать отправку',
            fields: [],
            submit: async (actor, _p, id, c, h) => {
              await uc.recallTest.run(actor, { testId: id! }, c)
              return { redirectUrl: back(h, id!), notice: 'Отправка отозвана' }
            },
          }),
          publish: formAction({
            actionType: 'record',
            icon: 'Globe',
            isAccessible: visibleIf((_a, r) => can(r, 'publish')),
            description:
              'Утвержденная версия станет опубликованной. Ранее опубликованная версия (если есть) будет переведена в архив (SUPERSEDED, BR-009).',
            submitLabel: 'Опубликовать',
            fields: [],
            submit: async (actor, _p, id, c, h) => {
              const r = await uc.publishTest.run(actor, { testId: id! }, c)
              return {
                redirectUrl: back(h, id!),
                notice: r.superseded ? 'Опубликовано; предыдущая версия заменена' : 'Тест опубликован',
              }
            },
          }),
          withdraw: formAction({
            actionType: 'record',
            icon: 'XOctagon',
            variant: 'danger',
            isAccessible: visibleIf((_a, r) => can(r, 'withdraw')),
            description:
              'Новые попытки по версии станут невозможны; существующие попытки и результаты сохраняются (BR-036).',
            submitLabel: 'Отозвать публикацию',
            fields: [{ name: 'reason', label: 'Причина', type: 'textarea', required: true }],
            submit: async (actor, p, id, c, h) => {
              await uc.withdrawTest.run(actor, { testId: id!, reason: p.reason }, c)
              return { redirectUrl: back(h, id!), notice: 'Публикация отозвана' }
            },
          }),
          archive: formAction({
            actionType: 'record',
            icon: 'Archive',
            variant: 'danger',
            isAccessible: visibleIf((_a, r) => can(r, 'archive')),
            description:
              'Тест скрывается из рабочих списков; черновик переводится в архив. Опубликованный тест сначала отзовите.',
            submitLabel: 'В архив',
            fields: [{ name: 'reason', label: 'Причина', type: 'textarea', required: true }],
            submit: async (actor, p, id, c, h) => {
              await uc.archiveTest.run(actor, { testId: id!, reason: p.reason }, c)
              return { redirectUrl: back(h, id!), notice: 'Тест в архиве' }
            },
          }),
          restore: formAction({
            actionType: 'record',
            icon: 'RotateCcw',
            isAccessible: visibleIf((_a, r) => can(r, 'restore')),
            submitLabel: 'Восстановить',
            fields: [],
            submit: async (actor, _p, id, c, h) => {
              await uc.restoreTest.run(actor, { testId: id! }, c)
              return { redirectUrl: back(h, id!), notice: 'Тест восстановлен' }
            },
          }),
          publications: formAction({
            actionType: 'record',
            icon: 'Clock',
            isAccessible: visibleIf((a) => a.has('test.read')),
            submitLabel: 'Показать',
            description: 'История публикаций версий теста (публикация, замена, отзыв).',
            fields: [],
            submit: async (actor, _p, id, c, h) => {
              const rows = await uc.publicationHistory.run(actor, { testId: id! }, c)
              const fmt = (d: Date | null) => (d ? new Date(d).toLocaleString('ru-RU') : '')
              const reason: Record<string, string> = { SUPERSEDED: 'заменена новой версией', WITHDRAWN: 'отозвана' }
              return {
                title: rows.length ? `Публикаций: ${rows.length}` : 'Тест не публиковался',
                text: rows
                  .map(
                    (r) =>
                      `v${r.versionNo}: опубликована ${fmt(r.publishedAt)}` +
                      (r.archivedAt
                        ? `; ${reason[r.archiveReason ?? ''] ?? 'в архиве'} ${fmt(r.archivedAt)}`
                        : ' — действует'),
                  )
                  .join('\n'),
                backUrl: back(h, id!),
              }
            },
          }),
          history: {
            actionType: 'record',
            icon: 'List',
            component: false,
            isAccessible: visibleIf((a) => a.has('audit.read')),
            handler: async (_req: unknown, _res: unknown, context: any) => ({
              record: context.record.toJSON(context.currentAdmin),
              redirectUrl: `${context.h.resourceActionUrl({ resourceId: 'AuditLog', actionName: 'list' })}?filters.resourceType=test&filters.resourceId=${context.record.id()}`,
            }),
          },
          newVersion: formAction({
            actionType: 'record',
            icon: 'Copy',
            isAccessible: visibleIf((_a, r) => !!r?.canBranch),
            description:
              'Будет создан черновик следующей версии: разделы, настройки, правила и ссылки на вопросы копируются. ' +
              'Для ваших вопросов, возвращенных на доработку, создаются новые черновики (SPEC-TEST-004).',
            submitLabel: 'Создать новую версию',
            fields: [],
            submit: async (actor, _p, id, c, h) => {
              await uc.createNewVersion.run(actor, { testId: id! }, c)
              return {
                redirectUrl: h.recordActionUrl({ resourceId: 'Test', recordId: id!, actionName: 'builder' }),
                notice: 'Создан черновик новой версии',
              }
            },
          }),
        },
      },
    },
  ]
}

/** Действие «Сводка» задания (AC-ASSIGN-002.6). */
export function assignmentSummaryAction(uc: TestUseCases) {
  return {
    actionType: 'record' as const,
    icon: 'BarChart2',
    component: Components.AssignmentSummary,
    isAccessible: visibleIf((a) => a.has('assignment.update')),
    handler: async (request: ActionRequest, _res: unknown, context: ActionContext) => {
      const { actor, ctx } = currentScope()
      const recordJson = context.record ? { record: context.record.toJSON(context.currentAdmin) } : {}
      if (request.method !== 'post' || !actor) return recordJson
      try {
        const rows = await uc.assignmentSummary.run(actor, { assignmentId: String(context.record!.id()) }, ctx)
        return { ...recordJson, ok: true, rows }
      } catch (e) {
        return { ...recordJson, ...failure(e) }
      }
    },
  }
}
