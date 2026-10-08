# SPEC-AUTH-004: Пароли и активация аккаунта

| Поле | Значение |
|---|---|
| Блок | BL-01 |
| Requirements | FR-AUTH-005, FR-AUTH-007, NFR-SEC-002 |
| Scenarios | SC-AUTH-004, SC-USER-001 |
| Business rules | BR-014, BR-035 |
| Domain entities | User, Session, PasswordToken (служебная), AuditLog |
| Permissions | собственный пароль — без permission; `user.password.reset` |
| ADR | ADR-006 |
| Статус | Ready |

## Purpose
Безопасное управление паролями: активация приглашенных, смена собственного, сброс администратором.

## Actors
Пользователь; Admin.

## Preconditions
Для смены — активная сессия; для активации/сброса — валидный одноразовый токен.

## Input
| Поле | Тип | Обязательно | Валидация |
|---|---|---|---|
| currentPassword | string | при смене | верный |
| newPassword | string | да | ≥ 12, не в списке частых, ≠ email, ≠ текущему |
| token | string | при активации/сбросе | существует (по hash), не использован, не истек (1 ч / приглашение 7 дней) |

## Business rules
BR-014 (INVITED не входит до установки пароля), BR-035.

## Main scenario
1. Смена: проверка текущего пароля → новая политика → hash → `passwordChangedAt` → отзыв прочих сессий → аудит.
2. Активация: по токену приглашения → установка пароля → `INVITED → ACTIVE` → токен погашен → аудит.
3. Сброс Admin: создает токен, `mustChangePassword = true`, отзывает сессии пользователя; ссылка отправляется через Mailer или показывается Admin однократно → аудит.

## Alternative scenarios
* A1 Токен истек/использован → ошибка, предложение запросить новый.
* A2 Пароль не соответствует политике → ошибки с требованиями.

## Data changes
User (passwordHash, status, passwordChangedAt, mustChangePassword), PasswordToken, Session (revoke), AuditLog.

## Authorization
`user.password.reset` (ANY) для сброса другому; собственная смена — только себе.

## UI behavior (AdminJS)
Страница профиля «Сменить пароль»; action «Сбросить пароль» на ресурсе User; публичная страница установки пароля по токену.

## Acceptance criteria
| ID | Критерий | Тип |
|---|---|---|
| AC-AUTH-004.1 | Смена пароля отзывает все прочие сессии пользователя | positive |
| AC-AUTH-004.2 | Слабый пароль отклоняется | negative |
| AC-AUTH-004.3 | Токен одноразовый и ограничен по времени; хранится только hash | security |
| AC-AUTH-004.4 | Пользователь без `user.password.reset` не может сбросить пароль другому | permission |
| AC-AUTH-004.5 | Активация переводит INVITED → ACTIVE | positive |
