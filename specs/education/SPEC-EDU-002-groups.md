# SPEC-EDU-002: Группы студентов

| Поле | Значение |
|---|---|
| Блок | BL-03 |
| Requirements | FR-EDU-004 |
| Scenarios | SC-EDU-002 |
| Business rules | BR-035 |
| Domain entities | StudentGroup, GroupMembership |
| Permissions | `group.read`, `group.manage` |
| Статус | Ready |

## Purpose
Адресовать задания группам и определять, какие курсы видит студент.

## Actors
Teacher (свои курсы), Admin.

## Preconditions
Активный курс.

## Input
| Поле | Тип | Обязательно | Валидация |
|---|---|---|---|
| course | Course | да | активный, в scope |
| name | string | да | уникально в курсе |
| members | User[] | нет | только пользователи с ролью STUDENT, статус ACTIVE/INVITED |

## Business rules
BR-035 — изменения состава журналируются.

## Main scenario
Создание группы, добавление/удаление членов. Студент, удаленный из группы, теряет доступ к новым заданиям группы; созданный им контент остается его собственностью.

## Alternative scenarios
* A1 Не-студент → отказ.

## Data changes
StudentGroup, GroupMembership, AuditLog.

## Authorization
`group.manage` COURSE/ANY.

## UI behavior (AdminJS)
Ресурс «Группы» с компонентом выбора студентов.

## Acceptance criteria
| ID | Критерий | Тип |
|---|---|---|
| AC-EDU-002.1 | Teacher создает группу в своем курсе и добавляет студентов | positive |
| AC-EDU-002.2 | Пользователь без роли STUDENT не добавляется | negative |
| AC-EDU-002.3 | Студент видит курс через членство в группе | positive |
| AC-EDU-002.4 | Teacher не управляет группами чужого курса | permission |
