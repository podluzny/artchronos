# Assessment Model

| Поле | Значение |
|---|---|
| Задача | T-002, T-009 |
| Статус | Draft — ожидает review (T-030) |
| Связанные | SPEC-TEST-001…004, SPEC-DELIV-001 |

## 1. Структура теста

```
Test (identity: title, owner, assignment?, course)
 └─ TestVersion (state, settings)
     └─ Section[ordinal] (title, instructions, timeLimit?)
         ├─ TestSectionItem[ordinal]  → ItemVersion (fixed, points)
         └─ SelectionRule[ordinal]    → filter, count, pointsPerItem
                                         └─ SelectionPoolEntry → ItemVersion (frozen at approve)
```

## 2. Настройки TestVersion

| Настройка | Значения | По умолчанию | Примечание |
|---|---|---|---|
| `timeLimitSec` | null / > 0 | null | Общий лимит; разделы могут иметь свои |
| `navigation` | `LINEAR`, `FREE` | FREE | LINEAR — без возврата к предыдущим вопросам |
| `maxAttempts` | ≥ 1 / null (без ограничения) | 1 | |
| `shuffleSections` | bool | false | |
| `shuffleItems` | bool | false | В пределах раздела |
| `shuffleOptions` | bool | true | Если тип допускает |
| `feedbackMode` | `NONE`, `AFTER_SUBMIT`, `AFTER_CLOSE` | AFTER_SUBMIT | Показ правильных ответов/feedback |
| `scoring.method` | `SUM` | SUM | Сумма баллов; расширяемо |
| `scoring.passingScore` | null / число ≤ maxScore | null | |

`maxScore` = Σ points фиксированных + Σ(count × pointsPerItem) правил. Вычисляемое.

## 3. Фиксированные и случайные вопросы

| Механизм | Кто может | Источник | Правила |
|---|---|---|---|
| Фиксированный (`TestSectionItem`) | Все авторы тестов | Своя DRAFT/APPROVED ItemVersion или чужая APPROVED в scope чтения | BR-010, BR-011; один и тот же Item не дважды в версии |
| Случайный (`SelectionRule`) | `test.random_selection` (Teacher, Admin) | APPROVED ItemVersion активных Item по фильтру, в курсе теста | BR-012; при approve — заморозка пула, пул ≥ count; фиксированные вопросы исключаются из пула; один Item — в одном пуле не более одной версии (последняя утвержденная на момент заморозки) |

Студенты в MVP строят тесты только из фиксированных вопросов (решение Q-012).

## 4. Assessment и Assignment

Тест студента всегда связан с Assignment (BR-017). При submit проверяется BR-032:

* число вопросов (фиксированные + Σcount) ∈ [minItems, maxItems];
* типы всех вопросов ∈ allowedQuestionTypeIds;
* каждая ItemVersion связана хотя бы с одной темой задания (или ее подтемой).

## 5. Что такое опубликованный assessment

`TestVersion.state = PUBLISHED`. Свойства:

* immutable (включая замороженный пул);
* единственная опубликованная версия теста (BR-009);
* единственный допустимый источник для `Attempt` (BR-037);
* отзыв — `ARCHIVED (WITHDRAWN)`, попытки сохраняются (BR-036).

Кто проходит опубликованный тест и в какие сроки (назначение тестирования группам, окна доступности) — предмет будущего блока Delivery; в MVP не моделируется, кроме `Attempt`.

## 6. Delivery-модель (подготовка, BL-12)

См. SPEC-DELIV-001. Ключевые решения:

* `Attempt.seed` + замороженный пул ⇒ выборка воспроизводима.
* `Attempt.deliveredItems` — снапшот порядка вопросов и вариантов, чтобы последующие изменения настроек отображения не влияли на интерпретацию ответов.
* `Response.payload` валидируется `responseSchema` типа той `QuestionTypeVersion`, на которую ссылается `ItemVersion`.
* `ResponseEvaluation` хранит метод и детализацию; ручная оценка (`essay`) — `MANUAL` с evaluatorId.
* Аналитика по `ItemOption.key` (стабилен между версиями, INV-008) позволяет анализ дистракторов.
