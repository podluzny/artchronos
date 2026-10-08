import { z } from 'zod'
import { DomainError, type FieldError } from '../../domain/shared/errors.js'
import { isValidEmail, normalizeEmail } from '../../domain/shared/text.js'
import { requireScope, scopeAllows, scopeFilter, type Actor } from '../../domain/authorization/actor.js'
import { isScope, type Scope } from '../../domain/authorization/scope.js'
import { permissionDef } from '../../domain/identity/permission-catalog.js'
import { validatePassword } from '../../domain/identity/password-policy.js'
import {
  assertAdminRemains,
  assertNotSelf,
  canAuthenticate,
  LOGIN_LOCKOUT,
  nextUserStatus,
} from '../../domain/identity/user-rules.js'
import { diff } from '../shared/audit.js'
import type { Clock } from '../shared/context.js'
import type { ListQuery } from '../shared/query.js'
import type { UnitOfWork } from '../shared/uow.js'
import { useCase } from '../shared/use-case.js'
import { loadActor } from './actor-loader.js'
import type { IdentityTx, PasswordHasher, RoleGrantRecord, TokenService, UserRecord } from './ports.js'

export interface IdentityDeps {
  uow: UnitOfWork<IdentityTx>
  hasher: PasswordHasher
  tokens: TokenService
  clock: Clock
}

export const TOKEN_TTL = { ACTIVATION: 7 * 24 * 3600_000, RESET: 3600_000 } as const

const GENERIC_LOGIN_ERROR = 'Неверный email или пароль'

/** Публичное представление пользователя: без hash и служебных полей входа. */
export interface UserView {
  id: string
  email: string
  displayName: string
  status: UserRecord['status']
  roleCodes: string[]
  mustChangePassword: boolean
  lastLoginAt: Date | null
  statusReason: string | null
  createdAt: Date
  updatedAt: Date
  revision: number
}

export function toUserView(u: UserRecord): UserView {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    status: u.status,
    roleCodes: u.roleCodes,
    mustChangePassword: u.mustChangePassword,
    lastLoginAt: u.lastLoginAt,
    statusReason: u.statusReason,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
    revision: u.revision,
  }
}

function zodErrors(e: z.ZodError): FieldError[] {
  return e.issues.map((i) => ({ field: i.path.join('.') || 'form', message: i.message }))
}

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const r = schema.safeParse(input)
  if (!r.success) throw DomainError.validation(zodErrors(r.error))
  return r.data
}

const emailSchema = z.string().transform(normalizeEmail).refine(isValidEmail, { message: 'Некорректный email' })
const nameSchema = z.string().trim().min(1, 'Обязательное поле').max(200, 'Не более 200 символов')

