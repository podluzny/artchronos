# SPEC-ITEM-004: Ownership policy и доступ к вопросам

| Поле | Значение |
|---|---|
| Блок | BL-07 |
| Requirements | FR-ITEM-011, FR-PERM-002, FR-PERM-003, NFR-SEC-001 |
| Scenarios | SC-ITEM-005, SC-E2E-001 (шаги 6, 9, 16) |
| Business rules | BR-001, BR-004, BR-006, BR-007 |
| Domain entities | Item, ItemVersion, Assignment, Review, ReviewAssignment, Course |
| Permissions | `item.read`, `item.create`, `item.update`, `item.submit`, `item.archive` |
| ADR | ADR-003 |
| Статус | Ready |

## Purpose
Конкретизировать SPEC-AUTH-003 для вопросов: кто какие вопросы видит и меняет.

## Actors
Все роли.

## Preconditions
—

## Input
—

## Business rules
BR-004 (студент — только свои DRAFT), BR-006/BR-007 (state guards), BR-001 (решения — не автор).

## Main scenario
Scope-правила для `item.read`:

| Scope | Условие SQL-уровня |
|---|---|
| OWN | `item.ownerId = actor` OR actor ∈ authorIds любой версии |
| ASSIGNED | `item.assignmentId` ∈ задания, где actor — owner/defaultReviewer; OR ItemVersion входит в Review (как subject или в пакет TestVersion) с активным ReviewAssignment actor |
| COURSE | `item.courseId` ∈ курсы, где actor — преподаватель; для чужих Item — только версии в состоянии APPROVED (банк), а также любые версии Item заданий курса |
| ANY | без ограничений |

«Private draft» студента: DRAFT-версии Item студента видны только самому студенту, преподавателям задания (ASSIGNED/COURSE) и Admin. Другие студенты не видят ни DRAFT, ни других состояний чужих вопросов.

## Alternative scenarios
—

## Data changes
—

## Authorization
См. матрицу permission-model §4.4.

## UI behavior (AdminJS)
Список «Вопросы» фильтруется сервером; у студента дополнительно скрыт фильтр «Автор».

## Acceptance criteria
| ID | Критерий | Тип |
|---|---|---|
| AC-ITEM-004.1 | Студент A не видит в списке и не открывает по id вопросы студента B (любое состояние) | permission |
| AC-ITEM-004.2 | Teacher видит DRAFT студентов своего задания и не видит DRAFT в чужих курсах | permission |
| AC-ITEM-004.3 | Expert видит только вопросы назначенных ему review | permission |
| AC-ITEM-004.4 | Teacher курса видит APPROVED вопросы банка курса других авторов | positive |
| AC-ITEM-004.5 | Студент не может approve вопрос (нет `review.perform`) | permission |
| AC-ITEM-004.6 | count() списка соответствует видимым записям | permission |
