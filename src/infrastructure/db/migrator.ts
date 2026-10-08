import type { Kysely } from 'kysely'
import { Migrator } from 'kysely/migration'
import { migrations } from './migrations/index.js'

export async function migrateToLatest(db: Kysely<any>): Promise<string[]> {
  const migrator = new Migrator({ db, provider: { getMigrations: async () => migrations } })
  const { error, results } = await migrator.migrateToLatest()
  const applied = (results ?? []).filter((r) => r.status === 'Success').map((r) => r.migrationName)
  const failed = (results ?? []).find((r) => r.status === 'Error')
  if (error || failed) {
    throw new Error(`Миграция не выполнена${failed ? `: ${failed.migrationName}` : ''}: ${String(error)}`)
  }
  return applied
}
