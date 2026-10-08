# Functional Requirements

| Поле | Значение |
|---|---|
| Задача | T-004 |
| Статус | Baseline — утверждено в T-030 (2026-10-08) |

Приоритет: **M** — Must (MVP), **S** — Should (MVP, если позволяет срок), **F** — Future (модель предусмотрена, реализация вне MVP).
Колонки SC/SPEC — прямая трассировка; полная — в `validation/traceability-matrix.md`.

## FR-AUTH — Identity & Authentication (BL-01)

| ID | Требование | P | BR | SC | SPEC |
|---|---|---|---|---|---|
| FR-AUTH-001 | Пользователь входит в административный интерфейс по email и паролю. | M | BR-014 | SC-AUTH-001 | SPEC-AUTH-001 |
| FR-AUTH-002 | Пользователь завершает сессию (logout); сессия становится недействительной на сервере. | M | | SC-AUTH-002 | SPEC-AUTH-002 |
| FR-AUTH-003 | Сессия истекает по неактивности и по абсолютному сроку. | M | | SC-AUTH-002 | SPEC-AUTH-002 |
| FR-AUTH-004 | Система временно блокирует вход после серии неудачных попыток. | M | | SC-AUTH-003 | SPEC-AUTH-001 |
| FR-AUTH-005 | Пользователь меняет свой пароль; администратор инициирует сброс пароля (одноразовая ссылка/временный пароль с обязательной сменой). | M | | SC-AUTH-004 | SPEC-AUTH-004 |
| FR-AUTH-006 | Для каждого запроса формируется authorization context: пользователь, роли, permissions со scope. | M | BR-014 | SC-AUTH-001 | SPEC-AUTH-003, SPEC-AUTH-001 |
| FR-AUTH-007 | Приглашенный пользователь (`INVITED`) активирует аккаунт, установив пароль по одноразовой ссылке. | S | BR-014 | SC-USER-001 | SPEC-AUTH-004 |

## FR-USER / FR-PERM — Users, Roles & Permissions (BL-02)

| ID | Требование | P | BR | SC | SPEC |
|---|---|---|---|---|---|
| FR-USER-001 | Администратор создает пользователя (email, имя, роли, начальный статус). | M | | SC-USER-001 | SPEC-USER-001 |
| FR-USER-002 | Администратор редактирует профиль пользователя. | M | | SC-USER-001 | SPEC-USER-001 |
| FR-USER-003 | Администратор блокирует / разблокирует / архивирует пользователя. | M | BR-014, BR-015, BR-016 | SC-USER-003 | SPEC-USER-001 |
| FR-USER-004 | Администратор назначает и снимает роли пользователя. | M | BR-015, BR-016 | SC-USER-002 | SPEC-USER-002 |
| FR-USER-005 | Список пользователей с фильтром по роли, статусу, курсу/группе. | M | | SC-USER-001 | SPEC-USER-001 |
| FR-USER-006 | Пользователь просматривает собственный профиль и свои роли. | S | | — | SPEC-USER-001 |
| FR-PERM-001 | Администратор управляет ролями (создает пользовательские роли, меняет набор permissions и scope). | M | BR-046 | SC-PERM-001 | SPEC-USER-002 |
| FR-PERM-002 | Каждая операция над ресурсом авторизуется на сервере по модели RBAC + scope + ownership. | M | | все | SPEC-AUTH-003, SPEC-ITEM-004 |
| FR-PERM-003 | Списки ресурсов фильтруются по scope пользователя на уровне запроса к данным. | M | | SC-ITEM-005 | SPEC-AUTH-003, SPEC-ITEM-004, SPEC-ITEM-005 |
| FR-PERM-004 | UI скрывает недоступные действия и ресурсы (как удобство, не как защита). | M | | все | SPEC-AUTH-003 |

## FR-EDU — Educational Structure (BL-03)

| ID | Требование | P | BR | SC | SPEC |
|---|---|---|---|---|---|
| FR-EDU-001 | Ведение предметов и курсов; назначение преподавателей курса. | M | BR-042 | SC-EDU-001 | SPEC-EDU-001 |
| FR-EDU-002 | Ведение иерархии тем и подтем курса с порядком. | M | BR-042 | SC-EDU-001 | SPEC-EDU-001 |
| FR-EDU-003 | Ведение учебных целей, привязанных к темам. | M | BR-042 | SC-EDU-001 | SPEC-EDU-001 |
| FR-EDU-004 | Ведение групп студентов курса и их состава. | M | | SC-EDU-002 | SPEC-EDU-002 |
| FR-EDU-005 | Архивирование и восстановление элементов структуры. | M | BR-042, BR-039 | SC-EDU-001 | SPEC-EDU-001 |

