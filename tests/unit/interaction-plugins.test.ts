import { describe, expect, it } from 'vitest'
import { schemaErrors } from '../../src/application/shared/schema.js'
import { buildTypeVersion } from '../../src/application/itembank/qtype-use-cases.js'
import {
  createRegistry,
  seededShuffle,
  type InteractionPlugin,
  type ItemDocument,
} from '../../src/domain/itembank/interaction.js'
import { MVP_QUESTION_TYPES } from '../../src/domain/itembank/mvp-question-types.js'
import { createInteractionRegistry, MVP_PLUGINS } from '../../src/plugins/interactions/index.js'
import { normalizeAnswer } from '../../src/plugins/interactions/text.js'

const registry = createInteractionRegistry()

/** Эталонный корректный документ для каждого MVP-типа. */
function validDoc(code: string): ItemDocument {
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
const RESPONSES: Record<string, { right: Record<string, unknown>; wrong: Record<string, unknown> }> = {
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

describe('AT-QTYPE-002.1 contract suite: каждый MVP-плагин соблюдает контракт', () => {
  for (const p of MVP_PLUGINS) {
    it(`${p.key}: defaultConfig валиден, схемы строятся, emptyDocument структурно корректен`, () => {
      expect(schemaErrors(p.configSchema, p.defaultConfig)).toEqual([])
      const empty = p.emptyDocument(p.defaultConfig)
      expect(schemaErrors(p.buildContentSchema(p.defaultConfig), empty.content)).toEqual([])
      expect(schemaErrors(p.answerKeySchema(p.defaultConfig), empty.answerKey)).toEqual([])
      expect(empty.options.every((o) => p.optionRoles.includes(o.role))).toBe(true)
      // пустой документ не готов к отправке
      expect(p.validate(empty, p.defaultConfig).some((i) => i.severity === 'ERROR')).toBe(true)
      expect(Object.keys(p.evaluators).length).toBeGreaterThan(0)
    })
  }
})

describe('AT-QTYPE-002.4 эталонные вопросы MVP-типов: валидны и оцениваются ожидаемо', () => {
  for (const t of MVP_QUESTION_TYPES) {
    it(t.code, () => {
      const p = registry.get(t.interactionKey)!
      const built = buildTypeVersion(registry, t.interactionKey, t.config, t.evaluation)
      const doc = validDoc(t.code)
      expect(p.validate(doc, built.interactionConfig).filter((i) => i.severity === 'ERROR')).toEqual([])
      expect(schemaErrors(built.contentSchema, doc.content)).toEqual([])
      const { right, wrong } = RESPONSES[t.code]!
      expect(schemaErrors(built.responseSchema, right)).toEqual([])
      const ev = p.evaluators[built.evaluation.method]!
      const r1 = ev.evaluate(doc, right, {})
      const r2 = ev.evaluate(doc, wrong, {})
      if (t.code === 'essay') {
        expect(r1.score).toBeNull()
      } else {
        expect(r1.score).toBe(1)
        expect(r2.score).toBe(0)
      }
    })
  }
  it('частичные баллы: multiple_choice, matching, chronology', () => {
    const mc = registry.get('choice')!.evaluators.partial_credit!
    expect(mc.evaluate(validDoc('multiple_choice'), { selected: ['o1'] }, {}).score).toBe(0.5)
    expect(mc.evaluate(validDoc('multiple_choice'), { selected: ['o1', 'o3'] }, {}).score).toBe(0)
    const mp = registry.get('match')!.evaluators.per_pair!
    expect(
      mp.evaluate(
        validDoc('matching'),
        {
          pairs: [
            ['p1', 'r1'],
            ['p2', 'r3'],
          ],
        },
        {},
      ).score,
    ).toBe(0.5)
    const op = registry.get('order')!.evaluators.per_position!
    expect(op.evaluate(validDoc('chronology'), { order: ['e1', 'e3', 'e2'] }, {}).score).toBeCloseTo(1 / 3, 3)
    const adj = registry.get('order')!.evaluators.adjacent_pairs!
    expect(adj.evaluate(validDoc('chronology'), { order: ['e2', 'e3', 'e1'] }, {}).score).toBe(0.5)
  })
})

describe('Семантическая валидация (BR-020)', () => {
  const choice = registry.get('choice')!
  const single = MVP_QUESTION_TYPES.find((t) => t.code === 'single_choice')!.config
  it('нет верного варианта / несколько верных в single / ключ на несуществующий вариант', () => {
    const d = validDoc('single_choice')
    expect(choice.validate({ ...d, answerKey: { correct: [] } }, single).map((i) => i.code)).toContain('NO_CORRECT')
    expect(choice.validate({ ...d, answerKey: { correct: ['o1', 'o2'] } }, single).map((i) => i.code)).toContain(
      'SINGLE',
    )
    expect(choice.validate({ ...d, answerKey: { correct: ['zz'] } }, single).map((i) => i.code)).toContain(
      'KEY_UNKNOWN',
    )
  })
  it('AT-ITEM-001.2 image_choice требует изображение у каждого варианта', () => {
    const cfg = MVP_QUESTION_TYPES.find((t) => t.code === 'image_choice')!.config
    const d = validDoc('image_choice')
    d.options[0]!.mediaAssetId = null
    expect(choice.validate(d, cfg).map((i) => i.code)).toContain('OPTION_MEDIA_REQUIRED')
  })
  it('attribution требует стимул', () => {
    const cfg = MVP_QUESTION_TYPES.find((t) => t.code === 'attribution')!.config
    expect(choice.validate({ ...validDoc('attribution'), media: [] }, cfg).map((i) => i.code)).toContain(
      'STIMULUS_REQUIRED',
    )
  })
  it('сопоставление: каждый элемент должен иметь пару', () => {
    const cfg = MVP_QUESTION_TYPES.find((t) => t.code === 'matching')!.config
    expect(
      registry
        .get('match')!
        .validate({ ...validDoc('matching'), answerKey: { pairs: [['p1', 'r1']] } }, cfg)
        .map((i) => i.code),
    ).toContain('UNMAPPED')
  })
  it('нормализация краткого ответа', () => {
    expect(normalizeAnswer(' «Андрей  Рублёв». ')).toBe('андрей рублев')
  })
})

describe('Реестр плагинов (ADR-001, BR-023)', () => {
  it('AT-QTYPE-001.2 неизвестный interactionKey отклоняется', () => {
    expect(() => buildTypeVersion(registry, 'hotspot', {}, { method: 'exact' })).toThrow(/BR-023|не зарегистрирован/)
  })
  it('невалидная конфигурация и неизвестный evaluator отклоняются', () => {
    expect(() => buildTypeVersion(registry, 'choice', { cardinality: 'many' }, { method: 'exact' })).toThrow()
    expect(() =>
      buildTypeVersion(registry, 'choice', registry.get('choice')!.defaultConfig, { method: 'magic' }),
    ).toThrow()
  })
  it('дублирующийся ключ плагина — ошибка регистрации', () => {
    expect(() => createRegistry([...MVP_PLUGINS, MVP_PLUGINS[0]!])).toThrow(/Дублирующийся/)
  })
  it('AT-QTYPE-002.2 плагин-фикстура добавляется без изменения ядра', () => {
    const hotspot: InteractionPlugin = {
      ...registry.get('text_entry')!,
      key: 'hotspot_fixture',
      title: 'Фикстура',
    }
    const extended = createInteractionRegistry([hotspot])
    expect(extended.keys()).toContain('hotspot_fixture')
    expect(
      buildTypeVersion(extended, 'hotspot_fixture', { maxAnswers: 1 }, { method: 'normalized_match' }).evaluation
        .method,
    ).toBe('normalized_match')
  })
  it('seededShuffle детерминирован (AC-TEST-003.3)', () => {
    const a = [1, 2, 3, 4, 5, 6]
    expect(seededShuffle(a, 42)).toEqual(seededShuffle(a, 42))
    expect(seededShuffle(a, 42)).not.toEqual(a)
    expect([...seededShuffle(a, 7)].sort()).toEqual(a)
  })
})
