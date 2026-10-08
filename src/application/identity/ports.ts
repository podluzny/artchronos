import type { Scope } from '../../domain/authorization/scope.js'
import type { ScopeFilter, UserStatus } from '../../domain/authorization/actor.js'
import type { AuditWriter } from '../shared/audit.js'
import type { ListQuery } from '../shared/query.js'

export interface UserRecord {
  id: string
  email: string
  displayName: string
  passwordHash: string | null
  status: UserStatus
  failedLoginCount: number
  lockedUntil: Date | null
  lastLoginAt: Date | null
  passwordChangedAt: Date | null
  mustChangePassword: boolean
  statusReason: string | null
  createdAt: Date
  updatedAt: Date
  revision: number
  roleCodes: string[]
}

export interface UserPatch {
  email?: string
  displayName?: string
  passwordHash?: string | null
  status?: UserStatus
  failedLoginCount?: number
  lockedUntil?: Date | null
  lastLoginAt?: Date | null
  passwordChangedAt?: Date | null
  mustChangePassword?: boolean
  statusReason?: string | null
}

export interface UserRepository {
  findById(id: string): Promise<UserRecord | null>
  findByEmail(email: string): Promise<UserRecord | null>
  list(filter: ScopeFilter, query: ListQuery): Promise<UserRecord[]>
  count(filter: ScopeFilter, query: ListQuery): Promise<number>
  /** Входит ли пользователь в область COURSE актора (студенты курсов преподавателя). */
  inActorCourses(actorId: string, userId: string): Promise<boolean>
  insert(data: {
    email: string
    displayName: string
    status: UserStatus
    passwordHash: string | null
    mustChangePassword: boolean
  }): Promise<UserRecord>
  /** Обновление с проверкой revision (NFR-DATA-003). Без revision — безусловно (служебные поля входа). */
  update(id: string, patch: UserPatch, expectedRevision?: number): Promise<UserRecord>
  setRoles(userId: string, roleIds: string[], grantedBy: string | null): Promise<void>
  countActiveAdmins(): Promise<number>
}

export interface RoleGrantRecord {
  key: string
  scope: Scope
}

export interface RoleRecord {
  id: string
  code: string
  name: string
  description: string | null
  isSystem: boolean
  revision: number
  grants: RoleGrantRecord[]
  userCount: number
}

export interface RoleRepository {
  list(query: ListQuery): Promise<RoleRecord[]>
  count(query: ListQuery): Promise<number>
  findById(id: string): Promise<RoleRecord | null>
  findByCodes(codes: string[]): Promise<RoleRecord[]>
  insert(data: { code: string; name: string; description: string | null; isSystem: boolean }): Promise<RoleRecord>
  update(id: string, data: { name: string; description: string | null }, expectedRevision: number): Promise<void>
  setGrants(roleId: string, grants: RoleGrantRecord[]): Promise<void>
  delete(id: string): Promise<void>
  /** Роли и объединенные grants пользователя (для Actor). */
  actorGrants(userId: string): Promise<{ roleCodes: string[]; grants: RoleGrantRecord[] }>
}

export interface SessionRepository {
  revokeAllForUser(userId: string, exceptSid?: string | null): Promise<number>
}

export interface PasswordTokenRepository {
  insert(data: {
    userId: string
    purpose: 'ACTIVATION' | 'RESET'
    tokenHash: string
    expiresAt: Date
    createdBy: string | null
  }): Promise<void>
  findByHash(tokenHash: string): Promise<{
    id: string
    userId: string
    purpose: 'ACTIVATION' | 'RESET'
    expiresAt: Date
    usedAt: Date | null
  } | null>
  markUsed(id: string, at: Date): Promise<void>
  invalidateForUser(userId: string, at: Date): Promise<void>
}

export interface IdentityTx {
  users: UserRepository
  roles: RoleRepository
  sessions: SessionRepository
  tokens: PasswordTokenRepository
  audit: AuditWriter
}

export interface PasswordHasher {
  hash(password: string): Promise<string>
  verify(hash: string, password: string): Promise<boolean>
  /** Выравнивание времени ответа при несуществующем пользователе (AC-AUTH-001.2). */
  dummyVerify(password: string): Promise<void>
}

export interface TokenService {
  generate(): string
  hash(token: string): string
}
