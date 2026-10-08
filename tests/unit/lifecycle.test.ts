import { describe, expect, it } from 'vitest'
import {
  canTransition,
  transition,
  type VersionAction,
  type VersionState,
} from '../../src/domain/versioning/state-machine.js'

/** AT-PUB-001.1 / AT-PUB-001.2: полное декартово произведение (состояние × действие) по таблице lifecycle §3. */
const STATES: VersionState[] = [
  'DRAFT',
  'READY_FOR_REVIEW',
  'IN_REVIEW',
  'CHANGES_REQUESTED',
  'APPROVED',
  'PUBLISHED',
  'ARCHIVED',
]
const ACTIONS: VersionAction[] = [
  'submit',
  'recall',
  'startReview',
  'requestChanges',
  'approve',
  'publish',
  'withdraw',
  'discard',
  'supersede',
]
const ALLOWED: Record<string, VersionState> = {
  'DRAFT:submit': 'READY_FOR_REVIEW',
  'READY_FOR_REVIEW:recall': 'DRAFT',
  'READY_FOR_REVIEW:startReview': 'IN_REVIEW',
  'IN_REVIEW:requestChanges': 'CHANGES_REQUESTED',
  'IN_REVIEW:approve': 'APPROVED',
  'APPROVED:publish': 'PUBLISHED',
  'PUBLISHED:withdraw': 'ARCHIVED',
  'PUBLISHED:supersede': 'ARCHIVED',
  'DRAFT:discard': 'ARCHIVED',
}
const TEST_ONLY = new Set(['publish', 'withdraw', 'supersede'])

describe('AT-PUB-001.1 переходы вне таблицы отклоняются (BR-013)', () => {
  for (const kind of ['test', 'item'] as const)
    for (const s of STATES)
      for (const a of ACTIONS) {
        const allowed = ALLOWED[`${s}:${a}`] && (kind === 'test' || !TEST_ONLY.has(a))
        if (allowed) continue
        it(`${kind}: ${s} —${a}→ запрещено`, () => {
          expect(canTransition(s, a, kind)).toBe(false)
          expect(() => transition(s, a, kind)).toThrow(/BR-013/)
        })
      }
})

describe('AT-PUB-001.2 каждый допустимый переход выполняется', () => {
  for (const [key, to] of Object.entries(ALLOWED)) {
    const [s, a] = key.split(':') as [VersionState, VersionAction]
    it(`test: ${s} —${a}→ ${to}`, () => expect(transition(s, a, 'test')).toBe(to))
    if (!TEST_ONLY.has(a)) it(`item: ${s} —${a}→ ${to}`, () => expect(transition(s, a, 'item')).toBe(to))
  }
})
