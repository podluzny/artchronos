/** Сервер для E2E: чистая тестовая БД + первый администратор. */
import { sql } from 'kysely'
import { createDb } from '../../src/infrastructure/db/kysely.js'
import { migrateToLatest } from '../../src/infrastructure/db/migrator.js'
import { bootstrapAdmin, seedCatalog } from '../../src/infrastructure/db/seed.js'
import { Argon2Hasher } from '../../src/infrastructure/security/crypto.js'
import { createApp } from '../../src/server/app.js'

const url = process.env.TEST_DATABASE_URL ?? 'postgresql://artchronos:artchronos@localhost:5432/artchronos_test'
const db = createDb(url)
await sql`DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;`.execute(db)
await migrateToLatest(db)
await seedCatalog(db)
await bootstrapAdmin(db, new Argon2Hasher(), 'admin@e2e.local', 'E2E-Admin-Password-1')
const { app } = await createApp(db, {
  databaseUrl: url,
  sessionSecret: 'e2e-session-secret-0123456789abcdef-xyz',
  production: false,
  idleTimeoutMs: 30 * 60_000,
  absoluteTimeoutMs: 12 * 3600_000,
})
const port = Number(process.env.PORT ?? 3300)
app.listen(port, () => console.log(`e2e server on ${port}`))
