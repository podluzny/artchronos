import { sql, type Expression, type SqlBool } from 'kysely'
import type { ScopeFilter } from '../../domain/authorization/actor.js'
import { normalizeTag } from '../../domain/media/media-rules.js'
import { DomainError } from '../../domain/shared/errors.js'
import type { MediaMetadata, MediaRecord, MediaRepository, MediaUsage } from '../../application/media/ports.js'
import type { ListQuery } from '../../application/shared/query.js'
import type { Db } from '../db/kysely.js'
import { escapeLike, isUuid } from '../identity/user-repository.js'

const COLS: Record<keyof MediaMetadata, string> = {
  title: 'title',
  altText: 'alt_text',
  caption: 'caption',
  transcript: 'transcript',
  depictsArtwork: 'depicts_artwork',
  artist: 'artist',
  workTitle: 'work_title',
  dateText: 'date_text',
  technique: 'technique',
  collection: 'collection',
  inventoryNo: 'inventory_no',
  sourceUrl: 'source_url',
  sourceDescription: 'source_description',
  license: 'license',
  rightsHolder: 'rights_holder',
  creditLine: 'credit_line',
  rightsNote: 'rights_note',
}

export class KyselyMediaRepository implements MediaRepository {
  constructor(private readonly db: Db) {}

  private base() {
    return this.db
      .selectFrom('media_assets as m')
      .innerJoin('users as u', 'u.id', 'm.owner_id')
      .selectAll('m')
      .select([
        'u.display_name as owner_name',
        sql<
          { variant: string; storageKey: string; mimeType: string }[]
        >`coalesce((select json_agg(json_build_object('variant', d.variant, 'storageKey', d.storage_key, 'mimeType', d.mime_type)) from media_derivatives d where d.media_id = m.id), '[]'::json)`.as(
          'derivatives',
        ),
        sql<
          string[]
        >`coalesce((select array_agg(t.name order by t.name) from media_tags mt join tags t on t.id = mt.tag_id where mt.media_id = m.id), '{}')`.as(
          'tag_names',
        ),
        sql<string[]>`coalesce((select array_agg(mt.topic_id) from media_topics mt where mt.media_id = m.id), '{}')`.as(
          'topic_ids',
        ),
      ])
  }

  private toRecord(r: any): MediaRecord {
    const meta = Object.fromEntries(Object.entries(COLS).map(([k, c]) => [k, r[c]])) as unknown as MediaMetadata
    return {
      ...meta,
      id: r.id,
      kind: r.kind,
      storageKey: r.storage_key,
      mimeType: r.mime_type,
      sizeBytes: Number(r.size_bytes),
      sha256: r.sha256,
      width: r.width,
      height: r.height,
      rightsStatus: r.rights_status,
      rightsVerifiedBy: r.rights_verified_by,
      rightsVerifiedAt: r.rights_verified_at,
      ownerId: r.owner_id,
      ownerName: r.owner_name,
      derivativesStatus: r.derivatives_status,
      derivatives: r.derivatives ?? [],
      status: r.status,
      archiveReason: r.archive_reason,
      tags: r.tag_names ?? [],
      topicIds: r.topic_ids ?? [],
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      revision: r.revision,
    }
  }

