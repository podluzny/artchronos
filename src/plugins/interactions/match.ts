import type { InteractionPlugin } from '../../domain/itembank/interaction.js'
import { byRole, err, optionContentIssues, round, stemIssues } from './common.js'

interface MatchConfig {
  minPairs: number
  maxPairs: number
  allowDistractors: boolean
  optionMedia: 'none' | 'optional' | 'required'
}

const pairsOf = (v: unknown): [string, string][] =>
  Array.isArray(v)
    ? v.filter(
        (p): p is [string, string] => Array.isArray(p) && p.length === 2 && p.every((x) => typeof x === 'string'),
      )
    : []

/** Сопоставление premise ↔ response (произведение ↔ автор/стиль). */
export const matchPlugin: InteractionPlugin = {
  key: 'match',
  version: '1.0.0',
  title: 'Сопоставление',
  description: 'Пары «элемент — соответствие», возможны лишние соответствия (дистракторы).',
  configSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['minPairs', 'maxPairs', 'allowDistractors', 'optionMedia'],
    properties: {
      minPairs: { type: 'integer', minimum: 2, maximum: 15 },
      maxPairs: { type: 'integer', minimum: 2, maximum: 15 },
      allowDistractors: { type: 'boolean' },
      optionMedia: { enum: ['none', 'optional', 'required'] },
    },
  },
  defaultConfig: { minPairs: 2, maxPairs: 8, allowDistractors: true, optionMedia: 'optional' },
  optionRoles: ['PREMISE', 'RESPONSE'],
  buildContentSchema: () => ({
    type: 'object',
    additionalProperties: false,
    properties: { shuffleResponses: { type: 'boolean' } },
  }),
  responseSchema: () => ({
    type: 'object',
    required: ['pairs'],
    additionalProperties: false,
    properties: {
      pairs: { type: 'array', items: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'string' } } },
    },
  }),
  answerKeySchema: () => ({
    type: 'object',
    additionalProperties: false,
    properties: {
      pairs: { type: 'array', items: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'string' } } },
    },
  }),
  validate(doc, config) {
    const c = config as unknown as MatchConfig
    const premises = byRole(doc, 'PREMISE')
    const responses = byRole(doc, 'RESPONSE')
    const issues = [
      ...stemIssues(doc),
      ...optionContentIssues(premises, c.optionMedia, 'Элемент'),
      ...optionContentIssues(responses, 'optional', 'Соответствие'),
    ]
    if (premises.length < c.minPairs) issues.push(err('options', 'MIN_PAIRS', `Нужно не менее ${c.minPairs} пар`))
    if (premises.length > c.maxPairs) issues.push(err('options', 'MAX_PAIRS', `Допускается не более ${c.maxPairs} пар`))
    if (!c.allowDistractors && responses.length !== premises.length)
      issues.push(err('options', 'DISTRACTORS', 'Лишние соответствия в этом типе не допускаются'))
    if (responses.length < premises.length)
      issues.push(err('options', 'RESPONSES', 'Соответствий должно быть не меньше, чем элементов'))
    const pairs = pairsOf(doc.answerKey.pairs)
    const pk = new Set(premises.map((p) => p.key))
    const rk = new Set(responses.map((r) => r.key))
    if (pairs.some(([p, r]) => !pk.has(p) || !rk.has(r)))
      issues.push(err('answerKey', 'KEY_UNKNOWN', 'Ключ ссылается на несуществующий элемент'))
    const mapped = new Set(pairs.map(([p]) => p))
    if (premises.some((p) => !mapped.has(p.key)))
      issues.push(err('answerKey', 'UNMAPPED', 'Укажите соответствие для каждого элемента'))
    if (mapped.size !== pairs.length)
      issues.push(err('answerKey', 'DUP_PREMISE', 'У элемента может быть только одно соответствие'))
    return issues
  },
  evaluators: {
    per_pair: {
      label: 'По каждой паре',
      paramsSchema: { type: 'object', additionalProperties: false },
      evaluate(doc, response) {
        const key = new Map(pairsOf(doc.answerKey.pairs))
        const given = new Map(pairsOf(response.pairs))
        let hit = 0
        for (const [p, r] of key) if (given.get(p) === r) hit++
        return { score: key.size ? round(hit / key.size) : 0, maxScore: 1, details: { hit, total: key.size } }
      },
    },
    all_or_nothing: {
      label: 'Все или ничего',
      paramsSchema: { type: 'object', additionalProperties: false },
      evaluate(doc, response) {
        const key = new Map(pairsOf(doc.answerKey.pairs))
        const given = new Map(pairsOf(response.pairs))
        const ok = key.size > 0 && [...key].every(([p, r]) => given.get(p) === r)
        return { score: ok ? 1 : 0, maxScore: 1, details: {} }
      },
    },
  },
  emptyDocument() {
    const mk = (role: 'PREMISE' | 'RESPONSE', prefix: string, n: number) =>
      Array.from({ length: n }, (_, i) => ({
        key: `${prefix}${i + 1}`,
        role,
        text: '',
        mediaAssetId: null,
        altTextOverride: null,
        ordinal: i,
      }))
    return {
      stem: '',
      content: { shuffleResponses: true },
      options: [...mk('PREMISE', 'p', 3), ...mk('RESPONSE', 'r', 3)],
      media: [],
      answerKey: { pairs: [] },
    }
  },
}
