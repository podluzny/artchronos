import { sql, type RawBuilder } from 'kysely'
import type {
  AssignmentSummaryRow,
  FixedItemRecord,
  RuleRecord,
  SectionRecord,
  TestListRow,
  TestRecord,
  TestRelations,
  TestRepository,
  TestStructure,
  TestVersionRecord,
} from '../../application/assessment/ports.js'
import type { ListQuery } from '../../application/shared/query.js'
import type { ScopeFilter } from '../../domain/authorization/actor.js'
import { DEFAULT_TEST_SETTINGS, type SelectionFilter, type TestSettings } from '../../domain/assessment/test-rules.js'
import { DomainError } from '../../domain/shared/errors.js'
import type { Db } from '../db/kysely.js'
import { escapeLike, isUuid } from '../identity/user-repository.js'

const own = (uid: string) =>
  sql<boolean>`(t.owner_id = ${uid} or exists (select 1 from test_versions av where av.test_id = t.id and ${uid} = any(av.author_ids)))`
/** ASSIGNED: тест задания, которое ведет пользователь, или тест, назначенный ему на экспертизу. */
const assignedVia = (uid: string) =>
  sql<boolean>`(t.assignment_id in (select a.id from assignments a where a.owner_id = ${uid} or a.default_reviewer_id = ${uid})
    or exists (select 1 from reviews rv join review_assignments ra on ra.review_id = rv.id
      where rv.test_id = t.id and ra.reviewer_id = ${uid} and ra.status in ('ACTIVE','COMPLETED')))`
const teachesCourse = (uid: string) =>
  sql<boolean>`exists (select 1 from course_teachers ct where ct.course_id = t.course_id and ct.user_id = ${uid})`
/** Тесты студентов курса и утвержденные/опубликованные тесты коллег. */
const courseVisible = (uid: string) =>
  sql<boolean>`(${teachesCourse(uid)} and (t.assignment_id is not null or exists (select 1 from test_versions cv where cv.test_id = t.id and cv.state in ('APPROVED','PUBLISHED'))))`

const TEST_SELECT = sql`t.*, u.display_name as owner_name, a.title as assignment_title, c.name as course_name`
const TEST_FROM = sql`tests t
  join users u on u.id = t.owner_id
  join courses c on c.id = t.course_id
  left join assignments a on a.id = t.assignment_id`

function toTest(r: any): TestRecord {
  return {
    id: r.id,
    title: r.title,
    ownerId: r.owner_id,
    ownerName: r.owner_name,
    assignmentId: r.assignment_id,
    assignmentTitle: r.assignment_title ?? null,
    courseId: r.course_id,
    courseName: r.course_name,
    currentDraftVersionId: r.current_draft_version_id,
    publishedVersionId: r.published_version_id,
    status: r.status,
    archiveReason: r.archive_reason,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    revision: r.revision,
  }
}

function toSettings(raw: unknown): TestSettings {
  const s = (raw ?? {}) as Partial<TestSettings>
  return {
    ...DEFAULT_TEST_SETTINGS,
    ...s,
    scoring: { ...DEFAULT_TEST_SETTINGS.scoring, ...(s.scoring ?? {}) },
  }
}

export function toFilter(raw: unknown): SelectionFilter {
  const f = (raw ?? {}) as Partial<SelectionFilter>
  return {
    topicIds: f.topicIds ?? [],
    objectiveIds: f.objectiveIds ?? [],
    tags: f.tags ?? [],
    questionTypeIds: f.questionTypeIds ?? [],
    difficultyMin: f.difficultyMin ?? null,
    difficultyMax: f.difficultyMax ?? null,
  }
}

export class KyselyTestRepository implements TestRepository {
  constructor(private readonly db: Db) {}