## FR-ASSIGN — Assignments (BL-04)

| ID | Требование | P | BR | SC | SPEC |
|---|---|---|---|---|---|
| FR-ASSIGN-001 | Преподаватель создает задание: курс, название, инструкции, темы, учебные цели. | M | BR-043 | SC-ASSIGN-001 | SPEC-ASSIGN-001 |
| FR-ASSIGN-002 | Задание адресуется студентам и/или группам. | M | | SC-ASSIGN-001 | SPEC-ASSIGN-001 |
| FR-ASSIGN-003 | Задание задает допустимые типы вопросов, min/max вопросов, лимит тестов на студента. | M | BR-018, BR-032, BR-033 | SC-ASSIGN-001 | SPEC-ASSIGN-001 |
| FR-ASSIGN-004 | Задание имеет дедлайн; преподаватель может продлить его конкретному студенту. | M | BR-031 | SC-ASSIGN-003 | SPEC-ASSIGN-002 |
| FR-ASSIGN-005 | Жизненный цикл задания: DRAFT → ACTIVE → CLOSED → ARCHIVED. | M | BR-017 | SC-ASSIGN-002 | SPEC-ASSIGN-002 |
| FR-ASSIGN-006 | Задание указывает reviewer по умолчанию (по умолчанию — owner). | M | BR-027 | SC-ASSIGN-001 | SPEC-ASSIGN-001 |
| FR-ASSIGN-007 | Студент видит список адресованных ему активных заданий и свой прогресс по ним. | M | | SC-TEST-001 | SPEC-ASSIGN-002 |
| FR-ASSIGN-008 | Преподаватель видит по заданию сводку: кто создал тест, в каком состоянии версии. | S | | SC-ASSIGN-002 | SPEC-ASSIGN-002 |

## FR-MEDIA — Media Library (BL-05)

| ID | Требование | P | BR | SC | SPEC |
|---|---|---|---|---|---|
| FR-MEDIA-001 | Загрузка изображений (JPEG, PNG, WebP, TIFF→конверсия) и видео (MP4, WebM) с проверкой типа и размера. | M | | SC-MEDIA-001 | SPEC-MEDIA-001 |
| FR-MEDIA-002 | Ввод метаданных: название, alt text, подпись, сведения о произведении, источник. | M | BR-025 | SC-MEDIA-001 | SPEC-MEDIA-001 |
| FR-MEDIA-003 | Ввод правовой информации: лицензия, правообладатель, credit line, статус прав. | M | BR-024, BR-045 | SC-MEDIA-002 | SPEC-MEDIA-002 |
| FR-MEDIA-004 | Автоматическая генерация превью (thumbnail/preview/poster). | M | | SC-MEDIA-001 | SPEC-MEDIA-001 |
| FR-MEDIA-005 | Поиск и фильтрация по метаданным, тегам, статусу прав, типу. | M | | SC-MEDIA-003 | SPEC-MEDIA-001 |
| FR-MEDIA-006 | Просмотр мест использования медиа (в каких версиях вопросов). | M | BR-026 | SC-MEDIA-002 | SPEC-MEDIA-002 |
| FR-MEDIA-007 | Архивирование медиа; запрет удаления и замены файла используемого медиа. | M | BR-005, BR-026, BR-039 | SC-MEDIA-002 | SPEC-MEDIA-002 |
| FR-MEDIA-008 | Теги медиа. | S | | SC-MEDIA-001 | SPEC-MEDIA-001 |

## FR-QTYPE — Question Type Registry (BL-06)

| ID | Требование | P | BR | SC | SPEC |
|---|---|---|---|---|---|
| FR-QTYPE-001 | Реестр типов вопросов: просмотр типов, их interaction, schema, response format, evaluation method. | M | INV-015 | SC-QTYPE-001 | SPEC-QTYPE-001 |
| FR-QTYPE-002 | Администратор создает configurable type на основе зарегистрированного interaction plugin. | M | BR-023 | SC-QTYPE-001 | SPEC-QTYPE-001 |
| FR-QTYPE-003 | Изменение конфигурации типа создает новую версию типа. | M | BR-022 | SC-QTYPE-002 | SPEC-QTYPE-001 |
| FR-QTYPE-004 | Активация/деактивация типа. | M | BR-021 | SC-QTYPE-002 | SPEC-QTYPE-001 |
| FR-QTYPE-005 | Система поставляется с MVP-набором типов (см. `docs/question-type-system.md`). | M | | SC-ITEM-001 | SPEC-QTYPE-002 |
| FR-QTYPE-006 | Interaction plugin предоставляет: schema, editor-компонент AdminJS, preview, валидацию, evaluator. | M | BR-023 | — | SPEC-QTYPE-002 |

