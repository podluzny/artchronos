import { readFile } from 'node:fs/promises'
import type { ActionContext, ActionRequest, ResourceWithOptions } from 'adminjs'
import { isDomainError } from '../../domain/shared/errors.js'
import { LICENSES } from '../../domain/media/media-rules.js'
import type { MediaRecord } from '../../application/media/ports.js'
import type { MediaUseCases } from '../../application/media/use-cases.js'
import { formAction, visibleIf } from '../actions.js'
import { Components } from '../component-loader.js'
import { currentScope } from '../context.js'
import { DomainResource, type ResourceGateway } from './domain-resource.js'
import { archiveActions, hidden } from './helpers.js'

const LICENSE_LABELS: Record<string, string> = {
  PUBLIC_DOMAIN: 'Общественное достояние',
  CC0: 'CC0',
  CC_BY: 'CC BY',
  CC_BY_SA: 'CC BY-SA',
  CC_BY_NC: 'CC BY-NC',
  CC_BY_NC_SA: 'CC BY-NC-SA',
  LICENSED: 'По лицензии/договору',
  EDUCATIONAL_EXCEPTION: 'Учебное использование (норма закона)',
  UNKNOWN: 'Не указана',
}
const RIGHTS = [
  { value: 'PENDING', label: 'Не проверено' },
  { value: 'CLEARED', label: 'Права подтверждены' },
  { value: 'RESTRICTED', label: 'Ограничено' },
]

const METADATA_FIELDS = [
  'title',
  'altText',
  'caption',
  'transcript',
  'depictsArtwork',
  'artist',
  'workTitle',
  'dateText',
  'technique',
  'collection',
  'inventoryNo',
  'sourceUrl',
  'sourceDescription',
  'license',
  'rightsHolder',
  'creditLine',
  'rightsNote',
] as const

export function mediaRecord(m: MediaRecord, usage?: { itemId: string; versionNo: number; state: string }[]) {
  return {
    id: m.id,
    thumb: m.kind === 'IMAGE' ? `/admin/media-file/${m.id}/thumb` : '',
    file: `/admin/media-file/${m.id}/original`,
    kind: m.kind,
    title: m.title,
    altText: m.altText ?? '',
    caption: m.caption ?? '',
    transcript: m.transcript ?? '',
    depictsArtwork: m.depictsArtwork,
    artist: m.artist ?? '',
    workTitle: m.workTitle ?? '',
    dateText: m.dateText ?? '',
    technique: m.technique ?? '',
    collection: m.collection ?? '',
    inventoryNo: m.inventoryNo ?? '',
    sourceUrl: m.sourceUrl ?? '',
    sourceDescription: m.sourceDescription ?? '',
    license: m.license,
    rightsHolder: m.rightsHolder ?? '',
    creditLine: m.creditLine ?? '',
    rightsNote: m.rightsNote ?? '',
    rightsStatus: m.rightsStatus,
    tags: m.tags.join(', '),
    size: `${m.width && m.height ? `${m.width}×${m.height}, ` : ''}${Math.round(m.sizeBytes / 1024)} КБ, ${m.mimeType}`,
    owner: m.ownerName,
    ownerId: m.ownerId,
    status: m.status,
    archiveReason: m.archiveReason ?? '',
    usage: usage
      ? usage.length
        ? usage.map((u) => `вопрос ${u.itemId.slice(0, 8)} · v${u.versionNo} · ${u.state}`).join('\n')
        : 'не используется'
      : '',
    createdAt: m.createdAt,
    revision: m.revision,
  }
}

