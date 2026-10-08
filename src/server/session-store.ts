import session from 'express-session'
import type { Db } from '../infrastructure/db/kysely.js'

/** Серверное хранилище сессий в PostgreSQL (ADR-006 п.3): отзыв по пользователю, учет IP/UA. */
export class PgSessionStore extends session.Store {
  constructor(
    private readonly db: Db,
    private readonly idleMs: number,
  ) {
    super()
  }

  override get(sid: string, cb: (err: unknown, s?: session.SessionData | null) => void): void {
    this.db
      .selectFrom('sessions')
      .select(['data', 'expires_at', 'revoked_at'])
      .where('sid', '=', sid)
      .executeTakeFirst()
      .then((r) => {
        if (!r || r.revoked_at || new Date(r.expires_at) <= new Date()) return cb(null, null)
        cb(null, r.data as unknown as session.SessionData)
      })
      .catch((e) => cb(e))
  }

  override set(sid: string, sess: session.SessionData, cb?: (err?: unknown) => void): void {
    const data = sess as unknown as Record<string, any>
    const expires = sess.cookie?.expires ? new Date(sess.cookie.expires) : new Date(Date.now() + this.idleMs)
    const userId = data.adminUser?.id ?? null
    this.db
      .insertInto('sessions')
      .values({
        sid,
        user_id: userId,
        data: JSON.stringify(sess),
        expires_at: expires,
        ip: data.meta?.ip ?? null,
        user_agent: data.meta?.userAgent ?? null,
      })
      .onConflict((oc) =>
        oc
          .column('sid')
          .doUpdateSet({ data: JSON.stringify(sess), expires_at: expires, user_id: userId, last_seen_at: new Date() }),
      )
      .execute()
      .then(() => cb?.())
      .catch((e) => cb?.(e))
  }

  override destroy(sid: string, cb?: (err?: unknown) => void): void {
    this.db
      .updateTable('sessions')
      .set({ revoked_at: new Date() })
      .where('sid', '=', sid)
      .execute()
      .then(() => cb?.())
      .catch((e) => cb?.(e))
  }

  override touch(sid: string, sess: session.SessionData, cb?: (err?: unknown) => void): void {
    const expires = sess.cookie?.expires ? new Date(sess.cookie.expires) : new Date(Date.now() + this.idleMs)
    this.db
      .updateTable('sessions')
      .set({ expires_at: expires, last_seen_at: new Date() })
      .where('sid', '=', sid)
      .where('revoked_at', 'is', null)
      .execute()
      .then(() => cb?.())
      .catch((e) => cb?.(e))
  }
}
