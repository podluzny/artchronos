# SPEC-ITEM-003: Предпросмотр вопроса

| Поле | Значение |
|---|---|
| Блок | BL-07 |
| Requirements | FR-ITEM-006, FR-DELIV-002, NFR-SEC-008 |
| Scenarios | SC-ITEM-004 |
| Business rules | — |
| Domain entities | ItemVersion, QuestionTypeVersion |
| Permissions | `item.read` |
| ADR | ADR-001 |
| Статус | Draft |

## Purpose
Дать автору и эксперту увидеть вопрос так, как его увидит студент, и проверить работу оценивания до экспертизы.

## Actors
Автор, reviewer, Admin, Teacher (чтение банка).

## Preconditions
`item.read` на версию.

## Input
versionId, seed (опционально), тестовый ответ.

## Business rules
Нет изменяющих правил; preview не создает Attempt/Response.

## Main scenario
1. Загружается версия и Preview-компонент плагина.
2. Варианты перемешиваются по seed (если включено).
3. Пользователь вводит ответ; сервер вычисляет оценку evaluator'ом (без сохранения).
4. Показ: балл, правильный ответ, feedback.

## Alternative scenarios
* A1 Версия с ERROR-Issues → preview отображается с баннером ошибок; оценивание недоступно, если answerKey невалиден.

## Data changes
Нет.

## Authorization
`item.read`; ключ ответа отображается только тем, кто вправе видеть версию в режиме автора/эксперта (в MVP — все, кто имеет `item.read`; разделение для Student Runner — NFR-SEC-008).

## UI behavior (AdminJS)
Action «Предпросмотр» (модальное окно / drawer) на вопросе и внутри review.

## Acceptance criteria
| ID | Критерий | Тип |
|---|---|---|
| AC-ITEM-003.1 | Preview отображает вопрос через компонент плагина | positive |
| AC-ITEM-003.2 | Ответ оценивается evaluator'ом; результат совпадает с эталоном | positive |
| AC-ITEM-003.3 | Preview не создает записей Attempt/Response и не меняет версию | negative |
| AC-ITEM-003.4 | Preview недоступен без `item.read` (404) | permission |
