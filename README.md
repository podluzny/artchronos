# ArtChronos — административная система тестов по искусству

Административная система для подготовки, экспертизы, публикации и управления тестами по искусству.
Административный интерфейс — **AdminJS**. Разработка ведется по методологии **SDD (Specification-Driven Development)**.

> M0 (спецификации) и M1 (Identity & Governance) закрыты. Текущий этап — **M2 Educational Context**
> (см. [`tasks/task-registry.md`](tasks/task-registry.md), прогресс по требованиям — [`validation/acceptance-matrix.md`](validation/acceptance-matrix.md)).

## Запуск локально

Требуется Node.js ≥ 20 и PostgreSQL 16.

```bash
cp .env.example .env            # DATABASE_URL, SESSION_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD
npm ci
npm run dev                     # миграции + seed + первый администратор; http://localhost:3000/admin
```

Проверки (то же выполняет CI):

```bash
npm run typecheck && npm run lint && npm run format:check && npm run deps:check
npm test                        # unit + integration + acceptance (нужен TEST_DATABASE_URL)
npm run test:e2e                # SC-E2E-001 через браузер (Playwright)
npm run test:report && python3 tools/build_traceability.py   # обновить матрицы по результатам тестов
```

## Тестовый стенд (Vercel + Neon, ADR-009)

Переменные окружения проекта Vercel:

| Переменная | Откуда |
|---|---|
| `DATABASE_URL`, `DATABASE_URL_UNPOOLED` | интеграция Neon (создаются автоматически) |
| `SESSION_SECRET` | случайная строка ≥ 32 символов |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | первый администратор (создается при сборке, если администраторов нет; пароль ≥ 12 символов) |

Сборка (`vercel.json` → `scripts/vercel-build.ts`): компиляция TypeScript, предсборка фронтенда AdminJS
(`/admin-assets/`), сайт документации (`/sdd/`), миграции и seed. Приложение — `/admin`.

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
| `index.html`, `_sidebar.md`, `assets/docsify/`, `vercel.json` | Статический сайт документации (docsify 4.13.1, встроен локально). Vercel собирает его в `public/` через `tools/build_site.sh` |
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