  async list(filter: ScopeFilter, q: ListQuery) {
    const f = q.filters
    const base = this.base().where((eb) => {
      const c: Expression<SqlBool>[] = []
      if (filter.kind === 'SCOPED' && !filter.scopes.has('ANY')) c.push(eb('m.owner_id', '=', filter.userId))
      if (f.text || f.title) {
        const t = f.text ?? f.title!
        c.push(
          sql<SqlBool>`(m.title ilike ${'%' + escapeLike(t) + '%'} or m.artist ilike ${'%' + escapeLike(t) + '%'} or m.work_title ilike ${'%' + escapeLike(t) + '%'}
            or to_tsvector('russian', coalesce(m.title,'') || ' ' || coalesce(m.artist,'') || ' ' || coalesce(m.work_title,'') || ' ' || coalesce(m.caption,'')) @@ plainto_tsquery('russian', ${t}))`,
        )
      }
      if (f.artist) c.push(eb('m.artist', 'ilike', `%${escapeLike(f.artist)}%`))
      if (f.kind) c.push(eb('m.kind', '=', f.kind as 'IMAGE' | 'VIDEO'))
      if (f.rightsStatus) c.push(eb('m.rights_status', '=', f.rightsStatus as 'PENDING'))
      if (f.license) c.push(eb('m.license', '=', f.license as 'UNKNOWN'))
      if (f.ownerId && isUuid(f.ownerId)) c.push(eb('m.owner_id', '=', f.ownerId))
      if (f.tag)
        c.push(
          sql<SqlBool>`exists (select 1 from media_tags mt join tags t on t.id = mt.tag_id where mt.media_id = m.id and t.normalized = ${normalizeTag(f.tag)})`,
        )
      if (f.topicId && isUuid(f.topicId))
        c.push(
          sql<SqlBool>`exists (select 1 from media_topics mt where mt.media_id = m.id and mt.topic_id = ${f.topicId})`,
        )
      if (f.selectable === 'true') c.push(sql<SqlBool>`m.rights_status <> 'RESTRICTED'`)
      c.push(eb('m.status', '=', (f.status as 'ACTIVE' | 'ARCHIVED') ?? 'ACTIVE'))
      return eb.and(c)
    })
    const [rows, total] = await Promise.all([
      base
        .orderBy('m.created_at', q.direction === 'asc' ? 'asc' : 'desc')
        .orderBy('m.id')
        .limit(q.limit)
        .offset(q.offset)
        .execute(),
      this.db
        .selectFrom(base.as('x'))
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .executeTakeFirstOrThrow(),
    ])
    return { records: rows.map((r) => this.toRecord(r)), total: Number(total.n) }
  }

  async findById(id: string) {
    if (!isUuid(id)) return null
    const r = await this.base().where('m.id', '=', id).executeTakeFirst()
    return r ? this.toRecord(r) : null
  }

  async findByIds(ids: string[]) {
    const valid = [...new Set(ids.filter(isUuid))]
    if (!valid.length) return []
    const rows = await this.base().where('m.id', 'in', valid).execute()
    return rows.map((r) => this.toRecord(r))
  }

  async findBySha(sha: string) {
    const r = await this.base().where('m.sha256', '=', sha).where('m.status', '=', 'ACTIVE').executeTakeFirst()
    return r ? this.toRecord(r) : null
  }

  async insert(d: Parameters<MediaRepository['insert']>[0]) {
    const values: Record<string, unknown> = {
      kind: d.kind,
      storage_key: d.storageKey,
      mime_type: d.mimeType,
      size_bytes: d.sizeBytes,
      sha256: d.sha256,
      width: d.width,
      height: d.height,
      owner_id: d.ownerId,
      rights_status: 'PENDING',
    }
    for (const [k, c] of Object.entries(COLS)) values[c] = (d as unknown as Record<string, unknown>)[k] ?? null
    if (values.depicts_artwork === null) values.depicts_artwork = true
    if (values.license === null) values.license = 'UNKNOWN'
    const r = await this.db
      .insertInto('media_assets')
      .values(values as any)
      .returning('id')
      .executeTakeFirstOrThrow()
    return r.id
  }