  async list(filter: ScopeFilter, q: ListQuery) {
    const f = q.filters
    const conds: RawBuilder<unknown>[] = []
    if (filter.kind === 'SCOPED') {
      const ors: RawBuilder<boolean>[] = [sql<boolean>`false`]
      if (filter.scopes.has('OWN')) ors.push(own(filter.userId))
      if (filter.scopes.has('ASSIGNED')) ors.push(assignedVia(filter.userId))
      if (filter.scopes.has('COURSE')) ors.push(courseVisible(filter.userId))
      conds.push(sql`(${sql.join(ors, sql` or `)})`)
    }
    if (f.assignmentId && isUuid(f.assignmentId)) conds.push(sql`t.assignment_id = ${f.assignmentId}`)
    if (f.courseId && isUuid(f.courseId)) conds.push(sql`t.course_id = ${f.courseId}`)
    if (f.ownerId && isUuid(f.ownerId)) conds.push(sql`t.owner_id = ${f.ownerId}`)
    if (f.title) conds.push(sql`t.title ilike ${'%' + escapeLike(f.title) + '%'}`)
    if (f.includeArchived !== 'true') conds.push(sql`t.status = ${f.status === 'ARCHIVED' ? 'ARCHIVED' : 'ACTIVE'}`)
    const vconds: RawBuilder<unknown>[] = []
    if (f.state) vconds.push(sql`x.state = ${f.state}`)
    const where = conds.length ? sql`where ${sql.join(conds, sql` and `)}` : sql``
    const vwhere = vconds.length ? sql`where ${sql.join(vconds, sql` and `)}` : sql``
    const sortCol =
      { title: sql`x.title`, createdAt: sql`x.created_at`, state: sql`x.state`, updatedAt: sql`x.updated_at` }[
        q.sortBy ?? ''
      ] ?? sql`x.updated_at`
    const dir = q.direction === 'asc' ? sql`asc` : sql`desc`
    const inner = sql`
      select ${TEST_SELECT}, v.id as version_id, v.version_no, v.state
      from ${TEST_FROM}
      join test_versions v on v.id = (select lv.id from test_versions lv where lv.test_id = t.id order by lv.version_no desc limit 1)
      ${where}`
    const rows =
      await sql<any>`select * from (${inner}) x ${vwhere} order by ${sortCol} ${dir}, x.id limit ${q.limit} offset ${q.offset}`.execute(
        this.db,
      )
    const total = await sql<{ n: string }>`select count(*) as n from (${inner}) x ${vwhere}`.execute(this.db)
    return {
      records: rows.rows.map((r): TestListRow => ({
        ...toTest(r),
        versionId: r.version_id,
        versionNo: r.version_no,
        state: r.state,
      })),
      total: Number(total.rows[0]?.n ?? 0),
    }
  }

  async findById(id: string) {
    if (!isUuid(id)) return null
    const r = await sql<any>`select ${TEST_SELECT} from ${TEST_FROM} where t.id = ${id}`.execute(this.db)
    return r.rows[0] ? toTest(r.rows[0]) : null
  }

  async relations(userId: string, testId: string): Promise<TestRelations> {
    const r = await sql<{ own: boolean; assigned: boolean; teach: boolean }>`
      select ${own(userId)} as own, ${assignedVia(userId)} as assigned, ${courseVisible(userId)} as teach
      from tests t where t.id = ${testId}`.execute(this.db)
    const row = r.rows[0]
    return { own: !!row?.own, assignedViaAssignment: !!row?.assigned, courseTeacher: !!row?.teach }
  }

  async versions(testId: string) {
    const rows = await this.db
      .selectFrom('test_versions')
      .select(['id', 'version_no', 'state', 'created_at'])
      .where('test_id', '=', testId)
      .orderBy('version_no')
      .execute()
    return rows.map((r) => ({ id: r.id, versionNo: r.version_no, state: r.state, createdAt: r.created_at }))
  }

  async findVersion(id: string): Promise<TestVersionRecord | null> {
    if (!isUuid(id)) return null
    const v = await this.db.selectFrom('test_versions').selectAll().where('id', '=', id).executeTakeFirst()
    if (!v) return null
    return {
      id: v.id,
      testId: v.test_id,
      versionNo: v.version_no,
      basedOnVersionId: v.based_on_version_id,
      state: v.state,
      title: v.title,
      description: v.description,
      instructions: v.instructions,
      settings: toSettings(v.settings),
      authorIds: v.author_ids,
      packageItemVersionIds: v.package_item_version_ids,
      everSubmitted: v.ever_submitted,
      submittedAt: v.submitted_at,
      approvedAt: v.approved_at,
      approvedBy: v.approved_by,
      publishedAt: v.published_at,
      publishedBy: v.published_by,
      archivedAt: v.archived_at,
      archiveReason: v.archive_reason,
      contentHash: v.content_hash,
      createdAt: v.created_at,
      updatedAt: v.updated_at,
      revision: v.revision,
    }
  }

