# SPEC-AUTH-003: Server-side authorization

| Поле | Значение |
|---|---|
| Блок | BL-02 |
| Requirements | FR-AUTH-006, FR-PERM-002, FR-PERM-003, FR-PERM-004, NFR-SEC-001, NFR-SEC-010, NFR-PERF-003, NFR-OBS-004 |
| Scenarios | все; явно SC-ITEM-005, SC-E2E-001 шаги 6, 9, 16 |
| Business rules | BR-001, BR-004, BR-013, BR-015 (как rule guards) |
| Domain entities | User, Role, Permission, UserRole, RolePermission |
| Permissions | каталог — docs/permission-model.md §3 |
| ADR | ADR-003, ADR-004 |
| Статус | Draft |

## Purpose
Единая точка принятия решений о доступе для всех use cases и для UI, исключающая обход через прямые запросы.

## Actors
Система (каждый запрос).

## Preconditions
Аутентифицированная сессия (SPEC-AUTH-002).

## Input
`actor` (из сессии), `permissionKey`, `resource` (опционально — для объектных проверок), `context` (для create: assignment и т.п.).

## Business rules
State guards и rule guards применяются при любом scope, включая ANY (BR-013). Список guards по permission — в спецификациях областей.

## Main scenario
1. На запрос строится `ActorContext`: userId, status, roles, `Map<permissionKey, maxScope>`. Кэш — на время запроса.
2. Use case вызывает `authorize(actor, permissionKey, resource)`:
   1. permission отсутствует → `DENY(NO_PERMISSION)`;
   2. scope не покрывает объект → `DENY(OUT_OF_SCOPE)`;
   3. state guard не выполнен → `DENY(INVALID_STATE)`;
   4. rule guard не выполнен → `DENY(RULE_<BR-ID>)`.
3. Query use cases получают `scopeFilter(actor, permissionKey)` и передают его репозиторию; репозиторий строит SQL-условие.
4. Для каждой отдаваемой записи вычисляется `availableActions` (тот же `authorize` без побочных эффектов).
5. AdminJS `isAccessible`/`isVisible` для ресурсов/actions вычисляются через `authorize` (без объекта — по наличию permission).

## Alternative scenarios
* A1 DENY на чтение объекта вне scope → 404 (не раскрываем существование).
* A2 DENY на изменение видимого объекта → 403 с кодом причины; UI показывает понятное сообщение.
* A3 Каждый DENY логируется (NFR-OBS-004) с actor, permission, resource, reason.

## Data changes
Нет (кроме логов).

## Authorization
Сам является механизмом авторизации. Каждый use case в реестре декларирует `requiredPermission`; use case без декларации не регистрируется (архитектурный тест).

## UI behavior (AdminJS)
Недоступные ресурсы скрыты из навигации; недоступные actions скрыты; поля, которые сервер не примет (owner, state, authorIds), только для чтения. Это удобство, не защита.

## Acceptance criteria
| ID | Критерий | Тип |
|---|---|---|
| AC-AUTH-003.1 | Для каждой ячейки матрицы permission-model §4: разрешенное действие выполняется, запрещенное → 403/404 — при прямом вызове application service | permission |
| AC-AUTH-003.2 | То же при прямом HTTP-вызове action AdminJS (подмена recordId/actionName) | permission |
| AC-AUTH-003.3 | Списки возвращают только объекты в scope; подсчет (`count`) соответствует фильтру | permission |
| AC-AUTH-003.4 | Чтение объекта вне scope → 404 | negative |
| AC-AUTH-003.5 | Admin со scope ANY получает отказ при нарушении BR (например, редактирование APPROVED, approve своего контента) | negative |
| AC-AUTH-003.6 | Изменение ролей пользователя применяется со следующего запроса без перелогина | positive |
| AC-AUTH-003.7 | Поля owner/state/authorIds/assignmentId, переданные в payload формы, игнорируются или отклоняются | security |
| AC-AUTH-003.8 | Все use cases декларируют permission (архитектурный тест) | maintainability |
