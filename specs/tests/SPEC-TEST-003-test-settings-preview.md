# SPEC-TEST-003: Настройки и предпросмотр теста

| Поле | Значение |
|---|---|
| Блок | BL-08 |
| Requirements | FR-TEST-005, FR-TEST-008 |
| Scenarios | SC-TEST-004, SC-TEST-006 |
| Business rules | BR-007 |
| Domain entities | TestVersion, Section, SelectionRule |
| Permissions | `test.update`, `test.read` |
| Статус | Ready |

## Purpose
Определить, как тест будет проходиться (время, навигация, попытки, обратная связь, оценивание), и дать возможность увидеть результат.

## Actors
Автор; reviewer (preview).

## Preconditions
Settings — DRAFT; preview — любое состояние с `test.read`.

## Input
Настройки assessment-model §2. Валидация: timeLimitSec ∈ [60, 6·3600] или null; секционные лимиты ≤ общего; maxAttempts ∈ [1, 20] или null; passingScore ≤ maxScore.

## Business rules
BR-007 — настройки являются содержимым версии и замораживаются при submit.

## Main scenario
1. Автор редактирует настройки; сервер валидирует и сохраняет.
2. Preview: сервер строит «виртуальную попытку» по seed: порядок разделов/вопросов/вариантов, выборка из пула (для DRAFT — текущий пул, для APPROVED+ — замороженный). Ничего не сохраняется.

## Alternative scenarios
* A1 passingScore > maxScore → ошибка.

## Data changes
TestVersion.settings, AuditLog; preview — нет.

## Authorization
`test.update` OWN/ANY + DRAFT; `test.read` для preview.

## UI behavior (AdminJS)
Вкладка «Настройки» в конструкторе; action «Предпросмотр теста» с полем seed.

## Acceptance criteria
| ID | Критерий | Тип |
|---|---|---|
| AC-TEST-003.1 | Настройки сохраняются в DRAFT и неизменны после submit | positive/negative |
| AC-TEST-003.2 | Невалидные значения отклоняются | negative |
| AC-TEST-003.3 | Preview с одинаковым seed дает одинаковую выборку и порядок | positive |
| AC-TEST-003.4 | Preview APPROVED версии использует замороженный пул | positive |
