import type { ScopeFilter } from '../../domain/authorization/actor.js'
import type { License, MediaKind, RightsStatus } from '../../domain/media/media-rules.js'
import type { AuditWriter } from '../shared/audit.js'
import type { ListQuery } from '../shared/query.js'

/** Хранилище байтов (ADR-007). Драйверы: local (fs), db (PostgreSQL, тестовый стенд), s3 (production). */
export interface MediaStorage {
  put(key: string, data: Buffer, mime: string): Promise<void>
  get(key: string): Promise<Buffer | null>
  delete(key: string): Promise<void>
}

export interface InspectedFile {
  mime: string
  kind: MediaKind
  width: number | null
  height: number | null
}

export interface Derivative {
  variant: 'THUMB' | 'PREVIEW' | 'POSTER'
  data: Buffer
  mime: string
  width: number
  height: number
}

/** Обработка файлов: определение формата по сигнатуре, санитизация, производные (NFR-SEC-006). */
export interface MediaProcessor {
  inspect(data: Buffer): Promise<InspectedFile | null>
  /** Перекодирование изображения: удаление EXIF/GPS, TIFF → PNG. Видео возвращается как есть. */
  sanitize(
    data: Buffer,
    file: InspectedFile,
  ): Promise<{ data: Buffer; mime: string; width: number | null; height: number | null }>
  derivatives(data: Buffer, file: InspectedFile): Promise<Derivative[]>
  sha256(data: Buffer): string
}

export interface MediaMetadata {
  title: string
  altText: string | null
  caption: string | null
  transcript: string | null
  depictsArtwork: boolean
  artist: string | null
  workTitle: string | null
  dateText: string | null
  technique: string | null
  collection: string | null
  inventoryNo: string | null
  sourceUrl: string | null
  sourceDescription: string | null
  license: License
  rightsHolder: string | null
  creditLine: string | null
  rightsNote: string | null
}

export interface MediaRecord extends MediaMetadata {
  id: string
  kind: MediaKind
  storageKey: string
  mimeType: string
  sizeBytes: number
  sha256: string
  width: number | null
  height: number | null
  rightsStatus: RightsStatus
  rightsVerifiedBy: string | null
  rightsVerifiedAt: Date | null
  ownerId: string
  ownerName: string
  derivativesStatus: 'PENDING' | 'READY' | 'FAILED' | 'SKIPPED'
  derivatives: { variant: string; storageKey: string; mimeType: string }[]
  status: 'ACTIVE' | 'ARCHIVED'
  archiveReason: string | null
  tags: string[]
  topicIds: string[]
  createdAt: Date
  updatedAt: Date
  revision: number
}

export interface MediaUsage {
  itemId: string
  itemVersionId: string
  versionNo: number
  state: string
  via: 'OPTION' | 'MEDIA'
}

export interface AffectedTest {
  testId: string
  title: string
  versionNo: number
  state: string
}

export interface MediaRepository {
  list(filter: ScopeFilter, q: ListQuery): Promise<{ records: MediaRecord[]; total: number }>
  findById(id: string): Promise<MediaRecord | null>
  findByIds(ids: string[]): Promise<MediaRecord[]>
  findBySha(sha: string): Promise<MediaRecord | null>
  insert(
    d: MediaMetadata & {
      kind: MediaKind
      storageKey: string
      mimeType: string
      sizeBytes: number
      sha256: string
      width: number | null
      height: number | null
      ownerId: string
    },
  ): Promise<string>
  updateMetadata(
    id: string,
    d: Partial<MediaMetadata> & {
      rightsStatus?: RightsStatus
      rightsVerifiedBy?: string | null
      rightsVerifiedAt?: Date | null
    },
    revision: number,
  ): Promise<void>
  setDerivatives(
    id: string,
    status: MediaRecord['derivativesStatus'],
    items: { variant: string; storageKey: string; mimeType: string; width: number; height: number }[],
  ): Promise<void>
  setTags(id: string, names: string[]): Promise<void>
  setTopics(id: string, topicIds: string[]): Promise<void>
  setArchived(id: string, archived: boolean, by: string, reason: string | null): Promise<void>
  usage(id: string): Promise<MediaUsage[]>
  /** Тесты, чьи утвержденные/опубликованные версии содержат вопросы с этим медиа (AC-MEDIA-002.7). */
  affectedTests(id: string): Promise<AffectedTest[]>
  delete(id: string): Promise<void>
}

export interface MediaTx {
  media: MediaRepository
  audit: AuditWriter
}
