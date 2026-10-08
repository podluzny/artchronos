import { sql, type RawBuilder } from 'kysely'
import type {
  ChecklistTemplateRecord,
  CommentAnchor,
  ContentIssueRecord,
  ReviewAssignmentRecord,
  ReviewRecord,
  ReviewRelations,
  ReviewRepository,
  SubjectType,
} from '../../application/review/ports.js'
import type { ListQuery } from '../../application/shared/query.js'
import type { ScopeFilter } from '../../domain/authorization/actor.js'
import type { ChecklistItem } from '../../domain/review/review-rules.js'
import { DomainError } from '../../domain/shared/errors.js'
import type { Db } from '../db/kysely.js'
import { isUuid } from '../identity/user-repository.js'

const REVIEW_SELECT = sql`
  r.*, c.name as course_name, a.title as assignment_title,
  coalesce(tv.title, iv.stem) as subject_title,
  coalesce(tv.version_no, iv.version_no) as version_no,
  coalesce(tv.state, iv.state) as version_state,
  coalesce(t.owner_id, i.owner_id) as owner_id,
  ou.display_name as owner_name,
  coalesce(tv.author_ids, iv.author_ids) as author_ids,
  pa.reviewer_id as primary_reviewer_id, pu.display_name as primary_reviewer_name`
const REVIEW_FROM = sql`reviews r
  join courses c on c.id = r.course_id
  left join assignments a on a.id = r.assignment_id
  left join test_versions tv on tv.id = r.test_version_id
  left join tests t on t.id = r.test_id
  left join item_versions iv on iv.id = r.item_version_id
  left join items i on i.id = r.item_id
  join users ou on ou.id = coalesce(t.owner_id, i.owner_id)
  left join lateral (select x.reviewer_id from review_assignments x where x.review_id = r.id and x.role = 'PRIMARY'
    and x.status in ('ACTIVE','COMPLETED') order by x.status = 'ACTIVE' desc, x.assigned_at desc limit 1) pa on true
  left join users pu on pu.id = pa.reviewer_id`

const own = (uid: string) =>
  sql<boolean>`(coalesce(t.owner_id, i.owner_id) = ${uid} or ${uid} = any(coalesce(tv.author_ids, iv.author_ids)))`
const assigned = (uid: string) =>
  sql<boolean>`exists (select 1 from review_assignments ra where ra.review_id = r.id and ra.reviewer_id = ${uid} and ra.status in ('ACTIVE','COMPLETED'))`
const manager = (uid: string) =>
  sql<boolean>`(r.assignment_id is not null and (a.owner_id = ${uid} or a.default_reviewer_id = ${uid}))`
const teaches = (uid: string) =>
  sql<boolean>`exists (select 1 from course_teachers ct where ct.course_id = r.course_id and ct.user_id = ${uid})`

function toReview(r: any): ReviewRecord {
  return {
    id: r.id,
    subjectType: r.subject_type,
    testVersionId: r.test_version_id,
    itemVersionId: r.item_version_id,
    testId: r.test_id,
    itemId: r.item_id,
    courseId: r.course_id,
    courseName: r.course_name,
    assignmentId: r.assignment_id,
    assignmentTitle: r.assignment_title ?? null,
    status: r.status,
    checklistTemplateId: r.checklist_template_id,
    decision: r.decision,
    decidedBy: r.decided_by,
    decidedAt: r.decided_at,
    summary: r.summary,
    submittedAt: r.submitted_at,
    revision: r.revision,
    subjectTitle: r.subject_title,
    versionNo: r.version_no,
    versionState: r.version_state,
    ownerId: r.owner_id,
    ownerName: r.owner_name,
    authorIds: r.author_ids ?? [],
    primaryReviewerId: r.primary_reviewer_id ?? null,
    primaryReviewerName: r.primary_reviewer_name ?? null,
  }
}

function toTemplate(r: any): ChecklistTemplateRecord {
  return {
    id: r.id,
    name: r.name,
    appliesTo: r.applies_to,
    versionNo: r.version_no,
    items: r.items as ChecklistItem[],
    status: r.status,
    createdAt: r.created_at,
  }
}

function toIssue(r: any): ContentIssueRecord {
  return {
    id: r.id,
    reviewId: r.review_id,
    originCommentId: r.origin_comment_id,
    testId: r.test_id,
    itemId: r.item_id,
    linkedVersionId: r.linked_version_id,
    anchor: (r.anchor ?? {}) as CommentAnchor,
    body: r.body,
    severity: r.severity,
    status: r.status,
    raisedBy: r.raised_by,
    raisedByName: r.raised_by_name,
    addressedInVersionId: r.addressed_in_version_id,
    statusNote: r.status_note,
    statusBy: r.status_by,
    createdAt: r.created_at,
  }
}