export function createIdentityUseCases(deps: IdentityDeps) {
  const { uow, hasher, tokens, clock } = deps

  async function relationsToUser(actor: Actor, userId: string): Promise<Set<Scope>> {
    const rel = new Set<Scope>()
    if (actor.userId === userId) rel.add('OWN')
    if (actor.scopes('user.read').has('COURSE') && (await uow.read.users.inActorCourses(actor.userId, userId))) {
      rel.add('COURSE')
    }
    return rel
  }

  async function issueToken(tx: IdentityTx, userId: string, purpose: 'ACTIVATION' | 'RESET', createdBy: string | null) {
    const now = clock.now()
    await tx.tokens.invalidateForUser(userId, now)
    const token = tokens.generate()
    await tx.tokens.insert({
      userId,
      purpose,
      tokenHash: tokens.hash(token),
      expiresAt: new Date(now.getTime() + TOKEN_TTL[purpose]),
      createdBy,
    })
    return token
  }

  async function resolveRoles(tx: IdentityTx, codes: string[]) {
    const unique = [...new Set(codes)]
    const roles = await tx.roles.findByCodes(unique)
    const missing = unique.filter((c) => !roles.some((r) => r.code === c))
    if (missing.length)
      throw DomainError.validation([{ field: 'roles', message: `Неизвестные роли: ${missing.join(', ')}` }])
    return roles
  }

  return {
    // ---------- SPEC-AUTH-001: вход ----------
    authenticate: useCase<{ email: string; password: string }, { userId: string; mustChangePassword: boolean }>({
      name: 'identity.authenticate',
      permission: 'PUBLIC',
      async run(_actor, input, ctx) {
        const email = normalizeEmail(String(input.email ?? '')).slice(0, 254)
        const password = String(input.password ?? '').slice(0, 1024)
        const now = clock.now()
        const user = await uow.read.users.findByEmail(email)
        const fail = async (reason: string, userId: string | null) => {
          await uow.transaction(async (tx) => {
            if (userId && reason === 'BAD_PASSWORD') {
              const u = await tx.users.findById(userId)
              if (u) {
                const count = u.failedLoginCount + 1
                const lock = count >= LOGIN_LOCKOUT.maxFailures
                await tx.users.update(userId, {
                  failedLoginCount: lock ? 0 : count,
                  lockedUntil: lock ? new Date(now.getTime() + LOGIN_LOCKOUT.lockMinutes * 60_000) : u.lockedUntil,
                })
                if (lock) reason = 'LOCKED_NOW'
              }
            }
            await tx.audit.record(
              null,
              { action: 'auth.login.failure', resourceType: 'user', resourceId: userId, changes: { email, reason } },
              ctx,
            )
          })
          throw new DomainError('UNAUTHENTICATED', GENERIC_LOGIN_ERROR)
        }
        if (!user || !user.passwordHash) {
          await hasher.dummyVerify(password)
          return fail(user ? 'NO_PASSWORD' : 'UNKNOWN_EMAIL', user?.id ?? null)
        }
        const ok = await hasher.verify(user.passwordHash, password)
        if (user.lockedUntil && user.lockedUntil > now) return fail('LOCKED', user.id)
        if (!ok) return fail('BAD_PASSWORD', user.id)
        if (!canAuthenticate(user.status)) return fail(`STATUS_${user.status}`, user.id)
        await uow.transaction(async (tx) => {
          await tx.users.update(user.id, { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now })
          await tx.audit.record(
            null,
            { action: 'auth.login.success', resourceType: 'user', resourceId: user.id },
            ctx,
            user.id,
          )
        })
        return { userId: user.id, mustChangePassword: user.mustChangePassword }
      },
    }),

    logout: useCase<void, void>({
      name: 'identity.logout',
      permission: 'AUTHENTICATED',
      async run(actor, _input, ctx) {
        await uow.transaction((tx) =>
          tx.audit.record(actor, { action: 'auth.logout', resourceType: 'user', resourceId: actor.userId }, ctx),
        )
      },
    }),

    // ---------- SPEC-AUTH-004: пароли ----------
    changeOwnPassword: useCase<{ currentPassword: string; newPassword: string }, void>({
      name: 'identity.changeOwnPassword',
      permission: 'AUTHENTICATED',
      async run(actor, input, ctx) {
        const user = await uow.read.users.findById(actor.userId)
        if (!user?.passwordHash) throw DomainError.notFound()
        if (!(await hasher.verify(user.passwordHash, String(input.currentPassword ?? '')))) {
          throw DomainError.validation([{ field: 'currentPassword', message: 'Неверный текущий пароль' }])
        }
        const errors = validatePassword(String(input.newPassword ?? ''), user.email)
        if (await hasher.verify(user.passwordHash, String(input.newPassword ?? ''))) {
          errors.push({ field: 'password', message: 'Новый пароль должен отличаться от текущего' })
        }
        if (errors.length) throw DomainError.validation(errors)
        const hash = await hasher.hash(input.newPassword)
        await uow.transaction(async (tx) => {
          await tx.users.update(user.id, {
            passwordHash: hash,
            passwordChangedAt: clock.now(),
            mustChangePassword: false,
          })
          await tx.sessions.revokeAllForUser(user.id, ctx.sessionId ?? null)
          await tx.audit.record(
            actor,
            { action: 'user.password.changed', resourceType: 'user', resourceId: user.id },
            ctx,
          )
        })
      },
    }),

    /** Активация приглашения или сброс по одноразовому токену. */
    setPasswordWithToken: useCase<{ token: string; newPassword: string }, { userId: string }>({
      name: 'identity.setPasswordWithToken',
      permission: 'PUBLIC',
      async run(_actor, input, ctx) {
        const now = clock.now()
        const rec = await uow.read.tokens.findByHash(tokens.hash(String(input.token ?? '')))
        if (!rec || rec.usedAt || rec.expiresAt <= now) {
          throw new DomainError('VALIDATION', 'Ссылка недействительна или устарела. Запросите новую у администратора.')
        }
        const user = await uow.read.users.findById(rec.userId)
        if (!user) throw DomainError.notFound()
        const errors = validatePassword(String(input.newPassword ?? ''), user.email)
        if (errors.length) throw DomainError.validation(errors)
        if (rec.purpose === 'ACTIVATION' && user.status !== 'INVITED') {
          throw new DomainError('VALIDATION', 'Учетная запись уже активирована')
        }
        if (rec.purpose === 'RESET' && user.status !== 'ACTIVE') {
          throw new DomainError('VALIDATION', 'Учетная запись неактивна')
        }
        const hash = await hasher.hash(input.newPassword)
        await uow.transaction(async (tx) => {
          await tx.tokens.markUsed(rec.id, now)
          await tx.users.update(user.id, {
            passwordHash: hash,
            passwordChangedAt: now,
            mustChangePassword: false,
            failedLoginCount: 0,
            lockedUntil: null,
            ...(rec.purpose === 'ACTIVATION' ? { status: 'ACTIVE' as const } : {}),
          })
          await tx.sessions.revokeAllForUser(user.id)
          await tx.audit.record(
            null,
            {
              action: rec.purpose === 'ACTIVATION' ? 'user.activated' : 'user.password.reset.completed',
              resourceType: 'user',
              resourceId: user.id,
            },
            ctx,
            user.id,
          )
        })
        return { userId: user.id }
      },
    }),

    resetPassword: useCase<{ userId: string }, { token: string }>({
      name: 'identity.resetPassword',
      permission: 'user.password.reset',
      async run(actor, input, ctx) {
        const user = await uow.read.users.findById(input.userId)
        if (!user) throw DomainError.notFound()
        if (user.status !== 'ACTIVE') {
          throw new DomainError('INVALID_STATE', 'Сброс пароля возможен только для активного пользователя')
        }
        return uow.transaction(async (tx) => {
          const token = await issueToken(tx, user.id, 'RESET', actor.userId)
          await tx.users.update(user.id, { mustChangePassword: true })
          await tx.sessions.revokeAllForUser(user.id)
          await tx.audit.record(
            actor,
            { action: 'user.password.reset', resourceType: 'user', resourceId: user.id },
            ctx,
          )
          return { token }
        })
      },
    }),

    reissueActivation: useCase<{ userId: string }, { token: string }>({
      name: 'identity.reissueActivation',
      permission: 'user.create',
      async run(actor, input, ctx) {
        const user = await uow.read.users.findById(input.userId)
        if (!user) throw DomainError.notFound()
        if (user.status !== 'INVITED') throw new DomainError('INVALID_STATE', 'Пользователь уже активирован')
        return uow.transaction(async (tx) => {
          const token = await issueToken(tx, user.id, 'ACTIVATION', actor.userId)
          await tx.audit.record(
            actor,
            { action: 'user.invitation.reissued', resourceType: 'user', resourceId: user.id },
            ctx,
          )
          return { token }
        })
      },
    }),

    // ---------- SPEC-USER-001: пользователи ----------
    listUsers: useCase<ListQuery, { records: UserView[]; total: number }>({
      name: 'identity.listUsers',
      permission: 'user.read',
      async run(actor, query) {
        const filter = scopeFilter(actor, 'user.read')
        const [records, total] = await Promise.all([
          uow.read.users.list(filter, query),
          uow.read.users.count(filter, query),
        ])
        return { records: records.map(toUserView), total }
      },
    }),

    getUser: useCase<{ id: string }, UserView>({
      name: 'identity.getUser',
      permission: 'AUTHENTICATED',
      async run(actor, input) {
        const rel = await relationsToUser(actor, input.id)
        // Свой профиль доступен всегда (FR-USER-006), остальные — по user.read.
        if (!rel.has('OWN')) requireScope(actor, 'user.read', rel, 'read')
        const user = await uow.read.users.findById(input.id)
        if (!user) throw DomainError.notFound()
        return toUserView(user)
      },
    }),

    createUser: useCase<
      {
        email: string
        displayName: string
        roles: string[]
        initialMode: 'INVITE' | 'TEMP_PASSWORD'
        tempPassword?: string
      },
      { user: UserView; activationToken: string | null }
    >({
      name: 'identity.createUser',
      permission: 'user.create',
      async run(actor, raw, ctx) {
        const input = parse(
          z.object({
            email: emailSchema,
            displayName: nameSchema,
            roles: z.array(z.string()).min(1, 'Назначьте хотя бы одну роль'),
            initialMode: z.enum(['INVITE', 'TEMP_PASSWORD']).default('INVITE'),
            tempPassword: z.string().optional(),
          }),
          raw,
        )
        if (input.initialMode === 'TEMP_PASSWORD') {
          const errs = validatePassword(input.tempPassword ?? '', input.email)
          if (errs.length) throw DomainError.validation(errs.map((e) => ({ ...e, field: 'tempPassword' })))
        }
        return uow.transaction(async (tx) => {
          if (await tx.users.findByEmail(input.email)) {
            throw DomainError.validation([{ field: 'email', message: 'Пользователь с таким email уже существует' }])
          }
          const roles = await resolveRoles(tx, input.roles)
          const temp = input.initialMode === 'TEMP_PASSWORD'
          const user = await tx.users.insert({
            email: input.email,
            displayName: input.displayName,
            status: temp ? 'ACTIVE' : 'INVITED',
            passwordHash: temp ? await hasher.hash(input.tempPassword!) : null,
            mustChangePassword: temp,
          })
          await tx.users.setRoles(
            user.id,
            roles.map((r) => r.id),
            actor.userId,
          )
          const activationToken = temp ? null : await issueToken(tx, user.id, 'ACTIVATION', actor.userId)
          await tx.audit.record(
            actor,
            {
              action: 'user.created',
              resourceType: 'user',
              resourceId: user.id,
              changes: {
                email: input.email,
                displayName: input.displayName,
                status: user.status,
                roles: roles.map((r) => r.code),
              },
            },
            ctx,
          )
          const fresh = (await tx.users.findById(user.id))!
          return { user: toUserView(fresh), activationToken }
        })
      },
    }),

    updateUser: useCase<{ id: string; email?: string; displayName?: string; revision: number }, UserView>({
      name: 'identity.updateUser',
      permission: 'user.update',
      async run(actor, raw, ctx) {
        const rel = await relationsToUser(actor, raw.id)
        const scope = requireScope(actor, 'user.update', rel)
        const input = parse(
          z.object({
            id: z.string(),
            email: emailSchema.optional(),
            displayName: nameSchema.optional(),
            revision: z.coerce.number().int(),
          }),
          raw,
        )
        // OWN: только безопасные поля (SPEC-USER-001: свой профиль — только displayName)
        if (scope === 'OWN' && input.email !== undefined) {
          const me = await uow.read.users.findById(actor.userId)
          if (me && me.email !== input.email) throw DomainError.forbidden('Email может изменить только администратор')
        }
        return uow.transaction(async (tx) => {
          const before = await tx.users.findById(input.id)
          if (!before) throw DomainError.notFound()
          if (input.email && input.email !== before.email) {
            const other = await tx.users.findByEmail(input.email)
            if (other && other.id !== before.id) {
              throw DomainError.validation([{ field: 'email', message: 'Пользователь с таким email уже существует' }])
            }
          }
          const after = await tx.users.update(
            input.id,
            {
              ...(input.email !== undefined ? { email: input.email } : {}),
              ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
            },
            input.revision,
          )
          await tx.audit.record(
            actor,
            {
              action: 'user.updated',
              resourceType: 'user',
              resourceId: input.id,
              changes: diff(
                { email: before.email, displayName: before.displayName },
                { email: after.email, displayName: after.displayName },
              ),
            },
            ctx,
          )
          return toUserView(after)
        })
      },
    }),

    changeUserStatus: useCase<
      { id: string; action: 'block' | 'unblock' | 'archive' | 'restore'; reason?: string },
      UserView
    >({
      name: 'identity.changeUserStatus',
      permission: 'user.status.manage',
      async run(actor, input, ctx) {
        assertNotSelf(actor.userId, input.id, 'изменять статус')
        const reason = (input.reason ?? '').trim()
        if ((input.action === 'block' || input.action === 'archive') && !reason) {
          throw DomainError.validation([{ field: 'reason', message: 'Укажите причину' }])
        }
        return uow.transaction(async (tx) => {
          const user = await tx.users.findById(input.id)
          if (!user) throw DomainError.notFound()
          const status = nextUserStatus(input.action, user.status)
          const after = await tx.users.update(user.id, { status, statusReason: reason || null })
          if (user.roleCodes.includes('ADMIN') && status !== 'ACTIVE') {
            assertAdminRemains(await tx.users.countActiveAdmins())
          }
          if (status !== 'ACTIVE') await tx.sessions.revokeAllForUser(user.id)
          await tx.audit.record(
            actor,
            {
              action: `user.${input.action}`,
              resourceType: 'user',
              resourceId: user.id,
              changes: diff({ status: user.status }, { status }),
              reason: reason || null,
            },
            ctx,
          )
          return toUserView(after)
        })
      },
    }),

    setUserRoles: useCase<{ id: string; roles: string[] }, UserView>({
      name: 'identity.setUserRoles',
      permission: 'user.role.assign',
      async run(actor, input, ctx) {
        assertNotSelf(actor.userId, input.id, 'изменять роли')
        if (!input.roles?.length)
          throw DomainError.validation([{ field: 'roles', message: 'Назначьте хотя бы одну роль' }])
        return uow.transaction(async (tx) => {
          const user = await tx.users.findById(input.id)
          if (!user) throw DomainError.notFound()
          const roles = await resolveRoles(tx, input.roles)
          await tx.users.setRoles(
            user.id,
            roles.map((r) => r.id),
            actor.userId,
          )
          assertAdminRemains(await tx.users.countActiveAdmins())
          const after = (await tx.users.findById(user.id))!
          await tx.audit.record(
            actor,
            {
              action: 'user.roles.changed',
              resourceType: 'user',
              resourceId: user.id,
              changes: diff({ roles: [...user.roleCodes].sort() }, { roles: [...after.roleCodes].sort() }),
            },
            ctx,
          )
          return toUserView(after)
        })
      },
    }),

    // ---------- SPEC-USER-002: роли ----------
    listRoles: useCase<ListQuery, { records: RoleView[]; total: number }>({
      name: 'identity.listRoles',
      permission: 'role.read',
      async run(_actor, query) {
        const [records, total] = await Promise.all([uow.read.roles.list(query), uow.read.roles.count(query)])
        return { records: records.map(toRoleView), total }
      },
    }),

    getRole: useCase<{ id: string }, RoleView>({
      name: 'identity.getRole',
      permission: 'role.read',
      async run(_actor, input) {
        const role = await uow.read.roles.findById(input.id)
        if (!role) throw DomainError.notFound()
        return toRoleView(role)
      },
    }),

    createRole: useCase<
      { code: string; name: string; description?: string | null; grants: RoleGrantRecord[] },
      RoleView
    >({
      name: 'identity.createRole',
      permission: 'role.manage',
      async run(actor, raw, ctx) {
        const input = parse(
          z.object({
            code: z
              .string()
              .trim()
              .regex(/^[A-Z_]{2,40}$/, 'Код: латинские заглавные буквы и _, 2–40 символов'),
            name: z.string().trim().min(1, 'Обязательное поле').max(100),
            description: z.string().trim().max(500).nullable().optional(),
            grants: z.array(z.object({ key: z.string(), scope: z.string() })).default([]),
          }),
          raw,
        )
        const grants = validateGrants(input.grants)
        return uow.transaction(async (tx) => {
          if ((await tx.roles.findByCodes([input.code])).length) {
            throw DomainError.validation([{ field: 'code', message: 'Роль с таким кодом уже существует' }])
          }
          const role = await tx.roles.insert({
            code: input.code,
            name: input.name,
            description: input.description ?? null,
            isSystem: false,
          })
          await tx.roles.setGrants(role.id, grants)
          await tx.audit.record(
            actor,
            {
              action: 'role.created',
              resourceType: 'role',
              resourceId: role.id,
              changes: { code: input.code, grants: grantStrings(grants) },
            },
            ctx,
          )
          return toRoleView((await tx.roles.findById(role.id))!)
        })
      },
    }),

    updateRole: useCase<
      { id: string; name: string; description?: string | null; grants: RoleGrantRecord[]; revision: number },
      RoleView
    >({
      name: 'identity.updateRole',
      permission: 'role.manage',
      async run(actor, raw, ctx) {
        const input = parse(
          z.object({
            id: z.string(),
            name: z.string().trim().min(1, 'Обязательное поле').max(100),
            description: z.string().trim().max(500).nullable().optional(),
            grants: z.array(z.object({ key: z.string(), scope: z.string() })),
            revision: z.coerce.number().int(),
          }),
          raw,
        )
        const grants = validateGrants(input.grants)
        return uow.transaction(async (tx) => {
          const before = await tx.roles.findById(input.id)
          if (!before) throw DomainError.notFound()
          // BR-015: изменение роли, которую имеет сам пользователь, = изменение собственных прав
          if (actor.roleCodes.includes(before.code)) {
            throw DomainError.rule('BR-015', 'Нельзя изменять состав роли, которая назначена вам самим')
          }
          await tx.roles.update(input.id, { name: input.name, description: input.description ?? null }, input.revision)
          await tx.roles.setGrants(input.id, grants)
          await tx.audit.record(
            actor,
            {
              action: 'role.updated',
              resourceType: 'role',
              resourceId: input.id,
              changes: diff(
                { name: before.name, description: before.description, grants: grantStrings(before.grants) },
                { name: input.name, description: input.description ?? null, grants: grantStrings(grants) },
              ),
            },
            ctx,
          )
          return toRoleView((await tx.roles.findById(input.id))!)
        })
      },
    }),

    deleteRole: useCase<{ id: string }, void>({
      name: 'identity.deleteRole',
      permission: 'role.manage',
      async run(actor, input, ctx) {
        await uow.transaction(async (tx) => {
          const role = await tx.roles.findById(input.id)
          if (!role) throw DomainError.notFound()
          if (role.isSystem) throw DomainError.rule('BR-046', 'Системную роль нельзя удалить')
          if (role.userCount > 0) {
            throw new DomainError('INVALID_STATE', 'Роль назначена пользователям — сначала снимите назначения')
          }
          await tx.roles.delete(role.id)
          await tx.audit.record(
            actor,
            { action: 'role.deleted', resourceType: 'role', resourceId: role.id, changes: { code: role.code } },
            ctx,
          )
        })
      },
    }),

    /** Служебное: actor по id пользователя из сессии. */
    loadActor: (userId: string) => loadActor(uow.read, userId),

    canSeeUser: async (actor: Actor, userId: string) => {
      const rel = await relationsToUser(actor, userId)
      return rel.has('OWN') || scopeAllows(actor, 'user.read', rel)
    },
  }
}

