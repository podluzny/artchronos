import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { requireScope, scopeFilter, type Actor } from '../../domain/authorization/actor.js'
import type { Scope } from '../../domain/authorization/scope.js'
import { assertCanArchive, assertCanRestore } from '../../domain/shared/archivable.js'
import { DomainError } from '../../domain/shared/errors.js'
import { acceptFormat, LICENSES, validateCleared, type RightsStatus } from '../../domain/media/media-rules.js'
import { diff } from '../shared/audit.js'
import type { Clock, RequestContext } from '../shared/context.js'
import type { ListQuery } from '../shared/query.js'
import type { UnitOfWork } from '../shared/uow.js'
import { useCase } from '../shared/use-case.js'
import type { MediaMetadata, MediaProcessor, MediaRecord, MediaStorage, MediaTx } from './ports.js'

export interface MediaDeps {
  uow: UnitOfWork<MediaTx>
  storage: MediaStorage
  processor: MediaProcessor
  clock: Clock
}

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Не более ${max} символов`)
    .nullish()
    .transform((v) => (v ? v : null))

const metadataSchema = z.object({
  title: z.string().trim().min(1, 'Укажите название').max(300),
  altText: text(1000),
  caption: text(2000),
  transcript: text(20000),
  depictsArtwork: z
    .union([z.boolean(), z.string()])
    .default(true)
    .transform((v) => v === true || v === 'true'),
  artist: text(300),
  workTitle: text(300),
  dateText: text(100),
  technique: text(300),
  collection: text(300),
  inventoryNo: text(100),
  sourceUrl: text(1000).refine((v) => !v || /^https?:\/\//i.test(v), 'URL должен начинаться с http(s)://'),
  sourceDescription: text(1000),
  license: z.enum(LICENSES as [string, ...string[]]).default('UNKNOWN'),
  rightsHolder: text(300),
  creditLine: text(500),
  rightsNote: text(2000),
})

const RIGHTS_FIELDS = ['license', 'sourceUrl', 'sourceDescription', 'rightsHolder', 'creditLine', 'rightsNote'] as const

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const r = schema.safeParse(input)
  if (!r.success)
    throw DomainError.validation(r.error.issues.map((i) => ({ field: i.path.join('.') || 'form', message: i.message })))
  return r.data
}

function metaOf(m: MediaRecord): MediaMetadata {
  const {
    title,
    altText,
    caption,
    transcript,
    depictsArtwork,
    artist,
    workTitle,
    dateText,
    technique,
    collection,
    inventoryNo,
    sourceUrl,
    sourceDescription,
    license,
    rightsHolder,
    creditLine,
    rightsNote,
  } = m
  return {
    title,
    altText,
    caption,
    transcript,
    depictsArtwork,
    artist,
    workTitle,
    dateText,
    technique,
    collection,
    inventoryNo,
    sourceUrl,
    sourceDescription,
    license,
    rightsHolder,
    creditLine,
    rightsNote,
  }
}

export function createMediaUseCases(deps: MediaDeps) {
  const { uow, storage, processor, clock } = deps
  const repo = () => uow.read.media

  const ownRel = (actor: Actor, m: MediaRecord): Set<Scope> =>
    m.ownerId === actor.userId ? new Set<Scope>(['OWN']) : new Set<Scope>()

  async function load(id: string) {
    const m = await repo().findById(id)
    if (!m) throw DomainError.notFound()
    return m
  }

  return {
    /** SPEC-MEDIA-001: загрузка. Формат — по сигнатуре; rightsStatus всегда PENDING (BR-045). */
    uploadMedia: useCase<
      { data: Buffer; metadata: Record<string, unknown>; tags?: string[]; topicIds?: string[] },
      { id: string; duplicateOf: string | null }
    >({
      name: 'media.upload',
      permission: 'media.upload',
      async run(actor, input, ctx) {
        if (!Buffer.isBuffer(input.data) || input.data.length === 0)
          throw DomainError.validation([{ field: 'file', message: 'Выберите файл' }])
        const meta = parse(metadataSchema, input.metadata)
        const inspected = await processor.inspect(input.data)
        const kind = acceptFormat(inspected?.mime, input.data.length)
        const file = { ...inspected!, kind }
        const clean = await processor.sanitize(input.data, file)
        const sha = processor.sha256(input.data)
        const dup = await repo().findBySha(sha)
        const ext = clean.mime.split('/')[1]
        const id = randomUUID()
        const key = `media/${id}/original.${ext}`
        await storage.put(key, clean.data, clean.mime)
        let derivatives: Awaited<ReturnType<MediaProcessor['derivatives']>> = []
        let derivativesStatus: MediaRecord['derivativesStatus'] = kind === 'IMAGE' ? 'READY' : 'SKIPPED'
        try {
          derivatives = await processor.derivatives(clean.data, { ...file, mime: clean.mime })
          for (const d of derivatives) await storage.put(`media/${id}/${d.variant.toLowerCase()}.webp`, d.data, d.mime)
        } catch {
          derivativesStatus = 'FAILED'
          derivatives = []
        }
        const mediaId = await uow.transaction(async (tx) => {
          const mid = await tx.media.insert({
            ...(meta as MediaMetadata),
            kind,
            storageKey: key,
            mimeType: clean.mime,
            sizeBytes: clean.data.length,
            sha256: sha,
            width: clean.width,
            height: clean.height,
            ownerId: actor.userId,
          })
          await tx.media.setDerivatives(
            mid,
            derivativesStatus,
            derivatives.map((d) => ({
              variant: d.variant,
              storageKey: `media/${id}/${d.variant.toLowerCase()}.webp`,
              mimeType: d.mime,
              width: d.width,
              height: d.height,
            })),
          )
          if (input.tags?.length) await tx.media.setTags(mid, input.tags)
          if (input.topicIds?.length) await tx.media.setTopics(mid, input.topicIds)
          await tx.audit.record(
            actor,
            {
              action: 'media.uploaded',
              resourceType: 'media',
              resourceId: mid,
              changes: { title: meta.title, kind, mime: clean.mime, size: clean.data.length },
            },
            ctx,
          )
          return mid
        })
        return { id: mediaId, duplicateOf: dup?.id ?? null }
      },
    }),

    listMedia: useCase<ListQuery, { records: MediaRecord[]; total: number }>({
      name: 'media.list',
      permission: 'media.read',
      run: async (actor, q) => repo().list(scopeFilter(actor, 'media.read'), q),
    }),

    getMedia: useCase<{ id: string }, MediaRecord>({
      name: 'media.get',
      permission: 'media.read',
      run: async (_actor, { id }) => load(id),
    }),

    /** Метаданные; изменение полей прав у CLEARED без media.rights.manage возвращает PENDING (media-model §3). */
    updateMediaMetadata: useCase<
      { id: string; metadata: Record<string, unknown>; tags?: string[]; topicIds?: string[]; revision: number },
      void
    >({
      name: 'media.update',
      permission: 'media.update',
      async run(actor, input, ctx) {
        const m = await load(input.id)
        requireScope(actor, 'media.update', ownRel(actor, m))
        const meta = parse(metadataSchema, { ...metaOf(m), ...input.metadata }) as MediaMetadata
        const rightsChanged = RIGHTS_FIELDS.some((f) => (meta[f] ?? null) !== (m[f] ?? null))
        const canRights = actor.has('media.rights.manage')
        const patch: Parameters<MediaTx['media']['updateMetadata']>[1] = { ...meta }
        if (rightsChanged && m.rightsStatus === 'CLEARED' && !canRights) {
          patch.rightsStatus = 'PENDING'
          patch.rightsVerifiedBy = null
          patch.rightsVerifiedAt = null
        }
        await uow.transaction(async (tx) => {
          await tx.media.updateMetadata(m.id, patch, Number(input.revision))
          if (input.tags) await tx.media.setTags(m.id, input.tags)
          if (input.topicIds) await tx.media.setTopics(m.id, input.topicIds)
          await tx.audit.record(
            actor,
            {
              action: 'media.updated',
              resourceType: 'media',
              resourceId: m.id,
              changes: diff(
                { ...metaOf(m), rightsStatus: m.rightsStatus },
                { ...meta, rightsStatus: patch.rightsStatus ?? m.rightsStatus },
              ),
            },
            ctx,
          )
        })
      },
    }),

    /** SPEC-MEDIA-002: только media.rights.manage устанавливает CLEARED / RESTRICTED (BR-045). */
    setRightsStatus: useCase<{ id: string; status: RightsStatus; note?: string | null; revision: number }, void>({
      name: 'media.setRightsStatus',
      permission: 'media.rights.manage',
      async run(actor, input, ctx) {
        const m = await load(input.id)
        const status = z.enum(['PENDING', 'CLEARED', 'RESTRICTED']).parse(input.status)
        const note = input.note?.trim() || null
        const fields = {
          license: m.license,
          sourceUrl: m.sourceUrl,
          sourceDescription: m.sourceDescription,
          rightsHolder: m.rightsHolder,
          creditLine: m.creditLine,
          rightsNote: note ?? m.rightsNote,
        }
        if (status === 'CLEARED') validateCleared(fields)
        if (status === 'RESTRICTED' && !fields.rightsNote)
          throw DomainError.validation([{ field: 'note', message: 'Укажите основание ограничения' }])
        await uow.transaction(async (tx) => {
          await tx.media.updateMetadata(
            m.id,
            {
              rightsStatus: status,
              rightsNote: fields.rightsNote,
              rightsVerifiedBy: actor.userId,
              rightsVerifiedAt: clock.now(),
            },
            Number(input.revision),
          )
          await tx.audit.record(
            actor,
            {
              action: `media.rights.${status.toLowerCase()}`,
              resourceType: 'media',
              resourceId: m.id,
              changes: diff({ rightsStatus: m.rightsStatus }, { rightsStatus: status }),
              reason: note,
            },
            ctx,
          )
        })
      },
    }),

    mediaUsage: useCase<{ id: string }, Awaited<ReturnType<MediaTx['media']['usage']>>>({
      name: 'media.usage',
      permission: 'media.read',
      async run(_actor, { id }) {
        await load(id)
        return repo().usage(id)
      },
    }),

    archiveMedia: useCase<{ id: string; reason?: string }, void>({
      name: 'media.archive',
      permission: 'media.archive',
      async run(actor, { id, reason }, ctx) {
        const m = await load(id)
        requireScope(actor, 'media.archive', ownRel(actor, m))
        const r = assertCanArchive(m.status, reason)
        await uow.transaction(async (tx) => {
          await tx.media.setArchived(id, true, actor.userId, r)
          await tx.audit.record(
            actor,
            { action: 'media.archived', resourceType: 'media', resourceId: id, reason: r },
            ctx,
          )
        })
      },
    }),

    restoreMedia: useCase<{ id: string }, void>({
      name: 'media.restore',
      permission: 'media.archive',
      async run(actor, { id }, ctx) {
        const m = await load(id)
        requireScope(actor, 'media.archive', ownRel(actor, m))
        assertCanRestore(m.status)
        await uow.transaction(async (tx) => {
          await tx.media.setArchived(id, false, actor.userId, null)
          await tx.audit.record(actor, { action: 'media.restored', resourceType: 'media', resourceId: id }, ctx)
        })
      },
    }),

    /** BR-026: удалить можно только медиа без единой ссылки; иначе — архив. Байты удаляются после фиксации. */
    deleteMedia: useCase<{ id: string }, void>({
      name: 'media.delete',
      permission: 'media.archive',
      async run(actor, { id }, ctx) {
        const m = await load(id)
        requireScope(actor, 'media.archive', ownRel(actor, m))
        const used = await repo().usage(id)
        if (used.length)
          throw DomainError.rule(
            'BR-026',
            'Медиа используется в вопросах — удаление невозможно, используйте архивирование',
          )
        await uow.transaction(async (tx) => {
          await tx.media.delete(id)
          await tx.audit.record(
            actor,
            {
              action: 'media.deleted',
              resourceType: 'media',
              resourceId: id,
              changes: { title: m.title, sha256: m.sha256 },
            },
            ctx,
          )
        })
        for (const key of [m.storageKey, ...m.derivatives.map((d) => d.storageKey)])
          await storage.delete(key).catch(() => undefined)
      },
    }),

    /** Выдача файла только аутентифицированному пользователю с media.read (NFR-SEC-006). */
    readMediaFile: useCase<{ id: string; variant?: string }, { data: Buffer; mime: string }>({
      name: 'media.readFile',
      permission: 'media.read',
      async run(_actor, { id, variant }) {
        const m = await load(id)
        const v = (variant ?? 'ORIGINAL').toUpperCase()
        const d = v === 'ORIGINAL' ? null : m.derivatives.find((x) => x.variant === v)
        const key = d?.storageKey ?? m.storageKey
        const data = await storage.get(key)
        if (!data) throw DomainError.notFound('Файл не найден в хранилище')
        return { data, mime: d?.mimeType ?? m.mimeType }
      },
    }),
  }
}

export type MediaUseCases = ReturnType<typeof createMediaUseCases>
export type { RequestContext }
