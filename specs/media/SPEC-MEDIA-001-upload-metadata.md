# SPEC-MEDIA-001: Загрузка медиа и метаданные

| Поле | Значение |
|---|---|
| Блок | BL-05 |
| Requirements | FR-MEDIA-001, FR-MEDIA-002, FR-MEDIA-004, FR-MEDIA-005, FR-MEDIA-008, NFR-SEC-006, NFR-PERF-004 |
| Scenarios | SC-MEDIA-001, SC-MEDIA-003 |
| Business rules | BR-025, BR-045, BR-035 |
| Domain entities | MediaAsset, MediaDerivative, Tag, Topic |
| Permissions | `media.upload`, `media.update`, `media.read` |
| ADR | ADR-007 |
| Статус | Draft |

## Purpose
Единая медиатека изображений и видео произведений искусства с метаданными, достаточными для корректной атрибуции и доступности.

## Actors
Student, Teacher, Admin.

## Preconditions
`media.upload`.

## Input
| Поле | Тип | Обязательно | Валидация |
|---|---|---|---|
| file | binary | да | сигнатура ∈ форматы media-model §1; лимиты размера/пикселей |
| title | string | да | 1–300 |
| altText | string | нет при загрузке | 1–1000 |
| caption | string | нет | ≤ 2000 |
| depictsArtwork | bool | да (по умолчанию true) | |
| artwork.* | strings | artist и workTitle — если depictsArtwork | |
| source.url / source.description | string | нет при загрузке | url — http(s) |
| license | enum | да (по умолчанию UNKNOWN) | |
| tags, topics | | нет | активные |

## Business rules
* BR-045 — `rightsStatus` при загрузке всегда `PENDING`, клиентское значение игнорируется.
* BR-025 — alt text обязателен к моменту использования в отправляемом вопросе (проверяется в SPEC-ITEM/SPEC-TEST).

## Main scenario
1. Файл принимается потоково во временный ключ storage; проверяется сигнатура и лимиты.
2. Изображения декодируются/перекодируются (sharp), удаляются GPS EXIF; вычисляется sha256, размеры.
3. Проверка дубликата по sha256 → предупреждение со ссылкой на существующий (не блокирует).
4. Транзакция: MediaAsset (ownerId = actor, rightsStatus = PENDING, status = ACTIVE) + аудит; объект перемещается в постоянный ключ.
5. Задание на генерацию производных ставится в очередь; до готовности UI показывает плейсхолдер.

## Alternative scenarios
* A1 Неподдерживаемый формат / подмена расширения → ошибка, временный файл удаляется.
* A2 Ошибка генерации производных → повтор с backoff; после 3 неудач — статус производных `FAILED`, видимый в карточке.
* A3 Редактирование метаданных — `media.update` (OWN/ANY); поля прав — SPEC-MEDIA-002.

## Data changes
MediaAsset, MediaDerivative, Tag links, AuditLog; объекты storage.

## Authorization
`media.upload` ANY; `media.update` OWN/ANY; `media.read` ANY (файлы выдаются через авторизованный endpoint).

## UI behavior (AdminJS)
Ресурс «Медиатека» с сеточным списком превью, фильтрами (текст, artist, тег, тема, kind, rightsStatus, архив); компонент загрузки (drag-and-drop); медиа-пикер, переиспользуемый в редакторах вопросов.

## Acceptance criteria
| ID | Критерий | Тип |
|---|---|---|
| AC-MEDIA-001.1 | Загрузка JPEG/PNG/WebP/MP4 создает MediaAsset с PENDING и превью | positive |
| AC-MEDIA-001.2 | Файл с подмененным расширением (например, HTML как .jpg) отклоняется | security |
| AC-MEDIA-001.3 | Превышение лимита размера отклоняется | negative |
| AC-MEDIA-001.4 | Клиентское значение rightsStatus при загрузке игнорируется | security |
| AC-MEDIA-001.5 | GPS-метаданные удаляются из изображения | security |
| AC-MEDIA-001.6 | Поиск по artist/workTitle/тегу находит медиа | positive |
| AC-MEDIA-001.7 | Файл недоступен без аутентификации; прямой URL storage недоступен | security |
