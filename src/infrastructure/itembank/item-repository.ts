import { sql, type RawBuilder } from 'kysely'
import type { ScopeFilter } from '../../domain/authorization/actor.js'
import type { ItemDocument, ItemOptionDoc } from '../../domain/itembank/interaction.js'
import { DomainError } from '../../domain/shared/errors.js'
import type {
  ItemListRow,
  ItemMeta,
  ItemRecord,
  ItemRelations,
  ItemRepository,
  ItemVersionRecord,
} from '../../application/itembank/ports.js'
import type { ListQuery } from '../../application/shared/query.js'
import type { Db } from '../db/kysely.js'
import { escapeLike, isUuid } from '../identity/user-repository.js'
import { upsertTags } from '../media/media-repository.js'

const own = (uid: string) =>
  sql<boolean>`(i.owner_id = ${uid} or exists (select 1 from item_versions av where av.item_id = i.id and ${uid} = any(av.author_ids)))`
const assignedVia = (uid: string) =>
  sql<boolean>`(i.assignment_id in (select a.id from assignments a where a.owner_id = ${uid} or a.default_reviewer_id = ${uid}))`
const teachesCourse = (uid: string) =>
  sql<boolean>`exists (select 1 from course_teachers ct where ct.course_id = i.course_id and ct.user_id = ${uid})`
const courseVisible = (uid: string) =>
  sql<boolean>`(${teachesCourse(uid)} and (i.assignment_id is not null or i.latest_approved_version_id is not null))`

const ITEM_SELECT = sql`
  i.*, qt.code as qt_code, qt.name as qt_name, qt.interaction_key, u.display_name as owner_name,
  a.title as assignment_title, c.name as course_name`
const ITEM_FROM = sql`items i
  join question_types qt on qt.id = i.question_type_id
  join users u on u.id = i.owner_id
  join courses c on c.id = i.course_id
  left join assignments a on a.id = i.assignment_id`

function toItem(r: any): ItemRecord {
  return {
    id: r.id,
    questionTypeId: r.question_type_id,
    questionTypeCode: r.qt_code,
    questionTypeName: r.qt_name,
    interactionKey: r.interaction_key,
    ownerId: r.owner_id,
    ownerName: r.owner_name,
    assignmentId: r.assignment_id,
    assignmentTitle: r.assignment_title ?? null,
    courseId: r.course_id,
    courseName: r.course_name,
    currentDraftVersionId: r.current_draft_version_id,
    latestApprovedVersionId: r.latest_approved_version_id,
    status: r.status,
    archiveReason: r.archive_reason,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    revision: r.revision,
  }
}

export class KyselyItemRepository implements ItemRepository {
  constructor(private readonly db: Db) {}

