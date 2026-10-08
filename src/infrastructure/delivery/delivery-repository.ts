import { sql } from 'kysely'
import type { AttemptRecord, DeliveryRepository, ResultRecord } from '../../application/delivery/ports.js'
import type { Db } from '../db/kysely.js'
import { isUuid } from '../identity/user-repository.js'

export class KyselyDeliveryRepository implements DeliveryRepository {
  constructor(private readonly db: Db) {}

  async countAttempts(testVersionId: string, userId: string) {
    const r = await sql<{ n: string }>`select count(*) as n from attempts
      where test_version_id = ${testVersionId} and user_id = ${userId}`.execute(this.db)
    return Number(r.rows[0]?.n ?? 0)
  }

  async insertAttempt(d: Parameters<DeliveryRepository['insertAttempt']>[0]) {
    const r = await sql<{
      id: string
    }>`insert into attempts (test_version_id, user_id, attempt_no, seed, delivered_items)
      values (${d.testVersionId}, ${d.userId}, ${d.attemptNo}, ${d.seed}, ${JSON.stringify(d.deliveredItems)}::jsonb)
      returning id`.execute(this.db)
    return r.rows[0]!.id
  }

  async findAttempt(id: string): Promise<AttemptRecord | null> {
    if (!isUuid(id)) return null
    const r = await sql<any>`select * from attempts where id = ${id}`.execute(this.db)
    const x = r.rows[0]
    if (!x) return null
    return {
      id: x.id,
      testVersionId: x.test_version_id,
      userId: x.user_id,
      attemptNo: x.attempt_no,
      status: x.status,
      seed: x.seed,
      deliveredItems: x.delivered_items,
      startedAt: x.started_at,
      submittedAt: x.submitted_at,
    }
  }

  async setSubmitted(id: string, at: Date) {
    await sql`update attempts set status = 'SUBMITTED', submitted_at = ${at} where id = ${id}`.execute(this.db)
  }

  async upsertResponse(attemptId: string, itemVersionId: string, payload: Record<string, unknown>) {
    const r = await sql<{ id: string }>`insert into responses (attempt_id, item_version_id, payload)
      values (${attemptId}, ${itemVersionId}, ${JSON.stringify(payload)}::jsonb)
      on conflict (attempt_id, item_version_id) do update set payload = excluded.payload, answered_at = now()
      returning id`.execute(this.db)
    return r.rows[0]!.id
  }

  async responses(attemptId: string) {
    const r =
      await sql<any>`select id, item_version_id, payload from responses where attempt_id = ${attemptId}`.execute(
        this.db,
      )
    return r.rows.map((x) => ({ id: x.id, itemVersionId: x.item_version_id, payload: x.payload }))
  }

  async insertEvaluation(d: Parameters<DeliveryRepository['insertEvaluation']>[0]) {
    await sql`insert into response_evaluations (response_id, method, score, max_score, details)
      values (${d.responseId}, ${d.method}, ${d.score}, ${d.maxScore}, ${JSON.stringify(d.details)}::jsonb)`.execute(
      this.db,
    )
  }

  async insertResult(d: ResultRecord & { sectionScores: unknown[] }) {
    await sql`insert into results (attempt_id, score, max_score, passed, pending_manual, section_scores)
      values (${d.attemptId}, ${d.score}, ${d.maxScore}, ${d.passed}, ${d.pendingManual},
        ${JSON.stringify(d.sectionScores)}::jsonb)`.execute(this.db)
  }

  async result(attemptId: string): Promise<ResultRecord | null> {
    const r = await sql<any>`select * from results where attempt_id = ${attemptId}`.execute(this.db)
    const x = r.rows[0]
    return x
      ? {
          attemptId: x.attempt_id,
          score: Number(x.score),
          maxScore: Number(x.max_score),
          passed: x.passed,
          pendingManual: x.pending_manual,
        }
      : null
  }
}
