# SPEC-REVIEW-003: Решения экспертизы: вернуть на доработку, принять

| Поле | Значение |
|---|---|
| Блок | BL-09 (+ BL-10) |
| Requirements | FR-REVIEW-007, FR-REVIEW-008 |
| Scenarios | SC-REVIEW-002, SC-REVIEW-003, SC-E2E-001 (шаги 12, 13, 15) |
| Business rules | BR-001, BR-011, BR-012, BR-024, BR-028, BR-029, BR-030, BR-040 |
| Domain entities | Review, TestVersion, ItemVersion, SelectionPoolEntry, ContentIssue |
| Permissions | `review.perform` |
| ADR | ADR-002 |
| Статус | Ready |

## Purpose
Принять решение по версии и применить его атомарно ко всему пакету.

## Actors
Primary reviewer.

## Preconditions
Review IN_PROGRESS; версия IN_REVIEW; actor — активный PRIMARY.

## Input
decision (`REQUEST_CHANGES` / `APPROVE`), summary (обязателен для REQUEST_CHANGES, если нет OPEN issues).

## Business rules
* BR-001 — actor ∉ authors объекта и вопросов пакета (для вопросов пакета — если actor автор какого-либо вопроса пакета, approve отклоняется).
* BR-029 — REQUEST_CHANGES требует ≥ 1 OPEN issue или summary.
* BR-028 — APPROVE требует обязательный checklist и отсутствие OPEN/ADDRESSED BLOCKING issues.
* BR-011, BR-012, BR-024 — повторная проверка пакета на момент решения.

## Main scenario
**Request changes:**
1. Проверки BR-001, BR-029, BR-030.
2. Транзакция: Review → CHANGES_REQUESTED (decidedBy/At, summary); TestVersion → CHANGES_REQUESTED; ItemVersion пакета в READY_FOR_REVIEW/IN_REVIEW (каскадные) → CHANGES_REQUESTED; аудит.
3. Автор видит результат в своем тесте/задании.

**Approve:**
1. Проверки BR-001, BR-028, BR-030.
2. Пакет: все фиксированные ItemVersion APPROVED или каскадные в IN_REVIEW; все медиа CLEARED (BR-024); пулы ≥ count (BR-012).
3. Транзакция: каскадные ItemVersion → APPROVED (approvedBy/At), Item.latestApprovedVersionId; TestVersion → APPROVED; для каждого SelectionRule — создание SelectionPoolEntry (пул на момент решения); Review → APPROVED; аудит.
4. Для standalone ItemVersion — то же без теста.

## Alternative scenarios
* A1 Нарушения BR-028 → отказ со списком незакрытых пунктов/issues.
* A2 Медиа потеряло CLEARED → отказ со списком.
* A3 Пул уменьшился ниже count (вопросы архивированы) → отказ.
* A4 Конкурентное решение/переназначение → проверка revision Review; второй запрос отклоняется.

## Data changes
Review, TestVersion, ItemVersion, Item, SelectionPoolEntry, AuditLog — атомарно.

## Authorization
`review.perform` ASSIGNED, роль PRIMARY; rule guards BR-001, BR-030.

## UI behavior (AdminJS)
Кнопки «Вернуть на доработку» / «Принять» на странице Review, доступны по `availableActions`; перед «Принять» — сводка проверок.

## Acceptance criteria
| ID | Критерий | Тип |
|---|---|---|
| AC-REVIEW-003.1 | Request changes переводит тест и вопросы пакета в CHANGES_REQUESTED; Review закрыт | positive |
| AC-REVIEW-003.2 | Request changes без issue и summary отклоняется | negative |
| AC-REVIEW-003.3 | Approve с незаполненным обязательным checklist отклоняется | negative |
| AC-REVIEW-003.4 | Approve при открытом BLOCKING issue отклоняется | negative |
| AC-REVIEW-003.5 | Автор (включая Admin-автора, назначившего себя) не может approve/request changes | negative |
| AC-REVIEW-003.6 | Approve переводит тест и каскадные вопросы в APPROVED и замораживает пулы | positive |
| AC-REVIEW-003.7 | Approve с медиа не CLEARED отклоняется | negative |
| AC-REVIEW-003.8 | ADVISORY не может принять решение | permission |
| AC-REVIEW-003.9 | Студент не может approve (прямой запрос) | permission |
