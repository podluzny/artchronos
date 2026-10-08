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

type Archivable = {
  status: Generated<'ACTIVE' | 'ARCHIVED'>
  archived_at: Date | null
  archived_by: string | null
  archive_reason: string | null
  created_at: Generated<Date>
  updated_at: Generated<Date>
  revision: Generated<number>
}

export interface SubjectsTable extends Archivable {
  id: Generated<string>
  code: string
  name: string
}

export interface CoursesTable extends Archivable {
  id: Generated<string>
  subject_id: string
  code: string
  name: string
  academic_period: string | null
}

export interface CourseTeachersTable {
  course_id: string
  user_id: string
}

export interface TopicsTable extends Archivable {
  id: Generated<string>
  course_id: string
  parent_id: string | null
  name: string
  ordinal: Generated<number>
}

export interface LearningObjectivesTable extends Archivable {
  id: Generated<string>
  course_id: string
  topic_id: string
  code: string
  text: string
  bloom_level: string | null
}

export interface StudentGroupsTable extends Archivable {
  id: Generated<string>
  course_id: string
  name: string
}

export interface GroupMembershipsTable {
  group_id: string
  user_id: string
  added_at: Generated<Date>
}

export interface QuestionTypesTable {
  id: Generated<string>
  code: string
  name: string
  description: string | null
  interaction_key: string
  status: Generated<'ACTIVE' | 'INACTIVE'>
  created_at: Generated<Date>
  updated_at: Generated<Date>
  revision: Generated<number>
}

export interface AssignmentsTable {
  id: Generated<string>
  course_id: string
  owner_id: string
  title: string
  instructions: string | null
  min_items: Generated<number>
  max_items: Generated<number>
  max_tests_per_student: Generated<number>
  deadline_at: Date | null
  default_reviewer_id: string | null
  status: Generated<'DRAFT' | 'ACTIVE' | 'CLOSED' | 'ARCHIVED'>
  created_at: Generated<Date>
  updated_at: Generated<Date>
  revision: Generated<number>
}

export interface AssignmentTopicsTable {
  assignment_id: string
  topic_id: string
}
export interface AssignmentObjectivesTable {
  assignment_id: string
  objective_id: string
}
export interface AssignmentQuestionTypesTable {
  assignment_id: string
  question_type_id: string
}
export interface AssignmentTargetsTable {
  assignment_id: string
  user_id: string | null
  group_id: string | null
}
export interface DeadlineExtensionsTable {
  assignment_id: string
  user_id: string
  new_deadline_at: Date
  reason: string | null
  granted_by: string
  granted_at: Generated<Date>
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
  subjects: SubjectsTable
  courses: CoursesTable
  course_teachers: CourseTeachersTable
  topics: TopicsTable
  learning_objectives: LearningObjectivesTable
  student_groups: StudentGroupsTable
  group_memberships: GroupMembershipsTable
  question_types: QuestionTypesTable
  assignments: AssignmentsTable
  assignment_topics: AssignmentTopicsTable
  assignment_objectives: AssignmentObjectivesTable
  assignment_question_types: AssignmentQuestionTypesTable
  assignment_targets: AssignmentTargetsTable
  deadline_extensions: DeadlineExtensionsTable
}

export type UserRow = Selectable<UsersTable>
export type NewUserRow = Insertable<UsersTable>
export type UserUpdate = Updateable<UsersTable>
export type RoleRow = Selectable<RolesTable>
export type AuditRow = Selectable<AuditLogTable>
