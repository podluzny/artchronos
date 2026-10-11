import { DomainError, type FieldError } from '../shared/errors.js'

/** Виды объектов базы знаний (SPEC-KB-001, ADR-010). */
export const KNOWLEDGE_KINDS = ['PERSON', 'ARTWORK', 'COLLECTION', 'MOVEMENT', 'PERIOD', 'TECHNIQUE', 'TERM'] as const
export type KnowledgeKind = (typeof KNOWLEDGE_KINDS)[number]

/** Префикс вида в якоре: @person:slug. */
export const KIND_PREFIX: Record<KnowledgeKind, string> = {
  PERSON: 'person',
  ARTWORK: 'artwork',
  COLLECTION: 'collection',
  MOVEMENT: 'movement',
  PERIOD: 'period',
  TECHNIQUE: 'technique',
  TERM: 'term',
}
export const KIND_BY_PREFIX: Record<string, KnowledgeKind> = Object.fromEntries(
  Object.entries(KIND_PREFIX).map(([k, p]) => [p, k as KnowledgeKind]),
)
export const KIND_LABEL: Record<KnowledgeKind, string> = {
  PERSON: 'Автор',
  ARTWORK: 'Произведение',
  COLLECTION: 'Собрание',
  MOVEMENT: 'Направление',
  PERIOD: 'Период',
  TECHNIQUE: 'Техника',
  TERM: 'Термин',
}

export type LinkRelation = 'AUTHOR' | 'COLLECTION' | 'TECHNIQUE' | 'MOVEMENT' | 'PERIOD' | 'PARENT' | 'SEE_ALSO'

/** Допустимые связи: вид-источник → отношение → вид цели, кратность (SPEC-KB-001 Input). */
export const LINK_RULES: Record<
  KnowledgeKind,
  Partial<Record<LinkRelation, { to: KnowledgeKind; single?: boolean }>>
> = {
  ARTWORK: {
    AUTHOR: { to: 'PERSON' },
    COLLECTION: { to: 'COLLECTION', single: true },
    TECHNIQUE: { to: 'TECHNIQUE' },
    MOVEMENT: { to: 'MOVEMENT' },
    PERIOD: { to: 'PERIOD' },
  },
  PERSON: { MOVEMENT: { to: 'MOVEMENT' } },
  MOVEMENT: { PARENT: { to: 'MOVEMENT', single: true }, PERIOD: { to: 'PERIOD' } },
  PERIOD: { PARENT: { to: 'PERIOD', single: true } },
  TERM: { SEE_ALSO: { to: 'TERM' } },
  COLLECTION: {},
  TECHNIQUE: {},
}

/** Видоспецифичные текстовые поля (attrs jsonb). */
export const KIND_ATTRS: Record<KnowledgeKind, readonly string[]> = {
  PERSON: ['birthText', 'deathText', 'country'],
  ARTWORK: ['workKind', 'dateText', 'dimensions', 'inventoryNo', 'location'],
  COLLECTION: ['city', 'country', 'url', 'creditLineTemplate'],
  MOVEMENT: [],
  PERIOD: [],
  TECHNIQUE: [],
  TERM: ['forms'],
}

export const WORK_KINDS = [
  { value: 'PAINTING', label: 'Живопись' },
  { value: 'GRAPHICS', label: 'Графика' },
  { value: 'SCULPTURE', label: 'Скульптура' },
  { value: 'ARCHITECTURE', label: 'Архитектура' },
  { value: 'DECORATIVE', label: 'ДПИ' },
  { value: 'PHOTO', label: 'Фотография' },
  { value: 'OTHER', label: 'Другое' },
]

export const SLUG_RE = /^[\p{L}\p{N}](?:[\p{L}\p{N}_-]{0,78}[\p{L}\p{N}])?$/u
/** Символы, запрещенные в названии и подписи якоря (BR-050, защита разметки). */
export const FORBIDDEN_LABEL_CHARS = /[[\]<>\n\r]/

/** Slug из названия: нижний регистр, пробелы и пунктуация → «-». */
export function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .normalize('NFC')
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '')
  return s
}

export function validateSlug(slug: string): FieldError | null {
  return SLUG_RE.test(slug)
    ? null
    : {
        field: 'slug',
        message: 'Slug: буквы, цифры, «-» и «_», до 80 символов; начинается и заканчивается буквой или цифрой',
      }
}

/** Проверка связей записи (AC-KB-001.4): вид цели, кратность, архив, ссылка на себя. */
export function validateLinks(
  kind: KnowledgeKind,
  selfId: string | null,
  links: Partial<Record<LinkRelation, string[]>>,
  targets: Map<string, { kind: KnowledgeKind; status: 'ACTIVE' | 'ARCHIVED'; name: string }>,
  previous: Set<string> = new Set(),
): FieldError[] {
  const errors: FieldError[] = []
  for (const [rel, ids] of Object.entries(links) as [LinkRelation, string[]][]) {
    if (!ids?.length) continue
    const rule = LINK_RULES[kind][rel]
    const field = `links.${rel}`
    if (!rule) {
      errors.push({ field, message: 'Недопустимая связь для этого вида' })
      continue
    }
    if (rule.single && ids.length > 1) errors.push({ field, message: 'Допускается только один объект' })
    for (const id of ids) {
      if (selfId && id === selfId) {
        errors.push({ field, message: 'Объект не может ссылаться на себя' })
        continue
      }
      const t = targets.get(id)
      if (!t) errors.push({ field, message: 'Объект не найден' })
      else if (t.kind !== rule.to)
        errors.push({ field, message: `«${t.name}»: нужен объект вида «${KIND_LABEL[rule.to]}»` })
      else if (t.status === 'ARCHIVED' && !previous.has(`${rel}:${id}`))
        errors.push({ field, message: `«${t.name}» в архиве (BR-049)` })
    }
  }
  return errors
}

export function assertYears(from: number | null, to: number | null): void {
  const bad = (y: number | null) => y !== null && (!Number.isInteger(y) || y < -5000 || y > 2100)
  const errors: FieldError[] = []
  if (bad(from)) errors.push({ field: 'yearFrom', message: 'Год от −5000 до 2100' })
  if (bad(to)) errors.push({ field: 'yearTo', message: 'Год от −5000 до 2100' })
  if (!errors.length && from !== null && to !== null && from > to)
    errors.push({ field: 'yearTo', message: 'Год окончания раньше начала' })
  if (errors.length) throw DomainError.validation(errors)
}
