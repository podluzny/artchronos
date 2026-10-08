import type { IncomingMessage, ServerResponse } from 'node:http'
import { createDb } from '../infrastructure/db/kysely.js'
import { createApp } from './app.js'
import { configFromEnv } from './config.js'

/**
 * Точка входа serverless-функции Vercel (ADR-009). Приложение создается лениво и переиспользуется
 * между вызовами «теплого» экземпляра. Миграции и seed выполняются на этапе сборки (scripts/vercel-build.ts).
 */
let appPromise: Promise<(req: IncomingMessage, res: ServerResponse) => void> | null = null

async function init() {
  process.env.ADMIN_JS_SKIP_BUNDLE = 'true'
  const config = configFromEnv()
  const db = createDb(config.databaseUrl, { max: 3 })
  const { app } = await createApp(db, { ...config, adminAssetsCdn: config.adminAssetsCdn ?? 'auto' })
  return app as unknown as (req: IncomingMessage, res: ServerResponse) => void
}

export async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    appPromise ??= init()
    const app = await appPromise
    app(req, res)
  } catch (e) {
    appPromise = null
    console.error('ArtChronos init failed', e)
    res.statusCode = 500
    res.setHeader('content-type', 'text/plain; charset=utf-8')
    res.end('Сервис не инициализирован: проверьте переменные окружения (DATABASE_URL, SESSION_SECRET) и логи.')
  }
}

export default handler
