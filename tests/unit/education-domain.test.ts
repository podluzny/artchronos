import { describe, expect, it } from 'vitest'
import {
  assertCanSubmit,
  assertStudentCanCreate,
  effectiveDeadline,
  nextAssignmentStatus,
  validateActivation,
  validateExtension,
  validateLimits,
} from '../../src/domain/education/assignment.js'
import { validateTopicParent } from '../../src/domain/education/topics.js'
import { assertCanArchive, assertDeletable, assertSelectable } from '../../src/domain/shared/archivable.js'
import type { DomainError } from '../../src/domain/shared/errors.js'

function errorOf(fn: () => void): DomainError {
  try {
    fn()
  } catch (e) {
    return e as DomainError
  }
  throw new Error('ожидалась ошибка')
}
const fieldMsg = (fn: () => void) =>
  errorOf(fn)
    .fieldErrors.map((f) => f.message)
    .join('; ')

const now = new Date('2026-10-01T10:00:00Z')
const day = 24 * 3600_000

describe('Задания: жизненный цикл и правила (SPEC-ASSIGN-002)', () => {
  it('переходы DRAFT → ACTIVE → CLOSED → ACTIVE / ARCHIVED', () => {
    expect(nextAssignmentStatus('activate', 'DRAFT')).toBe('ACTIVE')
    expect(nextAssignmentStatus('close', 'ACTIVE')).toBe('CLOSED')
    expect(nextAssignmentStatus('reopen', 'CLOSED')).toBe('ACTIVE')
    expect(nextAssignmentStatus('archive', 'CLOSED')).toBe('ARCHIVED')
    expect(() => nextAssignmentStatus('archive', 'ACTIVE')).toThrow()
    expect(() => nextAssignmentStatus('activate', 'CLOSED')).toThrow()
  })
  it('AT-ASSIGN-002.5 активация без адресатов/тем/типов/дедлайна отклоняется', () => {
    const base = {
      status: 'DRAFT' as const,
      minItems: 2,
      maxItems: 5,
      deadlineAt: new Date(now.getTime() + day),
      topicCount: 1,
      targetCount: 1,
      questionTypeCount: 1,
    }
    expect(() => validateActivation(base, now)).not.toThrow()
    for (const patch of [
      { targetCount: 0 },
      { topicCount: 0 },
      { questionTypeCount: 0 },
      { deadlineAt: null },
      { deadlineAt: new Date(now.getTime() - 1) },
    ]) {
      expect(() => validateActivation({ ...base, ...patch }, now)).toThrow()
    }
  })
  it('AT-ASSIGN-001.5 minItems > maxItems отклоняется', () => {
    expect(validateLimits(5, 3, 1)).not.toHaveLength(0)
    expect(validateLimits(1, 101, 1)).not.toHaveLength(0)
    expect(validateLimits(2, 5, 1)).toEqual([])
  })
  it('AT-ASSIGN-002.2 BR-017: в закрытом или неадресованном задании создавать нельзя', () => {
    expect(() => assertStudentCanCreate({ status: 'CLOSED', targeted: true })).toThrow(/активном задании/)
    expect(() => assertStudentCanCreate({ status: 'ACTIVE', targeted: false })).toThrow()
    expect(() => assertStudentCanCreate({ status: 'ACTIVE', targeted: true })).not.toThrow()
  })
  it('AT-ASSIGN-002.3 BR-031: первая отправка после дедлайна отклоняется; с продлением — принимается', () => {
    const deadline = new Date(now.getTime() - day)
    expect(errorOf(() => assertCanSubmit({ status: 'ACTIVE', deadline, firstSubmission: true, now })).ruleId).toBe(
      'BR-031',
    )
    const extended = effectiveDeadline(deadline, new Date(now.getTime() + day))
    expect(() => assertCanSubmit({ status: 'ACTIVE', deadline: extended, firstSubmission: true, now })).not.toThrow()
  })
  it('AT-ASSIGN-002.4 BR-031: повторная отправка после дедлайна разрешена, пока задание не закрыто', () => {
    const deadline = new Date(now.getTime() - day)
    expect(() => assertCanSubmit({ status: 'ACTIVE', deadline, firstSubmission: false, now })).not.toThrow()
    expect(() => assertCanSubmit({ status: 'CLOSED', deadline, firstSubmission: false, now })).toThrow()
  })
  it('продление не раньше общего дедлайна', () => {
    expect(() => validateExtension(now, new Date(now.getTime() - 1))).toThrow()
    expect(() => validateExtension(now, new Date(now.getTime() + 1))).not.toThrow()
  })
})

describe('Темы и архив (SPEC-EDU-001)', () => {
  it('AT-EDU-001.5 цикл в иерархии тем отклоняется', () => {
    expect(
      fieldMsg(() =>
        validateTopicParent({
          topicId: 'a',
          courseId: 'c',
          parent: { id: 'b', courseId: 'c' },
          ancestorIds: ['b', 'a'],
          subtreeDepth: 1,
        }),
      ),
    ).toMatch(/Циклическая/)
    expect(() =>
      validateTopicParent({
        topicId: 'a',
        courseId: 'c',
        parent: { id: 'a', courseId: 'c' },
        ancestorIds: ['a'],
        subtreeDepth: 1,
      }),
    ).toThrow()
  })
  it('глубина ≤ 3 и тот же курс', () => {
    expect(
      fieldMsg(() =>
        validateTopicParent({
          topicId: null,
          courseId: 'c',
          parent: { id: 'p', courseId: 'x' },
          ancestorIds: ['p'],
          subtreeDepth: 1,
        }),
      ),
    ).toMatch(/том же курсе/)
    expect(
      fieldMsg(() =>
        validateTopicParent({
          topicId: null,
          courseId: 'c',
          parent: { id: 'p', courseId: 'c' },
          ancestorIds: ['p', 'q', 'r'],
          subtreeDepth: 1,
        }),
      ),
    ).toMatch(/глубина/)
    expect(() =>
      validateTopicParent({
        topicId: null,
        courseId: 'c',
        parent: { id: 'p', courseId: 'c' },
        ancestorIds: ['p', 'q'],
        subtreeDepth: 1,
      }),
    ).not.toThrow()
  })
  it('архив: причина обязательна; повторная архивация невозможна; BR-039; BR-042', () => {
    expect(() => assertCanArchive('ACTIVE', '')).toThrow()
    expect(assertCanArchive('ACTIVE', ' устарело ')).toBe('устарело')
    expect(() => assertCanArchive('ARCHIVED', 'x')).toThrow()
    expect(errorOf(() => assertSelectable('ARCHIVED', 'Тема', 'topicId')).ruleId).toBe('BR-039')
    expect(errorOf(() => assertDeletable(2, 'Тема')).ruleId).toBe('BR-042')
    expect(() => assertDeletable(0, 'Тема')).not.toThrow()
  })
})
