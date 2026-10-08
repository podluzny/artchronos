# SPEC-ASSIGN-002: Жизненный цикл задания, дедлайн, прогресс

| Поле | Значение |
|---|---|
| Блок | BL-04 |
| Requirements | FR-ASSIGN-004, FR-ASSIGN-005, FR-ASSIGN-007, FR-ASSIGN-008 |
| Scenarios | SC-ASSIGN-002, SC-ASSIGN-003, SC-TEST-001 |
| Business rules | BR-017, BR-031, BR-035 |
| Domain entities | Assignment, DeadlineExtension, Test, TestVersion |
| Permissions | `assignment.update`, `assignment.read` |
| Статус | Draft |

## Purpose
Управлять временными рамками работы студентов и давать преподавателю обзор выполнения.

## Actors
Teacher (owner), Admin, Student (просмотр).

## Preconditions
Задание существует.

## Input
Переходы: activate, close, reopen, archive; продление: student, newDeadlineAt (> deadlineAt), reason.

## Business rules
* BR-017 — создание контента только в ACTIVE задании.
* BR-031 — первая отправка до дедлайна (с учетом продления); доработки — пока не CLOSED.

## Main scenario
1. Activate (DRAFT → ACTIVE): проверка targets ≥ 1, topics ≥ 1, allowedTypes ≥ 1, deadline в будущем.
2. Студент видит «Мои задания»: адресованные ACTIVE (и CLOSED — только чтение), дедлайн (персональный), статус своего теста.
3. Teacher видит сводку: по каждому адресату — тест, номер последней версии, состояние, дата отправки.
4. Extend: DeadlineExtension для студента; аудит.
5. Close (ACTIVE → CLOSED): новые Item/Test в задании и любые submit по заданию невозможны; текущие review продолжаются.
6. Reopen / Archive — см. lifecycle-state-machine §6.

## Alternative scenarios
* A1 Activate с неполными данными → список ошибок.
* A2 Продление раньше общего дедлайна → ошибка.

## Data changes
Assignment.status, DeadlineExtension, AuditLog.

## Authorization
`assignment.update` OWN/COURSE/ANY; `assignment.read` для студента — ASSIGNED.

## UI behavior (AdminJS)
Actions «Активировать», «Закрыть», «Открыть заново», «Продлить срок»; страница сводки (кастомный компонент); у студента — дашборд «Мои задания» (единственный кастомный «дашборд» MVP).

## Acceptance criteria
| ID | Критерий | Тип |
|---|---|---|
| AC-ASSIGN-002.1 | Студент видит только адресованные ему задания (лично или через группу) | permission |
| AC-ASSIGN-002.2 | После CLOSED студент не может создать Item/Test и отправить версию по заданию | negative |
| AC-ASSIGN-002.3 | Первая отправка после дедлайна отклоняется; с продлением — принимается | negative/positive |
| AC-ASSIGN-002.4 | Повторная отправка после CHANGES_REQUESTED после дедлайна, при ACTIVE задании, принимается | positive |
| AC-ASSIGN-002.5 | Активация без адресатов отклоняется | negative |
| AC-ASSIGN-002.6 | Сводка показывает состояние последней версии теста каждого адресата | positive |
