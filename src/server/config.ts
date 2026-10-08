export interface AppConfig {
  databaseUrl: string
  sessionSecret: string
  production: boolean
  /** URL статики AdminJS, собранной на этапе build (ADR-009); пусто — AdminJS собирает сам. */
  adminAssetsCdn?: string
  /** Тайм-ауты сессии (SPEC-AUTH-002). */
  idleTimeoutMs: number
  absoluteTimeoutMs: number
  /** Доверенный внешний origin (за прокси). Если не задан — берется из запроса. */
  publicOrigin?: string
}

export function configFromEnv(env = process.env): AppConfig {
  const databaseUrl = env.DATABASE_URL
  if (!databaseUrl) throw new Error('DATABASE_URL не задан')
  const production = env.NODE_ENV === 'production' || !!env.VERCEL
  const sessionSecret = env.SESSION_SECRET ?? (production ? '' : 'dev-only-session-secret-not-for-production-use')
  if (sessionSecret.length < 32) throw new Error('SESSION_SECRET должен быть не короче 32 символов')
  return {
    databaseUrl,
    sessionSecret,
    production,
    ...(env.ADMIN_ASSETS_CDN ? { adminAssetsCdn: env.ADMIN_ASSETS_CDN } : {}),
    ...(env.PUBLIC_ORIGIN ? { publicOrigin: env.PUBLIC_ORIGIN } : {}),
    idleTimeoutMs: Number(env.SESSION_IDLE_MINUTES ?? 30) * 60_000,
    absoluteTimeoutMs: Number(env.SESSION_ABSOLUTE_HOURS ?? 12) * 3600_000,
  }
}
