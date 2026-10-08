# SPEC-REVIEW-001: Назначение эксперта и очередь экспертизы

| Поле | Значение |
|---|---|
| Блок | BL-09 |
| Requirements | FR-REVIEW-001, FR-REVIEW-002, FR-REVIEW-003 |
| Scenarios | SC-REVIEW-001, SC-REVIEW-004, SC-E2E-001 (шаги 8, 10) |
| Business rules | BR-001, BR-027, BR-030, BR-035 |
| Domain entities | Review, ReviewAssignment, Assignment, User |
| Permissions | `review.assign`, `review.perform`, `review.read` |
| Статус | Ready |

## Purpose
Каждая отправленная версия должна получить ответственного эксперта, не являющегося автором, и попасть в его очередь.

## Actors
Система (автоназначение), owner задания, Teacher курса, Admin, reviewer.

## Preconditions
Версия переведена в READY_FOR_REVIEW (SPEC-TEST-004 / SPEC-ITEM-002).

## Input
| Поле | Тип | Обязательно | Валидация |
|---|---|---|---|
| reviewer | User | да | ACTIVE, `review.perform`, не автор (BR-027) |
| role | PRIMARY / ADVISORY | да | ровно один активный PRIMARY (BR-030) |
| reason | string | при переназначении | |

## Business rules
BR-027, BR-030, BR-001.

## Main scenario
1. Автоназначение при submit: PRIMARY = `assignment.defaultReviewerId` (или owner задания); для теста/вопроса вне задания — reviewer, выбранный автором из допустимых, иначе Review попадает в очередь «Не назначено» (видна Admin и Teacher курса).
2. Если кандидат нарушает BR-027 — Review создается без назначения, owner задания и Admin видят его в «Не назначено».
3. Reassign: активный PRIMARY → REVOKED; новый PRIMARY; если review был IN_PROGRESS — остается IN_PROGRESS, черновые checklist-отметки сохраняются; аудит.
4. Add advisory: ReviewAssignment(ADVISORY).
5. Очередь «Мои экспертизы»: Review с активным назначением actor; колонки: объект, автор, задание, роль, статус, отправлено, дедлайн задания; сортировка по дате отправки.

## Alternative scenarios
* A1 Кандидат — автор/соавтор → отказ BR-027.
* A2 Кандидат заблокирован → отказ.
* A3 Reviewer заблокирован после назначения → Review показывается в «Требует переназначения».

## Data changes
Review, ReviewAssignment, AuditLog.

## Authorization
`review.assign`: ASSIGNED (owner задания) / COURSE / ANY. Очередь — `review.read` ASSIGNED.

## UI behavior (AdminJS)
Ресурс «Экспертизы» с фильтрами «Мои», «Не назначено», «Все (Admin)»; action «Назначить эксперта».

## Acceptance criteria
| ID | Критерий | Тип |
|---|---|---|
| AC-REVIEW-001.1 | После submit по заданию создается ReviewAssignment(PRIMARY) на default reviewer | positive |
| AC-REVIEW-001.2 | Назначение автора reviewer'ом отклоняется | negative |
| AC-REVIEW-001.3 | Одновременно может быть только один активный PRIMARY | negative |
| AC-REVIEW-001.4 | Reviewer видит Review в очереди; другой эксперт — нет | permission |
| AC-REVIEW-001.5 | Студент не может назначать экспертов | permission |
| AC-REVIEW-001.6 | Переназначение журналируется с причиной | audit |
