import type { ActionContext, ActionRequest, ResourceWithOptions } from 'adminjs'
import { isDomainError } from '../../domain/shared/errors.js'
import { VERSION_STATE_LABEL, type VersionState } from '../../domain/versioning/state-machine.js'
import type { ItemDetails, ItemUseCases } from '../../application/itembank/item-use-cases.js'
import type { ItemListRow } from '../../application/itembank/ports.js'
import type { MediaUseCases } from '../../application/media/use-cases.js'
import { formAction, visibleIf } from '../actions.js'
import { Components } from '../component-loader.js'
import { currentScope } from '../context.js'
import { DomainResource, type ResourceGateway } from './domain-resource.js'
import { hidden } from './helpers.js'

const STATES = (Object.keys(VERSION_STATE_LABEL) as VersionState[])
  .filter((s) => s !== 'PUBLISHED')
  .map((s) => ({ value: s, label: VERSION_STATE_LABEL[s] }))

function plain(html: string, max = 140): string {
  const t = html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t || '(без формулировки)'
}

function listRecord(r: ItemListRow) {
  return {
    id: r.id,
    stem: plain(r.stem),
    questionType: r.questionTypeName,
    questionTypeId: r.questionTypeId,
    state: r.state,
    versionNo: r.versionNo,
    owner: r.ownerName,
    ownerId: r.ownerId,
    assignment: r.assignmentTitle ?? '',
    assignmentId: r.assignmentId ?? '',
    courseId: r.courseId,
    course: r.courseName,
    difficulty: r.difficulty,
    topics: r.topicNames.join(', '),
    status: r.status,
    updatedAt: r.updatedAt,
  }
}

function detailRecord(d: ItemDetails) {
  const v = d.version
  return {
    id: d.item.id,
    stem: plain(v.document.stem, 400),
    questionType: d.item.questionTypeName,
    questionTypeId: d.item.questionTypeId,
    state: v.state,
    versionNo: v.versionNo,
    versionId: v.id,
    owner: d.item.ownerName,
    ownerId: d.item.ownerId,
    assignment: d.item.assignmentTitle ?? '',
    assignmentId: d.item.assignmentId ?? '',
    courseId: d.item.courseId,
    course: d.item.courseName,
    difficulty: v.meta.difficulty,
    points: v.meta.defaultPoints,
    tags: v.meta.tags.join(', '),
    status: d.item.status,
    archiveReason: d.item.archiveReason ?? '',
    versions: d.versions.map((x) => `v${x.versionNo} — ${VERSION_STATE_LABEL[x.state]}`).join('\n'),
    issues: d.issues.length
      ? d.issues.map((i) => `${i.severity === 'ERROR' ? '✖' : '⚠'} ${i.message}`).join('\n')
      : 'Ошибок нет — вопрос готов к экспертизе',
    contentHash: v.contentHash ?? '',
    canEdit: d.canEdit,
    canSubmit: d.canSubmit,
    canBranch: d.canBranch,
    canArchive: d.canArchive,
    hasErrors: d.issues.some((i) => i.severity === 'ERROR'),
    updatedAt: d.item.updatedAt,
  }
}

/** Ошибки домена → ответ для собственных компонентов (редактор, предпросмотр). */
function failure(e: unknown) {
  if (!isDomainError(e)) throw e
  const errors: Record<string, string> = {}
  for (const f of e.fieldErrors) errors[f.field] = f.message
  return { ok: false, message: e.ruleId ? `${e.message} (${e.ruleId})` : e.message, errors, code: e.code }
}

