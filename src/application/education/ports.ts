import type { ScopeFilter } from '../../domain/authorization/actor.js'
import type { ArchiveStatus } from '../../domain/shared/archivable.js'
import type { AssignmentStatus } from '../../domain/education/assignment.js'
import type { AuditWriter } from '../shared/audit.js'
import type { ListQuery } from '../shared/query.js'

export interface ArchiveInfo {
  status: ArchiveStatus
  archivedAt: Date | null
  archiveReason: string | null
}

export interface SubjectRecord extends ArchiveInfo {
  id: string
  code: string
  name: string
  courseCount: number
  revision: number
}

export interface CourseRecord extends ArchiveInfo {
  id: string
  subjectId: string
  subjectName: string
  subjectStatus: ArchiveStatus
  code: string
  name: string
  academicPeriod: string | null
  teacherIds: string[]
  teacherNames: string[]
  revision: number
}

export interface TopicRecord extends ArchiveInfo {
  id: string
  courseId: string
  courseName: string
  courseStatus: ArchiveStatus
  parentId: string | null
  parentStatus: ArchiveStatus | null
  name: string
  path: string
  depth: number
  ordinal: number
  revision: number
}

export interface ObjectiveRecord extends ArchiveInfo {
  id: string
  courseId: string
  topicId: string
  topicName: string
  topicStatus: ArchiveStatus
  code: string
  text: string
  bloomLevel: string | null
  revision: number
}

export interface GroupRecord extends ArchiveInfo {
  id: string
  courseId: string
  courseName: string
  courseStatus: ArchiveStatus
  name: string
  memberIds: string[]
  memberNames: string[]
  revision: number
}

export interface AssignmentRecord {
  id: string
  courseId: string
  courseName: string
  ownerId: string
  ownerName: string
  title: string
  instructions: string | null
  minItems: number
  maxItems: number
  maxTestsPerStudent: number
  deadlineAt: Date | null
  defaultReviewerId: string | null
  defaultReviewerName: string | null
  status: AssignmentStatus
  topicIds: string[]
  objectiveIds: string[]
  questionTypeIds: string[]
  targetUserIds: string[]
  targetGroupIds: string[]
  createdAt: Date
  updatedAt: Date
  revision: number
}

export interface QuestionTypeRecord {
  id: string
  code: string
  name: string
  interactionKey: string
  status: 'ACTIVE' | 'INACTIVE'
}

export interface CourseRelation {
  teaches: boolean
  studies: boolean
}

export type Entity = 'subjects' | 'courses' | 'topics' | 'learning_objectives' | 'student_groups'

/**
 * Репозиторий учебного контекста. Scope-фильтры переводятся в SQL (NFR-PERF-003):
 * COURSE для чтения структуры = преподает или учится в курсе; для групп и заданий = преподает;
 * ASSIGNED для заданий = задание адресовано пользователю (лично/через группу) и не DRAFT.
 */
export interface EducationRepository {
  courseRelation(userId: string, courseId: string): Promise<CourseRelation>
  userCourseIds(userId: string): Promise<{ teaches: string[]; studies: string[] }>

  listSubjects(filter: ScopeFilter, q: ListQuery): Promise<{ records: SubjectRecord[]; total: number }>
  findSubject(id: string): Promise<SubjectRecord | null>
  insertSubject(d: { code: string; name: string }): Promise<string>
  updateSubject(id: string, d: { code: string; name: string }, revision: number): Promise<void>

  listCourses(filter: ScopeFilter, q: ListQuery): Promise<{ records: CourseRecord[]; total: number }>
  findCourse(id: string): Promise<CourseRecord | null>
  insertCourse(d: { subjectId: string; code: string; name: string; academicPeriod: string | null }): Promise<string>
  updateCourse(
    id: string,
    d: { subjectId: string; code: string; name: string; academicPeriod: string | null },
    revision: number,
  ): Promise<void>
  setCourseTeachers(courseId: string, userIds: string[]): Promise<void>

  listTopics(filter: ScopeFilter, q: ListQuery): Promise<{ records: TopicRecord[]; total: number }>
  findTopic(id: string): Promise<TopicRecord | null>
  topicAncestorIds(id: string): Promise<string[]>
  topicSubtreeIds(id: string): Promise<string[]>
  topicSubtreeDepth(id: string): Promise<number>
  insertTopic(d: { courseId: string; parentId: string | null; name: string; ordinal: number }): Promise<string>
  updateTopic(
    id: string,
    d: { parentId: string | null; name: string; ordinal: number },
    revision: number,
  ): Promise<void>

  listObjectives(filter: ScopeFilter, q: ListQuery): Promise<{ records: ObjectiveRecord[]; total: number }>
  findObjective(id: string): Promise<ObjectiveRecord | null>
  insertObjective(d: {
    courseId: string
    topicId: string
    code: string
    text: string
    bloomLevel: string | null
  }): Promise<string>
  updateObjective(
    id: string,
    d: { topicId: string; code: string; text: string; bloomLevel: string | null },
    revision: number,
  ): Promise<void>

  listGroups(filter: ScopeFilter, q: ListQuery): Promise<{ records: GroupRecord[]; total: number }>
  findGroup(id: string): Promise<GroupRecord | null>
  insertGroup(d: { courseId: string; name: string }): Promise<string>
  updateGroup(id: string, d: { name: string }, revision: number): Promise<void>
  setGroupMembers(groupId: string, userIds: string[]): Promise<void>

  setArchived(entity: Entity, id: string, archived: boolean, by: string, reason: string | null): Promise<void>
  usageCount(entity: Entity, id: string): Promise<number>
  deleteRow(entity: Entity, id: string): Promise<void>

  /** Пользователи с ролью и статусом ACTIVE/INVITED (для преподавателей курса и членов групп). */
  usersWithRole(userIds: string[], roleCode: string): Promise<string[]>
  userHasPermission(userId: string, key: string): Promise<boolean>
  listUsersByRole(roleCode: string, limit: number): Promise<{ id: string; displayName: string; email: string }[]>

  listQuestionTypes(q: ListQuery): Promise<{ records: QuestionTypeRecord[]; total: number }>
  findQuestionTypes(ids: string[]): Promise<QuestionTypeRecord[]>

  listAssignments(filter: ScopeFilter, q: ListQuery): Promise<{ records: AssignmentRecord[]; total: number }>
  findAssignment(id: string): Promise<AssignmentRecord | null>
  insertAssignment(d: {
    courseId: string
    ownerId: string
    title: string
    instructions: string | null
    minItems: number
    maxItems: number
    maxTestsPerStudent: number
    deadlineAt: Date | null
  }): Promise<string>
  updateAssignment(
    id: string,
    d: Partial<{
      title: string
      instructions: string | null
      minItems: number
      maxItems: number
      maxTestsPerStudent: number
      deadlineAt: Date | null
      defaultReviewerId: string | null
      status: AssignmentStatus
    }>,
    revision?: number,
  ): Promise<void>
  setAssignmentLinks(
    id: string,
    d: {
      topicIds: string[]
      objectiveIds: string[]
      questionTypeIds: string[]
      targetUserIds: string[]
      targetGroupIds: string[]
    },
  ): Promise<void>
  isTargeted(assignmentId: string, userId: string): Promise<boolean>
  findExtension(assignmentId: string, userId: string): Promise<Date | null>
  upsertExtension(d: {
    assignmentId: string
    userId: string
    newDeadlineAt: Date
    reason: string | null
    grantedBy: string
  }): Promise<void>
}

export interface EducationTx {
  education: EducationRepository
  audit: AuditWriter
}
