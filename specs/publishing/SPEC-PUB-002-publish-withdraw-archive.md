# SPEC-PUB-002: Публикация, отзыв, архивирование теста

| Поле | Значение |
|---|---|
| Блок | BL-10 |
| Requirements | FR-PUB-002, FR-PUB-003, FR-PUB-004, FR-PUB-005 |
| Scenarios | SC-PUBLISH-001, SC-PUBLISH-002, SC-PUBLISH-003, SC-E2E-001 (шаг 17) |
| Business rules | BR-005, BR-008, BR-009, BR-036, BR-039 |
| Domain entities | Test, TestVersion, Attempt (ссылочно), AuditLog |
| Permissions | `test.publish`, `test.withdraw`, `test.archive` |
| Статус | Ready |

## Purpose
Сделать утвержденную версию доступной для прохождения (в будущем Runner), управлять отзывом и архивом без потери данных.

## Actors
Admin (публикация, отзыв); owner/Admin (архив).

## Preconditions
Publish: TestVersion APPROVED, Test ACTIVE. Withdraw: PUBLISHED. Archive: Test без PUBLISHED версии.

## Input
versionId; reason (обязателен для withdraw и archive).

## Business rules
BR-008, BR-009, BR-036, BR-005, BR-039.

## Main scenario
**Publish:** 1) проверка APPROVED; 2) транзакция: текущая PUBLISHED (если есть) → ARCHIVED (SUPERSEDED); версия → PUBLISHED (publishedAt/By); Test.publishedVersionId; аудит `test.published` (+ `test.superseded`).
**Withdraw:** PUBLISHED → ARCHIVED (WITHDRAWN, reason); Test.publishedVersionId = null; аудит. Attempts не меняются.
**Archive Test:** нет PUBLISHED → Test.status = ARCHIVED; DRAFT → ARCHIVED (CONTAINER_ARCHIVED); аудит. **Restore:** → ACTIVE.
**История публикаций:** список событий publish/supersede/withdraw по тесту из AuditLog (и полей версий).

## Alternative scenarios
* A1 Publish не-APPROVED → отказ (BR-008).
* A2 Archive при PUBLISHED → отказ «сначала отзовите публикацию».
* A3 Publish у архивированного Test → отказ.

## Data changes
TestVersion.state, Test.publishedVersionId/status, AuditLog.

## Authorization
`test.publish` ANY, `test.withdraw` ANY (Admin по умолчанию), `test.archive` OWN/ANY.

## UI behavior (AdminJS)
Actions «Опубликовать» (подтверждение с указанием, какая версия будет заменена), «Отозвать публикацию» (обязательная причина), «Архивировать/Восстановить»; вкладка «Публикации».

## Acceptance criteria
| ID | Критерий | Тип |
|---|---|---|
| AC-PUB-002.1 | Admin публикует APPROVED версию | positive |
| AC-PUB-002.2 | Публикация не-APPROVED версии отклоняется | negative |
| AC-PUB-002.3 | Публикация новой версии архивирует предыдущую (SUPERSEDED); в любой момент ≤ 1 PUBLISHED | positive |
| AC-PUB-002.4 | Withdraw без причины отклоняется; с причиной — версия ARCHIVED (WITHDRAWN) | negative/positive |
| AC-PUB-002.5 | Teacher/Student не могут публиковать (прямой запрос) | permission |
| AC-PUB-002.6 | Физическое удаление опубликованной/архивированной версии невозможно | negative |
| AC-PUB-002.7 | Архив теста с PUBLISHED версией отклоняется | negative |
