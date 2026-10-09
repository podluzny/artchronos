import { execFileSync } from 'node:child_process'
import { sql } from 'kysely'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sanitizeRichText } from '../../src/application/itembank/item-use-cases.js'
import type { Actor } from '../../src/domain/authorization/actor.js'
import type { Db } from '../../src/infrastructure/db/kysely.js'
import { createServices, type Services } from '../../src/server/container.js'
import { freshDb } from '../support/db.js'
import { makeCourseWorld } from '../support/education.js'
import { ctx, makeUser, PASSWORD, setupServices } from '../support/fixtures.js'
import { api, buildTestApp, loginAgent } from '../support/http.js'
import { allowManyTests, choiceDoc, studentItem, submittedStudentTest, type World } from '../support/workflow.js'

let db: Db
let services: Services
let admin: Actor
let w: World
let app: Awaited<ReturnType<typeof buildTestApp>>['app']

beforeAll(async () => {
  db = await freshDb()
  ;({ admin } = await setupServices(db))
  services = createServices(db)
  w = await makeCourseWorld(services, admin)
  await allowManyTests(db, w)
  ;({ app } = await buildTestApp(db))
})
afterAll(async () => db.destroy())

const codeOf = (p: Promise<unknown>) =>
  p.then(
    () => 'OK',
    (e) => e.ruleId ?? e.code,
  )

/** Второй студент той же группы — «сосед», пытающийся вмешаться в чужой контент. */
async function classmate() {
  const u = await makeUser(services, admin, ['STUDENT'])
  const g = await services.education.getGroup.run(admin, { id: w.groupId }, ctx)
  await services.education.setGroupMembers.run(
    w.teacher.actor,
    { id: w.groupId, memberIds: [...g.memberIds, u.id] },
    ctx,
  )
  return u
}

describe('NFR-SEC-010 отсутствие privilege escalation (T-079)', () => {
  it('владелец и авторы не задаются клиентом (mass assignment игнорируется)', async () => {
    const r = await services.items.createItem.run(
      w.student.actor,
      {
        assignmentId: w.assignmentId,
        questionTypeId: w.qt('single_choice'),
        document: { ...choiceDoc(), state: 'APPROVED' },
        meta: { topicIds: [w.subtopicId] },
        ownerId: admin.userId,
        authorIds: [admin.userId],
      } as never,
      ctx,
    )
    const it = await services.items.getItem.run(admin, { id: r.itemId }, ctx)
    expect(it.item.ownerId).toBe(w.student.id)
    expect(it.version.authorIds).toEqual([w.student.id])
    expect(it.version.state).toBe('DRAFT')
    const t = await services.tests.createTest.run(
      w.student.actor,
      { assignmentId: w.assignmentId, title: 'Мой', ownerId: admin.userId, state: 'APPROVED' } as never,
      ctx,
    )
    const d = await services.tests.getTest.run(admin, { id: t.testId }, ctx)
    expect(d.test.ownerId).toBe(w.student.id)
    expect(d.version.state).toBe('DRAFT')
  })

  it('подмена id: чужой раздел, позиция теста, замечание, тест — отклоняются', async () => {
    const mine = await services.tests.createTest.run(
      w.student.actor,
      { assignmentId: w.assignmentId, title: 'Мой' },
      ctx,
    )
    const other = await classmate()
    const foreignItem = await studentItem(services, w, other.actor)
    const foreign = await services.tests.createTest.run(
      other.actor,
      { assignmentId: w.assignmentId, title: 'Чужой' },
      ctx,
    )
    const fd = await services.tests.getTest.run(other.actor, { id: foreign.testId }, ctx)
    const entry = await services.tests.addItem.run(
      other.actor,
      { testId: foreign.testId, sectionId: fd.sections[0]!.id, itemId: foreignItem.itemId },
      ctx,
    )
    const ownItem = await studentItem(services, w)
    // раздел чужого теста в своем тесте
    expect(
      await codeOf(
        services.tests.addItem.run(
          w.student.actor,
          { testId: mine.testId, sectionId: fd.sections[0]!.id, itemId: ownItem.itemId },
          ctx,
        ),
      ),
    ).toBe('VALIDATION')
    // позиция чужого теста через свой тест
    expect(
      await codeOf(
        services.tests.removeItem.run(w.student.actor, { testId: mine.testId, entryId: entry.entryId }, ctx),
      ),
    ).toBe('NOT_FOUND')
    // прямое обращение к чужому тесту и вопросу
    expect(
      await codeOf(services.tests.addSection.run(w.student.actor, { testId: foreign.testId, title: 'x' }, ctx)),
    ).toBe('NOT_FOUND')
    expect(
      await codeOf(
        services.items.saveDraft.run(
          w.student.actor,
          { itemId: foreignItem.itemId, document: choiceDoc(), revision: 1 },
          ctx,
        ),
      ),
    ).toBe('NOT_FOUND')
    // замечание чужой экспертизы
    const t = await submittedStudentTest(services, w)
    await services.reviews.startReview.run(w.teacher.actor, { reviewId: t.reviewId }, ctx)
    const { issueId } = await services.reviews.addComment.run(
      w.teacher.actor,
      { reviewId: t.reviewId, body: 'x', severity: 'MINOR' },
      ctx,
    )
    expect(
      await codeOf(services.reviews.setIssueStatus.run(other.actor, { issueId: issueId!, status: 'ADDRESSED' }, ctx)),
    ).toBe('NOT_FOUND')
  })

  it('HTTP: студент не меняет собственные роли и не вызывает операции конструктора чужого теста', async () => {
    const other = await classmate()
    const foreign = await services.tests.createTest.run(
      other.actor,
      { assignmentId: w.assignmentId, title: 'Чужой HTTP' },
      ctx,
    )
    const agent = await loginAgent(app, w.student.email, PASSWORD)
    const roles = await api(agent).recordAction('User', w.student.id, 'changeRoles', { roles: '["ADMIN"]' })
    expect(JSON.stringify(roles.body)).toMatch(/forbidden|NotFound|не найден/i)
    const me = await services.identity.loadActor(w.student.id)
    expect(me!.roleCodes).toEqual(['STUDENT'])
    const b = await api(agent).recordAction('Test', foreign.testId, 'builder', { op: 'addSection', title: 'взлом' })
    expect(b.body.ok).not.toBe(true)
    const n = await sql<{
      n: string
    }>`select count(*) as n from test_sections ts join tests t on t.current_draft_version_id = ts.test_version_id where t.id = ${foreign.testId}`.execute(
      db,
    )
    expect(Number(n.rows[0]!.n)).toBe(1)
  })
})

