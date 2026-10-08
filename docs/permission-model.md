# Permission Model

| Поле | Значение |
|---|---|
| Задача | T-007 |
| Статус | Draft — ожидает review (T-030) |
| Связанные | ADR-003, security-model.md, SPEC-AUTH-003, SPEC-ITEM-004 |

## 1. Модель

```
decision = can(actor, permissionKey, resource?)
         = actor.status == ACTIVE
         ∧ ∃ role ∈ actor.roles, rp ∈ role.permissions : rp.key == permissionKey ∧ scopeMatches(rp.scope, actor, resource)
         ∧ stateGuard(permissionKey, resource)          ← BR (например, редактирование только DRAFT)
         ∧ ruleGuards(permissionKey, actor, resource)   ← BR-001, BR-015, BR-016, …
```

* **RBAC** — permissions группируются в роли; у пользователя может быть несколько ролей; итоговое право — объединение (наибольший scope).
* **Scope** — область объектов, на которые распространяется permission.
* **Ownership** — частный случай scope `OWN`.
* **State guard** и **rule guards** проверяются всегда, даже при scope `ANY` (Admin не обходит BR).
* Решение возвращает `ALLOW` или `DENY(reasonCode)`; reasonCode используется в UI и логах (NFR-OBS-004), но не раскрывает существование недоступного объекта (для чтения → 404).

## 2. Scopes

| Scope | Объект попадает в scope, если… |
|---|---|
| `OWN` | actor = `ownerId` или actor ∈ `authorIds` текущей версии |
| `ASSIGNED` | (а) объект относится (через `assignmentId`) к заданию, где actor — owner или `defaultReviewerId`; **или** (б) объект — предмет (или входит в пакет) `Review`, где у actor активный `ReviewAssignment`; **или** (в) для `assignment.read` студента — задание адресовано actor (лично или через группу) |
| `COURSE` | объект принадлежит курсу, где actor ∈ преподаватели курса |
| `ANY` | любой объект |

Для списков scope переводится в условие запроса (NFR-PERF-003), а не в фильтрацию в памяти.

## 3. Каталог permissions

| Ключ | Описание | Допустимые scopes |
|---|---|---|
| `user.read` | Просмотр пользователей | COURSE (студенты своих курсов), ANY |
| `user.create` | Создание пользователя | ANY |
| `user.update` | Изменение профиля | OWN (только безопасные поля), ANY |
| `user.status.manage` | Блокировка/разблокировка/архив | ANY |
| `user.role.assign` | Назначение ролей | ANY |
| `user.password.reset` | Сброс пароля другому | ANY |
| `role.read` | Просмотр ролей | ANY |
| `role.manage` | Создание ролей, изменение состава permissions | ANY |
| `taxonomy.read` | Чтение предметов/курсов/тем/целей | COURSE, ANY |
| `taxonomy.manage` | Ведение предметов/курсов/тем/целей | COURSE (темы/цели), ANY |
| `group.read` / `group.manage` | Группы студентов | COURSE, ANY |
| `assignment.read` | Чтение заданий | ASSIGNED, COURSE, ANY |
| `assignment.create` | Создание задания | COURSE, ANY |
| `assignment.update` | Изменение, активация, закрытие, продление | OWN, COURSE, ANY |
| `media.read` | Просмотр медиа | ANY (медиатека общая в пределах системы) |
| `media.upload` | Загрузка | ANY |
| `media.update` | Изменение метаданных | OWN, ANY |
| `media.archive` | Архив/восстановление | OWN, ANY |
| `media.rights.manage` | Установка статуса прав (`CLEARED`, `RESTRICTED`) | ANY |
| `qtype.read` | Реестр типов | ANY |
| `qtype.manage` | Создание/изменение/активация типов | ANY |
| `item.read` | Чтение вопросов | OWN, ASSIGNED, COURSE, ANY |
| `item.create` | Создание | OWN (результат всегда OWN) |
| `item.update` | Редактирование DRAFT, создание новой версии | OWN, ANY |
| `item.submit` | Отправка/отзыв отправки | OWN |
| `item.archive` | Архив/восстановление | OWN, ANY |
| `test.read` | Чтение тестов | OWN, ASSIGNED, COURSE, ANY |
| `test.create` | Создание | OWN |
| `test.update` | Редактирование DRAFT, новая версия | OWN, ANY |
| `test.random_selection` | Использование SelectionRule | OWN, ANY |
| `test.submit` | Отправка/отзыв | OWN |
| `test.archive` | Архив/восстановление | OWN, ANY |
| `test.publish` | Публикация | ANY |
| `test.withdraw` | Отзыв публикации | ANY |
| `review.read` | Чтение review, комментариев, замечаний | OWN (по своему контенту), ASSIGNED, ANY |
| `review.assign` | Назначение/переназначение reviewers | ASSIGNED (как owner задания), COURSE, ANY |
| `review.perform` | Начать review, checklist, замечания, решения | ASSIGNED |
| `review.comment` | Комментировать / отвечать / отмечать замечание «устранено» | OWN (по своему контенту), ASSIGNED |
| `checklist.manage` | Шаблоны checklist | ANY |
| `audit.read` | Журнал аудита | ANY; история объекта — по праву чтения объекта |

