# Media Model

| Поле | Значение |
|---|---|
| Задача | T-002 |
| Статус | Draft — ожидает review (T-030) |
| Связанные | ADR-007, SPEC-MEDIA-001, SPEC-MEDIA-002 |

## 1. Поддерживаемые типы (MVP)

| kind | Форматы на входе | Хранение | Лимит | Производные |
|---|---|---|---|---|
| `IMAGE` | JPEG, PNG, WebP, TIFF | Оригинал (TIFF конвертируется в PNG, оригинал сохраняется) | 50 МБ, ≤ 12 000 px по стороне | `THUMB` (320px), `PREVIEW` (1600px), WebP |
| `VIDEO` | MP4 (H.264/AAC), WebM | Оригинал | 500 МБ | `POSTER` (кадр) |

Вне MVP: аудио, SVG (риск XSS), 3D, внешние ссылки на видеохостинги, IIIF.

## 2. Метаданные

| Группа | Поле | Обязательность |
|---|---|---|
| Описание | `title` | при загрузке |
| | `altText` | обязателен к моменту использования в отправляемом вопросе (BR-025); рекомендуется при загрузке |
| | `caption` | нет |
| | `transcript` (видео) | нет (NFR-A11Y-003) |
| Произведение | `artwork.artist`, `artwork.workTitle`, `artwork.dateText`, `artwork.technique`, `artwork.collection`, `artwork.inventoryNo` | `artist` и `workTitle` — если медиа изображает произведение (флаг `depictsArtwork`) |
| Источник | `source.url`, `source.description` | одно из двух — обязательно для `CLEARED` |
| Права | `license` | при загрузке (по умолчанию `UNKNOWN`) |
| | `rightsHolder`, `creditLine` | обязательны для `CLEARED`, кроме `PUBLIC_DOMAIN`/`CC0` (creditLine рекомендуется) |
| | `rightsStatus` | система: `PENDING` при загрузке |
| | `rightsVerifiedBy`, `rightsVerifiedAt`, `rightsNote` | система при смене статуса |
| Классификация | `tags`, `topicIds` | нет |
| Техническое | `mimeType`, `sizeBytes`, `sha256`, `width`, `height`, `durationSec` | система |

## 3. Хранение copyright/license

* `license` — перечисление (см. domain-model); `LICENSED` требует `rightsNote` с основанием (договор, письмо); `EDUCATIONAL_EXCEPTION` — использование в учебных целях по закону, требует `rightsNote`.
* `rightsStatus`:
  * `PENDING` — не проверено; можно использовать только в черновиках;
  * `CLEARED` — проверено пользователем с `media.rights.manage` (BR-045);
  * `RESTRICTED` — нельзя использовать в новом контенте; существующие утвержденные версии сохраняются, но администратор получает отчет о затронутых опубликованных тестах (для решения о withdraw).
* Изменение полей прав после `CLEARED` возвращает статус в `PENDING` (если не выполняется пользователем с `media.rights.manage`) и журналируется.

## 4. Использование

| Связь | Где | Переопределение alt |
|---|---|---|
| `ItemMedia` (STIMULUS, ILLUSTRATION) | стимул/иллюстрация вопроса | `altTextOverride` |
| `ItemOption.mediaAssetId` | вариант-изображение | `altTextOverride` |
| `Material.mediaAssetIds` | учебные материалы | — |

«Использование» = ссылка из любой версии. «Значимое использование» = ссылка из не-DRAFT версии — блокирует удаление и замену файла (BR-026).

## 5. Дедупликация

При загрузке вычисляется `sha256`; при совпадении с существующим активным медиа пользователь получает предложение использовать существующее (не блокирует).
