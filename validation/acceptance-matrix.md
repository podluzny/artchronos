# Acceptance Matrix

| Поле | Значение |
|---|---|
| Задача | T-029 |
| Генерируется | `python3 tools/build_traceability.py` — статусы ⏳ обновляются по результатам CI |

Статусы: ⏳ planned · 🔴 failing · ✓ passing. Источник статусов — `validation/test-results.json` (`npm run test:report`).

## BL-01

### Покрытие требований

| Requirement | Scenario | Test | Status |
|---|---|---|---|
| FR-AUTH-001 | SC-AUTH-001 | AT-AUTH-001.* | ✓ |
| FR-AUTH-004 | SC-AUTH-003 | AT-AUTH-001.* | ✓ |
| FR-AUTH-006 | SC-AUTH-001 | AT-AUTH-001.* | ✓ |
| NFR-SEC-002 | SC-AUTH-001, SC-AUTH-003, SC-AUTH-004 | AT-AUTH-001.*, AT-AUTH-004.* | ✓ |
| NFR-SEC-003 | SC-AUTH-001, SC-AUTH-002, SC-AUTH-003 | AT-AUTH-001.*, AT-AUTH-002.* | ✓ |
| NFR-SEC-005 | SC-AUTH-001, SC-AUTH-003 | AT-AUTH-001.* | ✓ |
| BR-014 | SC-AUTH-001, SC-AUTH-002, SC-AUTH-003 | AT-AUTH-001.*, AT-AUTH-002.*, AT-AUTH-004.* | ✓ |
| BR-035 | SC-AUTH-001, SC-AUTH-003, SC-AUTH-004 | AT-AUTH-001.*, AT-AUTH-004.* | ✓ |
| FR-AUTH-002 | SC-AUTH-002 | AT-AUTH-002.* | ✓ |
| FR-AUTH-003 | SC-AUTH-002 | AT-AUTH-002.* | ✓ |
| NFR-SEC-004 | SC-AUTH-002 | AT-AUTH-002.* | ✓ |
| FR-AUTH-005 | SC-AUTH-004 | AT-AUTH-004.* | ✓ |
| FR-AUTH-007 | SC-USER-001 | AT-AUTH-004.* | ✓ |

### Acceptance tests

| AT | Критерий | Тип | SPEC | Status |
|---|---|---|---|---|
| AT-AUTH-001.1 | Активный пользователь с верным паролем входит; создается сессия с новым id; аудит `auth.login.success` | positive | SPEC-AUTH-001 | ✓ |
| AT-AUTH-001.2 | Неверный пароль и несуществующий email дают идентичный ответ (текст, статус, время ± 20%) | negative | SPEC-AUTH-001 | ✓ |
| AT-AUTH-001.3 | После 5 неудач вход с верным паролем отклоняется 15 минут | negative | SPEC-AUTH-001 | ✓ |
| AT-AUTH-001.4 | `BLOCKED`, `ARCHIVED`, `INVITED` пользователи не входят | negative | SPEC-AUTH-001 | ✓ |
| AT-AUTH-001.5 | Пароль не попадает в логи и аудит | security | SPEC-AUTH-001 | ✓ |
| AT-AUTH-001.6 | Cookie сессии HttpOnly, SameSite=Lax, Secure (prod) | security | SPEC-AUTH-001 | ✓ |
| AT-AUTH-001.7 | Пользователь с `mustChangePassword` не может открыть ни один ресурс до смены пароля | negative | SPEC-AUTH-001 | ✓ |
| AT-AUTH-002.1 | После logout повтор запроса со старым cookie → 401 | negative | SPEC-AUTH-002 | ✓ |
| AT-AUTH-002.2 | Сессия без активности > idle timeout недействительна | negative | SPEC-AUTH-002 | ✓ |
| AT-AUTH-002.3 | Сессия старше absolute timeout недействительна при любой активности | negative | SPEC-AUTH-002 | ✓ |
| AT-AUTH-002.4 | Блокировка пользователя делает недействительными все его сессии немедленно | negative | SPEC-AUTH-002 | ✓ |
| AT-AUTH-002.5 | Изменяющий запрос без CSRF-защиты отклоняется | security | SPEC-AUTH-002 | ✓ |
| AT-AUTH-004.1 | Смена пароля отзывает все прочие сессии пользователя | positive | SPEC-AUTH-004 | ✓ |
| AT-AUTH-004.2 | Слабый пароль отклоняется | negative | SPEC-AUTH-004 | ✓ |
| AT-AUTH-004.3 | Токен одноразовый и ограничен по времени; хранится только hash | security | SPEC-AUTH-004 | ✓ |
| AT-AUTH-004.4 | Пользователь без `user.password.reset` не может сбросить пароль другому | permission | SPEC-AUTH-004 | ✓ |
| AT-AUTH-004.5 | Активация переводит INVITED → ACTIVE | positive | SPEC-AUTH-004 | ✓ |

## BL-02

### Покрытие требований

| Requirement | Scenario | Test | Status |
|---|---|---|---|
| FR-AUTH-006 | SC-AUTH-001 | AT-AUTH-003.* | ✓ |
| FR-PERM-002 | SC-E2E-001, SC-ITEM-005 | AT-AUTH-003.* | ✓ |
| FR-PERM-003 | SC-ITEM-005 | AT-AUTH-003.* | ✓ |
| FR-PERM-004 | SC-E2E-001, SC-ITEM-005 | AT-AUTH-003.* | ✓ |
| NFR-SEC-001 | SC-E2E-001, SC-ITEM-005 | AT-AUTH-003.* | ✓ |
| NFR-SEC-010 | SC-E2E-001, SC-ITEM-005, SC-PERM-001 | AT-AUTH-003.*, AT-USER-002.* | ✓ |
| NFR-PERF-003 | SC-E2E-001, SC-ITEM-005 | AT-AUTH-003.* | ✓ |
| NFR-OBS-004 | SC-E2E-001, SC-ITEM-005 | AT-AUTH-003.* | ✓ |
| BR-001 | SC-E2E-001, SC-ITEM-005 | AT-AUTH-003.* | ✓ |
| BR-004 | SC-E2E-001, SC-ITEM-005 | AT-AUTH-003.* | ✓ |
| BR-013 | SC-E2E-001, SC-ITEM-005 | AT-AUTH-003.* | ✓ |
| BR-015 | SC-E2E-001, SC-ITEM-005, SC-PERM-001 | AT-AUTH-003.*, AT-USER-001.*, AT-USER-002.* | ✓ |
| FR-USER-001 | SC-USER-001 | AT-USER-001.* | ✓ |
| FR-USER-002 | SC-USER-001 | AT-USER-001.* | ✓ |
| FR-USER-003 | SC-USER-003 | AT-USER-001.* | ✓ |
| FR-USER-005 | SC-USER-001 | AT-USER-001.* | ✓ |
| FR-USER-006 | SC-USER-001, SC-USER-003 | AT-USER-001.* | ✓ |
| NFR-AUDIT-001 | SC-PERM-001, SC-USER-001, SC-USER-002 | AT-USER-001.*, AT-USER-002.* | ✓ |
| BR-005 | SC-USER-001, SC-USER-003 | AT-USER-001.* | ✓ |
| BR-014 | SC-USER-001, SC-USER-003 | AT-USER-001.* | ✓ |
| BR-016 | SC-PERM-001, SC-USER-001, SC-USER-002 | AT-USER-001.*, AT-USER-002.* | ✓ |
| BR-035 | SC-PERM-001, SC-USER-001, SC-USER-002 | AT-USER-001.*, AT-USER-002.* | ✓ |
| FR-USER-004 | SC-USER-002 | AT-USER-002.* | ✓ |
| FR-PERM-001 | SC-PERM-001 | AT-USER-002.* | ✓ |
| BR-046 | SC-PERM-001, SC-USER-002 | AT-USER-002.* | ✓ |

