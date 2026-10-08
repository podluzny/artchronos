import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Actor } from '../../src/domain/authorization/actor.js'
import type { Db } from '../../src/infrastructure/db/kysely.js'
import type { Services } from '../../src/server/container.js'
import { freshDb } from '../support/db.js'
import { auditActions, ctx, makeUser, PASSWORD, setupServices, uniqueEmail } from '../support/fixtures.js'

let db: Db
let services: Services
let admin: Actor

beforeAll(async () => {
  db = await freshDb()
  ;({ services, admin } = await setupServices(db))
})
afterAll(async () => db.destroy())

const login = (email: string, password: string) => services.identity.authenticate.run(null, { email, password }, ctx)

describe('SPEC-AUTH-001 Вход', () => {
  it('AT-AUTH-001.1 активный пользователь входит; аудит auth.login.success', async () => {
    const u = await makeUser(services, admin, ['TEACHER'])
    const r = await login(u.email.toUpperCase(), PASSWORD)
    expect(r.userId).toBe(u.id)
    expect(await auditActions(db, u.id)).toContain('auth.login.success')
  })

  it('AT-AUTH-001.2 неверный пароль и несуществующий email — одинаковый ответ', async () => {
    const u = await makeUser(services, admin, ['STUDENT'])
    const e1 = await login(u.email, 'Wrong-Password-123').catch((e) => e)
    const e2 = await login('nobody@test.local', 'Wrong-Password-123').catch((e) => e)
    expect(e1.code).toBe('UNAUTHENTICATED')
    expect(e2.code).toBe('UNAUTHENTICATED')
    expect(e1.message).toBe(e2.message)
  })

  it('AT-AUTH-001.3 после 5 неудач вход блокируется даже с верным паролем', async () => {
    const u = await makeUser(services, admin, ['STUDENT'])
    for (let i = 0; i < 5; i++) await login(u.email, 'Wrong-Password-123').catch(() => undefined)
    await expect(login(u.email, PASSWORD)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
    const row = await db.selectFrom('users').select('locked_until').where('id', '=', u.id).executeTakeFirstOrThrow()
    expect(row.locked_until!.getTime()).toBeGreaterThan(Date.now() + 14 * 60_000)
    // по истечении блокировки вход снова возможен
    await db
      .updateTable('users')
      .set({ locked_until: new Date(Date.now() - 1000) })
      .where('id', '=', u.id)
      .execute()
    await expect(login(u.email, PASSWORD)).resolves.toMatchObject({ userId: u.id })
  })

  it('AT-AUTH-001.4 BLOCKED, ARCHIVED, INVITED не входят', async () => {
    const blocked = await makeUser(services, admin, ['STUDENT'])
    await services.identity.changeUserStatus.run(admin, { id: blocked.id, action: 'block', reason: 'тест' }, ctx)
    await expect(login(blocked.email, PASSWORD)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
    const archived = await makeUser(services, admin, ['STUDENT'])
    await services.identity.changeUserStatus.run(admin, { id: archived.id, action: 'archive', reason: 'тест' }, ctx)
    await expect(login(archived.email, PASSWORD)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
    const invited = await services.identity.createUser.run(
      admin,
      { email: uniqueEmail(), displayName: 'Inv', roles: ['STUDENT'], initialMode: 'INVITE' },
      ctx,
    )
    await expect(login(invited.user.email, PASSWORD)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
  })

  it('AT-AUTH-001.5 пароль не попадает в аудит', async () => {
    const u = await makeUser(services, admin, ['STUDENT'])
    await login(u.email, 'Secret-Wrong-Pass-77').catch(() => undefined)
    const rows = await db
      .selectFrom('audit_log')
      .select(sql<string>`changes::text`.as('c'))
      .execute()
    expect(rows.some((r) => (r.c ?? '').includes('Secret-Wrong-Pass-77'))).toBe(false)
    expect(rows.some((r) => (r.c ?? '').includes(PASSWORD))).toBe(false)
  })

  it('AT-AUTH-001.7 mustChangePassword: actor без прав до смены пароля', async () => {
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
    const actor = (await services.identity.loadActor(r.user.id))!
    expect(actor.mustChangePassword).toBe(true)
    await expect(
      services.identity.listUsers.run(actor, { filters: {}, limit: 10, offset: 0 }, ctx),
    ).rejects.toMatchObject({
      code: 'PASSWORD_CHANGE_REQUIRED',
    })
    await services.identity.changeOwnPassword.run(
      actor,
      { currentPassword: PASSWORD, newPassword: 'Brand-New-Password-42' },
      ctx,
    )
    const after = (await services.identity.loadActor(r.user.id))!
    expect(after.mustChangePassword).toBe(false)
  })
})

describe('SPEC-AUTH-004 Пароли и активация', () => {
  it('AT-AUTH-004.1 смена пароля отзывает прочие сессии', async () => {
    const u = await makeUser(services, admin, ['STUDENT'])
    for (const sid of ['s-a', 's-b']) {
      await db
        .insertInto('sessions')
        .values({ sid, user_id: u.id, data: '{}', expires_at: new Date(Date.now() + 60_000) })
        .execute()
    }
    await services.identity.changeOwnPassword.run(
      u.actor,
      { currentPassword: PASSWORD, newPassword: 'Another-Strong-Pass-1' },
      { ...ctx, sessionId: 's-a' },
    )
    const rows = await db
      .selectFrom('sessions')
      .select(['sid', 'revoked_at'])
      .where('user_id', '=', u.id)
      .orderBy('sid')
      .execute()
    expect(rows.find((r) => r.sid === 's-a')!.revoked_at).toBeNull()
    expect(rows.find((r) => r.sid === 's-b')!.revoked_at).not.toBeNull()
  })

  it('AT-AUTH-004.2 слабый пароль отклоняется', async () => {
    const u = await makeUser(services, admin, ['STUDENT'])
    await expect(
      services.identity.changeOwnPassword.run(u.actor, { currentPassword: PASSWORD, newPassword: 'short' }, ctx),
    ).rejects.toMatchObject({ code: 'VALIDATION' })
  })

  it('AT-AUTH-004.3 токен одноразовый, ограничен по времени, хранится как hash', async () => {
    const r = await services.identity.createUser.run(
      admin,
      { email: uniqueEmail(), displayName: 'Inv', roles: ['STUDENT'], initialMode: 'INVITE' },
      ctx,
    )
    const token = r.activationToken!
    const stored = await db
      .selectFrom('password_tokens')
      .select('token_hash')
      .where('user_id', '=', r.user.id)
      .execute()
    expect(stored.map((s) => s.token_hash)).not.toContain(token)
    await services.identity.setPasswordWithToken.run(null, { token, newPassword: 'Activated-Password-1' }, ctx)
    await expect(
      services.identity.setPasswordWithToken.run(null, { token, newPassword: 'Activated-Password-2' }, ctx),
    ).rejects.toMatchObject({ code: 'VALIDATION' })
    // истекший токен
    const r2 = await services.identity.createUser.run(
      admin,
      { email: uniqueEmail(), displayName: 'Inv2', roles: ['STUDENT'], initialMode: 'INVITE' },
      ctx,
    )
    await db
      .updateTable('password_tokens')
      .set({ expires_at: new Date(Date.now() - 1000) })
      .where('user_id', '=', r2.user.id)
      .execute()
    await expect(
      services.identity.setPasswordWithToken.run(
        null,
        { token: r2.activationToken!, newPassword: 'Activated-Password-3' },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION' })
  })

  it('AT-AUTH-004.4 без user.password.reset нельзя сбросить пароль другому', async () => {
    const t = await makeUser(services, admin, ['TEACHER'])
    const s = await makeUser(services, admin, ['STUDENT'])
    await expect(services.identity.resetPassword.run(t.actor, { userId: s.id }, ctx)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    const r = await services.identity.resetPassword.run(admin, { userId: s.id }, ctx)
    expect(r.token).toBeTruthy()
    const after = (await services.identity.loadActor(s.id))!
    expect(after.mustChangePassword).toBe(true)
  })

  it('AT-AUTH-004.5 активация переводит INVITED → ACTIVE', async () => {
    const r = await services.identity.createUser.run(
      admin,
      { email: uniqueEmail(), displayName: 'Inv', roles: ['STUDENT'], initialMode: 'INVITE' },
      ctx,
    )
    expect(r.user.status).toBe('INVITED')
    await services.identity.setPasswordWithToken.run(
      null,
      { token: r.activationToken!, newPassword: 'Activated-Password-9' },
      ctx,
    )
    await expect(login(r.user.email, 'Activated-Password-9')).resolves.toMatchObject({ userId: r.user.id })
  })
})

describe('SPEC-USER-001 Пользователи', () => {
  it('AT-USER-001.1 Admin создает студента: INVITED, ссылка активации, аудит', async () => {
    const r = await services.identity.createUser.run(
      admin,
      { email: uniqueEmail('student'), displayName: 'Студент', roles: ['STUDENT'], initialMode: 'INVITE' },
      ctx,
    )
    expect(r.user.status).toBe('INVITED')
    expect(r.user.roleCodes).toEqual(['STUDENT'])
    expect(r.activationToken).toBeTruthy()
    expect(await auditActions(db, r.user.id)).toEqual(['user.created'])
  })

  it('AT-USER-001.2 дубликат email (другой регистр) отклоняется', async () => {
    const u = await makeUser(services, admin, ['STUDENT'])
    await expect(
      services.identity.createUser.run(
        admin,
        { email: u.email.toUpperCase(), displayName: 'X', roles: ['STUDENT'], initialMode: 'INVITE' },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION' })
  })

  it('AT-USER-001.3 блокировка отзывает сессии', async () => {
    const u = await makeUser(services, admin, ['STUDENT'])
    await db
      .insertInto('sessions')
      .values({ sid: `blk-${u.id}`, user_id: u.id, data: '{}', expires_at: new Date(Date.now() + 60_000) })
      .execute()
    await services.identity.changeUserStatus.run(admin, { id: u.id, action: 'block', reason: 'нарушение' }, ctx)
    const s = await db
      .selectFrom('sessions')
      .select('revoked_at')
      .where('sid', '=', `blk-${u.id}`)
      .executeTakeFirstOrThrow()
    expect(s.revoked_at).not.toBeNull()
    expect(await auditActions(db, u.id)).toContain('user.block')
  })

  it('AT-USER-001.4 Admin не может заблокировать себя (BR-015)', async () => {
    await expect(
      services.identity.changeUserStatus.run(admin, { id: admin.userId, action: 'block', reason: 'x' }, ctx),
    ).rejects.toMatchObject({ ruleId: 'BR-015' })
  })

  it('AT-USER-001.5 нельзя заблокировать/архивировать последнего активного Admin (BR-016)', async () => {
    // С учетом BR-015 оставить систему без админа может только не-админ с user.status.manage (пользовательская роль).
    const role = await services.identity.createRole.run(
      admin,
      {
        code: 'USER_MANAGER',
        name: 'Менеджер пользователей',
        grants: [
          { key: 'user.status.manage', scope: 'ANY' },
          { key: 'user.role.assign', scope: 'ANY' },
        ],
      },
      ctx,
    )
    expect(role.code).toBe('USER_MANAGER')
    const m = await makeUser(services, admin, ['USER_MANAGER'])
    expect(await services.uow.read.users.countActiveAdmins()).toBe(1)
    await expect(
      services.identity.changeUserStatus.run(m.actor, { id: admin.userId, action: 'block', reason: 'x' }, ctx),
    ).rejects.toMatchObject({
      ruleId: 'BR-016',
    })
    await expect(
      services.identity.changeUserStatus.run(m.actor, { id: admin.userId, action: 'archive', reason: 'x' }, ctx),
    ).rejects.toMatchObject({
      ruleId: 'BR-016',
    })
    // откат транзакции: администратор остался активным
    expect((await services.identity.loadActor(admin.userId))!.status).toBe('ACTIVE')
    // при наличии второго администратора блокировка допустима
    const second = await makeUser(services, admin, ['ADMIN'])
    await services.identity.changeUserStatus.run(m.actor, { id: second.id, action: 'block', reason: 'x' }, ctx)
    await services.identity.changeUserStatus.run(m.actor, { id: second.id, action: 'archive', reason: 'x' }, ctx)
  })

  it('AT-USER-001.6 физическое удаление пользователя невозможно (нет use case; FK RESTRICT)', async () => {
    expect(Object.keys(services.identity)).not.toContain('deleteUser')
    const u = await makeUser(services, admin, ['STUDENT'])
    await expect(db.deleteFrom('users').where('id', '=', u.id).execute()).rejects.toThrow()
  })

  it('AT-USER-001.7 Expert/Student не создают и не изменяют пользователей', async () => {
    for (const role of ['EXPERT', 'STUDENT']) {
      const u = await makeUser(services, (await services.identity.loadActor(admin.userId))!, [role])
      await expect(
        services.identity.createUser.run(
          u.actor,
          { email: uniqueEmail(), displayName: 'x', roles: ['STUDENT'], initialMode: 'INVITE' },
          ctx,
        ),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' })
      await expect(
        services.identity.updateUser.run(u.actor, { id: admin.userId, displayName: 'hacked', revision: 1 }, ctx),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    }
  })

  it('AT-USER-001.8 AT-AUTH-003.4 Teacher видит в списке только студентов своих курсов (в M1 курсов нет → пусто)', async () => {
    const t = await makeUser(services, (await services.identity.loadActor(admin.userId))!, ['TEACHER'])
    const r = await services.identity.listUsers.run(t.actor, { filters: {}, limit: 50, offset: 0 }, ctx)
    expect(r.total).toBe(0)
    // собственный профиль доступен
    await expect(services.identity.getUser.run(t.actor, { id: t.id }, ctx)).resolves.toMatchObject({ id: t.id })
    await expect(services.identity.getUser.run(t.actor, { id: admin.userId }, ctx)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })

  it('свой профиль: можно изменить имя, нельзя email (SPEC-USER-001)', async () => {
    const u = await makeUser(services, (await services.identity.loadActor(admin.userId))!, ['STUDENT'])
    const me = await services.identity.getUser.run(u.actor, { id: u.id }, ctx)
    const r = await services.identity.updateUser.run(
      u.actor,
      { id: u.id, displayName: 'Новое имя', revision: me.revision },
      ctx,
    )
    expect(r.displayName).toBe('Новое имя')
    await expect(
      services.identity.updateUser.run(u.actor, { id: u.id, email: uniqueEmail(), revision: r.revision }, ctx),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('NFR-DATA-003 конфликт revision → CONFLICT без потери данных', async () => {
    const a = (await services.identity.loadActor(admin.userId))!
    const u = await makeUser(services, a, ['STUDENT'])
    const v = await services.identity.getUser.run(a, { id: u.id }, ctx)
    await services.identity.updateUser.run(a, { id: u.id, displayName: 'Первое', revision: v.revision }, ctx)
    await expect(
      services.identity.updateUser.run(a, { id: u.id, displayName: 'Второе', revision: v.revision }, ctx),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
    })
    expect((await services.identity.getUser.run(a, { id: u.id }, ctx)).displayName).toBe('Первое')
  })
})

describe('SPEC-USER-002 Роли', () => {
  it('AT-USER-002.1 назначение роли журналируется с до/после', async () => {
    const a = (await services.identity.loadActor(admin.userId))!
    const u = await makeUser(services, a, ['TEACHER'])
    await services.identity.setUserRoles.run(a, { id: u.id, roles: ['TEACHER', 'EXPERT'] }, ctx)
    const row = await db
      .selectFrom('audit_log')
      .select('changes')
      .where('resource_id', '=', u.id)
      .where('action', '=', 'user.roles.changed')
      .executeTakeFirstOrThrow()
    expect(row.changes).toEqual({ roles: { from: ['TEACHER'], to: ['EXPERT', 'TEACHER'] } })
  })

  it('AT-USER-002.2 AT-AUTH-003.5 нельзя изменить собственные роли (даже Admin)', async () => {
    const a = (await services.identity.loadActor(admin.userId))!
    await expect(
      services.identity.setUserRoles.run(a, { id: a.userId, roles: ['ADMIN', 'TEACHER'] }, ctx),
    ).rejects.toMatchObject({
      ruleId: 'BR-015',
    })
  })

  it('AT-USER-002.3 снятие ADMIN у последнего активного администратора отклоняется (BR-016)', async () => {
    const m = await makeUser(services, admin, ['USER_MANAGER'])
    expect(await services.uow.read.users.countActiveAdmins()).toBe(1)
    await expect(
      services.identity.setUserRoles.run(m.actor, { id: admin.userId, roles: ['TEACHER'] }, ctx),
    ).rejects.toMatchObject({
      ruleId: 'BR-016',
    })
    expect((await services.identity.loadActor(admin.userId))!.roleCodes).toEqual(['ADMIN'])
  })

  it('AT-USER-002.4 системную роль удалить нельзя', async () => {
    const a = (await services.identity.loadActor(admin.userId))!
    const roles = await services.identity.listRoles.run(a, { filters: {}, limit: 50, offset: 0 }, ctx)
    const student = roles.records.find((r) => r.code === 'STUDENT')!
    await expect(services.identity.deleteRole.run(a, { id: student.id }, ctx)).rejects.toMatchObject({
      ruleId: 'BR-046',
    })
  })

  it('AT-USER-002.5 AT-USER-002.6 пользовательская роль: создание, права, аудит, удаление', async () => {
    const a = (await services.identity.loadActor(admin.userId))!
    const role = await services.identity.createRole.run(
      a,
      { code: 'METHODIST', name: 'Методист', grants: [{ key: 'taxonomy.read', scope: 'ANY' }] },
      ctx,
    )
    await expect(
      services.identity.updateRole.run(
        a,
        { id: role.id, name: 'Методист', grants: [{ key: 'test.publish', scope: 'OWN' }], revision: role.revision },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION' })
    const upd = await services.identity.updateRole.run(
      a,
      {
        id: role.id,
        name: 'Методист',
        grants: [
          { key: 'taxonomy.read', scope: 'ANY' },
          { key: 'test.publish', scope: 'ANY' },
        ],
        revision: role.revision,
      },
      ctx,
    )
    expect(upd.grants.map((g) => g.key)).toEqual(['taxonomy.read', 'test.publish'])
    expect(await auditActions(db, role.id)).toEqual(['role.created', 'role.updated'])
    const u = await makeUser(services, a, ['METHODIST'])
    expect(u.actor.has('test.publish', 'ANY')).toBe(true)
    await expect(services.identity.deleteRole.run(a, { id: role.id }, ctx)).rejects.toMatchObject({
      code: 'INVALID_STATE',
    })
  })

  it('AT-AUTH-003.6 изменение состава роли действует со следующей загрузки actor', async () => {
    const a = (await services.identity.loadActor(admin.userId))!
    const role = await services.identity.createRole.run(a, { code: 'VIEWER', name: 'Наблюдатель', grants: [] }, ctx)
    const u = await makeUser(services, a, ['VIEWER'])
    expect(u.actor.has('audit.read')).toBe(false)
    await services.identity.updateRole.run(
      a,
      { id: role.id, name: role.name, grants: [{ key: 'audit.read', scope: 'ANY' }], revision: role.revision },
      ctx,
    )
    expect((await services.identity.loadActor(u.id))!.has('audit.read')).toBe(true)
  })

  it('BR-015: нельзя менять состав роли, которая назначена самому себе', async () => {
    const a = (await services.identity.loadActor(admin.userId))!
    const roles = await services.identity.listRoles.run(a, { filters: {}, limit: 50, offset: 0 }, ctx)
    const adminRole = roles.records.find((r) => r.code === 'ADMIN')!
    await expect(
      services.identity.updateRole.run(
        a,
        { id: adminRole.id, name: 'X', grants: [], revision: adminRole.revision },
        ctx,
      ),
    ).rejects.toMatchObject({ ruleId: 'BR-015' })
  })

  it('AT-USER-002.7 эксперт не может менять роли', async () => {
    const a = (await services.identity.loadActor(admin.userId))!
    const e = await makeUser(services, a, ['EXPERT'])
    await expect(
      services.identity.createRole.run(e.actor, { code: 'HACK', name: 'x', grants: [] }, ctx),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      services.identity.setUserRoles.run(e.actor, { id: a.userId, roles: ['STUDENT'] }, ctx),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})

describe('SPEC-AUDIT-001 Журнал', () => {
  it('AT-AUDIT-001.3 журнал неизменяем даже прямым SQL', async () => {
    await expect(sql`UPDATE audit_log SET action = 'x'`.execute(db)).rejects.toThrow(/append-only/)
    await expect(sql`DELETE FROM audit_log`.execute(db)).rejects.toThrow(/append-only/)
    await expect(sql`TRUNCATE audit_log`.execute(db)).rejects.toThrow(/append-only/)
  })

  it('AT-AUDIT-001.4 сбой записи аудита откатывает операцию', async () => {
    const a = (await services.identity.loadActor(admin.userId))!
    const email = uniqueEmail()
    const failing = {
      ...services.uow,
      read: services.uow.read,
      transaction: (fn: any) =>
        services.uow.transaction((tx) =>
          fn({
            ...tx,
            audit: {
              record: async () => {
                throw new Error('audit down')
              },
            },
          }),
        ),
    }
    const { createIdentityUseCases } = await import('../../src/application/identity/use-cases.js')
    const { Argon2Hasher, RandomTokenService } = await import('../../src/infrastructure/security/crypto.js')
    const uc = createIdentityUseCases({
      uow: failing as any,
      hasher: new Argon2Hasher(),
      tokens: new RandomTokenService(),
      clock: { now: () => new Date() },
    })
    await expect(
      uc.createUser.run(a, { email, displayName: 'x', roles: ['STUDENT'], initialMode: 'INVITE' }, ctx),
    ).rejects.toThrow('audit down')
    expect(await db.selectFrom('users').select('id').where('email', '=', email).executeTakeFirst()).toBeUndefined()
  })

  it('AT-AUDIT-001.6 не-Admin не имеет доступа к журналу', async () => {
    const a = (await services.identity.loadActor(admin.userId))!
    for (const role of ['TEACHER', 'EXPERT', 'STUDENT']) {
      const u = await makeUser(services, a, [role])
      await expect(
        services.audit.listAudit.run(u.actor, { filters: {}, limit: 10, offset: 0 }, ctx),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    }
    const r = await services.audit.listAudit.run(a, { filters: { action: 'user.' }, limit: 5, offset: 0 }, ctx)
    expect(r.total).toBeGreaterThan(0)
    expect(r.records.every((x) => x.action.startsWith('user.'))).toBe(true)
  })
})
