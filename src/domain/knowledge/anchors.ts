import type { FieldError } from '../shared/errors.js'
import { KIND_BY_PREFIX, KIND_LABEL, KIND_PREFIX, type KnowledgeKind } from './knowledge.js'

/**
 * Якоря на объекты базы знаний в тексте (SPEC-KB-002, ADR-010).
 *   @slug · @kind:slug · [текст](@slug) · [текст](@kind:slug) · \@ — обычный символ.
 * Канонический (хранимый) вид — [подпись](@kind:slug) (BR-050).
 */
const SLUG = String.raw`[\p{L}\p{N}](?:[\p{L}\p{N}_-]{0,78}[\p{L}\p{N}])?`
const LABEL = String.raw`[^\[\]<>\n\r]{1,200}`
// 1: \@ · 2–4: [label](@kind:slug) · 5–6: @kind:slug в начале слова
const ANCHOR_RE = new RegExp(
  String.raw`(\\@)|\[(${LABEL})\]\(@(?:([a-z]+):)?(${SLUG})\)|(?<![\p{L}\p{N}_.\\@])@(?:([a-z]+):)?(${SLUG})`,
  'gu',
)
const CANONICAL_RE = new RegExp(String.raw`\[(${LABEL})\]\(@([a-z]+):(${SLUG})\)`, 'gu')

export interface AnchorRef {
  prefix: string | null
  slug: string
}

export interface ResolvableEntry {
  id: string
  kind: KnowledgeKind
  slug: string
  name: string
  status: 'ACTIVE' | 'ARCHIVED'
}

/** Все ссылки текста (для пакетной загрузки объектов). */
export function collectAnchors(text: string | null | undefined): AnchorRef[] {
  if (!text) return []
  const out: AnchorRef[] = []
  for (const m of text.matchAll(ANCHOR_RE)) {
    if (m[1]) continue
    const prefix = (m[3] ?? m[5] ?? null) as string | null
    out.push({ prefix, slug: (m[4] ?? m[6]!).toLowerCase() })
  }
  return out
}

function cleanLabel(name: string): string {
  return (
    name
      .replace(/[[\]<>\n\r]/g, ' ')
      .trim()
      .slice(0, 200) || name
  )
}

/**
 * Нормализация в канонический вид. entries — объекты, найденные по slug ссылок текста;
 * allowArchived — id, на которые источник уже ссылался (BR-049 не запрещает сохранить их).
 */
export function normalizeAnchors(
  text: string,
  entries: ResolvableEntry[],
  field: string,
  allowArchived: ReadonlySet<string> = new Set(),
): { text: string; entryIds: string[]; errors: FieldError[] } {
  const errors: FieldError[] = []
  const ids = new Set<string>()
  const out = text.replace(ANCHOR_RE, (whole, esc, label, lp, ls, bp, bs) => {
    if (esc) return whole
    const prefix = (lp ?? bp ?? null) as string | null
    const slug = String(ls ?? bs).toLowerCase()
    const shown = `@${prefix ? `${prefix}:` : ''}${slug}`
    let kind: KnowledgeKind | undefined
    if (prefix) {
      kind = KIND_BY_PREFIX[prefix]
      if (!kind) {
        errors.push({
          field,
          message: `${shown}: неизвестный вид «${prefix}» (допустимы: ${Object.values(KIND_PREFIX).join(', ')})`,
        })
        return whole
      }
    }
    const found = entries.filter((e) => e.slug === slug && (!kind || e.kind === kind))
    if (found.length === 0) {
      errors.push({ field, message: `Не найден объект ${shown}` })
      return whole
    }
    if (found.length > 1) {
      errors.push({
        field,
        message: `${shown} есть в нескольких справочниках — уточните вид: ${found.map((e) => `@${KIND_PREFIX[e.kind]}:${slug}`).join(', ')}`,
      })
      return whole
    }
    const e = found[0]!
    if (e.status === 'ARCHIVED' && !allowArchived.has(e.id)) {
      errors.push({ field, message: `«${e.name}» в архиве (BR-049)` })
      return whole
    }
    ids.add(e.id)
    return `[${label ?? cleanLabel(e.name)}](@${KIND_PREFIX[e.kind]}:${e.slug})`
  })
  return { text: out, entryIds: [...ids], errors }
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Рендер для предпросмотра: вызывается ПОСЛЕ sanitizeRichText (AC-KB-002.5, AC-KB-002.6). */
export function renderAnchorsHtml(html: string): string {
  return html
    .replace(CANONICAL_RE, (whole, label: string, prefix: string, slug: string) => {
      const kind = KIND_BY_PREFIX[prefix]
      if (!kind) return whole
      return `<span class="kb-ref" style="text-decoration: underline dotted" title="${escapeAttr(`${KIND_LABEL[kind]}: ${slug}`)}">${label}</span>`
    })
    .replace(/\\@/g, '@')
}

/** Только подписи — для студента и простого текста (BR-050). */
export function stripAnchors(text: string): string
export function stripAnchors(text: string | null): string | null
export function stripAnchors(text: string | null): string | null {
  if (text === null) return null
  return text
    .replace(CANONICAL_RE, (whole, label: string, prefix: string) => (KIND_BY_PREFIX[prefix] ? label : whole))
    .replace(/\\@/g, '@')
}
