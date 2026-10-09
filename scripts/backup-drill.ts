/**
 * Учение по резервному копированию и восстановлению (T-084, NFR-DATA-006).
 *
 *   SOURCE_DATABASE_URL=postgres://… npx tsx scripts/backup-drill.ts [--keep]
 *
 * 1. pg_dump (custom format) исходной БД — включая media_blobs, если медиа хранятся в БД (тестовый стенд).
 * 2. Восстановление в отдельную БД `<имя>_restore_drill` (pg_restore --no-owner).
 * 3. Проверка: совпадение числа строк ключевых таблиц, целостность неизменяемого контента (contentHash
 *    утвержденных версий пересчитывается из восстановленных данных), наличие файла для каждого медиа,
 *    неизменность журнала аудита. Итог — JSON-отчет; код выхода 1 при расхождениях.
 * Файл дампа содержит персональные данные: он создается во временном каталоге и удаляется (кроме --keep).
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { sql } from 'kysely'
import { contentHashOf } from '../src/application/itembank/item-use-cases.js'
import { testContentHash } from '../src/application/assessment/test-use-cases.js'
import { KyselyTestRepository } from '../src/infrastructure/assessment/test-repository.js'
import { createDb, type Db } from '../src/infrastructure/db/kysely.js'
import { KyselyItemRepository } from '../src/infrastructure/itembank/item-repository.js'

const source = process.env.SOURCE_DATABASE_URL ?? process.env.DATABASE_URL
if (!source) {
  console.error('Задайте SOURCE_DATABASE_URL (или DATABASE_URL)')
  process.exit(2)
}
const keep = process.argv.includes('--keep')
const srcUrl = new URL(source)
const targetName = `${srcUrl.pathname.slice(1)}_restore_drill`
const targetUrl = new URL(source)
targetUrl.pathname = `/${targetName}`
const adminUrl = new URL(source)
adminUrl.pathname = '/postgres'

const TABLES = [
  'users',
  'roles',
  'user_roles',
  'audit_log',
  'courses',
  'assignments',
  'media_assets',
  'media_blobs',
  'items',
  'item_versions',
  'item_options',
  'tests',
  'test_versions',
  'test_section_items',
  'selection_pool_entries',
  'reviews',
  'content_issues',
  'attempts',
  'results',
]

async function counts(db: Db) {
  const out: Record<string, number> = {}
  for (const t of TABLES)
    out[t] = Number((await sql<{ n: string }>`select count(*) as n from ${sql.table(t)}`.execute(db)).rows[0]!.n)
  return out
}

async function auditFingerprint(db: Db) {
  const r = await sql<{ n: string; max: string | null; h: string | null }>`
    select count(*) as n, max(id)::text as max, md5(string_agg(id::text || action || coalesce(resource_id::text, ''), ',' order by id)) as h
    from audit_log`.execute(db)
  return r.rows[0]!
}

async function verifyIntegrity(db: Db) {
  const problems: string[] = []
  const items = new KyselyItemRepository(db)
  const frozenItems = await sql<{ id: string; content_hash: string }>`
    select id, content_hash from item_versions where state <> 'DRAFT' and content_hash is not null`.execute(db)
  for (const r of frozenItems.rows) {
    const v = (await items.findVersion(r.id))!
    if (contentHashOf(v.document, v.meta, v.questionTypeVersionId) !== r.content_hash)
      problems.push(`item_version ${r.id}: contentHash`)
  }
  const tests = new KyselyTestRepository(db)
  const frozenTests = await sql<{ id: string; content_hash: string }>`
    select id, content_hash from test_versions where state <> 'DRAFT' and content_hash is not null`.execute(db)
  for (const r of frozenTests.rows) {
    const v = (await tests.findVersion(r.id))!
    if (testContentHash(v, await tests.structure(v.id)) !== r.content_hash)
      problems.push(`test_version ${r.id}: contentHash`)
  }
  // каждое медиа имеет байты: в БД (драйвер db) или в каталоге (драйвер local — каталог копируется отдельно)
  const missing = await sql<{ n: string }>`select count(*) as n from media_assets m
    where not exists (select 1 from media_blobs b where b.storage_key = m.storage_key)`.execute(db)
  const blobs = Number((await sql<{ n: string }>`select count(*) as n from media_blobs`.execute(db)).rows[0]!.n)
  return {
    problems,
    frozenItems: frozenItems.rows.length,
    frozenTests: frozenTests.rows.length,
    mediaWithoutBlob: Number(missing.rows[0]!.n),
    blobs,
  }
}

const dir = mkdtempSync(path.join(tmpdir(), 'artchronos-drill-'))
const dump = path.join(dir, 'backup.dump')
const report: Record<string, unknown> = { source: `${srcUrl.host}${srcUrl.pathname}`, target: targetName }
const src = createDb(source, { max: 2 })
let tgt: Db | null = null
try {
  const before = await counts(src)
  const auditBefore = await auditFingerprint(src)
  let t = Date.now()
  execFileSync('pg_dump', ['--format=custom', '--no-owner', '--no-privileges', '--file', dump, source], {
    stdio: 'inherit',
  })
  report.dumpMs = Date.now() - t
  report.dumpBytes = statSync(dump).size
  t = Date.now()
  execFileSync(
    'psql',
    [
      adminUrl.toString(),
      '-q',
      '-c',
      `DROP DATABASE IF EXISTS "${targetName}"`,
      '-c',
      `CREATE DATABASE "${targetName}"`,
    ],
    {
      stdio: 'inherit',
    },
  )
  execFileSync(
    'pg_restore',
    ['--no-owner', '--no-privileges', '--exit-on-error', '--dbname', targetUrl.toString(), dump],
    { stdio: 'inherit' },
  )
  report.restoreMs = Date.now() - t
  tgt = createDb(targetUrl.toString(), { max: 2 })
  const after = await counts(tgt)
  const diff = TABLES.filter((x) => before[x] !== after[x]).map((x) => `${x}: ${before[x]} → ${after[x]}`)
  const auditAfter = await auditFingerprint(tgt)
  const integrity = await verifyIntegrity(tgt)
  report.rows = after
  report.countMismatches = diff
  report.auditUnchanged = JSON.stringify(auditBefore) === JSON.stringify(auditAfter)
  report.integrity = integrity
  const ok = diff.length === 0 && report.auditUnchanged && integrity.problems.length === 0
  report.result = ok ? 'OK' : 'FAILED'
  console.log(JSON.stringify(report, null, 2))
  process.exitCode = ok ? 0 : 1
} finally {
  await src.destroy()
  if (tgt) await tgt.destroy()
  if (!keep) {
    rmSync(dir, { recursive: true, force: true })
    execFileSync('psql', [adminUrl.toString(), '-q', '-c', `DROP DATABASE IF EXISTS "${targetName}"`], {
      stdio: 'inherit',
    })
  } else console.log(`Дамп сохранен: ${dump}; восстановленная БД: ${targetName}`)
}
