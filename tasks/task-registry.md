# Task Registry

| Поле | Значение |
|---|---|
| Статус реестра | M0, M1, M2 закрыты (2026-10-08); M3 — в работе |

## 1. Правила

* Task **не содержит самостоятельной бизнес-логики** — он реализует уже определенную спецификацию.
* Каждая задача имеет ID `T-NNN` и поле `type`: `doc`, `adr`, `domain`, `db`, `implementation`, `ui`, `security`, `test`, `infra`.
* Задача без ссылки на SPEC / ADR / NFR считается подозрительной и пересматривается.
* Коммиты реализации ссылаются на `T-NNN` (NFR-MAINT-004).

### Статусы
`planned` → `blocked` (не выполнен DoR) → `ready` → `in-progress` → `in-review` → `done`.

### Definition of Ready
Задача переходит в `ready` только если:
- [ ] есть requirement (FR/BR/NFR);
- [ ] есть specification (или ADR для infra/arch);
- [ ] определены dependencies;
- [ ] определены acceptance criteria;
- [ ] понятно, какие domain entities затрагиваются;
- [ ] понятно, какие permissions затрагиваются;
- [ ] нет нерешенных архитектурных решений (связанные ADR — Accepted).

Если хотя бы один пункт отсутствует — задача `blocked`.

### Definition of Done
Задача `done` только если:
- [ ] реализован сценарий;
- [ ] выполнены acceptance criteria (автотесты зеленые);
- [ ] проверены permissions (включая прямые запросы в обход UI);
- [ ] негативные сценарии проверены;
- [ ] не нарушены business rules;
- [ ] добавлены необходимые automated tests;
- [ ] обновлена документация;
- [ ] заполнена traceability (`validation/traceability-matrix.md`, `validation/acceptance-matrix.md`);
- [ ] нет необработанного отклонения от спецификации (отклонение = изменение спецификации по правилу изменений).

## 2. M0 — Domain & Specification Baseline

| ID | Title | Type | Block | Artifact | Depends on | Status |
|---|---|---|---|---|---|---|
| T-001 | Create project-context specification | doc | — | docs/project-context.md, docs/product-scope.md | — | done |
| T-002 | Define domain model | doc | все | docs/domain-model.md, assessment-model.md, media-model.md | T-001 | done |
| T-003 | Define business rules | doc | все | docs/business-rules.md | T-002 | done |
| T-004 | Define functional requirements | doc | все | docs/requirements.md | T-003 | done |
| T-005 | Define non-functional requirements | doc | все | docs/non-functional-requirements.md | T-001 | done |
| T-006 | Define scenario registry | doc | все | scenarios/scenario-registry.md | T-004 | done |
| T-007 | Define permission matrix | doc | BL-02 | docs/permission-model.md, docs/security-model.md | T-002, T-006 | done |
| T-008 | Define lifecycle state machine | doc | BL-10 | docs/lifecycle-state-machine.md | T-003 | done |
| T-009 | Define versioning model | doc | BL-07, BL-08 | docs/versioning-model.md | T-008 | done |
| T-010 | Define question type architecture | doc | BL-06 | docs/question-type-system.md, docs/architecture.md, ADR-008 | T-002 | done |
| T-011 | ADR: authentication | adr | BL-01 | ADR-006 | T-005 | done |
| T-012 | ADR: authorization (+ размещение бизнес-логики) | adr | BL-02 | ADR-003, ADR-004 | T-007 | done |
| T-013 | ADR: versioning | adr | BL-07, BL-08 | ADR-002 | T-009 | done |
| T-014 | ADR: question type registry | adr | BL-06 | ADR-001 | T-010 | done |
| T-015 | ADR: dynamic item data | adr | BL-07 | ADR-005 | T-014 | done |
| T-016 | ADR: media storage | adr | BL-05 | ADR-007 | T-005 | done |
| T-017 | Specify BL-01 | doc | BL-01 | SPEC-AUTH-001, -002, -004 | T-011 | done |
| T-018 | Specify BL-02 | doc | BL-02 | SPEC-AUTH-003, SPEC-USER-001, -002 | T-012 | done |
| T-019 | Specify BL-03 | doc | BL-03 | SPEC-EDU-001, -002 | T-018 | done |
| T-020 | Specify BL-04 | doc | BL-04 | SPEC-ASSIGN-001, -002 | T-019 | done |
| T-021 | Specify BL-05 | doc | BL-05 | SPEC-MEDIA-001, -002 | T-016 | done |
| T-022 | Specify BL-06 | doc | BL-06 | SPEC-QTYPE-001, -002 | T-014 | done |
| T-023 | Specify BL-07 | doc | BL-07 | SPEC-ITEM-001 … -005 | T-015, T-021, T-022 | done |
| T-024 | Specify BL-08 | doc | BL-08 | SPEC-TEST-001 … -004 | T-020, T-023 | done |
| T-025 | Specify BL-09 | doc | BL-09 | SPEC-REVIEW-001 … -003 | T-024 | done |
| T-026 | Specify BL-10 | doc | BL-10 | SPEC-PUB-001, -002 | T-025 | done |
| T-027 | Specify BL-11 (+ BL-12 delivery model) | doc | BL-11, BL-12 | SPEC-AUDIT-001, -002, SPEC-DELIV-001 | T-018, T-026 | done |
| T-028 | Define E2E reference scenario | doc | все | SC-E2E-001 | T-006, T-026 | done |
| T-029 | Build traceability matrix | doc | все | validation/traceability-matrix.md, acceptance-matrix.md | T-017…T-028 | done |
| T-030 | Review SDD baseline | doc | все | Подтверждение docs/open-questions.md (Q-001…Q-032), ADR-005…008 → Accepted, domain review | T-001…T-029 | done (2026-10-08) |