export class KyselyReviewRepository implements ReviewRepository {
  constructor(private readonly db: Db) {}

  async list(filter: ScopeFilter, q: ListQuery) {
    const f = q.filters
    const conds: RawBuilder<unknown>[] = []
    if (filter.kind === 'SCOPED') {
      const ors: RawBuilder<boolean>[] = [sql<boolean>`false`]
      if (filter.scopes.has('OWN')) ors.push(own(filter.userId))
      if (filter.scopes.has('ASSIGNED')) ors.push(assigned(filter.userId), manager(filter.userId))
      if (filter.scopes.has('COURSE')) ors.push(teaches(filter.userId))
      conds.push(sql`(${sql.join(ors, sql` or `)})`)
    }
    if (f.queue === 'mine' && f.userId && isUuid(f.userId))
      conds.push(
        sql`exists (select 1 from review_assignments ra where ra.review_id = r.id and ra.reviewer_id = ${f.userId} and ra.status = 'ACTIVE')`,
      )
    if (f.queue === 'unassigned')
      conds.push(
        sql`r.status in ('OPEN','IN_PROGRESS') and not exists (select 1 from review_assignments ra join users ru on ru.id = ra.reviewer_id
          where ra.review_id = r.id and ra.role = 'PRIMARY' and ra.status = 'ACTIVE' and ru.status = 'ACTIVE')`,
      )
    if (f.status) conds.push(sql`r.status = ${f.status}`)
    if (f.subjectType) conds.push(sql`r.subject_type = ${f.subjectType}`)
    if (f.testId && isUuid(f.testId)) conds.push(sql`r.test_id = ${f.testId}`)
    if (f.itemId && isUuid(f.itemId)) conds.push(sql`r.item_id = ${f.itemId}`)
    if (f.courseId && isUuid(f.courseId)) conds.push(sql`r.course_id = ${f.courseId}`)
    const where = conds.length ? sql`where ${sql.join(conds, sql` and `)}` : sql``
    const sortCol =
      { submittedAt: sql`r.submitted_at`, status: sql`r.status`, decidedAt: sql`r.decided_at` }[q.sortBy ?? ''] ??
      sql`r.submitted_at`
    const dir = q.direction === 'asc' ? sql`asc` : sql`desc`
    const rows = await sql<any>`select ${REVIEW_SELECT} from ${REVIEW_FROM} ${where}
      order by ${sortCol} ${dir}, r.id limit ${q.limit} offset ${q.offset}`.execute(this.db)
    const total = await sql<{ n: string }>`select count(*) as n from ${REVIEW_FROM} ${where}`.execute(this.db)
    return { records: rows.rows.map(toReview), total: Number(total.rows[0]?.n ?? 0) }
  }

  async findById(id: string) {
    if (!isUuid(id)) return null
    const r = await sql<any>`select ${REVIEW_SELECT} from ${REVIEW_FROM} where r.id = ${id}`.execute(this.db)
    return r.rows[0] ? toReview(r.rows[0]) : null
  }

  async relations(userId: string, reviewId: string): Promise<ReviewRelations> {
    const r = await sql<any>`select ${own(userId)} as own, ${assigned(userId)} as assigned,
      ${manager(userId)} as manager, ${teaches(userId)} as teach from ${REVIEW_FROM} where r.id = ${reviewId}`.execute(
      this.db,
    )
    const x = r.rows[0]
    return { own: !!x?.own, assigned: !!x?.assigned, assignmentManager: !!x?.manager, courseTeacher: !!x?.teach }
  }

  async openForVersion(kind: SubjectType, versionId: string) {
    const col = kind === 'TEST_VERSION' ? sql`r.test_version_id` : sql`r.item_version_id`
    const r = await sql<any>`select ${REVIEW_SELECT} from ${REVIEW_FROM}
      where ${col} = ${versionId} and r.status in ('OPEN','IN_PROGRESS')`.execute(this.db)
    return r.rows[0] ? toReview(r.rows[0]) : null
  }

  async latestForContainer(kind: 'test' | 'item', containerId: string) {
    const col = kind === 'test' ? sql`r.test_id` : sql`r.item_id`
    const r = await sql<any>`select ${REVIEW_SELECT} from ${REVIEW_FROM}
      where ${col} = ${containerId} and r.status <> 'CANCELLED' order by r.created_at desc limit 1`.execute(this.db)
    return r.rows[0] ? toReview(r.rows[0]) : null
  }

