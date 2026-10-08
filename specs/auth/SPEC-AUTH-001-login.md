# SPEC-AUTH-001: Вход в систему

| Поле | Значение |
|---|---|
| Блок | BL-01 |
| Requirements | FR-AUTH-001, FR-AUTH-004, FR-AUTH-006, NFR-SEC-002, NFR-SEC-003, NFR-SEC-005 |
| Scenarios | SC-AUTH-001, SC-AUTH-003 |
| Business rules | BR-014, BR-035 |
| Domain entities | User, Session, AuditLog |
| Permissions | — (публичная операция) |
| ADR | ADR-006 |
| Статус | Ready |

## Purpose
Допустить в административный интерфейс только активных пользователей с верными учетными данными и создать
защищенную серверную сессию, из которой строится authorization context.

## Actors
Любой пользователь; внешний нарушитель (негативные сценарии).

## Preconditions
Нет активной сессии (при наличии — перенаправление в интерфейс).

## Input
| Поле | Тип | Обязательно | Валидация |
|---|---|---|---|
| email | string | да | trim, lower-case, ≤ 254 |
| password | string | да | ≤ 1024 (защита от DoS хэширования) |

## Business rules
* BR-014 — вход только для `ACTIVE`.
* BR-035 — успешный и неуспешный вход журналируются (без пароля).

## Main scenario
1. Пользователь отправляет форму входа AdminJS.
2. `authenticate` вызывает use case `AuthenticateUser(email, password, ip, userAgent)`.
3. Use case находит пользователя по email; при отсутствии — выполняет фиктивную проверку hash (выравнивание времени).
4. Проверяет `lockedUntil`; проверяет пароль (argon2id); проверяет `status = ACTIVE`.
5. Сбрасывает `failedLoginCount`, пишет `lastLoginAt`; при необходимости — rehash с новыми параметрами.
6. Регенерирует id сессии, создает `Session`, сохраняет `userId`.
7. Пишет `AuditLog(action = auth.login.success)`.
8. Если `mustChangePassword` — все ресурсы недоступны, кроме смены пароля (SPEC-AUTH-004).

## Alternative scenarios
* A1 Неверный email/пароль → `failedLoginCount++`; при достижении порога (5) — `lockedUntil = now + 15 мин`; ответ — общее сообщение; аудит `auth.login.failure` (reason внутренний).
* A2 Статус не `ACTIVE` → общее сообщение; аудит с reason `STATUS_<X>`.
* A3 Заблокирован по `lockedUntil` → общее сообщение (без раскрытия блокировки); аудит.
* A4 Превышен rate limit по IP → HTTP 429.

## Data changes
User (failedLoginCount, lockedUntil, lastLoginAt), Session (create), AuditLog.

## Authorization
Публичная операция. Rate limit по IP и по email.

## UI behavior (AdminJS)
Стандартная страница входа AdminJS, локализованная; единое сообщение об ошибке; без подсказок о существовании email.

## Acceptance criteria
| ID | Критерий | Тип |
|---|---|---|
| AC-AUTH-001.1 | Активный пользователь с верным паролем входит; создается сессия с новым id; аудит `auth.login.success` | positive |
| AC-AUTH-001.2 | Неверный пароль и несуществующий email дают идентичный ответ (текст, статус, время ± 20%) | negative |
| AC-AUTH-001.3 | После 5 неудач вход с верным паролем отклоняется 15 минут | negative |
| AC-AUTH-001.4 | `BLOCKED`, `ARCHIVED`, `INVITED` пользователи не входят | negative |
| AC-AUTH-001.5 | Пароль не попадает в логи и аудит | security |
| AC-AUTH-001.6 | Cookie сессии HttpOnly, SameSite=Lax, Secure (prod) | security |
| AC-AUTH-001.7 | Пользователь с `mustChangePassword` не может открыть ни один ресурс до смены пароля | negative |
