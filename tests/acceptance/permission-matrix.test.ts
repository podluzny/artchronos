import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Actor } from '../../src/domain/authorization/actor.js'
import type { Db } from '../../src/infrastructure/db/kysely.js'
import type { Services } from '../../src/server/container.js'
import { freshDb } from '../support/db.js'
import { ctx, makeUser, setupServices, uniqueEmail } from '../support/fixtures.js'

/**
 * AT-PERM-MATRIX / AT-AUTH-003.1 — исполняемая матрица docs/permission-model.md §4.
 * Каждая ячейка проверяется вызовом use case без UI. Раздел 4.1 (Identity & Governance) — M1;
 * следующие разделы добавляются вместе с блоками.
 */
type Role = 'STUDENT' | 'TEACHER' | 'EXPERT' | 'ADMIN'
const ROLES: Role[] = ['STUDENT', 'TEACHER', 'EXPERT', 'ADMIN']

let db: Db
let services: Services
let root: Actor
const actors = {} as Record<Role, { id: string; actor: Actor }>
let target: { id: string }

beforeAll(async () => {
  db = await freshDb()
  ;({ services, admin: root } = await setupServices(db))
  for (const r of ROLES) actors[r] = await makeUser(services, root, [r])
  target = await makeUser(services, root, ['STUDENT'])
})
afterAll(async () => db.destroy())

const allowed = async (p: Promise<unknown>) =>
  p.then(
    () => true,
    (e) => {
      if (['FORBIDDEN', 'NOT_FOUND'].includes(e.code)) return false
      throw e
    },
  )

/** Ожидание по матрице: роль → разрешено ли действие над чужим объектом. */
const MATRIX_4_1: { cell: string; expect: Record<Role, boolean>; run: (a: Actor) => Promise<unknown> }[] = [
  {
    cell: 'User / read (чужой)',
    expect: { STUDENT: false, TEACHER: false /* course: студенты курсов появятся в M2 */, EXPERT: false, ADMIN: true },
    run: (a) => services.identity.getUser.run(a, { id: target.id }, ctx),
  },
  {
    cell: 'User / create',
    expect: { STUDENT: false, TEACHER: false, EXPERT: false, ADMIN: true },
    run: (a) =>
      services.identity.createUser.run(
        a,
        { email: uniqueEmail('m'), displayName: 'M', roles: ['STUDENT'], initialMode: 'INVITE' },
        ctx,
      ),
  },
  {
    cell: 'User / update (чужой)',
    expect: { STUDENT: false, TEACHER: false, EXPERT: false, ADMIN: true },
    run: async (a) => {
      const u = await services.identity.getUser.run(root, { id: target.id }, ctx)
      return services.identity.updateUser.run(
        a,
        { id: target.id, displayName: `Имя ${Date.now()}`, revision: u.revision },
        ctx,
      )
    },
  },
  {
    cell: 'User / block',
    expect: { STUDENT: false, TEACHER: false, EXPERT: false, ADMIN: true },
    run: async (a) => {
      const r = await services.identity.changeUserStatus.run(
        a,
        { id: target.id, action: 'block', reason: 'матрица' },
        ctx,
      )
      await services.identity.changeUserStatus.run(root, { id: target.id, action: 'unblock' }, ctx)
      return r
    },
  },
  {
    cell: 'User / assign role',
    expect: { STUDENT: false, TEACHER: false, EXPERT: false, ADMIN: true },
    run: (a) => services.identity.setUserRoles.run(a, { id: target.id, roles: ['STUDENT'] }, ctx),
  },
  {
    cell: 'User / reset password',
    expect: { STUDENT: false, TEACHER: false, EXPERT: false, ADMIN: true },
    run: (a) => services.identity.resetPassword.run(a, { userId: target.id }, ctx),
  },
  {
    cell: 'Role / read',
    expect: { STUDENT: false, TEACHER: false, EXPERT: false, ADMIN: true },
    run: (a) => services.identity.listRoles.run(a, { filters: {}, limit: 5, offset: 0 }, ctx),
  },
  {
    cell: 'Role / manage',
    expect: { STUDENT: false, TEACHER: false, EXPERT: false, ADMIN: true },
    run: (a) =>
      services.identity.createRole.run(
        a,
        {
          code: `R_${Math.random()
            .toString(36)
            .slice(2, 8)
            .toUpperCase()
            .replace(/[^A-Z]/g, 'X')}`,
          name: 'R',
          grants: [],
        },
        ctx,
      ),
  },
  {
    cell: 'AuditLog / read',
    expect: { STUDENT: false, TEACHER: false, EXPERT: false, ADMIN: true },
    run: (a) => services.audit.listAudit.run(a, { filters: {}, limit: 5, offset: 0 }, ctx),
  },
]

