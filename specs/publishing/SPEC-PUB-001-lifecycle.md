# SPEC-PUB-001: Жизненный цикл версий

| Поле | Значение |
|---|---|
| Блок | BL-10 |
| Requirements | FR-PUB-001, NFR-DATA-001, NFR-DATA-004 |
| Scenarios | все сценарии с переходами состояний |
| Business rules | BR-002, BR-006, BR-007, BR-008, BR-013, BR-041 |
| Domain entities | TestVersion, ItemVersion, Test, Item, Review |
| Permissions | по переходам (lifecycle-state-machine §3) |
| ADR | ADR-002 |
| Статус | Ready |

## Purpose
Единая, исполняемая state machine для версий, которую не может обойти ни UI, ни администратор.

## Actors
Все участники workflow.

## Preconditions
—

## Input
(version, transition, actor, params).

## Business rules
BR-013 — только переходы из таблицы `docs/lifecycle-state-machine.md` §3; guards каждого перехода.

## Main scenario
1. Domain: `VersionStateMachine.transition(version, action, ctx)` → новый state или `DomainError(INVALID_TRANSITION | GUARD_<BR>)`.
2. Application: каждый переход — use case с авторизацией, guards, побочными эффектами и аудитом в одной транзакции.
3. Persistence: триггер БД запрещает изменение содержимого не-DRAFT версий (ADR-002) и запрещает изменение `state` вне допустимых пар (дублирующая защита).
4. UI: `availableActions` = переходы, для которых `authorize` и guards (без побочных эффектов) дают ALLOW.

## Alternative scenarios
* A1 Запрещенный переход → 409 `INVALID_TRANSITION`.

## Data changes
См. переходы.

## Authorization
По переходу.

## UI behavior (AdminJS)
Бейдж состояния; лента статусов (timeline) версии; кнопки только доступных переходов.

## Acceptance criteria
| ID | Критерий | Тип |
|---|---|---|
| AC-PUB-001.1 | Для каждой пары (state, action) вне таблицы переходов — отказ (параметризованный тест полного декартова произведения) | negative |
| AC-PUB-001.2 | Для каждого допустимого перехода — успех при выполненных guards | positive |
| AC-PUB-001.3 | Прямой UPDATE содержимого APPROVED версии в БД отклоняется триггером | data |
| AC-PUB-001.4 | Admin не может выполнить запрещенный переход (например, DRAFT → APPROVED) | negative |
| AC-PUB-001.5 | `availableActions` совпадает с множеством переходов, разрешенных сервером | consistency |
