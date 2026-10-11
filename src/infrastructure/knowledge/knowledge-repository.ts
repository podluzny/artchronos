import { sql, type Expression, type SqlBool } from 'kysely'
import type {
  KnowledgeEntryData,
  KnowledgeEntryRecord,
  KnowledgeRepository,
  KnowledgeUsage,
  LinkTarget,
  RefSourceType,
} from '../../application/knowledge/ports.js'
import type { ListQuery } from '../../application/shared/query.js'
import type { ResolvableEntry } from '../../domain/knowledge/anchors.js'
import type { KnowledgeKind, LinkRelation } from '../../domain/knowledge/knowledge.js'
import { DomainError } from '../../domain/shared/errors.js'
import type { Db } from '../db/kysely.js'
import { escapeLike, isUuid } from '../identity/user-repository.js'

const like = (v: string) => `%${escapeLike(v)}%`

/** Число ссылок на объект: якоря в контенте, связи других объектов, медиа (BR-047). */
const usageSql = (col: string) => sql<string>`(
  (select count(*) from content_references cr where cr.entry_id = ${sql.ref(col)})
  + (select count(*) from knowledge_links kl where kl.to_id = ${sql.ref(col)})
  + (select count(*) from media_assets ma where ma.artwork_id = ${sql.ref(col)}))`

export class KyselyKnowledgeRepository implements KnowledgeRepository {
  constructor(private readonly db: Db) {}

  private base() {
    return this.db.selectFrom('knowledge_entries as k').selectAll('k').select(usageSql('k.id').as('usage_count'))
  }

  private async withLinks(rows: any[]): Promise<KnowledgeEntryRecord[]> {
    const ids = rows.map((r) => r.id as string)
    const links = ids.length
      ? await this.db
          .selectFrom('knowledge_links as l')
          .innerJoin('knowledge_entries as t', 't.id', 'l.to_id')
          .select(['l.from_id', 'l.relation', 't.id', 't.kind', 't.name', 't.status'])
          .where('l.from_id', 'in', ids)
          .orderBy('l.ordinal')
          .orderBy('t.name')
          .execute()
      : []
    return rows.map((r) => {
      const own: Partial<Record<LinkRelation, LinkTarget[]>> = {}
      for (const l of links.filter((x) => x.from_id === r.id)) {
        const rel = l.relation as LinkRelation
        ;(own[rel] ??= []).push({ id: l.id, kind: l.kind, name: l.name, status: l.status })
      }
      return {
        id: r.id,
        kind: r.kind,
        slug: r.slug,
        name: r.name,
        altNames: r.alt_names ?? [],
        description: r.description,
        yearFrom: r.year_from,
        yearTo: r.year_to,
        attrs: (r.attrs ?? {}) as Record<string, unknown>,
        links: own,
        status: r.status,
        archiveReason: r.archive_reason,
        usageCount: Number(r.usage_count ?? 0),
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        revision: r.revision,
      }
    })
  }

  async list(kind: KnowledgeKind | null, q: ListQuery) {
    const f = q.filters
    const base = this.base().where((eb) => {
      const c: Expression<SqlBool>[] = []
      if (kind) c.push(eb('k.kind', '=', kind))
      if (f.kind) c.push(eb('k.kind', '=', f.kind as KnowledgeKind))
      if (f.id) c.push(isUuid(f.id) ? eb('k.id', '=', f.id) : sql<SqlBool>`false`)
      const text = f.q ?? f.name
      if (text)
        c.push(
          sql<SqlBool>`(k.name ilike ${like(text)} or k.slug ilike ${like(text)}
            or exists (select 1 from unnest(k.alt_names) a where a ilike ${like(text)}))`,
        )
      if (f.slug) c.push(eb('k.slug', 'ilike', like(f.slug)))
      c.push(eb('k.status', '=', (f.status as 'ACTIVE' | 'ARCHIVED') ?? 'ACTIVE'))
      return eb.and(c)
    })
    const dir = q.direction === 'desc' ? 'desc' : 'asc'
    const sortCol = q.sortBy === 'slug' ? 'k.slug' : q.sortBy === 'yearFrom' ? 'k.year_from' : 'k.name'
    const [rows, total] = await Promise.all([
      base.orderBy(sortCol, dir).orderBy('k.id').limit(q.limit).offset(q.offset).execute(),
      this.db
        .selectFrom(base.as('t'))
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .executeTakeFirstOrThrow(),
    ])
    return { records: await this.withLinks(rows), total: Number(total.n) }
  }

  async findById(id: string) {
    if (!isUuid(id)) return null
    const r = await this.base().where('k.id', '=', id).executeTakeFirst()
    return r ? (await this.withLinks([r]))[0]! : null
  }

  async findTargets(ids: string[]): Promise<LinkTarget[]> {
    const valid = ids.filter(isUuid)
    if (!valid.length) return []
    return this.db
      .selectFrom('knowledge_entries')
      .select(['id', 'kind', 'name', 'status'])
      .where('id', 'in', valid)
      .execute() as Promise<LinkTarget[]>
  }

  async findBySlugs(slugs: string[]): Promise<ResolvableEntry[]> {
    const list = [...new Set(slugs.map((s) => s.toLowerCase()))]
    if (!list.length) return []
    return this.db
      .selectFrom('knowledge_entries')
      .select(['id', 'kind', 'slug', 'name', 'status'])
      .where('slug', 'in', list)
      .execute() as Promise<ResolvableEntry[]>
  }

