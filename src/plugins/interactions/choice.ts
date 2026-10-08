import type { InteractionPlugin, ItemDocument } from '../../domain/itembank/interaction.js'
import {
  byRole,
  err,
  keyArraySchema,
  optionContentIssues,
  round,
  stemIssues,
  stimulusIssues,
  stringArray,
  warn,
} from './common.js'

interface ChoiceConfig {
  cardinality: 'single' | 'multiple'
  minOptions: number
  maxOptions: number
  optionMedia: 'none' | 'optional' | 'required'
  stimulus: 'none' | 'optional' | 'required'
  fixedOptions?: { key: string; text: string }[]
}

const cfg = (c: Record<string, unknown>) => c as unknown as ChoiceConfig

function scoreSets(doc: ItemDocument, response: Record<string, unknown>) {
  const correct = new Set(stringArray(doc.answerKey.correct))
  const selected = new Set(stringArray(response.selected))
  let hit = 0
  let wrong = 0
  for (const s of selected) {
    if (correct.has(s)) hit++
    else wrong++
  }
  return { correct, selected, hit, wrong }
}

/** Выбор одного или нескольких вариантов (текст/изображение). */
export const choicePlugin: InteractionPlugin = {
  key: 'choice',
  version: '1.0.0',
  title: 'Выбор вариантов',
  description: 'Один или несколько верных вариантов; варианты — текст и/или изображение; опциональный стимул.',
  configSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['cardinality', 'minOptions', 'maxOptions', 'optionMedia', 'stimulus'],
    properties: {
      cardinality: { enum: ['single', 'multiple'] },
      minOptions: { type: 'integer', minimum: 2, maximum: 20 },
      maxOptions: { type: 'integer', minimum: 2, maximum: 20 },
      optionMedia: { enum: ['none', 'optional', 'required'] },
      stimulus: { enum: ['none', 'optional', 'required'] },
      fixedOptions: {
        type: 'array',
        items: {
          type: 'object',
          required: ['key', 'text'],
          properties: { key: { type: 'string' }, text: { type: 'string' } },
          additionalProperties: false,
        },
      },
    },
  },
  defaultConfig: { cardinality: 'single', minOptions: 2, maxOptions: 8, optionMedia: 'optional', stimulus: 'optional' },
  optionRoles: ['OPTION'],
  buildContentSchema: () => ({
    type: 'object',
    additionalProperties: false,
    properties: { shuffleOptions: { type: 'boolean' } },
  }),
  responseSchema: () => ({
    type: 'object',
    required: ['selected'],
    additionalProperties: false,
    properties: { selected: keyArraySchema },
  }),
  answerKeySchema: () => ({ type: 'object', additionalProperties: false, properties: { correct: keyArraySchema } }),
  validate(doc, config) {
    const c = cfg(config)
    const opts = byRole(doc, 'OPTION')
    const issues = [...stemIssues(doc), ...stimulusIssues(doc, c.stimulus)]
    if (doc.options.some((o) => o.role !== 'OPTION')) issues.push(err('options', 'ROLE', 'Недопустимая роль варианта'))
    if (c.fixedOptions) {
      const fixed = c.fixedOptions
        .map((f) => f.key)
        .sort()
        .join(',')
      if (
        opts
          .map((o) => o.key)
          .sort()
          .join(',') !== fixed
      )
        issues.push(err('options', 'FIXED_OPTIONS', 'Варианты этого типа фиксированы'))
    } else {
      if (opts.length < c.minOptions)
        issues.push(err('options', 'MIN_OPTIONS', `Нужно не менее ${c.minOptions} вариантов`))
      if (opts.length > c.maxOptions)
        issues.push(err('options', 'MAX_OPTIONS', `Допускается не более ${c.maxOptions} вариантов`))
      issues.push(...optionContentIssues(opts, c.optionMedia, 'Вариант'))
    }
    const keys = new Set(opts.map((o) => o.key))
    const correct = stringArray(doc.answerKey.correct)
    if (correct.some((k) => !keys.has(k)))
      issues.push(err('answerKey', 'KEY_UNKNOWN', 'Ключ ссылается на несуществующий вариант'))
    if (correct.length === 0) issues.push(err('answerKey', 'NO_CORRECT', 'Отметьте верный вариант'))
    if (c.cardinality === 'single' && correct.length > 1)
      issues.push(err('answerKey', 'SINGLE', 'В этом типе верен ровно один вариант'))
    if (c.cardinality === 'multiple' && correct.length === opts.length && opts.length > 0) {
      issues.push(warn('answerKey', 'ALL_CORRECT', 'Все варианты отмечены верными — нет дистракторов'))
    }
    return issues
  },
  evaluators: {
    exact: {
      label: 'Полное совпадение',
      paramsSchema: { type: 'object', additionalProperties: false },
      evaluate(doc, response) {
        const { correct, selected, hit, wrong } = scoreSets(doc, response)
        const ok = wrong === 0 && hit === correct.size && selected.size === correct.size
        return { score: ok ? 1 : 0, maxScore: 1, details: { hit, wrong } }
      },
    },
    all_or_nothing: {
      label: 'Все или ничего',
      paramsSchema: { type: 'object', additionalProperties: false },
      evaluate(doc, response) {
        const { correct, hit, wrong } = scoreSets(doc, response)
        return { score: wrong === 0 && hit === correct.size ? 1 : 0, maxScore: 1, details: { hit, wrong } }
      },
    },
    partial_credit: {
      label: 'Частичный балл',
      paramsSchema: { type: 'object', additionalProperties: false },
      evaluate(doc, response) {
        const { correct, hit, wrong } = scoreSets(doc, response)
        const score = correct.size ? Math.max(0, (hit - wrong) / correct.size) : 0
        return { score: round(score), maxScore: 1, details: { hit, wrong } }
      },
    },
  },
  emptyDocument(config) {
    const c = cfg(config)
    const options = c.fixedOptions
      ? c.fixedOptions.map((f, i) => ({
          key: f.key,
          role: 'OPTION' as const,
          text: f.text,
          mediaAssetId: null,
          altTextOverride: null,
          ordinal: i,
        }))
      : Array.from({ length: Math.max(c.minOptions, 3) }, (_, i) => ({
          key: `o${i + 1}`,
          role: 'OPTION' as const,
          text: '',
          mediaAssetId: null,
          altTextOverride: null,
          ordinal: i,
        }))
    return { stem: '', content: { shuffleOptions: !c.fixedOptions }, options, media: [], answerKey: { correct: [] } }
  },
}
