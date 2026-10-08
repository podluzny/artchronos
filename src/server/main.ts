import { createDb } from '../infrastructure/db/kysely.js'
import { migrateToLatest } from '../infrastructure/db/migrator.js'
import { bootstrapAdmin, seedCatalog } from '../infrastructure/db/seed.js'
import { Argon2Hasher } from '../infrastructure/security/crypto.js'
import { createApp } from './app.js'
import { configFromEnv } from './config.js'

const config = configFromEnv()
const db = createDb(config.databaseUrl)
await migrateToLatest(db)
await seedCatalog(db)
const boot = await bootstrapAdmin(db, new Argon2Hasher(), process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD)
if (boot === 'skipped') console.warn('Администраторов нет: задайте ADMIN_EMAIL и ADMIN_PASSWORD')
const { app } = await createApp(db, config)
const port = Number(process.env.PORT ?? 3000)
app.listen(port, () => console.log(`ArtChronos: http://localhost:${port}/admin`))
