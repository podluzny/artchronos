# SPEC-EDU-001: Предметы, курсы, темы, учебные цели

| Поле | Значение |
|---|---|
| Блок | BL-03 |
| Requirements | FR-EDU-001, FR-EDU-002, FR-EDU-003, FR-EDU-005 |
| Scenarios | SC-EDU-001, SC-AUDIT-003 |
| Business rules | BR-039, BR-042, BR-035 |
| Domain entities | Subject, Course, Topic, LearningObjective |
| Permissions | `taxonomy.read`, `taxonomy.manage` |
| Статус | Draft |

## Purpose
Учебная структура, к которой привязываются задания, вопросы и правила отбора.

## Actors
Admin (предметы, курсы, преподаватели курса); Teacher (темы и цели своих курсов).

## Preconditions
Права; для темы — существующий активный курс.

## Input
| Сущность | Поля | Валидация |
|---|---|---|
| Subject | code, name | code уникален |
| Course | subject, code, name, academicPeriod, teachers | code уникален в предмете; teachers — пользователи с ролью TEACHER |
| Topic | course, parent?, name, order | parent в том же курсе; глубина ≤ 3; без циклов |
| LearningObjective | topic, code, text, bloomLevel? | code уникален в курсе |

## Business rules
* BR-042 — используемый элемент только архивируется.
* BR-039 — архивированные темы/цели нельзя выбрать в новых заданиях/вопросах.

## Main scenario
CRUD через application layer; удаление = архивирование, если есть ссылки (Assignment, ItemVersion, SelectionRule, дочерние темы); иначе разрешено физическое удаление неиспользованного элемента (аудит сохраняется).

## Alternative scenarios
* A1 Цикл/превышение глубины иерархии → ошибка.
* A2 Архивирование темы с активными дочерними → предложение архивировать поддерево.

## Data changes
Сущности структуры; AuditLog.

## Authorization
`taxonomy.manage`: Admin ANY; Teacher COURSE — только Topic/LearningObjective своих курсов.

## UI behavior (AdminJS)
Ресурсы с фильтрацией по курсу; дерево тем (кастомный компонент) с drag-and-drop порядка; переключатель «показать архив».

## Acceptance criteria
| ID | Критерий | Тип |
|---|---|---|
| AC-EDU-001.1 | Teacher создает тему и подтему в своем курсе | positive |
| AC-EDU-001.2 | Teacher не может изменять темы чужого курса | permission |
| AC-EDU-001.3 | Удаление используемой темы невозможно; доступно архивирование | negative |
| AC-EDU-001.4 | Архивированная тема недоступна для выбора в новом задании/вопросе | negative |
| AC-EDU-001.5 | Цикл в иерархии тем отклоняется | negative |
