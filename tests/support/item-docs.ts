import type { ItemDocument } from '../../src/domain/itembank/interaction.js'

/** Эталонный корректный документ для каждого MVP-типа. */
export function validDoc(code: string): ItemDocument {
  const opt = (key: string, role: any, text: string, ordinal: number, mediaAssetId: string | null = null) => ({
    key,
    role,
    text,
    mediaAssetId,
    altTextOverride: null,
    ordinal,
  })
  switch (code) {
    case 'single_choice':
      return {
        stem: 'Кто автор «Грачи прилетели»?',
        content: { shuffleOptions: true },
        options: [
          opt('o1', 'OPTION', 'Саврасов', 0),
          opt('o2', 'OPTION', 'Шишкин', 1),
          opt('o3', 'OPTION', 'Левитан', 2),
        ],
        media: [],
        answerKey: { correct: ['o1'] },
      }
    case 'multiple_choice':
      return {
        stem: 'Кто входил в Товарищество передвижников?',
        content: {},
        options: [
          opt('o1', 'OPTION', 'Крамской', 0),
          opt('o2', 'OPTION', 'Перов', 1),
          opt('o3', 'OPTION', 'Брюллов', 2),
        ],
        media: [],
        answerKey: { correct: ['o1', 'o2'] },
      }
    case 'true_false':
      return {
        stem: '«Девятый вал» написан Айвазовским',
        content: {},
        options: [opt('true', 'OPTION', 'Верно', 0), opt('false', 'OPTION', 'Неверно', 1)],
        media: [],
        answerKey: { correct: ['true'] },
      }
    case 'image_choice':
      return {
        stem: 'Выберите работу Куинджи',
        content: {},
        options: [opt('o1', 'OPTION', '', 0, 'm1'), opt('o2', 'OPTION', '', 1, 'm2')],
        media: [],
        answerKey: { correct: ['o2'] },
      }
    case 'attribution':
      return {
        stem: 'Кто автор произведения?',
        content: {},
        options: [opt('o1', 'OPTION', 'Левитан', 0), opt('o2', 'OPTION', 'Поленов', 1)],
        media: [{ mediaAssetId: 'm1', role: 'STIMULUS', altTextOverride: null, ordinal: 0 }],
        answerKey: { correct: ['o1'] },
      }
    case 'matching':
      return {
        stem: 'Сопоставьте картину и автора',
        content: { shuffleResponses: true },
        options: [
          opt('p1', 'PREMISE', 'Утро в сосновом лесу', 0),
          opt('p2', 'PREMISE', 'Березовая роща', 1),
          opt('r1', 'RESPONSE', 'Шишкин', 0),
          opt('r2', 'RESPONSE', 'Куинджи', 1),
          opt('r3', 'RESPONSE', 'Репин', 2),
        ],
        media: [],
        answerKey: {
          pairs: [
            ['p1', 'r1'],
            ['p2', 'r2'],
          ],
        },
      }
    case 'chronology':
      return {
        stem: 'Расположите по времени создания',
        content: {},
        options: [
          opt('e1', 'SEQUENCE_ELEMENT', 'Явление Христа народу', 0),
          opt('e2', 'SEQUENCE_ELEMENT', 'Бурлаки на Волге', 1),
          opt('e3', 'SEQUENCE_ELEMENT', 'Черный квадрат', 2),
        ],
        media: [],
        answerKey: { order: ['e1', 'e2', 'e3'] },
      }
    case 'short_answer':
      return {
        stem: 'Назовите автора «Троицы»',
        content: {},
        options: [],
        media: [],
        answerKey: { accepted: ['Андрей Рублев', 'Рублев'] },
      }
    case 'essay':
      return {
        stem: 'Сравните пейзажи Шишкина и Левитана',
        content: { rubric: 'Композиция, колорит, настроение', minWords: 100 },
        options: [],
        media: [],
        answerKey: {},
      }
  }
  throw new Error(code)
}

/** Правильный и неправильный ответ для эталона. */
export const RESPONSES: Record<string, { right: Record<string, unknown>; wrong: Record<string, unknown> }> = {
  single_choice: { right: { selected: ['o1'] }, wrong: { selected: ['o2'] } },
  multiple_choice: { right: { selected: ['o1', 'o2'] }, wrong: { selected: ['o3'] } },
  true_false: { right: { selected: ['true'] }, wrong: { selected: ['false'] } },
  image_choice: { right: { selected: ['o2'] }, wrong: { selected: ['o1'] } },
  attribution: { right: { selected: ['o1'] }, wrong: { selected: ['o2'] } },
  matching: {
    right: {
      pairs: [
        ['p1', 'r1'],
        ['p2', 'r2'],
      ],
    },
    wrong: {
      pairs: [
        ['p1', 'r3'],
        ['p2', 'r1'],
      ],
    },
  },
  chronology: { right: { order: ['e1', 'e2', 'e3'] }, wrong: { order: ['e3', 'e1', 'e2'] } },
  short_answer: { right: { text: '  андрей рублёв.' }, wrong: { text: 'Феофан Грек' } },
  essay: { right: { text: 'текст' }, wrong: { text: '' } },
}
