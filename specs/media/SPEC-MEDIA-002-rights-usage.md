# SPEC-MEDIA-002: Права, использование, архивирование медиа

| Поле | Значение |
|---|---|
| Блок | BL-05 |
| Requirements | FR-MEDIA-003, FR-MEDIA-006, FR-MEDIA-007 |
| Scenarios | SC-MEDIA-002, SC-AUDIT-003 |
| Business rules | BR-005, BR-024, BR-026, BR-039, BR-045, BR-035 |
| Domain entities | MediaAsset, ItemOption, ItemMedia, ItemVersion, TestVersion |
| Permissions | `media.rights.manage`, `media.archive` |
| ADR | ADR-005, ADR-007 |
| Статус | Draft |

## Purpose
Гарантировать, что утвержденный и опубликованный контент использует только медиа с подтвержденными правами, и что используемые файлы не исчезают.

## Actors
Teacher, Admin (права); owner (архив своих).

## Preconditions
MediaAsset существует.

## Input
| Поле | Тип | Обязательно | Валидация |
|---|---|---|---|
| rightsStatus | enum | да | переход PENDING ↔ CLEARED ↔ RESTRICTED |
| license, rightsHolder, creditLine, source, rightsNote | | для CLEARED — см. media-model §2–3 | |
| archive reason | string | да при архиве | |

## Business rules
* BR-045 — только `media.rights.manage` устанавливает CLEARED/RESTRICTED.
* BR-024 — submit и approve проверяют CLEARED для всех медиа версии.
* BR-026 — удаление/замена файла используемого медиа запрещены.
* BR-039 — архивированное медиа нельзя добавить в новые версии.

## Main scenario
1. Set CLEARED: проверка обязательных полей (license ≠ UNKNOWN; source; rightsHolder и creditLine, кроме PUBLIC_DOMAIN/CC0; rightsNote для LICENSED/EDUCATIONAL_EXCEPTION) → rightsVerifiedBy/At → аудит.
2. Set RESTRICTED: обязательная rightsNote → отчет «где используется», включая PUBLISHED тесты → аудит. Утвержденные версии не меняются; решение о withdraw принимает Admin (SPEC-PUB-002).
3. Изменение полей прав у CLEARED пользователем без `media.rights.manage` → статус возвращается в PENDING.
4. Usage: список ItemVersion (с состоянием) и TestVersion, ссылающихся на медиа (через ItemOption/ItemMedia).
5. Archive: status = ARCHIVED; ссылки сохраняются; в пикере скрыто. Restore — owner/Admin.
6. Delete: только при отсутствии любых ссылок; иначе отказ (BR-026). Байты удаляются фоновой задачей (ADR-007).

## Alternative scenarios
* A1 Недостаточно данных для CLEARED → ошибки полей.
* A2 Попытка заменить файл → действие отсутствует; прямой запрос отклонен; предложение загрузить новый MediaAsset.

## Data changes
MediaAsset (rights fields, status), AuditLog.

## Authorization
`media.rights.manage` ANY; `media.archive` OWN/ANY.

## UI behavior (AdminJS)
Вкладка «Права» и вкладка «Где используется» в карточке медиа; бейдж статуса прав в сетке и пикере.

## Acceptance criteria
| ID | Критерий | Тип |
|---|---|---|
| AC-MEDIA-002.1 | Teacher устанавливает CLEARED при заполненных обязательных полях; аудит | positive |
| AC-MEDIA-002.2 | Student не может установить CLEARED (прямой запрос) | permission |
| AC-MEDIA-002.3 | Изменение лицензии студентом у CLEARED медиа возвращает PENDING | positive |
| AC-MEDIA-002.4 | Удаление медиа, используемого не-DRAFT версией, отклоняется | negative |
| AC-MEDIA-002.5 | Архивированное медиа нельзя выбрать в новом вопросе | negative |
| AC-MEDIA-002.6 | «Где используется» показывает ссылки через ItemOption и ItemMedia | positive |
| AC-MEDIA-002.7 | RESTRICTED показывает затронутые опубликованные тесты | positive |
