import type { InteractionPlugin } from '../../domain/itembank/interaction.js'
import { err, stemIssues, stringArray } from './common.js'

/** Нормализация краткого ответа: регистр, пробелы, ё/е, кавычки и концевая пунктуация. */
export function normalizeAnswer(s: string): string {
  return s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[«»"„“”']/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.,;:!?]+$/g, '')
    .trim()
}

/** Краткий ответ со списком допустимых вариантов. */
export const textEntryPlugin: InteractionPlugin = {
  key: 'text_entry',
  version: '1.0.0',
  title: 'Краткий ответ',
  description: 'Ответ вводится строкой и сравнивается со списком допустимых ответов после нормализации.',
  configSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['maxAnswers'],
    properties: {
      maxAnswers: { type: 'integer', minimum: 1, maximum: 30 },
      maxLength: { type: 'integer', minimum: 1, maximum: 500 },
    },
  },
  defaultConfig: { maxAnswers: 10, maxLength: 200 },
  optionRoles: [],
  buildContentSchema: () => ({
    type: 'object',
    additionalProperties: false,
    properties: { placeholder: { type: 'string', maxLength: 100 } },
  }),
  responseSchema: (c) => ({
    type: 'object',
    required: ['text'],
    additionalProperties: false,
    properties: { text: { type: 'string', maxLength: Number(c.maxLength ?? 200) } },
  }),
  answerKeySchema: () => ({
    type: 'object',
    additionalProperties: false,
    properties: { accepted: { type: 'array', items: { type: 'string' } } },
  }),
  validate(doc, config) {
    const issues = [...stemIssues(doc)]
    if (doc.options.length) issues.push(err('options', 'NO_OPTIONS', 'В этом типе нет вариантов ответа'))
    const accepted = stringArray(doc.answerKey.accepted)
      .map((a) => a.trim())
      .filter(Boolean)
    if (!accepted.length) issues.push(err('answerKey', 'NO_ACCEPTED', 'Укажите хотя бы один допустимый ответ'))
    if (accepted.length > Number(config.maxAnswers ?? 10))
      issues.push(err('answerKey', 'TOO_MANY', `Не более ${String(config.maxAnswers)} допустимых ответов`))
    return issues
  },
  evaluators: {
    normalized_match: {
      label: 'Совпадение после нормализации',
      paramsSchema: { type: 'object', additionalProperties: false },
      evaluate(doc, response) {
        const given = normalizeAnswer(String(response.text ?? ''))
        const ok = stringArray(doc.answerKey.accepted).some((a) => normalizeAnswer(a) === given && given !== '')
        return { score: ok ? 1 : 0, maxScore: 1, details: { normalized: given } }
      },
    },
  },
  emptyDocument: () => ({ stem: '', content: {}, options: [], media: [], answerKey: { accepted: [] } }),
}

/** Развернутый ответ: оценивается вручную (будущий Student Runner). */
export const extendedTextPlugin: InteractionPlugin = {
  key: 'extended_text',
  version: '1.0.0',
  title: 'Развернутый ответ',
  description: 'Свободный текст; оценивается экспертом по критериям (rubric).',
  configSchema: {
    type: 'object',
    additionalProperties: false,
    properties: { recommendedWords: { type: 'integer', minimum: 10, maximum: 5000 } },
  },
  defaultConfig: { recommendedWords: 200 },
  optionRoles: [],
  buildContentSchema: () => ({
    type: 'object',
    additionalProperties: false,
    properties: {
      rubric: { type: 'string', maxLength: 5000 },
      minWords: { type: 'integer', minimum: 0 },
      maxWords: { type: 'integer', minimum: 1 },
    },
  }),
  responseSchema: () => ({
    type: 'object',
    required: ['text'],
    additionalProperties: false,
    properties: { text: { type: 'string', maxLength: 50000 } },
  }),
  answerKeySchema: () => ({
    type: 'object',
    additionalProperties: false,
    properties: { modelAnswer: { type: 'string', maxLength: 10000 } },
  }),
  validate(doc) {
    const issues = [...stemIssues(doc)]
    if (doc.options.length) issues.push(err('options', 'NO_OPTIONS', 'В этом типе нет вариантов ответа'))
    if (!String(doc.content.rubric ?? '').trim())
      issues.push(err('content.rubric', 'RUBRIC', 'Опишите критерии оценивания'))
    const min = Number(doc.content.minWords ?? 0)
    const max = doc.content.maxWords === undefined ? undefined : Number(doc.content.maxWords)
    if (max !== undefined && max < min) issues.push(err('content.maxWords', 'WORDS', 'Максимум слов меньше минимума'))
    return issues
  },
  evaluators: {
    manual: {
      label: 'Ручная оценка',
      paramsSchema: { type: 'object', additionalProperties: false },
      evaluate: () => ({ score: null, maxScore: 1, details: { manual: true } }),
    },
  },
  emptyDocument: () => ({ stem: '', content: { rubric: '' }, options: [], media: [], answerKey: {} }),
}
