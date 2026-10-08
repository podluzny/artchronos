import type { ActionContext, ActionRequest, ResourceWithOptions } from 'adminjs'
import type { TestUseCases } from '../../application/assessment/test-use-cases.js'
import type { ItemUseCases } from '../../application/itembank/item-use-cases.js'
import type { ReviewRecord } from '../../application/review/ports.js'
import type { ReviewDetails, ReviewUseCases } from '../../application/review/review-use-cases.js'
import { REVIEW_STATUS_LABEL, type ReviewStatus } from '../../domain/review/review-rules.js'
import { DomainError, isDomainError } from '../../domain/shared/errors.js'
import { VERSION_STATE_LABEL } from '../../domain/versioning/state-machine.js'
import { formAction, visibleIf } from '../actions.js'
import { Components } from '../component-loader.js'
import { currentScope } from '../context.js'
import { DomainResource, type ResourceGateway } from './domain-resource.js'
import { hidden } from './helpers.js'

const STATUSES = (Object.keys(REVIEW_STATUS_LABEL) as ReviewStatus[]).map((s) => ({
  value: s,
  label: REVIEW_STATUS_LABEL[s],
}))
const QUEUES = [
  { value: 'mine', label: 'Мои экспертизы' },
  { value: 'unassigned', label: 'Не назначено' },
]