### Acceptance tests

| AT | Критерий | Тип | SPEC | Status |
|---|---|---|---|---|
| AT-AUTH-003.1 | Для каждой ячейки матрицы permission-model §4: разрешенное действие выполняется, запрещенное → 403/404 — при прямом вызове application service | permission | SPEC-AUTH-003 | ✓ |
| AT-AUTH-003.2 | То же при прямом HTTP-вызове action AdminJS (подмена recordId/actionName) | permission | SPEC-AUTH-003 | ✓ |
| AT-AUTH-003.3 | Списки возвращают только объекты в scope; подсчет (`count`) соответствует фильтру | permission | SPEC-AUTH-003 | ✓ |
| AT-AUTH-003.4 | Чтение объекта вне scope → 404 | negative | SPEC-AUTH-003 | ✓ |
| AT-AUTH-003.5 | Admin со scope ANY получает отказ при нарушении BR (например, редактирование APPROVED, approve своего контента) | negative | SPEC-AUTH-003 | ✓ |
| AT-AUTH-003.6 | Изменение ролей пользователя применяется со следующего запроса без перелогина | positive | SPEC-AUTH-003 | ✓ |
| AT-AUTH-003.7 | Поля owner/state/authorIds/assignmentId, переданные в payload формы, игнорируются или отклоняются | security | SPEC-AUTH-003 | ✓ |
| AT-AUTH-003.8 | Все use cases декларируют permission (архитектурный тест) | maintainability | SPEC-AUTH-003 | ✓ |
| AT-USER-001.1 | Admin создает студента; пользователь в INVITED, получает ссылку активации; аудит | positive | SPEC-USER-001 | ✓ |
| AT-USER-001.2 | Дубликат email (разный регистр) отклоняется | negative | SPEC-USER-001 | ✓ |
| AT-USER-001.3 | Блокировка отзывает сессии; заблокированный не входит | positive | SPEC-USER-001 | ✓ |
| AT-USER-001.4 | Admin не может заблокировать себя (BR-015) | negative | SPEC-USER-001 | ✓ |
| AT-USER-001.5 | Нельзя заблокировать/архивировать последнего активного Admin (BR-016) | negative | SPEC-USER-001 | ✓ |
| AT-USER-001.6 | Физическое удаление пользователя невозможно | negative | SPEC-USER-001 | ✓ |
| AT-USER-001.7 | Expert/Student не может создавать и изменять пользователей | permission | SPEC-USER-001 | ✓ |
| AT-USER-001.8 | Teacher видит в списке только студентов своих курсов | permission | SPEC-USER-001 | ✓ |
| AT-USER-002.1 | Admin назначает роль; запись аудита содержит до/после | positive | SPEC-USER-002 | ✓ |
| AT-USER-002.2 | Пользователь не может изменить собственные роли (в т.ч. Admin) | negative | SPEC-USER-002 | ✓ |
| AT-USER-002.3 | Нельзя снять ADMIN у последнего активного администратора | negative | SPEC-USER-002 | ✓ |
| AT-USER-002.4 | Нельзя удалить системную роль | negative | SPEC-USER-002 | ✓ |
| AT-USER-002.5 | Неподдерживаемый scope permission отклоняется | negative | SPEC-USER-002 | ✓ |
| AT-USER-002.6 | Изменение состава роли журналируется (NFR-AUDIT-001) | audit | SPEC-USER-002 | ✓ |
| AT-USER-002.7 | Эксперт не может менять пользователей и роли | permission | SPEC-USER-002 | ✓ |

## BL-03

### Покрытие требований

| Requirement | Scenario | Test | Status |
|---|---|---|---|
| FR-EDU-001 | SC-EDU-001 | AT-EDU-001.* | ✓ |
| FR-EDU-002 | SC-EDU-001 | AT-EDU-001.* | ✓ |
| FR-EDU-003 | SC-EDU-001 | AT-EDU-001.* | ✓ |
| FR-EDU-005 | SC-EDU-001 | AT-EDU-001.* | ✓ |
| BR-039 | SC-AUDIT-003, SC-EDU-001 | AT-EDU-001.* | ✓ |
| BR-042 | SC-AUDIT-003, SC-EDU-001 | AT-EDU-001.* | ✓ |
| BR-035 | SC-AUDIT-003, SC-EDU-001, SC-EDU-002 | AT-EDU-001.*, AT-EDU-002.* | ✓ |
| FR-EDU-004 | SC-EDU-002 | AT-EDU-002.* | ✓ |

### Acceptance tests

| AT | Критерий | Тип | SPEC | Status |
|---|---|---|---|---|
| AT-EDU-001.1 | Teacher создает тему и подтему в своем курсе | positive | SPEC-EDU-001 | ✓ |
| AT-EDU-001.2 | Teacher не может изменять темы чужого курса | permission | SPEC-EDU-001 | ✓ |
| AT-EDU-001.3 | Удаление используемой темы невозможно; доступно архивирование | negative | SPEC-EDU-001 | ✓ |
| AT-EDU-001.4 | Архивированная тема недоступна для выбора в новом задании/вопросе | negative | SPEC-EDU-001 | ✓ |
| AT-EDU-001.5 | Цикл в иерархии тем отклоняется | negative | SPEC-EDU-001 | ✓ |
| AT-EDU-002.1 | Teacher создает группу в своем курсе и добавляет студентов | positive | SPEC-EDU-002 | ✓ |
| AT-EDU-002.2 | Пользователь без роли STUDENT не добавляется | negative | SPEC-EDU-002 | ✓ |
| AT-EDU-002.3 | Студент видит курс через членство в группе | positive | SPEC-EDU-002 | ✓ |
| AT-EDU-002.4 | Teacher не управляет группами чужого курса | permission | SPEC-EDU-002 | ✓ |

## BL-04

### Покрытие требований

| Requirement | Scenario | Test | Status |
|---|---|---|---|
| FR-ASSIGN-001 | SC-ASSIGN-001 | AT-ASSIGN-001.* | ✓ |
| FR-ASSIGN-002 | SC-ASSIGN-001 | AT-ASSIGN-001.* | ✓ |
| FR-ASSIGN-003 | SC-ASSIGN-001 | AT-ASSIGN-001.* | ✓ |
| FR-ASSIGN-006 | SC-ASSIGN-001 | AT-ASSIGN-001.* | ✓ |
| BR-018 | SC-ASSIGN-001, SC-E2E-001 | AT-ASSIGN-001.* | ✓ |
| BR-021 | SC-ASSIGN-001, SC-E2E-001 | AT-ASSIGN-001.* | ✓ |
| BR-027 | SC-ASSIGN-001, SC-E2E-001 | AT-ASSIGN-001.* | ✓ |
| BR-039 | SC-ASSIGN-001, SC-E2E-001 | AT-ASSIGN-001.* | ✓ |
| BR-043 | SC-ASSIGN-001, SC-E2E-001 | AT-ASSIGN-001.* | ✓ |
| FR-ASSIGN-004 | SC-ASSIGN-003 | AT-ASSIGN-002.* | ◐ |
| FR-ASSIGN-005 | SC-ASSIGN-002 | AT-ASSIGN-002.* | ◐ |
| FR-ASSIGN-007 | SC-TEST-001 | AT-ASSIGN-002.* | ◐ |
| FR-ASSIGN-008 | SC-ASSIGN-002 | AT-ASSIGN-002.* | ◐ |
| BR-017 | SC-ASSIGN-002, SC-ASSIGN-003, SC-TEST-001 | AT-ASSIGN-002.* | ◐ |
| BR-031 | SC-ASSIGN-002, SC-ASSIGN-003, SC-TEST-001 | AT-ASSIGN-002.* | ◐ |
| BR-035 | SC-ASSIGN-002, SC-ASSIGN-003, SC-TEST-001 | AT-ASSIGN-002.* | ◐ |

