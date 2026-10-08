# SPEC-AUTH-002: Сессия и выход

| Поле | Значение |
|---|---|
| Блок | BL-01 |
| Requirements | FR-AUTH-002, FR-AUTH-003, NFR-SEC-003, NFR-SEC-004 |
| Scenarios | SC-AUTH-002 |
| Business rules | BR-014 |
| Domain entities | Session, AuditLog |
| Permissions | — (собственная сессия) |
| ADR | ADR-006 |
| Статус | Draft |

## Purpose
Обеспечить ограниченное время жизни сессий и их немедленный отзыв.

## Actors
Аутентифицированный пользователь; система (истечение); Admin (косвенно — блокировка).

## Preconditions
Активная сессия.

## Input
Нет (cookie сессии).

## Business rules
BR-014 — блокировка отзывает все сессии.

## Main scenario
1. Каждый запрос: загрузить Session; проверить `revokedAt`, idle (30 мин) и absolute (12 ч) timeout; проверить статус пользователя `ACTIVE`.
2. Обновить `lastSeenAt` (не чаще раза в минуту).
3. Logout: `revokedAt = now`, cookie очищается, аудит `auth.logout`.

## Alternative scenarios
* A1 Сессия истекла/отозвана → 401 / редирект на вход; несохраненные изменения формы не сохраняются (UI предупреждает при уходе со страницы).
* A2 Пользователь заблокирован при активной сессии → следующий запрос отклоняется.
* A3 Изменяющий запрос без валидного CSRF-токена/Origin → 403.

## Data changes
Session (lastSeenAt, revokedAt), AuditLog (logout).

## Authorization
Только владелец сессии может ее завершить. Admin отзывает сессии косвенно (блокировка, сброс пароля).

## UI behavior (AdminJS)
Кнопка «Выйти» в шапке AdminJS.

## Acceptance criteria
| ID | Критерий | Тип |
|---|---|---|
| AC-AUTH-002.1 | После logout повтор запроса со старым cookie → 401 | negative |
| AC-AUTH-002.2 | Сессия без активности > idle timeout недействительна | negative |
| AC-AUTH-002.3 | Сессия старше absolute timeout недействительна при любой активности | negative |
| AC-AUTH-002.4 | Блокировка пользователя делает недействительными все его сессии немедленно | negative |
| AC-AUTH-002.5 | Изменяющий запрос без CSRF-защиты отклоняется | security |
