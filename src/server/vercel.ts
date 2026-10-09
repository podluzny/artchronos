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
    res.end(`Сервис не инициализирован: ${diagnose(e)}`)
  }
}

/** Причина сбоя запуска без раскрытия секретов: имена переменных и коды ошибок PostgreSQL, не их значения. */
export function diagnose(e: unknown, env = process.env): string {
  const msg = e instanceof Error ? e.message : String(e)
  const code = (e as { code?: string })?.code
  const vars = Object.keys(env)
    .filter((k) => /DATABASE|POSTGRES|PG(HOST|USER|DATABASE)/.test(k))
    .sort()
  if (/DATABASE_URL не задан/.test(msg))
    return `переменная DATABASE_URL не задана для этой среды (Production/Preview). Найдены переменные БД: ${vars.join(', ') || 'нет'}. Если интеграция Neon добавила их с префиксом, задайте DATABASE_URL явно.`
  if (/SESSION_SECRET/.test(msg))
    return `SESSION_SECRET не задан или короче 32 символов (сейчас: ${(env.SESSION_SECRET ?? '').length}). Задайте случайную строку длиной от 32 символов и сделайте Redeploy.`
  if (code === '42P01')
    return 'таблицы БД не найдены — миграции не применены. Проверьте в Build Logs строку «Применены миграции»; если там «DATABASE_URL не задан: миграции пропущены», добавьте DATABASE_URL в окружение сборки и сделайте Redeploy.'
  if (code === '28P01') return 'БД отклонила логин/пароль из DATABASE_URL (28P01).'
  if (code === '3D000') return 'база данных из DATABASE_URL не существует (3D000).'
  if (code && /^(08|57P0|53)/.test(code)) return `нет соединения с БД (${code}).`
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN/.test(msg)) return 'хост БД из DATABASE_URL недоступен.'
  if (/interaction-плагина/.test(msg)) return msg
  return `ошибка запуска${code ? ` (${code})` : ''}: ${msg.replace(/postgres(ql)?:\/\/\S+/gi, '[url]').slice(0, 300)}`
}

export default handler