До закрытия T-030 к реализации AdminJS не переходим.

### Чек-лист T-030
- [x] Ответы Q-001…Q-032 подтверждены или изменены (изменения — через impact analysis).
- [x] Domain review: сущности, связи, агрегаты, инварианты INV-001…015.
- [x] Permission matrix согласована.
- [x] ADR-005, ADR-006, ADR-007, ADR-008 переведены в Accepted.
- [x] Каждое FR имеет сценарий и спецификацию; каждое BR — хотя бы одну спецификацию и AT (traceability-matrix §3 без пустых ячеек).
- [x] Реализационные задачи T-031+ переведены из `blocked` в `ready`/`planned`.

## 3. Реализация (после T-030)

T-030 закрыта: решения Q-* подтверждены, ADR-001…008 приняты. Задачи переходят в `ready`, когда закрыты их зависимости.

### M1 — Identity & Governance (BL-01, BL-02, BL-11)

Итог M1 (2026-10-08): все AT блоков BL-01/02/11 проходят (`validation/acceptance-matrix.md`); SC-E2E-001 шаги 1–2 автоматизированы (Playwright).
Отклонения от плана: ORM заменен на Kysely (ADR-008, изменение); тестовый стенд — Vercel + Neon (ADR-009);
история объекта реализована как фильтр журнала аудита (действие «История»), без отдельного компонента.

