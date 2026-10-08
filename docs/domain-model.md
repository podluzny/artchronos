# Domain Model

| Поле | Значение |
|---|---|
| Задача | T-002 |
| Статус | Draft — ожидает domain review (T-030) |
| Связанные | business-rules.md, versioning-model.md, lifecycle-state-machine.md, ADR-002, ADR-005 |

> Схема БД **не создается** до завершения domain review (раздел 19 плана):
> `Domain Model → Relationships → Business Rules → Versioning rules → Permission rules → Data Model → Migrations`.
> Атрибуты ниже — доменные, а не колонки. Типы — логические.

## 1. Ответы на базовые доменные вопросы

| Вопрос | Ответ |
|---|---|
| Что такое **вопрос**? | `Item` — переиспользуемая единица банка вопросов, имеющая постоянную идентичность, владельца, тип и последовательность версий `ItemVersion`. Содержимое живет только в версиях. |
| Является ли вопрос reusable? | **Да.** Утвержденная `ItemVersion` может использоваться в любом количестве тестов (фиксированно или через случайный отбор). |
| Что такое **тест**? | `Test` — идентичность теста (название, владелец, связь с заданием) и последовательность версий `TestVersion`. `TestVersion` — структура (разделы, вопросы, правила отбора) + настройки (время, навигация, попытки, оценивание, обратная связь). |
| Что такое **Assignment**? | Учебное задание, созданное преподавателем: «создайте тест по теме X с целями Y, используя типы Z, N–M вопросов, до даты D». Адресуется студентам и/или группам. Задает рамки, в которых студенты имеют право создавать контент. |
| Что такое **опубликованный assessment**? | `TestVersion` в состоянии `PUBLISHED`. Только он может стать основой `Attempt`. У одного `Test` не более одной опубликованной версии одновременно. |
| Что версионируется? | `Item` (через `ItemVersion`), `Test` (через `TestVersion`), `QuestionType` (через `QuestionTypeVersion` — schema). Не версионируются: пользователи, роли, учебная структура, задания, медиа (замена файла = новый `MediaAsset`) — их история ведется через `AuditLog`. |

## 2. Bounded contexts и сущности

### 2.1 Identity

| Сущность | Назначение | Ключевые атрибуты |
|---|---|---|
| `User` | Учетная запись | id, email (уникален, case-insensitive), displayName, passwordHash, status (`INVITED`, `ACTIVE`, `BLOCKED`, `ARCHIVED`), failedLoginCount, lockedUntil, lastLoginAt, passwordChangedAt, mustChangePassword, revision |
| `Role` | Именованный набор permissions | id, code (`ADMIN`, `TEACHER`, `EXPERT`, `STUDENT`, пользовательские), name, isSystem, description |
| `Permission` | Атомарное право `resource.action` | id, key (например `item.update`), description, supportedScopes |
| `UserRole` | Назначение роли пользователю | userId, roleId, grantedBy, grantedAt |
| `RolePermission` | Право внутри роли с областью | roleId, permissionId, scope (`OWN`, `ASSIGNED`, `ANY`) |
| `Session` | Аутентифицированная сессия | id, userId, createdAt, lastSeenAt, expiresAt, ip, userAgent, revokedAt |
| `PasswordToken` | Служебная: одноразовый токен активации/сброса | id, userId, purpose (`ACTIVATION`, `RESET`), tokenHash, expiresAt, usedAt |
| `AuditLog` | Неизменяемый журнал | id, occurredAt, actorId, actorRoles (snapshot), action, resourceType, resourceId, changes (before/after), reason, requestId, ip |

### 2.2 Education

| Сущность | Назначение | Ключевые атрибуты |
|---|---|---|
| `Subject` | Предмет (например, «История искусства») | id, code, name, status |
| `Course` | Курс внутри предмета | id, subjectId, code, name, academicPeriod, ownerIds (преподаватели курса), status |
| `Topic` | Тема; иерархия через `parentId` (подтемы) | id, courseId, parentId?, name, order, status |
| `LearningObjective` | Учебная цель | id, topicId, code, text, bloomLevel?, status |
| `StudentGroup` | Группа студентов курса | id, courseId, name, status |
| `GroupMembership` | Членство студента в группе | groupId, userId |
| `Assignment` | Задание на создание теста | id, courseId, ownerId (Teacher), title, instructions, topicIds[], learningObjectiveIds[], allowedQuestionTypeIds[], minItems, maxItems, maxTestsPerStudent (default 1), deadlineAt, defaultReviewerId?, status (`DRAFT`, `ACTIVE`, `CLOSED`, `ARCHIVED`), revision |
| `AssignmentTarget` | Адресат задания | assignmentId, targetType (`USER`, `GROUP`), targetId |
| `DeadlineExtension` | Продление дедлайна конкретному студенту | assignmentId, userId, newDeadlineAt, grantedBy |

