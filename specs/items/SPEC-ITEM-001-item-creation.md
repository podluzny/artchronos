# SPEC-ITEM-001: Создание вопроса

| Поле | Значение |
|---|---|
| Блок | BL-07 |
| Requirements | FR-ITEM-001, FR-ITEM-002, FR-ITEM-005 |
| Scenarios | SC-ITEM-001, SC-ITEM-002, SC-E2E-001 (шаги 4–6) |
| Business rules | BR-017, BR-018, BR-019, BR-020, BR-021, BR-024, BR-025, BR-039, BR-004 |
| Domain entities | Item, ItemVersion, ItemOption, ItemMedia, ItemTag, QuestionType, QuestionTypeVersion, Assignment, MediaAsset |
| Permissions | `item.create` |
| ADR | ADR-001, ADR-002, ADR-005 |
| Статус | Ready |

## Purpose
Позволить автору (студенту в рамках задания или преподавателю для банка) создать вопрос, структура которого
определяется типом, и получить черновую версию, принадлежащую автору.

## Actors
Student, Teacher, Admin.

## Preconditions
Пользователь:
* авторизован;
* имеет `item.create`;
* (Student) находится в активном Assignment, адресованном ему.

## Input
| Поле | Тип | Обязательно | Валидация |
|---|---|---|---|
| assignment | Assignment | Student — да; Teacher — нет | ACTIVE, адресовано actor (BR-017) |
| course | Course | да (выводится из assignment) | в scope |
| questionType | QuestionType | да | ACTIVE (BR-021); ∈ allowedQuestionTypes задания (BR-018) |
| stem | rich text | да для submit | санитизация, ≤ 5000 |
| options | ItemOption[] | по типу | роли и количество — по plugin/config |
| media (stimulus/illustration) | MediaAsset[] | по типу | ACTIVE, не RESTRICTED (BR-039) |
| content | JSON | по типу | contentSchema |
| answerKey | JSON | для submit | answerKeySchema + validate |
| topics | Topic[] | да для submit (≥1) | активные; для студента — темы задания и их подтемы |
| learningObjectives | LearningObjective[] | нет | принадлежат выбранным темам |
| tags | Tag[] | нет | |
| difficulty | 1–5 | нет (по умолчанию 3) | |
| defaultPoints | number | да (по умолчанию 1) | > 0, ≤ 100 |
| feedback | rich text | нет | санитизация |

## Business rules
* BR-019 — тип обязателен и неизменен (ранее BR-ITEM-001).
* BR-020 — поля и валидность определяются schema типа (ранее BR-ITEM-002).
* BR-004 — черновик редактируется владельцем (ранее BR-ITEM-003; см. SPEC-ITEM-002).
* BR-006 — approved version не редактируется (ранее BR-ITEM-004; см. SPEC-ITEM-002).
* BR-017, BR-018, BR-021 — ограничения задания и активности типа.
* BR-024, BR-025 — в черновике допустимы медиа PENDING и отсутствие alt (с предупреждениями); блокируют submit.

## Main scenario
1. Пользователь выбирает Create Item (из задания — для студента).
2. Выбирает Question Type (список: ACTIVE ∩ allowed задания).
3. Система загружает schema данного типа (текущая QuestionTypeVersion) и описание плагина.
4. AdminJS показывает соответствующую форму (Editor плагина внутри общей оболочки).
5. Пользователь заполняет данные.
6. Система валидирует: структурная валидация JSON всегда; полная (schema + validate) — с результатом в виде списка Issues (ERROR блокирует только submit).
7. Создается Item (questionTypeId, ownerId = actor, assignmentId?, courseId, status ACTIVE).
8. Создается ItemVersion v1 = DRAFT (questionTypeVersionId = текущая; authorIds = [actor]); ItemOption получают новые key.
9. Автор становится owner. `Item.currentDraftVersionId` установлен. Аудит `item.created`.

## Alternative scenarios
* A1 Тип не разрешен заданием / неактивен → отказ (прямой запрос) — BR-018/BR-021.
* A2 Задание не ACTIVE или не адресовано → отказ (BR-017).
* A3 Невалидная структура JSON (не соответствует базовой форме, например options не массив) → сохранение отклоняется.
* A4 Нарушение schema (например, нет верного варианта) → черновик сохраняется, Issues отображаются, submit заблокирован.
* A5 Выбран архивированный/RESTRICTED MediaAsset → отказ (BR-039).
* A6 Создание из теста (SC-TEST-002) → после создания вопрос добавляется в черновик теста.

## Data changes
Item, ItemVersion, ItemOption, ItemMedia, ItemTag, связи с Topic/LearningObjective; AuditLog.

## Authorization
`item.create` (OWN). Rule guards: BR-017, BR-018 (для Student — всегда; для Teacher — если указан assignment), BR-021.
Поля ownerId, authorIds, state, questionTypeVersionId из payload игнорируются.

## UI behavior (AdminJS)
* Action «Создать вопрос» на ресурсе «Вопросы» и в карточке задания.
* Шаг 1 — выбор типа (карточки с описанием); шаг 2 — редактор плагина.
* Для `single_choice` — редактор вариантов с отметкой верного; для `image_choice` — медиа-пикер у каждого варианта и поле alt.
* Панель «Проверка» со списком Issues (ERROR/WARNING) и ссылками на поля.

## Acceptance criteria
| ID | Критерий | Тип |
|---|---|---|
| AC-ITEM-001.1 | После выбора single_choice отображаются варианты ответа | UI |
| AC-ITEM-001.2 | Для image_choice отображается выбор MediaAsset | UI |
| AC-ITEM-001.3 | Невалидная конфигурация не может быть сохранена (структурно) и не может быть отправлена (по schema) | negative |
| AC-ITEM-001.4 | После сохранения создается Draft version v1, owner = автор | positive |
| AC-ITEM-001.5 | Пользователь без item.create не может вызвать action создания (403 при прямом вызове) | permission |
| AC-ITEM-001.6 | Студент не может создать вопрос типа, не разрешенного заданием (прямой запрос) | negative |
| AC-ITEM-001.7 | Студент не может создать вопрос вне активного адресованного задания | negative |
| AC-ITEM-001.8 | Переданные в payload ownerId/state игнорируются | security |
| AC-ITEM-001.9 | Архивированное или RESTRICTED медиа нельзя выбрать | negative |
