import { DomainError } from '../shared/errors.js'
import type { UserStatus } from '../authorization/actor.js'

/** Параметры блокировки входа (NFR-SEC-005). */
export const LOGIN_LOCKOUT = { maxFailures: 5, lockMinutes: 15 }

/** BR-014: аутентифицироваться может только ACTIVE пользователь. */
export function canAuthenticate(status: UserStatus): boolean {
  return status === 'ACTIVE'
}

/** BR-015: нельзя менять собственные роли/статус. */
export function assertNotSelf(actorId: string, targetUserId: string, what: string): void {
  if (actorId === targetUserId) {
    throw DomainError.rule('BR-015', `Нельзя ${what} самому себе`)
  }
}

/**
 * BR-016: операция не должна оставить систему без активного администратора.
 * `activeAdminIdsAfter` — множество активных администраторов после операции.
 */
export function assertAdminRemains(activeAdminCountAfter: number): void {
  if (activeAdminCountAfter < 1) {
    throw DomainError.rule('BR-016', 'Нельзя оставить систему без активного администратора')
  }
}

export const USER_STATUS_TRANSITIONS: Record<string, { from: UserStatus[]; to: UserStatus }> = {
  block: { from: ['ACTIVE', 'INVITED'], to: 'BLOCKED' },
  unblock: { from: ['BLOCKED'], to: 'ACTIVE' },
  archive: { from: ['ACTIVE', 'INVITED', 'BLOCKED'], to: 'ARCHIVED' },
  restore: { from: ['ARCHIVED'], to: 'BLOCKED' },
}

export function nextUserStatus(action: keyof typeof USER_STATUS_TRANSITIONS, current: UserStatus): UserStatus {
  const t = USER_STATUS_TRANSITIONS[action]
  if (!t || !t.from.includes(current)) {
    throw new DomainError('INVALID_TRANSITION', 'Недопустимое изменение статуса пользователя')
  }
  return t.to
}
