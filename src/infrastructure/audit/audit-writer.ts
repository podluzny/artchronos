import type { Actor } from '../../domain/authorization/actor.js'
import type { AuditEntry, AuditWriter } from '../../application/shared/audit.js'
import type { RequestContext } from '../../application/shared/context.js'
import type { Db } from '../db/kysely.js'

/** Пишет в audit_log через соединение текущей транзакции: при ошибке откатывается вся операция (NFR-AUDIT-005). */
export class KyselyAuditWriter implements AuditWriter {
  constructor(private readonly db: Db) {}

  async record(actor: Actor | null, entry: AuditEntry, ctx: RequestContext, actorIdOverride?: string | null) {
    await this.db
      .insertInto('audit_log')
      .values({
        actor_id: actorIdOverride !== undefined ? actorIdOverride : (actor?.userId ?? null),
        actor_roles: actor ? [...actor.roleCodes] : [],
        action: entry.action,
        resource_type: entry.resourceType,
        resource_id: entry.resourceId ?? null,
        changes: entry.changes ? JSON.stringify(entry.changes) : null,
        reason: entry.reason ?? null,
        request_id: ctx.requestId,
        ip: ctx.ip,
        user_agent: ctx.userAgent ? ctx.userAgent.slice(0, 500) : null,
      })
      .execute()
  }
}
