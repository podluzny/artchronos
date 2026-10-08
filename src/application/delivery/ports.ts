import type { DeliveredItem } from '../../domain/delivery/delivery.js'
import type { AssessmentTx } from '../assessment/ports.js'

export interface AttemptRecord {
  id: string
  testVersionId: string
  userId: string
  attemptNo: number
  status: 'IN_PROGRESS' | 'SUBMITTED' | 'EXPIRED' | 'ABANDONED'
  seed: number
  deliveredItems: DeliveredItem[]
  startedAt: Date
  submittedAt: Date | null
}

export interface ResultRecord {
  attemptId: string
  score: number
  maxScore: number
  passed: boolean | null
  pendingManual: number
}

/** Хранилище модели прохождения (SPEC-DELIV-001). В MVP используется только прототипом и тестами. */
export interface DeliveryRepository {
  countAttempts(testVersionId: string, userId: string): Promise<number>
  insertAttempt(d: {
    testVersionId: string
    userId: string
    attemptNo: number
    seed: number
    deliveredItems: DeliveredItem[]
  }): Promise<string>
  findAttempt(id: string): Promise<AttemptRecord | null>
  setSubmitted(id: string, at: Date): Promise<void>
  upsertResponse(attemptId: string, itemVersionId: string, payload: Record<string, unknown>): Promise<string>
  responses(attemptId: string): Promise<{ id: string; itemVersionId: string; payload: Record<string, unknown> }[]>
  insertEvaluation(d: {
    responseId: string
    method: 'AUTO' | 'MANUAL'
    score: number | null
    maxScore: number
    details: Record<string, unknown>
  }): Promise<void>
  insertResult(d: ResultRecord & { sectionScores: unknown[] }): Promise<void>
  result(attemptId: string): Promise<ResultRecord | null>
}

export interface DeliveryTx extends AssessmentTx {
  delivery: DeliveryRepository
}