export type IdentityUseCases = ReturnType<typeof createIdentityUseCases>

export interface RoleView {
  id: string
  code: string
  name: string
  description: string | null
  isSystem: boolean
  revision: number
  grants: RoleGrantRecord[]
  userCount: number
}

function toRoleView(r: {
  id: string
  code: string
  name: string
  description: string | null
  isSystem: boolean
  revision: number
  grants: RoleGrantRecord[]
  userCount: number
}): RoleView {
  return { ...r, grants: [...r.grants].sort((a, b) => (a.key + a.scope).localeCompare(b.key + b.scope)) }
}

function grantStrings(grants: RoleGrantRecord[]): string[] {
  return grants.map((g) => `${g.key}:${g.scope}`).sort()
}

/** AC-USER-002.5: ключ из каталога, scope поддерживается permission. */
export function validateGrants(raw: { key: string; scope: string }[]): RoleGrantRecord[] {
  const errors: FieldError[] = []
  const out = new Map<string, RoleGrantRecord>()
  for (const g of raw) {
    const def = permissionDef(g.key)
    if (!def) {
      errors.push({ field: 'grants', message: `Неизвестное permission: ${g.key}` })
      continue
    }
    if (!isScope(g.scope) || !def.scopes.includes(g.scope)) {
      errors.push({ field: 'grants', message: `Scope ${g.scope} не поддерживается для ${g.key}` })
      continue
    }
    out.set(`${g.key}:${g.scope}`, { key: g.key, scope: g.scope })
  }
  if (errors.length) throw DomainError.validation(errors)
  return [...out.values()]
}