  async list(filter: ScopeFilter, q: ListQuery) {
    const f = q.filters
    const conds: RawBuilder<unknown>[] = []
    let full: RawBuilder<boolean> = sql<boolean>`true`
    if (filter.kind === 'SCOPED') {
      const ors: RawBuilder<boolean>[] = [sql<boolean>`false`]
      const fullOrs: RawBuilder<boolean>[] = [sql<boolean>`false`]
      if (filter.scopes.has('OWN')) {
        ors.push(own(filter.userId))
        fullOrs.push(own(filter.userId))
      }
      if (filter.scopes.has('ASSIGNED')) {
        ors.push(assignedVia(filter.userId))
        fullOrs.push(assignedVia(filter.userId))
      }
      if (filter.scopes.has('COURSE')) {
        ors.push(courseVisible(filter.userId))
        // вопросы заданий курса видны полностью; вопросы банка — только утвержденные версии
        fullOrs.push(sql<boolean>`(${teachesCourse(filter.userId)} and i.assignment_id is not null)`)
      }
      conds.push(sql`(${sql.join(ors, sql` or `)})`)
      full = sql<boolean>`(${sql.join(fullOrs, sql` or `)})`
    }
    const approvedOnly = f.versionMode === 'LATEST_APPROVED'
    const display = approvedOnly
      ? sql`i.latest_approved_version_id`
      : sql`case when ${full} then coalesce(i.current_draft_version_id, (select lv.id from item_versions lv where lv.item_id = i.id order by lv.version_no desc limit 1)) else i.latest_approved_version_id end`

    if (f.questionTypeId && isUuid(f.questionTypeId)) conds.push(sql`i.question_type_id = ${f.questionTypeId}`)
    if (f.ownerId && isUuid(f.ownerId)) conds.push(sql`i.owner_id = ${f.ownerId}`)
    if (f.assignmentId && isUuid(f.assignmentId)) conds.push(sql`i.assignment_id = ${f.assignmentId}`)
    if (f.courseId && isUuid(f.courseId)) conds.push(sql`i.course_id = ${f.courseId}`)
    if (f.includeArchived !== 'true') conds.push(sql`i.status = ${f.status === 'ARCHIVED' ? 'ARCHIVED' : 'ACTIVE'}`)
    if (approvedOnly) conds.push(sql`i.latest_approved_version_id is not null`)
    if (f.excludeItemIds) {
      const ex = f.excludeItemIds.split(',').filter(isUuid)
      if (ex.length) conds.push(sql`i.id not in (${sql.join(ex)})`)
    }
    const vconds: RawBuilder<unknown>[] = []
    if (f.state) vconds.push(sql`x.state = ${f.state}`)
    if (f.text || f.stem) vconds.push(sql`x.stem ilike ${'%' + escapeLike(f.text ?? f.stem!) + '%'}`)
    if (f.difficultyMin) vconds.push(sql`x.difficulty >= ${Number(f.difficultyMin)}`)
    if (f.difficultyMax) vconds.push(sql`x.difficulty <= ${Number(f.difficultyMax)}`)
    if (f.difficulty) vconds.push(sql`x.difficulty = ${Number(f.difficulty)}`)
    if (f.topicId && isUuid(f.topicId)) {
      vconds.push(sql`exists (select 1 from item_version_topics vt where vt.item_version_id = x.version_id and vt.topic_id in (
        with recursive sub(id) as (select ${f.topicId}::uuid union all select t.id from topics t join sub on t.parent_id = sub.id) select id from sub))`)
    }
    if (f.objectiveId && isUuid(f.objectiveId))
      vconds.push(
        sql`exists (select 1 from item_version_objectives vo where vo.item_version_id = x.version_id and vo.objective_id = ${f.objectiveId})`,
      )
    if (f.tag)
      vconds.push(
        sql`exists (select 1 from item_version_tags vg join tags tg on tg.id = vg.tag_id where vg.item_version_id = x.version_id and tg.normalized = ${f.tag.trim().toLowerCase()})`,
      )

    const where = conds.length ? sql`where ${sql.join(conds, sql` and `)}` : sql``
    const vwhere = vconds.length ? sql`where ${sql.join(vconds, sql` and `)}` : sql``
    const sortCol =
      {
        updatedAt: sql`x.updated_at`,
        difficulty: sql`x.difficulty`,
        type: sql`x.qt_name`,
        createdAt: sql`x.created_at`,
        state: sql`x.state`,
      }[q.sortBy ?? ''] ?? sql`x.updated_at`
    const dir = q.direction === 'asc' ? sql`asc` : sql`desc`
    const inner = sql`
      select ${ITEM_SELECT}, v.id as version_id, v.version_no, v.state, v.stem, v.difficulty,
        coalesce((select array_agg(t.name order by t.name) from item_version_topics vt join topics t on t.id = vt.topic_id where vt.item_version_id = v.id), '{}') as topic_names
      from ${ITEM_FROM}
      join item_versions v on v.id = (${display})
      ${where}`
    const rows =
      await sql<any>`select * from (${inner}) x ${vwhere} order by ${sortCol} ${dir}, x.id limit ${q.limit} offset ${q.offset}`.execute(
        this.db,
      )
    const total = await sql<{ n: string }>`select count(*) as n from (${inner}) x ${vwhere}`.execute(this.db)
    return {
      records: rows.rows.map((r): ItemListRow => ({
        ...toItem(r),
        versionId: r.version_id,
        versionNo: r.version_no,
        state: r.state,
        stem: r.stem,
        difficulty: r.difficulty,
        topicNames: r.topic_names ?? [],
      })),
      total: Number(total.rows[0]?.n ?? 0),
    }
  }

