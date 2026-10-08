import type { ScopeFilter } from '../../domain/authorization/actor.js'
import type {
  ChecklistItem,
  IssueSeverity,
  IssueStatus,
  ReviewerRole,
  ReviewStatus,
} from '../../domain/review/review-rules.js'
import type { VersionState } from '../../domain/versioning/state-machine.js'
import type { AssessmentTx } from '../assessment/ports.js'
import type { ListQuery } from '../shared/query.js'

export type SubjectType = 'TEST_VERSION' | 'ITEM_VERSION'

export interface ReviewRecord {
  id: string
  subjectType: SubjectType
  testVersionId: string | null
  itemVersionId: string | null
  testId: string | null
  itemId: string | null
  courseId: string
  courseName: string
  assignmentId: string | null
  assignmentTitle: string | null
  status: ReviewStatus
  checklistTemplateId: string
  decision: 'REQUEST_CHANGES' | 'APPROVE' | null
  decidedBy: string | null
  decidedAt: Date | null
  summary: string | null
  submittedAt: Date
  revision: number
  /** Название теста / формулировка вопроса. */
  subjectTitle: string
  versionNo: number
  versionState: VersionState
  /** Владелец контейнера и авторы версии (BR-001). */
  ownerId: string
  ownerName: string
  authorIds: string[]
  primaryReviewerId: string | null
  primaryReviewerName: string | null
}

export interface ReviewAssignmentRecord {
  id: string
  reviewId: string
  reviewerId: string
  reviewerName: string
  role: ReviewerRole
  status: 'ACTIVE' | 'REVOKED' | 'COMPLETED'
  assignedBy: string | null
  assignedAt: Date
  reason: string | null
}

export interface ChecklistTemplateRecord {
  id: string
  name: string
  appliesTo: SubjectType
  versionNo: number
  items: ChecklistItem[]
  status: 'ACTIVE' | 'ARCHIVED'
  createdAt: Date
}

export interface ChecklistAnswerRecord {
  code: string
  checked: boolean
  note: string | null
  answeredBy: string
  answeredAt: Date
}

export interface CommentAnchor {
  itemVersionId?: string | null
  sectionId?: string | null
  fieldPath?: string | null
}

export interface ReviewCommentRecord {
  id: string
  reviewId: string
  parentId: string | null
  authorId: string
  authorName: string
  anchor: CommentAnchor
  body: string
  createdAt: Date
}

export interface ContentIssueRecord {
  id: string
  reviewId: string
  originCommentId: string | null
  testId: string | null
  itemId: string | null
  linkedVersionId: string | null
  anchor: CommentAnchor
  body: string
  severity: IssueSeverity
  status: IssueStatus
  raisedBy: string
  raisedByName: string
  addressedInVersionId: string | null
  statusNote: string | null
  statusBy: string | null
  createdAt: Date
}

export interface ReviewRelations {
  /** Пользователь — автор объекта экспертизы. */
  own: boolean
  /** Активное или завершенное назначение экспертом. */
  assigned: boolean
  /** Владелец / эксперт по умолчанию задания объекта (review.assign ASSIGNED). */
  assignmentManager: boolean
  courseTeacher: boolean
}

export interface ReviewRepository {
  list(filter: ScopeFilter, q: ListQuery): Promise<{ records: ReviewRecord[]; total: number }>
  findById(id: string): Promise<ReviewRecord | null>
  relations(userId: string, reviewId: string): Promise<ReviewRelations>
  openForVersion(kind: SubjectType, versionId: string): Promise<ReviewRecord | null>
  latestForContainer(kind: 'test' | 'item', containerId: string): Promise<ReviewRecord | null>
  insertReview(d: {
    subjectType: SubjectType
    testVersionId: string | null
    itemVersionId: string | null
    testId: string | null
    itemId: string | null
    courseId: string
    assignmentId: string | null
    checklistTemplateId: string
  }): Promise<string>
  setStatus(
    id: string,
    d: {
      status: ReviewStatus
      decision?: 'REQUEST_CHANGES' | 'APPROVE'
      decidedBy?: string
      decidedAt?: Date
      summary?: string | null
    },
    expectedRevision?: number,
  ): Promise<void>
  assignments(reviewId: string): Promise<ReviewAssignmentRecord[]>
  insertAssignment(d: {
    reviewId: string
    reviewerId: string
    role: ReviewerRole
    assignedBy: string | null
    reason: string | null
  }): Promise<string>
  setAssignmentStatus(id: string, status: 'REVOKED' | 'COMPLETED', reason?: string | null): Promise<void>
  /** Все активные назначения review → COMPLETED / REVOKED. */
  closeAssignments(reviewId: string, status: 'REVOKED' | 'COMPLETED'): Promise<void>
  activeTemplate(appliesTo: SubjectType): Promise<ChecklistTemplateRecord | null>
  template(id: string): Promise<ChecklistTemplateRecord | null>
  listTemplates(): Promise<ChecklistTemplateRecord[]>
  insertTemplate(d: {
    name: string
    appliesTo: SubjectType
    items: ChecklistItem[]
    createdBy: string
  }): Promise<string>
  answers(reviewId: string): Promise<ChecklistAnswerRecord[]>
  upsertAnswer(d: { reviewId: string; code: string; checked: boolean; note: string | null; by: string }): Promise<void>
  comments(reviewId: string): Promise<ReviewCommentRecord[]>
  insertComment(d: {
    reviewId: string
    parentId: string | null
    authorId: string
    anchor: CommentAnchor
    body: string
  }): Promise<string>
  /** Замечания контейнера (тест/вопрос) по всем review: текущие и перенесенные (FR-REVIEW-009). */
  issuesForContainer(kind: 'test' | 'item', containerId: string): Promise<ContentIssueRecord[]>
  findIssue(id: string): Promise<ContentIssueRecord | null>
  insertIssue(d: {
    reviewId: string
    originCommentId: string | null
    testId: string | null
    itemId: string | null
    linkedVersionId: string
    anchor: CommentAnchor
    body: string
    severity: IssueSeverity
    raisedBy: string
  }): Promise<string>
  updateIssue(
    id: string,
    d: { status: IssueStatus; note: string | null; by: string; addressedInVersionId?: string | null },
  ): Promise<void>
  /** Перенос незакрытых замечаний на новую версию. */
  linkOpenIssues(kind: 'test' | 'item', containerId: string, versionId: string): Promise<number>
  reviewerCandidates(): Promise<{ id: string; name: string; email: string }[]>
  userBrief(id: string): Promise<{ id: string; name: string; status: string } | null>
}

export interface ReviewTx extends AssessmentTx {
  reviews: ReviewRepository
}
