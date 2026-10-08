import { sql } from 'kysely'
import type { Db } from '../../src/infrastructure/db/kysely.js'

/** Допустимые переходы (lifecycle-state-machine §3) — те же, что проверяет триггер БД. */
const EDGES: Record<string, string[]> = {
  DRAFT: ['READY_FOR_REVIEW', 'ARCHIVED'],
  READY_FOR_REVIEW: ['IN_REVIEW', 'DRAFT', 'ARCHIVED'],
  IN_REVIEW: ['APPROVED', 'CHANGES_REQUESTED'],
  CHANGES_REQUESTED: ['ARCHIVED'],
  APPROVED: ['PUBLISHED', 'ARCHIVED'],
  PUBLISHED: ['ARCHIVED'],
  ARCHIVED: [],
}

function path(from: string, to: string): string[] {
  const prev = new Map<string, string>([[from, '']])
  const queue = [from]
  while (queue.length) {
    const s = queue.shift()!
    if (s === to) break
    for (const n of EDGES[s] ?? []) {
      if (!prev.has(n)) {
        prev.set(n, s)
        queue.push(n)
      }
    }
  }
  if (!prev.has(to)) throw new Error(`Нет пути ${from} → ${to}`)
  const out: string[] = []
  for (let s = to; s !== from; s = prev.get(s)!) out.unshift(s)
  return out
}

/**
 * Имитация решений workflow в тестах, которые проверяют не сам workflow: версия проводится по допустимым
 * переходам (триггер BR-013 запрещает «прыжки»).
 */
export async function walkState(db: Db, table: 'item_versions' | 'test_versions', id: string, target: string) {
  const cur = await sql<{ state: string }>`select state from ${sql.table(table)} where id = ${id}`.execute(db)
  for (const s of path(cur.rows[0]!.state, target)) {
    if (table === 'item_versions')
      await sql`update item_versions set state = ${s}, ever_submitted = (ever_submitted or ${s} <> 'DRAFT') where id = ${id}`.execute(
        db,
      )
    else
      await sql`update test_versions set state = ${s}, ever_submitted = (ever_submitted or ${s} <> 'DRAFT') where id = ${id}`.execute(
        db,
      )
  }
}
