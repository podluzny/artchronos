# ADR-008: Технологический стек

| Поле | Значение |
|---|---|
| Статус | Accepted (T-030, 2026-10-08) |
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
| Доступ к БД / миграции | **Kysely + node-postgres (`pg`)**, миграции — TypeScript-файлы с SQL (Kysely Migrator) | Изменено в T-031, см. «Изменение 2026-10-08». Все ресурсы AdminJS — через `DomainResource` (ADR-004) |
| JSON Schema | Ajv (draft 2020-12) | ADR-001, ADR-005 |
| Хэширование паролей | argon2 (argon2id) | NFR-SEC-002 |
| Изображения | sharp | ADR-007 |
| Object storage | S3 API (`@aws-sdk/client-s3`), MinIO для dev | ADR-007 |
| Очередь фоновых задач | Таблица в PostgreSQL | Без отдельного брокера в MVP; на тестовом стенде Vercel — синхронно (ADR-009) |
| Unit/integration тесты | Vitest; интеграционные — на реальном PostgreSQL (локальный кластер / сервис CI) | |
| E2E | Playwright (+ axe-core) | NFR-A11Y-001 |
| Архитектурные проверки | dependency-cruiser | NFR-MAINT-001 |
| Логи | pino (JSON) | NFR-OBS-001 |
| Контейнеризация | Docker, docker-compose для dev | |

## Рассмотренные альтернативы
| Вариант | Почему отклонен |
|---|---|
| Prisma | Первоначальный выбор M0. Заменен в T-031 (см. ниже) |
| TypeORM / MikroORM | Active Record/Unit of Work конфликтуют с явными доменными репозиториями (ADR-004) |
| Отдельный брокер (Redis/RabbitMQ) | Лишняя инфраструктура для MVP |

## Изменение 2026-10-08 (T-031): Prisma → Kysely

Причины:
1. Ключевые гарантии реализуются средствами SQL: триггеры неизменяемости версий (ADR-002), запрет UPDATE/DELETE журнала аудита (NFR-AUDIT-003), ограничения `ON DELETE RESTRICT`. SQL-first миграции выражают их напрямую, без обходов генератора схемы.
2. Governed-ресурсы читаются и пишутся только через доменные репозитории с условием scope (ADR-003) — сгенерированный ORM-клиент не дает выигрыша, а Kysely дает типобезопасный построитель запросов.
3. Serverless (ADR-009): нет движков-бинарников и шага генерации клиента; работа через pooled-подключение Neon стандартным драйвером `pg`.
4. `@adminjs/prisma` не нужен: все ресурсы идут через `DomainResource`.

Последствия: типы таблиц описываются вручную (`src/infrastructure/db/schema.ts`), миграции — `src/infrastructure/db/migrations/*.ts`.

## Последствия
Точные версии фиксируются в `package.json` в задаче настройки проекта (первая задача M1).

## Верификация
Review в T-030; CI проверяет lint, typecheck, тесты, dependency rules.