  async insertReview(d: Parameters<ReviewRepository['insertReview']>[0]) {
    const r = await sql<{ id: string }>`insert into reviews
      (subject_type, test_version_id, item_version_id, test_id, item_id, course_id, assignment_id, checklist_template_id)
      values (${d.subjectType}, ${d.testVersionId}, ${d.itemVersionId}, ${d.testId}, ${d.itemId}, ${d.courseId},
        ${d.assignmentId}, ${d.checklistTemplateId}) returning id`.execute(this.db)
    return r.rows[0]!.id
  }

  async setStatus(id: string, d: Parameters<ReviewRepository['setStatus']>[1], expectedRevision?: number) {
    const r = await sql`update reviews set status = ${d.status},
        decision = coalesce(${d.decision ?? null}, decision),
        decided_by = coalesce(${d.decidedBy ?? null}::uuid, decided_by),
        decided_at = coalesce(${d.decidedAt ?? null}::timestamptz, decided_at),
        summary = ${d.summary === undefined ? sql`summary` : sql`${d.summary}`},
        updated_at = now(), revision = revision + 1
      where id = ${id} ${expectedRevision !== undefined ? sql`and revision = ${expectedRevision}` : sql``}`.execute(
      this.db,
    )
    if (Number(r.numAffectedRows ?? 0) === 0) throw DomainError.conflict('Экспертиза была изменена — обновите страницу')
  }

  async assignments(reviewId: string): Promise<ReviewAssignmentRecord[]> {
    const r =
      await sql<any>`select ra.*, u.display_name from review_assignments ra join users u on u.id = ra.reviewer_id
      where ra.review_id = ${reviewId} order by ra.assigned_at`.execute(this.db)
    return r.rows.map((x) => ({
      id: x.id,
      reviewId: x.review_id,
      reviewerId: x.reviewer_id,
      reviewerName: x.display_name,
      role: x.role,
      status: x.status,
      assignedBy: x.assigned_by,
      assignedAt: x.assigned_at,
      reason: x.reason,
    }))
  }

  async insertAssignment(d: Parameters<ReviewRepository['insertAssignment']>[0]) {
    const r = await sql<{
      id: string
    }>`insert into review_assignments (review_id, reviewer_id, role, assigned_by, reason)
      values (${d.reviewId}, ${d.reviewerId}, ${d.role}, ${d.assignedBy}, ${d.reason}) returning id`.execute(this.db)
    return r.rows[0]!.id
  }

  async setAssignmentStatus(id: string, status: 'REVOKED' | 'COMPLETED', reason?: string | null) {
    await sql`update review_assignments set status = ${status}, reason = coalesce(${reason ?? null}, reason)
      where id = ${id}`.execute(this.db)
  }

  async closeAssignments(reviewId: string, status: 'REVOKED' | 'COMPLETED') {
    await sql`update review_assignments set status = ${status} where review_id = ${reviewId} and status = 'ACTIVE'`.execute(
      this.db,
    )
  }

  async activeTemplate(appliesTo: SubjectType) {
    const r =
      await sql<any>`select * from checklist_templates where applies_to = ${appliesTo} and status = 'ACTIVE'`.execute(
        this.db,
      )
    return r.rows[0] ? toTemplate(r.rows[0]) : null
  }

  async template(id: string) {
    if (!isUuid(id)) return null
    const r = await sql<any>`select * from checklist_templates where id = ${id}`.execute(this.db)
    return r.rows[0] ? toTemplate(r.rows[0]) : null
  }

  async listTemplates() {
    const r = await sql<any>`select * from checklist_templates order by applies_to, version_no desc`.execute(this.db)
    return r.rows.map(toTemplate)
  }

  /** Новая версия шаблона: предыдущая архивируется, существующие Review сохраняют ссылку на свою версию. */
  async insertTemplate(d: Parameters<ReviewRepository['insertTemplate']>[0]) {
    await sql`update checklist_templates set status = 'ARCHIVED' where applies_to = ${d.appliesTo} and status = 'ACTIVE'`.execute(
      this.db,
    )
    const r = await sql<{
      id: string
    }>`insert into checklist_templates (name, applies_to, version_no, items, created_by)
      values (${d.name}, ${d.appliesTo},
        (select coalesce(max(version_no), 0) + 1 from checklist_templates where applies_to = ${d.appliesTo}),
        ${JSON.stringify(d.items)}::jsonb, ${d.createdBy}) returning id`.execute(this.db)
    return r.rows[0]!.id
  }