| ID | Title | Type | Block | Spec / ADR | AC | Depends on | Status |
|---|---|---|---|---|---|---|---|
| T-031 | Project scaffold: TS strict, AdminJS+Express, Prisma, Docker, CI (lint, typecheck, tests, dependency rules, audit) | infra | — | ADR-008, ADR-004, NFR-MAINT-001, NFR-MAINT-002, NFR-MAINT-003, NFR-MAINT-004, NFR-MAINT-005, NFR-SEC-009, NFR-SEC-011, NFR-L10N-001 | архитектурный тест зависимостей проходит | T-030 | done |
| T-032 | Identity domain + data model + migrations (User, Role, Permission, UserRole, RolePermission, Session, PasswordToken) | domain, db | BL-01/02 | SPEC-USER-001, SPEC-USER-002, SPEC-AUTH-001, NFR-DATA-002, NFR-DATA-007, NFR-EXT-003 | — (основа) | T-031 | done |
| T-033 | Audit foundation: AuditLog, AuditWriter (транзакционный), права БД append-only | implementation, db | BL-11 | SPEC-AUDIT-001 | AC-AUDIT-001.1, .3, .4, .5 | T-031 | done |
| T-034 | Implement AuthorizationService, ActorContext, scopeFilter, use-case permission declaration | security | BL-02 | SPEC-AUTH-003 | AC-AUTH-003.1 … AC-AUTH-003.8 | T-032 | done |
| T-035 | Permission catalog + system roles seed (по permission-model §4) | db, security | BL-02 | SPEC-USER-002, permission-model | AC-USER-002.4 | T-034 | done |
| T-036 | AdminJS `DomainResource` adapter, маппинг DomainError, `availableActions` | implementation | BL-02 | ADR-004, SPEC-AUTH-003 | AC-AUTH-003.2, .7 | T-034 | done |
| T-037 | Login, sessions, logout, lockout, CSRF | implementation, security | BL-01 | SPEC-AUTH-001, SPEC-AUTH-002, ADR-006 | AC-AUTH-001.1…7, AC-AUTH-002.1…5 | T-032, T-033 | done |
| T-038 | Password change, reset, activation | implementation | BL-01 | SPEC-AUTH-004 | AC-AUTH-004.1…5 | T-037 | done |
| T-039 | Implement User management use cases and resource | implementation, ui | BL-02 | SPEC-USER-001 | AC-USER-001.1…8 | T-036, T-037 | done |
| T-040 | Role management and role assignment | implementation, ui | BL-02 | SPEC-USER-002 | AC-USER-002.1…7 | T-039 | done |
| T-041 | Audit log resource and object history component | ui | BL-11 | SPEC-AUDIT-001, SPEC-AUDIT-002 | AC-AUDIT-001.6, AC-AUDIT-002.1, .2 | T-033, T-036 | done |
| T-042 | Permission matrix acceptance suite (identity), harness для AT-PERM-MATRIX | test | BL-02 | SPEC-AUTH-003, permission-model §4.1 | AT-PERM-001…005 (часть) | T-040 | done |
| T-043 | E2E harness (Playwright + API-runner) и SC-E2E-001 шаги 1–2 | test | — | SC-E2E-001 | AT-E2E-001 (шаги 1–2) | T-040 | done |

### M2 — Educational Context (BL-03, BL-04)

Итог M2: AT блоков BL-03/04 проходят, кроме зависящих от тестов (AT-ASSIGN-002.6 — сводка по тестам студентов, M4);
правила BR-017/BR-031 реализованы в домене и проверены unit-тестами, применение к вопросам и тестам — M3/M4.
SC-E2E-001 шаг 3 автоматизирован. Таблица `question_types` и seed MVP-типов вынесены в M2 (версии и схемы — M3).

| ID | Title | Type | Block | Spec | AC | Depends on | Status |
|---|---|---|---|---|---|---|---|
| T-044 | Subjects, courses, topics, objectives (domain, db, use cases, resources, дерево тем) | implementation | BL-03 | SPEC-EDU-001 | AC-EDU-001.1…5 | T-042 | done |
| T-045 | Student groups | implementation | BL-03 | SPEC-EDU-002 | AC-EDU-002.1…4 | T-044 | done |
| T-046 | Assignment model and creation | implementation | BL-04 | SPEC-ASSIGN-001 | AC-ASSIGN-001.1…6 | T-045, T-057* | done |
| T-047 | Assignment lifecycle, deadline extension, student «Мои задания», teacher summary | implementation, ui | BL-04 | SPEC-ASSIGN-002 | AC-ASSIGN-002.1…6 | T-046 | done |
| T-048 | Acceptance BL-03/04, permission matrix §4.2, E2E шаг 3 | test | BL-03/04 | SPEC-EDU-*, SPEC-ASSIGN-* | AT-EDU-*, AT-ASSIGN-* | T-047 | done |

\* T-046 требует хотя бы seed-реестра типов вопросов: модель `QuestionType` + seed из T-057 выносится вперед (минимальная часть без UI), см. примечание в product-scope §1.

### M3 — Question Platform (BL-05, BL-06, BL-07)