  async slugTaken(kind: KnowledgeKind, slug: string, exceptId: string | null) {
    let q = this.db.selectFrom('knowledge_entries').select('id').where('kind', '=', kind).where('slug', '=', slug)
    if (exceptId) q = q.where('id', '<>', exceptId)
    return !!(await q.executeTakeFirst())
  }

  private values(d: KnowledgeEntryData) {
    return {
      slug: d.slug,
      name: d.name,
      alt_names: d.altNames,
      description: d.description,
      year_from: d.yearFrom,
      year_to: d.yearTo,
      attrs: JSON.stringify(d.attrs),
    }
  }

  async insert(kind: KnowledgeKind, d: KnowledgeEntryData, createdBy: string) {
    const r = await this.db
      .insertInto('knowledge_entries')
      .values({ kind, ...this.values(d), created_by: createdBy })
      .returning('id')
      .executeTakeFirstOrThrow()
    return r.id
  }

  async update(id: string, d: KnowledgeEntryData, revision: number) {
    const r = await this.db
      .updateTable('knowledge_entries')
      .set({ ...this.values(d), updated_at: new Date(), revision: sql<number>`revision + 1` })
      .where('id', '=', id)
      .where('revision', '=', revision)
      .executeTakeFirst()
    if (Number(r.numUpdatedRows) === 0) {
      const exists = await this.db.selectFrom('knowledge_entries').select('id').where('id', '=', id).executeTakeFirst()
      throw exists ? DomainError.conflict() : DomainError.notFound()
    }
  }

  async setLinks(id: string, links: Partial<Record<LinkRelation, string[]>>) {
    await this.db.deleteFrom('knowledge_links').where('from_id', '=', id).execute()
    const rows = Object.entries(links).flatMap(([relation, ids]) =>
      [...new Set(ids ?? [])].map((to_id, ordinal) => ({ from_id: id, to_id, relation, ordinal })),
    )
    if (rows.length) await this.db.insertInto('knowledge_links').values(rows).execute()
  }

  async setArchived(id: string, archived: boolean, by: string, reason: string | null) {
    await this.db
      .updateTable('knowledge_entries')
      .set({
        status: archived ? 'ARCHIVED' : 'ACTIVE',
        archived_at: archived ? new Date() : null,
        archived_by: archived ? by : null,
        archive_reason: archived ? reason : null,
        updated_at: new Date(),
        revision: sql<number>`revision + 1`,
      })
      .where('id', '=', id)
      .execute()
  }

  async delete(id: string) {
    await this.db.deleteFrom('knowledge_entries').where('id', '=', id).execute()
  }

  async usageCount(id: string) {
    const r = await sql<{
      n: string
    }>`select ${usageSql('k.id')} as n from knowledge_entries k where k.id = ${id}`.execute(this.db)
    return Number(r.rows[0]?.n ?? 0)
  }

  async usages(id: string): Promise<KnowledgeUsage[]> {
    const r = await sql<KnowledgeUsage>`
      select cr.source_type as "sourceType", cr.source_id::text as "sourceId", cr.field,
        case cr.source_type
          when 'ITEM_VERSION' then (select 'Вопрос v' || iv.version_no || ': ' || left(regexp_replace(iv.stem, '<[^>]*>', '', 'g'), 80)
                                    from item_versions iv where iv.id = cr.source_id)
          when 'TEST_VERSION' then (select tv.title || ' v' || tv.version_no from test_versions tv where tv.id = cr.source_id)
          when 'ASSIGNMENT' then (select a.title from assignments a where a.id = cr.source_id)
          when 'MEDIA' then (select m.title from media_assets m where m.id = cr.source_id)
          when 'KNOWLEDGE' then (select e.name from knowledge_entries e where e.id = cr.source_id)
        end as title
      from content_references cr where cr.entry_id = ${id}
      union all
      select 'LINK', l.from_id::text, l.relation, e.name
      from knowledge_links l join knowledge_entries e on e.id = l.from_id where l.to_id = ${id}
      union all
      select 'MEDIA_ARTWORK', m.id::text, 'artworkId', m.title from media_assets m where m.artwork_id = ${id}
      order by 1, 4`.execute(this.db)
    return r.rows.map((x) => ({ ...x, title: x.title ?? '—' }))
  }

  async replaceRefs(sourceType: RefSourceType, sourceId: string, refs: { field: string; entryId: string }[]) {
    await this.db
      .deleteFrom('content_references')
      .where('source_type', '=', sourceType)
      .where('source_id', '=', sourceId)
      .execute()
    const uniq = new Map(refs.map((r) => [`${r.field}|${r.entryId}`, r]))
    if (uniq.size)
      await this.db
        .insertInto('content_references')
        .values(
          [...uniq.values()].map((r) => ({
            source_type: sourceType,
            source_id: sourceId,
            field: r.field,
            entry_id: r.entryId,
          })),
        )
        .execute()
  }

  async refsOf(sourceType: RefSourceType, sourceId: string) {
    const rows = await this.db
      .selectFrom('content_references')
      .select('entry_id')
      .where('source_type', '=', sourceType)
      .where('source_id', '=', sourceId)
      .execute()
    return [...new Set(rows.map((r) => r.entry_id))]
  }

  async copyRefs(sourceType: RefSourceType, fromId: string, toId: string) {
    await sql`insert into content_references (source_type, source_id, field, entry_id)
      select source_type, ${toId}::uuid, field, entry_id from content_references
      where source_type = ${sourceType} and source_id = ${fromId}::uuid
      on conflict do nothing`.execute(this.db)
  }
}