export function mediaResources(uc: MediaUseCases): ResourceWithOptions[] {
  const ctx = () => currentScope().ctx
  const gateway: ResourceGateway = {
    list: async (a, q, c) => {
      if (q.filters.title) q.filters.text = q.filters.title
      const r = await uc.listMedia.run(a, q, c)
      return { records: r.records.map((m) => mediaRecord(m)), total: r.total }
    },
    get: async (a, id, c) => mediaRecord(await uc.getMedia.run(a, { id }, c), await uc.mediaUsage.run(a, { id }, c)),
    update: async (a, id, p, c) => {
      const metadata: Record<string, unknown> = {}
      for (const f of METADATA_FIELDS) if (p[f] !== undefined) metadata[f] = p[f]
      await uc.updateMediaMetadata.run(
        a,
        {
          id,
          metadata,
          tags:
            typeof p.tags === 'string'
              ? p.tags
                  .split(',')
                  .map((t: string) => t.trim())
                  .filter(Boolean)
              : undefined,
          revision: Number(p.revision),
        },
        c,
      )
      return mediaRecord(await uc.getMedia.run(a, { id }, c))
    },
    delete: async (a, id, c) => uc.deleteMedia.run(a, { id }, c),
  }

  const canEdit = (a: { has: (k: string, s?: any) => boolean; userId: string }, r: Record<string, any> | null) =>
    a.has('media.update', 'ANY') || (a.has('media.update', 'OWN') && r?.ownerId === a.userId)
  const canArchive = (a: { has: (k: string, s?: any) => boolean; userId: string }, r: Record<string, any> | null) =>
    a.has('media.archive', 'ANY') || (a.has('media.archive', 'OWN') && r?.ownerId === a.userId)

  return [
    {
      resource: new DomainResource({
        id: 'MediaAsset',
        gateway,
        properties: [
          { path: 'id', isId: true, type: 'uuid' },
          { path: 'thumb' },
          { path: 'file' },
          {
            path: 'kind',
            availableValues: [
              { value: 'IMAGE', label: 'Изображение' },
              { value: 'VIDEO', label: 'Видео' },
            ],
          },
          { path: 'title' },
          { path: 'altText', type: 'textarea' },
          { path: 'caption', type: 'textarea' },
          { path: 'transcript', type: 'textarea' },
          { path: 'depictsArtwork', type: 'boolean' },
          { path: 'artist' },
          { path: 'workTitle' },
          { path: 'dateText' },
          { path: 'technique' },
          { path: 'collection' },
          { path: 'inventoryNo' },
          { path: 'sourceUrl' },
          { path: 'sourceDescription', type: 'textarea' },
          { path: 'license', availableValues: LICENSES.map((l) => ({ value: l, label: LICENSE_LABELS[l]! })) },
          { path: 'rightsHolder' },
          { path: 'creditLine' },
          { path: 'rightsNote', type: 'textarea' },
          { path: 'rightsStatus', availableValues: RIGHTS },
          { path: 'tags' },
          { path: 'tag' },
          { path: 'size' },
          { path: 'owner' },
          { path: 'ownerId' },
          { path: 'status' },
          { path: 'archiveReason' },
          { path: 'usage', type: 'textarea' },
          { path: 'createdAt', type: 'datetime' },
          { path: 'revision', type: 'number' },
        ],
      }),
      options: {
        id: 'MediaAsset',
        navigation: { name: 'Медиатека', icon: 'Image' },
        titleProperty: 'title',
        listProperties: ['thumb', 'title', 'artist', 'kind', 'rightsStatus', 'owner'],
        showProperties: [
          'thumb',
          'title',
          'altText',
          'caption',
          'artist',
          'workTitle',
          'dateText',
          'technique',
          'collection',
          'inventoryNo',
          'sourceUrl',
          'sourceDescription',
          'license',
          'rightsHolder',
          'creditLine',
          'rightsStatus',
          'rightsNote',
          'tags',
          'size',
          'owner',
          'usage',
          'status',
          'archiveReason',
        ],
        editProperties: [...METADATA_FIELDS.filter((f) => f !== 'rightsNote'), 'tags'],
        filterProperties: ['title', 'artist', 'kind', 'rightsStatus', 'license', 'tag', 'status'],
        properties: {
          thumb: {
            components: { list: Components.MediaThumb, show: Components.MediaThumb },
            isVisible: { list: true, show: true, edit: false, filter: false },
          },
          file: hidden,
          ownerId: hidden,
          revision: hidden,
          tag: { isVisible: { list: false, show: false, edit: false, filter: true } },
          status: {
            availableValues: [
              { value: 'ACTIVE', label: 'Активно' },
              { value: 'ARCHIVED', label: 'В архиве' },
            ],
          },
          license: { availableValues: LICENSES.map((l) => ({ value: l, label: LICENSE_LABELS[l]! })) },
          rightsStatus: { availableValues: RIGHTS },
        },
        actions: {
          list: { isAccessible: visibleIf((a) => a.has('media.read')) },
          search: { isAccessible: visibleIf((a) => a.has('media.read')) },
          show: { isAccessible: visibleIf((a) => a.has('media.read')) },
          edit: { isAccessible: visibleIf((a, r) => r?.status === 'ACTIVE' && canEdit(a, r)) },
          delete: {
            isAccessible: visibleIf((a, r) => canArchive(a, r)),
            guard: 'Удалить файл? Используемые медиа удалить нельзя (BR-026) — только архивировать.',
          },
          bulkDelete: { isAccessible: false, isVisible: false },
          new: {
            actionType: 'resource',
            icon: 'Upload',
            component: Components.MediaUpload,
            isAccessible: visibleIf((a) => a.has('media.upload')),
            handler: async (request: ActionRequest, _res: unknown, context: ActionContext) => {
              const { actor, ctx: c } = currentScope()
              if (request.method !== 'post' || !actor) return {}
              const payload = (request.payload ?? {}) as Record<string, any>
              const file = payload.file as { path?: string; filepath?: string } | undefined
              const p = file?.path ?? file?.filepath
              try {
                if (!p) throw Object.assign(new Error('Выберите файл'), { code: 'VALIDATION' })
                const data = await readFile(p)
                const metadata: Record<string, unknown> = {}
                for (const f of METADATA_FIELDS)
                  if (payload[f] !== undefined && payload[f] !== '') metadata[f] = payload[f]
                const r = await uc.uploadMedia.run(
                  actor!,
                  {
                    data,
                    metadata,
                    tags: String(payload.tags ?? '')
                      .split(',')
                      .map((t) => t.trim())
                      .filter(Boolean),
                  },
                  c,
                )
                return {
                  redirectUrl: context.h.recordActionUrl({
                    resourceId: 'MediaAsset',
                    recordId: r.id,
                    actionName: 'show',
                  }),
                  notice: {
                    message: r.duplicateOf
                      ? 'Загружено. Такой файл уже есть в медиатеке — возможно, стоит использовать существующий.'
                      : 'Файл загружен',
                    type: 'success',
                  },
                }
              } catch (e) {
                if (isDomainError(e)) {
                  const errors: Record<string, string> = {}
                  for (const f of e.fieldErrors) errors[f.field] = f.message
                  return { notice: { message: e.fieldErrors[0]?.message ?? e.message, type: 'error' }, errors }
                }
                if ((e as { code?: string }).code === 'VALIDATION')
                  return { notice: { message: (e as Error).message, type: 'error' } }
                throw e
              }
            },
          },
          rights: formAction({
            actionType: 'record',
            icon: 'Shield',
            isAccessible: visibleIf((a) => a.has('media.rights.manage')),
            description:
              'Подтверждение прав (BR-045). Для «Права подтверждены» нужны лицензия, источник, для несвободных лицензий — правообладатель и строка атрибуции (заполняются в «Редактировать»).',
            submitLabel: 'Сохранить статус прав',
            fields: [
              { name: 'status', label: 'Статус прав', type: 'select', required: true, options: RIGHTS },
              { name: 'note', label: 'Основание / комментарий', type: 'textarea' },
            ],
            load: async (actor, id) => {
              const m = await uc.getMedia.run(actor, { id: id! }, ctx())
              return { initial: { status: m.rightsStatus, note: m.rightsNote ?? '' } }
            },
            submit: async (actor, p, id, c, h) => {
              const m = await uc.getMedia.run(actor, { id: id! }, c)
              await uc.setRightsStatus.run(actor, { id: id!, status: p.status, note: p.note, revision: m.revision }, c)
              return {
                redirectUrl: h.recordActionUrl({ resourceId: 'MediaAsset', recordId: id!, actionName: 'show' }),
                notice: 'Статус прав сохранен',
              }
            },
          }),
          ...archiveActions({
            resourceId: 'MediaAsset',
            canManage: canArchive,
            archive: uc.archiveMedia.run,
            restore: uc.restoreMedia.run,
          }),
        },
      },
    },
  ]
}
