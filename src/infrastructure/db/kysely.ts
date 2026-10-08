import { Kysely, PostgresDialect } from 'kysely'
import pg from 'pg'
import type { Database } from './schema.js'

// bigint/bigserial (audit_log.id) отдаем строкой, numeric — числом.
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)))

export type Db = Kysely<Database>

export function createDb(connectionString: string, opts: { max?: number } = {}): Db {
  const pool = new pg.Pool({ connectionString, max: opts.max ?? 10 })
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) })
}
