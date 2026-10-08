# SPEC-DELIV-001: Модель данных прохождения (подготовка)

| Поле | Значение |
|---|---|
| Блок | BL-12 |
| Requirements | FR-DELIV-001, FR-DELIV-002, NFR-EXT-005, NFR-SEC-008 |
| Scenarios | — (Student Runner вне MVP) |
| Business rules | BR-036, BR-037 |
| Domain entities | Attempt, Response, ResponseEvaluation, Result, ItemStatistics, TestStatistics |
| Permissions | будущие: `attempt.start`, `attempt.submit`, `response.evaluate`, `result.read` |
| Статус | Draft (только модель, без UI) |

## Purpose
Гарантировать, что модель контента MVP позволит построить Student Runner и аналитику без миграции существующих данных.

## Actors
(будущие) Student, Teacher (ручная оценка), система.

## Preconditions
Опубликованная TestVersion.

## Input
—

## Business rules
* BR-037 — Attempt ссылается на PUBLISHED на момент старта TestVersion.
* BR-036 — отзыв не затрагивает попытки.

## Main scenario (логическая модель, проверяемая тестом-прототипом)
1. Start: Attempt(testVersionId, userId, attemptNo ≤ maxAttempts, seed); deliveredItems = детерминированная выборка: фиксированные + для каждого правила выбор `count` из SelectionPoolEntry по seed; порядок по shuffle-настройкам; порядок вариантов по shuffleOptions.
2. Answer: Response(attemptId, itemVersionId, payload) — payload валидируется responseSchema QuestionTypeVersion версии вопроса.
3. Submit/expire: для AUTO-методов — ResponseEvaluation через `plugin.evaluate`; для MANUAL — ожидание.
4. Result: сумма по ResponseEvaluation × points (TestSectionItem.points / SelectionRule.pointsPerItem) с нормировкой score/maxScore вопроса.
5. Аналитика: агрегаты по ItemVersion и ItemOption.key.

## Alternative scenarios
—

## Data changes
Только схема (миграции создаются в M5 для проверки совместимости; таблицы пустые).

## Authorization
Вне MVP. `answerKey` никогда не сериализуется в delivery-контекст (NFR-SEC-008).

## UI behavior (AdminJS)
Нет.

## Acceptance criteria
| ID | Критерий | Тип |
|---|---|---|
| AC-DELIV-001.1 | Тест-прототип (без UI) создает Attempt по PUBLISHED версии, отвечает на все MVP-типы и получает Result без изменения схемы контента | architecture |
| AC-DELIV-001.2 | Attempt по не-PUBLISHED версии невозможен (domain) | negative |
| AC-DELIV-001.3 | Одинаковый seed дает одинаковую выборку | positive |
| AC-DELIV-001.4 | Delivery-сериализатор не содержит answerKey | security |
| AC-DELIV-001.5 | Withdraw версии не изменяет существующие Attempt/Result | data |
