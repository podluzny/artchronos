/** Отдельная БД для нагрузочных тестов: не пересекается с тестовой БД unit/E2E. */
import pg from 'pg'

export default async function setup() {
  const base = process.env.TEST_DATABASE_URL ?? 'postgresql://artchronos:artchronos@localhost:5432/artchronos_test'
  const url = process.env.PERF_DATABASE_URL ?? base.replace(/\/[^/]+$/, '/artchronos_perf')
  const admin = new pg.Client({ connectionString: base })
  await admin.connect()
  const name = new URL(url).pathname.slice(1)
  const exists = await admin.query('select 1 from pg_database where datname = $1', [name])
  if (!exists.rowCount) await admin.query(`create database "${name.replace(/"/g, '')}"`)
  await admin.end()
  process.env.TEST_DATABASE_URL = url
}
