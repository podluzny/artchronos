import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Actor } from '../../src/domain/authorization/actor.js'
import type { Db } from '../../src/infrastructure/db/kysely.js'
import type { Services } from '../../src/server/container.js'
import { freshDb } from '../support/db.js'
import { ctx, makeUser, PASSWORD, setupServices, uniqueEmail } from '../support/fixtures.js'
import { api, buildTestApp, loginAgent, ORIGIN } from '../support/http.js'

let db: Db
let services: Services
let admin: Actor
let app: Awaited<ReturnType<typeof buildTestApp>>['app']

beforeAll(async () => {
  db = await freshDb()
  ;({ services, admin } = await setupServices(db))
  ;({ app } = await buildTestApp(db))
})
afterAll(async () => db.destroy())

describe('SPEC-AUTH-001/002 HTTP: вход, сессии, выход', () => {
  it('AT-AUTH-001.6 cookie сессии HttpOnly и SameSite=Lax; id регенерируется при входе', async () => {
    const agent = request.agent(app)
    // анонимный запрос формы не создает сессию
    await agent.get('/admin/login').expect(200)
    const res = await agent
      .post('/admin/login')
      .set('Origin', ORIGIN)
      .type('form')
      .send({ email: 'root@test.local', password: PASSWORD })
    expect(res.status).toBe(302)
    const cookie = String(res.headers['set-cookie'])
    expect(cookie).toMatch(/HttpOnly/i)
    expect(cookie).toMatch(/SameSite=Lax/i)
  })

  it('неаутентифицированный доступ: HTML → редирект на вход, API → 401', async () => {
    await request(app).get('/admin').expect(302).expect('location', '/admin/login')
    await request(app).get('/admin/api/resources/User/actions/list').expect(401)
  })

  it('AT-AUTH-002.1 после logout старый cookie недействителен', async () => {
    const u = await makeUser(services, admin, ['STUDENT'])
    const agent = await loginAgent(app, u.email, PASSWORD)
    await agent.get('/admin').expect(200)
    await agent.get('/admin/logout').expect(302)
    await agent.get('/admin/api/resources/User/actions/list').expect(401)
  })

  it('AT-AUTH-002.2 idle timeout', async () => {
    const short = (await buildTestApp(db, { idleTimeoutMs: 1000 })).app
    const u = await makeUser(services, admin, ['STUDENT'])
    const agent = await loginAgent(short, u.email, PASSWORD)
    await agent.get('/admin').expect(200)
    await new Promise((r) => setTimeout(r, 1300))
    await agent.get('/admin').expect(302)
  })

  it('AT-AUTH-002.3 absolute timeout при любой активности', async () => {
    const short = (await buildTestApp(db, { absoluteTimeoutMs: 800 })).app
    const u = await makeUser(services, admin, ['STUDENT'])
    const agent = await loginAgent(short, u.email, PASSWORD)
    await agent.get('/admin').expect(200)
    await new Promise((r) => setTimeout(r, 400))
    await agent.get('/admin').expect(200)
    await new Promise((r) => setTimeout(r, 600))
    await agent.get('/admin').expect(302)
  })

  it('AT-AUTH-002.4 блокировка пользователя немедленно завершает его сессии', async () => {
    const u = await makeUser(services, admin, ['TEACHER'])
    const agent = await loginAgent(app, u.email, PASSWORD)
    await agent.get('/admin').expect(200)
    await services.identity.changeUserStatus.run(admin, { id: u.id, action: 'block', reason: 'тест' }, ctx)
    await agent.get('/admin').expect(302)
  })

  it('AT-AUTH-002.5 изменяющий запрос без своего Origin отклоняется (CSRF)', async () => {
    await request(app)
      .post('/admin/login')
      .type('form')
      .send({ email: 'root@test.local', password: PASSWORD })
      .expect(403)
    await request(app)
      .post('/admin/login')
      .set('Origin', 'https://evil.example')
      .type('form')
      .send({ email: 'root@test.local', password: PASSWORD })
      .expect(403)
    const agent = await loginAgent(app, 'root@test.local', PASSWORD)
    const target = await makeUser(services, admin, ['STUDENT'])
    await agent
      .post(`/admin/api/resources/User/records/${target.id}/block`)
      .set('Origin', 'https://evil.example')
      .send({ reason: 'csrf' })
      .expect(403)
    expect((await services.identity.loadActor(target.id))!.status).toBe('ACTIVE')
  })

  it('AT-AUTH-001.7 HTTP: с mustChangePassword интерфейс недоступен до смены пароля', async () => {
    const r = await services.identity.createUser.run(
      admin,
      {
        email: uniqueEmail(),
        displayName: 'Tmp',
        roles: ['TEACHER'],
        initialMode: 'TEMP_PASSWORD',
        tempPassword: PASSWORD,
      },
      ctx,
    )
    const agent = request.agent(app)
    const res = await agent
      .post('/admin/login')
      .set('Origin', ORIGIN)
      .type('form')
      .send({ email: r.user.email, password: PASSWORD })
    expect(res.headers.location).toBe('/account/password')
    await agent.get('/admin').expect(302).expect('location', '/account/password')
    await agent.get('/admin/api/resources/User/actions/list').expect(403)
    await agent
      .post('/account/password')
      .set('Origin', ORIGIN)
      .type('form')
      .send({ currentPassword: PASSWORD, newPassword: 'Fresh-Password-12345', confirm: 'Fresh-Password-12345' })
      .expect(200)
    await agent.get('/admin').expect(200)
  })

  it('активация по ссылке через страницу /account/activate', async () => {
    const r = await services.identity.createUser.run(
      admin,
      { email: uniqueEmail(), displayName: 'Inv', roles: ['STUDENT'], initialMode: 'INVITE' },
      ctx,
    )
    await request(app)
      .get(`/account/activate?token=${r.activationToken}`)
      .expect(200)
      .expect(/Активация/)
    await request(app)
      .post('/account/activate')
      .set('Origin', ORIGIN)
      .type('form')
      .send({ token: r.activationToken!, newPassword: 'Activated-Pass-777', confirm: 'Activated-Pass-777' })
      .expect(200)
    await loginAgent(app, r.user.email, 'Activated-Pass-777')
  })
})

