# Architecture

| Поле | Значение |
|---|---|
| Задача | T-010…T-016 |
| Статус | Draft — ожидает review (T-030) |
| Связанные | ADR-001…ADR-008 |

## 1. Контекст

```
┌───────────────┐      HTTPS       ┌─────────────────────────────────────────────┐
│ Браузер       │ ───────────────► │ App (Node.js, TypeScript)                    │
│ (AdminJS UI)  │                  │                                             │
└───────────────┘                  │  AdminJS (UI adapter)                        │
                                   │      │ actions → commands/queries           │
┌───────────────┐                  │  Application layer (use cases)               │
│ Student Runner│ ── (будущее) ──► │      │                                       │
│ (вне MVP)     │   REST/JSON      │  Domain layer (entities, policies, BR, SM)   │
└───────────────┘                  │      │ ports                                 │
                                   │  Infrastructure (Prisma repos, storage,      │
                                   │  sessions, audit writer, image worker)       │
                                   └─────┬──────────────────────┬────────────────┘
                                         │                      │
                                  ┌──────▼──────┐        ┌──────▼──────────┐
                                  │ PostgreSQL  │        │ Object storage  │
                                  │ (данные,    │        │ (S3-compatible: │
                                  │ сессии,     │        │  медиа)         │
                                  │ аудит)      │        └─────────────────┘
                                  └─────────────┘
```

## 2. Слои (ADR-004)

| Слой | Ответственность | Может зависеть от | Запрещено |
|---|---|---|---|
| `domain` | Сущности, value objects, инварианты, state machines, политики авторизации (чистые функции), BR | ничего (кроме стандартной библиотеки, Ajv-обертки через порт) | импорт AdminJS, Prisma, Express, React |
| `application` | Use cases (commands/queries), транзакции, вызов `AuthorizationService`, запись аудита, оркестрация агрегатов | domain, ports | AdminJS, React |
| `infrastructure` | Реализация портов: репозитории (Prisma), storage, hashing, session store, clock, id | application ports, domain | бизнес-правила |
| `adminjs` (UI adapter) | Ресурсы, actions, компоненты; перевод запросов AdminJS в commands/queries; отображение ошибок | application | прямой доступ к ORM для governed-ресурсов, бизнес-правила |
| `plugins/interactions` | Interaction plugins: schema, editor/preview components, validator, evaluator | domain (контракт плагина) | доступ к БД |

Правило проверяется архитектурным тестом зависимостей (NFR-MAINT-001).

## 3. Интеграция с AdminJS

* **Governed-ресурсы** (Item, ItemVersion, Test, TestVersion, Review, Assignment, User, Role, MediaAsset, QuestionType) подключаются через собственный адаптер `DomainResource` (наследник `BaseResource`), который делегирует `find/count/findOne/create/update/delete` в application layer со scope текущего пользователя. Встроенные `new/edit/delete` переопределены или отключены в пользу domain actions (`submit`, `approve`, `publish`, `createNewVersion`, `archive`, …).
* **Справочные ресурсы без workflow** (Tag, Subject, Course, Topic, LearningObjective, StudentGroup) тоже идут через application layer (нужны scope, аудит и BR-042), но могут использовать типовые CRUD use cases.
* **AuditLog** — read-only ресурс.
* Кастомные компоненты (React): редакторы вопросов (по плагину), конструктор теста, панель review, медиа-пикер, preview. Компоненты вызывают API actions; никакой логики разрешений/состояний внутри компонентов, кроме отображения того, что вернул сервер (`availableActions`).
* Каждый record, отдаваемый в UI, содержит `availableActions` — вычисленные сервером разрешенные действия (FR-PERM-004).

## 4. Транзакции и согласованность

* Один use case = одна транзакция БД: изменение агрегата(ов) + указатели + аудит (NFR-DATA-004, BR-035).
* Оптимистическая блокировка через `revision` (NFR-DATA-003).
* Загрузка файлов: файл пишется в storage до транзакции под временным ключом; запись `MediaAsset` создается в транзакции; осиротевшие файлы удаляются фоновой задачей.
* Генерация производных — фоновая очередь (на MVP — таблица задач в PostgreSQL, ADR-008).

## 5. Модули (bounded contexts → пакеты кода)

| Модуль | Блоки |
|---|---|
| `identity` | BL-01, BL-02 |
| `education` | BL-03, BL-04 |
| `media` | BL-05 |
| `itembank` | BL-06, BL-07 |
| `assessment` | BL-08, BL-10 (публикация) |
| `review` | BL-09 |
| `governance` | BL-11 |
| `delivery` | BL-12 (только типы/модель) |

Межмодульные вызовы — через application-интерфейсы модулей, не через таблицы чужого модуля.

## 6. Будущий Student Runner

Отдельное приложение/endpoint `delivery-api`, использующий те же domain и application слои (модуль `delivery`),
read-only доступ к PUBLISHED TestVersion и запись Attempt/Response. AdminJS для него не используется.
Архитектурное требование MVP — не смешивать UI-адаптер AdminJS с domain, чтобы второй адаптер был возможен (NFR-EXT-005).

## 7. Решения

| ADR | Тема | Статус |
|---|---|---|
| [ADR-001](../decisions/ADR-001-question-type-registry.md) | Хранение QuestionType и schema | Accepted (proposed by plan) |
| [ADR-002](../decisions/ADR-002-versioning.md) | Versioning | Accepted (proposed by plan) |
| [ADR-003](../decisions/ADR-003-authorization.md) | Authorization | Accepted (proposed by plan) |
| [ADR-004](../decisions/ADR-004-business-logic-placement.md) | Расположение бизнес-логики | Accepted (proposed by plan) |
| [ADR-005](../decisions/ADR-005-dynamic-item-data.md) | Динамическая структура вопроса | Proposed |
| [ADR-006](../decisions/ADR-006-authentication.md) | Authentication | Proposed |
| [ADR-007](../decisions/ADR-007-media-storage.md) | Media storage | Proposed |
| [ADR-008](../decisions/ADR-008-technology-stack.md) | Технологический стек | Proposed |
