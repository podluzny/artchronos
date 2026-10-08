# ArtChronos — административная система тестов по искусству

Административная система для подготовки, экспертизы, публикации и управления тестами по искусству.
Административный интерфейс — **AdminJS**. Разработка ведется по методологии **SDD (Specification-Driven Development)**.

> Текущий этап: **M0 — Domain & Specification Baseline**. Кода нет намеренно.
> Переход к реализации возможен только после закрытия задачи `T-030 Review SDD baseline`
> (см. [`tasks/task-registry.md`](tasks/task-registry.md)) и подтверждения решений в
> [`docs/open-questions.md`](docs/open-questions.md).

## Порядок SDD

```
Product Intent → Domain Model → Business Rules → Requirements → Scenarios
→ Specifications → Architecture Decisions → Tasks → Implementation → Tests → Verification
```

Каждая задача трассируется назад: `Task → SPEC → FR/BR → SC → цель продукта`.
Задача без трассировки считается подозрительной и пересматривается.

## Структура репозитория

| Каталог | Содержимое |
|---|---|
| [`docs/`](docs) | Контекст проекта, доменная модель, бизнес-правила (BR), требования (FR, NFR), архитектура, модели безопасности/прав/типов вопросов/тестов/медиа, state machine, версионирование, открытые вопросы |
| [`specs/`](specs) | Спецификации по функциональным областям (`SPEC-*`), шаблон — [`specs/_template.md`](specs/_template.md) |
| [`scenarios/`](scenarios) | Реестр пользовательских сценариев (`SC-*`) и E2E reference scenario |
| [`tasks/`](tasks) | Реестр задач (`T-NNN`), Definition of Ready / Done |
| [`decisions/`](decisions) | Architecture Decision Records (`ADR-NNN`) |
| [`validation/`](validation) | Acceptance matrix (по блокам) и traceability matrix |
| [`tools/`](tools) | `build_traceability.py` — генерирует матрицы в `validation/` и проверяет целостность ссылок (инструмент документации, не код продукта) |

## Идентификаторы

| Префикс | Значение | Где определяется |
|---|---|---|
| `BR-NNN` | Business rule — что запрещено/обязательно | `docs/business-rules.md` |
| `FR-<AREA>-NNN` | Functional requirement — что система умеет | `docs/requirements.md` |
| `NFR-<CAT>-NNN` | Non-functional requirement | `docs/non-functional-requirements.md` |
| `INV-NNN` | Доменный инвариант | `docs/domain-model.md` |
| `SC-<AREA>-NNN` | Сценарий | `scenarios/scenario-registry.md` |
| `SPEC-<AREA>-NNN` | Спецификация | `specs/<area>/*.md` |
| `AC-<AREA>-NNN.N` | Acceptance criterion внутри спецификации | `specs/<area>/*.md` |
| `AT-<AREA>-NNN` | Acceptance test | `validation/acceptance-matrix.md` |
| `BL-NN` | Feature block | `docs/product-scope.md` |
| `ADR-NNN` | Architecture decision | `decisions/` |
| `T-NNN` | Задача | `tasks/task-registry.md` |
| `Q-NNN` | Открытый вопрос / предложенное решение | `docs/open-questions.md` |

Проверка целостности: `python3 tools/build_traceability.py --check` (висячие ID, FR без спецификаций, BR без покрытия, SPEC без задач).
После изменения документов матрицы перегенерируются: `python3 tools/build_traceability.py`.

ID стабильны: удаленный элемент помечается `Deprecated`, номер не переиспользуется.

## Правило изменений

```
New idea → Requirement change? → Domain change? → Business rule change?
→ Specification update → Impact analysis → Task update → Implementation
```

«Заодно сделаем еще теги» — запрещено. Сначала меняется спецификация.
