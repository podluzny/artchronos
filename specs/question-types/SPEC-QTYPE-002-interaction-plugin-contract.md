# SPEC-QTYPE-002: Контракт interaction plugin

| Поле | Значение |
|---|---|
| Блок | BL-06 |
| Requirements | FR-QTYPE-005, FR-QTYPE-006, FR-DELIV-002, NFR-EXT-001, NFR-EXT-002, NFR-SEC-007 |
| Scenarios | SC-ITEM-001, SC-ITEM-002, SC-ITEM-004 |
| Business rules | BR-020, BR-023, INV-015 |
| Domain entities | QuestionTypeVersion, ItemVersion, ItemOption, Response |
| Permissions | — (кодовый контракт) |
| ADR | ADR-001, ADR-005 |
| Статус | Draft |

## Purpose
Зафиксировать границу между ядром и плагинами, чтобы новые interaction добавлялись без изменения ядра и модели.

## Actors
Разработчик плагина; система.

## Preconditions
—

## Input
Контракт (логический, TypeScript-интерфейс фиксируется при реализации):

| Член | Назначение |
|---|---|
| `key` | Уникальный interactionKey |
| `version` | Семантическая версия плагина |
| `configSchema` | JSON Schema допустимой конфигурации типа |
| `optionRoles` | Используемые роли ItemOption и ограничения на них |
| `buildContentSchema(config)` | Схема `content` для данной конфигурации |
| `responseSchema(config)` | Схема `Response.payload` |
| `answerKeySchema(config)` | Схема `answerKey` |
| `validate(version, config) → Issue[]` | Семантическая валидация (ссылки key, число верных, …); Issue: {path, code, severity: ERROR/WARNING} |
| `evaluators` | Map method → { paramsSchema, evaluate(version, payload, params) → {score, maxScore, details} } |
| `normalizeForHash(version)` | Каноническое представление для contentHash/diff |
| `adminComponents` | `Editor`, `Preview`, `ResponseView` (React, для AdminJS) |
| `migrateConfig?(from, to)` | Миграция конфигурации между версиями плагина |

## Business rules
* BR-023 — плагины регистрируются только в коде.
* BR-020 — `validate` + JSON Schema = критерий валидности при submit.
* INV-015 — Item не переопределяет schema/interaction/response/evaluation.

## Main scenario
1. При старте приложение регистрирует плагины; конфликт ключей → ошибка старта.
2. Для каждой QuestionTypeVersion проверяется, что плагин поддерживает ее конфигурацию; иначе — ошибка старта (не тихая деградация).
3. Редактор вопроса загружает `Editor` плагина; сохранение проходит через application layer, который вызывает схемы и `validate`.
4. Preview использует `Preview` и `evaluate`.

## Alternative scenarios
* A1 Плагин удален из кода, но есть QuestionType с этим ключом → приложение не стартует (защита от потери возможности отображать контент).

## Data changes
Нет.

## Authorization
Компоненты плагина не принимают решений о доступе; `answerKey` передается в `Editor`/`Preview` только в контекстах, где у пользователя есть право видеть ключ (автор, reviewer, admin).

## UI behavior (AdminJS)
Компоненты обязаны соответствовать NFR-A11Y-001 и не рендерить неэкранированный HTML.

## Acceptance criteria
| ID | Критерий | Тип |
|---|---|---|
| AC-QTYPE-002.1 | Contract test suite проходит для каждого MVP-плагина (`choice`, `match`, `order`, `text_entry`, `extended_text`) | contract |
| AC-QTYPE-002.2 | Регистрация плагина-фикстуры добавляет тип без миграции БД | extensibility |
| AC-QTYPE-002.3 | Отсутствующий плагин для существующего типа → ошибка старта | negative |
| AC-QTYPE-002.4 | Evaluators MVP вычисляют ожидаемые баллы на эталонном наборе ответов | positive |
| AC-QTYPE-002.5 | Компоненты плагинов проходят axe-core без нарушений уровня AA | a11y |
