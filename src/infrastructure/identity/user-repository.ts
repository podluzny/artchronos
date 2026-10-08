import { sql, type Expression, type SqlBool } from 'kysely'
import type { ScopeFilter } from '../../domain/authorization/actor.js'
import { DomainError } from '../../domain/shared/errors.js'
import type { UserPatch, UserRecord, UserRepository } from '../../application/identity/ports.js'
import type { ListQuery } from '../../application/shared/query.js'
import type { Db } from '../db/kysely.js'
import type { UserRow } from '../db/schema.js'

const SORTABLE: Record<string, string> = {
  email: 'users.email',
  displayName: 'users.display_name',
  status: 'users.status',
  createdAt: 'users.created_at',
  lastLoginAt: 'users.last_login_at',
}

function toRecord(r: UserRow & { role_codes: string[] | null }): UserRecord {
  return {
    id: r.id,
    email: r.email,
    displayName: r.display_name,
    passwordHash: r.password_hash,
    status: r.status,
    failedLoginCount: r.failed_login_count,
    lockedUntil: r.locked_until,
    lastLoginAt: r.last_login_at,
    passwordChangedAt: r.password_changed_at,
    mustChangePassword: r.must_change_password,
    statusReason: r.status_reason,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    revision: r.revision,
    roleCodes: (r.role_codes ?? []).filter(Boolean).sort(),
  }
}

export class KyselyUserRepository implements UserRepository {
  constructor(private readonly db: Db) {}

  private base() {
    return this.db
      .selectFrom('users')
      .selectAll('users')
      .select(
        sql<
          string[]
        >`coalesce((select array_agg(r.code order by r.code) from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = users.id), '{}')`.as(
          'role_codes',
        ),
      )
  }

  async findById(id: string) {
    if (!isUuid(id)) return null
    const r = await this.base().where('users.id', '=', id).executeTakeFirst()
    return r ? toRecord(r) : null
  }

  async findByEmail(email: string) {
    const r = await this.base()
      .where(sql<string>`lower(users.email)`, '=', email.toLowerCase())
      .executeTakeFirst()
    return r ? toRecord(r) : null
  }

  private filtered(filter: ScopeFilter, query: ListQuery) {
    return this.base().where((eb) => {
      const conds: Expression<SqlBool>[] = []
      if (filter.kind === 'SCOPED') {
        // COURSE: студенты групп курсов, где актор — преподаватель (SPEC-USER-001).
        conds.push(filter.scopes.has('COURSE') ? inTeacherCourses(filter.userId) : sql<SqlBool>`false`)
      }
      const f = query.filters
      if (f.status) conds.push(eb('users.status', '=', f.status as UserRow['status']))
      if (f.email) conds.push(eb('users.email', 'ilike', `%${escapeLike(f.email)}%`))
      if (f.displayName) conds.push(eb('users.display_name', 'ilike', `%${escapeLike(f.displayName)}%`))
      if (f.role) {
        conds.push(
          sql<SqlBool>`exists (select 1 from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = users.id and r.code = ${f.role})`,
        )
      }
      return eb.and(conds)
    })
  }

  async list(filter: ScopeFilter, query: ListQuery) {
    const col = SORTABLE[query.sortBy ?? ''] ?? 'users.created_at'
    const rows = await this.filtered(filter, query)
      .orderBy(sql.ref(col), query.direction === 'asc' ? 'asc' : 'desc')
      .orderBy('users.id')
      .limit(query.limit)
      .offset(query.offset)
      .execute()
    return rows.map(toRecord)
  }

  async count(filter: ScopeFilter, query: ListQuery) {
    const r = await this.db
      .selectFrom(this.filtered(filter, query).as('t'))
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .executeTakeFirstOrThrow()
    return Number(r.n)
  }

  async inActorCourses(actorId: string, userId: string) {
    if (!isUuid(userId)) return false
    const r = await this.db
      .selectFrom('users')
      .select('users.id')
      .where('users.id', '=', userId)
      .where(inTeacherCourses(actorId))
      .executeTakeFirst()
    return !!r
  }

