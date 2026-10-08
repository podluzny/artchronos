import { sql } from 'kysely'
import { createDb, type Db } from '../../src/infrastructure/db/kysely.js'
import { migrateToLatest } from '../../src/infrastructure/db/migrator.js'
import { seedCatalog } from '../../src/infrastructure/db/seed.js'

export function testDbUrl(): string {
  return process.env.TEST_DATABASE_URL ?? 'postgresql://artchronos:artchronos@localhost:5432/artchronos_test'
}

/** Пересоздает схему: каждый тестовый файл начинает с чистой БД (каталог прав и системные роли засеяны). */
export async function freshDb(): Promise<Db> {
  const db = createDb(testDbUrl(), { max: 5 })
  await sql`DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;`.execute(db)
  await migrateToLatest(db)
  await seedCatalog(db)
  return db
}
