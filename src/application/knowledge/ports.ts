import type { ResolvableEntry } from '../../domain/knowledge/anchors.js'
import type { KnowledgeKind, LinkRelation } from '../../domain/knowledge/knowledge.js'
import type { AuditWriter } from '../shared/audit.js'
import type { ListQuery } from '../shared/query.js'

export type RefSourceType = 'ITEM_VERSION' | 'TEST_VERSION' | 'ASSIGNMENT' | 'MEDIA' | 'KNOWLEDGE'

export interface LinkTarget {
  id: string
  kind: KnowledgeKind
  name: string
  status: 'ACTIVE' | 'ARCHIVED'
}

export interface KnowledgeEntryRecord {
  id: string
  kind: KnowledgeKind
  slug: string
  name: string
  altNames: string[]
  description: string | null
  yearFrom: number | null
  yearTo: number | null
  attrs: Record<string, unknown>
  links: Partial<Record<LinkRelation, LinkTarget[]>>
  status: 'ACTIVE' | 'ARCHIVED'
  archiveReason: string | null
  usageCount: number
  createdAt: Date
  updatedAt: Date
  revision: number
}

export interface KnowledgeEntryData {
  slug: string
  name: string
  altNames: string[]
  description: string | null
  yearFrom: number | null
  yearTo: number | null
  attrs: Record<string, unknown>
}

export interface KnowledgeUsage {
  sourceType: RefSourceType | 'LINK' | 'MEDIA_ARTWORK'
  sourceId: string
  field: string
  title: string
}

export interface KnowledgeRepository {
  list(kind: KnowledgeKind | null, q: ListQuery): Promise<{ records: KnowledgeEntryRecord[]; total: number }>
  findById(id: string): Promise<KnowledgeEntryRecord | null>
  findTargets(ids: string[]): Promise<LinkTarget[]>
  findBySlugs(slugs: string[]): Promise<ResolvableEntry[]>
  slugTaken(kind: KnowledgeKind, slug: string, exceptId: string | null): Promise<boolean>
  insert(kind: KnowledgeKind, d: KnowledgeEntryData, createdBy: string): Promise<string>
  update(id: string, d: KnowledgeEntryData, revision: number): Promise<void>
  setLinks(id: string, links: Partial<Record<LinkRelation, string[]>>): Promise<void>
  setArchived(id: string, archived: boolean, by: string, reason: string | null): Promise<void>
  delete(id: string): Promise<void>
  usageCount(id: string): Promise<number>
  usages(id: string): Promise<KnowledgeUsage[]>
  /** Ссылки источника: content_references пересобираются целиком (ADR-010 п.4). */
  replaceRefs(sourceType: RefSourceType, sourceId: string, refs: { field: string; entryId: string }[]): Promise<void>
  refsOf(sourceType: RefSourceType, sourceId: string): Promise<string[]>
  /** Новая версия получает ссылки исходной (контент копируется без изменений). */
  copyRefs(sourceType: RefSourceType, fromId: string, toId: string): Promise<void>
}

export interface KnowledgeTx {
  knowledge: KnowledgeRepository
  audit: AuditWriter
}
