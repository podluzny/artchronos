import type { PasswordTokenRepository, SessionRepository } from '../../application/identity/ports.js'
import type { Db } from '../db/kysely.js'

export class KyselySessionRepository implements SessionRepository {
  constructor(private readonly db: Db) {}

  async revokeAllForUser(userId: string, exceptSid?: string | null) {
    let q = this.db
      .updateTable('sessions')
      .set({ revoked_at: new Date() })
      .where('user_id', '=', userId)
      .where('revoked_at', 'is', null)
    if (exceptSid) q = q.where('sid', '!=', exceptSid)
    const r = await q.executeTakeFirst()
    return Number(r.numUpdatedRows)
  }
}

export class KyselyPasswordTokenRepository implements PasswordTokenRepository {
  constructor(private readonly db: Db) {}

  async insert(data: Parameters<PasswordTokenRepository['insert']>[0]) {
    await this.db
      .insertInto('password_tokens')
      .values({
        user_id: data.userId,
        purpose: data.purpose,
        token_hash: data.tokenHash,
        expires_at: data.expiresAt,
        created_by: data.createdBy,
      })
      .execute()
  }

  async findByHash(tokenHash: string) {
    const r = await this.db
      .selectFrom('password_tokens')
      .selectAll()
      .where('token_hash', '=', tokenHash)
      .executeTakeFirst()
    return r
      ? { id: r.id, userId: r.user_id, purpose: r.purpose, expiresAt: new Date(r.expires_at), usedAt: r.used_at }
      : null
  }

  async markUsed(id: string, at: Date) {
    await this.db.updateTable('password_tokens').set({ used_at: at }).where('id', '=', id).execute()
  }

  async invalidateForUser(userId: string, at: Date) {
    await this.db
      .updateTable('password_tokens')
      .set({ used_at: at })
      .where('user_id', '=', userId)
      .where('used_at', 'is', null)
      .execute()
  }
}