> `StudentGroup`, `GroupMembership`, `AssignmentTarget`, `DeadlineExtension` добавлены к исходному списку,
> т.к. требование «назначение студентам/группам» и правило о дедлайне (BR-031) без них не выражаются.

### 2.3 Content (Media)

| Сущность | Назначение | Ключевые атрибуты |
|---|---|---|
| `MediaAsset` | Медиафайл и его метаданные | id, kind (`IMAGE`, `VIDEO`), storageKey, mimeType, sizeBytes, sha256, width, height, durationSec?, title, altText, caption, transcript?, depictsArtwork, artwork (artist, workTitle, dateText, technique, collection/museum, inventoryNo), source (url/описание), license (`PUBLIC_DOMAIN`, `CC0`, `CC_BY`, `CC_BY_SA`, `CC_BY_NC`, `CC_BY_NC_SA`, `LICENSED`, `EDUCATIONAL_EXCEPTION`, `UNKNOWN`), rightsHolder, creditLine, rightsStatus (`PENDING`, `CLEARED`, `RESTRICTED`), rightsNote, rightsVerifiedBy, rightsVerifiedAt, topicIds[], tagIds[], ownerId, status (`ACTIVE`, `ARCHIVED`), revision |
| `MediaDerivative` | Производный файл (превью) | mediaAssetId, variant (`THUMB`, `PREVIEW`, `POSTER`), storageKey |
| `Material` | Учебный материал (текст/ссылка/набор медиа) для заданий и разделов | id, courseId, title, body, mediaAssetIds[], status |
| `Tag` | Свободная метка | id, name (уникален в нормализованной форме), status |

### 2.4 Item Bank

| Сущность | Назначение | Ключевые атрибуты |
|---|---|---|
| `QuestionType` | Тип вопроса в реестре | id, code (`single_choice`, …), name, interactionKey (ссылка на код-плагин), status (`ACTIVE`, `INACTIVE`), currentVersionId |
| `QuestionTypeVersion` | Неизменяемая версия конфигурации типа | id, questionTypeId, versionNo, contentSchema (JSON Schema), interactionConfig, responseSchema, evaluation (method + params), uiHints, createdAt, createdBy |
| `Item` | Идентичность вопроса | id, questionTypeId (неизменен), ownerId, assignmentId?, courseId, status (`ACTIVE`, `ARCHIVED`), currentDraftVersionId?, latestApprovedVersionId?, createdAt |
| `ItemVersion` | Версия содержимого | id, itemId, versionNo, basedOnVersionId?, questionTypeVersionId, state (см. lifecycle), stem (текст), content (JSONB по contentSchema), answerKey (JSONB), defaultPoints, difficulty (1–5), feedback?, authorIds[], topicIds[], learningObjectiveIds[], submittedAt, approvedAt, approvedBy, contentHash, revision |
| `ItemOption` | Элемент ответа (вариант / элемент пары / элемент последовательности) | id, itemVersionId, key (стабилен между версиями), role (`OPTION`, `PREMISE`, `RESPONSE`, `SEQUENCE_ELEMENT`), text?, mediaAssetId?, altTextOverride?, ordinal |
| `ItemMedia` | Медиа-стимул вопроса | itemVersionId, mediaAssetId, role (`STIMULUS`, `ILLUSTRATION`), altTextOverride?, ordinal |
| `ItemTag` | Метка версии | itemVersionId, tagId |

### 2.5 Assessment

| Сущность | Назначение | Ключевые атрибуты |
|---|---|---|
| `Test` | Идентичность теста | id, title, ownerId, assignmentId?, courseId, status (`ACTIVE`, `ARCHIVED`), publishedVersionId?, currentDraftVersionId? |
| `TestVersion` | Версия теста | id, testId, versionNo, basedOnVersionId?, state, title, description, instructions, settings (timeLimitSec?, navigation `LINEAR`/`FREE`, maxAttempts, shuffleSections, shuffleItems, shuffleOptions, feedbackMode `NONE`/`AFTER_SUBMIT`/`AFTER_CLOSE`, scoring: method `SUM`, passingScore?), authorIds[], submittedAt, approvedAt, approvedBy, publishedAt, publishedBy, archivedAt, archiveReason, contentHash, revision |
| `Section` | Раздел версии | id, testVersionId, title, instructions, ordinal, timeLimitSec?, shuffleItems? |
| `TestSectionItem` | Фиксированный вопрос в разделе | id, sectionId, itemVersionId (**pinning**), ordinal, points |
| `SelectionRule` | Правило случайного отбора | id, sectionId, ordinal, count, pointsPerItem, filter (topicIds, learningObjectiveIds, tagIds, questionTypeIds, difficultyMin/Max, courseId), excludeFixed (true) |
| `SelectionPoolEntry` | Замороженный пул правила (создается при approve) | selectionRuleId, itemVersionId |

