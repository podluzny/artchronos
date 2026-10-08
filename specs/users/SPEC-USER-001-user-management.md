# SPEC-USER-001: Управление пользователями

| Поле | Значение |
|---|---|
| Блок | BL-02 |
| Requirements | FR-USER-001, FR-USER-002, FR-USER-003, FR-USER-005, FR-USER-006, NFR-AUDIT-001 |
| Scenarios | SC-USER-001, SC-USER-003 |
| Business rules | BR-005, BR-014, BR-015, BR-016, BR-035 |
| Domain entities | User, UserRole, GroupMembership, Session, AuditLog |
| Permissions | `user.read`, `user.create`, `user.update`, `user.status.manage` |
| Статус | Draft |

## Purpose
Ведение учетных записей всех участников без потери истории и без возможности оставить систему без администратора.

## Actors
Admin; Teacher (чтение студентов своих курсов); любой пользователь (свой профиль).

## Preconditions
Аутентификация; соответствующие permissions.

## Input
| Поле | Тип | Обязательно | Валидация |
|---|---|---|---|
| email | string | да | формат, уникальность (case-insensitive) |
| displayName | string | да | 1–200 |
| roles | Role[] | да (≥1) | существующие роли |
| groups | StudentGroup[] | нет | только для STUDENT |
| initialMode | `INVITE` / `TEMP_PASSWORD` | да | |
| status change reason | string | при блокировке/архиве | 1–500 |

## Business rules
* BR-014 — блокировка/архив отзывает сессии.
* BR-015 — нельзя менять свои роли и статус.
* BR-016 — последний активный Admin защищен.
* BR-005 — пользователь не удаляется физически, только `ARCHIVED` (его контент и аудит ссылаются на него).

## Main scenario
1. Create: валидация → User (`INVITED` или `ACTIVE` + `mustChangePassword`) → UserRole → GroupMembership → токен активации → аудит.
2. Update: изменение displayName/email (Admin) или displayName (свой профиль) → аудит с diff.
3. Block/Unblock/Archive: проверка BR-015/016 → статус → отзыв сессий → аудит с причиной.
4. List: фильтры по роли, статусу, курсу, группе; поиск по email/имени; scope — `user.read`.

## Alternative scenarios
* A1 email занят → ошибка поля.
* A2 BR-015/BR-016 → отказ с кодом правила.
* A3 Восстановление из `ARCHIVED` → `BLOCKED` (затем явная разблокировка).

## Data changes
User, UserRole, GroupMembership, Session (revoke), AuditLog.

## Authorization
| Действие | Permission | Scope | Guards |
|---|---|---|---|
| list/show | user.read | COURSE / ANY | — |
| create | user.create | ANY | — |
| update (все поля) | user.update | ANY | — |
| update профиля | user.update | OWN | только displayName |
| block/unblock/archive | user.status.manage | ANY | BR-015, BR-016 |

## UI behavior (AdminJS)
Ресурс «Пользователи» через `DomainResource`; actions «Заблокировать», «Разблокировать», «Архивировать», «Сбросить пароль»; поле `passwordHash` никогда не отдается в UI; delete отключен.

## Acceptance criteria
| ID | Критерий | Тип |
|---|---|---|
| AC-USER-001.1 | Admin создает студента; пользователь в INVITED, получает ссылку активации; аудит | positive |
| AC-USER-001.2 | Дубликат email (разный регистр) отклоняется | negative |
| AC-USER-001.3 | Блокировка отзывает сессии; заблокированный не входит | positive |
| AC-USER-001.4 | Admin не может заблокировать себя (BR-015) | negative |
| AC-USER-001.5 | Нельзя заблокировать/архивировать последнего активного Admin (BR-016) | negative |
| AC-USER-001.6 | Физическое удаление пользователя невозможно | negative |
| AC-USER-001.7 | Expert/Student не может создавать и изменять пользователей | permission |
| AC-USER-001.8 | Teacher видит в списке только студентов своих курсов | permission |
