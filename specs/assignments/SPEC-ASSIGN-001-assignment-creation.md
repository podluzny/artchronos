# SPEC-ASSIGN-001: Создание и адресация задания

| Поле | Значение |
|---|---|
| Блок | BL-04 |
| Requirements | FR-ASSIGN-001, FR-ASSIGN-002, FR-ASSIGN-003, FR-ASSIGN-006 |
| Scenarios | SC-ASSIGN-001, SC-E2E-001 (шаг 3) |
| Business rules | BR-018, BR-021, BR-027, BR-039, BR-043 |
| Domain entities | Assignment, AssignmentTarget, Topic, LearningObjective, QuestionType, StudentGroup |
| Permissions | `assignment.create`, `assignment.update`, `assignment.read` |
| Статус | Ready |

## Purpose
Формализовать правило «студент может создавать тесты на определенную тему»: задание задает рамки контента студента.

## Actors
Teacher (курсы, где он преподаватель), Admin.

## Preconditions
Активный курс; есть активные темы и типы вопросов.

## Input
| Поле | Тип | Обязательно | Валидация |
|---|---|---|---|
| course | Course | да | в scope |
| title | string | да | 1–200 |
| instructions | rich text | нет | санитизация |
| topics | Topic[] | да (≥1 для активации) | активные, в курсе |
| learningObjectives | LearningObjective[] | нет | принадлежат выбранным темам (или их подтемам) |
| allowedQuestionTypes | QuestionType[] | да (≥1 для активации) | ACTIVE (BR-021) |
| minItems, maxItems | int | да | 1 ≤ min ≤ max ≤ 100 |
| maxTestsPerStudent | int | да | 1–10, по умолчанию 1 |
| deadlineAt | datetime | да | в будущем при активации |
| targets | (User \| StudentGroup)[] | да (≥1 для активации) | студенты/группы курса |
| defaultReviewer | User | нет (по умолчанию owner) | `review.perform`, ACTIVE (BR-027) |

## Business rules
* BR-043 — owner — преподаватель курса или Admin.
* BR-018 — определяет допустимые типы для контента студентов.
* BR-027 — default reviewer должен иметь право экспертизы.

## Main scenario
1. Teacher создает задание (`DRAFT`), owner = actor.
2. Заполняет поля; черновик сохраняется с неполными данными.
3. «Активировать» (SPEC-ASSIGN-002) — полная валидация.

## Alternative scenarios
* A1 Неактивный/архивированный тип или тема → ошибка поля.
* A2 Цель не принадлежит выбранным темам → ошибка.
* A3 Изменение allowedTypes/topics у `ACTIVE` задания: сужение не затрагивает уже созданный контент, но применяется при следующих submit; изменение журналируется и требует подтверждения.

## Data changes
Assignment, AssignmentTarget, AuditLog.

## Authorization
`assignment.create` (COURSE/ANY); `assignment.update` (OWN/COURSE/ANY); state guard: поля задания редактируются в DRAFT и ACTIVE, не в CLOSED/ARCHIVED.

## UI behavior (AdminJS)
Форма задания с мульти-выбором тем (дерево), целей (фильтр по темам), типов (только ACTIVE), адресатов (группы/студенты курса).

## Acceptance criteria
| ID | Критерий | Тип |
|---|---|---|
| AC-ASSIGN-001.1 | Teacher создает задание в своем курсе с темами, целями, типами, ограничениями, дедлайном, адресатами | positive |
| AC-ASSIGN-001.2 | Студент не может создать задание | permission |
| AC-ASSIGN-001.3 | Teacher не может создать задание в чужом курсе | permission |
| AC-ASSIGN-001.4 | Неактивный тип вопроса нельзя выбрать | negative |
| AC-ASSIGN-001.5 | minItems > maxItems отклоняется | negative |
| AC-ASSIGN-001.6 | Default reviewer без `review.perform` отклоняется | negative |