describe('NFR-SEC-007 XSS (T-081)', () => {
  const PAYLOADS = [
    '<script>alert(1)</script>Текст',
    '<img src=x onerror=alert(1)>',
    '<a href="javascript:alert(1)">ссылка</a>',
    '<svg onload=alert(1)><circle/></svg>',
    '<p style="background:url(javascript:alert(1))" onclick="x()">абзац</p>',
    '<iframe src="https://evil.example"></iframe>',
    '<b onmouseover=alert(1)>жирный</b>',
    '<<script>script>alert(1)<</script>/script>',
    '<img src=x onerror=alert(1) ',
    'текст <svg/onload=alert(1)//',
  ]
  it('rich text санитизируется по allow-list при сохранении', async () => {
    for (const p of PAYLOADS) {
      const out = sanitizeRichText(p)
      expect(out).not.toMatch(/<\s*\/?\s*(script|img|svg|iframe|a)\b/i)
      // ни одного настоящего тега с обработчиками, javascript: или style (остаток разметки экранирован в текст)
      expect(out).not.toMatch(/<[^>]*\son\w+\s*=/i)
      expect(out).not.toMatch(/<[^>]*javascript:/i)
      expect(out).not.toMatch(/<[^>]*style\s*=/i)
      expect(out.replace(/<\/?(b|strong|i|em|u|p|br|ul|ol|li|sub|sup)>/g, '')).not.toContain('<')
    }
    const r = await services.items.createItem.run(
      w.student.actor,
      {
        assignmentId: w.assignmentId,
        questionTypeId: w.qt('single_choice'),
        document: { ...choiceDoc(), stem: '<b>Кто</b> автор? <img src=x onerror=alert(1)><script>x()</script>' },
        meta: { topicIds: [w.subtopicId] },
      },
      ctx,
    )
    const stored = (await sql<{ stem: string }>`select stem from item_versions where id = ${r.versionId}`.execute(db))
      .rows[0]!.stem
    expect(stored).toBe('<b>Кто</b> автор? ')
    const t = await services.tests.createTest.run(
      w.student.actor,
      { assignmentId: w.assignmentId, title: 'XSS', description: '<p onclick="x()">описание</p><script>1</script>' },
      ctx,
    )
    expect((await services.tests.getTest.run(w.student.actor, { id: t.testId }, ctx)).version.description).toBe(
      '<p>описание</p>',
    )
  })

  it('SVG (может содержать скрипт) не принимается к загрузке', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect width="10" height="10"/></svg>',
    )
    expect(
      await codeOf(
        services.media.uploadMedia.run(w.teacher.actor, { data: svg, metadata: { title: 'svg', altText: 'x' } }, ctx),
      ),
    ).toBe('VALIDATION')
  })
})

describe('NFR-SEC-008 answerKey не попадает в списки (T-081)', () => {
  it('списки вопросов, тестов и экспертиз через API не содержат ключей ответов', async () => {
    await submittedStudentTest(services, w)
    const agent = await loginAgent(app, 'root@test.local', PASSWORD)
    for (const resource of ['Item', 'Test', 'Review']) {
      const r = await api(agent).list(resource, '?perPage=50')
      expect(r.status).toBe(200)
      expect(r.body.records.length).toBeGreaterThan(0)
      expect(JSON.stringify(r.body)).not.toMatch(/answerKey|"correct"|"accepted"/)
    }
    const items = await api(agent).list('Item')
    const show = await api(agent).show('Item', items.body.records[0].id)
    expect(JSON.stringify(show.body.record.params)).not.toMatch(/answerKey|"correct"/)
  })
})

describe('NFR-SEC-006/007/009 заголовки и секреты (T-081)', () => {
  it('ответы содержат заголовки безопасности и CSP', async () => {
    const r = await request(app).get('/admin/login').expect(200)
    expect(r.headers['x-content-type-options']).toBe('nosniff')
    expect(r.headers['x-frame-options']).toBe('DENY')
    expect(r.headers['x-powered-by']).toBeUndefined()
    const csp = String(r.headers['content-security-policy'])
    for (const d of [
      "object-src 'none'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "default-src 'self'",
    ])
      expect(csp).toContain(d)
    expect(csp).not.toMatch(/script-src[^;]*(\*|https?:)/)
  })

  it('NFR-SEC-009 в репозитории нет секретов', () => {
    const out = execFileSync('python3', ['tools/check_secrets.py'], { encoding: 'utf-8' })
    expect(out).toMatch(/0 findings/)
  })
})