### Acceptance tests

| AT | Критерий | Тип | SPEC | Status |
|---|---|---|---|---|
| AT-ASSIGN-001.1 | Teacher создает задание в своем курсе с темами, целями, типами, ограничениями, дедлайном, адресатами | positive | SPEC-ASSIGN-001 | ✓ |
| AT-ASSIGN-001.2 | Студент не может создать задание | permission | SPEC-ASSIGN-001 | ✓ |
| AT-ASSIGN-001.3 | Teacher не может создать задание в чужом курсе | permission | SPEC-ASSIGN-001 | ✓ |
| AT-ASSIGN-001.4 | Неактивный тип вопроса нельзя выбрать | negative | SPEC-ASSIGN-001 | ✓ |
| AT-ASSIGN-001.5 | minItems > maxItems отклоняется | negative | SPEC-ASSIGN-001 | ✓ |
| AT-ASSIGN-001.6 | Default reviewer без `review.perform` отклоняется | negative | SPEC-ASSIGN-001 | ✓ |
| AT-ASSIGN-002.1 | Студент видит только адресованные ему задания (лично или через группу) | permission | SPEC-ASSIGN-002 | ✓ |
| AT-ASSIGN-002.2 | После CLOSED студент не может создать Item/Test и отправить версию по заданию | negative | SPEC-ASSIGN-002 | ✓ |
| AT-ASSIGN-002.3 | Первая отправка после дедлайна отклоняется; с продлением — принимается | negative/positive | SPEC-ASSIGN-002 | ✓ |
| AT-ASSIGN-002.4 | Повторная отправка после CHANGES_REQUESTED после дедлайна, при ACTIVE задании, принимается | positive | SPEC-ASSIGN-002 | ✓ |
| AT-ASSIGN-002.5 | Активация без адресатов отклоняется | negative | SPEC-ASSIGN-002 | ✓ |
| AT-ASSIGN-002.6 | Сводка показывает состояние последней версии теста каждого адресата | positive | SPEC-ASSIGN-002 | ⏳ |

## BL-05

### Покрытие требований

| Requirement | Scenario | Test | Status |
|---|---|---|---|
| FR-MEDIA-001 | SC-MEDIA-001 | AT-MEDIA-001.* | ◐ |
| FR-MEDIA-002 | SC-MEDIA-001 | AT-MEDIA-001.* | ◐ |
| FR-MEDIA-004 | SC-MEDIA-001 | AT-MEDIA-001.* | ◐ |
| FR-MEDIA-005 | SC-MEDIA-003 | AT-MEDIA-001.* | ◐ |
| FR-MEDIA-008 | SC-MEDIA-001 | AT-MEDIA-001.* | ◐ |
| NFR-SEC-006 | SC-MEDIA-001, SC-MEDIA-003 | AT-MEDIA-001.* | ◐ |
| NFR-PERF-004 | SC-MEDIA-001, SC-MEDIA-003 | AT-MEDIA-001.* | ◐ |
| BR-025 | SC-MEDIA-001, SC-MEDIA-003 | AT-MEDIA-001.* | ◐ |
| BR-045 | SC-AUDIT-003, SC-MEDIA-001, SC-MEDIA-002 | AT-MEDIA-001.*, AT-MEDIA-002.* | ◐ |
| BR-035 | SC-AUDIT-003, SC-MEDIA-001, SC-MEDIA-002 | AT-MEDIA-001.*, AT-MEDIA-002.* | ◐ |
| FR-MEDIA-003 | SC-MEDIA-002 | AT-MEDIA-002.* | ◐ |
| FR-MEDIA-006 | SC-MEDIA-002 | AT-MEDIA-002.* | ◐ |
| FR-MEDIA-007 | SC-MEDIA-002 | AT-MEDIA-002.* | ◐ |
| BR-005 | SC-AUDIT-003, SC-MEDIA-002 | AT-MEDIA-002.* | ◐ |
| BR-024 | SC-AUDIT-003, SC-MEDIA-002 | AT-MEDIA-002.* | ◐ |
| BR-026 | SC-AUDIT-003, SC-MEDIA-002 | AT-MEDIA-002.* | ◐ |
| BR-039 | SC-AUDIT-003, SC-MEDIA-002 | AT-MEDIA-002.* | ◐ |

### Acceptance tests

| AT | Критерий | Тип | SPEC | Status |
|---|---|---|---|---|
| AT-MEDIA-001.1 | Загрузка JPEG/PNG/WebP/MP4 создает MediaAsset с PENDING и превью | positive | SPEC-MEDIA-001 | ✓ |
| AT-MEDIA-001.2 | Файл с подмененным расширением (например, HTML как .jpg) отклоняется | security | SPEC-MEDIA-001 | ✓ |
| AT-MEDIA-001.3 | Превышение лимита размера отклоняется | negative | SPEC-MEDIA-001 | ✓ |
| AT-MEDIA-001.4 | Клиентское значение rightsStatus при загрузке игнорируется | security | SPEC-MEDIA-001 | ✓ |
| AT-MEDIA-001.5 | GPS-метаданные удаляются из изображения | security | SPEC-MEDIA-001 | ✓ |
| AT-MEDIA-001.6 | Поиск по artist/workTitle/тегу находит медиа | positive | SPEC-MEDIA-001 | ✓ |
| AT-MEDIA-001.7 | Файл недоступен без аутентификации; прямой URL storage недоступен | security | SPEC-MEDIA-001 | ⏳ |
| AT-MEDIA-002.1 | Teacher устанавливает CLEARED при заполненных обязательных полях; аудит | positive | SPEC-MEDIA-002 | ✓ |
| AT-MEDIA-002.2 | Student не может установить CLEARED (прямой запрос) | permission | SPEC-MEDIA-002 | ✓ |
| AT-MEDIA-002.3 | Изменение лицензии студентом у CLEARED медиа возвращает PENDING | positive | SPEC-MEDIA-002 | ✓ |
| AT-MEDIA-002.4 | Удаление медиа, используемого не-DRAFT версией, отклоняется | negative | SPEC-MEDIA-002 | ⏳ |
| AT-MEDIA-002.5 | Архивированное медиа нельзя выбрать в новом вопросе | negative | SPEC-MEDIA-002 | ⏳ |
| AT-MEDIA-002.6 | «Где используется» показывает ссылки через ItemOption и ItemMedia | positive | SPEC-MEDIA-002 | ⏳ |
| AT-MEDIA-002.7 | RESTRICTED показывает затронутые опубликованные тесты | positive | SPEC-MEDIA-002 | ✓ |

## BL-06

### Покрытие требований