  async structure(versionId: string): Promise<TestStructure> {
    const sections = await this.db
      .selectFrom('test_sections')
      .selectAll()
      .where('test_version_id', '=', versionId)
      .orderBy('ordinal')
      .execute()
    const fixed = await sql<any>`
      select tsi.*, i.owner_id as item_owner_id, i.status as item_status, i.course_id as item_course_id,
        i.question_type_id, qt.name as qt_name, qt.interaction_key, i.latest_approved_version_id,
        lav.version_no as latest_approved_version_no,
        iv.version_no, iv.state as version_state, iv.author_ids as version_author_ids, iv.stem,
        coalesce((select array_agg(vt.topic_id) from item_version_topics vt where vt.item_version_id = iv.id), '{}') as topic_ids
      from test_section_items tsi
      join items i on i.id = tsi.item_id
      join question_types qt on qt.id = i.question_type_id
      join item_versions iv on iv.id = tsi.item_version_id
      left join item_versions lav on lav.id = i.latest_approved_version_id
      where tsi.test_version_id = ${versionId}
      order by tsi.ordinal`.execute(this.db)
    const rules = await this.db
      .selectFrom('selection_rules')
      .selectAll()
      .where('test_version_id', '=', versionId)
      .orderBy('ordinal')
      .execute()
    return {
      sections: sections.map((s): SectionRecord => ({
        id: s.id,
        testVersionId: s.test_version_id,
        title: s.title,
        instructions: s.instructions,
        ordinal: s.ordinal,
        timeLimitSec: s.time_limit_sec,
        shuffleItems: s.shuffle_items,
      })),
      fixed: fixed.rows.map((r): FixedItemRecord => ({
        id: r.id,
        sectionId: r.section_id,
        itemId: r.item_id,
        itemVersionId: r.item_version_id,
        ordinal: r.ordinal,
        points: Number(r.points),
        itemOwnerId: r.item_owner_id,
        itemStatus: r.item_status,
        itemCourseId: r.item_course_id,
        interactionKey: r.interaction_key,
        questionTypeId: r.question_type_id,
        questionTypeName: r.qt_name,
        versionNo: r.version_no,
        versionState: r.version_state,
        versionAuthorIds: r.version_author_ids,
        stem: r.stem,
        topicIds: r.topic_ids ?? [],
        latestApprovedVersionId: r.latest_approved_version_id,
        latestApprovedVersionNo: r.latest_approved_version_no ?? null,
      })),
      rules: rules.map((r): RuleRecord => ({
        id: r.id,
        sectionId: r.section_id,
        ordinal: r.ordinal,
        count: r.count,
        pointsPerItem: Number(r.points_per_item),
        filter: toFilter(r.filter),
      })),
    }
  }

  async insertTest(d: { title: string; ownerId: string; assignmentId: string | null; courseId: string }) {
    const r = await this.db
      .insertInto('tests')
      .values({ title: d.title, owner_id: d.ownerId, assignment_id: d.assignmentId, course_id: d.courseId })
      .returning('id')
      .executeTakeFirstOrThrow()
    return r.id
  }

  async updateTestTitle(id: string, title: string) {
    await this.db
      .updateTable('tests')
      .set({ title, updated_at: new Date(), revision: sql<number>`revision + 1` })
      .where('id', '=', id)
      .execute()
  }

  async insertVersion(d: Parameters<TestRepository['insertVersion']>[0]) {
    const r = await this.db
      .insertInto('test_versions')
      .values({
        test_id: d.testId,
        version_no: d.versionNo,
        based_on_version_id: d.basedOnVersionId,
        title: d.title,
        description: d.description,
        instructions: d.instructions,
        settings: JSON.stringify(d.settings),
        author_ids: d.authorIds,
      })
      .returning('id')
      .executeTakeFirstOrThrow()
    return r.id
  }

