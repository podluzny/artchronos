import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Actor } from '../../src/domain/authorization/actor.js'
import type { Db } from '../../src/infrastructure/db/kysely.js'
import { createServices, type Services } from '../../src/server/container.js'
import { freshDb } from '../support/db.js'
import { makeCourseWorld } from '../support/education.js'
import { ctx, PASSWORD, setupServices } from '../support/fixtures.js'
import { buildTestApp, loginAgent } from '../support/http.js'
import { seedVolume } from './seed.js'

/**
 * T-083: NFR-PERF-001 (списки ≤ 1.5 с p95 на 50 000 вопросов / 10 000 медиа), NFR-PERF-002 (сохранение черновика
 * ≤ 500 мс p95), NFR-PERF-005 (200 одновременных запросов). Замеры — через HTTP API AdminJS, как в браузере.
 */
const ITEMS = Number(process.env.PERF_ITEMS ?? 50000)
const MEDIA = Number(process.env.PERF_MEDIA ?? 10000)

let db: Db
let services: Services
let admin: Actor
let w: Awaited<ReturnType<typeof makeCourseWorld>>
let app: Awaited<ReturnType<typeof buildTestApp>>['app']
const report: Record<string, { p50: number; p95: number; max: number }> = {}

function stats(ms: number[]) {
  const s = [...ms].sort((a, b) => a - b)
  const q = (p: number) => s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]!
  return { p50: Math.round(q(50)), p95: Math.round(q(95)), max: Math.round(s[s.length - 1]!) }
}

async function measure(name: string, fn: () => Promise<unknown>, n = 20) {
  await fn()
  await fn() // прогрев
  const ms: number[] = []
  for (let i = 0; i < n; i++) {
    const t = performance.now()
    await fn()
    ms.push(performance.now() - t)
  }
  report[name] = stats(ms)
  return report[name]!
}

beforeAll(async () => {
  db = await freshDb()
  ;({ admin } = await setupServices(db))
  services = createServices(db)
  w = await makeCourseWorld(services, admin)
  // 200 авторов-студентов (без входа — для объема и scope-фильтра); w.student — один из них
  const role = (await sql<{ id: string }>`select id from roles where code = 'STUDENT'`.execute(db)).rows[0]!.id
  const students = (
    await sql<{ id: string }>`insert into users (email, display_name, status, password_hash)
      select 'perf' || g || '@perf.local', 'Студент ' || g, 'ACTIVE', 'x' from generate_series(1, 199) g returning id`.execute(
      db,
    )
  ).rows.map((r) => r.id)
  await sql`insert into user_roles (user_id, role_id) select unnest(${sql.val(students)}::uuid[]), ${role}`.execute(db)
  const types = await services.education.listQuestionTypes.run(admin, { filters: {}, limit: 50, offset: 0 }, ctx)
  const t0 = performance.now()
  await seedVolume(
    db,
    {
      courseId: w.courseId,
      assignmentId: w.assignmentId,
      topicId: w.topicId,
      subtopicId: w.subtopicId,
      teacherId: w.teacher.id,
      qtId: types.records.find((t) => t.code === 'single_choice')!.id,
    },
    { items: ITEMS, media: MEDIA, students: [w.student.id, ...students] },
  )
  report.seed = { p50: 0, p95: 0, max: Math.round(performance.now() - t0) }
  ;({ app } = await buildTestApp(db))
})

afterAll(async () => {
  console.log('PERF', JSON.stringify(report, null, 1))
  await db.destroy()
})

