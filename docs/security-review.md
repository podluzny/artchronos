# Security Review (T-081)

| Поле | Значение |
|---|---|
| Задача | T-079, T-081 (M6) |
| Дата | 2026-10-09 |
| Область | Приложение ArtChronos (AdminJS + Express + PostgreSQL), тестовый стенд Vercel + Neon |
| Итог | Блокирующих находок нет; исправленные и принятые риски — ниже |

## 1. Проверенные меры и где они подтверждены

| Требование | Мера | Подтверждение |
|---|---|---|
| NFR-SEC-001 / -010 | Авторизация в каждом use case (permission + scope + правила); UI лишь скрывает действия | матрицы прав `tests/acceptance/permission-matrix*.test.ts` (§4.1–4.6); `security.test.ts` — mass assignment (owner, authorIds, state), подмена id чужих разделов, позиций, замечаний, тестов, вызов операций конструктора чужого теста через HTTP, смена собственных ролей |
| NFR-SEC-002 / -003 / -005 | argon2id, политика паролей; cookie HttpOnly, SameSite=Lax, Secure вне dev, регенерация id; блокировка после 5 неудач | AT-AUTH-001.*, AT-AUTH-002.*, AT-AUTH-004.* |
| NFR-SEC-004 | CSRF: изменяющие запросы только с собственного Origin/Referer | AT-AUTH-002.*, `m1-http.test.ts` |
| NFR-SEC-006 | Тип файла по сигнатуре (не по расширению), лимиты, удаление EXIF/GPS, SVG не принимается, файлы только через авторизованный endpoint, `Cache-Control: private` | AT-MEDIA-001.1–001.7, `security.test.ts` (SVG) |
| NFR-SEC-007 | Rich text — allow-list тегов без атрибутов при сохранении **и при выводе** (предпросмотр, прохождение); остатки разметки экранируются; CSP | `security.test.ts` (10 XSS-полезных нагрузок), заголовки |
| NFR-SEC-008 | `answerKey` не входит в списки, карточки записей и delivery-представление; доступен только в редакторе и предпросмотре авторам/экспертам | `security.test.ts`, AT-DELIV-001.4 |
| NFR-SEC-009 | Секреты только в окружении; сканер `tools/check_secrets.py` в CI | `security.test.ts`, шаг CI «Secret scanning» |
| NFR-SEC-011 | `npm audit --omit=dev --audit-level=high` в CI | шаг CI «Dependency audit» |
| NFR-OBS-004 | Отказы авторизации журналируются (use case и HTTP-уровень AdminJS), пользователю — без деталей | `observability.test.ts` |

## 2. Находки и решения

| # | Находка | Риск | Решение |
|---|---|---|---|
| S-1 | TinyMCE 6.8.6 (транзитивно из `@adminjs/design-system`) — несколько XSS (high) | high | `overrides.tinymce = 7.9.3` в package.json; rich-text редактор AdminJS в проекте не используется; E2E и a11y-проверки проходят |
| S-2 | Не было Content-Security-Policy | medium | CSP для приложения: `default-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`, внешние скрипты запрещены; плюс Permissions-Policy, HSTS в production |
| S-3 | CSP требует `script-src 'unsafe-inline'`: шаблоны страниц AdminJS содержат встроенные скрипты без nonce | low (остаточный) | Компенсирующие меры: санитизация при сохранении и выводе, отсутствие пользовательского HTML вне формулировок; при обновлении AdminJS с поддержкой nonce — убрать `'unsafe-inline'` |
| S-4 | Формулировки выводились через `dangerouslySetInnerHTML` без повторной санитизации | medium | Санитайзер вынесен в домен (`domain/shared/rich-text.ts`) и применяется при выдаче предпросмотра и в delivery-представлении |
| S-5 | Незакрытый тег (`<img src=x onerror=…` без `>`) проходил санитайзер как текст | low | Остатки `<`, не открывающие разрешенный тег, экранируются (`&lt;`) |
| S-6 | Отказ доступа к действию AdminJS (до use case) возвращается как 200 + ForbiddenError и не журналировался | low | Перехват ответа API: событие `authz.denied` (source=http) и метрика |
| S-7 | Остаются 4 advisory уровня moderate в зависимостях AdminJS 7 (uuid, react-router SSR) | low | Неэксплуатируемы в нашем использовании (нет SSR, uuid без буфера); исправление требует смены мажорной версии AdminJS — отслеживается CI-аудитом уровня high |
| S-8 | Гонки при одновременных решениях/публикации давали 500 из-за нарушений ограничений БД | medium (целостность сохранялась) | Условные переходы состояний (`WHERE state = …`) и перевод нарушений уникальности/триггеров в CONFLICT/INVALID_STATE (`concurrency.test.ts`) |

## 3. Принятые ограничения тестового стенда
* Медиа хранятся в БД (драйвер `db`, ADR-009); для production — S3 с приватной корзиной и подписанными ссылками (ADR-007).
* Метрики in-memory на инстанс функции Vercel; для production — внешний сборщик (логи уже структурированы в JSON).
* Символ `<` в формулировке сохраняется экранированным (`&lt;`); в редакторе он виден как сущность — допустимо для MVP.
