import { Argon2Hasher } from '../security/crypto.js'
import { createDb } from './kysely.js'
import { bootstrapAdmin, seedCatalog } from './seed.js'

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL не задан')
  process.exit(1)
}
const db = createDb(url, { max: 1 })
try {
  await seedCatalog(db)
  const r = await bootstrapAdmin(db, new Argon2Hasher(), process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD)
  console.log(
    {
      created: 'Создан первый администратор',
      exists: 'Администратор уже есть',
      skipped: 'Администраторов нет: задайте ADMIN_EMAIL и ADMIN_PASSWORD и повторите',
    }[r],
  )
} catch (e) {
  // причина — последней строкой лога сборки, без значений секретов
  const msg = e instanceof Error ? e.message : String(e)
  console.error(`\nSEED: ошибка — ${msg.replace(/postgres(ql)?:\/\/\S+/gi, '[url]')}`)
  if (/ADMIN_PASSWORD/.test(msg))
    console.error(
      'SEED: задайте в Vercel ADMIN_PASSWORD по политике (≥ 12 символов, не простой, не равен email) и сделайте Redeploy',
    )
  process.exitCode = 1
} finally {
  await db.destroy()
}