| ID | Title | Type | Block | Spec / ADR | AC | Depends on | Status |
|---|---|---|---|---|---|---|---|
| T-049 | MediaStorage port, S3\*\* и LocalFs драйверы, выдача файлов через авторизованный endpoint | infra, security | BL-05 | ADR-007, SPEC-MEDIA-001 | AC-MEDIA-001.7, NFR-EXT-004 | T-042 | done |
| T-050 | Upload pipeline: сигнатуры, sharp, EXIF, sha256, очередь производных | implementation | BL-05 | SPEC-MEDIA-001 | AC-MEDIA-001.1…5 | T-049 | done |
| T-051 | Медиатека: ресурс, сетка, фильтры, медиа-пикер | ui | BL-05 | SPEC-MEDIA-001 | AC-MEDIA-001.6 | T-050 | done |
| T-052 | Права медиа, «где используется», архив | implementation | BL-05 | SPEC-MEDIA-002 | AC-MEDIA-002.1…7 | T-051, T-058 | done |
| T-053 | InteractionPlugin contract, реестр, contract test suite | implementation | BL-06 | SPEC-QTYPE-002, ADR-001 | AC-QTYPE-002.1…3 | T-031 | done |
| T-054 | Plugin `choice` (editor, preview, evaluators) | implementation | BL-06 | SPEC-QTYPE-002 | AC-QTYPE-002.1, .4, .5 | T-053 | done |
| T-055 | Plugins `match`, `order` | implementation | BL-06 | SPEC-QTYPE-002 | AC-QTYPE-002.1, .4, .5 | T-053 | done |
| T-056 | Plugins `text_entry`, `extended_text` | implementation | BL-06 | SPEC-QTYPE-002 | AC-QTYPE-002.1, .4, .5 | T-053 | done |
| T-057 | QuestionType registry: модель, версии, seed MVP-типов, ресурс | implementation | BL-06 | SPEC-QTYPE-001 | AC-QTYPE-001.1…6 | T-053 | done |
| T-058 | Item domain: Item/ItemVersion/ItemOption/ItemMedia, version state machine, data model | domain, db | BL-07 | SPEC-ITEM-002, SPEC-PUB-001, ADR-002, ADR-005 | AC-PUB-001.1, .2 (Item) | T-057 | done |
| T-059 | Implement ownership policy for Item | security | BL-07 | SPEC-ITEM-004 | AC-ITEM-004.1…6 | T-058, T-034 | done |
| T-060 | Implement Item creation workflow | implementation, ui | BL-07 | SPEC-ITEM-001 | AC-ITEM-001.1…9 | T-059, T-054, T-051, T-047 | done |
| T-061 | Item editing, new version (+auto-rebind), recall, discard, archive, diff | implementation | BL-07 | SPEC-ITEM-002 | AC-ITEM-002.1…10 | T-060 | done |
| T-062 | Item preview | ui | BL-07 | SPEC-ITEM-003 | AC-ITEM-003.1…4 | T-060 | done |
| T-063 | Item bank list, filters, drawer | ui | BL-07 | SPEC-ITEM-005 | AC-ITEM-005.1…5 | T-062 | done |
| T-064 | DB immutability triggers и contentHash | db, security | BL-07/08 | ADR-002, SPEC-PUB-001 | AC-PUB-001.3, AC-QTYPE-001.6 | T-058 | done |
| T-065 | Acceptance BL-05/06/07, matrix §4.3–4.4, E2E шаги 4–6 | test | BL-05…07 | SPEC-MEDIA-*, SPEC-QTYPE-*, SPEC-ITEM-* | AT-MEDIA-*, AT-QTYPE-*, AT-ITEM-* | T-063, T-064, T-052 | done |

Примечания M3:
- \*\* Драйвер S3 отложен до выбора production-хостинга; реализованы LocalFs (dev/тесты) и Db-blob (тестовый стенд Vercel + Neon) за тем же портом `MediaStorage`.
- Производные изображения (thumb/preview) генерируются синхронно при загрузке; постеры видео не создаются.
- Создание review при отправке вопроса — M5 (хук `onSubmitted`); auto-rebind тестов при новой версии вопроса — M4.
- Матрица §4.4 «Question / approve» проверяется в M5 (экспертиза).

### M4 — Test Authoring (BL-08)