export function itemResources(uc: ItemUseCases, media: MediaUseCases): ResourceWithOptions[] {
  const gateway: ResourceGateway = {
    list: async (a, q, c) => {
      if (q.filters.stem) q.filters.text = q.filters.stem
      const r = await uc.listItems.run(a, q, c)
      return { records: r.records.map(listRecord), total: r.total }
    },
    get: async (a, id, c) => detailRecord(await uc.getItem.run(a, { id }, c)),
  }

  /** API редактора (ItemEditor.jsx): операции в теле POST. */
  const editorHandler = async (request: ActionRequest, _res: unknown, context: ActionContext) => {
    const { actor, ctx } = currentScope()
    const recordJson = context.record ? { record: context.record.toJSON(context.currentAdmin) } : {}
    if (request.method !== 'post' || !actor) return recordJson
    // record-действия AdminJS обязаны возвращать record в каждом ответе
    return { ...recordJson, ...(await runOp(request, context, actor, ctx)) }
  }

  const runOp = async (
    request: ActionRequest,
    context: ActionContext,
    actor: NonNullable<ReturnType<typeof currentScope>['actor']>,
    ctx: ReturnType<typeof currentScope>['ctx'],
  ) => {
    const p = (request.payload ?? {}) as Record<string, any>
    const json = (k: string) => (typeof p[k] === 'string' ? JSON.parse(p[k]) : p[k])
    try {
      switch (p.op) {
        case 'context':
          return {
            ok: true,
            ...(await uc.editorContext.run(
              actor,
              { assignmentId: p.assignmentId || null, courseId: p.courseId || null, itemId: p.itemId || null },
              ctx,
            )),
          }
        case 'load': {
          const d = await uc.getItem.run(actor, { id: p.itemId }, ctx)
          return {
            ok: true,
            item: d.item,
            version: d.version,
            issues: d.issues,
            canEdit: d.canEdit,
            typeConfig: d.typeVersion.interactionConfig,
          }
        }
        case 'create': {
          const r = await uc.createItem.run(
            actor,
            {
              assignmentId: p.assignmentId || null,
              courseId: p.courseId || null,
              questionTypeId: p.questionTypeId,
              document: json('document'),
              meta: json('meta'),
            },
            ctx,
          )
          return {
            ok: true,
            ...r,
            redirectUrl: context.h.recordActionUrl({ resourceId: 'Item', recordId: r.itemId, actionName: 'show' }),
          }
        }
        case 'save': {
          const r = await uc.saveDraft.run(
            actor,
            { itemId: p.itemId, document: json('document'), meta: json('meta'), revision: Number(p.revision) },
            ctx,
          )
          return { ok: true, ...r }
        }
        case 'media': {
          const r = await media.listMedia.run(
            actor,
            { filters: { text: p.text ?? '', selectable: 'true', kind: 'IMAGE' }, limit: 60, offset: 0 },
            ctx,
          )
          return {
            ok: true,
            media: r.records.map((m) => ({
              id: m.id,
              title: m.title,
              artist: m.artist,
              altText: m.altText,
              rightsStatus: m.rightsStatus,
              thumb: `/admin/media-file/${m.id}/thumb`,
            })),
          }
        }
        case 'preview':
          return {
            ok: true,
            preview: await uc.previewItem.run(
              actor,
              { itemId: p.itemId, versionId: p.versionId || undefined, seed: Number(p.seed ?? 1) },
              ctx,
            ),
          }
        case 'card': {
          // быстрый просмотр (SPEC-ITEM-005, drawer списка): предпросмотр + история версий
          const d = await uc.getItem.run(actor, { id: p.itemId }, ctx)
          const preview = await uc.previewItem.run(actor, { itemId: p.itemId, versionId: d.version.id, seed: 1 }, ctx)
          return {
            ok: true,
            preview,
            versions: d.versions.map((v) => ({
              versionNo: v.versionNo,
              state: v.state,
              label: VERSION_STATE_LABEL[v.state],
              createdAt: v.createdAt,
              approvedAt: v.approvedAt,
            })),
            meta: {
              owner: d.item.ownerName,
              course: d.item.courseName,
              assignment: d.item.assignmentTitle,
              issues: d.issues.filter((i) => i.severity === 'ERROR').length,
            },
          }
        }
        case 'evaluate':
          return {
            ok: true,
            result: await uc.evaluatePreview.run(
              actor,
              { itemId: p.itemId, versionId: p.versionId || undefined, response: json('response') },
              ctx,
            ),
          }
        default:
          return { ok: false, message: 'Неизвестная операция' }
      }
    } catch (e) {
      return failure(e)
    }
  }

  const back = (h: ActionContext['h'], id: string) =>
    h.recordActionUrl({ resourceId: 'Item', recordId: id, actionName: 'show' })

  return [
    {
      resource: new DomainResource({
        id: 'Item',
        gateway,
        properties: [
          { path: 'id', isId: true, type: 'uuid' },
          { path: 'stem', type: 'textarea' },
          { path: 'questionType' },
          { path: 'questionTypeId', type: 'reference', reference: 'QuestionType' },
          { path: 'state', availableValues: STATES },
          { path: 'versionNo', type: 'number' },
          { path: 'versionId' },
          { path: 'owner' },
          { path: 'ownerId' },
          { path: 'assignment' },
          { path: 'assignmentId', type: 'reference', reference: 'Assignment' },
          { path: 'courseId', type: 'reference', reference: 'Course' },
          { path: 'course' },
          { path: 'topicId', type: 'reference', reference: 'Topic' },
          { path: 'difficulty', type: 'number', isSortable: true },
          { path: 'points', type: 'number' },
          { path: 'topics' },
          { path: 'tags' },
          { path: 'tag' },
          { path: 'status' },
          { path: 'archiveReason' },
          { path: 'versions', type: 'textarea' },
          { path: 'issues', type: 'textarea' },
          { path: 'contentHash' },
          { path: 'updatedAt', type: 'datetime', isSortable: true },
          { path: 'canEdit', type: 'boolean' },
          { path: 'canSubmit', type: 'boolean' },
          { path: 'canBranch', type: 'boolean' },
          { path: 'canArchive', type: 'boolean' },
          { path: 'hasErrors', type: 'boolean' },
        ],
      }),
      options: {
        id: 'Item',
        navigation: { name: 'Банк вопросов', icon: 'Database' },
        titleProperty: 'stem',
        sort: { sortBy: 'updatedAt', direction: 'desc' },
        listProperties: ['stem', 'questionType', 'state', 'versionNo', 'topics', 'difficulty', 'owner'],
        showProperties: [
          'stem',
          'questionType',
          'state',
          'versionNo',
          'issues',
          'course',
          'assignment',
          'topics',
          'difficulty',
          'points',
          'tags',
          'owner',
          'versions',
          'status',
          'archiveReason',
          'contentHash',
        ],
        filterProperties: [
          'stem',
          'questionTypeId',
          'topicId',
          'state',
          'difficulty',
          'assignmentId',
          'courseId',
          'tag',
          'status',
        ],
        properties: {
          questionTypeId: { isVisible: { list: false, show: false, edit: false, filter: true } },
          assignmentId: { isVisible: { list: false, show: false, edit: false, filter: true } },
          courseId: { isVisible: { list: false, show: false, edit: false, filter: true } },
          topicId: { isVisible: { list: false, show: false, edit: false, filter: true } },
          tag: { isVisible: { list: false, show: false, edit: false, filter: true } },
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
          canBranch: hidden,
          canArchive: hidden,
          hasErrors: hidden,
          issues: { components: { show: Components.JsonView } },
        },
        actions: {
          list: { isAccessible: visibleIf((a) => a.has('item.read')) },
          search: { isAccessible: visibleIf((a) => a.has('item.read')) },
          show: { isAccessible: visibleIf((a) => a.has('item.read')) },
          edit: { isAccessible: false, isVisible: false },
          delete: { isAccessible: false, isVisible: false },
          bulkDelete: { isAccessible: false, isVisible: false },
          new: {
            actionType: 'resource',
            icon: 'Plus',
            component: Components.ItemEditor,
            isAccessible: visibleIf((a) => a.has('item.create')),
            handler: editorHandler,
          },
          card: {
            actionType: 'record',
            icon: 'Sidebar',
            component: Components.ItemCard,
            showInDrawer: true,
            isAccessible: visibleIf((a) => a.has('item.read')),
            handler: editorHandler,
          },
          editDraft: {
            actionType: 'record',
            icon: 'Edit',
            component: Components.ItemEditor,
            isAccessible: visibleIf((_a, r) => !!r?.canEdit),
            handler: editorHandler,
          },
          preview: {
            actionType: 'record',
            icon: 'Eye',
            component: Components.ItemPreview,
            isAccessible: visibleIf((a) => a.has('item.read')),
            handler: editorHandler,
          },
          newVersion: formAction({
            actionType: 'record',
            icon: 'Copy',
            isAccessible: visibleIf((_a, r) => !!r?.canBranch),
            description:
              'Будет создан черновик следующей версии с копией содержимого. Текущая версия не изменится (BR-003).',
            submitLabel: 'Создать новую версию',
            fields: [],
            submit: async (actor, _p, id, c, h) => {
              await uc.createNewVersion.run(actor, { itemId: id! }, c)
              return {
                redirectUrl: h.recordActionUrl({ resourceId: 'Item', recordId: id!, actionName: 'editDraft' }),
                notice: 'Создан черновик новой версии',
              }
            },
          }),
          submit: formAction({
            actionType: 'record',
            icon: 'Send',
            isAccessible: visibleIf((_a, r) => !!r?.canSubmit),
            description:
              'Вопрос будет заморожен и отправлен на экспертизу (BR-007). Отозвать отправку можно, пока экспертиза не начата.',
            submitLabel: 'Отправить на экспертизу',
            fields: [],
            submit: async (actor, _p, id, c, h) => {
              await uc.submitItem.run(actor, { itemId: id! }, c)
              return { redirectUrl: back(h, id!), notice: 'Вопрос отправлен на экспертизу' }
            },
          }),
          recall: formAction({
            actionType: 'record',
            icon: 'CornerUpLeft',
            isAccessible: visibleIf(
              (a, r) => a.has('item.submit') && r?.state === 'READY_FOR_REVIEW' && r?.ownerId === a.userId,
            ),
            submitLabel: 'Отозвать отправку',
            fields: [],
            submit: async (actor, _p, id, c, h) => {
              const d = await uc.getItem.run(actor, { id: id! }, c)
              await uc.recallItem.run(actor, { itemId: id!, versionId: d.version.id }, c)
              return { redirectUrl: back(h, id!), notice: 'Отправка отозвана' }
            },
          }),
          discard: formAction({
            actionType: 'record',
            icon: 'Trash2',
            variant: 'danger',
            isAccessible: visibleIf((_a, r) => !!r?.canEdit),
            description:
              'Черновик, который ни разу не отправлялся, удаляется полностью; иначе — переносится в архив (BR-044).',
            submitLabel: 'Удалить черновик',
            fields: [],
            submit: async (actor, _p, id, c, h) => {
              const r = await uc.discardDraft.run(actor, { itemId: id! }, c)
              return r.deleted === 'item'
                ? {
                    redirectUrl: h.resourceActionUrl({ resourceId: 'Item', actionName: 'list' }),
                    notice: 'Вопрос удален',
                  }
                : {
                    redirectUrl: back(h, id!),
                    notice: r.deleted === 'version' ? 'Черновик удален' : 'Черновик перенесен в архив',
                  }
            },
          }),
          compare: formAction({
            actionType: 'record',
            icon: 'GitBranch',
            isAccessible: visibleIf((a) => a.has('item.read')),
            submitLabel: 'Сравнить',
            fields: [
              { name: 'a', label: 'Версия A', type: 'select', required: true },
              { name: 'b', label: 'Версия B', type: 'select', required: true },
            ],
            load: async (actor, id) => {
              const d = await uc.getItem.run(actor, { id: id! }, currentScope().ctx)
              const opts = d.versions.map((v) => ({
                value: v.id,
                label: `v${v.versionNo} — ${VERSION_STATE_LABEL[v.state]}`,
              }))
              return {
                options: { a: opts, b: opts },
                initial: { a: opts[Math.max(0, opts.length - 2)]?.value, b: opts[opts.length - 1]?.value },
              }
            },
            submit: async (actor, p, id, c, h) => {
              const diff = await uc.compareVersions.run(actor, { itemId: id!, a: p.a, b: p.b }, c)
              const fmt = (v: unknown) => (v === null || v === '' ? '∅' : String(v))
              return {
                title: diff.length ? `Отличий: ${diff.length}` : 'Версии совпадают',
                text: diff.map((d) => `${d.field}: ${fmt(d.from)} → ${fmt(d.to)}`).join('\n'),
                backUrl: back(h, id!),
              }
            },
          }),
          archive: formAction({
            actionType: 'record',
            icon: 'Archive',
            variant: 'danger',
            isAccessible: visibleIf((_a, r) => r?.status === 'ACTIVE' && !!r?.canArchive),
            description:
              'Вопрос скрывается из банка и не может быть добавлен в новые тесты; существующие тесты не затрагиваются (BR-039).',
            submitLabel: 'В архив',
            fields: [{ name: 'reason', label: 'Причина', type: 'textarea', required: true }],
            submit: async (actor, p, id, c, h) => {
              await uc.archiveItem.run(actor, { itemId: id!, reason: p.reason }, c)
              return { redirectUrl: back(h, id!), notice: 'Вопрос в архиве' }
            },
          }),
          restore: formAction({
            actionType: 'record',
            icon: 'RotateCcw',
            isAccessible: visibleIf((_a, r) => r?.status === 'ARCHIVED' && !!r?.canArchive),
            submitLabel: 'Восстановить',
            fields: [],
            submit: async (actor, _p, id, c, h) => {
              await uc.restoreItem.run(actor, { itemId: id! }, c)
              return { redirectUrl: back(h, id!), notice: 'Вопрос восстановлен' }
            },
          }),
        },
      },
    },
  ]
}
