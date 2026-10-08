import { DomainError, type FieldError } from '../shared/errors.js'

export type MediaKind = 'IMAGE' | 'VIDEO'
export type RightsStatus = 'PENDING' | 'CLEARED' | 'RESTRICTED'
export type License =
  | 'PUBLIC_DOMAIN'
  | 'CC0'
  | 'CC_BY'
  | 'CC_BY_SA'
  | 'CC_BY_NC'
  | 'CC_BY_NC_SA'
  | 'LICENSED'
  | 'EDUCATIONAL_EXCEPTION'
  | 'UNKNOWN'

export const LICENSES: License[] = [
  'PUBLIC_DOMAIN',
  'CC0',
  'CC_BY',
  'CC_BY_SA',
  'CC_BY_NC',
  'CC_BY_NC_SA',
  'LICENSED',
  'EDUCATIONAL_EXCEPTION',
  'UNKNOWN',
]

/** media-model §1 */
export const MEDIA_FORMATS: Record<string, { kind: MediaKind; maxBytes: number }> = {
  'image/jpeg': { kind: 'IMAGE', maxBytes: 50 * 1024 * 1024 },
  'image/png': { kind: 'IMAGE', maxBytes: 50 * 1024 * 1024 },
  'image/webp': { kind: 'IMAGE', maxBytes: 50 * 1024 * 1024 },
  'image/tiff': { kind: 'IMAGE', maxBytes: 50 * 1024 * 1024 },
  'video/mp4': { kind: 'VIDEO', maxBytes: 500 * 1024 * 1024 },
  'video/webm': { kind: 'VIDEO', maxBytes: 500 * 1024 * 1024 },
}
export const MAX_IMAGE_SIDE = 12000

export function acceptFormat(mime: string | undefined, size: number): MediaKind {
  const f = mime ? MEDIA_FORMATS[mime] : undefined
  if (!f)
    throw DomainError.validation([
      { field: 'file', message: 'Неподдерживаемый формат. Допустимы JPEG, PNG, WebP, TIFF, MP4, WebM.' },
    ])
  if (size > f.maxBytes)
    throw DomainError.validation([
      { field: 'file', message: `Файл слишком большой (максимум ${Math.round(f.maxBytes / 1024 / 1024)} МБ)` },
    ])
  return f.kind
}

export interface RightsFields {
  license: License
  sourceUrl: string | null
  sourceDescription: string | null
  rightsHolder: string | null
  creditLine: string | null
  rightsNote: string | null
}

/** media-model §3: условия статуса CLEARED. */
export function validateCleared(r: RightsFields): void {
  const e: FieldError[] = []
  if (r.license === 'UNKNOWN') e.push({ field: 'license', message: 'Укажите лицензию' })
  if (!r.sourceUrl && !r.sourceDescription)
    e.push({ field: 'sourceUrl', message: 'Укажите источник (URL или описание)' })
  if (!['PUBLIC_DOMAIN', 'CC0'].includes(r.license)) {
    if (!r.rightsHolder) e.push({ field: 'rightsHolder', message: 'Укажите правообладателя' })
    if (!r.creditLine) e.push({ field: 'creditLine', message: 'Укажите строку атрибуции (credit line)' })
  }
  if (['LICENSED', 'EDUCATIONAL_EXCEPTION'].includes(r.license) && !r.rightsNote) {
    e.push({ field: 'rightsNote', message: 'Укажите основание (договор, норма закона)' })
  }
  if (e.length) throw DomainError.validation(e, 'Недостаточно сведений для подтверждения прав')
}

/** BR-024, BR-025, BR-039 — проверка медиа, используемого в вопросе. */
export interface MediaUsageView {
  id: string
  title: string
  kind: MediaKind
  rightsStatus: RightsStatus
  status: 'ACTIVE' | 'ARCHIVED'
  altText: string | null
}

export function mediaIssuesForSubmit(
  m: MediaUsageView,
  altOverride: string | null,
  path: string,
): { path: string; code: string; message: string }[] {
  const out: { path: string; code: string; message: string }[] = []
  if (m.rightsStatus !== 'CLEARED')
    out.push({ path, code: 'BR-024', message: `Права на «${m.title}» не подтверждены (BR-024)` })
  if (m.kind === 'IMAGE' && !(altOverride?.trim() || m.altText?.trim())) {
    out.push({ path, code: 'BR-025', message: `У изображения «${m.title}» нет альтернативного текста (BR-025)` })
  }
  return out
}

export function assertMediaSelectable(m: MediaUsageView, field: string): void {
  if (m.status === 'ARCHIVED') throw DomainError.rule('BR-039', `Медиа «${m.title}» в архиве`, field)
  if (m.rightsStatus === 'RESTRICTED')
    throw DomainError.rule('BR-024', `Медиа «${m.title}» с ограниченными правами`, field)
}

export function normalizeTag(name: string): string {
  return name.trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ')
}
