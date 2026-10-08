# SPEC-TEST-002: Структура теста: разделы, фиксированные вопросы, случайный отбор

| Поле | Значение |
|---|---|
| Блок | BL-08 |
| Requirements | FR-TEST-002, FR-TEST-003, FR-TEST-004 |
| Scenarios | SC-TEST-002, SC-TEST-003 |
| Business rules | BR-004, BR-007, BR-010, BR-011, BR-012, BR-039 |
| Domain entities | TestVersion, Section, TestSectionItem, SelectionRule, ItemVersion |
| Permissions | `test.update`, `test.random_selection`, `item.read` |
| ADR | ADR-002 |
| Статус | Draft |

## Purpose
Собрать тест из конкретных версий вопросов и (для преподавателей) правил случайного отбора.

## Actors
Автор теста (Student — только фиксированные вопросы), Teacher, Admin.

## Preconditions
TestVersion в DRAFT; actor — owner (или Admin).

## Input
| Операция | Поля | Валидация |
|---|---|---|
| Section add/update/reorder/remove | title, instructions, timeLimitSec?, shuffleItems?, ordinal | title 1–200 |
| Fixed item add | sectionId, itemVersionId, points, ordinal | см. правила ниже |
| Fixed item update/reorder/remove | points, ordinal | points > 0 |
| Rule add/update/remove | sectionId, filter, count, pointsPerItem | count ≥ 1; filter в пределах курса |

Правила добавления фиксированного вопроса:
* ItemVersion в scope `item.read` actor;
* версия: APPROVED (любого автора) **или** DRAFT/собственная автора теста (будет отправлена каскадом, versioning-model §6);
* Item ACTIVE (BR-039), один Item — не более одного раза в версии теста;
* для теста задания: Item того же курса; для студента — только собственные Item.

## Business rules
BR-010 (pinning), BR-011 (утверждение только с APPROVED), BR-012 (пул), BR-007 (только DRAFT), BR-039.

## Main scenario
1. Конструктор отображает разделы с вопросами и правилами.
2. Добавление фиксированного: из банка (SPEC-ITEM-005, режим выбора) или «Создать вопрос» (SPEC-ITEM-001) → TestSectionItem(itemVersionId, points = defaultPoints).
3. Правило: filter → сервер возвращает текущий размер пула (APPROVED, активные, в курсе, исключая фиксированные Item этой версии) → сохранение.
4. Пересчет maxScore; revision++; аудит.

## Alternative scenarios
* A1 Повтор Item → отказ.
* A2 Чужая неутвержденная версия → отказ (BR-011).
* A3 Студент добавляет правило → отказ (нет `test.random_selection`).
* A4 Пул < count → сохраняется с WARNING; блокирует submit (SPEC-TEST-004) и approve.
* A5 Если позже утверждена новая версия pinned Item — UI показывает бейдж «доступна версия N» с действием «обновить» (только DRAFT теста).

## Data changes
Section, TestSectionItem, SelectionRule, TestVersion.revision, AuditLog.

## Authorization
`test.update` OWN/ANY, state guard DRAFT; `test.random_selection` для правил; `item.read` на добавляемую версию.

## UI behavior (AdminJS)
Кастомная страница-конструктор: список разделов (drag-and-drop), вопросы с баллами, правила с индикатором размера пула, сумма баллов.

## Acceptance criteria
| ID | Критерий | Тип |
|---|---|---|
| AC-TEST-002.1 | Добавленный вопрос хранится как ссылка на конкретную ItemVersion | positive |
| AC-TEST-002.2 | Один Item нельзя добавить дважды | negative |
| AC-TEST-002.3 | Студент не может добавить чужой вопрос (любого состояния) | permission |
| AC-TEST-002.4 | Студент не может создать SelectionRule | permission |
| AC-TEST-002.5 | Размер пула считается только по APPROVED активным вопросам курса | positive |
| AC-TEST-002.6 | Структуру не-DRAFT версии изменить нельзя | negative |
| AC-TEST-002.7 | Архивированный Item нельзя добавить | negative |