  async updateDraft(versionId: string, d: Parameters<TestRepository['updateDraft']>[1], expectedRevision: number) {
    const values: Record<string, unknown> = { updated_at: new Date(), revision: sql<number>`revision + 1` }
    if (d.title !== undefined) values.title = d.title
    if (d.description !== undefined) values.description = d.description
    if (d.instructions !== undefined) values.instructions = d.instructions
    if (d.settings !== undefined) values.settings = JSON.stringify(d.settings)
    const r = await this.db
      .updateTable('test_versions')
      .set(values as any)
      .where('id', '=', versionId)
      .where('state', '=', 'DRAFT')
      .where('revision', '=', expectedRevision)
      .executeTakeFirst()
    if (Number(r.numUpdatedRows) === 0) await this.explainMiss(versionId)
  }

  async touch(versionId: string, expectedRevision?: number) {
    let q = this.db
      .updateTable('test_versions')
      .set({ updated_at: new Date(), revision: sql<number>`revision + 1` })
      .where('id', '=', versionId)
      .where('state', '=', 'DRAFT')
    if (expectedRevision !== undefined) q = q.where('revision', '=', expectedRevision)
    const r = await q.returning('revision').executeTakeFirst()
    if (!r) return this.explainMiss(versionId)
    return r.revision
  }

  private async explainMiss(versionId: string): Promise<never> {
    const cur = await this.db
      .selectFrom('test_versions')
      .select(['state'])
      .where('id', '=', versionId)
      .executeTakeFirst()
    if (!cur) throw DomainError.notFound()
    if (cur.state !== 'DRAFT')
      throw new DomainError(
        'INVALID_STATE',
        'Версия теста заморожена: изменения — только через новую версию (BR-007)',
        {
          ruleId: 'BR-007',
        },
      )
    throw DomainError.conflict()
  }

  async setVersionState(versionId: string, d: Parameters<TestRepository['setVersionState']>[1]) {
    const values: Record<string, unknown> = {
      state: d.state,
      updated_at: new Date(),
      revision: sql<number>`revision + 1`,
    }
    if (d.submittedAt !== undefined) values.submitted_at = d.submittedAt
    if (d.contentHash !== undefined) values.content_hash = d.contentHash
    if (d.everSubmitted !== undefined) values.ever_submitted = d.everSubmitted
    if (d.packageItemVersionIds !== undefined) values.package_item_version_ids = d.packageItemVersionIds
    if (d.archiveReason !== undefined) values.archive_reason = d.archiveReason
    if (d.approvedAt !== undefined) values.approved_at = d.approvedAt
    if (d.approvedBy !== undefined) values.approved_by = d.approvedBy
    if (d.publishedAt !== undefined) values.published_at = d.publishedAt
    if (d.publishedBy !== undefined) values.published_by = d.publishedBy
    if (d.archivedAt !== undefined) values.archived_at = d.archivedAt
    await this.db
      .updateTable('test_versions')
      .set(values as any)
      .where('id', '=', versionId)
      .execute()
  }

  async setTestPointers(
    testId: string,
    d: { currentDraftVersionId?: string | null; publishedVersionId?: string | null },
  ) {
    const values: Record<string, unknown> = { updated_at: new Date(), revision: sql<number>`revision + 1` }
    if (d.currentDraftVersionId !== undefined) values.current_draft_version_id = d.currentDraftVersionId
    if (d.publishedVersionId !== undefined) values.published_version_id = d.publishedVersionId
    await this.db
      .updateTable('tests')
      .set(values as any)
      .where('id', '=', testId)
      .execute()
  }

  async setTestArchived(testId: string, archived: boolean, by: string, reason: string | null) {
    await this.db
      .updateTable('tests')
      .set({
        status: archived ? 'ARCHIVED' : 'ACTIVE',
        archived_at: archived ? new Date() : null,
        archived_by: archived ? by : null,
        archive_reason: archived ? reason : null,
        updated_at: new Date(),
        revision: sql<number>`revision + 1`,
      })
      .where('id', '=', testId)
      .execute()
  }

  async insertPoolEntries(ruleId: string, itemVersionIds: string[]) {
    if (!itemVersionIds.length) return
    await this.db
      .insertInto('selection_pool_entries')
      .values(itemVersionIds.map((item_version_id) => ({ selection_rule_id: ruleId, item_version_id })))
      .execute()
  }

  async maxVersionNo(testId: string) {
    const r = await this.db
      .selectFrom('test_versions')
      .select(sql<number>`coalesce(max(version_no), 0)`.as('n'))
      .where('test_id', '=', testId)
      .executeTakeFirstOrThrow()
    return Number(r.n)
  }

