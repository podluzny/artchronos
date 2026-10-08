import type { InteractionPlugin } from '../../domain/itembank/interaction.js'
import { byRole, err, keyArraySchema, optionContentIssues, round, stemIssues, stringArray } from './common.js'

interface OrderConfig {
  minElements: number
  maxElements: number
  optionMedia: 'none' | 'optional' | 'required'
}

/** Упорядочивание (хронология). */
export const orderPlugin: InteractionPlugin = {
  key: 'order',
  version: '1.0.0',
  title: 'Упорядочивание',
  description: 'Расположить элементы в верном порядке (например, по хронологии).',
  configSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['minElements', 'maxElements', 'optionMedia'],
    properties: {
      minElements: { type: 'integer', minimum: 2, maximum: 15 },
      maxElements: { type: 'integer', minimum: 2, maximum: 15 },
      optionMedia: { enum: ['none', 'optional', 'required'] },
    },
  },
  defaultConfig: { minElements: 3, maxElements: 8, optionMedia: 'optional' },
  optionRoles: ['SEQUENCE_ELEMENT'],
  buildContentSchema: () => ({ type: 'object', additionalProperties: false, properties: {} }),
  responseSchema: () => ({
    type: 'object',
    required: ['order'],
    additionalProperties: false,
    properties: { order: keyArraySchema },
  }),
  answerKeySchema: () => ({ type: 'object', additionalProperties: false, properties: { order: keyArraySchema } }),
  validate(doc, config) {
    const c = config as unknown as OrderConfig
    const els = byRole(doc, 'SEQUENCE_ELEMENT')
    const issues = [...stemIssues(doc), ...optionContentIssues(els, c.optionMedia, 'Элемент')]
    if (els.length < c.minElements) issues.push(err('options', 'MIN', `Нужно не менее ${c.minElements} элементов`))
    if (els.length > c.maxElements)
      issues.push(err('options', 'MAX', `Допускается не более ${c.maxElements} элементов`))
    const order = stringArray(doc.answerKey.order)
    const keys = els.map((e) => e.key)
    if (order.length !== keys.length || [...order].sort().join() !== [...keys].sort().join()) {
      issues.push(err('answerKey', 'ORDER', 'Верный порядок должен включать каждый элемент ровно один раз'))
    }
    return issues
  },
  evaluators: {
    exact_sequence: {
      label: 'Точная последовательность',
      paramsSchema: { type: 'object', additionalProperties: false },
      evaluate(doc, response) {
        const key = stringArray(doc.answerKey.order)
        const given = stringArray(response.order)
        return { score: key.length > 0 && key.join() === given.join() ? 1 : 0, maxScore: 1, details: {} }
      },
    },
    per_position: {
      label: 'По позициям',
      paramsSchema: { type: 'object', additionalProperties: false },
      evaluate(doc, response) {
        const key = stringArray(doc.answerKey.order)
        const given = stringArray(response.order)
        const hit = key.filter((k, i) => given[i] === k).length
        return { score: key.length ? round(hit / key.length) : 0, maxScore: 1, details: { hit, total: key.length } }
      },
    },
    adjacent_pairs: {
      label: 'Соседние пары',
      paramsSchema: { type: 'object', additionalProperties: false },
      evaluate(doc, response) {
        const key = stringArray(doc.answerKey.order)
        const given = stringArray(response.order)
        const pairs = new Set(key.slice(1).map((k, i) => `${key[i]}>${k}`))
        const hit = given.slice(1).filter((g, i) => pairs.has(`${given[i]}>${g}`)).length
        return { score: pairs.size ? round(hit / pairs.size) : 0, maxScore: 1, details: { hit, total: pairs.size } }
      },
    },
  },
  emptyDocument(config) {
    const c = config as unknown as OrderConfig
    return {
      stem: '',
      content: {},
      options: Array.from({ length: c.minElements }, (_, i) => ({
        key: `e${i + 1}`,
        role: 'SEQUENCE_ELEMENT' as const,
        text: '',
        mediaAssetId: null,
        altTextOverride: null,
        ordinal: i,
      })),
      media: [],
      answerKey: { order: [] },
    }
  },
}
