/**
 * Контракт interaction plugin (SPEC-QTYPE-002, ADR-001). Плагины — код; через UI выбирается только
 * зарегистрированный interactionKey и задается конфигурация в пределах configSchema (BR-023).
 */
export type OptionRole = 'OPTION' | 'PREMISE' | 'RESPONSE' | 'SEQUENCE_ELEMENT'

export interface ItemOptionDoc {
  key: string
  role: OptionRole
  text: string | null
  mediaAssetId: string | null
  altTextOverride: string | null
  ordinal: number
}

export interface ItemMediaDoc {
  mediaAssetId: string
  role: 'STIMULUS' | 'ILLUSTRATION'
  altTextOverride: string | null
  ordinal: number
}

/** Содержимое версии вопроса в форме, общей для всех типов (ADR-005). */
export interface ItemDocument {
  stem: string
  content: Record<string, unknown>
  options: ItemOptionDoc[]
  media: ItemMediaDoc[]
  answerKey: Record<string, unknown>
}

export interface Issue {
  path: string
  code: string
  severity: 'ERROR' | 'WARNING'
  message: string
}

export interface EvaluationResult {
  /** null — требуется ручная оценка (MANUAL). */
  score: number | null
  maxScore: number
  details: Record<string, unknown>
}

export interface Evaluator {
  label: string
  paramsSchema: Record<string, unknown>
  evaluate(doc: ItemDocument, response: Record<string, unknown>, params: Record<string, unknown>): EvaluationResult
}

export type JsonSchema = Record<string, unknown>

export interface InteractionPlugin {
  key: string
  version: string
  title: string
  description: string
  configSchema: JsonSchema
  defaultConfig: Record<string, unknown>
  optionRoles: OptionRole[]
  buildContentSchema(config: Record<string, unknown>): JsonSchema
  responseSchema(config: Record<string, unknown>): JsonSchema
  answerKeySchema(config: Record<string, unknown>): JsonSchema
  /** Семантическая валидация документа для данной конфигурации типа. */
  validate(doc: ItemDocument, config: Record<string, unknown>): Issue[]
  evaluators: Record<string, Evaluator>
  /** Пустой документ для нового вопроса. */
  emptyDocument(config: Record<string, unknown>): ItemDocument
}

export interface InteractionRegistry {
  get(key: string): InteractionPlugin | undefined
  keys(): string[]
}

export function createRegistry(plugins: InteractionPlugin[]): InteractionRegistry {
  const map = new Map<string, InteractionPlugin>()
  for (const p of plugins) {
    if (map.has(p.key)) throw new Error(`Дублирующийся interactionKey: ${p.key}`)
    map.set(p.key, p)
  }
  return { get: (k) => map.get(k), keys: () => [...map.keys()].sort() }
}

/** Детерминированное перемешивание по seed (preview, будущий Runner). */
export function seededShuffle<T>(items: T[], seed: number): T[] {
  const a = [...items]
  let s = seed >>> 0 || 1
  for (let i = a.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    const j = s % (i + 1)
    ;[a[i], a[j]] = [a[j]!, a[i]!]
  }
  return a
}

/** Каноническое JSON-представление (стабильный порядок ключей) для contentHash и diff. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`
  if (v && typeof v === 'object') {
    return `{${Object.keys(v as object)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((v as Record<string, unknown>)[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(v ?? null)
}
