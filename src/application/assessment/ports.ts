import type { ScopeFilter } from '../../domain/authorization/actor.js'
import type { SelectionFilter, TestSettings } from '../../domain/assessment/test-rules.js'
import type { VersionState } from '../../domain/versioning/state-machine.js'
import type { EducationRepository } from '../education/ports.js'
import type { ItemRepository, QuestionTypeRepository } from '../itembank/ports.js'
import type { MediaRepository } from '../media/ports.js'
import type { AuditWriter } from '../shared/audit.js'
import type { ListQuery } from '../shared/query.js'

export interface TestRecord {
  id: string
  title: string
  ownerId: string
  ownerName: string
  assignmentId: string | null
  assignmentTitle: string | null
  courseId: string
  courseName: string
  currentDraftVersionId: string | null
  publishedVersionId: string | null
  status: 'ACTIVE' | 'ARCHIVED'
  archiveReason: string | null
  createdAt: Date
  updatedAt: Date
  revision: number
}

export interface TestListRow extends TestRecord {
  versionId: string
  versionNo: number
  state: VersionState
}

export interface TestVersionRecord {
  id: string
  testId: string
  versionNo: number
  basedOnVersionId: string | null
  state: VersionState
  title: string
  description: string | null
  instructions: string | null
  settings: TestSettings
  authorIds: string[]
  packageItemVersionIds: string[]
  everSubmitted: boolean
  submittedAt: Date | null
  approvedAt: Date | null
  approvedBy: string | null
  publishedAt: Date | null
  contentHash: string | null
  createdAt: Date
  updatedAt: Date
  revision: number
}

export interface SectionRecord {
  id: string
  testVersionId: string
  title: string
  instructions: string | null
  ordinal: number
  timeLimitSec: number | null
  shuffleItems: boolean | null
}

/** Фиксированный вопрос раздела с данными закрепленной версии (pinning, BR-010). */
export interface FixedItemRecord {
  id: string
  sectionId: string
  itemId: string
  itemVersionId: string
  ordinal: number
  points: number
  itemOwnerId: string
  itemStatus: 'ACTIVE' | 'ARCHIVED'
  itemCourseId: string
  interactionKey: string
  questionTypeId: string
  questionTypeName: string
  versionNo: number
  versionState: VersionState
  versionAuthorIds: string[]
  stem: string
  topicIds: string[]
  latestApprovedVersionId: string | null
  latestApprovedVersionNo: number | null
}

export interface RuleRecord {
  id: string
  sectionId: string
  ordinal: number
  count: number
  pointsPerItem: number
  filter: SelectionFilter
}

export interface TestStructure {
  sections: SectionRecord[]
  fixed: FixedItemRecord[]
  rules: RuleRecord[]
}

export interface TestRelations {
  own: boolean
  /** Тест задания, которое ведет пользователь (owner / default reviewer). */
  assignedViaAssignment: boolean
  courseTeacher: boolean
}

export interface PoolCandidate {
  itemId: string
  itemVersionId: string
}

export interface AssignmentSummaryRow {
  userId: string
  displayName: string
  email: string
  testCount: number
  latestTestId: string | null
  latestTestTitle: string | null
  latestVersionNo: number | null
  latestState: VersionState | null
  latestUpdatedAt: Date | null
  extendedUntil: Date | null
}

export interface TestRepository {
  list(filter: ScopeFilter, q: ListQuery): Promise<{ records: TestListRow[]; total: number }>
  findById(id: string): Promise<TestRecord | null>
  relations(userId: string, testId: string): Promise<TestRelations>
  versions(testId: string): Promise<{ id: string; versionNo: number; state: VersionState; createdAt: Date }[]>
  findVersion(id: string): Promise<TestVersionRecord | null>
  structure(versionId: string): Promise<TestStructure>
  insertTest(d: { title: string; ownerId: string; assignmentId: string | null; courseId: string }): Promise<string>
  updateTestTitle(id: string, title: string): Promise<void>
  insertVersion(d: {
    testId: string
    versionNo: number
    basedOnVersionId: string | null
    title: string
    description: string | null
    instructions: string | null
    settings: TestSettings
    authorIds: string[]
  }): Promise<string>
  /** Изменение метаданных/настроек черновика с optimistic lock (revision). */
  updateDraft(
    versionId: string,
    d: Partial<{ title: string; description: string | null; instructions: string | null; settings: TestSettings }>,
    expectedRevision: number,
  ): Promise<void>
  /** revision++ версии (любая структурная операция); только DRAFT. */
  touch(versionId: string, expectedRevision?: number): Promise<number>
  setVersionState(
    versionId: string,
    d: {
      state: VersionState
      submittedAt?: Date | null
      contentHash?: string | null
      everSubmitted?: boolean
      packageItemVersionIds?: string[]
      archiveReason?: string | null
    },
  ): Promise<void>
  setTestPointers(testId: string, d: { currentDraftVersionId?: string | null }): Promise<void>
  maxVersionNo(testId: string): Promise<number>
  insertSection(d: Omit<SectionRecord, 'id'>): Promise<string>
  updateSection(id: string, d: Partial<Omit<SectionRecord, 'id' | 'testVersionId'>>): Promise<void>
  deleteSection(id: string): Promise<void>
  insertFixed(d: {
    testVersionId: string
    sectionId: string
    itemId: string
    itemVersionId: string
    ordinal: number
    points: number
  }): Promise<string>
  updateFixed(
    id: string,
    d: Partial<{ sectionId: string; ordinal: number; points: number; itemVersionId: string }>,
  ): Promise<void>
  deleteFixed(id: string): Promise<void>
  insertRule(d: Omit<RuleRecord, 'id'> & { testVersionId: string }): Promise<string>
  updateRule(id: string, d: Partial<Omit<RuleRecord, 'id'>>): Promise<void>
  deleteRule(id: string): Promise<void>
  /** BR-012: последние утвержденные версии активных вопросов курса по фильтру. */
  poolCandidates(courseId: string, filter: SelectionFilter, excludeItemIds: string[]): Promise<PoolCandidate[]>
  frozenPool(ruleId: string): Promise<string[]>
  countActiveTestsInAssignment(assignmentId: string, ownerId: string): Promise<number>
  assignmentSummary(assignmentId: string): Promise<AssignmentSummaryRow[]>
}

export interface AssessmentTx {
  tests: TestRepository
  items: ItemRepository
  qtypes: QuestionTypeRepository
  media: MediaRepository
  education: EducationRepository
  audit: AuditWriter
}
