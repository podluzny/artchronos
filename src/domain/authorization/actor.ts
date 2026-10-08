import { DomainError } from '../shared/errors.js'
import type { Scope } from './scope.js'

export type UserStatus = 'INVITED' | 'ACTIVE' | 'BLOCKED' | 'ARCHIVED'

/** Authorization context текущего пользователя (FR-AUTH-006). Строится один раз на запрос. */
export class Actor {
  readonly userId: string
  readonly email: string
  readonly displayName: string
  readonly status: UserStatus
  readonly roleCodes: readonly string[]
  readonly mustChangePassword: boolean
  private readonly grants: ReadonlyMap<string, ReadonlySet<Scope>>

  constructor(args: {
    userId: string
    email: string
    displayName: string
    status: UserStatus
    roleCodes: string[]
    mustChangePassword: boolean
    grants: Map<string, Set<Scope>>
  }) {
    this.userId = args.userId
    this.email = args.email
    this.displayName = args.displayName
    this.status = args.status
    this.roleCodes = args.roleCodes
    this.mustChangePassword = args.mustChangePassword
    this.grants = args.grants
  }

  /** Scopes, с которыми у пользователя есть permission (пустое множество — нет права). */
  scopes(key: string): ReadonlySet<Scope> {
    if (this.status !== 'ACTIVE' || this.mustChangePassword) return EMPTY
    return this.grants.get(key) ?? EMPTY
  }

  has(key: string, scope?: Scope): boolean {
    const s = this.scopes(key)
    return scope ? s.has(scope) : s.size > 0
  }

  hasRole(code: string): boolean {
    return this.roleCodes.includes(code)
  }

  /** Все permissions пользователя (для отображения и тестов). */
  grantedKeys(): string[] {
    return [...this.grants.keys()].sort()
  }
}

const EMPTY: ReadonlySet<Scope> = new Set()

/**
 * Грубая проверка: у пользователя есть permission с каким-либо scope.
 * Возвращает scopes для последующей объектной проверки.
 */
export function requirePermission(actor: Actor, key: string): ReadonlySet<Scope> {
  if (actor.status === 'ACTIVE' && actor.mustChangePassword) {
    throw new DomainError('PASSWORD_CHANGE_REQUIRED', 'Необходимо сменить пароль')
  }
  const scopes = actor.scopes(key)
  if (scopes.size === 0) throw DomainError.forbidden()
  return scopes
}

/**
 * Объектная проверка scope: объект удовлетворяет набору отношений `relations`
 * (например, {'OWN'} для собственного объекта). ANY покрывает всё.
 * Для чтения недоступный объект маскируется как 404 (SPEC-AUTH-003 A1).
 */
export function requireScope(
  actor: Actor,
  key: string,
  relations: ReadonlySet<Scope>,
  mode: 'read' | 'write' = 'write',
): Scope {
  const scopes = requirePermission(actor, key)
  if (scopes.has('ANY')) return 'ANY'
  for (const s of scopes) if (relations.has(s)) return s
  throw mode === 'read' ? DomainError.notFound() : DomainError.forbidden()
}

export function scopeAllows(actor: Actor, key: string, relations: ReadonlySet<Scope>): boolean {
  const scopes = actor.scopes(key)
  if (scopes.has('ANY')) return true
  for (const s of scopes) if (relations.has(s)) return true
  return false
}

/** Условие для списков: репозиторий переводит его в SQL (NFR-PERF-003). */
export type ScopeFilter = { kind: 'ANY' } | { kind: 'SCOPED'; userId: string; scopes: ReadonlySet<Scope> }

export function scopeFilter(actor: Actor, key: string): ScopeFilter {
  const scopes = requirePermission(actor, key)
  if (scopes.has('ANY')) return { kind: 'ANY' }
  return { kind: 'SCOPED', userId: actor.userId, scopes }
}