  async insert(data: Parameters<UserRepository['insert']>[0]) {
    const r = await this.db
      .insertInto('users')
      .values({
        email: data.email,
        display_name: data.displayName,
        status: data.status,
        password_hash: data.passwordHash,
        must_change_password: data.mustChangePassword,
        password_changed_at: data.passwordHash ? new Date() : null,
      })
      .returning('id')
      .executeTakeFirstOrThrow()
    return (await this.findById(r.id))!
  }

  async update(id: string, patch: UserPatch, expectedRevision?: number) {
    const values: Record<string, unknown> = {}
    const map: Record<keyof UserPatch, string> = {
      email: 'email',
      displayName: 'display_name',
      passwordHash: 'password_hash',
      status: 'status',
      failedLoginCount: 'failed_login_count',
      lockedUntil: 'locked_until',
      lastLoginAt: 'last_login_at',
      passwordChangedAt: 'password_changed_at',
      mustChangePassword: 'must_change_password',
      statusReason: 'status_reason',
    }
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) values[map[k as keyof UserPatch]] = v
    const loginOnly = Object.keys(patch).every((k) => ['failedLoginCount', 'lockedUntil', 'lastLoginAt'].includes(k))
    let q = this.db
      .updateTable('users')
      .set({
        ...values,
        ...(loginOnly ? {} : { updated_at: new Date(), revision: sql<number>`revision + 1` }),
      } as any)
      .where('id', '=', id)
    if (expectedRevision !== undefined) q = q.where('revision', '=', expectedRevision)
    const res = await q.executeTakeFirst()
    if (Number(res.numUpdatedRows) === 0) {
      if (expectedRevision !== undefined && (await this.findById(id))) throw DomainError.conflict()
      throw DomainError.notFound()
    }
    return (await this.findById(id))!
  }

  async setRoles(userId: string, roleIds: string[], grantedBy: string | null) {
    const current = await this.db.selectFrom('user_roles').select('role_id').where('user_id', '=', userId).execute()
    const cur = new Set(current.map((r) => r.role_id))
    const next = new Set(roleIds)
    const toDelete = [...cur].filter((id) => !next.has(id))
    const toAdd = [...next].filter((id) => !cur.has(id))
    if (toDelete.length) {
      await this.db.deleteFrom('user_roles').where('user_id', '=', userId).where('role_id', 'in', toDelete).execute()
    }
    if (toAdd.length) {
      await this.db
        .insertInto('user_roles')
        .values(toAdd.map((role_id) => ({ user_id: userId, role_id, granted_by: grantedBy })))
        .execute()
    }
    if (toDelete.length || toAdd.length) {
      await this.db
        .updateTable('users')
        .set({ updated_at: new Date(), revision: sql<number>`revision + 1` })
        .where('id', '=', userId)
        .execute()
    }
  }

  async countActiveAdmins() {
    const r = await this.db
      .selectFrom('users')
      .innerJoin('user_roles', 'user_roles.user_id', 'users.id')
      .innerJoin('roles', 'roles.id', 'user_roles.role_id')
      .where('roles.code', '=', 'ADMIN')
      .where('users.status', '=', 'ACTIVE')
      .select((eb) => eb.fn.count<string>('users.id').distinct().as('n'))
      .executeTakeFirstOrThrow()
    return Number(r.n)
  }
}

/** Пользователь — член группы курса, который ведет преподаватель teacherId. */
function inTeacherCourses(teacherId: string) {
  return sql<SqlBool>`exists (select 1 from group_memberships gm join student_groups g on g.id = gm.group_id
    join course_teachers ct on ct.course_id = g.course_id where gm.user_id = users.id and ct.user_id = ${teacherId})`
}

export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => '\\' + m)
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function isUuid(s: string): boolean {
  return UUID_RE.test(s)
}
