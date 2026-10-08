import request from 'supertest'
import type { Db } from '../../src/infrastructure/db/kysely.js'
import { createApp } from '../../src/server/app.js'
import type { AppConfig } from '../../src/server/config.js'
import { testDbUrl } from './db.js'

export const ORIGIN = 'http://test.local'

export async function buildTestApp(db: Db, overrides: Partial<AppConfig> = {}) {
  process.env.ADMIN_JS_SKIP_BUNDLE = 'true'
  const config: AppConfig = {
    databaseUrl: testDbUrl(),
    sessionSecret: 'test-session-secret-0123456789abcdef-xyz',
    production: false,
    idleTimeoutMs: 30 * 60_000,
    absoluteTimeoutMs: 12 * 3600_000,
    publicOrigin: ORIGIN,
    ...overrides,
  }
  return createApp(db, config)
}

/** Агент с куками, вошедший под пользователем. */
export async function loginAgent(app: Parameters<typeof request.agent>[0], email: string, password: string) {
  const agent = request.agent(app)
  const res = await agent.post('/admin/login').set('Origin', ORIGIN).type('form').send({ email, password })
  if (res.status !== 302) throw new Error(`login failed: ${res.status}`)
  return agent
}

/** Вызов API AdminJS напрямую (как это сделал бы злоумышленник в обход UI). */
export function api(agent: ReturnType<typeof request.agent>) {
  return {
    list: (resource: string, query = '') => agent.get(`/admin/api/resources/${resource}/actions/list${query}`),
    show: (resource: string, id: string) => agent.get(`/admin/api/resources/${resource}/records/${id}/show`),
    recordAction: (resource: string, id: string, action: string, data: Record<string, unknown> = {}) =>
      agent.post(`/admin/api/resources/${resource}/records/${id}/${action}`).set('Origin', ORIGIN).send(data),
    resourceAction: (resource: string, action: string, data: Record<string, unknown> = {}) =>
      agent.post(`/admin/api/resources/${resource}/actions/${action}`).set('Origin', ORIGIN).send(data),
  }
}