| ID | Title | Type | Block | Spec | AC | Depends on | Status |
|---|---|---|---|---|---|---|---|
| T-066 | Test domain + creation | domain, implementation | BL-08 | SPEC-TEST-001 | AC-TEST-001.1…4 | T-065 | planned |
| T-067 | Test builder: sections, fixed items | implementation, ui | BL-08 | SPEC-TEST-002 | AC-TEST-002.1…3, .6, .7 | T-066 | planned |
| T-068 | Selection rules, pool size | implementation | BL-08 | SPEC-TEST-002 | AC-TEST-002.4, .5 | T-067 | planned |
| T-069 | Test settings and preview | implementation, ui | BL-08 | SPEC-TEST-003 | AC-TEST-003.1…4 | T-068 | planned |
| T-070 | Readiness check, submit/recall (каскад), new test version | implementation | BL-08 | SPEC-TEST-004 | AC-TEST-004.1…8 | T-069, T-072 | planned |
| T-071 | Acceptance BL-08, matrix §4.5, E2E шаги 7–9 | test | BL-08 | SPEC-TEST-* | AT-TEST-* | T-070 | planned |

### M5 — Expert Review (BL-09, BL-10, BL-12 model)

| ID | Title | Type | Block | Spec | AC | Depends on | Status |
|---|---|---|---|---|---|---|---|
| T-072 | Review model, reviewer assignment, queue | implementation | BL-09 | SPEC-REVIEW-001 | AC-REVIEW-001.1…6 | T-066 | planned |
| T-073 | Review page: checklist, comments, issues, carry-over, checklist templates | implementation, ui | BL-09 | SPEC-REVIEW-002 | AC-REVIEW-002.1…7 | T-072, T-070 | planned |
| T-074 | Review decisions: request changes, approve (пакет, pool freeze) | implementation | BL-09 | SPEC-REVIEW-003 | AC-REVIEW-003.1…9 | T-073 | planned |
| T-075 | Lifecycle: полная матрица переходов, availableActions consistency | test, implementation | BL-10 | SPEC-PUB-001 | AC-PUB-001.1…5 | T-074 | planned |
| T-076 | Publish, withdraw, archive/restore test, история публикаций | implementation | BL-10 | SPEC-PUB-002 | AC-PUB-002.1…7 | T-074 | planned |
| T-077 | Delivery model schema + prototype test (без UI) | domain, db, test | BL-12 | SPEC-DELIV-001 | AC-DELIV-001.1…5 | T-076 | planned |
| T-078 | Полный SC-E2E-001 (UI и API варианты) | test | все | SC-E2E-001 | AT-E2E-001, AT-E2E-001-API | T-076 | planned |

### M6 — Hardening

| ID | Title | Type | Spec / NFR | Depends on | Status |
|---|---|---|---|---|---|
| T-079 | Authorization & privilege escalation suite (полная AT-PERM-MATRIX, подмена id/полей) | security, test | NFR-SEC-001, NFR-SEC-010, SPEC-AUTH-003 | T-078 | planned |
| T-080 | Concurrent edits, конкурентные решения review/публикации | test | NFR-DATA-003, NFR-DATA-004 | T-078 | planned |
| T-081 | Security review: upload, XSS, CSRF, headers, secrets, answerKey exposure | security | NFR-SEC-004, -006, -007, -008, -009 | T-078 | planned |
| T-082 | Accessibility audit кастомных компонентов | test | NFR-A11Y-001…003 | T-078 | planned |
| T-083 | Performance tests на seed 50k вопросов / 10k медиа | test | NFR-PERF-001…005 | T-078 | planned |
| T-084 | Backup/restore drill (БД + storage) | infra | NFR-DATA-006 | T-078 | planned |
| T-085 | Observability: логи, метрики, health | infra | NFR-OBS-001…004 | T-031 | ready |
| T-086 | Archive/restore и media rights regression | test | SPEC-AUDIT-002, SPEC-MEDIA-002 | T-078 | planned |
| T-087 | Финальная acceptance: acceptance-matrix 100%, traceability без пробелов | test, doc | validation/* | T-079…T-086 | planned |
