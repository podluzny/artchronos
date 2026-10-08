/** Проверяет доступность тестовой БД до запуска тестов. */
import pg from 'pg'

export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? 'postgresql://artchronos:artchronos@localhost:5432/artchronos_test'
  process.env.TEST_DATABASE_URL = url
  const client = new pg.Client({ connectionString: url })
  try {
    await client.connect()
  } catch (e) {
    throw new Error(`Тестовая БД недоступна (${url})`, { cause: e })
  } finally {
    await client.end().catch(() => undefined)
  }
}