| Requirement | Scenario | Test | Status |
|---|---|---|---|
| FR-QTYPE-001 | SC-QTYPE-001 | AT-QTYPE-001.* | ✓ |
| FR-QTYPE-002 | SC-QTYPE-001 | AT-QTYPE-001.* | ✓ |
| FR-QTYPE-003 | SC-QTYPE-002 | AT-QTYPE-001.* | ✓ |
| FR-QTYPE-004 | SC-QTYPE-002 | AT-QTYPE-001.* | ✓ |
| NFR-EXT-001 | SC-ITEM-001, SC-ITEM-002, SC-ITEM-004 | AT-QTYPE-001.*, AT-QTYPE-002.* | ◐ |
| BR-021 | SC-QTYPE-001, SC-QTYPE-002 | AT-QTYPE-001.* | ✓ |
| BR-022 | SC-QTYPE-001, SC-QTYPE-002 | AT-QTYPE-001.* | ✓ |
| BR-023 | SC-ITEM-001, SC-ITEM-002, SC-ITEM-004 | AT-QTYPE-001.*, AT-QTYPE-002.* | ◐ |
| BR-035 | SC-QTYPE-001, SC-QTYPE-002 | AT-QTYPE-001.* | ✓ |
| FR-QTYPE-005 | SC-ITEM-001 | AT-QTYPE-002.* | ◐ |
| FR-QTYPE-006 | SC-ITEM-001, SC-ITEM-002, SC-ITEM-004 | AT-QTYPE-002.* | ◐ |
| FR-DELIV-002 | SC-ITEM-004 | AT-QTYPE-002.* | ◐ |
| NFR-EXT-002 | SC-ITEM-001, SC-ITEM-002, SC-ITEM-004 | AT-QTYPE-002.* | ◐ |
| NFR-SEC-007 | SC-ITEM-001, SC-ITEM-002, SC-ITEM-004 | AT-QTYPE-002.* | ◐ |
| BR-020 | SC-ITEM-001, SC-ITEM-002, SC-ITEM-004 | AT-QTYPE-002.* | ◐ |
| INV-015 | SC-ITEM-001, SC-ITEM-002, SC-ITEM-004 | AT-QTYPE-002.* | ◐ |

### Acceptance tests

| AT | Критерий | Тип | SPEC | Status |
|---|---|---|---|---|
| AT-QTYPE-001.1 | Admin создает тип на основе `choice` с обязательным стимулом; создается v1 | positive | SPEC-QTYPE-001 | ✓ |
| AT-QTYPE-001.2 | Тип с несуществующим interactionKey не создается | negative | SPEC-QTYPE-001 | ✓ |
| AT-QTYPE-001.3 | Изменение конфигурации создает v2; существующие ItemVersion остаются на v1 | positive | SPEC-QTYPE-001 | ✓ |
| AT-QTYPE-001.4 | Деактивированный тип недоступен для новых Item; существующие работают | positive | SPEC-QTYPE-001 | ✓ |
| AT-QTYPE-001.5 | Teacher/Student/Expert не могут управлять типами | permission | SPEC-QTYPE-001 | ✓ |
| AT-QTYPE-001.6 | QuestionTypeVersion неизменна (прямой UPDATE отклоняется) | negative | SPEC-QTYPE-001 | ✓ |
| AT-QTYPE-002.1 | Contract test suite проходит для каждого MVP-плагина (`choice`, `match`, `order`, `text_entry`, `extended_text`) | contract | SPEC-QTYPE-002 | ✓ |
| AT-QTYPE-002.2 | Регистрация плагина-фикстуры добавляет тип без миграции БД | extensibility | SPEC-QTYPE-002 | ✓ |
| AT-QTYPE-002.3 | Отсутствующий плагин для существующего типа → ошибка старта | negative | SPEC-QTYPE-002 | ⏳ |
| AT-QTYPE-002.4 | Evaluators MVP вычисляют ожидаемые баллы на эталонном наборе ответов | positive | SPEC-QTYPE-002 | ✓ |
| AT-QTYPE-002.5 | Компоненты плагинов проходят axe-core без нарушений уровня AA | a11y | SPEC-QTYPE-002 | ⏳ |

## BL-07

### Покрытие требований

| Requirement | Scenario | Test | Status |
|---|---|---|---|
| FR-ITEM-001 | SC-ITEM-001, SC-ITEM-002 | AT-ITEM-001.* | ✓ |
| FR-ITEM-002 | SC-ITEM-002 | AT-ITEM-001.* | ✓ |
| FR-ITEM-005 | SC-ITEM-001 | AT-ITEM-001.* | ✓ |
| BR-017 | SC-E2E-001, SC-ITEM-001, SC-ITEM-002 | AT-ITEM-001.* | ✓ |
| BR-018 | SC-E2E-001, SC-ITEM-001, SC-ITEM-002 | AT-ITEM-001.* | ✓ |
| BR-019 | SC-E2E-001, SC-ITEM-001, SC-ITEM-002 | AT-ITEM-001.*, AT-ITEM-002.* | ◐ |
| BR-020 | SC-E2E-001, SC-ITEM-001, SC-ITEM-002 | AT-ITEM-001.*, AT-ITEM-002.* | ◐ |
| BR-021 | SC-E2E-001, SC-ITEM-001, SC-ITEM-002 | AT-ITEM-001.* | ✓ |
| BR-024 | SC-E2E-001, SC-ITEM-001, SC-ITEM-002 | AT-ITEM-001.*, AT-ITEM-002.* | ◐ |
| BR-025 | SC-E2E-001, SC-ITEM-001, SC-ITEM-002 | AT-ITEM-001.*, AT-ITEM-002.* | ◐ |
| BR-039 | SC-E2E-001, SC-ITEM-001, SC-ITEM-002 | AT-ITEM-001.*, AT-ITEM-002.*, AT-ITEM-005.* | ◐ |
| BR-004 | SC-E2E-001, SC-ITEM-001, SC-ITEM-002 | AT-ITEM-001.*, AT-ITEM-002.*, AT-ITEM-004.* | ◐ |
| FR-ITEM-003 | SC-ITEM-003 | AT-ITEM-002.* | ◐ |
| FR-ITEM-004 | SC-VERSION-002 | AT-ITEM-002.* | ◐ |
| FR-ITEM-008 | SC-VERSION-002 | AT-ITEM-002.* | ◐ |
| FR-ITEM-009 | SC-ITEM-006 | AT-ITEM-002.* | ◐ |
| FR-ITEM-010 | SC-ITEM-007 | AT-ITEM-002.* | ◐ |
| NFR-DATA-001 | SC-ITEM-003, SC-ITEM-006, SC-ITEM-007 | AT-ITEM-002.* | ◐ |
| NFR-DATA-003 | SC-ITEM-003, SC-ITEM-006, SC-ITEM-007 | AT-ITEM-002.* | ◐ |
| BR-003 | SC-ITEM-003, SC-ITEM-006, SC-ITEM-007 | AT-ITEM-002.* | ◐ |
| BR-005 | SC-ITEM-003, SC-ITEM-006, SC-ITEM-007 | AT-ITEM-002.* | ◐ |
| BR-006 | SC-E2E-001, SC-ITEM-003, SC-ITEM-005 | AT-ITEM-002.*, AT-ITEM-004.* | ◐ |
| BR-007 | SC-E2E-001, SC-ITEM-003, SC-ITEM-005 | AT-ITEM-002.*, AT-ITEM-004.* | ◐ |
| BR-038 | SC-ITEM-003, SC-ITEM-006, SC-ITEM-007 | AT-ITEM-002.* | ◐ |
| BR-041 | SC-ITEM-003, SC-ITEM-006, SC-ITEM-007 | AT-ITEM-002.* | ◐ |
| BR-044 | SC-ITEM-003, SC-ITEM-006, SC-ITEM-007 | AT-ITEM-002.* | ◐ |
| FR-ITEM-006 | SC-ITEM-004 | AT-ITEM-003.* | ✓ |
| FR-DELIV-002 | SC-ITEM-004 | AT-ITEM-003.* | ✓ |
| NFR-SEC-008 | SC-ITEM-004 | AT-ITEM-003.* | ✓ |
| FR-ITEM-011 | SC-ITEM-005 | AT-ITEM-004.* | ✓ |
| FR-PERM-002 | SC-E2E-001, SC-ITEM-005 | AT-ITEM-004.* | ✓ |
| FR-PERM-003 | SC-ITEM-005 | AT-ITEM-004.*, AT-ITEM-005.* | ◐ |
| NFR-SEC-001 | SC-E2E-001, SC-ITEM-005 | AT-ITEM-004.* | ✓ |
| BR-001 | SC-E2E-001, SC-ITEM-005 | AT-ITEM-004.* | ✓ |
| FR-ITEM-007 | SC-ITEM-005 | AT-ITEM-005.* | ◐ |
| NFR-PERF-001 | SC-ITEM-005, SC-TEST-002 | AT-ITEM-005.* | ◐ |
| NFR-PERF-003 | SC-ITEM-005, SC-TEST-002 | AT-ITEM-005.* | ◐ |