  async findById(id: string) {
    if (!isUuid(id)) return null
    const r = await sql<any>`select ${ITEM_SELECT} from ${ITEM_FROM} where i.id = ${id}`.execute(this.db)
    return r.rows[0] ? toItem(r.rows[0]) : null
  }

  async relations(userId: string, itemId: string): Promise<ItemRelations> {
    const r = await sql<{ own: boolean; assigned: boolean; teach: boolean }>`
      select ${own(userId)} as own, ${assignedVia(userId)} as assigned, ${teachesCourse(userId)} as teach from items i where i.id = ${itemId}`.execute(
      this.db,
    )
    const row = r.rows[0]
    return { own: !!row?.own, assignedViaAssignment: !!row?.assigned, courseTeacher: !!row?.teach }
  }

  async versions(itemId: string) {
    const rows = await this.db
      .selectFrom('item_versions')
      .select(['id', 'version_no', 'state', 'created_at', 'submitted_at', 'approved_at'])
      .where('item_id', '=', itemId)
      .orderBy('version_no')
      .execute()
    return rows.map((r) => ({
      id: r.id,
      versionNo: r.version_no,
      state: r.state,
      createdAt: r.created_at,
      submittedAt: r.submitted_at,
      approvedAt: r.approved_at,
    }))
  }

  async findVersion(id: string): Promise<ItemVersionRecord | null> {
    if (!isUuid(id)) return null
    const v = await this.db.selectFrom('item_versions').selectAll().where('id', '=', id).executeTakeFirst()
    if (!v) return null
    const [options, media, topics, objectives, tags] = await Promise.all([
      this.db
        .selectFrom('item_options')
        .selectAll()
        .where('item_version_id', '=', id)
        .orderBy('role')
        .orderBy('ordinal')
        .execute(),
      this.db.selectFrom('item_media').selectAll().where('item_version_id', '=', id).orderBy('ordinal').execute(),
      this.db.selectFrom('item_version_topics').select('topic_id').where('item_version_id', '=', id).execute(),
      this.db.selectFrom('item_version_objectives').select('objective_id').where('item_version_id', '=', id).execute(),
      this.db
        .selectFrom('item_version_tags')
        .innerJoin('tags', 'tags.id', 'item_version_tags.tag_id')
        .select('tags.name')
        .where('item_version_id', '=', id)
        .orderBy('tags.name')
        .execute(),
    ])
    const document: ItemDocument = {
      stem: v.stem,
      content: v.content as Record<string, unknown>,
      answerKey: v.answer_key as Record<string, unknown>,
      options: options.map((o) => ({
        key: o.key,
        role: o.role,
        text: o.text,
        mediaAssetId: o.media_asset_id,
        altTextOverride: o.alt_text_override,
        ordinal: o.ordinal,
      })),
      media: media.map((m) => ({
        mediaAssetId: m.media_asset_id,
        role: m.role,
        altTextOverride: m.alt_text_override,
        ordinal: m.ordinal,
      })),
    }
    const meta: ItemMeta = {
      defaultPoints: Number(v.default_points),
      difficulty: v.difficulty,
      feedback: v.feedback,
      topicIds: topics.map((t) => t.topic_id),
      objectiveIds: objectives.map((o) => o.objective_id),
      tags: tags.map((t) => t.name),
    }
    return {
      id: v.id,
      itemId: v.item_id,
      versionNo: v.version_no,
      basedOnVersionId: v.based_on_version_id,
      questionTypeVersionId: v.question_type_version_id,
      state: v.state,
      document,
      meta,
      authorIds: v.author_ids,
      everSubmitted: v.ever_submitted,
      submittedAt: v.submitted_at,
      approvedAt: v.approved_at,
      approvedBy: v.approved_by,
      contentHash: v.content_hash,
      createdAt: v.created_at,
      updatedAt: v.updated_at,
      revision: v.revision,
    }
  }

