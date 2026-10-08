# Critical Questions & Proposed Decisions

| Поле | Значение |
|---|---|
| Задача | T-030 (вход) |
| Статус | **Подтверждено владельцем продукта 2026-10-08** (T-030) |

Раздел 30 плана требует ответов до перехода M0 → M1. Ниже — предлагаемые ответы, на которых построены
документы baseline. Статус `Proposed` → после подтверждения `Confirmed` (или `Changed` + impact analysis по правилу изменений).

## Domain

| ID | Вопрос | Предлагаемый ответ | Где отражено | Статус |
|---|---|---|---|---|
| Q-001 | Что именно является тестом? | `Test` (идентичность) + `TestVersion` (разделы, вопросы, правила, настройки) | domain-model §1, assessment-model | Confirmed |
| Q-002 | Что именно является вопросом? | `Item` (идентичность, тип, owner) + `ItemVersion` (содержимое) | domain-model §1 | Confirmed |
| Q-003 | Является ли вопрос reusable Item? | Да; утвержденная ItemVersion используется в любом числе тестов, через pinning | BR-010, versioning-model | Confirmed |
| Q-004 | Что такое Assignment? | Задание преподавателя студентам на создание теста по темам/целям с ограничениями типов, количества, дедлайном | domain-model §2.2, SPEC-ASSIGN-001 | Confirmed |
| Q-005 | Что такое опубликованный assessment? | TestVersion в `PUBLISHED`; не более одной на тест; единственный источник Attempt | assessment-model §5 | Confirmed |

## Versioning

| ID | Вопрос | Предлагаемый ответ | Где | Статус |
|---|---|---|---|---|
| Q-006 | Что версионируется? | Item, Test, QuestionType. Остальное — история через AuditLog | versioning-model §1 | Confirmed |
| Q-007 | Когда версия становится immutable? | Content-frozen при submit; окончательно immutable при approve. Recall возможен до начала review | BR-007, BR-038 | Confirmed — **отличие от плана**: план фиксирует immutability только для APPROVED; мы замораживаем раньше, чтобы замечания эксперта относились к стабильному содержимому |
| Q-008 | Что происходит при изменении утвержденного вопроса? | Новая ItemVersion; существующие тесты не меняются; черновики автора — предложение обновить / auto-rebind при доработке | versioning-model §4 | Confirmed |

## Question Types

| ID | Вопрос | Предлагаемый ответ | Где | Статус |
|---|---|---|---|---|
| Q-009 | Какие типы являются MVP? | single_choice, multiple_choice, true_false, image_choice, attribution, matching, chronology, short_answer, essay (на 5 interaction plugins) | question-type-system §3 | Confirmed |
| Q-010 | Какие можно конфигурировать через AdminJS? | Любые параметры в пределах configSchema плагина, ограничения содержимого, evaluator из списка плагина, активность | question-type-system §4 | Confirmed |
| Q-011 | Что требует нового interaction plugin? | Новая модель взаимодействия, формат ответа, алгоритм оценивания (например, hotspot) | question-type-system §4 | Confirmed |
| Q-012 | Используют ли студенты случайный отбор? | Нет; в MVP студенты строят тесты из фиксированных собственных вопросов. SelectionRule — Teacher/Admin (`test.random_selection`) | assessment-model §3 | Confirmed |

## Permissions

| ID | Вопрос | Предлагаемый ответ | Где | Статус |
|---|---|---|---|---|
| Q-013 | Какие существуют scopes? | OWN, ASSIGNED, COURSE, ANY | permission-model §2 | Confirmed |
| Q-014 | Кто может назначать reviewer? | Owner задания (автоматически — default reviewer), преподаватели курса, Admin (`review.assign`) | SPEC-REVIEW-001 | Confirmed |
| Q-015 | Кто может approve? | Только назначенный PRIMARY reviewer с `review.perform` (Teacher, Expert, Admin), не являющийся автором | BR-001, BR-027, BR-030 | Confirmed |
| Q-016 | Может ли administrator override workflow? | Нет обхода state machine (BR-013). Admin может: переназначить reviewer (в т.ч. себя), отозвать публикацию, архивировать. Все действия журналируются | permission-model §3 | Confirmed |
| Q-017 | Видит ли преподаватель черновики студентов до отправки? | Да, в своих заданиях (ASSIGNED), только чтение — для сопровождения | permission-model §4.4 | Confirmed |

## Media

| ID | Вопрос | Предлагаемый ответ | Где | Статус |
|---|---|---|---|---|
| Q-018 | Какие типы media поддерживаются? | IMAGE (JPEG/PNG/WebP/TIFF), VIDEO (MP4/WebM) | media-model §1 | Confirmed |
| Q-019 | Какие metadata обязательны? | title, license (по умолчанию UNKNOWN); alt text — к submit; источник/правообладатель — для CLEARED; artist + workTitle — если изображено произведение | media-model §2 | Confirmed |
| Q-020 | Как хранится copyright/license? | Поля license, rightsHolder, creditLine, rightsNote + rightsStatus (PENDING/CLEARED/RESTRICTED), подтверждение пользователем с `media.rights.manage` | media-model §3 | Confirmed |

## Review

| ID | Вопрос | Предлагаемый ответ | Где | Статус |
|---|---|---|---|---|
| Q-021 | Кто может быть экспертом? | Пользователь с `review.perform` (роли TEACHER, EXPERT; Admin при самоназначении) | permission-model | Confirmed |
| Q-022 | Можно ли назначить двух экспертов? | Да: один PRIMARY (решение) + любое число ADVISORY (комментарии) | BR-030 | Confirmed |
| Q-023 | Нужна ли consensus approval? | Не в MVP; модель ReviewAssignment допускает введение политики позже | project-context §2 | Confirmed |
| Q-024 | Какие checklist items обязательны? | См. SPEC-REVIEW-002 §Checklist (8 обязательных для теста, 6 для вопроса) | SPEC-REVIEW-002 | Confirmed |

## Test lifecycle

| ID | Вопрос | Предлагаемый ответ | Где | Статус |
|---|---|---|---|---|
| Q-025 | Что означает Draft? | Версия, редактируемая автором; не видна вне own/assigned/admin | lifecycle-state-machine §1 | Confirmed |
| Q-026 | Что означает Approved? | Версия прошла экспертизу; immutable навсегда; может быть опубликована | lifecycle-state-machine §1 | Confirmed |
| Q-027 | Кто публикует? | Admin (`test.publish`). Право может быть выдано другой роли через Role management | permission-model §4.5 | Confirmed |
| Q-028 | Можно ли отозвать Published test? | Да: withdraw с причиной → ARCHIVED (WITHDRAWN); попытки и результаты сохраняются | BR-036 | Confirmed |

## Прочие решения, требующие подтверждения

| ID | Вопрос | Предлагаемый ответ | Статус |
|---|---|---|---|
| Q-029 | Нужна ли роль EXPERT отдельно от TEACHER? | Да — внешние эксперты без права вести задания | Confirmed |
| Q-030 | Технологический стек | ADR-008: Node.js LTS, TypeScript, AdminJS 7, Express, PostgreSQL 16, Prisma, S3-compatible storage, Ajv, Vitest, Playwright | Confirmed |
| Q-031 | Дедлайн и доработки | Первая отправка — до дедлайна; доработки после замечаний — пока задание не CLOSED (BR-031) | Confirmed |
| Q-032 | Сколько тестов студент создает по заданию | `maxTestsPerStudent`, по умолчанию 1 (BR-033) | Confirmed |
