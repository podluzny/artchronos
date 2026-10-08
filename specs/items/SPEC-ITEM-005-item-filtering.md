# SPEC-ITEM-005: Банк вопросов: список, фильтрация, drawer

| Поле | Значение |
|---|---|
| Блок | BL-07 |
| Requirements | FR-ITEM-007, FR-PERM-003, NFR-PERF-001, NFR-PERF-003 |
| Scenarios | SC-ITEM-005, SC-TEST-002 |
| Business rules | BR-039 |
| Domain entities | Item, ItemVersion, Topic, LearningObjective, Tag, QuestionType |
| Permissions | `item.read` |
| Статус | Draft |

## Purpose
Быстро находить вопросы для проверки и для включения в тесты.

## Actors
Все с `item.read`.

## Preconditions
—

## Input
| Фильтр | Тип |
|---|---|
| text | поиск по stem (полнотекстовый, русская морфология) |
| questionType | multi |
| topic (с подтемами), learningObjective, tag | multi |
| difficulty | диапазон |
| state | multi (DRAFT, …, APPROVED) |
| author, assignment, course | single |
| includeArchived | bool (по умолчанию false) |
| versionMode | `LATEST` (по умолчанию: текущий DRAFT или последняя версия) / `LATEST_APPROVED` (для выбора в тест) |
| sort | updatedAt, difficulty, type |

## Business rules
BR-039 — архивированные скрыты по умолчанию и недоступны в режиме выбора для теста.

## Main scenario
1. Сервер применяет scopeFilter + фильтры; пагинация 25/50/100.
2. Строка: stem (сокращенно), тип, темы, сложность, состояние, автор, версия, превью-иконка медиа.
3. Drawer: preview (SPEC-ITEM-003), метаданные, история версий, «где используется» (тесты).
4. Режим выбора (из конструктора теста): versionMode = LATEST_APPROVED (+ свои DRAFT для автора теста), действие «Добавить в раздел».

## Alternative scenarios
—

## Data changes
—

## Authorization
`item.read` со scope; режим выбора дополнительно проверяется при добавлении (SPEC-TEST-002).

## UI behavior (AdminJS)
Кастомный list-компонент с панелью фильтров и drawer справа.

## Acceptance criteria
| ID | Критерий | Тип |
|---|---|---|
| AC-ITEM-005.1 | Фильтр по теме включает подтемы | positive |
| AC-ITEM-005.2 | Комбинация фильтров возвращает корректное пересечение | positive |
| AC-ITEM-005.3 | Архивированные скрыты по умолчанию | positive |
| AC-ITEM-005.4 | Список на 50 000 вопросов открывается ≤ 1.5 с p95 | performance |
| AC-ITEM-005.5 | Drawer показывает preview и историю версий | UI |