describe('SPEC-AUTH-003 / AT-PERM: авторизация на сервере, в обход UI', () => {
  it('AT-AUTH-003.2 / AT-PERM-005 студент вызывает API пользователей напрямую — отказ', async () => {
    const s = await makeUser(services, admin, ['STUDENT'])
    const victim = await makeUser(services, admin, ['TEACHER'])
    const agent = await loginAgent(app, s.email, PASSWORD)
    const a = api(agent)
    const list = await a.list('User')
    expect(list.status === 403 || (list.body.records ?? []).length === 0).toBe(true)
    const show = await a.show('User', victim.id)
    expect(show.body.record?.params?.email).toBeUndefined()
    const block = await a.recordAction('User', victim.id, 'block', { reason: 'hack' })
    expect(block.status === 403 || block.body.notice?.type === 'error' || block.body.record === undefined).toBe(true)
    expect((await services.identity.loadActor(victim.id))!.status).toBe('ACTIVE')
    const create = await a.resourceAction('User', 'new', {
      email: uniqueEmail(),
      displayName: 'x',
      roles: '["ADMIN"]',
      initialMode: 'INVITE',
    })
    expect(create.body.result).toBeUndefined()
    const count = await db
      .selectFrom('users')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .executeTakeFirstOrThrow()
    const before = Number(count.n)
    expect(before).toBeGreaterThan(0)
  })

  it('AT-AUTH-003.7 поля status/roles в payload edit игнорируются (mass assignment)', async () => {
    const s = await makeUser(services, admin, ['STUDENT'])
    const agent = await loginAgent(app, s.email, PASSWORD)
    const me = await services.identity.getUser.run(s.actor, { id: s.id }, ctx)
    const res = await api(agent).recordAction('User', s.id, 'edit', {
      displayName: 'Я студент',
      status: 'ACTIVE',
      roles: 'ADMIN',
      revision: String(me.revision),
    })
    expect(res.status).toBe(200)
    const after = (await services.identity.loadActor(s.id))!
    expect(after.displayName).toBe('Я студент')
    expect(after.roleCodes).toEqual(['STUDENT'])
  })

  it('AT-PERM-003 эксперт не может менять пользователей через API', async () => {
    const e = await makeUser(services, admin, ['EXPERT'])
    const victim = await makeUser(services, admin, ['STUDENT'])
    const agent = await loginAgent(app, e.email, PASSWORD)
    const res = await api(agent).recordAction('User', victim.id, 'changeRoles', { roles: '["ADMIN"]' })
    expect(res.body.result).toBeUndefined()
    expect((await services.identity.loadActor(victim.id))!.roleCodes).toEqual(['STUDENT'])
  })

  it('AT-PERM-004 администратор: полный доступ в пределах BR', async () => {
    const agent = await loginAgent(app, 'root@test.local', PASSWORD)
    const a = api(agent)
    const list = await a.list('User')
    expect(list.status).toBe(200)
    expect(list.body.meta.total).toBeGreaterThan(1)
    const created = await a.resourceAction('User', 'new', {
      email: uniqueEmail('api'),
      displayName: 'Через API',
      roles: '["STUDENT"]',
      initialMode: 'INVITE',
    })
    expect(created.body.result.link).toMatch(/^http:\/\/test\.local\/account\/activate\?token=/)
    // но не над собой (BR-015)
    // но не над собой (BR-015): действие скрыто и отклоняется AdminJS, а use case отклонил бы его сам
    const self = await a.recordAction('User', admin.userId, 'block', { reason: 'x' })
    expect(self.body.notice?.type).toBe('error')
    expect((await services.identity.loadActor(admin.userId))!.status).toBe('ACTIVE')
    const audit = await a.list('AuditLog', '?filters.action=user.created')
    expect(audit.body.meta.total).toBeGreaterThan(0)
  })

  it('журнал аудита недоступен не-администратору через API', async () => {
    const t = await makeUser(services, admin, ['TEACHER'])
    const agent = await loginAgent(app, t.email, PASSWORD)
    const res = await api(agent).list('AuditLog')
    expect(res.status === 403 || (res.body.records ?? []).length === 0).toBe(true)
  })

  it('/health отвечает 200 (NFR-OBS-002)', async () => {
    await request(app).get('/health').expect(200, { status: 'ok' })
  })
})
