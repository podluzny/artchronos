/** MVP-набор типов вопросов (docs/question-type-system.md §3). Конфигурация и схемы — M3 (BL-06). */
export const MVP_QUESTION_TYPES = [
  { code: 'single_choice', name: 'Один из нескольких', interactionKey: 'choice' },
  { code: 'multiple_choice', name: 'Несколько из нескольких', interactionKey: 'choice' },
  { code: 'true_false', name: 'Верно / неверно', interactionKey: 'choice' },
  { code: 'image_choice', name: 'Выбор изображения', interactionKey: 'choice' },
  { code: 'attribution', name: 'Атрибуция произведения', interactionKey: 'choice' },
  { code: 'matching', name: 'Сопоставление', interactionKey: 'match' },
  { code: 'chronology', name: 'Хронологический порядок', interactionKey: 'order' },
  { code: 'short_answer', name: 'Краткий ответ', interactionKey: 'text_entry' },
  { code: 'essay', name: 'Развернутый ответ', interactionKey: 'extended_text' },
] as const
