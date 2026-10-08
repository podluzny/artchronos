# SPEC-AUDIT-001: Журнал аудита

| Поле | Значение |
|---|---|
| Блок | BL-11 |
| Requirements | FR-AUDIT-001, FR-AUDIT-002, NFR-AUDIT-001…005 |
| Scenarios | SC-AUDIT-001, SC-E2E-001 (шаг 18) |
| Business rules | BR-034, BR-035 |
| Domain entities | AuditLog |
| Permissions | `audit.read` |
| Статус | Draft |

## Purpose
Обеспечить ответ на вопрос «кто, когда, что и почему изменил» для всех значимых действий.

## Actors
Система (запись); Admin (чтение).

## Preconditions
—

## Input
Запись: actorId (null для системы), actorRoles snapshot, action (`<resource>.<verb>`), resourceType, resourceId, changes {before, after} (только измененные поля; секреты маскируются), reason?, requestId, ip, userAgent, occurredAt.

## Business rules
BR-034 (append-only), BR-035 (атомарность).

## Main scenario
1. Application layer после изменения агрегата вызывает `AuditWriter.record(...)` в той же транзакции.
2. События аутентификации (вход/неудача/выход) записываются отдельной транзакцией (нет бизнес-изменения).
3. Каталог действий: `user.*`, `role.*`, `auth.*`, `taxonomy.*`, `group.*`, `assignment.*`, `media.*`, `qtype.*`, `item.*`, `test.*`, `review.*`, `issue.*`, `checklist.*`.
4. Просмотр: фильтры actor, resourceType, resourceId, action, период; детальный просмотр diff.
5. Права БД: роль приложения — INSERT/SELECT на таблицу аудита; UPDATE/DELETE отозваны (NFR-AUDIT-003).

## Alternative scenarios
* A1 Сбой записи аудита → откат бизнес-операции (NFR-AUDIT-005).

## Data changes
AuditLog (insert).

## Authorization
`audit.read` ANY (Admin). Изменение/удаление записей — не существует как действие.

## UI behavior (AdminJS)
Read-only ресурс «Журнал аудита»; actions new/edit/delete отключены; компонент diff.

## Acceptance criteria
| ID | Критерий | Тип |
|---|---|---|
| AC-AUDIT-001.1 | Каждый use case изменения создает запись с actor, action, resource, diff | audit |
| AC-AUDIT-001.2 | Изменение ролей/permissions/статуса пользователя журналируется (NFR-AUDIT-001) | audit |
| AC-AUDIT-001.3 | Попытка изменить/удалить запись через приложение невозможна; через SQL под ролью приложения — отказ | security |
| AC-AUDIT-001.4 | Сбой записи аудита откатывает операцию | data |
| AC-AUDIT-001.5 | Пароли, hash, токены не попадают в changes | security |
| AC-AUDIT-001.6 | Не-Admin не имеет доступа к журналу | permission |
