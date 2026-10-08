# SPEC-ITEM-002: Редактирование, версии, отправка, архивирование вопроса

| Поле | Значение |
|---|---|
| Блок | BL-07 |
| Requirements | FR-ITEM-003, FR-ITEM-004, FR-ITEM-008, FR-ITEM-009, FR-ITEM-010, NFR-DATA-001, NFR-DATA-003 |
| Scenarios | SC-ITEM-003, SC-ITEM-006, SC-ITEM-007, SC-VERSION-001, SC-VERSION-002 |
| Business rules | BR-003, BR-004, BR-005, BR-006, BR-007, BR-019, BR-020, BR-024, BR-025, BR-038, BR-039, BR-041, BR-044 |
| Domain entities | Item, ItemVersion, ItemOption, Review |
| Permissions | `item.update`, `item.submit`, `item.archive` |
| ADR | ADR-002 |
| Статус | Draft |

## Purpose
Обеспечить управляемое изменение вопросов: правки только в черновике, неизменность отправленных и утвержденных версий, прослеживаемую историю.

## Actors
Owner (Student, Teacher), Admin.

## Preconditions
Item существует, ACTIVE.

## Input
* edit: поля SPEC-ITEM-001 (кроме типа) + `revision`.
* createNewVersion: sourceVersionId.
* submit / recall: versionId; для standalone review — reviewer (опционально).
* archive / restore: reason.

## Business rules
BR-004, BR-006, BR-007, BR-019 (тип неизменен), BR-041 (один DRAFT), BR-003, BR-038, BR-044, BR-005, BR-039.

## Main scenario
**Редактирование:** 1) проверка state = DRAFT, actor = owner (или Admin, `item.update` ANY); 2) проверка revision; 3) сохранение; 4) аудит с diff.

**Новая версия:** 1) источник в CHANGES_REQUESTED/APPROVED/PUBLISHED-контексте (любое не-DRAFT состояние, кроме ARCHIVED (DISCARDED)); 2) проверка отсутствия DRAFT; 3) копирование содержимого, ItemOption.key сохраняются (INV-008); questionTypeVersionId = текущая версия типа; 4) versionNo = max+1, basedOnVersionId; 5) **auto-rebind**: DRAFT TestVersion того же автора, ссылающиеся на предыдущую версию этого Item, перепривязываются на новую DRAFT (аудит по каждому тесту); 6) открытые ContentIssue предыдущего review связываются с новой версией.

**Standalone submit (FR-ITEM-009):** 1) полная валидация: BR-020 (schema + validate), BR-025 (alt text), BR-024 (все медиа CLEARED — проверяется при submit, чтобы не отправлять заведомо неутверждаемое, и повторно при approve); 2) DRAFT → READY_FOR_REVIEW, contentHash; 3) Review(subjectType ITEM_VERSION) + ReviewAssignment (SPEC-REVIEW-001); 4) аудит.

**Recall:** только из READY_FOR_REVIEW до начала review (BR-038).

**Discard:** DRAFT, никогда не отправлявшийся и без ссылок из не-DRAFT тестов → hard delete версии (и Item, если это v1) с аудитом (BR-044); иначе → ARCHIVED (DISCARDED).

**Archive/Restore Item:** см. lifecycle §4; запрещено, если Item входит в READY_FOR_REVIEW/IN_REVIEW пакет теста другого автора.

**История/сравнение:** список версий с состояниями; diff двух версий (normalizeForHash плагина).

## Alternative scenarios
* A1 Редактирование не-DRAFT → `DENY(INVALID_STATE)`, UI предлагает «Создать новую версию».
* A2 Конфликт revision → 409, UI показывает актуальную версию и сохраняет локальные правки для повторного применения.
* A3 Новая версия при существующем DRAFT → отказ с ссылкой на черновик.
* A4 Submit с ошибками → список Issues, переход не выполнен.

## Data changes
ItemVersion (+дочерние), Item указатели, TestSectionItem (auto-rebind в черновиках), Review, ContentIssue (связь), AuditLog.

## Authorization
| Действие | Permission | Scope | State guard | Rule guards |
|---|---|---|---|---|
| edit | item.update | OWN / ANY | DRAFT | BR-019 |
| new version | item.update | OWN / ANY | не DRAFT, нет другого DRAFT | BR-041; для студента — задание не CLOSED |
| submit / recall | item.submit | OWN | DRAFT / READY_FOR_REVIEW | BR-020, BR-025, BR-038; студент — BR-017 (через тест, standalone submit студенту недоступен в MVP) |
| archive / restore | item.archive | OWN / ANY | — | BR-039 |

> Standalone submit вопроса — для Teacher/Admin (банк). Вопросы студентов попадают на экспертизу в составе теста.

## UI behavior (AdminJS)
Кнопки по `availableActions`: «Редактировать», «Создать новую версию», «Отправить на экспертизу», «Отозвать», «Архивировать»; вкладка «Версии» с diff; баннер «Версия N — утверждена, только чтение».

## Acceptance criteria
| ID | Критерий | Тип |
|---|---|---|
| AC-ITEM-002.1 | Владелец редактирует свой DRAFT; аудит с diff | positive |
| AC-ITEM-002.2 | Студент не может редактировать чужой DRAFT (404) | permission |
| AC-ITEM-002.3 | Никто (включая Admin) не может редактировать READY_FOR_REVIEW/IN_REVIEW/APPROVED версию | negative |
| AC-ITEM-002.4 | Новая версия: v(N+1) DRAFT, basedOn, option keys сохранены, исходная версия не изменилась (contentHash) | positive |
| AC-ITEM-002.5 | Второй DRAFT создать нельзя | negative |
| AC-ITEM-002.6 | Auto-rebind обновляет ссылку в DRAFT тесте автора и не трогает не-DRAFT тесты | positive |
| AC-ITEM-002.7 | Конфликт revision возвращает 409 без потери данных | concurrency |
| AC-ITEM-002.8 | Recall возможен до начала review и невозможен после | positive/negative |
| AC-ITEM-002.9 | Архивированный Item не добавляется в новые тесты; существующие тесты не затронуты | negative |
| AC-ITEM-002.10 | Hard delete возможен только для неотправлявшегося DRAFT без ссылок | negative |