### Acceptance tests

| AT | Критерий | Тип | SPEC | Status |
|---|---|---|---|---|
| AT-ITEM-001.1 | После выбора single_choice отображаются варианты ответа | UI | SPEC-ITEM-001 | ✓ |
| AT-ITEM-001.2 | Для image_choice отображается выбор MediaAsset | UI | SPEC-ITEM-001 | ✓ |
| AT-ITEM-001.3 | Невалидная конфигурация не может быть сохранена (структурно) и не может быть отправлена (по schema) | negative | SPEC-ITEM-001 | ✓ |
| AT-ITEM-001.4 | После сохранения создается Draft version v1, owner = автор | positive | SPEC-ITEM-001 | ✓ |
| AT-ITEM-001.5 | Пользователь без item.create не может вызвать action создания (403 при прямом вызове) | permission | SPEC-ITEM-001 | ✓ |
| AT-ITEM-001.6 | Студент не может создать вопрос типа, не разрешенного заданием (прямой запрос) | negative | SPEC-ITEM-001 | ✓ |
| AT-ITEM-001.7 | Студент не может создать вопрос вне активного адресованного задания | negative | SPEC-ITEM-001 | ✓ |
| AT-ITEM-001.8 | Переданные в payload ownerId/state игнорируются | security | SPEC-ITEM-001 | ✓ |
| AT-ITEM-001.9 | Архивированное или RESTRICTED медиа нельзя выбрать | negative | SPEC-ITEM-001 | ✓ |
| AT-ITEM-002.1 | Владелец редактирует свой DRAFT; аудит с diff | positive | SPEC-ITEM-002 | ✓ |
| AT-ITEM-002.2 | Студент не может редактировать чужой DRAFT (404) | permission | SPEC-ITEM-002 | ✓ |
| AT-ITEM-002.3 | Никто (включая Admin) не может редактировать READY_FOR_REVIEW/IN_REVIEW/APPROVED версию | negative | SPEC-ITEM-002 | ✓ |
| AT-ITEM-002.4 | Новая версия: v(N+1) DRAFT, basedOn, option keys сохранены, исходная версия не изменилась (contentHash) | positive | SPEC-ITEM-002 | ✓ |
| AT-ITEM-002.5 | Второй DRAFT создать нельзя | negative | SPEC-ITEM-002 | ✓ |
| AT-ITEM-002.6 | Auto-rebind обновляет ссылку в DRAFT тесте автора и не трогает не-DRAFT тесты | positive | SPEC-ITEM-002 | ⏳ |
| AT-ITEM-002.7 | Конфликт revision возвращает 409 без потери данных | concurrency | SPEC-ITEM-002 | ✓ |
| AT-ITEM-002.8 | Recall возможен до начала review и невозможен после | positive/negative | SPEC-ITEM-002 | ✓ |
| AT-ITEM-002.9 | Архивированный Item не добавляется в новые тесты; существующие тесты не затронуты | negative | SPEC-ITEM-002 | ✓ |
| AT-ITEM-002.10 | Hard delete возможен только для неотправлявшегося DRAFT без ссылок | negative | SPEC-ITEM-002 | ✓ |
| AT-ITEM-003.1 | Preview отображает вопрос через компонент плагина | positive | SPEC-ITEM-003 | ✓ |
| AT-ITEM-003.2 | Ответ оценивается evaluator'ом; результат совпадает с эталоном | positive | SPEC-ITEM-003 | ✓ |
| AT-ITEM-003.3 | Preview не создает записей Attempt/Response и не меняет версию | negative | SPEC-ITEM-003 | ✓ |
| AT-ITEM-003.4 | Preview недоступен без `item.read` (404) | permission | SPEC-ITEM-003 | ✓ |
| AT-ITEM-004.1 | Студент A не видит в списке и не открывает по id вопросы студента B (любое состояние) | permission | SPEC-ITEM-004 | ✓ |
| AT-ITEM-004.2 | Teacher видит DRAFT студентов своего задания и не видит DRAFT в чужих курсах | permission | SPEC-ITEM-004 | ✓ |
| AT-ITEM-004.3 | Expert видит только вопросы назначенных ему review | permission | SPEC-ITEM-004 | ✓ |
| AT-ITEM-004.4 | Teacher курса видит APPROVED вопросы банка курса других авторов | positive | SPEC-ITEM-004 | ✓ |
| AT-ITEM-004.5 | Студент не может approve вопрос (нет `review.perform`) | permission | SPEC-ITEM-004 | ✓ |
| AT-ITEM-004.6 | count() списка соответствует видимым записям | permission | SPEC-ITEM-004 | ✓ |
| AT-ITEM-005.1 | Фильтр по теме включает подтемы | positive | SPEC-ITEM-005 | ✓ |
| AT-ITEM-005.2 | Комбинация фильтров возвращает корректное пересечение | positive | SPEC-ITEM-005 | ✓ |
| AT-ITEM-005.3 | Архивированные скрыты по умолчанию | positive | SPEC-ITEM-005 | ✓ |
| AT-ITEM-005.4 | Список на 50 000 вопросов открывается ≤ 1.5 с p95 | performance | SPEC-ITEM-005 | ⏳ |
| AT-ITEM-005.5 | Drawer показывает preview и историю версий | UI | SPEC-ITEM-005 | ⏳ |

## BL-08

### Покрытие требований

