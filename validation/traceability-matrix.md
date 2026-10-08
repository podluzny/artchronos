# Traceability Matrix

| Поле | Значение |
|---|---|
| Задача | T-029 |
| Генерируется | `python3 tools/build_traceability.py` — не редактировать вручную |

Путь трассировки: `BR → FR → SC → SPEC → T → AT`. AT-идентификатор соответствует acceptance criterion спецификации один к одному (`AC-ITEM-001.3` ↔ `AT-ITEM-001.3`).

## 1. Business rules

| BR | Правило (кратко) | FR | SC | SPEC | T | AT |
|---|---|---|---|---|---|---|
| BR-001 | Автор (owner или соавтор) не может принять решение (approve / request changes) по собствен… | FR-REVIEW-007, FR-REVIEW-008 | SC-E2E-001, SC-ITEM-005, SC-REVIEW-001, SC-REVIEW-002, SC-REVIEW-003, SC-REVIEW-004 | SPEC-AUTH-003, SPEC-ITEM-004, SPEC-REVIEW-001, SPEC-REVIEW-003 | T-034, T-036, T-042, T-059, T-072, T-074, T-079 | 29 AT (AT-AUTH-003.*, AT-ITEM-004.*, AT-REVIEW-001.*, AT-REVIEW-003.*) |
| BR-027 | Reviewer назначается только из пользователей, имеющих review.perform, со статусом ACTIVE, … | FR-ASSIGN-006, FR-REVIEW-001, FR-REVIEW-002 | SC-ASSIGN-001, SC-E2E-001, SC-REVIEW-001, SC-REVIEW-004 | SPEC-ASSIGN-001, SPEC-REVIEW-001 | T-046, T-072 | 12 AT (AT-ASSIGN-001.*, AT-REVIEW-001.*) |
| BR-028 | Approve возможен только если: отмечены все обязательные пункты checklist; нет ContentIssue… | FR-REVIEW-004, FR-REVIEW-006, FR-REVIEW-008 | SC-E2E-001, SC-REVIEW-002, SC-REVIEW-003, SC-REVIEW-005, SC-REVIEW-006 | SPEC-REVIEW-002, SPEC-REVIEW-003 | T-073, T-074 | 16 AT (AT-REVIEW-002.*, AT-REVIEW-003.*) |
| BR-029 | Request changes требует хотя бы одного ContentIssue в статусе OPEN или итогового комментар… | FR-REVIEW-006, FR-REVIEW-007 | SC-E2E-001, SC-REVIEW-002, SC-REVIEW-003, SC-REVIEW-005 | SPEC-REVIEW-003 | T-074 | 9 AT (AT-REVIEW-003.*) |
| BR-030 | В MVP у Review ровно один активный PRIMARY reviewer; решение принимает только он. ADVISORY… | FR-REVIEW-002 | SC-E2E-001, SC-REVIEW-001, SC-REVIEW-002, SC-REVIEW-003, SC-REVIEW-004, SC-REVIEW-005 … | SPEC-REVIEW-001, SPEC-REVIEW-002, SPEC-REVIEW-003 | T-072, T-073, T-074 | 22 AT (AT-REVIEW-001.*, AT-REVIEW-002.*, AT-REVIEW-003.*) |
| BR-040 | После решения (APPROVED, CHANGES_REQUESTED) Review закрыт: комментарии, checklist и решени… | FR-REVIEW-005 | SC-E2E-001, SC-REVIEW-002, SC-REVIEW-003, SC-REVIEW-005, SC-REVIEW-006 | SPEC-REVIEW-002, SPEC-REVIEW-003 | T-073, T-074 | 16 AT (AT-REVIEW-002.*, AT-REVIEW-003.*) |
| BR-002 | После утверждения TestVersion не может быть изменена. | FR-TEST-007 | SC-E2E-001, SC-TEST-005, SC-VERSION-001 | SPEC-PUB-001, SPEC-TEST-004 | T-058, T-064, T-070, T-075 | 13 AT (AT-PUB-001.*, AT-TEST-004.*) |
| BR-003 | Изменение утвержденного (или отправленного) теста создает новую версию (DRAFT, basedOnVers… | FR-ITEM-004, FR-TEST-007 | SC-E2E-001, SC-ITEM-003, SC-ITEM-006, SC-ITEM-007, SC-TEST-005, SC-VERSION-001 … | SPEC-ITEM-002, SPEC-TEST-004 | T-058, T-061, T-070 | 18 AT (AT-ITEM-002.*, AT-TEST-004.*) |
| BR-006 | После утверждения ItemVersion не может быть изменена; изменение создает новую ItemVersion.… | FR-ITEM-003, FR-ITEM-004 | SC-E2E-001, SC-ITEM-003, SC-ITEM-005, SC-ITEM-006, SC-ITEM-007, SC-VERSION-001 … | SPEC-ITEM-002, SPEC-ITEM-004, SPEC-PUB-001 | T-058, T-059, T-061, T-064, T-075 | 21 AT (AT-ITEM-002.*, AT-ITEM-004.*, AT-PUB-001.*) |
| BR-007 | Версия становится content-frozen в момент отправки на review (READY_FOR_REVIEW). Дальнейши… | FR-ITEM-003, FR-TEST-002, FR-TEST-006 | SC-E2E-001, SC-ITEM-003, SC-ITEM-005, SC-ITEM-006, SC-ITEM-007, SC-TEST-002 … | SPEC-ITEM-002, SPEC-ITEM-004, SPEC-PUB-001, SPEC-TEST-002, SPEC-TEST-003, SPEC-TEST-004 | T-058, T-059, T-061, T-064, T-067, T-068, T-069, T-070, T-075 | 40 AT (AT-ITEM-002.*, AT-ITEM-004.*, AT-PUB-001.*, AT-TEST-002.* …) |
| BR-038 | Автор может отозвать отправку (READY_FOR_REVIEW → DRAFT) только пока review не начат (нет … | FR-TEST-009 | SC-E2E-001, SC-ITEM-003, SC-ITEM-006, SC-ITEM-007, SC-TEST-005, SC-VERSION-001 … | SPEC-ITEM-002, SPEC-TEST-004 | T-058, T-061, T-070 | 18 AT (AT-ITEM-002.*, AT-TEST-004.*) |
| BR-041 | У Test и у Item одновременно существует не более одной версии в DRAFT. | FR-ITEM-004, FR-TEST-007 | SC-E2E-001, SC-ITEM-003, SC-ITEM-006, SC-ITEM-007, SC-TEST-005, SC-VERSION-001 … | SPEC-ITEM-002, SPEC-PUB-001, SPEC-TEST-004 | T-058, T-061, T-064, T-070, T-075 | 23 AT (AT-ITEM-002.*, AT-PUB-001.*, AT-TEST-004.*) |
| BR-010 | TestVersion ссылается на конкретные ItemVersion (pinning), а не на Item. | FR-TEST-003 | SC-TEST-002, SC-TEST-003 | SPEC-TEST-002 | T-067, T-068 | 7 AT (AT-TEST-002.*) |
| BR-019 | Тип вопроса обязателен и не меняется у Item между версиями. Смена типа = новый Item. | FR-ITEM-001 | SC-E2E-001, SC-ITEM-001, SC-ITEM-002, SC-ITEM-003, SC-ITEM-006, SC-ITEM-007 … | SPEC-ITEM-001, SPEC-ITEM-002 | T-058, T-060, T-061 | 19 AT (AT-ITEM-001.*, AT-ITEM-002.*) |
| BR-008 | Публиковаться может только TestVersion в состоянии APPROVED. ItemVersion не публикуется са… | FR-PUB-002 | SC-E2E-001, SC-PUBLISH-001, SC-PUBLISH-002, SC-PUBLISH-003 | SPEC-PUB-001, SPEC-PUB-002 | T-058, T-064, T-075, T-076 | 12 AT (AT-PUB-001.*, AT-PUB-002.*) |
| BR-009 | У Test одновременно не более одной PUBLISHED версии. Публикация новой версии переводит пре… | FR-PUB-002 | SC-E2E-001, SC-PUBLISH-001, SC-PUBLISH-002, SC-PUBLISH-003 | SPEC-PUB-002 | T-076 | 7 AT (AT-PUB-002.*) |
| BR-011 | TestVersion может быть утверждена только если все ее фиксированные вопросы ссылаются на It… | FR-REVIEW-008 | SC-E2E-001, SC-REVIEW-002, SC-REVIEW-003, SC-TEST-002, SC-TEST-003, SC-TEST-005 … | SPEC-REVIEW-003, SPEC-TEST-002, SPEC-TEST-004 | T-067, T-068, T-070, T-074 | 24 AT (AT-REVIEW-003.*, AT-TEST-002.*, AT-TEST-004.*) |
| BR-012 | Пул SelectionRule формируется только из APPROVED ItemVersion активных Item; при approve Te… | FR-TEST-004, FR-REVIEW-008 | SC-E2E-001, SC-REVIEW-002, SC-REVIEW-003, SC-TEST-002, SC-TEST-003, SC-TEST-005 … | SPEC-REVIEW-003, SPEC-TEST-002, SPEC-TEST-004 | T-067, T-068, T-070, T-074 | 24 AT (AT-REVIEW-003.*, AT-TEST-002.*, AT-TEST-004.*) |
| BR-013 | Переходы состояний возможны только по state machine (docs/lifecycle-state-machine.md). Адм… | FR-PUB-001 | SC-E2E-001, SC-ITEM-005 | SPEC-AUTH-003, SPEC-PUB-001 | T-034, T-036, T-042, T-058, T-064, T-075, T-079 | 13 AT (AT-AUTH-003.*, AT-PUB-001.*) |
| BR-036 | Отзыв (withdraw) опубликованной версии не удаляет и не изменяет попытки и результаты; новы… | FR-PUB-003 | SC-E2E-001, SC-PUBLISH-001, SC-PUBLISH-002, SC-PUBLISH-003 | SPEC-DELIV-001, SPEC-PUB-002 | T-076, T-077 | 12 AT (AT-DELIV-001.*, AT-PUB-002.*) |
| BR-037 | Attempt ссылается на конкретную TestVersion, бывшую PUBLISHED при старте; эта ссылка неизм… | FR-DELIV-001 | — | SPEC-DELIV-001 | T-077 | 5 AT (AT-DELIV-001.*) |
| BR-005 | Hard delete опубликованного или используемого контента запрещен (Test, TestVersion, Item, … | FR-MEDIA-007, FR-ITEM-010, FR-PUB-004, FR-AUDIT-004 | SC-AUDIT-002, SC-AUDIT-003, SC-E2E-001, SC-ITEM-003, SC-ITEM-006, SC-ITEM-007 … | SPEC-AUDIT-002, SPEC-ITEM-002, SPEC-MEDIA-002, SPEC-PUB-002, SPEC-USER-001 | T-032, T-039, T-041, T-052, T-058, T-061, T-076, T-086 | 36 AT (AT-AUDIT-002.*, AT-ITEM-002.*, AT-MEDIA-002.*, AT-PUB-002.* …) |
| BR-026 | MediaAsset, используемый хотя бы одной не-DRAFT версией, не может быть удален или иметь за… | FR-MEDIA-006, FR-MEDIA-007 | SC-AUDIT-003, SC-MEDIA-002 | SPEC-MEDIA-002 | T-052, T-086 | 7 AT (AT-MEDIA-002.*) |
| BR-039 | Архивированные Item, MediaAsset, Topic, QuestionType не могут добавляться в новые версии; … | FR-EDU-005, FR-MEDIA-007, FR-ITEM-010, FR-PUB-004, FR-AUDIT-004 | SC-ASSIGN-001, SC-AUDIT-002, SC-AUDIT-003, SC-E2E-001, SC-EDU-001, SC-ITEM-001 … | SPEC-ASSIGN-001, SPEC-AUDIT-002, SPEC-EDU-001, SPEC-ITEM-001, SPEC-ITEM-002, SPEC-ITEM-005, SPEC-MEDIA-002, SPEC-PUB-002, SPEC-TEST-002 | T-041, T-044, T-046, T-052, T-058, T-060, T-061, T-063, T-067, T-068, T-076, T-086 | 60 AT (AT-ASSIGN-001.*, AT-AUDIT-002.*, AT-EDU-001.*, AT-ITEM-001.* …) |
| BR-042 | Элемент учебной структуры (Subject, Course, Topic, LearningObjective), используемый контен… | FR-EDU-001, FR-EDU-002, FR-EDU-003, FR-EDU-005 | SC-AUDIT-002, SC-AUDIT-003, SC-EDU-001 | SPEC-AUDIT-002, SPEC-EDU-001 | T-041, T-044, T-086 | 9 AT (AT-AUDIT-002.*, AT-EDU-001.*) |
| BR-044 | Hard delete разрешен только для DRAFT-версии, никогда не отправлявшейся на review и не име… | FR-ITEM-004 | SC-AUDIT-002, SC-AUDIT-003, SC-ITEM-003, SC-ITEM-006, SC-ITEM-007, SC-VERSION-001 … | SPEC-AUDIT-002, SPEC-ITEM-002 | T-041, T-058, T-061, T-086 | 14 AT (AT-AUDIT-002.*, AT-ITEM-002.*) |
| BR-004 | Студент может редактировать только собственные DRAFT-объекты. | FR-ITEM-003, FR-ITEM-011 | SC-E2E-001, SC-ITEM-001, SC-ITEM-002, SC-ITEM-003, SC-ITEM-005, SC-ITEM-006 … | SPEC-AUTH-003, SPEC-ITEM-001, SPEC-ITEM-002, SPEC-ITEM-004, SPEC-TEST-002 | T-034, T-036, T-042, T-058, T-059, T-060, T-061, T-067, T-068, T-079 | 40 AT (AT-AUTH-003.*, AT-ITEM-001.*, AT-ITEM-002.*, AT-ITEM-004.* …) |
| BR-017 | Студент создает Item и Test только в рамках ACTIVE Assignment, адресованного ему (лично ил… | FR-ASSIGN-005, FR-ITEM-001, FR-TEST-001 | SC-ASSIGN-002, SC-ASSIGN-003, SC-E2E-001, SC-ITEM-001, SC-ITEM-002, SC-TEST-001 … | SPEC-ASSIGN-002, SPEC-ITEM-001, SPEC-TEST-001, SPEC-TEST-004 | T-047, T-060, T-066, T-070 | 27 AT (AT-ASSIGN-002.*, AT-ITEM-001.*, AT-TEST-001.*, AT-TEST-004.*) |
| BR-018 | Тип вопроса создаваемого в рамках задания Item должен входить в Assignment.allowedQuestion… | FR-ASSIGN-003, FR-ITEM-001 | SC-ASSIGN-001, SC-E2E-001, SC-ITEM-001, SC-ITEM-002 | SPEC-ASSIGN-001, SPEC-ITEM-001 | T-046, T-060 | 15 AT (AT-ASSIGN-001.*, AT-ITEM-001.*) |
| BR-031 | Отправка **первой** версии теста по заданию на review после дедлайна (с учетом персонально… | FR-ASSIGN-004, FR-TEST-006 | SC-ASSIGN-002, SC-ASSIGN-003, SC-E2E-001, SC-TEST-001, SC-TEST-005, SC-VERSION-001 | SPEC-ASSIGN-002, SPEC-TEST-004 | T-047, T-070 | 14 AT (AT-ASSIGN-002.*, AT-TEST-004.*) |
| BR-032 | TestVersion, созданная по заданию, при отправке должна удовлетворять ограничениям задания:… | FR-ASSIGN-003, FR-TEST-006 | SC-ASSIGN-001, SC-E2E-001, SC-TEST-005, SC-VERSION-001 | SPEC-TEST-004 | T-070 | 8 AT (AT-TEST-004.*) |
| BR-033 | Студент создает не более Assignment.maxTestsPerStudent тестов (не архивированных) в одном … | FR-ASSIGN-003, FR-TEST-001 | SC-ASSIGN-001, SC-E2E-001, SC-TEST-001 | SPEC-TEST-001 | T-066 | 4 AT (AT-TEST-001.*) |
| BR-043 | Assignment создается и ведется пользователем с assignment.create (Teacher, Admin); owner з… | FR-ASSIGN-001 | SC-ASSIGN-001, SC-E2E-001, SC-TEST-001 | SPEC-ASSIGN-001, SPEC-TEST-001 | T-046, T-066 | 10 AT (AT-ASSIGN-001.*, AT-TEST-001.*) |
| BR-020 | Содержимое ItemVersion валидно по contentSchema своей QuestionTypeVersion; невалидная верс… | FR-ITEM-009, FR-TEST-006 | SC-E2E-001, SC-ITEM-001, SC-ITEM-002, SC-ITEM-003, SC-ITEM-004, SC-ITEM-006 … | SPEC-ITEM-001, SPEC-ITEM-002, SPEC-QTYPE-002, SPEC-TEST-004 | T-053, T-054, T-055, T-056, T-058, T-060, T-061, T-070 | 32 AT (AT-ITEM-001.*, AT-ITEM-002.*, AT-QTYPE-002.*, AT-TEST-004.*) |
| BR-021 | Новые Item создаются только с ACTIVE QuestionType. Деактивация типа не затрагивает существ… | FR-QTYPE-004, FR-ITEM-001 | SC-ASSIGN-001, SC-E2E-001, SC-ITEM-001, SC-ITEM-002, SC-QTYPE-001, SC-QTYPE-002 | SPEC-ASSIGN-001, SPEC-ITEM-001, SPEC-QTYPE-001 | T-046, T-057, T-060 | 21 AT (AT-ASSIGN-001.*, AT-ITEM-001.*, AT-QTYPE-001.*) |
| BR-022 | QuestionTypeVersion неизменна после создания. Изменение конфигурации типа создает новую ве… | FR-QTYPE-003 | SC-QTYPE-001, SC-QTYPE-002 | SPEC-QTYPE-001 | T-057 | 6 AT (AT-QTYPE-001.*) |
| BR-023 | QuestionType может ссылаться только на interactionKey, зарегистрированный в коде. Произвол… | FR-QTYPE-002, FR-QTYPE-006 | SC-ITEM-001, SC-ITEM-002, SC-ITEM-004, SC-QTYPE-001, SC-QTYPE-002 | SPEC-QTYPE-001, SPEC-QTYPE-002 | T-053, T-054, T-055, T-056, T-057 | 11 AT (AT-QTYPE-001.*, AT-QTYPE-002.*) |
| BR-024 | Медиа с rightsStatus ≠ CLEARED не может входить в ItemVersion, отправляемую на review, утв… | FR-MEDIA-003, FR-ITEM-002, FR-ITEM-009, FR-TEST-006 | SC-AUDIT-003, SC-E2E-001, SC-ITEM-001, SC-ITEM-002, SC-ITEM-003, SC-ITEM-006 … | SPEC-ITEM-001, SPEC-ITEM-002, SPEC-MEDIA-002, SPEC-REVIEW-003, SPEC-TEST-004 | T-052, T-058, T-060, T-061, T-070, T-074, T-086 | 43 AT (AT-ITEM-001.*, AT-ITEM-002.*, AT-MEDIA-002.*, AT-REVIEW-003.* …) |
| BR-025 | Изображение, используемое в вопросе, должно иметь непустой altText (на уровне MediaAsset и… | FR-MEDIA-002, FR-ITEM-002, FR-ITEM-009, FR-TEST-006 | SC-E2E-001, SC-ITEM-001, SC-ITEM-002, SC-ITEM-003, SC-ITEM-006, SC-ITEM-007 … | SPEC-ITEM-001, SPEC-ITEM-002, SPEC-MEDIA-001, SPEC-TEST-004 | T-049, T-050, T-051, T-058, T-060, T-061, T-070 | 34 AT (AT-ITEM-001.*, AT-ITEM-002.*, AT-MEDIA-001.*, AT-TEST-004.*) |
| BR-045 | Только пользователь с media.rights.manage может установить rightsStatus = CLEARED. | FR-MEDIA-003 | SC-AUDIT-003, SC-MEDIA-001, SC-MEDIA-002, SC-MEDIA-003 | SPEC-MEDIA-001, SPEC-MEDIA-002 | T-049, T-050, T-051, T-052, T-086 | 14 AT (AT-MEDIA-001.*, AT-MEDIA-002.*) |
| BR-014 | Пользователь в статусе BLOCKED, ARCHIVED или INVITED (без установленного пароля) не может … | FR-AUTH-001, FR-AUTH-006, FR-AUTH-007, FR-USER-003 | SC-AUTH-001, SC-AUTH-002, SC-AUTH-003, SC-AUTH-004, SC-USER-001, SC-USER-003 | SPEC-AUTH-001, SPEC-AUTH-002, SPEC-AUTH-004, SPEC-USER-001 | T-032, T-037, T-038, T-039, T-042 | 25 AT (AT-AUTH-001.*, AT-AUTH-002.*, AT-AUTH-004.*, AT-USER-001.*) |
| BR-015 | Пользователь не может изменять собственные роли и permissions (в том числе состав роли, ко… | FR-USER-003, FR-USER-004 | SC-E2E-001, SC-ITEM-005, SC-PERM-001, SC-USER-001, SC-USER-002, SC-USER-003 | SPEC-AUTH-003, SPEC-USER-001, SPEC-USER-002 | T-032, T-034, T-035, T-036, T-039, T-040, T-042, T-079 | 23 AT (AT-AUTH-003.*, AT-USER-001.*, AT-USER-002.*) |
| BR-016 | Нельзя заблокировать, архивировать или лишить роли ADMIN последнего активного администрато… | FR-USER-003, FR-USER-004 | SC-PERM-001, SC-USER-001, SC-USER-002, SC-USER-003 | SPEC-USER-001, SPEC-USER-002 | T-032, T-035, T-039, T-040 | 15 AT (AT-USER-001.*, AT-USER-002.*) |
| BR-046 | Системные роли (isSystem) нельзя удалить; набор их permissions меняет только Admin, и изме… | FR-PERM-001 | SC-PERM-001, SC-USER-002 | SPEC-USER-002 | T-032, T-035, T-040 | 7 AT (AT-USER-002.*) |
| BR-034 | AuditLog append-only: никто, включая Admin, не может изменить или удалить запись через при… | FR-AUDIT-001 | SC-AUDIT-001, SC-E2E-001 | SPEC-AUDIT-001 | T-033, T-041 | 6 AT (AT-AUDIT-001.*) |
| BR-035 | Каждое изменение governed-ресурса, переход состояния, решение review, изменение ролей/perm… | FR-AUDIT-001 | SC-ASSIGN-002, SC-ASSIGN-003, SC-AUDIT-001, SC-AUDIT-003, SC-AUTH-001, SC-AUTH-003 … | SPEC-ASSIGN-002, SPEC-AUDIT-001, SPEC-AUTH-001, SPEC-AUTH-004, SPEC-EDU-001, SPEC-EDU-002, SPEC-MEDIA-001, SPEC-MEDIA-002, SPEC-QTYPE-001, SPEC-REVIEW-001, SPEC-USER-001, SPEC-USER-002 | T-032, T-033, T-035, T-037, T-038, T-039, T-040, T-041, T-042, T-044, T-045, T-047, T-049, T-050, T-051, T-052, T-057, T-072, T-086 | 74 AT (AT-ASSIGN-002.*, AT-AUDIT-001.*, AT-AUTH-001.*, AT-AUTH-004.* …) |

## 2. Functional requirements

| FR | P | SC | SPEC | T | AT |
|---|---|---|---|---|---|
| FR-AUTH-001 | M | SC-AUTH-001 | SPEC-AUTH-001 | T-032, T-037 | AT-AUTH-001.* |
| FR-AUTH-002 | M | SC-AUTH-002 | SPEC-AUTH-002 | T-037 | AT-AUTH-002.* |
| FR-AUTH-003 | M | SC-AUTH-002 | SPEC-AUTH-002 | T-037 | AT-AUTH-002.* |
| FR-AUTH-004 | M | SC-AUTH-003 | SPEC-AUTH-001 | T-032, T-037 | AT-AUTH-001.* |
| FR-AUTH-005 | M | SC-AUTH-004 | SPEC-AUTH-004 | T-038, T-042 | AT-AUTH-004.* |
| FR-AUTH-006 | M | SC-AUTH-001 | SPEC-AUTH-003, SPEC-AUTH-001 | T-032, T-034, T-036, T-037, T-042, T-079 | AT-AUTH-001.*, AT-AUTH-003.* |
| FR-AUTH-007 | S | SC-USER-001 | SPEC-AUTH-004 | T-038, T-042 | AT-AUTH-004.* |
| FR-USER-001 | M | SC-USER-001 | SPEC-USER-001 | T-032, T-039 | AT-USER-001.* |
| FR-USER-002 | M | SC-USER-001 | SPEC-USER-001 | T-032, T-039 | AT-USER-001.* |
| FR-USER-003 | M | SC-USER-003 | SPEC-USER-001 | T-032, T-039 | AT-USER-001.* |
| FR-USER-004 | M | SC-USER-002 | SPEC-USER-002 | T-032, T-035, T-040 | AT-USER-002.* |
| FR-USER-005 | M | SC-USER-001 | SPEC-USER-001 | T-032, T-039 | AT-USER-001.* |
| FR-USER-006 | S | — | SPEC-USER-001 | T-032, T-039 | AT-USER-001.* |
| FR-PERM-001 | M | SC-PERM-001 | SPEC-USER-002 | T-032, T-035, T-040 | AT-USER-002.* |
| FR-PERM-002 | M | — | SPEC-AUTH-003, SPEC-ITEM-004 | T-034, T-036, T-042, T-059, T-079 | AT-AUTH-003.*, AT-ITEM-004.* |
| FR-PERM-003 | M | SC-ITEM-005 | SPEC-AUTH-003, SPEC-ITEM-004, SPEC-ITEM-005 | T-034, T-036, T-042, T-059, T-063, T-079 | AT-AUTH-003.*, AT-ITEM-004.*, AT-ITEM-005.* |
| FR-PERM-004 | M | — | SPEC-AUTH-003 | T-034, T-036, T-042, T-079 | AT-AUTH-003.* |
| FR-EDU-001 | M | SC-EDU-001 | SPEC-EDU-001 | T-044 | AT-EDU-001.* |
| FR-EDU-002 | M | SC-EDU-001 | SPEC-EDU-001 | T-044 | AT-EDU-001.* |
| FR-EDU-003 | M | SC-EDU-001 | SPEC-EDU-001 | T-044 | AT-EDU-001.* |
| FR-EDU-004 | M | SC-EDU-002 | SPEC-EDU-002 | T-045 | AT-EDU-002.* |
| FR-EDU-005 | M | SC-EDU-001 | SPEC-EDU-001 | T-044 | AT-EDU-001.* |
| FR-ASSIGN-001 | M | SC-ASSIGN-001 | SPEC-ASSIGN-001 | T-046 | AT-ASSIGN-001.* |
| FR-ASSIGN-002 | M | SC-ASSIGN-001 | SPEC-ASSIGN-001 | T-046 | AT-ASSIGN-001.* |
| FR-ASSIGN-003 | M | SC-ASSIGN-001 | SPEC-ASSIGN-001 | T-046 | AT-ASSIGN-001.* |
| FR-ASSIGN-004 | M | SC-ASSIGN-003 | SPEC-ASSIGN-002 | T-047 | AT-ASSIGN-002.* |
| FR-ASSIGN-005 | M | SC-ASSIGN-002 | SPEC-ASSIGN-002 | T-047 | AT-ASSIGN-002.* |
| FR-ASSIGN-006 | M | SC-ASSIGN-001 | SPEC-ASSIGN-001 | T-046 | AT-ASSIGN-001.* |
| FR-ASSIGN-007 | M | SC-TEST-001 | SPEC-ASSIGN-002 | T-047 | AT-ASSIGN-002.* |
| FR-ASSIGN-008 | S | SC-ASSIGN-002 | SPEC-ASSIGN-002 | T-047 | AT-ASSIGN-002.* |
| FR-MEDIA-001 | M | SC-MEDIA-001 | SPEC-MEDIA-001 | T-049, T-050, T-051 | AT-MEDIA-001.* |
| FR-MEDIA-002 | M | SC-MEDIA-001 | SPEC-MEDIA-001 | T-049, T-050, T-051 | AT-MEDIA-001.* |
| FR-MEDIA-003 | M | SC-MEDIA-002 | SPEC-MEDIA-002 | T-052, T-086 | AT-MEDIA-002.* |
| FR-MEDIA-004 | M | SC-MEDIA-001 | SPEC-MEDIA-001 | T-049, T-050, T-051 | AT-MEDIA-001.* |
| FR-MEDIA-005 | M | SC-MEDIA-003 | SPEC-MEDIA-001 | T-049, T-050, T-051 | AT-MEDIA-001.* |
| FR-MEDIA-006 | M | SC-MEDIA-002 | SPEC-MEDIA-002 | T-052, T-086 | AT-MEDIA-002.* |
| FR-MEDIA-007 | M | SC-MEDIA-002 | SPEC-MEDIA-002 | T-052, T-086 | AT-MEDIA-002.* |
| FR-MEDIA-008 | S | SC-MEDIA-001 | SPEC-MEDIA-001 | T-049, T-050, T-051 | AT-MEDIA-001.* |
| FR-QTYPE-001 | M | SC-QTYPE-001 | SPEC-QTYPE-001 | T-057 | AT-QTYPE-001.* |
| FR-QTYPE-002 | M | SC-QTYPE-001 | SPEC-QTYPE-001 | T-057 | AT-QTYPE-001.* |
| FR-QTYPE-003 | M | SC-QTYPE-002 | SPEC-QTYPE-001 | T-057 | AT-QTYPE-001.* |
| FR-QTYPE-004 | M | SC-QTYPE-002 | SPEC-QTYPE-001 | T-057 | AT-QTYPE-001.* |
| FR-QTYPE-005 | M | SC-ITEM-001 | SPEC-QTYPE-002 | T-053, T-054, T-055, T-056 | AT-QTYPE-002.* |
| FR-QTYPE-006 | M | — | SPEC-QTYPE-002 | T-053, T-054, T-055, T-056 | AT-QTYPE-002.* |
| FR-ITEM-001 | M | SC-ITEM-001, SC-ITEM-002 | SPEC-ITEM-001 | T-060 | AT-ITEM-001.* |
| FR-ITEM-002 | M | SC-ITEM-002 | SPEC-ITEM-001 | T-060 | AT-ITEM-001.* |
| FR-ITEM-003 | M | SC-ITEM-003 | SPEC-ITEM-002 | T-058, T-061 | AT-ITEM-002.* |
| FR-ITEM-004 | M | SC-VERSION-002 | SPEC-ITEM-002 | T-058, T-061 | AT-ITEM-002.* |
| FR-ITEM-005 | M | SC-ITEM-001 | SPEC-ITEM-001 | T-060 | AT-ITEM-001.* |
| FR-ITEM-006 | M | SC-ITEM-004 | SPEC-ITEM-003 | T-062 | AT-ITEM-003.* |
| FR-ITEM-007 | M | SC-ITEM-005 | SPEC-ITEM-005 | T-063 | AT-ITEM-005.* |
| FR-ITEM-008 | S | SC-VERSION-002 | SPEC-ITEM-002 | T-058, T-061 | AT-ITEM-002.* |
| FR-ITEM-009 | M | SC-ITEM-006 | SPEC-ITEM-002 | T-058, T-061 | AT-ITEM-002.* |
| FR-ITEM-010 | M | SC-ITEM-007 | SPEC-ITEM-002 | T-058, T-061 | AT-ITEM-002.* |
| FR-ITEM-011 | M | SC-ITEM-005 | SPEC-ITEM-004 | T-059 | AT-ITEM-004.* |
| FR-TEST-001 | M | SC-TEST-001 | SPEC-TEST-001 | T-066 | AT-TEST-001.* |
| FR-TEST-002 | M | SC-TEST-002 | SPEC-TEST-002 | T-067, T-068 | AT-TEST-002.* |
| FR-TEST-003 | M | SC-TEST-002 | SPEC-TEST-002 | T-067, T-068 | AT-TEST-002.* |
| FR-TEST-004 | M | SC-TEST-003 | SPEC-TEST-002 | T-067, T-068 | AT-TEST-002.* |
| FR-TEST-005 | M | SC-TEST-004 | SPEC-TEST-003 | T-069 | AT-TEST-003.* |
| FR-TEST-006 | M | SC-TEST-005 | SPEC-TEST-004 | T-070 | AT-TEST-004.* |
| FR-TEST-007 | M | SC-VERSION-001 | SPEC-TEST-004 | T-070 | AT-TEST-004.* |
| FR-TEST-008 | S | SC-TEST-006 | SPEC-TEST-003 | T-069 | AT-TEST-003.* |
| FR-TEST-009 | M | SC-TEST-005 | SPEC-TEST-004 | T-070 | AT-TEST-004.* |
| FR-REVIEW-001 | M | SC-REVIEW-001 | SPEC-REVIEW-001 | T-072 | AT-REVIEW-001.* |
| FR-REVIEW-002 | M | SC-REVIEW-004 | SPEC-REVIEW-001 | T-072 | AT-REVIEW-001.* |
| FR-REVIEW-003 | M | SC-REVIEW-001 | SPEC-REVIEW-001 | T-072 | AT-REVIEW-001.* |
| FR-REVIEW-004 | M | SC-REVIEW-003 | SPEC-REVIEW-002 | T-073 | AT-REVIEW-002.* |
| FR-REVIEW-005 | M | SC-REVIEW-002 | SPEC-REVIEW-002 | T-073 | AT-REVIEW-002.* |
| FR-REVIEW-006 | M | SC-REVIEW-002, SC-REVIEW-005 | SPEC-REVIEW-002 | T-073 | AT-REVIEW-002.* |
| FR-REVIEW-007 | M | SC-REVIEW-002 | SPEC-REVIEW-003 | T-074 | AT-REVIEW-003.* |
| FR-REVIEW-008 | M | SC-REVIEW-003 | SPEC-REVIEW-003 | T-074 | AT-REVIEW-003.* |
| FR-REVIEW-009 | M | SC-REVIEW-005 | SPEC-REVIEW-002 | T-073 | AT-REVIEW-002.* |
| FR-REVIEW-010 | M | SC-REVIEW-006 | SPEC-REVIEW-002 | T-073 | AT-REVIEW-002.* |
| FR-PUB-001 | M | — | SPEC-PUB-001 | T-058, T-064, T-075 | AT-PUB-001.* |
| FR-PUB-002 | M | SC-PUBLISH-001 | SPEC-PUB-002 | T-076 | AT-PUB-002.* |
| FR-PUB-003 | M | SC-PUBLISH-002 | SPEC-PUB-002 | T-076 | AT-PUB-002.* |
| FR-PUB-004 | M | SC-PUBLISH-003 | SPEC-PUB-002 | T-076 | AT-PUB-002.* |
| FR-PUB-005 | M | SC-PUBLISH-001 | SPEC-PUB-002 | T-076 | AT-PUB-002.* |
| FR-AUDIT-001 | M | SC-AUDIT-001 | SPEC-AUDIT-001 | T-033, T-041 | AT-AUDIT-001.* |
| FR-AUDIT-002 | M | SC-AUDIT-001 | SPEC-AUDIT-001 | T-033, T-041 | AT-AUDIT-001.* |
| FR-AUDIT-003 | M | SC-AUDIT-002 | SPEC-AUDIT-002 | T-041, T-086 | AT-AUDIT-002.* |
| FR-AUDIT-004 | M | SC-AUDIT-003 | SPEC-AUDIT-002 | T-041, T-086 | AT-AUDIT-002.* |
| FR-DELIV-001 | M (спецификация) | — | SPEC-DELIV-001 | T-077 | AT-DELIV-001.* |
| FR-DELIV-002 | M | SC-ITEM-004 | SPEC-QTYPE-002, SPEC-ITEM-003, SPEC-DELIV-001 | T-053, T-054, T-055, T-056, T-062, T-077 | AT-DELIV-001.*, AT-ITEM-003.*, AT-QTYPE-002.* |
| FR-DELIV-003 | F | — | — | — | — |
| FR-DELIV-004 | F | — | — | — | — |

## 3. Non-functional requirements

| NFR | Верификация | SPEC / ADR | T |
|---|---|---|---|
| NFR-SEC-001 | Тесты, вызывающие API/actions AdminJS напрямую в обход UI, для каждой ячейки permission matrix | SPEC-AUTH-003, SPEC-ITEM-004 | T-034, T-036, T-042, T-059, T-079 |
| NFR-SEC-002 | Unit + review конфигурации | SPEC-AUTH-001, SPEC-AUTH-004 | T-032, T-037, T-038, T-042 |
| NFR-SEC-003 | Интеграционный тест | SPEC-AUTH-001, SPEC-AUTH-002 | T-032, T-037 |
| NFR-SEC-004 | Интеграционный тест | SPEC-AUTH-002 | T-037, T-081 |
| NFR-SEC-005 | Интеграционный тест | SPEC-AUTH-001 | T-032, T-037 |
| NFR-SEC-006 | Тесты загрузки вредоносных/поддельных файлов | SPEC-MEDIA-001 | T-049, T-050, T-051, T-081 |
| NFR-SEC-007 | Тесты XSS-полезных нагрузок | SPEC-QTYPE-002 | T-053, T-054, T-055, T-056, T-081 |
| NFR-SEC-008 | Тест сериализации | SPEC-DELIV-001, SPEC-ITEM-003 | T-062, T-077, T-081 |
| NFR-SEC-009 | CI secret scanning | — | T-031, T-081 |
| NFR-SEC-010 | Негативные тесты (M6) | SPEC-AUTH-003, SPEC-USER-002 | T-032, T-034, T-035, T-036, T-040, T-042, T-079 |
| NFR-SEC-011 | `npm audit`/аналог в CI | — | T-031 |
| NFR-PERF-001 | Нагрузочный тест на seed-данных | SPEC-ITEM-005 | T-063, T-083 |
| NFR-PERF-002 | Нагрузочный тест | — | T-083 |
| NFR-PERF-003 | Code review + тест плана запроса | SPEC-AUTH-003, SPEC-ITEM-005 | T-034, T-036, T-042, T-063, T-079, T-083 |
| NFR-PERF-004 | Интеграционный тест | SPEC-MEDIA-001 | T-049, T-050, T-051, T-083 |
| NFR-PERF-005 | Нагрузочный тест | — | T-083 |
| NFR-A11Y-001 | axe-core в E2E + ручной аудит | — | T-082 |
| NFR-A11Y-002 | AT по BR-025 | — | T-082 |
| NFR-A11Y-003 | Review модели | — | T-082 |
| NFR-AUDIT-001 | AT | SPEC-AUDIT-001, SPEC-USER-001, SPEC-USER-002 | T-032, T-033, T-035, T-039, T-040, T-041 |
| NFR-AUDIT-002 | Unit + AT | SPEC-AUDIT-001 | T-033, T-041 |
| NFR-AUDIT-003 | Тест прав БД | SPEC-AUDIT-001 | T-033, T-041 |
| NFR-AUDIT-004 | Review + тест маскирования | SPEC-AUDIT-001 | T-033, T-041 |
| NFR-AUDIT-005 | Тест отказа записи аудита | SPEC-AUDIT-001 | T-033, T-041 |
| NFR-DATA-001 | AT + тест прямого UPDATE | SPEC-ITEM-002, SPEC-PUB-001 | T-058, T-061, T-064, T-075 |
| NFR-DATA-002 | Тест миграций | — | T-032 |
| NFR-DATA-003 | Тест конкурентного редактирования | SPEC-ITEM-002 | T-058, T-061, T-080 |
| NFR-DATA-004 | Интеграционный тест | SPEC-PUB-001, SPEC-TEST-004 | T-058, T-064, T-070, T-075, T-080 |
| NFR-DATA-005 | Тест | SPEC-TEST-004 | T-070 |
| NFR-DATA-006 | Процедура восстановления, проверенная в M6 | — | T-084 |
| NFR-DATA-007 | Unit | — | T-032 |
| NFR-EXT-001 | ADR-001/005 review; тест «добавить тип-фикстуру» | SPEC-QTYPE-001, SPEC-QTYPE-002 | T-053, T-054, T-055, T-056, T-057 |
| NFR-EXT-002 | Contract test для каждого плагина | SPEC-QTYPE-002 | T-053, T-054, T-055, T-056 |
| NFR-EXT-003 | ADR-006 review | — | T-032 |
| NFR-EXT-004 | Тест с двумя драйверами | — | T-049 |
| NFR-EXT-005 | Review SPEC-DELIV-001 | SPEC-DELIV-001 | T-077 |
| NFR-MAINT-001 | Архитектурный тест зависимостей (запрет импорта domain → adminjs) | — | T-031 |
| NFR-MAINT-002 | CI | — | T-031 |
| NFR-MAINT-003 | CI coverage + acceptance matrix | — | T-031 |
| NFR-MAINT-004 | Review | — | T-031 |
| NFR-MAINT-005 | CI | — | T-031 |
| NFR-OBS-001 | Review + тест маскирования | — | T-085 |
| NFR-OBS-002 | Интеграционный тест | — | T-085 |
| NFR-OBS-003 | Review | — | T-085 |
| NFR-OBS-004 | Тест | SPEC-AUTH-003 | T-034, T-036, T-042, T-079, T-085 |
| NFR-L10N-001 | Review | — | T-031 |

## 4. Specifications

| SPEC | Название | Блок | FR/NFR | SC | BR | T | AC |
|---|---|---|---|---|---|---|---|
| [SPEC-ASSIGN-001](../specs/assignments/SPEC-ASSIGN-001-assignment-creation.md) | Создание и адресация задания | BL-04 | FR-ASSIGN-001, FR-ASSIGN-002, FR-ASSIGN-003, FR-ASSIGN-006 | SC-ASSIGN-001, SC-E2E-001 | BR-018, BR-021, BR-027, BR-039, BR-043 | T-046 | 6 |
| [SPEC-ASSIGN-002](../specs/assignments/SPEC-ASSIGN-002-assignment-lifecycle.md) | Жизненный цикл задания, дедлайн, прогресс | BL-04 | FR-ASSIGN-004, FR-ASSIGN-005, FR-ASSIGN-007, FR-ASSIGN-008 | SC-ASSIGN-002, SC-ASSIGN-003, SC-TEST-001 | BR-017, BR-031, BR-035 | T-047 | 6 |
| [SPEC-AUDIT-001](../specs/audit/SPEC-AUDIT-001-audit-log.md) | Журнал аудита | BL-11 | FR-AUDIT-001, FR-AUDIT-002, NFR-AUDIT-001, NFR-AUDIT-002, NFR-AUDIT-003, NFR-AUDIT-004, NFR-AUDIT-005 | SC-AUDIT-001, SC-E2E-001 | BR-034, BR-035 | T-033, T-041 | 6 |
| [SPEC-AUDIT-002](../specs/audit/SPEC-AUDIT-002-history-archive.md) | История объекта, архивирование и восстановление | BL-11 | FR-AUDIT-003, FR-AUDIT-004 | SC-AUDIT-002, SC-AUDIT-003 | BR-005, BR-039, BR-042, BR-044 | T-041, T-086 | 4 |
| [SPEC-AUTH-001](../specs/auth/SPEC-AUTH-001-login.md) | Вход в систему | BL-01 | FR-AUTH-001, FR-AUTH-004, FR-AUTH-006, NFR-SEC-002, NFR-SEC-003, NFR-SEC-005 | SC-AUTH-001, SC-AUTH-003 | BR-014, BR-035 | T-032, T-037 | 7 |
| [SPEC-AUTH-002](../specs/auth/SPEC-AUTH-002-session-logout.md) | Сессия и выход | BL-01 | FR-AUTH-002, FR-AUTH-003, NFR-SEC-003, NFR-SEC-004 | SC-AUTH-002 | BR-014 | T-037 | 5 |
| [SPEC-AUTH-003](../specs/auth/SPEC-AUTH-003-authorization.md) | Server-side authorization | BL-02 | FR-AUTH-006, FR-PERM-002, FR-PERM-003, FR-PERM-004, NFR-SEC-001, NFR-SEC-010, NFR-PERF-003, NFR-OBS-004 | SC-ITEM-005, SC-E2E-001 | BR-001, BR-004, BR-013, BR-015 | T-034, T-036, T-042, T-079 | 8 |
| [SPEC-AUTH-004](../specs/auth/SPEC-AUTH-004-password-account.md) | Пароли и активация аккаунта | BL-01 | FR-AUTH-005, FR-AUTH-007, NFR-SEC-002 | SC-AUTH-004, SC-USER-001 | BR-014, BR-035 | T-038, T-042 | 5 |
| [SPEC-DELIV-001](../specs/delivery/SPEC-DELIV-001-delivery-model.md) | Модель данных прохождения (подготовка) | BL-12 | FR-DELIV-001, FR-DELIV-002, NFR-EXT-005, NFR-SEC-008 | — | BR-036, BR-037 | T-077 | 5 |
| [SPEC-EDU-001](../specs/education/SPEC-EDU-001-taxonomy.md) | Предметы, курсы, темы, учебные цели | BL-03 | FR-EDU-001, FR-EDU-002, FR-EDU-003, FR-EDU-005 | SC-EDU-001, SC-AUDIT-003 | BR-039, BR-042, BR-035 | T-044 | 5 |
| [SPEC-EDU-002](../specs/education/SPEC-EDU-002-groups.md) | Группы студентов | BL-03 | FR-EDU-004 | SC-EDU-002 | BR-035 | T-045 | 4 |
| [SPEC-ITEM-001](../specs/items/SPEC-ITEM-001-item-creation.md) | Создание вопроса | BL-07 | FR-ITEM-001, FR-ITEM-002, FR-ITEM-005 | SC-ITEM-001, SC-ITEM-002, SC-E2E-001 | BR-017, BR-018, BR-019, BR-020, BR-021, BR-024, BR-025, BR-039, BR-004 | T-060 | 9 |
| [SPEC-ITEM-002](../specs/items/SPEC-ITEM-002-item-versioning.md) | Редактирование, версии, отправка, архивирование вопроса | BL-07 | FR-ITEM-003, FR-ITEM-004, FR-ITEM-008, FR-ITEM-009, FR-ITEM-010, NFR-DATA-001, NFR-DATA-003 | SC-ITEM-003, SC-ITEM-006, SC-ITEM-007, SC-VERSION-001, SC-VERSION-002 | BR-003, BR-004, BR-005, BR-006, BR-007, BR-019, BR-020, BR-024, BR-025, BR-038, BR-039, BR-041, BR-044 | T-058, T-061 | 10 |
| [SPEC-ITEM-003](../specs/items/SPEC-ITEM-003-item-preview.md) | Предпросмотр вопроса | BL-07 | FR-ITEM-006, FR-DELIV-002, NFR-SEC-008 | SC-ITEM-004 | — | T-062 | 4 |
| [SPEC-ITEM-004](../specs/items/SPEC-ITEM-004-item-permissions.md) | Ownership policy и доступ к вопросам | BL-07 | FR-ITEM-011, FR-PERM-002, FR-PERM-003, NFR-SEC-001 | SC-ITEM-005, SC-E2E-001 | BR-001, BR-004, BR-006, BR-007 | T-059 | 6 |
| [SPEC-ITEM-005](../specs/items/SPEC-ITEM-005-item-filtering.md) | Банк вопросов: список, фильтрация, drawer | BL-07 | FR-ITEM-007, FR-PERM-003, NFR-PERF-001, NFR-PERF-003 | SC-ITEM-005, SC-TEST-002 | BR-039 | T-063 | 5 |
| [SPEC-MEDIA-001](../specs/media/SPEC-MEDIA-001-upload-metadata.md) | Загрузка медиа и метаданные | BL-05 | FR-MEDIA-001, FR-MEDIA-002, FR-MEDIA-004, FR-MEDIA-005, FR-MEDIA-008, NFR-SEC-006, NFR-PERF-004 | SC-MEDIA-001, SC-MEDIA-003 | BR-025, BR-045, BR-035 | T-049, T-050, T-051 | 7 |
| [SPEC-MEDIA-002](../specs/media/SPEC-MEDIA-002-rights-usage.md) | Права, использование, архивирование медиа | BL-05 | FR-MEDIA-003, FR-MEDIA-006, FR-MEDIA-007 | SC-MEDIA-002, SC-AUDIT-003 | BR-005, BR-024, BR-026, BR-039, BR-045, BR-035 | T-052, T-086 | 7 |
| [SPEC-PUB-001](../specs/publishing/SPEC-PUB-001-lifecycle.md) | Жизненный цикл версий | BL-10 | FR-PUB-001, NFR-DATA-001, NFR-DATA-004 | — | BR-002, BR-006, BR-007, BR-008, BR-013, BR-041 | T-058, T-064, T-075 | 5 |
| [SPEC-PUB-002](../specs/publishing/SPEC-PUB-002-publish-withdraw-archive.md) | Публикация, отзыв, архивирование теста | BL-10 | FR-PUB-002, FR-PUB-003, FR-PUB-004, FR-PUB-005 | SC-PUBLISH-001, SC-PUBLISH-002, SC-PUBLISH-003, SC-E2E-001 | BR-005, BR-008, BR-009, BR-036, BR-039 | T-076 | 7 |
| [SPEC-QTYPE-001](../specs/question-types/SPEC-QTYPE-001-registry.md) | Реестр типов вопросов | BL-06 | FR-QTYPE-001, FR-QTYPE-002, FR-QTYPE-003, FR-QTYPE-004, NFR-EXT-001 | SC-QTYPE-001, SC-QTYPE-002 | BR-021, BR-022, BR-023, BR-035 | T-057 | 6 |
| [SPEC-QTYPE-002](../specs/question-types/SPEC-QTYPE-002-interaction-plugin-contract.md) | Контракт interaction plugin | BL-06 | FR-QTYPE-005, FR-QTYPE-006, FR-DELIV-002, NFR-EXT-001, NFR-EXT-002, NFR-SEC-007 | SC-ITEM-001, SC-ITEM-002, SC-ITEM-004 | BR-020, BR-023, INV-015 | T-053, T-054, T-055, T-056 | 5 |
| [SPEC-REVIEW-001](../specs/reviews/SPEC-REVIEW-001-reviewer-assignment-queue.md) | Назначение эксперта и очередь экспертизы | BL-09 | FR-REVIEW-001, FR-REVIEW-002, FR-REVIEW-003 | SC-REVIEW-001, SC-REVIEW-004, SC-E2E-001 | BR-001, BR-027, BR-030, BR-035 | T-072 | 6 |
| [SPEC-REVIEW-002](../specs/reviews/SPEC-REVIEW-002-review-conduct.md) | Проведение экспертизы: checklist, комментарии, замечания | BL-09 | FR-REVIEW-004, FR-REVIEW-005, FR-REVIEW-006, FR-REVIEW-009, FR-REVIEW-010 | SC-REVIEW-002, SC-REVIEW-005, SC-REVIEW-006, SC-E2E-001 | BR-028, BR-030, BR-040 | T-073 | 7 |
| [SPEC-REVIEW-003](../specs/reviews/SPEC-REVIEW-003-review-decisions.md) | Решения экспертизы: вернуть на доработку, принять | BL-09 (+ BL-10) | FR-REVIEW-007, FR-REVIEW-008 | SC-REVIEW-002, SC-REVIEW-003, SC-E2E-001 | BR-001, BR-011, BR-012, BR-024, BR-028, BR-029, BR-030, BR-040 | T-074 | 9 |
| [SPEC-TEST-001](../specs/tests/SPEC-TEST-001-test-creation.md) | Создание теста | BL-08 | FR-TEST-001 | SC-TEST-001, SC-E2E-001 | BR-017, BR-033, BR-043 | T-066 | 4 |
| [SPEC-TEST-002](../specs/tests/SPEC-TEST-002-test-structure.md) | Структура теста: разделы, фиксированные вопросы, случайный отбор | BL-08 | FR-TEST-002, FR-TEST-003, FR-TEST-004 | SC-TEST-002, SC-TEST-003 | BR-004, BR-007, BR-010, BR-011, BR-012, BR-039 | T-067, T-068 | 7 |
| [SPEC-TEST-003](../specs/tests/SPEC-TEST-003-test-settings-preview.md) | Настройки и предпросмотр теста | BL-08 | FR-TEST-005, FR-TEST-008 | SC-TEST-004, SC-TEST-006 | BR-007 | T-069 | 4 |
| [SPEC-TEST-004](../specs/tests/SPEC-TEST-004-test-versioning-submission.md) | Готовность, отправка на экспертизу, новые версии теста | BL-08 (+ BL-10) | FR-TEST-006, FR-TEST-007, FR-TEST-009, NFR-DATA-004, NFR-DATA-005 | SC-TEST-005, SC-VERSION-001, SC-E2E-001 | BR-002, BR-003, BR-007, BR-011, BR-012, BR-017, BR-020, BR-024, BR-025, BR-031, BR-032, BR-038, BR-041 | T-070 | 8 |
| [SPEC-USER-001](../specs/users/SPEC-USER-001-user-management.md) | Управление пользователями | BL-02 | FR-USER-001, FR-USER-002, FR-USER-003, FR-USER-005, FR-USER-006, NFR-AUDIT-001 | SC-USER-001, SC-USER-003 | BR-005, BR-014, BR-015, BR-016, BR-035 | T-032, T-039 | 8 |
| [SPEC-USER-002](../specs/users/SPEC-USER-002-roles-permissions.md) | Роли и назначение ролей | BL-02 | FR-USER-004, FR-PERM-001, NFR-AUDIT-001, NFR-SEC-010 | SC-USER-002, SC-PERM-001 | BR-015, BR-016, BR-035, BR-046 | T-032, T-035, T-040 | 7 |
