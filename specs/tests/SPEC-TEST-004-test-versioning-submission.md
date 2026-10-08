# SPEC-TEST-004: Готовность, отправка на экспертизу, новые версии теста

| Поле | Значение |
|---|---|
| Блок | BL-08 (+ BL-10) |
| Requirements | FR-TEST-006, FR-TEST-007, FR-TEST-009, NFR-DATA-004, NFR-DATA-005 |
| Scenarios | SC-TEST-005, SC-VERSION-001, SC-E2E-001 (шаги 8, 9, 14) |
| Business rules | BR-002, BR-003, BR-007, BR-011, BR-012, BR-017, BR-020, BR-024, BR-025, BR-031, BR-032, BR-038, BR-041 |
| Domain entities | Test, TestVersion, ItemVersion, Review, ReviewAssignment, ContentIssue |
| Permissions | `test.submit`, `test.update` |
| ADR | ADR-002 |
| Статус | Ready |

## Purpose
Перевести тест на экспертизу в проверенном, замороженном виде и обеспечить цикл доработки через новые версии.

## Actors
Автор теста.

## Preconditions
TestVersion DRAFT (submit) / READY_FOR_REVIEW (recall) / не DRAFT (new version).

## Input
versionId; подтверждение отправки.

## Business rules
См. заголовок. Ключевые: BR-007 (заморозка), BR-031 (дедлайн), BR-032 (ограничения задания).

## Main scenario
**Проверка готовности (readiness check)** — также доступна как отдельное действие без отправки:
1. ≥ 1 раздел; каждый раздел содержит ≥ 1 вопрос или правило.
2. Все фиксированные ItemVersion: APPROVED, либо собственные DRAFT автора теста; каждая валидна (BR-020) и имеет alt text для изображений (BR-025); все медиа CLEARED (BR-024).
3. Правила: пул ≥ count (BR-012).
4. Задание: ACTIVE; дедлайн (для первой отправки) с учетом продления (BR-031); ограничения BR-032.
5. Результат — список Issues с указанием места.

**Submit:**
1. Readiness check без ERROR.
2. В одной транзакции: TestVersion → READY_FOR_REVIEW, contentHash, submittedAt; собственные DRAFT ItemVersion пакета → READY_FOR_REVIEW (contentHash); Test.currentDraftVersionId = null; Item.currentDraftVersionId = null для каскадных.
3. Review(TEST_VERSION) + ReviewAssignment(defaultReviewer задания, или выбранный автором из допустимых для теста вне задания) — SPEC-REVIEW-001.
4. Аудит.

**Recall:** BR-038; обратный каскад для вопросов пакета; Review → CANCELLED.

**Новая версия** (из CHANGES_REQUESTED, APPROVED, PUBLISHED):
1. Проверка BR-041; для теста задания при источнике CHANGES_REQUESTED — задание не CLOSED.
2. Копия: разделы, настройки, правила (без пула), фиксированные ссылки.
3. Для каждого фиксированного вопроса, принадлежащего автору и находящегося в CHANGES_REQUESTED: создается новая DRAFT ItemVersion (SPEC-ITEM-002 «Новая версия»), и ссылка в новой TestVersion указывает на нее; вопросы в APPROVED остаются pinned как есть.
4. Открытые/адресованные ContentIssue предыдущего review связываются с новой версией (FR-REVIEW-009).
5. Аудит.

## Alternative scenarios
* A1 Readiness ERROR → submit не выполняется; UI ведет к месту ошибки.
* A2 Дедлайн истек для первой отправки → отказ BR-031.
* A3 Вопрос пакета чужой и не APPROVED → отказ (BR-011).

## Data changes
TestVersion, ItemVersion (каскад), Test/Item указатели, Review, ReviewAssignment, ContentIssue, AuditLog — атомарно.

## Authorization
`test.submit` OWN; `test.update` OWN/ANY для новой версии; rule guards — см. выше.

## UI behavior (AdminJS)
Кнопки «Проверить готовность», «Отправить на экспертизу», «Отозвать», «Создать новую версию»; на CHANGES_REQUESTED — панель замечаний.

## Acceptance criteria
| ID | Критерий | Тип |
|---|---|---|
| AC-TEST-004.1 | Submit замораживает TestVersion и собственные DRAFT ItemVersion; создается Review с назначением | positive |
| AC-TEST-004.2 | После submit изменить версию нельзя никому (прямой запрос) | negative |
| AC-TEST-004.3 | Submit с невалидным вопросом/без alt/с PENDING медиа отклоняется со списком причин | negative |
| AC-TEST-004.4 | Число вопросов вне [min,max] или неразрешенный тип → отказ (BR-032) | negative |
| AC-TEST-004.5 | Первая отправка после дедлайна → отказ (BR-031) | negative |
| AC-TEST-004.6 | Recall до начала review возвращает DRAFT; после — невозможен | positive/negative |
| AC-TEST-004.7 | Новая версия после CHANGES_REQUESTED: v2 DRAFT, вопросы автора в CHANGES_REQUESTED получили новые DRAFT-версии, v1 неизменна | positive |
| AC-TEST-004.8 | Все изменения submit атомарны: сбой на любом шаге не оставляет частичных изменений | data |
