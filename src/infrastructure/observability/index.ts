import { randomUUID } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import { setUseCaseObserver } from '../../application/shared/use-case.js'
import { log } from './logger.js'
import { inc, observe } from './metrics.js'

export { log, setLogSink } from './logger.js'
export { inc, observe, resetMetrics, snapshot } from './metrics.js'

/**
 * Наблюдатель use cases: метрики по каждому use case; отказы авторизации и неудачные входы
 * журналируются без деталей для пользователя (NFR-OBS-003, NFR-OBS-004).
 */
/** requestId, по которым отказ уже зафиксирован на уровне use case (чтобы не дублировать HTTP-уровнем). */
const deniedRequests = new Set<string>()

export function installUseCaseObserver(): void {
  setUseCaseObserver((e) => {
    observe(`usecase.${e.name}`, e.ms)
    inc(`usecase.${e.outcome}`)
    if (e.outcome === 'ok') return
    inc(`usecase.error.${e.code}`)
    if (e.name === 'identity.authenticate' && e.code === 'UNAUTHENTICATED') {
      inc('auth.login_failed')
      log('warn', 'auth.login_failed', { requestId: e.requestId })
    } else if (e.code === 'FORBIDDEN') {
      inc('authz.denied')
      if (e.requestId) deniedRequests.add(e.requestId)
      log('warn', 'authz.denied', { useCase: e.name, userId: e.userId, requestId: e.requestId, ruleId: e.ruleId })
    } else if (e.code === 'NOT_FOUND') {
      inc('authz.not_found')
    } else if (e.code === 'INTERNAL') {
      log('error', 'usecase.failed', { useCase: e.name, userId: e.userId, requestId: e.requestId })
    }
  })
}

/** HTTP: requestId (заголовок X-Request-Id), журнал запросов и метрики времени ответа. */
export function requestLogging(userIdOf: (req: Request) => string | null) {
  return (req: Request, res: Response, next: NextFunction) => {
    const started = process.hrtime.bigint()
    // путь фиксируется до маршрутизации: вложенные роутеры Express переписывают req.path
    const fullPath = req.originalUrl.split('?')[0] ?? '/'
    const incoming = req.get('x-request-id')
    const requestId = incoming && /^[\w.-]{1,100}$/.test(incoming) ? incoming : randomUUID()
    req.headers['x-request-id'] = requestId
    res.setHeader('X-Request-Id', requestId)
    let forbidden = false
    if (fullPath.startsWith('/admin/api/')) {
      // AdminJS отвечает на недоступное действие 200 + ForbiddenError в теле
      const json = res.json.bind(res)
      res.json = (body: any) => {
        if (body?.record?.baseError?.type === 'ForbiddenError' || body?.baseError?.type === 'ForbiddenError')
          forbidden = true
        return json(body)
      }
    }
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6
      const route = fullPath.startsWith('/admin/api/') ? 'admin_api' : fullPath.startsWith('/admin') ? 'admin' : 'other'
      observe(`http.${route}`, ms)
      inc(`http.status.${Math.floor(res.statusCode / 100)}xx`)
      // отказ в доступе к действию AdminJS (до вызова use case) — тоже отказ авторизации (NFR-OBS-004)
      if ((res.statusCode === 403 || forbidden) && !deniedRequests.delete(requestId)) {
        inc('authz.denied')
        log('warn', 'authz.denied', { source: 'http', userId: userIdOf(req), requestId, method: req.method })
      }
      deniedRequests.delete(requestId)
      if (fullPath.startsWith('/admin-assets') || fullPath.startsWith('/sdd')) return
      log(res.statusCode >= 500 ? 'error' : 'info', 'http.request', {
        requestId,
        userId: userIdOf(req),
        method: req.method,
        path: fullPath.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ':id'),
        status: res.statusCode,
        ms: Math.round(ms),
      })
    })
    next()
  }
}
