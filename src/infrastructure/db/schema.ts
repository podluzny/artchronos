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
  current_version_id: string | null
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

export interface TagsTable {
  id: Generated<string>
  name: string
  normalized: string
  status: Generated<'ACTIVE' | 'ARCHIVED'>
  created_at: Generated<Date>
}

export interface MediaAssetsTable extends Archivable {
  id: Generated<string>
  kind: 'IMAGE' | 'VIDEO'
  storage_key: string
  mime_type: string
  size_bytes: ColumnType<string, number, number>
  sha256: string
  width: number | null
  height: number | null
  duration_sec: number | null
  title: string
  alt_text: string | null
  caption: string | null
  transcript: string | null
  depicts_artwork: Generated<boolean>
  artist: string | null
  work_title: string | null
  date_text: string | null
  technique: string | null
  collection: string | null
  inventory_no: string | null
  source_url: string | null
  source_description: string | null
  license: Generated<string>
  rights_holder: string | null
  credit_line: string | null
  rights_status: Generated<'PENDING' | 'CLEARED' | 'RESTRICTED'>
  rights_note: string | null
  rights_verified_by: string | null
  rights_verified_at: Date | null
  owner_id: string
  derivatives_status: Generated<'PENDING' | 'READY' | 'FAILED' | 'SKIPPED'>
}

export interface MediaDerivativesTable {
  media_id: string
  variant: 'THUMB' | 'PREVIEW' | 'POSTER'
  storage_key: string
  mime_type: string
  width: number | null
  height: number | null
}

export interface MediaBlobsTable {
  storage_key: string
  data: Buffer
  created_at: Generated<Date>
}

export interface MediaTagsTable {
  media_id: string
  tag_id: string
}
export interface MediaTopicsTable {
  media_id: string
  topic_id: string
}

export interface QuestionTypeVersionsTable {
  id: Generated<string>
  question_type_id: string
  version_no: number
  interaction_config: Json<Record<string, unknown>>
  content_schema: Json<Record<string, unknown>>
  response_schema: Json<Record<string, unknown>>
  answer_key_schema: Json<Record<string, unknown>>
  evaluation: Json<{ method: string; params?: Record<string, unknown> }>
  created_by: string | null
  created_at: Generated<Date>
}

export interface ItemsTable extends Archivable {
  id: Generated<string>
  question_type_id: string
  owner_id: string
  assignment_id: string | null
  course_id: string
  current_draft_version_id: string | null
  latest_approved_version_id: string | null
}

export type VersionStateCol = 'DRAFT' | 'READY_FOR_REVIEW' | 'IN_REVIEW' | 'CHANGES_REQUESTED' | 'APPROVED' | 'ARCHIVED'

export interface ItemVersionsTable {
  id: Generated<string>
  item_id: string
  version_no: number
  based_on_version_id: string | null
  question_type_version_id: string
  state: Generated<VersionStateCol>
  stem: Generated<string>
  content: Json<Record<string, unknown>>
  answer_key: Json<Record<string, unknown>>
  default_points: ColumnType<number, number | undefined, number>
  difficulty: Generated<number>
  feedback: string | null
  author_ids: string[]
  ever_submitted: Generated<boolean>
  submitted_at: Date | null
  approved_at: Date | null
  approved_by: string | null
  content_hash: string | null
  archive_reason: string | null
  created_at: Generated<Date>
  updated_at: Generated<Date>
  revision: Generated<number>
}

export interface ItemOptionsTable {
  id: Generated<string>
  item_version_id: string
  key: string
  role: 'OPTION' | 'PREMISE' | 'RESPONSE' | 'SEQUENCE_ELEMENT'
  text: string | null
  media_asset_id: string | null
  alt_text_override: string | null
  ordinal: number
}

export interface ItemMediaTable {
  item_version_id: string
  media_asset_id: string
  role: 'STIMULUS' | 'ILLUSTRATION'
  alt_text_override: string | null
  ordinal: Generated<number>
}

export interface ItemVersionTopicsTable {
  item_version_id: string
  topic_id: string
}
export interface ItemVersionObjectivesTable {
  item_version_id: string
  objective_id: string
}
export interface ItemVersionTagsTable {
  item_version_id: string
  tag_id: string
}

export type TestVersionStateCol = VersionStateCol | 'PUBLISHED'

export interface TestsTable extends Archivable {
  id: Generated<string>
  title: string
  owner_id: string
  assignment_id: string | null
  course_id: string
  current_draft_version_id: string | null
  published_version_id: string | null
}

export interface TestVersionsTable {
  id: Generated<string>
  test_id: string
  version_no: number
  based_on_version_id: string | null
  state: Generated<TestVersionStateCol>
  title: string
  description: string | null
  instructions: string | null
  settings: Json<Record<string, unknown>>
  author_ids: string[]
  package_item_version_ids: Generated<string[]>
  ever_submitted: Generated<boolean>
  submitted_at: Date | null
  approved_at: Date | null
  approved_by: string | null
  published_at: Date | null
  published_by: string | null
  archived_at: Date | null
  archive_reason: string | null
  content_hash: string | null
  created_at: Generated<Date>
  updated_at: Generated<Date>
  revision: Generated<number>
}

export interface TestSectionsTable {
  id: Generated<string>
  test_version_id: string
  title: string
  instructions: string | null
  ordinal: number
  time_limit_sec: number | null
  shuffle_items: boolean | null
}

export interface TestSectionItemsTable {
  id: Generated<string>
  test_version_id: string
  section_id: string
  item_id: string
  item_version_id: string
  ordinal: number
  points: ColumnType<number, number, number>
}

export interface SelectionRulesTable {
  id: Generated<string>
  test_version_id: string
  section_id: string
  ordinal: number
  count: number
  points_per_item: ColumnType<number, number, number>
  filter: Json<Record<string, unknown>>
}

export interface SelectionPoolEntriesTable {
  selection_rule_id: string
  item_version_id: string
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
  tags: TagsTable
  media_assets: MediaAssetsTable
  media_derivatives: MediaDerivativesTable
  media_blobs: MediaBlobsTable
  media_tags: MediaTagsTable
  media_topics: MediaTopicsTable
  question_type_versions: QuestionTypeVersionsTable
  items: ItemsTable
  item_versions: ItemVersionsTable
  item_options: ItemOptionsTable
  item_media: ItemMediaTable
  item_version_topics: ItemVersionTopicsTable
  item_version_objectives: ItemVersionObjectivesTable
  item_version_tags: ItemVersionTagsTable
  tests: TestsTable
  test_versions: TestVersionsTable
  test_sections: TestSectionsTable
  test_section_items: TestSectionItemsTable
  selection_rules: SelectionRulesTable
  selection_pool_entries: SelectionPoolEntriesTable
}

export type UserRow = Selectable<UsersTable>
export type NewUserRow = Insertable<UsersTable>
export type UserUpdate = Updateable<UsersTable>
export type RoleRow = Selectable<RolesTable>
export type AuditRow = Selectable<AuditLogTable>
