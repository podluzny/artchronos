import type { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely'

/** Типы таблиц (ADR-008: схема описывается вручную, источник истины — миграции). */
type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>
type Json<T = unknown> = ColumnType<T, string | T, string | T>

export interface UsersTable {
  id: Generated<string>
  email: string
  display_name: string
  password_hash: string | null
  status: 'INVITED' | 'ACTIVE' | 'BLOCKED' | 'ARCHIVED'
  failed_login_count: Generated<number>
  locked_until: Date | null
  last_login_at: Date | null
  password_changed_at: Date | null
  must_change_password: Generated<boolean>
  status_reason: string | null
  created_at: Generated<Date>
  updated_at: Generated<Date>
  revision: Generated<number>
}

export interface RolesTable {
  id: Generated<string>
  code: string
  name: string
  description: string | null
  is_system: Generated<boolean>
  created_at: Generated<Date>
  updated_at: Generated<Date>
  revision: Generated<number>
}

export interface PermissionsTable {
  key: string
  description: string
  supported_scopes: string[]
}

export interface RolePermissionsTable {
  role_id: string
  permission_key: string
  scope: string
}

export interface UserRolesTable {
  user_id: string
  role_id: string
  granted_by: string | null
  granted_at: Generated<Date>
}

export interface SessionsTable {
  sid: string
  user_id: string | null
  data: Json<Record<string, unknown>>
  created_at: Generated<Date>
  last_seen_at: Generated<Date>
  expires_at: Timestamp
  revoked_at: Date | null
  ip: string | null
  user_agent: string | null
}

export interface PasswordTokensTable {
  id: Generated<string>
  user_id: string
  purpose: 'ACTIVATION' | 'RESET'
  token_hash: string
  expires_at: Timestamp
  used_at: Date | null
  created_by: string | null
  created_at: Generated<Date>
}

export interface AuditLogTable {
  id: Generated<string>
  occurred_at: Generated<Date>
  actor_id: string | null
  actor_roles: string[]
  action: string
  resource_type: string
  resource_id: string | null
  changes: Json<Record<string, unknown>> | null
  reason: string | null
  request_id: string | null
  ip: string | null
  user_agent: string | null
}

export interface Database {
  users: UsersTable
  roles: RolesTable
  permissions: PermissionsTable
  role_permissions: RolePermissionsTable
  user_roles: UserRolesTable
  sessions: SessionsTable
  password_tokens: PasswordTokensTable
  audit_log: AuditLogTable
}

export type UserRow = Selectable<UsersTable>
export type NewUserRow = Insertable<UsersTable>
export type UserUpdate = Updateable<UsersTable>
export type RoleRow = Selectable<RolesTable>
export type AuditRow = Selectable<AuditLogTable>
