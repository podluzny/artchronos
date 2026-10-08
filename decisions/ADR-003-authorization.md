# ADR-003: Authorization

| Поле | Значение |
|---|---|
| Статус | Accepted (решение задано планом; подтверждается в T-030) |
| Дата | 2026-10-08 |
| Задача | T-012 |
| Связанные требования | FR-PERM-001…004, NFR-SEC-001, NFR-SEC-010, NFR-PERF-003, BR-001, BR-004, BR-015 |

## Контекст
Много ролей и правил, зависящих от владения, задания, назначения на review и состояния объекта.
AdminJS имеет `isAccessible`/`isVisible`, но они не дают scope-фильтрации списков и легко обходятся прямыми запросами.

## Решение
**RBAC + resource scope + ownership + state/rule guards**, реализованные в domain/application layer.

1. Модель данных: `Role`, `Permission(key)`, `RolePermission(scope)`, `UserRole`. Permissions — фиксированный каталог в коде
   (seed), роли и их состав — данные (FR-PERM-001).
2. `AuthorizationService.can(actor, permissionKey, resource?) → Allow | Deny(reason)`:
   роль/permission → scope matcher (`OWN`, `ASSIGNED`, `COURSE`, `ANY`) → state guard → rule guards (BR).
3. `AuthorizationService.scopeFilter(actor, permissionKey) → QueryCondition` для списков; репозитории обязаны его применять.
4. Каждый use case начинается с проверки; отсутствие проверки ловится тестом: все use cases зарегистрированы с
   декларацией permission, и общий тест убеждается, что вызов без права даёт `Forbidden`.
5. AdminJS: `isAccessible`/`isVisible` вычисляются через тот же сервис (для UI), а records получают `availableActions`.
6. Actor-контекст строится один раз на запрос из сессии (FR-AUTH-006) и кэшируется в пределах запроса.

## Рассмотренные альтернативы
| Вариант | Плюсы | Минусы | Почему отклонен |
|---|---|---|---|
| Только AdminJS `isAccessible` | Быстро | Нет scope для списков, обход прямыми запросами | NFR-SEC-001 |
| ABAC-движок (OPA, Casbin) | Гибкость | Внешняя зависимость, правила вне доменных тестов | Избыточно; может быть добавлено позже за тем же интерфейсом |
| Row-level security PostgreSQL | Защита на уровне БД | Сложно выразить ASSIGNED/state guards, плохо тестируется | Можно добавить как defense-in-depth позже |

## Последствия
* Матрица permission-model.md становится исполняемой спецификацией (параметризованные AT-PERM-MATRIX).
* Admin тоже подчиняется BR (BR-001, BR-013, BR-015, BR-016).

## Верификация
AT-PERM-001…005, AT-PERM-MATRIX; архитектурный тест «каждый use case декларирует permission».