| Requirement | Scenario | Test | Status |
|---|---|---|---|
| FR-TEST-001 | SC-TEST-001 | AT-TEST-001.* | ⏳ |
| BR-017 | SC-E2E-001, SC-TEST-001, SC-TEST-005 | AT-TEST-001.*, AT-TEST-004.* | ⏳ |
| BR-033 | SC-E2E-001, SC-TEST-001 | AT-TEST-001.* | ⏳ |
| BR-043 | SC-E2E-001, SC-TEST-001 | AT-TEST-001.* | ⏳ |
| FR-TEST-002 | SC-TEST-002 | AT-TEST-002.* | ⏳ |
| FR-TEST-003 | SC-TEST-002 | AT-TEST-002.* | ⏳ |
| FR-TEST-004 | SC-TEST-003 | AT-TEST-002.* | ⏳ |
| BR-004 | SC-TEST-002, SC-TEST-003 | AT-TEST-002.* | ⏳ |
| BR-007 | SC-E2E-001, SC-TEST-002, SC-TEST-003 | AT-TEST-002.*, AT-TEST-003.*, AT-TEST-004.* | ⏳ |
| BR-010 | SC-TEST-002, SC-TEST-003 | AT-TEST-002.* | ⏳ |
| BR-011 | SC-E2E-001, SC-TEST-002, SC-TEST-003 | AT-TEST-002.*, AT-TEST-004.* | ⏳ |
| BR-012 | SC-E2E-001, SC-TEST-002, SC-TEST-003 | AT-TEST-002.*, AT-TEST-004.* | ⏳ |
| BR-039 | SC-TEST-002, SC-TEST-003 | AT-TEST-002.* | ⏳ |
| FR-TEST-005 | SC-TEST-004 | AT-TEST-003.* | ⏳ |
| FR-TEST-008 | SC-TEST-006 | AT-TEST-003.* | ⏳ |
| FR-TEST-006 | SC-TEST-005 | AT-TEST-004.* | ⏳ |
| FR-TEST-007 | SC-VERSION-001 | AT-TEST-004.* | ⏳ |
| FR-TEST-009 | SC-TEST-005 | AT-TEST-004.* | ⏳ |
| NFR-DATA-004 | SC-E2E-001, SC-TEST-005, SC-VERSION-001 | AT-TEST-004.* | ⏳ |
| NFR-DATA-005 | SC-E2E-001, SC-TEST-005, SC-VERSION-001 | AT-TEST-004.* | ⏳ |
| BR-002 | SC-E2E-001, SC-TEST-005, SC-VERSION-001 | AT-TEST-004.* | ⏳ |
| BR-003 | SC-E2E-001, SC-TEST-005, SC-VERSION-001 | AT-TEST-004.* | ⏳ |
| BR-020 | SC-E2E-001, SC-TEST-005, SC-VERSION-001 | AT-TEST-004.* | ⏳ |
| BR-024 | SC-E2E-001, SC-TEST-005, SC-VERSION-001 | AT-TEST-004.* | ⏳ |
| BR-025 | SC-E2E-001, SC-TEST-005, SC-VERSION-001 | AT-TEST-004.* | ⏳ |
| BR-031 | SC-E2E-001, SC-TEST-005, SC-VERSION-001 | AT-TEST-004.* | ⏳ |
| BR-032 | SC-E2E-001, SC-TEST-005, SC-VERSION-001 | AT-TEST-004.* | ⏳ |
| BR-038 | SC-E2E-001, SC-TEST-005, SC-VERSION-001 | AT-TEST-004.* | ⏳ |
| BR-041 | SC-E2E-001, SC-TEST-005, SC-VERSION-001 | AT-TEST-004.* | ⏳ |

### Acceptance tests

| AT | Критерий | Тип | SPEC | Status |
|---|---|---|---|---|
| AT-TEST-001.1 | Студент создает тест из задания: Test + v1 DRAFT + раздел по умолчанию | positive | SPEC-TEST-001 | ⏳ |
| AT-TEST-001.2 | Второй тест при maxTestsPerStudent = 1 отклоняется | negative | SPEC-TEST-001 | ⏳ |
| AT-TEST-001.3 | Создание теста в неадресованном/закрытом задании отклоняется | negative | SPEC-TEST-001 | ⏳ |
| AT-TEST-001.4 | Expert не может создать тест | permission | SPEC-TEST-001 | ⏳ |
| AT-TEST-002.1 | Добавленный вопрос хранится как ссылка на конкретную ItemVersion | positive | SPEC-TEST-002 | ⏳ |
| AT-TEST-002.2 | Один Item нельзя добавить дважды | negative | SPEC-TEST-002 | ⏳ |
| AT-TEST-002.3 | Студент не может добавить чужой вопрос (любого состояния) | permission | SPEC-TEST-002 | ⏳ |
| AT-TEST-002.4 | Студент не может создать SelectionRule | permission | SPEC-TEST-002 | ⏳ |
| AT-TEST-002.5 | Размер пула считается только по APPROVED активным вопросам курса | positive | SPEC-TEST-002 | ⏳ |
| AT-TEST-002.6 | Структуру не-DRAFT версии изменить нельзя | negative | SPEC-TEST-002 | ⏳ |
| AT-TEST-002.7 | Архивированный Item нельзя добавить | negative | SPEC-TEST-002 | ⏳ |
| AT-TEST-003.1 | Настройки сохраняются в DRAFT и неизменны после submit | positive/negative | SPEC-TEST-003 | ⏳ |
| AT-TEST-003.2 | Невалидные значения отклоняются | negative | SPEC-TEST-003 | ⏳ |
| AT-TEST-003.3 | Preview с одинаковым seed дает одинаковую выборку и порядок | positive | SPEC-TEST-003 | ⏳ |
| AT-TEST-003.4 | Preview APPROVED версии использует замороженный пул | positive | SPEC-TEST-003 | ⏳ |
| AT-TEST-004.1 | Submit замораживает TestVersion и собственные DRAFT ItemVersion; создается Review с назначением | positive | SPEC-TEST-004 | ⏳ |
| AT-TEST-004.2 | После submit изменить версию нельзя никому (прямой запрос) | negative | SPEC-TEST-004 | ⏳ |
| AT-TEST-004.3 | Submit с невалидным вопросом/без alt/с PENDING медиа отклоняется со списком причин | negative | SPEC-TEST-004 | ⏳ |
| AT-TEST-004.4 | Число вопросов вне [min,max] или неразрешенный тип → отказ (BR-032) | negative | SPEC-TEST-004 | ⏳ |
| AT-TEST-004.5 | Первая отправка после дедлайна → отказ (BR-031) | negative | SPEC-TEST-004 | ⏳ |
| AT-TEST-004.6 | Recall до начала review возвращает DRAFT; после — невозможен | positive/negative | SPEC-TEST-004 | ⏳ |
| AT-TEST-004.7 | Новая версия после CHANGES_REQUESTED: v2 DRAFT, вопросы автора в CHANGES_REQUESTED получили новые DRAFT-версии, v1 неизменна | positive | SPEC-TEST-004 | ⏳ |
| AT-TEST-004.8 | Все изменения submit атомарны: сбой на любом шаге не оставляет частичных изменений | data | SPEC-TEST-004 | ⏳ |

## BL-09

### Покрытие требований

| Requirement | Scenario | Test | Status |
|---|---|---|---|
| FR-REVIEW-001 | SC-REVIEW-001 | AT-REVIEW-001.* | ⏳ |
| FR-REVIEW-002 | SC-REVIEW-004 | AT-REVIEW-001.* | ⏳ |
| FR-REVIEW-003 | SC-REVIEW-001 | AT-REVIEW-001.* | ⏳ |
| BR-001 | SC-E2E-001, SC-REVIEW-001, SC-REVIEW-002 | AT-REVIEW-001.*, AT-REVIEW-003.* | ⏳ |
| BR-027 | SC-E2E-001, SC-REVIEW-001, SC-REVIEW-004 | AT-REVIEW-001.* | ⏳ |
| BR-030 | SC-E2E-001, SC-REVIEW-001, SC-REVIEW-002 | AT-REVIEW-001.*, AT-REVIEW-002.*, AT-REVIEW-003.* | ⏳ |
| BR-035 | SC-E2E-001, SC-REVIEW-001, SC-REVIEW-004 | AT-REVIEW-001.* | ⏳ |
| FR-REVIEW-004 | SC-REVIEW-003 | AT-REVIEW-002.* | ⏳ |
| FR-REVIEW-005 | SC-REVIEW-002 | AT-REVIEW-002.* | ⏳ |
| FR-REVIEW-006 | SC-REVIEW-002, SC-REVIEW-005 | AT-REVIEW-002.* | ⏳ |
| FR-REVIEW-009 | SC-REVIEW-005 | AT-REVIEW-002.* | ⏳ |
| FR-REVIEW-010 | SC-REVIEW-006 | AT-REVIEW-002.* | ⏳ |
| BR-028 | SC-E2E-001, SC-REVIEW-002, SC-REVIEW-003 | AT-REVIEW-002.*, AT-REVIEW-003.* | ⏳ |
| BR-040 | SC-E2E-001, SC-REVIEW-002, SC-REVIEW-003 | AT-REVIEW-002.*, AT-REVIEW-003.* | ⏳ |
| FR-REVIEW-007 | SC-REVIEW-002 | AT-REVIEW-003.* | ⏳ |
| FR-REVIEW-008 | SC-REVIEW-003 | AT-REVIEW-003.* | ⏳ |
| BR-011 | SC-E2E-001, SC-REVIEW-002, SC-REVIEW-003 | AT-REVIEW-003.* | ⏳ |
| BR-012 | SC-E2E-001, SC-REVIEW-002, SC-REVIEW-003 | AT-REVIEW-003.* | ⏳ |
| BR-024 | SC-E2E-001, SC-REVIEW-002, SC-REVIEW-003 | AT-REVIEW-003.* | ⏳ |
| BR-029 | SC-E2E-001, SC-REVIEW-002, SC-REVIEW-003 | AT-REVIEW-003.* | ⏳ |