## FR-ITEM — Item Bank (BL-07)

| ID | Требование | P | BR | SC | SPEC |
|---|---|---|---|---|---|
| FR-ITEM-001 | Создание вопроса выбранного типа; форма строится по schema типа. | M | BR-017, BR-018, BR-019, BR-021 | SC-ITEM-001, SC-ITEM-002 | SPEC-ITEM-001 |
| FR-ITEM-002 | Вопрос с вариантами-изображениями (выбор MediaAsset для вариантов). | M | BR-024, BR-025 | SC-ITEM-002 | SPEC-ITEM-001 |
| FR-ITEM-003 | Редактирование собственного черновика. | M | BR-004, BR-006, BR-007 | SC-ITEM-003 | SPEC-ITEM-002 |
| FR-ITEM-004 | Создание новой версии на основе существующей. | M | BR-003, BR-006, BR-041, BR-044 | SC-VERSION-002 | SPEC-ITEM-002 |
| FR-ITEM-005 | Привязка к темам, учебным целям, тегам; сложность; баллы по умолчанию. | M | | SC-ITEM-001 | SPEC-ITEM-001 |
| FR-ITEM-006 | Предпросмотр вопроса в виде, близком к Student Runner, включая проверку ответа. | M | | SC-ITEM-004 | SPEC-ITEM-003 |
| FR-ITEM-007 | Список и фильтрация банка (тип, тема, цель, тег, сложность, состояние, автор, задание) с drawer-просмотром. | M | | SC-ITEM-005 | SPEC-ITEM-005 |
| FR-ITEM-008 | История версий вопроса и сравнение двух версий. | S | | SC-VERSION-002 | SPEC-ITEM-002 |
| FR-ITEM-009 | Отправка вопроса на самостоятельную экспертизу (для банка, вне теста). | M | BR-020, BR-024, BR-025 | SC-ITEM-006 | SPEC-ITEM-002 |
| FR-ITEM-010 | Архивирование/восстановление вопроса. | M | BR-005, BR-039 | SC-ITEM-007 | SPEC-ITEM-002 |
| FR-ITEM-011 | Авторизация доступа к вопросам по owner/assigned/any. | M | BR-004 | SC-ITEM-005 | SPEC-ITEM-004 |

## FR-TEST — Test Authoring (BL-08)

| ID | Требование | P | BR | SC | SPEC |
|---|---|---|---|---|---|
| FR-TEST-001 | Студент создает тест из задания; преподаватель — тест вне задания (в своем курсе). | M | BR-017, BR-033 | SC-TEST-001 | SPEC-TEST-001 |
| FR-TEST-002 | Управление разделами версии (добавить, упорядочить, инструкции, лимит времени раздела). | M | BR-007 | SC-TEST-002 | SPEC-TEST-002 |
| FR-TEST-003 | Добавление фиксированных вопросов (конкретные ItemVersion) с баллами и порядком. | M | BR-010 | SC-TEST-002 | SPEC-TEST-002 |
| FR-TEST-004 | Добавление правил случайного отбора (фильтр, количество, баллы) с проверкой размера пула. | M | BR-012 | SC-TEST-003 | SPEC-TEST-002 |
| FR-TEST-005 | Настройки: лимит времени, навигация, число попыток, перемешивание, обратная связь, проходной балл. | M | | SC-TEST-004 | SPEC-TEST-003 |
| FR-TEST-006 | Проверка готовности версии и отправка на review. | M | BR-007, BR-020, BR-024, BR-025, BR-031, BR-032 | SC-TEST-005 | SPEC-TEST-004 |
| FR-TEST-007 | Создание новой версии теста на основе предыдущей (после замечаний или изменения утвержденного). | M | BR-002, BR-003, BR-041 | SC-VERSION-001 | SPEC-TEST-004 |
| FR-TEST-008 | Предпросмотр всего теста (со случайной выборкой по seed). | S | | SC-TEST-006 | SPEC-TEST-003 |
| FR-TEST-009 | Отзыв отправки до начала review. | M | BR-038 | SC-TEST-005 | SPEC-TEST-004 |

## FR-REVIEW — Review Workflow (BL-09)