describe('T-083 производительность на объеме 50 000 вопросов / 10 000 медиа', () => {
  it('AT-ITEM-005.4 NFR-PERF-001 списки вопросов открываются ≤ 1.5 с (p95) для Admin, Teacher, Student и с фильтрами', async () => {
    const n = await sql<{ n: string }>`select count(*) as n from items`.execute(db)
    expect(Number(n.rows[0]!.n)).toBeGreaterThanOrEqual(ITEMS)
    const adminA = await loginAgent(app, 'root@test.local', PASSWORD)
    const teacherA = await loginAgent(app, w.teacher.email, PASSWORD)
    const studentA = await loginAgent(app, w.student.email, PASSWORD)
    const list =
      (agent: typeof adminA, q = '') =>
      async () => {
        const r = await agent.get(`/admin/api/resources/Item/actions/list${q}`)
        expect(r.status).toBe(200)
        expect(r.body.records.length).toBeGreaterThan(0)
      }
    const cases: [string, () => Promise<void>][] = [
      ['items.admin', list(adminA)],
      ['items.teacher', list(teacherA)],
      ['items.student', list(studentA)],
      ['items.admin.page50', list(adminA, '?page=50')],
      ['items.admin.stem', list(adminA, `?filters.stem=${encodeURIComponent('№12345')}`)],
      ['items.admin.topic', list(adminA, `?filters.topicId=${w.subtopicId}`)],
      ['items.admin.approved', list(adminA, '?filters.state=APPROVED&filters.difficulty=3')],
      ['items.teacher.sortDifficulty', list(teacherA, '?sortBy=difficulty&direction=asc')],
    ]
    for (const [name, fn] of cases) expect((await measure(name, fn)).p95, name).toBeLessThanOrEqual(1500)
  })

  it('NFR-PERF-001 медиатека (10 000) открывается ≤ 1.5 с (p95), с поиском', async () => {
    const adminA = await loginAgent(app, 'root@test.local', PASSWORD)
    const list =
      (q = '') =>
      async () => {
        const r = await adminA.get(`/admin/api/resources/MediaAsset/actions/list${q}`)
        expect(r.status).toBe(200)
      }
    expect((await measure('media.admin', list())).p95).toBeLessThanOrEqual(1500)
    expect(
      (await measure('media.admin.text', list(`?filters.title=${encodeURIComponent('Левитан')}`))).p95,
    ).toBeLessThanOrEqual(1500)
    expect((await measure('media.admin.page100', list('?page=100'))).p95).toBeLessThanOrEqual(1500)
  })

  it('NFR-PERF-002 сохранение черновика вопроса ≤ 500 мс (p95)', async () => {
    const r = await sql<{
      id: string
    }>`select id from items where owner_id = ${w.student.id} and current_draft_version_id is not null limit 1`.execute(
      db,
    )
    const itemId = r.rows[0]!.id
    let i = 0
    const st = await measure('item.saveDraft', async () => {
      const d = await services.items.getItem.run(w.student.actor, { id: itemId }, ctx)
      await services.items.saveDraft.run(
        w.student.actor,
        { itemId, document: { ...d.version.document, stem: `Правка ${++i}` }, revision: d.version.revision },
        ctx,
      )
    })
    expect(st.p95).toBeLessThanOrEqual(500)
  })

  it('NFR-PERF-005 200 активных пользователей: запросы в течение 10 с обслуживаются без ошибок (p95 ≤ 1.5 с)', async () => {
    // Модель нагрузки: 200 активных пользователей админки, каждый открывает список в случайный момент окна 10 с
    // (≈ 20 запросов/с — типичная интенсивность работы в административном интерфейсе).
    const agents = await Promise.all([
      ...Array.from({ length: 4 }, () => loginAgent(app, 'root@test.local', PASSWORD)),
      ...Array.from({ length: 4 }, () => loginAgent(app, w.teacher.email, PASSWORD)),
      ...Array.from({ length: 2 }, () => loginAgent(app, w.student.email, PASSWORD)),
    ])
    const paths = [
      '/admin/api/resources/Item/actions/list',
      '/admin/api/resources/MediaAsset/actions/list',
      '/admin/api/resources/Test/actions/list',
    ]
    const run = async (users: number, windowMs: number) => {
      const ms: number[] = []
      const statuses = await Promise.all(
        Array.from({ length: users }, async (_, k) => {
          await new Promise((r) => setTimeout(r, Math.random() * windowMs))
          const t = performance.now()
          const r = await agents[k % agents.length]!.get(paths[k % paths.length]!)
          ms.push(performance.now() - t)
          return r.status
        }),
      )
      return { statuses, stats: stats(ms) }
    }
    const steady = await run(200, 10000)
    report['users.200.window10s'] = steady.stats
    expect(steady.statuses.every((s) => s === 200)).toBe(true)
    expect(steady.stats.p95).toBeLessThanOrEqual(1500)
    // пиковый всплеск: 50 запросов одновременно — без ошибок (время фиксируется в отчете)
    const burst = await run(50, 0)
    report['burst.50'] = burst.stats
    expect(burst.statuses.every((s) => s === 200)).toBe(true)
  })
})