### Acceptance tests

| AT | Критерий | Тип | SPEC | Status |
|---|---|---|---|---|
| AT-REVIEW-001.1 | После submit по заданию создается ReviewAssignment(PRIMARY) на default reviewer | positive | SPEC-REVIEW-001 | ⏳ |
| AT-REVIEW-001.2 | Назначение автора reviewer'ом отклоняется | negative | SPEC-REVIEW-001 | ⏳ |
| AT-REVIEW-001.3 | Одновременно может быть только один активный PRIMARY | negative | SPEC-REVIEW-001 | ⏳ |
| AT-REVIEW-001.4 | Reviewer видит Review в очереди; другой эксперт — нет | permission | SPEC-REVIEW-001 | ⏳ |
| AT-REVIEW-001.5 | Студент не может назначать экспертов | permission | SPEC-REVIEW-001 | ⏳ |
| AT-REVIEW-001.6 | Переназначение журналируется с причиной | audit | SPEC-REVIEW-001 | ⏳ |
| AT-REVIEW-002.1 | Start переводит версию в IN_REVIEW; recall после этого невозможен | positive | SPEC-REVIEW-002 | ⏳ |
| AT-REVIEW-002.2 | Комментарий привязывается к вопросу/полю и отображается в этом месте | positive | SPEC-REVIEW-002 | ⏳ |
| AT-REVIEW-002.3 | ADVISORY не может отмечать checklist | permission | SPEC-REVIEW-002 | ⏳ |
| AT-REVIEW-002.4 | Автор не может закрыть замечание, может пометить ADDRESSED | permission | SPEC-REVIEW-002 | ⏳ |
| AT-REVIEW-002.5 | Незакрытые замечания переносятся в review следующей версии | positive | SPEC-REVIEW-002 | ⏳ |
| AT-REVIEW-002.6 | Комментарии закрытого Review не изменяются | negative | SPEC-REVIEW-002 | ⏳ |
| AT-REVIEW-002.7 | Студент-автор не видит review чужих тестов | permission | SPEC-REVIEW-002 | ⏳ |
| AT-REVIEW-003.1 | Request changes переводит тест и вопросы пакета в CHANGES_REQUESTED; Review закрыт | positive | SPEC-REVIEW-003 | ⏳ |
| AT-REVIEW-003.2 | Request changes без issue и summary отклоняется | negative | SPEC-REVIEW-003 | ⏳ |
| AT-REVIEW-003.3 | Approve с незаполненным обязательным checklist отклоняется | negative | SPEC-REVIEW-003 | ⏳ |
| AT-REVIEW-003.4 | Approve при открытом BLOCKING issue отклоняется | negative | SPEC-REVIEW-003 | ⏳ |
| AT-REVIEW-003.5 | Автор (включая Admin-автора, назначившего себя) не может approve/request changes | negative | SPEC-REVIEW-003 | ⏳ |
| AT-REVIEW-003.6 | Approve переводит тест и каскадные вопросы в APPROVED и замораживает пулы | positive | SPEC-REVIEW-003 | ⏳ |
| AT-REVIEW-003.7 | Approve с медиа не CLEARED отклоняется | negative | SPEC-REVIEW-003 | ⏳ |
| AT-REVIEW-003.8 | ADVISORY не может принять решение | permission | SPEC-REVIEW-003 | ⏳ |
| AT-REVIEW-003.9 | Студент не может approve (прямой запрос) | permission | SPEC-REVIEW-003 | ⏳ |

## BL-10

### Покрытие требований

| Requirement | Scenario | Test | Status |
|---|---|---|---|
| FR-PUB-001 | — | AT-PUB-001.* | ⏳ |
| NFR-DATA-001 | — | AT-PUB-001.* | ⏳ |
| NFR-DATA-004 | — | AT-PUB-001.* | ⏳ |
| BR-002 | — | AT-PUB-001.* | ⏳ |
| BR-006 | — | AT-PUB-001.* | ⏳ |
| BR-007 | — | AT-PUB-001.* | ⏳ |
| BR-008 | SC-E2E-001, SC-PUBLISH-001, SC-PUBLISH-002 | AT-PUB-001.*, AT-PUB-002.* | ⏳ |
| BR-013 | — | AT-PUB-001.* | ⏳ |
| BR-041 | — | AT-PUB-001.* | ⏳ |
| FR-PUB-002 | SC-PUBLISH-001 | AT-PUB-002.* | ⏳ |
| FR-PUB-003 | SC-PUBLISH-002 | AT-PUB-002.* | ⏳ |
| FR-PUB-004 | SC-PUBLISH-003 | AT-PUB-002.* | ⏳ |
| FR-PUB-005 | SC-PUBLISH-001 | AT-PUB-002.* | ⏳ |
| BR-005 | SC-E2E-001, SC-PUBLISH-001, SC-PUBLISH-002 | AT-PUB-002.* | ⏳ |
| BR-009 | SC-E2E-001, SC-PUBLISH-001, SC-PUBLISH-002 | AT-PUB-002.* | ⏳ |
| BR-036 | SC-E2E-001, SC-PUBLISH-001, SC-PUBLISH-002 | AT-PUB-002.* | ⏳ |
| BR-039 | SC-E2E-001, SC-PUBLISH-001, SC-PUBLISH-002 | AT-PUB-002.* | ⏳ |

### Acceptance tests

| AT | Критерий | Тип | SPEC | Status |
|---|---|---|---|---|
| AT-PUB-001.1 | Для каждой пары (state, action) вне таблицы переходов — отказ (параметризованный тест полного декартова произведения) | negative | SPEC-PUB-001 | ⏳ |
| AT-PUB-001.2 | Для каждого допустимого перехода — успех при выполненных guards | positive | SPEC-PUB-001 | ⏳ |
| AT-PUB-001.3 | Прямой UPDATE содержимого APPROVED версии в БД отклоняется триггером | data | SPEC-PUB-001 | ⏳ |
| AT-PUB-001.4 | Admin не может выполнить запрещенный переход (например, DRAFT → APPROVED) | negative | SPEC-PUB-001 | ⏳ |
| AT-PUB-001.5 | `availableActions` совпадает с множеством переходов, разрешенных сервером | consistency | SPEC-PUB-001 | ⏳ |
| AT-PUB-002.1 | Admin публикует APPROVED версию | positive | SPEC-PUB-002 | ⏳ |
| AT-PUB-002.2 | Публикация не-APPROVED версии отклоняется | negative | SPEC-PUB-002 | ⏳ |
| AT-PUB-002.3 | Публикация новой версии архивирует предыдущую (SUPERSEDED); в любой момент ≤ 1 PUBLISHED | positive | SPEC-PUB-002 | ⏳ |
| AT-PUB-002.4 | Withdraw без причины отклоняется; с причиной — версия ARCHIVED (WITHDRAWN) | negative/positive | SPEC-PUB-002 | ⏳ |
| AT-PUB-002.5 | Teacher/Student не могут публиковать (прямой запрос) | permission | SPEC-PUB-002 | ⏳ |
| AT-PUB-002.6 | Физическое удаление опубликованной/архивированной версии невозможно | negative | SPEC-PUB-002 | ⏳ |
| AT-PUB-002.7 | Архив теста с PUBLISHED версией отклоняется | negative | SPEC-PUB-002 | ⏳ |