  async insertSection(d: Omit<SectionRecord, 'id'>) {
    const r = await this.db
      .insertInto('test_sections')
      .values({
        test_version_id: d.testVersionId,
        title: d.title,
        instructions: d.instructions,
        ordinal: d.ordinal,
        time_limit_sec: d.timeLimitSec,
        shuffle_items: d.shuffleItems,
      })
      .returning('id')
      .executeTakeFirstOrThrow()
    return r.id
  }

  async updateSection(id: string, d: Partial<Omit<SectionRecord, 'id' | 'testVersionId'>>) {
    const values: Record<string, unknown> = {}
    if (d.title !== undefined) values.title = d.title
    if (d.instructions !== undefined) values.instructions = d.instructions
    if (d.ordinal !== undefined) values.ordinal = d.ordinal
    if (d.timeLimitSec !== undefined) values.time_limit_sec = d.timeLimitSec
    if (d.shuffleItems !== undefined) values.shuffle_items = d.shuffleItems
    if (!Object.keys(values).length) return
    await this.db
      .updateTable('test_sections')
      .set(values as any)
      .where('id', '=', id)
      .execute()
  }

  async deleteSection(id: string) {
    await this.db.deleteFrom('test_section_items').where('section_id', '=', id).execute()
    await this.db.deleteFrom('selection_rules').where('section_id', '=', id).execute()
    await this.db.deleteFrom('test_sections').where('id', '=', id).execute()
  }

  async insertFixed(d: Parameters<TestRepository['insertFixed']>[0]) {
    const r = await this.db
      .insertInto('test_section_items')
      .values({
        test_version_id: d.testVersionId,
        section_id: d.sectionId,
        item_id: d.itemId,
        item_version_id: d.itemVersionId,
        ordinal: d.ordinal,
        points: d.points,
      })
      .returning('id')
      .executeTakeFirstOrThrow()
    return r.id
  }

  async updateFixed(id: string, d: Parameters<TestRepository['updateFixed']>[1]) {
    const values: Record<string, unknown> = {}
    if (d.sectionId !== undefined) values.section_id = d.sectionId
    if (d.ordinal !== undefined) values.ordinal = d.ordinal
    if (d.points !== undefined) values.points = d.points
    if (d.itemVersionId !== undefined) values.item_version_id = d.itemVersionId
    if (!Object.keys(values).length) return
    await this.db
      .updateTable('test_section_items')
      .set(values as any)
      .where('id', '=', id)
      .execute()
  }

  async deleteFixed(id: string) {
    await this.db.deleteFrom('test_section_items').where('id', '=', id).execute()
  }

  async insertRule(d: Omit<RuleRecord, 'id'> & { testVersionId: string }) {
    const r = await this.db
      .insertInto('selection_rules')
      .values({
        test_version_id: d.testVersionId,
        section_id: d.sectionId,
        ordinal: d.ordinal,
        count: d.count,
        points_per_item: d.pointsPerItem,
        filter: JSON.stringify(d.filter),
      })
      .returning('id')
      .executeTakeFirstOrThrow()
    return r.id
  }

  async updateRule(id: string, d: Partial<Omit<RuleRecord, 'id'>>) {
    const values: Record<string, unknown> = {}
    if (d.sectionId !== undefined) values.section_id = d.sectionId
    if (d.ordinal !== undefined) values.ordinal = d.ordinal
    if (d.count !== undefined) values.count = d.count
    if (d.pointsPerItem !== undefined) values.points_per_item = d.pointsPerItem
    if (d.filter !== undefined) values.filter = JSON.stringify(d.filter)
    if (!Object.keys(values).length) return
    await this.db
      .updateTable('selection_rules')
      .set(values as any)
      .where('id', '=', id)
      .execute()
  }

  async deleteRule(id: string) {
    await this.db.deleteFrom('selection_rules').where('id', '=', id).execute()
  }

