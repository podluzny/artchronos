import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Actor } from '../../src/domain/authorization/actor.js'
import type { Db } from '../../src/infrastructure/db/kysely.js'
import { log, sanitize, setLogSink } from '../../src/infrastructure/observability/logger.js'
import { resetMetrics } from '../../src/infrastructure/observability/metrics.js'
import type { Services } from '../../src/server/container.js'
import { freshDb } from '../support/db.js'
import { makeUser, PASSWORD, setupServices } from '../support/fixtures.js'
import { api, buildTestApp, loginAgent, ORIGIN } from '../support/http.js'

let db: Db
let services: Services
let admin: Actor
let app: Awaited<ReturnType<typeof buildTestApp>>['app']
const lines: Record<string, any>[] = []
let restore: ReturnType<typeof setLogSink>

beforeAll(async () => {
  db = await freshDb()
  ;({ services, admin } = await setupServices(db))
  ;({ app } = await buildTestApp(db))
  process.env.LOG_LEVEL = 'info'
  restore = setLogSink((l) => lines.push(JSON.parse(l)))
  resetMetrics()
})
afterAll(async () => {
  setLogSink(restore)
  process.env.LOG_LEVEL = 'silent'
  await db.destroy()
})

describe('NFR-OBS наблюдаемость', () => {
  it('NFR-OBS-001 логи — JSON с requestId и userId, без секретов и персональных данных', async () => {
    const agent = await loginAgent(app, 'root@test.local', PASSWORD)
    lines.length = 0
    const res = await agent.get('/admin/api/resources/User/actions/list').set('X-Request-Id', 'req-obs-1')
    expect(res.headers['x-request-id']).toBe('req-obs-1')
    const entry = lines.find((l) => l.event === 'http.request' && l.requestId === 'req-obs-1')!
    expect(entry).toMatchObject({ level: 'info', method: 'GET', status: 200, userId: admin.userId })
    expect(typeof entry.ms).toBe('number')
    lines.length = 0
    log('info', 'probe', { password: 'Correct-Horse', token: 'abc', email: 'x@y.z', nested: { sessionId: 's', ok: 1 } })
    expect(lines[0]).toMatchObject({
      password: '[REDACTED]',
      token: '[REDACTED]',
      email: '[PII]',
      nested: { sessionId: '[REDACTED]', ok: 1 },
    })
    expect(JSON.stringify(sanitize({ authorization: 'Bearer x' }))).not.toMatch(/Bearer/)
  })

  it('NFR-OBS-002 health и readiness проверяют БД и хранилище', async () => {
    await request(app).get('/health').expect(200, { status: 'ok' })
    const r = await request(app).get('/health/ready').expect(200)
    expect(r.body).toEqual({ status: 'ready', checks: { db: 'ok', storage: 'ok' } })
  })

  it('NFR-OBS-004 отказы авторизации и неудачные входы журналируются без деталей для пользователя', async () => {
    const student = await makeUser(services, admin, ['STUDENT'])
    const agent = await loginAgent(app, student.email, PASSWORD)
    lines.length = 0
    const res = await api(agent).resourceAction('Subject', 'new', { code: 'X1', name: 'Попытка' })
    expect(JSON.stringify(res.body)).not.toMatch(/subject\.create|permission|scope/i)
    const denied = lines.filter((l) => l.event === 'authz.denied')
    expect(denied.length).toBeGreaterThan(0)
    expect(denied[0]!).toMatchObject({ level: 'warn', userId: student.id })
    expect(denied[0]!.useCase ?? denied[0]!.source).toBeTruthy()
    lines.length = 0
    await request(app)
      .post('/admin/login')
      .set('Origin', ORIGIN)
      .type('form')
      .send({ email: student.email, password: 'wrong-password-1' })
    expect(lines.some((l) => l.event === 'auth.login_failed')).toBe(true)
    expect(JSON.stringify(lines)).not.toContain(student.email)
  })

  it('NFR-OBS-003 метрики доступны администратору: время ответа, ошибки, отказы, неудачные входы, очередь превью', async () => {
    const agent = await loginAgent(app, 'root@test.local', PASSWORD)
    const m = await agent.get('/admin/metrics').expect(200)
    expect(m.body.counters['authz.denied']).toBeGreaterThan(0)
    expect(m.body.counters['auth.login_failed']).toBeGreaterThan(0)
    expect(m.body.counters['http.status.2xx']).toBeGreaterThan(0)
    expect(m.body.latencyMs['http.admin_api'].count).toBeGreaterThan(0)
    expect(m.body).toHaveProperty('previews')
    const student = await makeUser(services, admin, ['STUDENT'])
    const sa = await loginAgent(app, student.email, PASSWORD)
    await sa.get('/admin/metrics').expect(404)
    await request(app)
      .get('/admin/metrics')
      .expect((r) => expect([302, 401]).toContain(r.status))
  })
})