### 2.6 Review

| Сущность | Назначение | Ключевые атрибуты |
|---|---|---|
| `Review` | Экспертиза конкретной версии | id, subjectType (`TEST_VERSION`, `ITEM_VERSION`), subjectId, status (`OPEN`, `IN_PROGRESS`, `CHANGES_REQUESTED`, `APPROVED`, `CANCELLED`), checklistTemplateId, decision?, decidedBy?, decidedAt?, summary |
| `ReviewAssignment` | Назначение эксперта | id, reviewId, reviewerId, role (`PRIMARY`, `ADVISORY`), assignedBy, assignedAt, status (`ACTIVE`, `REVOKED`, `COMPLETED`) |
| `ReviewChecklist` | Шаблон checklist | id, name, appliesTo (`TEST_VERSION`, `ITEM_VERSION`), items[] (code, text, mandatory), status |
| `ReviewChecklistAnswer` | Отметка пункта в конкретном review | reviewId, checklistItemCode, checked, note?, answeredBy |
| `ReviewComment` | Комментарий (поток) | id, reviewId, parentId?, authorId, anchor (subjectType/id, fieldPath?, sectionId?, itemVersionId?), body, createdAt |
| `ContentIssue` | Замечание, требующее устранения | id, reviewId, originCommentId, anchor, severity (`BLOCKING`, `MAJOR`, `MINOR`), status (`OPEN`, `ADDRESSED`, `RESOLVED`, `WONT_FIX`), raisedBy, addressedInVersionId?, resolvedBy? |

### 2.7 Delivery (только модель, вне MVP UI)

| Сущность | Назначение | Ключевые атрибуты |
|---|---|---|
| `Attempt` | Попытка прохождения | id, testVersionId (только `PUBLISHED` на момент старта), userId, attemptNo, status (`IN_PROGRESS`, `SUBMITTED`, `EXPIRED`, `ABANDONED`), seed, startedAt, submittedAt, deadlineAt, deliveredItems (snapshot порядка: sectionId, itemVersionId, optionOrder) |
| `Response` | Ответ на вопрос | id, attemptId, itemVersionId, payload (по responseSchema), answeredAt, timeSpentMs |
| `ResponseEvaluation` | Оценка ответа | id, responseId, method (`AUTO`, `MANUAL`), score, maxScore, evaluatorId?, evaluatedAt, details |
| `Result` | Итог попытки | id, attemptId, score, maxScore, passed?, sectionScores, computedAt |

### 2.8 Analytics (зарезервировано, вне MVP)

| Сущность | Назначение |
|---|---|
| `ItemStatistics` | По `ItemVersion`: число ответов, p-value (трудность), discrimination, частоты по `ItemOption.key` (дистракторы), среднее время |
| `TestStatistics` | По `TestVersion`: число попыток, распределение баллов, надежность (alpha), среднее время |

Аналитика возможна потому, что `Response` ссылается на неизменяемую `ItemVersion` и стабильные `ItemOption.key` (INV-008).

> Все архивируемые сущности (см. SPEC-AUDIT-002) дополнительно имеют `archivedAt`, `archivedBy`, `archiveReason`.

## 3. Связи

```
User ─< UserRole >─ Role ─< RolePermission >─ Permission
User ─< AuditLog (actor)

Subject ─< Course ─< Topic ─< Topic (parent) ─< LearningObjective
Course ─< StudentGroup ─< GroupMembership >─ User
Course ─< Assignment ─< AssignmentTarget (User | StudentGroup)
Assignment >─< Topic, LearningObjective, QuestionType (allowed)

QuestionType ─< QuestionTypeVersion
Item ─< ItemVersion ─< ItemOption, ItemMedia, ItemTag
Item >─ QuestionType;  ItemVersion >─ QuestionTypeVersion
Item >─ Assignment (опционально);  ItemVersion >─< Topic, LearningObjective
ItemOption >─ MediaAsset;  ItemMedia >─ MediaAsset

Test >─ Assignment (опционально)
Test ─< TestVersion ─< Section ─< TestSectionItem >─ ItemVersion
                              └─< SelectionRule ─< SelectionPoolEntry >─ ItemVersion

Review >─ (TestVersion | ItemVersion);  Review ─< ReviewAssignment >─ User
Review ─< ReviewComment ─< ReviewComment;  Review ─< ContentIssue;  Review ─< ReviewChecklistAnswer

Attempt >─ TestVersion;  Attempt ─< Response >─ ItemVersion;  Response ─< ResponseEvaluation;  Attempt ─ Result
```

## 4. Агрегаты (границы транзакционной согласованности)

