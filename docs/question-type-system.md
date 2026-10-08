# Question Type System

| Поле | Значение |
|---|---|
| Задача | T-010 |
| Статус | Baseline — утверждено в T-030 (2026-10-08) |
| Связанные | ADR-001, ADR-005, SPEC-QTYPE-001, SPEC-QTYPE-002 |

## 1. Два уровня расширяемости

| Уровень | Что это | Как добавляется | Пример |
|---|---|---|---|
| **Interaction plugin** | Код: модель взаимодействия, редактор, preview, валидация, evaluator | Разработка + деплой (ADR-001) | `choice`, `match`, `order`, `text_entry` |
| **Configurable QuestionType** | Запись реестра: interaction + конфигурация + schema-ограничения + метод оценивания | Через AdminJS (Admin, `qtype.manage`) | `image_choice` = `choice` с вариантами-изображениями |

Тип вопроса определяет (INV-015):

* **schema** — `contentSchema` (JSON Schema, draft 2020-12) содержимого ItemVersion;
* **interaction** — `interactionKey` плагина и `interactionConfig`;
* **response format** — `responseSchema` (структура `Response.payload`);
* **evaluation method** — `evaluation.method` + параметры.

## 2. Interaction plugins MVP

| interactionKey | Модель | Роли ItemOption | Response payload | Evaluators |
|---|---|---|---|---|
| `choice` | Выбор одного/нескольких вариантов (текст и/или изображение) | `OPTION` | `{ selected: [optionKey] }` | `exact`, `partial_credit`, `all_or_nothing` |
| `match` | Сопоставление premise ↔ response | `PREMISE`, `RESPONSE` | `{ pairs: [[premiseKey, responseKey]] }` | `per_pair`, `all_or_nothing` |
| `order` | Упорядочивание элементов (хронология) | `SEQUENCE_ELEMENT` | `{ order: [key] }` | `exact_sequence`, `per_position`, `adjacent_pairs` |
| `text_entry` | Короткий ответ | — | `{ text: string }` | `normalized_match` (регистр, пробелы, ё/е, список допустимых ответов) |
| `extended_text` | Развернутый ответ | — | `{ text: string }` | `manual` (оценка экспертом в будущем Runner) |

## 3. QuestionType MVP (seed)

| code | Название | interaction | Конфигурация | Evaluation по умолчанию |
|---|---|---|---|---|
| `single_choice` | Один из нескольких | choice | cardinality=single, optionMedia=optional, 2–8 вариантов, ровно 1 верный | exact |
| `multiple_choice` | Несколько из нескольких | choice | cardinality=multiple, 2–10 вариантов, ≥1 верный | partial_credit |
| `true_false` | Верно / неверно | choice | cardinality=single, фиксированные 2 варианта | exact |
| `image_choice` | Выбор изображения | choice | cardinality=single, optionMedia=required (IMAGE), 2–8 | exact |
| `attribution` | Атрибуция произведения | choice | stimulus IMAGE обязателен, cardinality=single | exact |
| `matching` | Сопоставление (произведение ↔ автор/стиль) | match | 2–8 пар, distractor responses допускаются | per_pair |
| `chronology` | Хронологический порядок | order | 3–8 элементов, медиа опционально | per_position |
| `short_answer` | Краткий ответ | text_entry | 1–10 допустимых ответов | normalized_match |
| `essay` | Развернутый ответ | extended_text | рекомендуемый объем, критерии оценивания (rubric) | manual |

Assignment ограничивает доступные студентам типы (`allowedQuestionTypeIds`, BR-018).

## 4. Что можно конфигурировать через AdminJS

Можно (создается новая `QuestionTypeVersion`, BR-022):

* название, описание, иконка, подсказки для автора;
* параметры `interactionConfig` в пределах, которые объявил плагин (`configSchema` плагина): cardinality, min/max вариантов, обязательность медиа, тип медиа, обязательный stimulus, допускаются ли дистракторы;
* дополнительные **ограничения** содержимого (сужение схемы: обязательные поля, длины);
* метод оценивания — из списка evaluators плагина, и его параметры;
* активация/деактивация (BR-021).

Нельзя (требует нового interaction plugin):

* новая модель взаимодействия (например, hotspot — клик по области изображения, drag-and-drop на изображение, сравнение двух изображений «слайдером», аудио-ответ);
* новый формат ответа или новый алгоритм оценивания;
* исполняемый код, формулы, скрипты (BR-023).

## 5. Версионирование типов

* Тип имеет `currentVersionId`; новые Item создаются с текущей версией.
* `ItemVersion.questionTypeVersionId` фиксируется при создании версии. Новая ItemVersion (копия) получает **текущую** версию типа; если копия не валидна по новой схеме, автор видит ошибки валидации в черновике (submit заблокирован до исправления, BR-020).
* Плагин обязан поддерживать все `configSchema`-версии, на которые ссылаются существующие `QuestionTypeVersion` (или предоставлять миграцию конфигурации) — проверяется contract-тестами (NFR-EXT-002).

## 6. Хранение (кратко, детали — ADR-005)

* Реляционно: `ItemVersion` общие поля, `ItemOption` (стабильные key, ссылки на медиа), `ItemMedia`, связи с темами/тегами.
* JSONB `content`: специфичные для interaction поля (например, `shuffle`, `rubric`, `acceptedAnswers`).
* JSONB `answerKey`: отдельно от `content` (NFR-SEC-008).

Пример `single_choice`:

```json
{
  "stem": "Кто автор картины «Девятый вал»?",
  "options": [
    { "key": "o1", "role": "OPTION", "text": "И. К. Айвазовский" },
    { "key": "o2", "role": "OPTION", "text": "И. И. Шишкин" },
    { "key": "o3", "role": "OPTION", "text": "А. И. Куинджи" }
  ],
  "content": { "shuffleOptions": true },
  "answerKey": { "correct": ["o1"] }
}
```