## BL-11

### Покрытие требований

| Requirement | Scenario | Test | Status |
|---|---|---|---|
| FR-AUDIT-001 | SC-AUDIT-001 | AT-AUDIT-001.* | ✓ |
| FR-AUDIT-002 | SC-AUDIT-001 | AT-AUDIT-001.* | ✓ |
| NFR-AUDIT-001 | SC-AUDIT-001, SC-E2E-001 | AT-AUDIT-001.* | ✓ |
| NFR-AUDIT-002 | SC-AUDIT-001, SC-E2E-001 | AT-AUDIT-001.* | ✓ |
| NFR-AUDIT-003 | SC-AUDIT-001, SC-E2E-001 | AT-AUDIT-001.* | ✓ |
| NFR-AUDIT-004 | SC-AUDIT-001, SC-E2E-001 | AT-AUDIT-001.* | ✓ |
| NFR-AUDIT-005 | SC-AUDIT-001, SC-E2E-001 | AT-AUDIT-001.* | ✓ |
| BR-034 | SC-AUDIT-001, SC-E2E-001 | AT-AUDIT-001.* | ✓ |
| BR-035 | SC-AUDIT-001, SC-E2E-001 | AT-AUDIT-001.* | ✓ |
| FR-AUDIT-003 | SC-AUDIT-002 | AT-AUDIT-002.* | ✓ |
| FR-AUDIT-004 | SC-AUDIT-003 | AT-AUDIT-002.* | ✓ |
| BR-005 | SC-AUDIT-002, SC-AUDIT-003 | AT-AUDIT-002.* | ✓ |
| BR-039 | SC-AUDIT-002, SC-AUDIT-003 | AT-AUDIT-002.* | ✓ |
| BR-042 | SC-AUDIT-002, SC-AUDIT-003 | AT-AUDIT-002.* | ✓ |
| BR-044 | SC-AUDIT-002, SC-AUDIT-003 | AT-AUDIT-002.* | ✓ |

### Acceptance tests

| AT | Критерий | Тип | SPEC | Status |
|---|---|---|---|---|
| AT-AUDIT-001.1 | Каждый use case изменения создает запись с actor, action, resource, diff | audit | SPEC-AUDIT-001 | ✓ |
| AT-AUDIT-001.2 | Изменение ролей/permissions/статуса пользователя журналируется (NFR-AUDIT-001) | audit | SPEC-AUDIT-001 | ✓ |
| AT-AUDIT-001.3 | Попытка изменить/удалить запись через приложение невозможна; через SQL под ролью приложения — отказ | security | SPEC-AUDIT-001 | ✓ |
| AT-AUDIT-001.4 | Сбой записи аудита откатывает операцию | data | SPEC-AUDIT-001 | ✓ |
| AT-AUDIT-001.5 | Пароли, hash, токены не попадают в changes | security | SPEC-AUDIT-001 | ✓ |
| AT-AUDIT-001.6 | Не-Admin не имеет доступа к журналу | permission | SPEC-AUDIT-001 | ✓ |
| AT-AUDIT-002.1 | История объекта показывает события создания, изменений, переходов, решений | positive | SPEC-AUDIT-002 | ✓ |
| AT-AUDIT-002.2 | Пользователь без права чтения объекта не видит его историю | permission | SPEC-AUDIT-002 | ✓ |
| AT-AUDIT-002.3 | Архивирование не удаляет данные; restore возвращает объект | positive | SPEC-AUDIT-002 | ✓ |
| AT-AUDIT-002.4 | Используемый объект нельзя удалить физически ни одним путем | negative | SPEC-AUDIT-002 | ✓ |

## BL-12

### Покрытие требований

| Requirement | Scenario | Test | Status |
|---|---|---|---|
| FR-DELIV-001 | — | AT-DELIV-001.* | ⏳ |
| FR-DELIV-002 | SC-ITEM-004 | AT-DELIV-001.* | ⏳ |
| NFR-EXT-005 | — | AT-DELIV-001.* | ⏳ |
| NFR-SEC-008 | — | AT-DELIV-001.* | ⏳ |
| BR-036 | — | AT-DELIV-001.* | ⏳ |
| BR-037 | — | AT-DELIV-001.* | ⏳ |

### Acceptance tests

| AT | Критерий | Тип | SPEC | Status |
|---|---|---|---|---|
| AT-DELIV-001.1 | Тест-прототип (без UI) создает Attempt по PUBLISHED версии, отвечает на все MVP-типы и получает Result без изменения схемы контента | architecture | SPEC-DELIV-001 | ⏳ |
| AT-DELIV-001.2 | Attempt по не-PUBLISHED версии невозможен (domain) | negative | SPEC-DELIV-001 | ⏳ |
| AT-DELIV-001.3 | Одинаковый seed дает одинаковую выборку | positive | SPEC-DELIV-001 | ⏳ |
| AT-DELIV-001.4 | Delivery-сериализатор не содержит answerKey | security | SPEC-DELIV-001 | ⏳ |
| AT-DELIV-001.5 | Withdraw версии не изменяет существующие Attempt/Result | data | SPEC-DELIV-001 | ⏳ |

## Сквозные acceptance-наборы

| AT | Состав | Источник | Status |
|---|---|---|---|
| AT-PERM-001 | Студент не может читать чужой private draft | AT-ITEM-004.1, AT-ITEM-002.2 | ⏳ |
| AT-PERM-002 | Студент не может approve | AT-ITEM-004.5, AT-REVIEW-003.9 | ⏳ |
| AT-PERM-003 | Эксперт не может менять пользователей | AT-USER-001.7, AT-USER-002.7 | ✓ |
| AT-PERM-004 | Администратор имеет полный доступ в пределах BR | AT-AUTH-003.1, AT-AUTH-003.5 | ✓ |
| AT-PERM-005 | UI restrictions не заменяют server-side authorization | AT-AUTH-003.2, AT-AUTH-003.7 | ✓ |
| AT-PERM-MATRIX | Параметризованная проверка всех ячеек permission-model §4 без UI | SPEC-AUTH-003 | ✓ |
| AT-E2E-001 | SC-E2E-001 через UI (Playwright) | scenarios/scenario-registry.md | ⏳ |
| AT-E2E-001-API | SC-E2E-001 через application services без UI | scenarios/scenario-registry.md | ⏳ |

## Сводка покрытия (спецификационное)

| Показатель | Значение |
|---|---|
| Acceptance criteria / AT | 192 |
| FR (Must) с AT | 79 / 79 |
| BR с AT | 46 / 46 |
| Проходящих AT | 120 / 192 |
| Падающих AT | 0 |
| Требований (FR/NFR/BR) с ≥1 проходящим AT | 115 / 157 (73%) |
| Ошибок целостности ссылок | 0 |
