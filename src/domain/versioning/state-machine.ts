import { DomainError } from '../shared/errors.js'

/** Состояния версий (docs/lifecycle-state-machine.md). PUBLISHED — только у TestVersion. */
export type VersionState =
  'DRAFT' | 'READY_FOR_REVIEW' | 'IN_REVIEW' | 'CHANGES_REQUESTED' | 'APPROVED' | 'PUBLISHED' | 'ARCHIVED'

export type VersionAction =
  'submit' | 'recall' | 'startReview' | 'requestChanges' | 'approve' | 'publish' | 'withdraw' | 'discard' | 'supersede'

const TABLE: Record<VersionAction, { from: VersionState[]; to: VersionState; testOnly?: boolean }> = {
  submit: { from: ['DRAFT'], to: 'READY_FOR_REVIEW' },
  recall: { from: ['READY_FOR_REVIEW'], to: 'DRAFT' },
  startReview: { from: ['READY_FOR_REVIEW'], to: 'IN_REVIEW' },
  requestChanges: { from: ['IN_REVIEW'], to: 'CHANGES_REQUESTED' },
  approve: { from: ['IN_REVIEW'], to: 'APPROVED' },
  publish: { from: ['APPROVED'], to: 'PUBLISHED', testOnly: true },
  withdraw: { from: ['PUBLISHED'], to: 'ARCHIVED', testOnly: true },
  supersede: { from: ['PUBLISHED'], to: 'ARCHIVED', testOnly: true },
  discard: { from: ['DRAFT'], to: 'ARCHIVED' },
}

/** BR-013: только переходы из таблицы; администратор не обходит состояния. */
export function transition(state: VersionState, action: VersionAction, kind: 'item' | 'test'): VersionState {
  const t = TABLE[action]
  if (!t || !t.from.includes(state) || (t.testOnly && kind !== 'test')) {
    throw new DomainError('INVALID_TRANSITION', `Переход «${action}» недопустим из состояния ${state} (BR-013)`)
  }
  return t.to
}

export function canTransition(state: VersionState, action: VersionAction, kind: 'item' | 'test'): boolean {
  try {
    transition(state, action, kind)
    return true
  } catch {
    return false
  }
}

/** BR-007: содержимое заморожено во всех состояниях, кроме DRAFT. */
export function isFrozen(state: VersionState): boolean {
  return state !== 'DRAFT'
}

export function assertEditable(state: VersionState): void {
  if (isFrozen(state)) {
    throw new DomainError(
      'INVALID_STATE',
      'Версия заморожена: редактировать можно только черновик. Создайте новую версию (BR-007).',
      {
        ruleId: state === 'APPROVED' ? 'BR-006' : 'BR-007',
      },
    )
  }
}

/** Из каких состояний можно создать новую версию (versioning-model §3). */
export function canBranch(state: VersionState): boolean {
  return ['CHANGES_REQUESTED', 'APPROVED', 'PUBLISHED'].includes(state) || state === 'ARCHIVED'
}

export const VERSION_STATE_LABEL: Record<VersionState, string> = {
  DRAFT: 'Черновик',
  READY_FOR_REVIEW: 'Отправлено на экспертизу',
  IN_REVIEW: 'На экспертизе',
  CHANGES_REQUESTED: 'Возвращено на доработку',
  APPROVED: 'Утверждено',
  PUBLISHED: 'Опубликовано',
  ARCHIVED: 'В архиве',
}
