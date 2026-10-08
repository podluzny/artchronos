# SPEC-AUDIT-002: История объекта, архивирование и восстановление

| Поле | Значение |
|---|---|
| Блок | BL-11 |
| Requirements | FR-AUDIT-003, FR-AUDIT-004 |
| Scenarios | SC-AUDIT-002, SC-AUDIT-003 |
| Business rules | BR-005, BR-039, BR-042, BR-044 |
| Domain entities | AuditLog; все архивируемые сущности |
| Permissions | право чтения объекта; `*.archive` |
| Статус | Ready |

## Purpose
Единообразная модель soft delete и прозрачная история для пользователей, работающих с объектом.

## Actors
Owner, Admin, любой с правом чтения объекта.

## Preconditions
—

## Input
archive/restore: reason.

## Business rules
BR-005, BR-039, BR-042, BR-044.

## Main scenario
1. Архивируемые ресурсы: User (через статус), Subject, Course, Topic, LearningObjective, StudentGroup, Assignment, MediaAsset, Tag, QuestionType (деактивация), Item, Test.
2. «Удалить» в UI = «Архивировать» для используемых объектов; физическое удаление — только BR-044 и неиспользуемые элементы справочников.
3. Архивированные объекты скрыты из рабочих списков и пикеров; фильтр «Показать архив».
4. Вкладка «История» — записи AuditLog по resourceType/resourceId (и по дочерним версиям), видимые тем, кто может читать объект; diff отображается с учетом прав (без answerKey для тех, кто не видит ключ — в MVP не применимо, NFR-SEC-008 на будущее).

## Alternative scenarios
* A1 Restore объекта, родитель которого архивирован → отказ (сначала восстановить родителя).

## Data changes
status/archivedAt/archivedBy/archiveReason; AuditLog.

## Authorization
`*.archive` по ресурсу; история — по праву чтения объекта.

## UI behavior (AdminJS)
Общий компонент «История» (вкладка show-страницы); общие actions «Архивировать»/«Восстановить».

## Acceptance criteria
| ID | Критерий | Тип |
|---|---|---|
| AC-AUDIT-002.1 | История объекта показывает события создания, изменений, переходов, решений | positive |
| AC-AUDIT-002.2 | Пользователь без права чтения объекта не видит его историю | permission |
| AC-AUDIT-002.3 | Архивирование не удаляет данные; restore возвращает объект | positive |
| AC-AUDIT-002.4 | Используемый объект нельзя удалить физически ни одним путем | negative |