| Агрегат | Корень | Включает | Почему |
|---|---|---|---|
| User | `User` | UserRole | Роли меняются вместе с проверкой BR-015/BR-016 |
| Role | `Role` | RolePermission | |
| Assignment | `Assignment` | AssignmentTarget, DeadlineExtension | |
| MediaAsset | `MediaAsset` | MediaDerivative | |
| QuestionType | `QuestionType` | QuestionTypeVersion | |
| ItemVersion | `ItemVersion` | ItemOption, ItemMedia, ItemTag | Версия валидируется и замораживается целиком |
| TestVersion | `TestVersion` | Section, TestSectionItem, SelectionRule, SelectionPoolEntry | То же |
| Review | `Review` | ReviewAssignment, ReviewComment, ContentIssue, ReviewChecklistAnswer | Решение проверяет checklist и issues атомарно |
| Attempt | `Attempt` | Response, ResponseEvaluation, Result | |

`Item` и `Test` — легкие корни-идентичности; их указатели (`currentDraftVersionId`, `publishedVersionId`)
изменяются доменными сервисами вместе с переходами состояний версий в одной транзакции.

## 5. Доменные инварианты

Инварианты — не на усмотрение разработчика. Каждый проверяется в domain layer и покрывается тестами.

| ID | Инвариант | BR |
|---|---|---|
| INV-001 | `TestVersion.state ∈ {READY_FOR_REVIEW, IN_REVIEW, CHANGES_REQUESTED, APPROVED, PUBLISHED, ARCHIVED}` ⇒ содержимое версии (включая Section, TestSectionItem, SelectionRule) не изменяется | BR-002, BR-007 |
| INV-002 | То же для `ItemVersion` (включая ItemOption, ItemMedia, ItemTag) | BR-006, BR-007 |
| INV-003 | Решение `approve` / `request_changes` по Review принимает пользователь, не входящий в `authorIds` и не являющийся `ownerId` объекта: `author ≠ reviewer` | BR-001, BR-027 |
| INV-004 | `state = PUBLISHED` достижимо только из `APPROVED` | BR-008 |
| INV-005 | У `Test` не более одной версии в `PUBLISHED`; не более одной в `DRAFT` (у `Item` — не более одной `DRAFT`) | BR-009, BR-041 |
| INV-006 | `TestSectionItem` и `SelectionPoolEntry` ссылаются на `ItemVersion`, а не на `Item` | BR-010 |
| INV-007 | `TestVersion` в `APPROVED`/`PUBLISHED` ссылается только на `ItemVersion` в `APPROVED`, а медиа во всех ее вопросах имеют `rightsStatus = CLEARED` | BR-011, BR-024 |
| INV-008 | `ItemOption.key` стабилен между версиями одного `Item`: вариант, перенесенный в новую версию, сохраняет key; новый вариант получает новый key; key не переиспользуется | — (аналитика) |
| INV-009 | `Item.questionTypeId` не меняется после создания | BR-019 |
| INV-010 | `ItemVersion.content` валидно по `QuestionTypeVersion.contentSchema`, на которую она ссылается | BR-020 |
| INV-011 | Используемый контент (на который ссылается любая не-DRAFT версия или Attempt) не удаляется физически | BR-005, BR-026 |
| INV-012 | `Attempt.testVersionId` указывает на версию, бывшую `PUBLISHED` в момент `startedAt`; ссылка не меняется | BR-037 |
| INV-013 | `AuditLog` — только вставка | BR-034 |
| INV-014 | В системе всегда есть хотя бы один `ACTIVE` пользователь с ролью `ADMIN` | BR-016 |
| INV-015 | Тип вопроса определяет schema, interaction, response format и evaluation method; Item не может переопределить их | BR-020, BR-023 |

## 6. Глоссарий

| Термин | Определение |
|---|---|
| Owner | Пользователь, создавший объект; основной автор |
| Author(s) | `authorIds` версии — owner + соавторы (в MVP соавторов добавляет только owner для Teacher; у студентов author = owner) |
| Assigned (scope) | Объект относится к заданию, которое ведет пользователь, или к review, на который он назначен (см. permission-model) |
| Content-frozen | Содержимое версии больше не изменяется (с момента отправки на review) |
| Pinning | Ссылка на конкретную версию, а не на «последнюю» |
| Pool freeze | Фиксация списка кандидатов SelectionRule в момент approve |
| Primary reviewer | Эксперт, принимающий решение по review (в MVP — один) |
| Advisory reviewer | Эксперт, который только комментирует |
| Withdraw | Отзыв опубликованной версии: PUBLISHED → ARCHIVED с причиной `WITHDRAWN` |
| Superseded | Опубликованная версия, замененная публикацией новой: PUBLISHED → ARCHIVED с причиной `SUPERSEDED` |
