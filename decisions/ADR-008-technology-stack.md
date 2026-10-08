# ADR-008: Технологический стек

| Поле | Значение |
|---|---|
| Статус | Proposed |
| Дата | 2026-10-08 |
| Задача | T-010 |
| Связанные требования | project-context §3, NFR-MAINT-*, NFR-DATA-*, NFR-OBS-* |

## Контекст
AdminJS обязателен, что определяет платформу (Node.js) и ограничивает выбор ORM поддерживаемыми адаптерами.

## Решение
| Область | Выбор | Примечание |
|---|---|---|
| Runtime | Node.js LTS (актуальная LTS-ветка на момент M1) | |
| Язык | TypeScript, `strict` | NFR-MAINT-002 |
| Admin UI | AdminJS 7 + `@adminjs/express` | Кастомные компоненты на React (входит в AdminJS) |
| HTTP | Express | Требование `@adminjs/express` |
| БД | PostgreSQL 16 | JSONB, триггеры, транзакции |
| ORM / миграции | Prisma (+ `@adminjs/prisma` только для read-only/служебных ресурсов) | Governed-ресурсы — через `DomainResource` (ADR-004) |
| JSON Schema | Ajv (draft 2020-12) | ADR-001, ADR-005 |
| Хэширование паролей | argon2 (argon2id) | NFR-SEC-002 |
| Изображения | sharp | ADR-007 |
| Object storage | S3 API (`@aws-sdk/client-s3`), MinIO для dev | ADR-007 |
| Очередь фоновых задач | Таблица в PostgreSQL (например, pg-boss) | Без отдельного брокера в MVP |
| Unit/integration тесты | Vitest, Testcontainers (PostgreSQL, MinIO) | |
| E2E | Playwright (+ axe-core) | NFR-A11Y-001 |
| Архитектурные проверки | dependency-cruiser | NFR-MAINT-001 |
| Логи | pino (JSON) | NFR-OBS-001 |
| Контейнеризация | Docker, docker-compose для dev | |

## Рассмотренные альтернативы
| Вариант | Почему отклонен |
|---|---|
| TypeORM / MikroORM | Работоспособны; Prisma выбрана за типобезопасность и миграции. Решение пересматриваемо до M1 |
| Отдельный брокер (Redis/RabbitMQ) | Лишняя инфраструктура для MVP |

## Последствия
Точные версии фиксируются в `package.json` в задаче настройки проекта (первая задача M1).

## Верификация
Review в T-030; CI проверяет lint, typecheck, тесты, dependency rules.