const plain = (html: string, max = 90) => {
  const t = html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

function listRecord(r: ReviewRecord) {
  return {
    id: r.id,
    subject: `${r.subjectType === 'TEST_VERSION' ? 'Тест' : 'Вопрос'}: ${plain(r.subjectTitle)} · v${r.versionNo}`,
    subjectType: r.subjectType,
    versionState: r.versionState,
    status: r.status,
    owner: r.ownerName,
    assignment: r.assignmentTitle ?? '',
    course: r.courseName,
    reviewer: r.primaryReviewerName ?? '— не назначен —',
    submittedAt: r.submittedAt,
    decidedAt: r.decidedAt,
    testId: r.testId ?? '',
    itemId: r.itemId ?? '',
  }
}

function detailRecord(d: ReviewDetails) {
  return {
    ...listRecord(d.review),
    summary: d.review.summary ?? '',
    assignments: d.assignments
      .map(
        (a) =>
          `${a.reviewerName} — ${a.role === 'PRIMARY' ? 'основной' : 'консультант'} (${
            { ACTIVE: 'активно', REVOKED: 'снято', COMPLETED: 'завершено' }[a.status]
          })${a.reason ? `: ${a.reason}` : ''}`,
      )
      .join('\n'),
    canAssign: d.canAssign,
  }
}

function failure(e: unknown) {
  if (!isDomainError(e)) throw e
  const errors: Record<string, string> = {}
  for (const f of e.fieldErrors) errors[f.field] = f.message
  return { ok: false, message: e.ruleId ? `${e.message} (${e.ruleId})` : e.message, errors, code: e.code }
}

export function reviewResources(uc: ReviewUseCases, tests: TestUseCases, items: ItemUseCases): ResourceWithOptions[] {
  const gateway: ResourceGateway = {
    list: async (a, q, c) => {
      const r = await uc.listReviews.run(a, q, c)
      return { records: r.records.map(listRecord), total: r.total }
    },
    get: async (a, id, c) => detailRecord(await uc.getReview.run(a, { id }, c)),
  }

  const templateRecord = (t: Awaited<ReturnType<ReviewUseCases['listTemplates']['run']>>[number]) => ({
    id: t.id,
    name: t.name,
    appliesTo: t.appliesTo,
    versionNo: t.versionNo,
    status: t.status,
    items: t.items.map((i) => `${i.code}: ${i.text}${i.mandatory ? '' : ' (необязательный)'}`).join('\n'),
    createdAt: t.createdAt,
  })
  const templates: ResourceGateway = {
    list: async (a, _q, c) => {
      const all = await uc.listTemplates.run(a, {}, c)
      return { records: all.map(templateRecord), total: all.length }
    },
    get: async (a, id, c) => {
      const t = (await uc.listTemplates.run(a, {}, c)).find((x) => x.id === id)
      if (!t) throw DomainError.notFound()
      return templateRecord(t)
    },
  }

  /** API рабочего места эксперта (ReviewWorkspace.jsx). */
  const workspaceHandler = async (request: ActionRequest, _res: unknown, context: ActionContext) => {
    const { actor, ctx } = currentScope()
    const recordJson = context.record ? { record: context.record.toJSON(context.currentAdmin) } : {}
    if (request.method !== 'post' || !actor) return recordJson
    const p = (request.payload ?? {}) as Record<string, any>
    const json = (k: string) => (typeof p[k] === 'string' && /^[[{]/.test(p[k]) ? JSON.parse(p[k]) : p[k])
    const reviewId = String(context.record!.id())
    const run = async (): Promise<Record<string, unknown>> => {
      switch (p.op) {
        case 'load': {
          const details = await uc.getReview.run(actor, { id: reviewId }, ctx)
          const rv = details.review
          if (rv.subjectType === 'TEST_VERSION') {
            const preview = await tests.previewTest.run(
              actor,
              { testId: rv.testId!, versionId: rv.testVersionId!, seed: 1 },
              ctx,
            )
            return { details, preview }
          }
          const itemPreview = await items.previewItem.run(
            actor,
            { itemId: rv.itemId!, versionId: rv.itemVersionId!, seed: 1 },
            ctx,
          )
          return { details, itemPreview: { ...itemPreview, points: 1 } }
        }
        case 'start':
          await uc.startReview.run(actor, { reviewId }, ctx)
          return {}
        case 'checklist':
          await uc.answerChecklist.run(
            actor,
            { reviewId, code: p.code, checked: p.checked === true || p.checked === 'true' },
            ctx,
          )
          return {}
        case 'comment':
          return uc.addComment.run(
            actor,
            {
              reviewId,
              body: p.body,
              severity: p.severity || null,
              anchor: json('anchor') || {},
              parentId: p.parentId || null,
            },
            ctx,
          )
        case 'issueStatus':
          await uc.setIssueStatus.run(actor, { issueId: p.issueId, status: p.status, note: p.note }, ctx)
          return {}
        case 'requestChanges':
          await uc.requestChanges.run(actor, { reviewId, summary: p.summary }, ctx)
          return {}
        case 'approve':
          await uc.approve.run(actor, { reviewId }, ctx)
          return {}
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
    h.recordActionUrl({ resourceId: 'Review', recordId: id, actionName: 'show' })

  return [
    {
      resource: new DomainResource({
        id: 'Review',
        gateway,
        properties: [
          { path: 'id', isId: true, type: 'uuid' },
          { path: 'subject' },
          {
            path: 'subjectType',
            availableValues: [
              { value: 'TEST_VERSION', label: 'Тест' },
              { value: 'ITEM_VERSION', label: 'Вопрос' },
            ],
          },
          {
            path: 'versionState',
            availableValues: Object.entries(VERSION_STATE_LABEL).map(([value, label]) => ({ value, label })),
          },
          { path: 'status', availableValues: STATUSES },
          { path: 'queue', availableValues: QUEUES },
          { path: 'owner' },
          { path: 'assignment' },
          { path: 'course' },
          { path: 'reviewer' },
          { path: 'assignments', type: 'textarea' },
          { path: 'summary', type: 'textarea' },
          { path: 'submittedAt', type: 'datetime', isSortable: true },
          { path: 'decidedAt', type: 'datetime' },
          { path: 'testId' },
          { path: 'itemId' },
          { path: 'canAssign', type: 'boolean' },
        ],
      }),
      options: {
        id: 'Review',
        navigation: { name: 'Экспертиза', icon: 'CheckSquare' },
        titleProperty: 'subject',
        sort: { sortBy: 'submittedAt', direction: 'desc' },
        listProperties: ['subject', 'status', 'owner', 'assignment', 'reviewer', 'submittedAt'],
        showProperties: [
          'subject',
          'status',
          'versionState',
          'owner',
          'assignment',
          'course',
          'reviewer',
          'assignments',
          'summary',
          'submittedAt',
          'decidedAt',
        ],
        filterProperties: ['queue', 'status', 'subjectType'],
        properties: {
          queue: { isVisible: { list: false, show: false, edit: false, filter: true } },
          subjectType: { isVisible: { list: false, show: false, edit: false, filter: true } },
          testId: hidden,
          itemId: hidden,
          canAssign: hidden,
          assignments: { components: { show: Components.JsonView } },
        },
        actions: {
          list: { isAccessible: visibleIf((a) => a.has('review.read')) },
          search: { isAccessible: visibleIf((a) => a.has('review.read')) },
          show: { isAccessible: visibleIf((a) => a.has('review.read')) },
          new: { isAccessible: false, isVisible: false },
          edit: { isAccessible: false, isVisible: false },
          delete: { isAccessible: false, isVisible: false },
          bulkDelete: { isAccessible: false, isVisible: false },
          workspace: {
            actionType: 'record',
            icon: 'Clipboard',
            component: Components.ReviewWorkspace,
            isAccessible: visibleIf((a) => a.has('review.read')),
            handler: workspaceHandler,
          },
          assign: formAction({
            actionType: 'record',
            icon: 'UserPlus',
            isAccessible: visibleIf((_a, r) => !!r?.canAssign),
            description:
              'Эксперт — активный пользователь с правом экспертизы, не автор (BR-027). У экспертизы один основной эксперт (BR-030); консультанты только комментируют.',
            submitLabel: 'Назначить',
            fields: [
              { name: 'reviewerId', label: 'Эксперт', type: 'select', required: true },
              {
                name: 'role',
                label: 'Роль',
                type: 'select',
                required: true,
                options: [
                  { value: 'PRIMARY', label: 'Основной эксперт' },
                  { value: 'ADVISORY', label: 'Консультант' },
                ],
              },
              { name: 'reason', label: 'Причина (обязательна при переназначении)', type: 'textarea' },
            ],
            load: async (actor, id) => ({
              options: { reviewerId: await uc.reviewerOptions.run(actor, { reviewId: id! }, currentScope().ctx) },
              initial: { role: 'PRIMARY' },
            }),
            submit: async (actor, p, id, c, h) => {
              await uc.assignReviewer.run(
                actor,
                { reviewId: id!, reviewerId: p.reviewerId, role: p.role, reason: p.reason },
                c,
              )
              return { redirectUrl: back(h, id!), notice: 'Эксперт назначен' }
            },
          }),
        },
      },
    },
    {
      resource: new DomainResource({
        id: 'ChecklistTemplate',
        gateway: templates,
        properties: [
          { path: 'id', isId: true, type: 'uuid' },
          { path: 'name' },
          {
            path: 'appliesTo',
            availableValues: [
              { value: 'TEST_VERSION', label: 'Экспертиза теста' },
              { value: 'ITEM_VERSION', label: 'Экспертиза вопроса' },
            ],
          },
          { path: 'versionNo', type: 'number' },
          {
            path: 'status',
            availableValues: [
              { value: 'ACTIVE', label: 'Действует' },
              { value: 'ARCHIVED', label: 'Предыдущая версия' },
            ],
          },
          { path: 'items', type: 'textarea' },
          { path: 'createdAt', type: 'datetime' },
        ],
      }),
      options: {
        id: 'ChecklistTemplate',
        navigation: { name: 'Экспертиза', icon: 'CheckSquare' },
        titleProperty: 'name',
        listProperties: ['name', 'appliesTo', 'versionNo', 'status', 'createdAt'],
        showProperties: ['name', 'appliesTo', 'versionNo', 'status', 'items', 'createdAt'],
        filterProperties: [],
        properties: { items: { components: { show: Components.JsonView } } },
        actions: {
          list: { isAccessible: visibleIf((a) => a.has('checklist.manage')) },
          show: { isAccessible: visibleIf((a) => a.has('checklist.manage')) },
          search: { isAccessible: false, isVisible: false },
          new: { isAccessible: false, isVisible: false },
          edit: { isAccessible: false, isVisible: false },
          delete: { isAccessible: false, isVisible: false },
          bulkDelete: { isAccessible: false, isVisible: false },
          newTemplateVersion: formAction({
            actionType: 'record',
            icon: 'Edit',
            isAccessible: visibleIf((a, r) => a.has('checklist.manage') && r?.status === 'ACTIVE'),
            description:
              'Новая версия шаблона применяется к новым экспертизам; начатые экспертизы сохраняют свою версию. ' +
              'Одна строка — один пункт: КОД | текст | обязательный (да/нет).',
            submitLabel: 'Сохранить новую версию',
            fields: [
              { name: 'name', label: 'Название', required: true },
              { name: 'items', label: 'Пункты', type: 'textarea', required: true },
            ],
            load: async (actor, id) => {
              const t = (await uc.listTemplates.run(actor, {}, currentScope().ctx)).find((x) => x.id === id)!
              return {
                initial: {
                  name: t.name,
                  items: t.items.map((i) => `${i.code} | ${i.text} | ${i.mandatory ? 'да' : 'нет'}`).join('\n'),
                },
              }
            },
            submit: async (actor, p, id, c, h) => {
              const t = (await uc.listTemplates.run(actor, {}, c)).find((x) => x.id === id)!
              const items = String(p.items ?? '')
                .split('\n')
                .map((l) => l.split('|').map((x) => x.trim()))
                .filter((x) => x[0])
                .map(([code, text, m]) => ({
                  code: code!,
                  text: text ?? '',
                  mandatory: !/^(нет|no|false|0)$/i.test(m ?? ''),
                }))
              const r = await uc.updateTemplate.run(actor, { appliesTo: t.appliesTo, name: p.name, items }, c)
              return {
                redirectUrl: h.recordActionUrl({ resourceId: 'ChecklistTemplate', recordId: r.id, actionName: 'show' }),
                notice: 'Новая версия шаблона сохранена',
              }
            },
          }),
        },
      },
    },
  ]
}
