import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Db } from '../../src/infrastructure/db/kysely.js'
import { freshDb } from '../support/db.js'
import { makeUser, PASSWORD, setupServices } from '../support/fixtures.js'
import { buildTestApp, loginAgent } from '../support/http.js'

let db: Db
let app: Awaited<ReturnType<typeof buildTestApp>>['app']
let teacherEmail: string

beforeAll(async () => {
  db = await freshDb()
  const { services, admin } = await setupServices(db)
  teacherEmail = (await makeUser(services, admin, ['TEACHER'])).email
  ;({ app } = await buildTestApp(db))
})
afterAll(async () => db.destroy())

describe('Справочник пользователя /guide/', () => {
  it('открывается по прямой ссылке без входа; общие страницы доступны', async () => {
    expect((await request(app).get('/guide')).headers.location).toBe('/guide/')
    const index = await request(app).get('/guide/')
    expect(index.status).toBe(200)
    expect(index.text).toContain('ArtChronos — Справочник')
    for (const page of ['home.md', 'basics.md', 'materials.md', 'education.md'])
      expect((await request(app).get(`/guide/${page}`)).status).toBe(200)
  })

  it('без входа и не-администратору раздел «Администрирование» закрыт и не виден в меню', async () => {
    const anon = await request(app).get('/guide/sidebar.md')
    expect(anon.text).toContain('Материалы')
    expect(anon.text).not.toContain('admin/')
    expect((await request(app).get('/guide/admin/users.md')).status).toBe(403)
    expect((await request(app).get('/guide/_sidebar.md')).status).toBe(302)
    const teacher = await loginAgent(app, teacherEmail, PASSWORD)
    expect((await teacher.get('/guide/sidebar.md')).text).not.toContain('admin/')
    const denied = await teacher.get('/guide/admin/roles.md')
    expect(denied.status).toBe(403)
    expect(denied.text).not.toContain('Каталог прав')
  })

  it('администратору раздел «Администрирование» доступен', async () => {
    const admin = await loginAgent(app, 'root@test.local', PASSWORD)
    const sidebar = await admin.get('/guide/sidebar.md')
    expect(sidebar.text).toContain('(/admin/users.md)')
    expect(sidebar.text).not.toContain('admin:start')
    const roles = await admin.get('/guide/admin/roles.md')
    expect(roles.status).toBe(200)
    expect(roles.text).toContain('Каталог прав')
    expect(roles.headers['cache-control']).toBe('no-store')
  })
})