  async poolCandidates(courseId: string, f: SelectionFilter, excludeItemIds: string[]) {
    const conds: RawBuilder<unknown>[] = [
      sql`i.course_id = ${courseId}`,
      sql`i.status = 'ACTIVE'`,
      sql`i.latest_approved_version_id is not null`,
    ]
    const ex = excludeItemIds.filter(isUuid)
    if (ex.length) conds.push(sql`i.id not in (${sql.join(ex)})`)
    const topics = f.topicIds.filter(isUuid)
    if (topics.length)
      conds.push(sql`exists (select 1 from item_version_topics vt where vt.item_version_id = v.id and vt.topic_id in (
        with recursive sub(id) as (select id from topics where id in (${sql.join(topics)}) union all select t.id from topics t join sub on t.parent_id = sub.id) select id from sub))`)
    const objectives = f.objectiveIds.filter(isUuid)
    if (objectives.length)
      conds.push(
        sql`exists (select 1 from item_version_objectives vo where vo.item_version_id = v.id and vo.objective_id in (${sql.join(objectives)}))`,
      )
    const tags = f.tags.map((t) => t.trim().toLowerCase()).filter(Boolean)
    if (tags.length)
      conds.push(
        sql`exists (select 1 from item_version_tags vg join tags tg on tg.id = vg.tag_id where vg.item_version_id = v.id and tg.normalized in (${sql.join(tags)}))`,
      )
    const types = f.questionTypeIds.filter(isUuid)
    if (types.length) conds.push(sql`i.question_type_id in (${sql.join(types)})`)
    if (f.difficultyMin !== null) conds.push(sql`v.difficulty >= ${f.difficultyMin}`)
    if (f.difficultyMax !== null) conds.push(sql`v.difficulty <= ${f.difficultyMax}`)
    const r = await sql<{ item_id: string; version_id: string }>`
      select i.id as item_id, v.id as version_id from items i
      join item_versions v on v.id = i.latest_approved_version_id
      where ${sql.join(conds, sql` and `)}
      order by i.created_at, i.id`.execute(this.db)
    return r.rows.map((x) => ({ itemId: x.item_id, itemVersionId: x.version_id }))
  }

  async frozenPool(ruleId: string) {
    const r = await this.db
      .selectFrom('selection_pool_entries')
      .select('item_version_id')
      .where('selection_rule_id', '=', ruleId)
      .execute()
    return r.map((x) => x.item_version_id)
  }

  async countActiveTestsInAssignment(assignmentId: string, ownerId: string) {
    const r = await this.db
      .selectFrom('tests')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('assignment_id', '=', assignmentId)
      .where('owner_id', '=', ownerId)
      .where('status', '=', 'ACTIVE')
      .executeTakeFirstOrThrow()
    return Number(r.n)
  }

  async assignmentSummary(assignmentId: string): Promise<AssignmentSummaryRow[]> {
    const r = await sql<any>`
      with targets as (
        select at.user_id from assignment_targets at where at.assignment_id = ${assignmentId} and at.user_id is not null
        union
        select gm.user_id from assignment_targets at join group_memberships gm on gm.group_id = at.group_id
        where at.assignment_id = ${assignmentId}
      )
      select u.id as user_id, u.display_name, u.email,
        (select count(*) from tests t where t.assignment_id = ${assignmentId} and t.owner_id = u.id and t.status = 'ACTIVE') as test_count,
        lt.id as latest_test_id, lt.title as latest_test_title, lv.version_no, lv.state, lv.updated_at,
        de.new_deadline_at
      from targets tg
      join users u on u.id = tg.user_id
      left join lateral (
        select t.* from tests t where t.assignment_id = ${assignmentId} and t.owner_id = u.id and t.status = 'ACTIVE'
        order by t.updated_at desc limit 1) lt on true
      left join lateral (
        select v.* from test_versions v where v.test_id = lt.id order by v.version_no desc limit 1) lv on true
      left join deadline_extensions de on de.assignment_id = ${assignmentId} and de.user_id = u.id
      order by u.display_name`.execute(this.db)
    return r.rows.map((x) => ({
      userId: x.user_id,
      displayName: x.display_name,
      email: x.email,
      testCount: Number(x.test_count),
      latestTestId: x.latest_test_id ?? null,
      latestTestTitle: x.latest_test_title ?? null,
      latestVersionNo: x.version_no ?? null,
      latestState: x.state ?? null,
      latestUpdatedAt: x.updated_at ?? null,
      extendedUntil: x.new_deadline_at ?? null,
    }))
  }
}
