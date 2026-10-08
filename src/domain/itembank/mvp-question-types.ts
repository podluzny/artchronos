/** MVP-набор типов вопросов (docs/question-type-system.md §3): interaction + конфигурация + оценивание. */
export interface QuestionTypeSeed {
  code: string
  name: string
  description: string
  interactionKey: string
  config: Record<string, unknown>
  evaluation: { method: string; params?: Record<string, unknown> }
}

export const MVP_QUESTION_TYPES: QuestionTypeSeed[] = [
  {
    code: 'single_choice',
    name: 'Один из нескольких',
    description: 'Один верный вариант из 2–8.',
    interactionKey: 'choice',
    config: { cardinality: 'single', minOptions: 2, maxOptions: 8, optionMedia: 'optional', stimulus: 'optional' },
    evaluation: { method: 'exact' },
  },
  {
    code: 'multiple_choice',
    name: 'Несколько из нескольких',
    description: 'Один или несколько верных вариантов из 2–10, частичный балл.',
    interactionKey: 'choice',
    config: { cardinality: 'multiple', minOptions: 2, maxOptions: 10, optionMedia: 'optional', stimulus: 'optional' },
    evaluation: { method: 'partial_credit' },
  },
  {
    code: 'true_false',
    name: 'Верно / неверно',
    description: 'Утверждение и два фиксированных варианта.',
    interactionKey: 'choice',
    config: {
      cardinality: 'single',
      minOptions: 2,
      maxOptions: 2,
      optionMedia: 'none',
      stimulus: 'optional',
      fixedOptions: [
        { key: 'true', text: 'Верно' },
        { key: 'false', text: 'Неверно' },
      ],
    },
    evaluation: { method: 'exact' },
  },
  {
    code: 'image_choice',
    name: 'Выбор изображения',
    description: 'Варианты ответа — изображения.',
    interactionKey: 'choice',
    config: { cardinality: 'single', minOptions: 2, maxOptions: 8, optionMedia: 'required', stimulus: 'none' },
    evaluation: { method: 'exact' },
  },
  {
    code: 'attribution',
    name: 'Атрибуция произведения',
    description: 'По изображению произведения выбрать автора, школу или датировку.',
    interactionKey: 'choice',
    config: { cardinality: 'single', minOptions: 2, maxOptions: 6, optionMedia: 'none', stimulus: 'required' },
    evaluation: { method: 'exact' },
  },
  {
    code: 'matching',
    name: 'Сопоставление',
    description: 'Произведение ↔ автор / стиль; допускаются лишние соответствия.',
    interactionKey: 'match',
    config: { minPairs: 2, maxPairs: 8, allowDistractors: true, optionMedia: 'optional' },
    evaluation: { method: 'per_pair' },
  },
  {
    code: 'chronology',
    name: 'Хронологический порядок',
    description: 'Расположить произведения или события по времени.',
    interactionKey: 'order',
    config: { minElements: 3, maxElements: 8, optionMedia: 'optional' },
    evaluation: { method: 'per_position' },
  },
  {
    code: 'short_answer',
    name: 'Краткий ответ',
    description: 'Ответ строкой; список допустимых вариантов.',
    interactionKey: 'text_entry',
    config: { maxAnswers: 10, maxLength: 200 },
    evaluation: { method: 'normalized_match' },
  },
  {
    code: 'essay',
    name: 'Развернутый ответ',
    description: 'Свободный текст; ручная оценка по критериям.',
    interactionKey: 'extended_text',
    config: { recommendedWords: 200 },
    evaluation: { method: 'manual' },
  },
]
