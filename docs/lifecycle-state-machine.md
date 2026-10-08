# Lifecycle State Machine

| Поле | Значение |
|---|---|
| Задача | T-008 |
| Статус | Draft — ожидает review (T-030) |
| Связанные | versioning-model.md, ADR-002, SPEC-PUB-001, BR-013 |

## 1. Состояния версии

Применяется к `TestVersion` и `ItemVersion` (у `ItemVersion` нет `PUBLISHED`).

| Состояние | Смысл | Содержимое | Кто видит |
|---|---|---|---|
| `DRAFT` | Черновик; автор работает | Изменяемо владельцем | own, assigned (руководитель задания), admin |
| `READY_FOR_REVIEW` | Отправлено на экспертизу, review не начат | **Заморожено** | + назначенные reviewers |
| `IN_REVIEW` | Экспертиза идет | Заморожено | то же |
| `CHANGES_REQUESTED` | Возвращено на доработку; финальное состояние этой версии | Заморожено | то же |
| `APPROVED` | Утверждено | **Immutable навсегда** | + course |
| `PUBLISHED` | Опубликовано (только TestVersion) | Immutable | + будущий Student Runner |
| `ARCHIVED` | Выведено из оборота (причина: `SUPERSEDED`, `WITHDRAWN`, `DISCARDED`, `CONTAINER_ARCHIVED`) | Immutable | as before |

## 2. Диаграмма

```
                    recall (author, BR-038)
             ┌──────────────────────────────────┐
             ↓                                  │
  ┌──────► DRAFT ── submit (author) ──► READY_FOR_REVIEW ── start (primary reviewer) ──► IN_REVIEW
  │          │                                                                         │      │
  │          │ discard (owner) → hard delete если не отправлялась (BR-044)            │      │
  │          │                                                                         │      │
  │   new version (author)                              request_changes (reviewer, BR-001,029) │
  │          ▲                                                                         ↓      │
  │          └──────────────────────────────────────────────────────────── CHANGES_REQUESTED  │
  │                                                                                           │
  │   new version (author/admin)                              approve (reviewer, BR-001,011,012,028)
  │          ▲                                                                                ↓
  └──────────┴───────────────────────────────────────────────────────────────────────── APPROVED
                                                                                           │
                                                                     publish (admin, BR-008, BR-009)
                                                                                           ↓
                                                    withdraw (admin, BR-036) / superseded  PUBLISHED
                                                                                           │
                                                                                           ↓
                                                                                       ARCHIVED
```

## 3. Таблица переходов

| # | Из | В | Действие | Actor (permission) | Guards | Побочные эффекты |
|---|---|---|---|---|---|---|
| T1 | — | DRAFT | create | `item.create` / `test.create` | BR-017, BR-018, BR-021, BR-033 | Item/Test создан, versionNo = 1 |
| T2 | DRAFT | DRAFT | edit | `*.update` own draft | BR-004, optimistic lock | revision++ |
| T3 | DRAFT | READY_FOR_REVIEW | submit | `*.submit` own | BR-020, BR-024, BR-025, BR-031, BR-032; для теста — каскад вложенных собственных DRAFT ItemVersion | заморозка, contentHash, Review + ReviewAssignment (SPEC-REVIEW-001) |
| T4 | READY_FOR_REVIEW | DRAFT | recall | `*.submit` own | BR-038 (review не начат) | Review → CANCELLED; разморозка (каскадно для вложенных) |
| T5 | READY_FOR_REVIEW | IN_REVIEW | start review | `review.perform` assigned, PRIMARY | BR-001 | Review → IN_PROGRESS |
| T6 | IN_REVIEW | CHANGES_REQUESTED | request changes | `review.perform` assigned, PRIMARY | BR-001, BR-029, BR-030 | Review закрыт (BR-040); вложенные ItemVersion из пакета тоже → CHANGES_REQUESTED |
| T7 | IN_REVIEW | APPROVED | approve | `review.perform` assigned, PRIMARY | BR-001, BR-011, BR-012, BR-024, BR-028, BR-030 | вложенные ItemVersion пакета → APPROVED; pool freeze; Item.latestApprovedVersionId |
| T8 | CHANGES_REQUESTED | (новая) DRAFT | new version | `*.update` own | BR-041 | копия содержимого, basedOnVersionId; незакрытые issues переносятся (FR-REVIEW-009) |
| T9 | APPROVED / PUBLISHED | (новая) DRAFT | new version | `*.update` own / any | BR-003, BR-041 | исходная версия не меняется |
| T10 | APPROVED | PUBLISHED | publish | `test.publish` | BR-008, BR-009, Test.status = ACTIVE | предыдущая PUBLISHED → ARCHIVED (SUPERSEDED); Test.publishedVersionId |
| T11 | PUBLISHED | ARCHIVED | withdraw | `test.withdraw` | reason обязателен (BR-036) | Test.publishedVersionId = null |
| T12 | DRAFT | (удалена) | discard | `*.update` own | BR-044 (не отправлялась, нет ссылок) | hard delete + аудит; иначе → ARCHIVED (DISCARDED) |
| T13 | любое кроме PUBLISHED | ARCHIVED | archive container | `*.archive` | у Test нет PUBLISHED версии | Item/Test.status = ARCHIVED; DRAFT → ARCHIVED (CONTAINER_ARCHIVED) |

Все прочие переходы запрещены (BR-013). Попытка запрещенного перехода → `DENY(INVALID_TRANSITION)`.

## 4. Контейнеры (Test, Item)

| Статус | Переходы |
|---|---|
| `ACTIVE` → `ARCHIVED` | archive (owner/admin); для Test — только если нет PUBLISHED версии (сначала withdraw) |
| `ARCHIVED` → `ACTIVE` | restore (owner/admin); версии остаются в своих состояниях, DRAFT, архивированный с причиной CONTAINER_ARCHIVED, не восстанавливается — автор создает новый |

## 5. Review status ↔ version state

| Review.status | Version.state |
|---|---|
| OPEN | READY_FOR_REVIEW |
| IN_PROGRESS | IN_REVIEW |
| CHANGES_REQUESTED | CHANGES_REQUESTED |
| APPROVED | APPROVED |
| CANCELLED | DRAFT (после recall) |

## 6. Assignment lifecycle

| Из | В | Кто | Guard |
|---|---|---|---|
| DRAFT | ACTIVE | owner / admin | есть адресаты, темы, ≥1 allowed type |
| ACTIVE | CLOSED | owner / admin | — (новые Item/Test в задании невозможны; review продолжаются) |
| CLOSED | ACTIVE | owner / admin | reopen, журналируется |
| CLOSED | ARCHIVED | owner / admin | — |
