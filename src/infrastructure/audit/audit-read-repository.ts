import { sql } from 'kysely'
import type { AuditReadRepository, AuditRecordView } from '../../application/audit/use-cases.js'
import type { ListQuery } from '../../application/shared/query.js'
import type { Db } from '../db/kysely.js'
import { escapeLike, isUuid } from '../identity/user-repository.js'

export class KyselyAuditReadRepository implements AuditReadRepository {
  constructor(private readonly db: Db) {}

  private filtered(query: ListQuery) {
    const f = query.filters
    let q = this.db
      .selectFrom('audit_log')
      .leftJoin('users', 'users.id', 'audit_log.actor_id')
      .selectAll('audit_log')
      .select('users.email as actor_email')
    if (f.actorId && isUuid(f.actorId)) q = q.where('audit_log.actor_id', '=', f.actorId)
    if (f.actorEmail) q = q.where('users.email', 'ilike', `%${escapeLike(f.actorEmail)}%`)
    if (f.action) q = q.where('audit_log.action', 'ilike', `${escapeLike(f.action)}%`)
    if (f.resourceType) q = q.where('audit_log.resource_type', '=', f.resourceType)
    if (f.resourceId) q = q.where('audit_log.resource_id', '=', f.resourceId)
    if (f.occurredAtFrom) q = q.where('audit_log.occurred_at', '>=', new Date(f.occurredAtFrom))
    if (f.occurredAtTo) q = q.where('audit_log.occurred_at', '<=', new Date(f.occurredAtTo))
    return q
  }

  private toView(r: any): AuditRecordView {
    return {
      id: String(r.id),
      occurredAt: r.occurred_at,
      actorId: r.actor_id,
      actorEmail: r.actor_email ?? null,
      actorRoles: r.actor_roles ?? [],
      action: r.action,
      resourceType: r.resource_type,
      resourceId: r.resource_id,
      changes: r.changes,
      reason: r.reason,
      requestId: r.request_id,
      ip: r.ip,
    }
  }

  async list(query: ListQuery) {
    const rows = await this.filtered(query)
      .orderBy('audit_log.occurred_at', query.direction === 'asc' ? 'asc' : 'desc')
      .orderBy(sql`audit_log.id`, 'desc')
      .limit(query.limit)
      .offset(query.offset)
      .execute()
    return rows.map((r) => this.toView(r))
  }

  async count(query: ListQuery) {
    const r = await this.db
      .selectFrom(this.filtered(query).as('t'))
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .executeTakeFirstOrThrow()
    return Number(r.n)
  }

  async findById(id: string) {
    if (!/^\d+$/.test(id)) return null
    const r = await this.filtered({ filters: {}, limit: 1, offset: 0 })
      .where('audit_log.id', '=', id)
      .executeTakeFirst()
    return r ? this.toView(r) : null
  }
}