  async answers(reviewId: string) {
    const r = await sql<any>`select * from review_checklist_answers where review_id = ${reviewId}`.execute(this.db)
    return r.rows.map((x) => ({
      code: x.item_code,
      checked: x.checked,
      note: x.note,
      answeredBy: x.answered_by,
      answeredAt: x.answered_at,
    }))
  }

  async upsertAnswer(d: Parameters<ReviewRepository['upsertAnswer']>[0]) {
    await sql`insert into review_checklist_answers (review_id, item_code, checked, note, answered_by)
      values (${d.reviewId}, ${d.code}, ${d.checked}, ${d.note}, ${d.by})
      on conflict (review_id, item_code) do update set checked = excluded.checked, note = excluded.note,
        answered_by = excluded.answered_by, answered_at = now()`.execute(this.db)
  }

  async comments(reviewId: string) {
    const r = await sql<any>`select rc.*, u.display_name from review_comments rc join users u on u.id = rc.author_id
      where rc.review_id = ${reviewId} order by rc.created_at, rc.id`.execute(this.db)
    return r.rows.map((x) => ({
      id: x.id,
      reviewId: x.review_id,
      parentId: x.parent_id,
      authorId: x.author_id,
      authorName: x.display_name,
      anchor: (x.anchor ?? {}) as CommentAnchor,
      body: x.body,
      createdAt: x.created_at,
    }))
  }

  async insertComment(d: Parameters<ReviewRepository['insertComment']>[0]) {
    const r = await sql<{ id: string }>`insert into review_comments (review_id, parent_id, author_id, anchor, body)
      values (${d.reviewId}, ${d.parentId}, ${d.authorId}, ${JSON.stringify(d.anchor)}::jsonb, ${d.body}) returning id`.execute(
      this.db,
    )
    return r.rows[0]!.id
  }

  async issuesForContainer(kind: 'test' | 'item', containerId: string) {
    const col = kind === 'test' ? sql`ci.test_id` : sql`ci.item_id`
    const r = await sql<any>`select ci.*, u.display_name as raised_by_name from content_issues ci
      join users u on u.id = ci.raised_by where ${col} = ${containerId} order by ci.created_at`.execute(this.db)
    return r.rows.map(toIssue)
  }

  async findIssue(id: string) {
    if (!isUuid(id)) return null
    const r = await sql<any>`select ci.*, u.display_name as raised_by_name from content_issues ci
      join users u on u.id = ci.raised_by where ci.id = ${id}`.execute(this.db)
    return r.rows[0] ? toIssue(r.rows[0]) : null
  }

  async insertIssue(d: Parameters<ReviewRepository['insertIssue']>[0]) {
    const r = await sql<{ id: string }>`insert into content_issues
      (review_id, origin_comment_id, test_id, item_id, linked_version_id, anchor, body, severity, raised_by)
      values (${d.reviewId}, ${d.originCommentId}, ${d.testId}, ${d.itemId}, ${d.linkedVersionId},
        ${JSON.stringify(d.anchor)}::jsonb, ${d.body}, ${d.severity}, ${d.raisedBy}) returning id`.execute(this.db)
    return r.rows[0]!.id
  }

  async updateIssue(id: string, d: Parameters<ReviewRepository['updateIssue']>[1]) {
    await sql`update content_issues set status = ${d.status}, status_note = ${d.note}, status_by = ${d.by},
        status_at = now(), updated_at = now(),
        addressed_in_version_id = ${d.addressedInVersionId === undefined ? sql`addressed_in_version_id` : sql`${d.addressedInVersionId}`}
      where id = ${id}`.execute(this.db)
  }

  async linkOpenIssues(kind: 'test' | 'item', containerId: string, versionId: string) {
    const col = kind === 'test' ? sql`test_id` : sql`item_id`
    const r = await sql`update content_issues set linked_version_id = ${versionId}, updated_at = now()
      where ${col} = ${containerId} and status in ('OPEN','ADDRESSED')`.execute(this.db)
    return Number(r.numAffectedRows ?? 0)
  }

  async reviewerCandidates() {
    const r = await sql<any>`select distinct u.id, u.display_name, u.email from users u
      join user_roles ur on ur.user_id = u.id join role_permissions rp on rp.role_id = ur.role_id
      where rp.permission_key = 'review.perform' and u.status = 'ACTIVE' order by u.display_name`.execute(this.db)
    return r.rows.map((x) => ({ id: x.id, name: x.display_name, email: x.email }))
  }

  async userBrief(id: string) {
    if (!isUuid(id)) return null
    const r = await sql<any>`select id, display_name, status from users where id = ${id}`.execute(this.db)
    return r.rows[0] ? { id: r.rows[0].id, name: r.rows[0].display_name, status: r.rows[0].status } : null
  }
}
