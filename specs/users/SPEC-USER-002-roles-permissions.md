# SPEC-USER-002: Роли и назначение ролей

| Поле | Значение |
|---|---|
| Блок | BL-02 |
| Requirements | FR-USER-004, FR-PERM-001, NFR-AUDIT-001, NFR-SEC-010 |
| Scenarios | SC-USER-002, SC-PERM-001 |
| Business rules | BR-015, BR-016, BR-035, BR-046 |
| Domain entities | Role, Permission, RolePermission, UserRole, AuditLog |
| Permissions | `role.read`, `role.manage`, `user.role.assign` |
| ADR | ADR-003 |
| Статус | Draft |

## Purpose
Управлять составом прав без изменения кода и с полной прозрачностью изменений.

## Actors
Admin.

## Preconditions
`role.manage` / `user.role.assign`.

## Input
| Поле | Тип | Обязательно | Валидация |
|---|---|---|---|
| role.code | string | да (create) | `^[A-Z_]{2,40}$`, уникален |
| role.name | string | да | 1–100 |
| permissions | {key, scope}[] | да | key из каталога; scope ∈ supportedScopes(key) |
| userId, roleIds | | да (assign) | существуют |

## Business rules
* BR-015 — нельзя менять свои роли.
* BR-016 — снятие ADMIN у последнего активного администратора запрещено.
* BR-046 — системные роли не удаляются; изменение их состава — журналируется.
* Каталог `Permission` — seed из кода; через UI не создается.

## Main scenario
1. Role create/update: валидация ключей и scope → сохранение RolePermission → аудит (до/после множества).
2. Assign: добавление/снятие UserRole → проверка BR-015/016 → аудит.
3. Изменения вступают в силу со следующего запроса пользователей (SPEC-AUTH-003, AC-AUTH-003.6).

## Alternative scenarios
* A1 Неподдерживаемый scope → ошибка.
* A2 Удаление роли, назначенной пользователям → отказ (сначала снять назначения); системной → отказ.

## Data changes
Role, RolePermission, UserRole, AuditLog.

## Authorization
`role.manage` ANY; `user.role.assign` ANY + BR-015, BR-016.

## UI behavior (AdminJS)
Ресурс «Роли» с матричным редактором permissions (сгруппированных по ресурсу) и выбором scope; на карточке пользователя — множественный выбор ролей.

## Acceptance criteria
| ID | Критерий | Тип |
|---|---|---|
| AC-USER-002.1 | Admin назначает роль; запись аудита содержит до/после | positive |
| AC-USER-002.2 | Пользователь не может изменить собственные роли (в т.ч. Admin) | negative |
| AC-USER-002.3 | Нельзя снять ADMIN у последнего активного администратора | negative |
| AC-USER-002.4 | Нельзя удалить системную роль | negative |
| AC-USER-002.5 | Неподдерживаемый scope permission отклоняется | negative |
| AC-USER-002.6 | Изменение состава роли журналируется (NFR-AUDIT-001) | audit |
| AC-USER-002.7 | Эксперт не может менять пользователей и роли | permission |
