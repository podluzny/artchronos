import type { ScopeFilter } from '../../domain/authorization/actor.js'
import type { ItemDocument } from '../../domain/itembank/interaction.js'
import type { VersionState } from '../../domain/versioning/state-machine.js'
import type { EducationRepository } from '../education/ports.js'
import type { MediaRepository } from '../media/ports.js'
import type { AuditWriter } from '../shared/audit.js'
import type { ListQuery } from '../shared/query.js'

export interface QuestionTypeVersionRecord {
  id: string
  questionTypeId: string
  versionNo: number
  interactionConfig: Record<string, unknown>
  contentSchema: Record<string, unknown>
  responseSchema: Record<string, unknown>
  answerKeySchema: Record<string, unknown>
  evaluation: { method: string; params?: Record<string, unknown> }
  createdAt: Date
}

export interface QuestionTypeFull {
  id: string
  code: string
  name: string
  description: string | null
  interactionKey: string
  status: 'ACTIVE' | 'INACTIVE'
  currentVersionId: string | null
  currentVersion: QuestionTypeVersionRecord | null
  versions: { id: string; versionNo: number; createdAt: Date }[]
  itemCount: number
  activeAssignmentCount: number
  revision: number
}

export interface QuestionTypeRepository {
  list(q: ListQuery): Promise<{ records: QuestionTypeFull[]; total: number }>
  findById(id: string): Promise<QuestionTypeFull | null>
  findByCode(code: string): Promise<QuestionTypeFull | null>
  findVersion(id: string): Promise<QuestionTypeVersionRecord | null>
  insertType(d: { code: string; name: string; description: string | null; interactionKey: string }): Promise<string>
  insertVersion(
    d: Omit<QuestionTypeVersionRecord, 'id' | 'createdAt' | 'versionNo'> & { createdBy: string | null },
  ): Promise<QuestionTypeVersionRecord>
  update(
    id: string,
    d: Partial<{ name: string; description: string | null; status: 'ACTIVE' | 'INACTIVE'; currentVersionId: string }>,
    revision?: number,
  ): Promise<void>
}

export interface ItemMeta {
  defaultPoints: number
  difficulty: number
  feedback: string | null
  topicIds: string[]
  objectiveIds: string[]
  tags: string[]
}

export interface ItemVersionRecord {
  id: string
  itemId: string
  versionNo: number
  basedOnVersionId: string | null
  questionTypeVersionId: string
  state: VersionState
  document: ItemDocument
  meta: ItemMeta
  authorIds: string[]
  everSubmitted: boolean
  submittedAt: Date | null
  approvedAt: Date | null
  approvedBy: string | null
  contentHash: string | null
  createdAt: Date
  updatedAt: Date
  revision: number
}

export interface ItemRecord {
  id: string
  questionTypeId: string
  questionTypeCode: string
  questionTypeName: string
  interactionKey: string
  ownerId: string
  ownerName: string
  assignmentId: string | null
  assignmentTitle: string | null
  courseId: string
  courseName: string
  currentDraftVersionId: string | null
  latestApprovedVersionId: string | null
  status: 'ACTIVE' | 'ARCHIVED'
  archiveReason: string | null
  createdAt: Date
  updatedAt: Date
  revision: number
}

/** Строка списка банка: вопрос + отображаемая версия (versionMode). */
export interface ItemListRow extends ItemRecord {
  versionId: string
  versionNo: number
  state: VersionState
  stem: string
  difficulty: number
  topicNames: string[]
}

export interface ItemRelations {
  own: boolean
  /** Вопрос задания, которое ведет пользователь (owner/default reviewer). */
  assignedViaAssignment: boolean
  /** Курс вопроса — курс, где пользователь преподает. */
  courseTeacher: boolean
}

export interface ItemRepository {
  list(filter: ScopeFilter, q: ListQuery): Promise<{ records: ItemListRow[]; total: number }>
  findById(id: string): Promise<ItemRecord | null>
  relations(userId: string, itemId: string): Promise<ItemRelations>
  versions(itemId: string): Promise<
    {
      id: string
      versionNo: number
      state: VersionState
      createdAt: Date
      submittedAt: Date | null
      approvedAt: Date | null
    }[]
  >
  findVersion(id: string): Promise<ItemVersionRecord | null>
  insertItem(d: {
    questionTypeId: string
    ownerId: string
    assignmentId: string | null
    courseId: string
  }): Promise<string>
  insertVersion(d: {
    itemId: string
    versionNo: number
    basedOnVersionId: string | null
    questionTypeVersionId: string
    document: ItemDocument
    meta: ItemMeta
    authorIds: string[]
  }): Promise<string>
  /** Заменяет содержимое черновика (только DRAFT; триггер БД дублирует защиту). */
  replaceDraftContent(
    versionId: string,
    document: ItemDocument,
    meta: ItemMeta,
    expectedRevision: number,
  ): Promise<void>
  setVersionState(
    versionId: string,
    d: {
      state: VersionState
      /** Ожидаемое текущее состояние (условный переход). */
      from?: VersionState
      submittedAt?: Date | null
      approvedAt?: Date | null
      approvedBy?: string | null
      contentHash?: string | null
      everSubmitted?: boolean
      archiveReason?: string | null
    },
  ): Promise<void>
  setItemPointers(
    itemId: string,
    d: { currentDraftVersionId?: string | null; latestApprovedVersionId?: string | null },
  ): Promise<void>
  setItemArchived(itemId: string, archived: boolean, by: string, reason: string | null): Promise<void>
  deleteVersion(versionId: string): Promise<void>
  deleteItem(itemId: string): Promise<void>
  maxVersionNo(itemId: string): Promise<number>
  /** Используется ли версия в не-DRAFT версиях тестов или замороженных пулах. */
  versionReferencedOutsideDraftTests(versionId: string): Promise<boolean>
  /** Ссылается ли на версию хоть одна версия теста (BR-044: такой черновик не удаляется, а архивируется). */
  versionReferencedByTests(versionId: string): Promise<boolean>
  /** Входит ли версия в пакет отправленного (READY_FOR_REVIEW / IN_REVIEW) теста. */
  versionInOpenPackage(versionId: string): Promise<boolean>
  /** Вопрос используется в не-DRAFT версиях тестов других владельцев (ограничение архивации, §4.4). */
  itemUsedInFrozenTestsOfOthers(itemId: string, userId: string): Promise<boolean>
  /** Auto-rebind (versioning-model §4 п.4): DRAFT-версии тестов владельца переключаются на новую версию вопроса. */
  rebindDraftTests(fromVersionId: string, toVersionId: string, testOwnerId: string): Promise<string[]>
  countStudentItemsInAssignment(assignmentId: string, ownerId: string): Promise<number>
}

export interface ItemBankTx {
  items: ItemRepository
  qtypes: QuestionTypeRepository
  media: MediaRepository
  education: EducationRepository
  audit: AuditWriter
}
