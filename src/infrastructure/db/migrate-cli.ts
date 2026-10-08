import { createDb } from './kysely.js'
import { migrateToLatest } from './migrator.js'

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL не задан')
  process.exit(1)
}
const db = createDb(url, { max: 1 })
try {
  const applied = await migrateToLatest(db)
  console.log(applied.length ? `Применены миграции: ${applied.join(', ')}` : 'Миграции актуальны')
} finally {
  await db.destroy()
}