  async insertItem(d: { questionTypeId: string; ownerId: string; assignmentId: string | null; courseId: string }) {
    const r = await this.db
      .insertInto('items')
      .values({
        question_type_id: d.questionTypeId,
        owner_id: d.ownerId,
        assignment_id: d.assignmentId,
        course_id: d.courseId,
      })
      .returning('id')
      .executeTakeFirstOrThrow()
    return r.id
  }

  async insertVersion(d: Parameters<ItemRepository['insertVersion']>[0]) {
    const r = await this.db
      .insertInto('item_versions')
      .values({
        item_id: d.itemId,
        version_no: d.versionNo,
        based_on_version_id: d.basedOnVersionId,
        question_type_version_id: d.questionTypeVersionId,
        stem: d.document.stem,
        content: JSON.stringify(d.document.content),
        answer_key: JSON.stringify(d.document.answerKey),
        default_points: d.meta.defaultPoints,
        difficulty: d.meta.difficulty,
        feedback: d.meta.feedback,
        author_ids: d.authorIds,
      })
      .returning('id')
      .executeTakeFirstOrThrow()
    await this.writeChildren(r.id, d.document, d.meta)
    return r.id
  }

  private async writeChildren(versionId: string, doc: ItemDocument, meta: ItemMeta) {
    if (doc.options.length) {
      await this.db
        .insertInto('item_options')
        .values(
          doc.options.map((o: ItemOptionDoc) => ({
            item_version_id: versionId,
            key: o.key,
            role: o.role,
            text: o.text,
            media_asset_id: o.mediaAssetId,
            alt_text_override: o.altTextOverride,
            ordinal: o.ordinal,
          })),
        )
        .execute()
    }
    const media = [...new Map(doc.media.map((m) => [m.mediaAssetId, m])).values()]
    if (media.length) {
      await this.db
        .insertInto('item_media')
        .values(
          media.map((m) => ({
            item_version_id: versionId,
            media_asset_id: m.mediaAssetId,
            role: m.role,
            alt_text_override: m.altTextOverride,
            ordinal: m.ordinal,
          })),
        )
        .execute()
    }
    if (meta.topicIds.length)
      await this.db
        .insertInto('item_version_topics')
        .values(meta.topicIds.map((topic_id) => ({ item_version_id: versionId, topic_id })))
        .execute()
    if (meta.objectiveIds.length) {
      await this.db
        .insertInto('item_version_objectives')
        .values(meta.objectiveIds.map((objective_id) => ({ item_version_id: versionId, objective_id })))
        .execute()
    }
    const tagIds = await upsertTags(this.db, meta.tags)
    if (tagIds.length)
      await this.db
        .insertInto('item_version_tags')
        .values(tagIds.map((tag_id) => ({ item_version_id: versionId, tag_id })))
        .execute()
  }

