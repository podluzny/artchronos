# SPEC-TEST-001: Создание теста

| Поле | Значение |
|---|---|
| Блок | BL-08 |
| Requirements | FR-TEST-001 |
| Scenarios | SC-TEST-001, SC-E2E-001 (шаг 7) |
| Business rules | BR-017, BR-033, BR-043 |
| Domain entities | Test, TestVersion, Section, Assignment |
| Permissions | `test.create` |
| ADR | ADR-002 |
| Статус | Ready |

## Purpose
Создать тест как результат учебного задания (студент) или как учебный инструмент (преподаватель).

## Actors
Student (из задания), Teacher (в своем курсе, задание опционально), Admin.

## Preconditions
`test.create`; для студента — ACTIVE задание, адресованное ему; лимит не исчерпан.

## Input
| Поле | Тип | Обязательно | Валидация |
|---|---|---|---|
| assignment | Assignment | Student — да | ACTIVE, адресовано (BR-017) |
| course | Course | да (из задания) | в scope |
| title | string | да | 1–200 |
| description, instructions | rich text | нет | санитизация |

## Business rules
* BR-017 — только в активном адресованном задании.
* BR-033 — не более maxTestsPerStudent не архивированных тестов студента в задании.

## Main scenario
1. «Создать тест» (из карточки задания или ресурса «Тесты»).
2. Ввод названия/описания.
3. Создается Test (ownerId = actor, assignmentId, courseId, status ACTIVE).
4. Создается TestVersion v1 DRAFT (authorIds = [actor]) с одним разделом «Раздел 1» и настройками по умолчанию (assessment-model §2).
5. Test.currentDraftVersionId; аудит.

## Alternative scenarios
* A1 Лимит исчерпан → отказ BR-033.
* A2 Задание не ACTIVE/не адресовано → отказ BR-017.

## Data changes
Test, TestVersion, Section, AuditLog.

## Authorization
`test.create` OWN + BR-017, BR-033 (студент).

## UI behavior (AdminJS)
Action «Создать тест»; после создания — переход в конструктор теста (кастомная страница).

## Acceptance criteria
| ID | Критерий | Тип |
|---|---|---|
| AC-TEST-001.1 | Студент создает тест из задания: Test + v1 DRAFT + раздел по умолчанию | positive |
| AC-TEST-001.2 | Второй тест при maxTestsPerStudent = 1 отклоняется | negative |
| AC-TEST-001.3 | Создание теста в неадресованном/закрытом задании отклоняется | negative |
| AC-TEST-001.4 | Expert не может создать тест | permission |