describe('AT-PERM-MATRIX AT-AUTH-003.1 permission-model §4.1 Identity & Governance', () => {
  for (const row of MATRIX_4_1) {
    for (const role of ROLES) {
      it(`${row.cell} — ${role}: ${row.expect[role] ? 'разрешено' : 'запрещено'}`, async () => {
        const a = (await services.identity.loadActor(actors[role].id))!
        expect(await allowed(row.run(a))).toBe(row.expect[role])
      })
    }
  }

  it('User / update своего профиля — разрешено всем ролям', async () => {
    for (const role of ROLES) {
      const a = (await services.identity.loadActor(actors[role].id))!
      const me = await services.identity.getUser.run(a, { id: a.userId }, ctx)
      await expect(
        services.identity.updateUser.run(
          a,
          { id: a.userId, displayName: `${role} профиль`, revision: me.revision },
          ctx,
        ),
      ).resolves.toBeTruthy()
    }
  })
})

describe('AT-AUTH-003.3 списки в рамках scope; count соответствует фильтру', () => {
  it('Admin видит всех; count = числу записей', async () => {
    const r = await services.identity.listUsers.run(root, { filters: {}, limit: 500, offset: 0 }, ctx)
    const n = await db
      .selectFrom('users')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .executeTakeFirstOrThrow()
    expect(r.total).toBe(Number(n.n))
    expect(r.records).toHaveLength(r.total)
  })
  it('фильтры сужают и список, и count', async () => {
    const r = await services.identity.listUsers.run(root, { filters: { role: 'EXPERT' }, limit: 500, offset: 0 }, ctx)
    expect(r.total).toBe(r.records.length)
    expect(r.records.every((u) => u.roleCodes.includes('EXPERT'))).toBe(true)
  })
  it('Teacher: список пуст, count = 0 (вне scope)', async () => {
    const r = await services.identity.listUsers.run(actors.TEACHER.actor, { filters: {}, limit: 500, offset: 0 }, ctx)
    expect(r).toEqual({ records: [], total: 0 })
  })
})

describe('SPEC-AUDIT-001/002 аудит и история', () => {
  it('AT-AUDIT-001.1 AT-AUDIT-001.2 каждое изменение identity журналируется: actor, action, resource, diff', async () => {
    const u = await makeUser(services, root, ['STUDENT'])
    const v = await services.identity.getUser.run(root, { id: u.id }, ctx)
    await services.identity.updateUser.run(root, { id: u.id, displayName: 'Аудит', revision: v.revision }, ctx)
    await services.identity.setUserRoles.run(root, { id: u.id, roles: ['STUDENT', 'EXPERT'] }, ctx)
    await services.identity.changeUserStatus.run(root, { id: u.id, action: 'block', reason: 'аудит' }, ctx)
    await services.identity.changeUserStatus.run(root, { id: u.id, action: 'unblock' }, ctx)
    await services.identity.resetPassword.run(root, { userId: u.id }, ctx)
    const rows = await db.selectFrom('audit_log').selectAll().where('resource_id', '=', u.id).orderBy('id').execute()
    expect(rows.map((r) => r.action)).toEqual([
      'user.created',
      'user.updated',
      'user.roles.changed',
      'user.block',
      'user.unblock',
      'user.password.reset',
    ])
    for (const r of rows) {
      expect(r.actor_id).toBe(root.userId)
      expect(r.actor_roles).toEqual(['ADMIN'])
      expect(r.resource_type).toBe('user')
      expect(r.request_id).toBe('test')
    }
    expect(rows[1]!.changes).toEqual({ displayName: { from: v.displayName, to: 'Аудит' } })
    expect(rows[3]!.reason).toBe('аудит')
  })

  it('AT-AUDIT-002.1 история объекта: фильтр журнала по объекту показывает его события', async () => {
    const u = await makeUser(services, root, ['STUDENT'])
    await services.identity.changeUserStatus.run(root, { id: u.id, action: 'archive', reason: 'выпуск' }, ctx)
    const h = await services.audit.listAudit.run(
      root,
      { filters: { resourceType: 'user', resourceId: u.id }, limit: 50, offset: 0 },
      ctx,
    )
    expect(h.records.map((r) => r.action).reverse()).toEqual(['user.created', 'user.archive'])
  })

  it('AT-AUDIT-002.2 без права чтения истории объекта не видно', async () => {
    await expect(
      services.audit.listAudit.run(
        actors.TEACHER.actor,
        { filters: { resourceId: target.id }, limit: 5, offset: 0 },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('AT-AUDIT-002.3 архивирование не удаляет данные; восстановление возвращает объект', async () => {
    const u = await makeUser(services, root, ['STUDENT'])
    await services.identity.changeUserStatus.run(root, { id: u.id, action: 'archive', reason: 'x' }, ctx)
    const archived = await services.identity.getUser.run(root, { id: u.id }, ctx)
    expect(archived.status).toBe('ARCHIVED')
    await services.identity.changeUserStatus.run(root, { id: u.id, action: 'restore' }, ctx)
    await services.identity.changeUserStatus.run(root, { id: u.id, action: 'unblock' }, ctx)
    expect((await services.identity.getUser.run(root, { id: u.id }, ctx)).status).toBe('ACTIVE')
  })

  it('AT-AUDIT-002.4 используемый объект нельзя удалить физически (пользователь с аудитом)', async () => {
    const u = await makeUser(services, root, ['STUDENT'])
    await expect(db.deleteFrom('users').where('id', '=', u.id).execute()).rejects.toThrow()
  })
})
