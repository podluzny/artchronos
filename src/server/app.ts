import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express, { type NextFunction, type Request, type Response } from 'express'
import session from 'express-session'
import AdminJSExpress from '@adminjs/express'
import { sql } from 'kysely'
import { isDomainError } from '../domain/shared/errors.js'
import type { RequestContext } from '../application/shared/context.js'
import { ADMIN_ROOT, buildAdmin } from '../adminjs/admin.js'
import { requestStore } from '../adminjs/context.js'
import type { Db } from '../infrastructure/db/kysely.js'
import type { AppConfig } from './config.js'
import { createServices } from './container.js'
import { passwordForm, page } from './pages.js'
import { PgSessionStore } from './session-store.js'

declare module 'express-session' {
  interface SessionData {
    adminUser?: { id: string; email: string; title: string }
    createdAt?: number
    meta?: { ip: string | null; userAgent: string | null }
  }
}

const COOKIE_NAME = 'artchronos.sid'

export async function createApp(db: Db, config: AppConfig) {
  const services = createServices(db)
  // AC-QTYPE-002.3: отсутствующий плагин для существующего типа — ошибка старта
  await services.qtypes.verifyRegistry()
  const autoAssets = config.adminAssetsCdn === 'auto'
  const admin = buildAdmin(services, config.adminAssetsCdn && !autoAssets ? { assetsCDN: config.adminAssetsCdn } : {})
  // Сборка фронтенда AdminJS: локально — при старте; на Vercel и в тестах — заранее/не нужна (ADR-009).
  if (process.env.ADMIN_JS_SKIP_BUNDLE !== 'true') await admin.initialize()

  const app = express()
  app.disable('x-powered-by')
  if (config.production) app.set('trust proxy', 1)

  // Заголовки безопасности (NFR-SEC-006/007).
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('Referrer-Policy', 'same-origin')
    next()
  })

  app.get('/health', async (_req, res) => {
    try {
      await sql`select 1`.execute(db)
      res.json({ status: 'ok' })
    } catch {
      res.status(503).json({ status: 'db_unavailable' })
    }
  })

  // SDD-документация (ADR-009 п.4) — статика, собранная tools/build_site.sh.
  const here = path.dirname(fileURLToPath(import.meta.url))
  app.use('/sdd', express.static(path.resolve(here, '..', '..', 'public', 'sdd'), { fallthrough: true }))
  app.get('/', (_req, res) => res.redirect(ADMIN_ROOT))

  app.use(
    session({
      name: COOKIE_NAME,
      secret: config.sessionSecret,
      store: new PgSessionStore(db, config.idleTimeoutMs),
      resave: false,
      saveUninitialized: false,
      rolling: true,
      proxy: config.production,
      cookie: { httpOnly: true, sameSite: 'lax', secure: config.production, maxAge: config.idleTimeoutMs },
    }),
  )

  const originOf = (req: Request) => config.publicOrigin ?? `${req.protocol}://${req.get('host')}`

  // CSRF: изменяющие запросы принимаются только с собственного origin (NFR-SEC-004).
  app.use((req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next()
    const origin = req.get('origin') ?? (req.get('referer') ? new URL(req.get('referer')!).origin : null)
    if (!origin || origin !== originOf(req)) {
      res.status(403).send('Запрос отклонен (CSRF)')
      return
    }
    next()
  })

  const requestContext = (req: Request): RequestContext => ({
    requestId: (req.get('x-request-id') ?? randomUUID()).slice(0, 100),
    ip: req.ip ?? null,
    userAgent: req.get('user-agent') ?? null,
    sessionId: req.sessionID ?? null,
  })

  const loginPath = `${ADMIN_ROOT}/login`

  const establishSession = (req: Request, user: { id: string; email: string; displayName: string }) =>
    new Promise<void>((resolve, reject) => {
      // Регенерация id сессии при входе (NFR-SEC-003).
      req.session.regenerate((err) => {
        if (err) return reject(err)
        req.session.adminUser = { id: user.id, email: user.email, title: user.displayName }
        req.session.createdAt = Date.now()
        req.session.meta = { ip: req.ip ?? null, userAgent: req.get('user-agent') ?? null }
        req.session.save((e) => (e ? reject(e) : resolve()))
      })
    })

  const destroySession = (req: Request) => new Promise<void>((resolve) => req.session.destroy(() => resolve()))

  app.get(loginPath, async (req, res) => {
    if (autoAssets) admin.options.assetsCDN = `${originOf(req)}/admin-assets/`
    res.send(await admin.renderLogin({ action: loginPath, errorMessage: null }))
  })

  app.post(loginPath, express.urlencoded({ extended: false, limit: '10kb' }), async (req, res, next) => {
    try {
      const ctx = requestContext(req)
      const result = await requestStore.run({ actor: null, ctx, origin: originOf(req) }, () =>
        services.identity.authenticate.run(null, { email: req.body?.email, password: req.body?.password }, ctx),
      )
      const actor = await services.identity.loadActor(result.userId)
      await establishSession(req, { id: result.userId, email: actor!.email, displayName: actor!.displayName })
      res.redirect(result.mustChangePassword ? '/account/password' : ADMIN_ROOT)
    } catch (e) {
      if (isDomainError(e) && e.code === 'UNAUTHENTICATED') {
        res.status(401).send(await admin.renderLogin({ action: loginPath, errorMessage: 'invalidCredentials' }))
        return
      }
      next(e)
    }
  })

  const logout = async (req: Request, res: Response) => {
    const userId = req.session?.adminUser?.id
    if (userId) {
      const actor = await services.identity.loadActor(userId)
      if (actor) await services.identity.logout.run(actor, undefined, requestContext(req)).catch(() => undefined)
    }
    await destroySession(req)
    res.clearCookie(COOKIE_NAME)
    res.redirect(loginPath)
  }
  app.get(`${ADMIN_ROOT}/logout`, logout)
  app.post(`${ADMIN_ROOT}/logout`, logout)

  /** Загружает actor из сессии и проверяет тайм-ауты/статус (SPEC-AUTH-002). */
  const authenticate = async (req: Request) => {
    const s = req.session
    if (!s?.adminUser) return null
    if (!s.createdAt || Date.now() - s.createdAt > config.absoluteTimeoutMs) {
      await destroySession(req)
      return null
    }
    const actor = await services.identity.loadActor(s.adminUser.id)
    if (!actor || actor.status !== 'ACTIVE') {
      await destroySession(req)
      return null
    }
    return actor
  }

  const wantsJson = (req: Request) =>
    req.path.startsWith('/api/') || (req.get('accept') ?? '').includes('application/json')

  // ---- Страницы аккаунта ----
  const account = express.Router()
  account.use(express.urlencoded({ extended: false, limit: '10kb' }))

  account.get('/password', async (req, res) => {
    const actor = await authenticate(req)
    if (!actor) return res.redirect(loginPath)
    res.send(
      passwordForm({
        title: 'Смена пароля',
        intro: actor.mustChangePassword
          ? 'Перед началом работы необходимо сменить пароль.'
          : `Учетная запись: ${actor.email}`,
        action: '/account/password',
        needCurrent: true,
      }),
    )
  })

  account.post('/password', async (req, res, next) => {
    try {
      const actor = await authenticate(req)
      if (!actor) return res.redirect(loginPath)
      const render = (errors: string[]) =>
        res.status(422).send(
          passwordForm({
            title: 'Смена пароля',
            intro: `Учетная запись: ${actor.email}`,
            action: '/account/password',
            needCurrent: true,
            errors,
          }),
        )
      if (req.body.newPassword !== req.body.confirm) return render(['Пароли не совпадают'])
      try {
        await services.identity.changeOwnPassword.run(
          actor,
          { currentPassword: req.body.currentPassword, newPassword: req.body.newPassword },
          requestContext(req),
        )
      } catch (e) {
        if (isDomainError(e)) return render(e.fieldErrors.length ? e.fieldErrors.map((f) => f.message) : [e.message])
        throw e
      }
      res.send(
        page(
          'Пароль изменен',
          `<h1>Пароль изменен</h1><p class="ok">Остальные сессии завершены.</p><p><a href="${ADMIN_ROOT}">Перейти в систему</a></p>`,
        ),
      )
    } catch (e) {
      next(e)
    }
  })

  for (const [route, title, intro] of [
    ['/activate', 'Активация учетной записи', 'Задайте пароль для входа в ArtChronos.'],
    ['/reset', 'Новый пароль', 'Задайте новый пароль для входа в ArtChronos.'],
  ] as const) {
    account.get(route, (req, res) => {
      const token = String(req.query.token ?? '')
      // Referrer-Policy: same-origin (глобально) — токен не уходит на сторонние сайты; no-referrer дал бы Origin: null
      res.send(passwordForm({ title, intro, action: `/account${route}`, needCurrent: false, token }))
    })
    account.post(route, async (req, res, next) => {
      try {
        const token = String(req.body.token ?? '')
        const render = (errors: string[]) =>
          res
            .status(422)
            .send(passwordForm({ title, intro, action: `/account${route}`, needCurrent: false, token, errors }))
        if (req.body.newPassword !== req.body.confirm) return render(['Пароли не совпадают'])
        try {
          await services.identity.setPasswordWithToken.run(
            null,
            { token, newPassword: req.body.newPassword },
            requestContext(req),
          )
        } catch (e) {
          if (isDomainError(e)) return render(e.fieldErrors.length ? e.fieldErrors.map((f) => f.message) : [e.message])
          throw e
        }
        res.send(
          page(
            'Готово',
            `<h1>Пароль сохранен</h1><p class="ok">Теперь можно войти.</p><p><a href="${loginPath}">Войти</a></p>`,
          ),
        )
      } catch (e) {
        next(e)
      }
    })
  }
  app.use('/account', account)

  // ---- AdminJS: доступ только после проверки сессии и actor ----
  app.use(ADMIN_ROOT, async (req, res, next) => {
    // 'auto': заранее собранные ассеты AdminJS раздаются статикой того же хоста (/admin-assets/, ADR-009).
    if (autoAssets) admin.options.assetsCDN = `${originOf(req)}/admin-assets/`
    try {
      // Статика фронтенда AdminJS не требует данных пользователя.
      if (req.path.startsWith('/frontend/assets/')) return next()
      const actor = await authenticate(req)
      if (!actor) {
        if (wantsJson(req)) return res.status(401).json({ message: 'Требуется вход' })
        return res.redirect(loginPath)
      }
      if (actor.mustChangePassword) {
        if (wantsJson(req)) return res.status(403).json({ message: 'Необходимо сменить пароль' })
        return res.redirect('/account/password')
      }
      requestStore.run({ actor, ctx: requestContext(req), origin: originOf(req) }, () => next())
    } catch (e) {
      next(e)
    }
  })
  // Файлы медиа: только через авторизованный endpoint (NFR-SEC-006, ADR-007 п.4).
  app.get(`${ADMIN_ROOT}/media-file/:id/:variant?`, async (req, res, next) => {
    try {
      const actor = requestStore.getStore()?.actor
      if (!actor) return res.status(401).end()
      const f = await services.media.readMediaFile.run(
        actor,
        { id: req.params.id!, variant: req.params.variant ?? 'original' },
        requestContext(req),
      )
      res.setHeader('Content-Type', f.mime)
      res.setHeader('Cache-Control', 'private, max-age=3600')
      res.setHeader('Content-Disposition', 'inline')
      res.send(f.data)
    } catch (e) {
      if (isDomainError(e) && (e.code === 'NOT_FOUND' || e.code === 'FORBIDDEN')) return res.status(404).end()
      next(e)
    }
  })
  app.use(ADMIN_ROOT, AdminJSExpress.buildRouter(admin))

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err)
    if (isDomainError(err)) {
      res.status(err.httpStatus).json({ message: err.message, ruleId: err.ruleId })
      return
    }
    res.status(500).send('Внутренняя ошибка сервера')
  })

  return { app, services, admin }
}