  async replaceDraftContent(versionId: string, document: ItemDocument, meta: ItemMeta, expectedRevision: number) {
    const r = await this.db
      .updateTable('item_versions')
      .set({
        stem: document.stem,
        content: JSON.stringify(document.content),
        answer_key: JSON.stringify(document.answerKey),
        default_points: meta.defaultPoints,
        difficulty: meta.difficulty,
        feedback: meta.feedback,
        updated_at: new Date(),
        revision: sql<number>`revision + 1`,
      })
      .where('id', '=', versionId)
      .where('state', '=', 'DRAFT')
      .where('revision', '=', expectedRevision)
      .executeTakeFirst()
    if (Number(r.numUpdatedRows) === 0) {
      const cur = await this.db
        .selectFrom('item_versions')
        .select(['state'])
        .where('id', '=', versionId)
        .executeTakeFirst()
      if (!cur) throw DomainError.notFound()
      if (cur.state !== 'DRAFT')
        throw new DomainError('INVALID_STATE', 'Версия заморожена (BR-007)', { ruleId: 'BR-007' })
      throw DomainError.conflict()
    }
    for (const t of [
      'item_options',
      'item_media',
      'item_version_topics',
      'item_version_objectives',
      'item_version_tags',
    ] as const) {
      await this.db.deleteFrom(t).where('item_version_id', '=', versionId).execute()
    }
    await this.writeChildren(versionId, document, meta)
  }

  async setVersionState(versionId: string, d: Parameters<ItemRepository['setVersionState']>[1]) {
    const values: Record<string, unknown> = {
      state: d.state,
      updated_at: new Date(),
      revision: sql<number>`revision + 1`,
    }
    if (d.submittedAt !== undefined) values.submitted_at = d.submittedAt
    if (d.approvedAt !== undefined) values.approved_at = d.approvedAt
    if (d.approvedBy !== undefined) values.approved_by = d.approvedBy
    if (d.contentHash !== undefined) values.content_hash = d.contentHash
    if (d.everSubmitted !== undefined) values.ever_submitted = d.everSubmitted
    if (d.archiveReason !== undefined) values.archive_reason = d.archiveReason
    await this.db
      .updateTable('item_versions')
      .set(values as any)
      .where('id', '=', versionId)
      .execute()
  }

  async setItemPointers(
    itemId: string,
    d: { currentDraftVersionId?: string | null; latestApprovedVersionId?: string | null },
  ) {
    const values: Record<string, unknown> = { updated_at: new Date(), revision: sql<number>`revision + 1` }
    if (d.currentDraftVersionId !== undefined) values.current_draft_version_id = d.currentDraftVersionId
    if (d.latestApprovedVersionId !== undefined) values.latest_approved_version_id = d.latestApprovedVersionId
    await this.db
      .updateTable('items')
      .set(values as any)
      .where('id', '=', itemId)
      .execute()
  }

  async setItemArchived(itemId: string, archived: boolean, by: string, reason: string | null) {
    await this.db
      .updateTable('items')
      .set({
        status: archived ? 'ARCHIVED' : 'ACTIVE',
        archived_at: archived ? new Date() : null,
        archived_by: archived ? by : null,
        archive_reason: archived ? reason : null,
        updated_at: new Date(),
        revision: sql<number>`revision + 1`,
      })
      .where('id', '=', itemId)
      .execute()
  }

  async deleteVersion(versionId: string) {
    await this.db.deleteFrom('item_versions').where('id', '=', versionId).execute()
  }

  async deleteItem(itemId: string) {
    await this.db.deleteFrom('items').where('id', '=', itemId).execute()
  }

  async maxVersionNo(itemId: string) {
    const r = await this.db
      .selectFrom('item_versions')
      .select(sql<number>`coalesce(max(version_no), 0)`.as('n'))
      .where('item_id', '=', itemId)
      .executeTakeFirstOrThrow()
    return Number(r.n)
  }

  async versionReferencedOutsideDraftTests(_versionId: string) {
    return false // M4: ссылки из TestSectionItem / SelectionPoolEntry не-DRAFT версий тестов
  }

  async countStudentItemsInAssignment(assignmentId: string, ownerId: string) {
    const r = await this.db
      .selectFrom('items')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('assignment_id', '=', assignmentId)
      .where('owner_id', '=', ownerId)
      .where('status', '=', 'ACTIVE')
      .executeTakeFirstOrThrow()
    return Number(r.n)
  }
}
