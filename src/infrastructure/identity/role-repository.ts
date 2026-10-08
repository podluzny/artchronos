import { sql } from 'kysely'
import { DomainError } from '../../domain/shared/errors.js'
import type { Scope } from '../../domain/authorization/scope.js'
import type { RoleGrantRecord, RoleRecord, RoleRepository } from '../../application/identity/ports.js'
import type { ListQuery } from '../../application/shared/query.js'
import type { Db } from '../db/kysely.js'
import { escapeLike, isUuid } from './user-repository.js'

export class KyselyRoleRepository implements RoleRepository {
  constructor(private readonly db: Db) {}

  private base() {
    return this.db
      .selectFrom('roles')
      .selectAll('roles')
      .select([
        sql<
          { key: string; scope: Scope }[]
        >`coalesce((select json_agg(json_build_object('key', rp.permission_key, 'scope', rp.scope) order by rp.permission_key, rp.scope) from role_permissions rp where rp.role_id = roles.id), '[]'::json)`.as(
          'grants',
        ),
        sql<string>`(select count(*) from user_roles ur where ur.role_id = roles.id)`.as('user_count'),
      ])
  }

  private toRecord(r: any): RoleRecord {
    return {
      id: r.id,
      code: r.code,
      name: r.name,
      description: r.description,
      isSystem: r.is_system,
      revision: r.revision,
      grants: r.grants,
      userCount: Number(r.user_count),
    }
  }

  private filtered(query: ListQuery) {
    let q = this.base()
    if (query.filters.code) q = q.where('roles.code', 'ilike', `%${escapeLike(query.filters.code)}%`)
    if (query.filters.name) q = q.where('roles.name', 'ilike', `%${escapeLike(query.filters.name)}%`)
    return q
  }

  async list(query: ListQuery) {
    const rows = await this.filtered(query)
      .orderBy('roles.is_system', 'desc')
      .orderBy('roles.code')
      .limit(query.limit)
      .offset(query.offset)
      .execute()
    return rows.map((r) => this.toRecord(r))
  }

  async count(query: ListQuery) {
    const r = await this.db
      .selectFrom(this.filtered(query).as('t'))
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .executeTakeFirstOrThrow()
    return Number(r.n)
  }

  async findById(id: string) {
    if (!isUuid(id)) return null
    const r = await this.base().where('roles.id', '=', id).executeTakeFirst()
    return r ? this.toRecord(r) : null
  }

  async findByCodes(codes: string[]) {
    if (!codes.length) return []
    const rows = await this.base().where('roles.code', 'in', codes).execute()
    return rows.map((r) => this.toRecord(r))
  }

  async insert(data: { code: string; name: string; description: string | null; isSystem: boolean }) {
    const r = await this.db
      .insertInto('roles')
      .values({ code: data.code, name: data.name, description: data.description, is_system: data.isSystem })
      .returning('id')
      .executeTakeFirstOrThrow()
    return (await this.findById(r.id))!
  }

  async update(id: string, data: { name: string; description: string | null }, expectedRevision: number) {
    const res = await this.db
      .updateTable('roles')
      .set({
        name: data.name,
        description: data.description,
        updated_at: new Date(),
        revision: sql<number>`revision + 1`,
      })
      .where('id', '=', id)
      .where('revision', '=', expectedRevision)
      .executeTakeFirst()
    if (Number(res.numUpdatedRows) === 0)
      throw (await this.findById(id)) ? DomainError.conflict() : DomainError.notFound()
  }

  async setGrants(roleId: string, grants: RoleGrantRecord[]) {
    await this.db.deleteFrom('role_permissions').where('role_id', '=', roleId).execute()
    if (grants.length) {
      await this.db
        .insertInto('role_permissions')
        .values(grants.map((g) => ({ role_id: roleId, permission_key: g.key, scope: g.scope })))
        .execute()
    }
  }

  async delete(id: string) {
    await this.db.deleteFrom('roles').where('id', '=', id).execute()
  }

  async actorGrants(userId: string) {
    const roles = await this.db
      .selectFrom('user_roles')
      .innerJoin('roles', 'roles.id', 'user_roles.role_id')
      .select('roles.code')
      .where('user_roles.user_id', '=', userId)
      .execute()
    const grants = await this.db
      .selectFrom('user_roles')
      .innerJoin('role_permissions', 'role_permissions.role_id', 'user_roles.role_id')
      .select(['role_permissions.permission_key as key', 'role_permissions.scope as scope'])
      .where('user_roles.user_id', '=', userId)
      .distinct()
      .execute()
    return { roleCodes: roles.map((r) => r.code).sort(), grants: grants as RoleGrantRecord[] }
  }
}
