# SPEC-REVIEW-002: Проведение экспертизы: checklist, комментарии, замечания

| Поле | Значение |
|---|---|
| Блок | BL-09 |
| Requirements | FR-REVIEW-004, FR-REVIEW-005, FR-REVIEW-006, FR-REVIEW-009, FR-REVIEW-010 |
| Scenarios | SC-REVIEW-002, SC-REVIEW-005, SC-REVIEW-006, SC-E2E-001 (шаги 10–11, 15) |
| Business rules | BR-028, BR-030, BR-040 |
| Domain entities | Review, ReviewChecklist, ReviewChecklistAnswer, ReviewComment, ContentIssue |
| Permissions | `review.perform`, `review.comment`, `review.read`, `checklist.manage` |
| Статус | Draft |

## Purpose
Структурированная экспертиза с прослеживаемыми замечаниями, которые переходят между версиями до их закрытия.

## Actors
Primary reviewer, advisory reviewer, автор, Admin (шаблоны).

## Preconditions
Review OPEN/IN_PROGRESS; actor назначен (или автор — для ответов).

## Input
| Операция | Поля |
|---|---|
| start | — (PRIMARY): версия → IN_REVIEW |
| checklist answer | itemCode, checked, note |
| comment | body, anchor {subjectType/id, sectionId?, itemVersionId?, fieldPath?}, parentId? |
| raise issue | commentId или body+anchor, severity |
| mark addressed (автор) | issueId, note, addressedInVersionId |
| resolve / reopen / wont_fix (reviewer) | issueId, note |

## Checklist по умолчанию (seed, Q-024)

**TEST_VERSION** (все обязательные, кроме отмеченных):
1. Соответствие темам и учебным целям задания.
2. Корректность ключей ответов во всех вопросах.
3. Однозначность формулировок, отсутствие подсказок в формулировке.
4. Качество дистракторов (правдоподобны, однозначно неверны).
5. Фактическая точность атрибуций (автор, название, датировка, место хранения).
6. Медиа: права подтверждены, alt text содержателен, подписи корректны.
7. Баланс сложности и баллов соответствует назначению теста.
8. Грамотность и стиль.
9. *(необязательный)* Инструкции и настройки теста понятны студенту.

**ITEM_VERSION**: пункты 2, 3, 4, 5, 6, 8 — обязательные.

## Business rules
* BR-028 — approve требует checklist и отсутствия открытых BLOCKING.
* BR-030 — checklist и решения — только PRIMARY; ADVISORY создает комментарии и issues любой severity, но не принимает решения и не закрывает issues.
* BR-040 — после решения Review read-only.

## Main scenario
1. PRIMARY «Начать экспертизу» → Review IN_PROGRESS, версия IN_REVIEW.
2. Reviewer просматривает preview (SPEC-TEST-003/ITEM-003) и пакет вопросов.
3. Комментирует с привязкой; комментарий можно пометить как ContentIssue (OPEN, severity).
4. Автор может отвечать в потоке (review.comment OWN) во время review; изменения содержимого невозможны.
5. Отмечает checklist (с автосохранением).
6. Переход к решению — SPEC-REVIEW-003.
7. Перенос (FR-REVIEW-009): при создании новой версии все issues в OPEN/ADDRESSED связываются с новой версией; при новом review они отображаются в разделе «Замечания предыдущих версий» с diff соответствующего места; автор помечает ADDRESSED; reviewer — RESOLVED/OPEN/WONT_FIX.
8. Шаблоны checklist (Admin): изменения применяются к новым Review; Review хранит ссылку на версию шаблона.

## Alternative scenarios
* A1 Попытка изменить комментарий/issue закрытого Review → отказ BR-040 (кроме статуса issues, переносимых в новый Review — изменение происходит в контексте нового Review).
* A2 Автор пытается RESOLVE/WONT_FIX → отказ (только ADDRESSED).

## Data changes
Review, ReviewChecklistAnswer, ReviewComment, ContentIssue, TestVersion/ItemVersion.state (start), AuditLog.

## Authorization
`review.perform` ASSIGNED+PRIMARY для start/checklist; `review.comment` ASSIGNED или OWN (автор); BR-001 для start (автор не может быть reviewer).

## UI behavior (AdminJS)
Кастомная страница Review: слева — preview объекта с маркерами комментариев; справа — вкладки «Checklist», «Замечания», «Обсуждение»; счетчик открытых BLOCKING.

## Acceptance criteria
| ID | Критерий | Тип |
|---|---|---|
| AC-REVIEW-002.1 | Start переводит версию в IN_REVIEW; recall после этого невозможен | positive |
| AC-REVIEW-002.2 | Комментарий привязывается к вопросу/полю и отображается в этом месте | positive |
| AC-REVIEW-002.3 | ADVISORY не может отмечать checklist | permission |
| AC-REVIEW-002.4 | Автор не может закрыть замечание, может пометить ADDRESSED | permission |
| AC-REVIEW-002.5 | Незакрытые замечания переносятся в review следующей версии | positive |
| AC-REVIEW-002.6 | Комментарии закрытого Review не изменяются | negative |
| AC-REVIEW-002.7 | Студент-автор не видит review чужих тестов | permission |