  async updateMetadata(id: string, d: Parameters<MediaRepository['updateMetadata']>[1], revision: number) {
    const values: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(d)) {
      if (v === undefined) continue
      const col =
        (COLS as Record<string, string>)[k] ??
        {
          rightsStatus: 'rights_status',
          rightsVerifiedBy: 'rights_verified_by',
          rightsVerifiedAt: 'rights_verified_at',
        }[k]
      if (col) values[col] = v
    }
    const r = await this.db
      .updateTable('media_assets')
      .set({ ...values, updated_at: new Date(), revision: sql<number>`revision + 1` } as any)
      .where('id', '=', id)
      .where('revision', '=', revision)
      .executeTakeFirst()
    if (Number(r.numUpdatedRows) === 0)
      throw (await this.findById(id)) ? DomainError.conflict() : DomainError.notFound()
  }

  async setDerivatives(
    id: string,
    status: MediaRecord['derivativesStatus'],
    items: { variant: string; storageKey: string; mimeType: string; width: number; height: number }[],
  ) {
    await this.db.deleteFrom('media_derivatives').where('media_id', '=', id).execute()
    if (items.length) {
      await this.db
        .insertInto('media_derivatives')
        .values(
          items.map((i) => ({
            media_id: id,
            variant: i.variant as 'THUMB',
            storage_key: i.storageKey,
            mime_type: i.mimeType,
            width: i.width,
            height: i.height,
          })),
        )
        .execute()
    }
    await this.db.updateTable('media_assets').set({ derivatives_status: status }).where('id', '=', id).execute()
  }

  async setTags(id: string, names: string[]) {
    await this.db.deleteFrom('media_tags').where('media_id', '=', id).execute()
    for (const tagId of await upsertTags(this.db, names)) {
      await this.db
        .insertInto('media_tags')
        .values({ media_id: id, tag_id: tagId })
        .onConflict((oc) => oc.doNothing())
        .execute()
    }
  }

  async setTopics(id: string, topicIds: string[]) {
    await this.db.deleteFrom('media_topics').where('media_id', '=', id).execute()
    const valid = [...new Set(topicIds.filter(isUuid))]
    if (valid.length)
      await this.db
        .insertInto('media_topics')
        .values(valid.map((topic_id) => ({ media_id: id, topic_id })))
        .execute()
  }

  async setArchived(id: string, archived: boolean, by: string, reason: string | null) {
    await this.db
      .updateTable('media_assets')
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

  async usage(id: string): Promise<MediaUsage[]> {
    const r = await sql<{
      item_id: string
      item_version_id: string
      version_no: number
      state: string
      via: 'OPTION' | 'MEDIA'
    }>`
      select v.item_id, v.id as item_version_id, v.version_no, v.state, 'OPTION' as via from item_options o join item_versions v on v.id = o.item_version_id where o.media_asset_id = ${id}
      union
      select v.item_id, v.id, v.version_no, v.state, 'MEDIA' from item_media im join item_versions v on v.id = im.item_version_id where im.media_asset_id = ${id}
      order by 1, 3`.execute(this.db)
    return r.rows.map((x) => ({
      itemId: x.item_id,
      itemVersionId: x.item_version_id,
      versionNo: x.version_no,
      state: x.state,
      via: x.via,
    }))
  }

  async delete(id: string) {
    await this.db.deleteFrom('media_tags').where('media_id', '=', id).execute()
    await this.db.deleteFrom('media_topics').where('media_id', '=', id).execute()
    await this.db.deleteFrom('media_derivatives').where('media_id', '=', id).execute()
    await this.db.deleteFrom('media_assets').where('id', '=', id).execute()
  }
}

/** Создает отсутствующие теги, возвращает их id (нормализация — media-rules.normalizeTag). */
export async function upsertTags(db: Db, names: string[]): Promise<string[]> {
  const ids: string[] = []
  const seen = new Set<string>()
  for (const raw of names) {
    const name = raw.trim().slice(0, 60)
    const norm = normalizeTag(name)
    if (!norm || seen.has(norm)) continue
    seen.add(norm)
    const r = await db
      .insertInto('tags')
      .values({ name, normalized: norm })
      .onConflict((oc) => oc.column('normalized').doUpdateSet({ normalized: norm }))
      .returning('id')
      .executeTakeFirstOrThrow()
    ids.push(r.id)
  }
  return ids
}