| ID | Требование | P | BR | SC | SPEC |
|---|---|---|---|---|---|
| FR-REVIEW-001 | При отправке версии создается Review и ReviewAssignment на reviewer по умолчанию. | M | BR-027 | SC-REVIEW-001 | SPEC-REVIEW-001 |
| FR-REVIEW-002 | Назначение/переназначение primary reviewer и добавление advisory reviewers. | M | BR-027, BR-030 | SC-REVIEW-004 | SPEC-REVIEW-001 |
| FR-REVIEW-003 | Очередь экспертизы: назначенные мне review с фильтром и сортировкой по сроку. | M | | SC-REVIEW-001 | SPEC-REVIEW-001 |
| FR-REVIEW-004 | Заполнение checklist. | M | BR-028 | SC-REVIEW-003 | SPEC-REVIEW-002 |
| FR-REVIEW-005 | Комментарии с привязкой к тесту, разделу, вопросу, полю; ответы в потоке. | M | BR-040 | SC-REVIEW-002 | SPEC-REVIEW-002 |
| FR-REVIEW-006 | Замечания (ContentIssue) с severity и статусом; автор отмечает «устранено», reviewer закрывает. | M | BR-028, BR-029 | SC-REVIEW-002, SC-REVIEW-005 | SPEC-REVIEW-002 |
| FR-REVIEW-007 | Решение «вернуть на доработку». | M | BR-001, BR-029 | SC-REVIEW-002 | SPEC-REVIEW-003 |
| FR-REVIEW-008 | Решение «принять» (approve). | M | BR-001, BR-011, BR-012, BR-028 | SC-REVIEW-003 | SPEC-REVIEW-003 |
| FR-REVIEW-009 | Перенос незакрытых замечаний в review следующей версии. | M | | SC-REVIEW-005 | SPEC-REVIEW-002 |
| FR-REVIEW-010 | Администратор ведет шаблоны checklist. | M | | SC-REVIEW-006 | SPEC-REVIEW-002 |

## FR-PUB — Publishing & Lifecycle (BL-10)

| ID | Требование | P | BR | SC | SPEC |
|---|---|---|---|---|---|
| FR-PUB-001 | Жизненный цикл версий по state machine с отображением состояния и доступных переходов. | M | BR-013 | все | SPEC-PUB-001 |
| FR-PUB-002 | Публикация утвержденной версии теста. | M | BR-008, BR-009 | SC-PUBLISH-001 | SPEC-PUB-002 |
| FR-PUB-003 | Отзыв опубликованной версии с указанием причины. | M | BR-036 | SC-PUBLISH-002 | SPEC-PUB-002 |
| FR-PUB-004 | Архивирование и восстановление тестов. | M | BR-005, BR-039 | SC-PUBLISH-003 | SPEC-PUB-002 |
| FR-PUB-005 | История публикаций теста. | M | | SC-PUBLISH-001 | SPEC-PUB-002 |

## FR-AUDIT — Audit & Governance (BL-11)

| ID | Требование | P | BR | SC | SPEC |
|---|---|---|---|---|---|
| FR-AUDIT-001 | Журналирование изменений ресурсов, переходов состояний, решений, прав, аутентификации. | M | BR-034, BR-035 | SC-AUDIT-001 | SPEC-AUDIT-001 |
| FR-AUDIT-002 | Просмотр журнала с фильтром по пользователю, ресурсу, действию, периоду. | M | | SC-AUDIT-001 | SPEC-AUDIT-001 |
| FR-AUDIT-003 | История конкретного объекта (вкладка «История» на ресурсе). | M | | SC-AUDIT-002 | SPEC-AUDIT-002 |
| FR-AUDIT-004 | Единая модель архивирования/восстановления с журналированием. | M | BR-005, BR-039 | SC-AUDIT-003 | SPEC-AUDIT-002 |

## FR-DELIV — Assessment Delivery Preparation (BL-12)

| ID | Требование | P | BR | SC | SPEC |
|---|---|---|---|---|---|
| FR-DELIV-001 | Модель Attempt/Response/ResponseEvaluation/Result специфицирована и совместима с моделью контента. | M (спецификация) | BR-037 | — | SPEC-DELIV-001 |
| FR-DELIV-002 | Каждый interaction plugin предоставляет evaluator, вычисляющий оценку по `answerKey` и `Response.payload`. | M | INV-015 | SC-ITEM-004 | SPEC-QTYPE-002, SPEC-ITEM-003, SPEC-DELIV-001 |
| FR-DELIV-003 | Прохождение теста студентом (Student Runner). | F | | — | — |
| FR-DELIV-004 | Расчет ItemStatistics / TestStatistics. | F | | — | — |
