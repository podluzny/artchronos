import type { Actor } from '../../domain/authorization/actor.js'
import type { RequestContext } from './context.js'

export interface AuditEntry {
  action: string
  resourceType: string
  resourceId?: string | null
  changes?: Record<string, unknown> | null
  reason?: string | null
}

/** Пишет запись аудита в текущей транзакции (BR-035). */
export interface AuditWriter {
  record(actor: Actor | null, entry: AuditEntry, ctx: RequestContext, actorIdOverride?: string | null): Promise<void>
}

const SECRET_FIELDS = new Set(['password', 'passwordHash', 'password_hash', 'token', 'tokenHash', 'token_hash'])

/** Дифф измененных полей с маскированием секретов (AC-AUDIT-001.5). */
export function diff(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  fields?: string[],
): Record<string, { from: unknown; to: unknown }> {
  const keys = fields ?? [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])]
  const out: Record<string, { from: unknown; to: unknown }> = {}
  for (const k of keys) {
    const a = before?.[k]
    const b = after?.[k]
    if (JSON.stringify(a) === JSON.stringify(b)) continue
    out[k] = SECRET_FIELDS.has(k) ? { from: '***', to: '***' } : { from: a ?? null, to: b ?? null }
  }
  return out
}