> `review.perform` намеренно ограничен `ASSIGNED` даже для Admin: чтобы принять решение, Admin
> назначает себя reviewer (`review.assign`), что журналируется. Это ответ на вопрос «может ли
> администратор override workflow» — нет, только через разрешенные и видимые в аудите действия.

## 4. Матрица ролей (MVP)

Обозначения: `—` нет права; `own`, `assigned`, `course`, `any` — scope; `own draft` — scope OWN + state guard DRAFT.

### 4.1 Identity & Governance

| Resource / Action | Student | Teacher | Expert | Admin |
|---|---|---|---|---|
| User / read | — | course | — | any |
| User / create | — | — | — | any |
| User / update | own (профиль) | own (профиль) | own (профиль) | any |
| User / block, archive | — | — | — | any (BR-015, BR-016) |
| User / assign role | — | — | — | any (BR-015, BR-016) |
| User / reset password | — | — | — | any |
| Role / read | — | — | — | any |
| Role / manage | — | — | — | any (BR-046) |
| AuditLog / read | — | — | — | any |
| Object history | по праву чтения объекта | по праву чтения | по праву чтения | any |

### 4.2 Educational Structure & Assignments

| Resource / Action | Student | Teacher | Expert | Admin |
|---|---|---|---|---|
| Subject, Course / read | course (свои курсы через группы) | course | any | any |
| Subject, Course / manage | — | — | — | any |
| Topic, Objective / manage | — | course | — | any |
| Group / manage | — | course | — | any |
| Assignment / read | assigned | course | — | any |
| Assignment / create | — | course | — | any |
| Assignment / update, activate, close, extend | — | own, course | — | any |

### 4.3 Media & Question Types

| Resource / Action | Student | Teacher | Expert | Admin |
|---|---|---|---|---|
| Media / read | any | any | any | any |
| Media / upload | any | any | — | any |
| Media / update metadata | own (restricted: без прав) | any | — | any |
| Media / archive | own | own | — | any |
| Media / rights manage | — | any | — | any |
| QuestionType / read | any | any | any | any |
| QuestionType / manage | — | — | — | any |

«Media / manage: restricted» для студента из плана = загрузка и метаданные собственных медиа без права подтверждать права (BR-045).

### 4.4 Item Bank

| Resource / Action | Student | Teacher | Expert | Admin |
|---|---|---|---|---|
| Question / create | own (в активном задании, BR-017/018) | own | — | own |
| Question / read | own | own, assigned, course | assigned | any |
| Question / update | own draft | own draft | — | any draft (state guard сохраняется) |
| Question / submit | own (только в составе теста, каскадом) | own (в т.ч. standalone для банка) | — | own |
| Question / approve | — (BR-001 — даже если бы было) | assigned (review.perform, BR-001) | assigned (BR-001) | assigned (через самоназначение, BR-001) |
| Question / archive | own (только не используемые в не-DRAFT тестах других) | own | — | any |

### 4.5 Test Authoring

| Resource / Action | Student | Teacher | Expert | Admin |
|---|---|---|---|---|
| Test / create | own (из задания, BR-017, BR-033) | own | — | own |
| Test / read | own | own, assigned, course | assigned | any |
| Test / update | own draft | own draft | — | any draft |
| Test / random selection | — | own | — | any |
| Test / submit, recall | own | own | — | own |
| Test / approve, request changes | — | assigned (BR-001) | assigned (BR-001) | assigned (BR-001) |
| Test / publish | — | — | — | any (BR-008) |
| Test / withdraw | — | — | — | any (BR-036) |
| Test / archive, restore | own (не опубликованные) | own | — | any |

### 4.6 Review

| Resource / Action | Student | Teacher | Expert | Admin |
|---|---|---|---|---|
| Review / read | own (по своему контенту) | own, assigned, course | assigned | any |
| Review / assign reviewer | — | assigned (owner задания), course | — | any |
| Review / perform (checklist, issues, decision) | — | assigned | assigned | assigned |
| Review / comment, reply, mark addressed | own (по своему контенту) | own, assigned | assigned | assigned |
| Checklist template / manage | — | — | — | any |

## 5. Acceptance-проверки блока BL-02 (из плана)

| Проверка | Покрытие |
|---|---|
| Студент не может читать чужой private draft | AT-PERM-001 |
| Студент не может approve | AT-PERM-002 |
| Эксперт не может менять пользователей | AT-PERM-003 |
| Администратор имеет полный доступ (в пределах BR) | AT-PERM-004 |
| UI restrictions не заменяют server-side authorization | AT-PERM-005 |

Вся матрица раздела 4 превращается в параметризованный набор тестов `AT-PERM-MATRIX` (по одной проверке на ячейку
и негативной проверке для `—`), выполняемый напрямую против application services и HTTP-actions AdminJS, без UI.
