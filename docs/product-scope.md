# Product Scope

| Поле | Значение |
|---|---|
| Задача | T-001 |
| Статус | Baseline — утверждено в T-030 (2026-10-08) |

## 1. Feature Blocks

| Блок | Название | Зависит от | Milestone | Спецификации |
|---|---|---|---|---|
| BL-01 | Identity & Authentication | — | M1 | SPEC-AUTH-001, -002, -004 |
| BL-02 | Roles & Permissions | BL-01 | M1 | SPEC-AUTH-003, SPEC-USER-001, -002 |
| BL-03 | Educational Structure | BL-02 | M2 | SPEC-EDU-001, -002 |
| BL-04 | Assignments | BL-03 | M2 | SPEC-ASSIGN-001, -002 |
| BL-05 | Media Library | BL-02, BL-03 | M3 | SPEC-MEDIA-001, -002 |
| BL-06 | Question Type Registry | BL-02 | M3 | SPEC-QTYPE-001, -002 |
| BL-07 | Item Bank | BL-03, BL-05, BL-06 | M3 | SPEC-ITEM-001 … -005 |
| BL-08 | Test Authoring | BL-04, BL-07 | M4 | SPEC-TEST-001 … -004 |
| BL-09 | Review Workflow | BL-08 | M5 | SPEC-REVIEW-001 … -003 |
| BL-10 | Publishing & Lifecycle | BL-09 | M5 | SPEC-PUB-001, -002 |
| BL-11 | Audit & Governance | BL-01, BL-02 (подключается ко всем) | M1 (+ каждый следующий) | SPEC-AUDIT-001, -002 |
| BL-12 | Assessment Delivery Preparation | BL-08, BL-10 | M5 (только модель) | SPEC-DELIV-001 |

### Граф зависимостей

```
BL-01
  ↓
BL-02
  ├───────────────┐
  ↓               ↓
BL-03           BL-05
  ↓               ↓
BL-04             │
  └──────┐        │
         ↓        ↓
       BL-06 → BL-07
                   ↓
                 BL-08
                   ↓
                 BL-09
                   ↓
                 BL-10
                   ↓
                 BL-12

BL-11 подключается ко всем блокам
```

> Примечание: BL-06 технически зависит только от BL-02, но в последовательности разработки
> идет после BL-04, т.к. Assignment ограничивает допустимые типы вопросов (FR-ASSIGN-003),
> а BL-07 требует и BL-04, и BL-06.

## 2. Milestones

| Milestone | Блоки | Результат | Критерий выхода |
|---|---|---|---|
| **M0** Domain & Specification Baseline | — | Все документы `docs/`, ADR-001…008, сценарии, спецификации, трассировка | T-030 закрыта, открытые вопросы Q-* подтверждены |
| **M1** Identity & Governance | BL-01, BL-02, BL-11 | login, users, roles, permissions, authorization, audit foundation | AT по BL-01/02/11 зеленые; permission matrix покрыта тестами |
| **M2** Educational Context | BL-03, BL-04 | subjects, courses, topics, objectives, groups, assignments | AT BL-03/04 |
| **M3** Question Platform | BL-05, BL-06, BL-07 | Media Library, Question Type Registry, Item Bank, preview, фильтрация | AT BL-05/06/07; первая реальная ценность |
| **M4** Test Authoring | BL-08 | Test, TestVersion, sections, fixed/random, settings | AT BL-08 |
| **M5** Expert Review | BL-09, BL-10, BL-12 (модель) | review queue, checklist, comments, decisions, lifecycle, публикация | E2E reference scenario SC-E2E-001 зеленый |
| **M6** Hardening | все | приемка: authz, audit, immutability, state transitions, concurrency, archive/restore, escalation, media rights, security, a11y, performance | Все NFR верифицированы, acceptance matrix 100% |

## 3. Первый вертикальный slice

Первым строится не Dashboard, а сквозной сценарий **SC-E2E-001** (см. `scenarios/scenario-registry.md`):

```
Admin создает User → Teacher создает Assignment → Student создает Item (выбирает QuestionType)
→ Student создает Test → отправляет Version на review → Teacher получает ReviewAssignment
→ пишет comment → Request changes → Student создает новую version → Teacher approves → Admin публикует
```

Начиная с M1 этот сценарий автоматизируется постепенно: на каждом milestone растет пройденная часть.

## 4. Метрика прогресса

Прогресс измеряется **процентом требований (FR + BR + NFR), покрытых проходящими acceptance-тестами**,
а не процентом закрытых задач. Источник — `validation/acceptance-matrix.md`.
