# SPEC-QTYPE-001: Реестр типов вопросов

| Поле | Значение |
|---|---|
| Блок | BL-06 |
| Requirements | FR-QTYPE-001, FR-QTYPE-002, FR-QTYPE-003, FR-QTYPE-004, NFR-EXT-001 |
| Scenarios | SC-QTYPE-001, SC-QTYPE-002 |
| Business rules | BR-021, BR-022, BR-023, BR-035 |
| Domain entities | QuestionType, QuestionTypeVersion, Assignment |
| Permissions | `qtype.read`, `qtype.manage` |
| ADR | ADR-001, ADR-005 |
| Статус | Ready |

## Purpose
Позволить администраторам создавать и настраивать типы вопросов без разработки, в пределах возможностей зарегистрированных interaction plugins.

## Actors
Admin (управление); все (чтение).

## Preconditions
Реестр плагинов загружен при старте приложения.

## Input
| Поле | Тип | Обязательно | Валидация |
|---|---|---|---|
| code | string | да (create) | `^[a-z][a-z0-9_]{1,49}$`, уникален, неизменен |
| name, description, authorHints | string | name — да | |
| interactionKey | enum (из реестра) | да (create), неизменен | ∈ зарегистрированных плагинов (BR-023) |
| interactionConfig | JSON | да | валиден по `plugin.configSchema` |
| contentConstraints | JSON Schema fragment | нет | только сужение базовой схемы (проверяется плагином) |
| evaluation | {method, params} | да | method ∈ plugin.evaluators; params по схеме evaluator |

## Business rules
* BR-023 — interactionKey только из кода.
* BR-022 — изменение = новая версия; версии неизменны.
* BR-021 — деактивация не влияет на существующий контент.

## Main scenario
1. Create: валидация → QuestionType (INACTIVE) + QuestionTypeVersion v1 (contentSchema = plugin.buildContentSchema(config) ⊕ constraints; responseSchema = plugin.responseSchema) → аудит.
2. Update config: новая QuestionTypeVersion vN+1; `currentVersionId` переключается; аудит.
3. Activate/Deactivate: смена status; при деактивации — предупреждение о заданиях, где тип разрешен (задания не меняются, но новые Item этого типа невозможны).
4. Seed: MVP-типы создаются миграцией (question-type-system §3), status ACTIVE.

## Alternative scenarios
* A1 Неизвестный interactionKey → отказ.
* A2 Конфигурация невалидна → ошибки по полям.
* A3 Попытка изменить code/interactionKey → отказ.
* A4 Удаление типа → запрещено, если есть Item; иначе разрешено.

## Data changes
QuestionType, QuestionTypeVersion, AuditLog.

## Authorization
`qtype.manage` ANY (Admin); `qtype.read` ANY.

## UI behavior (AdminJS)
Ресурс «Типы вопросов»: список с interaction и статусом; форма конфигурации генерируется из `plugin.configSchema`; вкладка «Версии» (read-only); preview примера вопроса.

## Acceptance criteria
| ID | Критерий | Тип |
|---|---|---|
| AC-QTYPE-001.1 | Admin создает тип на основе `choice` с обязательным стимулом; создается v1 | positive |
| AC-QTYPE-001.2 | Тип с несуществующим interactionKey не создается | negative |
| AC-QTYPE-001.3 | Изменение конфигурации создает v2; существующие ItemVersion остаются на v1 | positive |
| AC-QTYPE-001.4 | Деактивированный тип недоступен для новых Item; существующие работают | positive |
| AC-QTYPE-001.5 | Teacher/Student/Expert не могут управлять типами | permission |
| AC-QTYPE-001.6 | QuestionTypeVersion неизменна (прямой UPDATE отклоняется) | negative |
