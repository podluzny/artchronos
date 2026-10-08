import { sql, type Expression, type SqlBool } from 'kysely'
import type { ScopeFilter } from '../../domain/authorization/actor.js'
import { DomainError } from '../../domain/shared/errors.js'
import type {
  AssignmentRecord,
  CourseRelation,
  EducationRepository,
  Entity,
  GroupRecord,
  ObjectiveRecord,
  QuestionTypeRecord,
  SubjectRecord,
  TopicRecord,
  CourseRecord,
} from '../../application/education/ports.js'
import type { ListQuery } from '../../application/shared/query.js'
import type { Db } from '../db/kysely.js'
import { escapeLike, isUuid } from '../identity/user-repository.js'

/** SQL-предикаты отношения пользователя к курсу (scope COURSE). */
const teaches = (courseCol: string, userId: string) =>
  sql<SqlBool>`exists (select 1 from course_teachers ct where ct.course_id = ${sql.ref(courseCol)} and ct.user_id = ${userId})`
const studies = (courseCol: string, userId: string) =>
  sql<SqlBool>`exists (select 1 from group_memberships gm join student_groups g on g.id = gm.group_id where g.course_id = ${sql.ref(courseCol)} and gm.user_id = ${userId} and g.status = 'ACTIVE')`

/** taxonomy.read COURSE: преподает или учится. */
function readScope(filter: ScopeFilter, courseCol: string): Expression<SqlBool> {
  if (filter.kind === 'ANY') return sql<SqlBool>`true`
  if (filter.scopes.has('COURSE'))
    return sql<SqlBool>`(${teaches(courseCol, filter.userId)} or ${studies(courseCol, filter.userId)})`
  return sql<SqlBool>`false`
}

/** group.read COURSE: только преподаватель курса. */
function teachScope(filter: ScopeFilter, courseCol: string): Expression<SqlBool> {
  if (filter.kind === 'ANY') return sql<SqlBool>`true`
  if (filter.scopes.has('COURSE')) return teaches(courseCol, filter.userId)
  return sql<SqlBool>`false`
}

const targeted = (assignmentCol: string, userId: string) => sql<SqlBool>`exists (
  select 1 from assignment_targets t
  left join group_memberships gm on gm.group_id = t.group_id
  left join student_groups g on g.id = t.group_id
  where t.assignment_id = ${sql.ref(assignmentCol)}
    and (t.user_id = ${userId} or (gm.user_id = ${userId} and g.status = 'ACTIVE')))`

function like(v: string) {
  return `%${escapeLike(v)}%`
}

function page<T>(q: ListQuery, rows: T[]): T[] {
  return rows
}

export class KyselyEducationRepository implements EducationRepository {
  constructor(private readonly db: Db) {}

  // ---------------- relations ----------------
  async courseRelation(userId: string, courseId: string): Promise<CourseRelation> {
    if (!isUuid(courseId)) return { teaches: false, studies: false }
    const r = await sql<{
      t: boolean
      s: boolean
    }>`select ${teaches('c.id', userId)} as t, ${studies('c.id', userId)} as s from courses c where c.id = ${courseId}`.execute(
      this.db,
    )
    const row = r.rows[0]
    return { teaches: !!row?.t, studies: !!row?.s }
  }

  async userCourseIds(userId: string) {
    const t = await this.db.selectFrom('course_teachers').select('course_id').where('user_id', '=', userId).execute()
    const s = await this.db
      .selectFrom('group_memberships')
      .innerJoin('student_groups', 'student_groups.id', 'group_memberships.group_id')
      .select('student_groups.course_id')
      .where('group_memberships.user_id', '=', userId)
      .where('student_groups.status', '=', 'ACTIVE')
      .distinct()
      .execute()
    return { teaches: t.map((x) => x.course_id), studies: s.map((x) => x.course_id) }
  }

  // ---------------- subjects ----------------
  private subjects() {
    return this.db
      .selectFrom('subjects as s')
      .selectAll('s')
      .select(sql<string>`(select count(*) from courses c where c.subject_id = s.id)`.as('course_count'))
  }

  private toSubject(r: any): SubjectRecord {
    return {
      id: r.id,
      code: r.code,
      name: r.name,
      status: r.status,
      archivedAt: r.archived_at,
      archiveReason: r.archive_reason,
      courseCount: Number(r.course_count),
      revision: r.revision,
    }
  }

  async listSubjects(filter: ScopeFilter, q: ListQuery) {
    const f = q.filters
    const base = this.subjects().where((eb) => {
      const c: Expression<SqlBool>[] = []
      if (filter.kind !== 'ANY') {
        c.push(
          filter.scopes.has('COURSE')
            ? sql<SqlBool>`exists (select 1 from courses c where c.subject_id = s.id and (${teaches('c.id', filter.userId)} or ${studies('c.id', filter.userId)}))`
            : sql<SqlBool>`false`,
        )
      }
      if (f.id) c.push(isUuid(f.id) ? eb('s.id', '=', f.id) : sql<SqlBool>`false`)
      if (f.code) c.push(eb('s.code', 'ilike', like(f.code)))
      if (f.name) c.push(eb('s.name', 'ilike', like(f.name)))
      c.push(eb('s.status', '=', (f.status as 'ACTIVE' | 'ARCHIVED') ?? 'ACTIVE'))
      return eb.and(c)
    })
    const [rows, total] = await Promise.all([
      base.orderBy('s.name').limit(q.limit).offset(q.offset).execute(),
      this.db
        .selectFrom(base.as('t'))
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .executeTakeFirstOrThrow(),
    ])
    return {
      records: page(
        q,
        rows.map((r) => this.toSubject(r)),
      ),
      total: Number(total.n),
    }
  }

  async findSubject(id: string) {
    if (!isUuid(id)) return null
    const r = await this.subjects().where('s.id', '=', id).executeTakeFirst()
    return r ? this.toSubject(r) : null
  }

  async insertSubject(d: { code: string; name: string }) {
    await this.assertUnique('subjects', 'code', d.code, null, 'code', 'Предмет с таким кодом уже есть')
    const r = await this.db.insertInto('subjects').values(d).returning('id').executeTakeFirstOrThrow()
    return r.id
  }

  async updateSubject(id: string, d: { code: string; name: string }, revision: number) {
    await this.assertUnique('subjects', 'code', d.code, id, 'code', 'Предмет с таким кодом уже есть')
    await this.bump('subjects', id, revision, d)
  }

  // ---------------- courses ----------------
  private courses() {
    return this.db
      .selectFrom('courses as c')
      .innerJoin('subjects as s', 's.id', 'c.subject_id')
      .selectAll('c')
      .select([
        's.name as subject_name',
        's.status as subject_status',
        sql<
          string[]
        >`coalesce((select array_agg(ct.user_id order by u.display_name) from course_teachers ct join users u on u.id = ct.user_id where ct.course_id = c.id), '{}')`.as(
          'teacher_ids',
        ),
        sql<
          string[]
        >`coalesce((select array_agg(u.display_name order by u.display_name) from course_teachers ct join users u on u.id = ct.user_id where ct.course_id = c.id), '{}')`.as(
          'teacher_names',
        ),
      ])
  }

  private toCourse(r: any): CourseRecord {
    return {
      id: r.id,
      subjectId: r.subject_id,
      subjectName: r.subject_name,
      subjectStatus: r.subject_status,
      code: r.code,
      name: r.name,
      academicPeriod: r.academic_period,
      teacherIds: r.teacher_ids ?? [],
      teacherNames: r.teacher_names ?? [],
      status: r.status,
      archivedAt: r.archived_at,
      archiveReason: r.archive_reason,
      revision: r.revision,
    }
  }

  async listCourses(filter: ScopeFilter, q: ListQuery) {
    const f = q.filters
    const base = this.courses().where((eb) => {
      const c: Expression<SqlBool>[] = [readScope(filter, 'c.id')]
      if (f.subjectId) c.push(isUuid(f.subjectId) ? eb('c.subject_id', '=', f.subjectId) : sql<SqlBool>`false`)
      if (f.code) c.push(eb('c.code', 'ilike', like(f.code)))
      if (f.name) c.push(eb('c.name', 'ilike', like(f.name)))
      if (f.teacherId && isUuid(f.teacherId)) c.push(teaches('c.id', f.teacherId))
      c.push(eb('c.status', '=', (f.status as 'ACTIVE' | 'ARCHIVED') ?? 'ACTIVE'))
      return eb.and(c)
    })
    const [rows, total] = await Promise.all([
      base.orderBy('c.name').limit(q.limit).offset(q.offset).execute(),
      this.db
        .selectFrom(base.as('t'))
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .executeTakeFirstOrThrow(),
    ])
    return { records: rows.map((r) => this.toCourse(r)), total: Number(total.n) }
  }

  async findCourse(id: string) {
    if (!isUuid(id)) return null
    const r = await this.courses().where('c.id', '=', id).executeTakeFirst()
    return r ? this.toCourse(r) : null
  }

  async insertCourse(d: { subjectId: string; code: string; name: string; academicPeriod: string | null }) {
    const dup = await this.db
      .selectFrom('courses')
      .select('id')
      .where('subject_id', '=', d.subjectId)
      .where('code', '=', d.code)
      .executeTakeFirst()
    if (dup) throw DomainError.validation([{ field: 'code', message: 'Курс с таким кодом в предмете уже есть' }])
    const r = await this.db
      .insertInto('courses')
      .values({ subject_id: d.subjectId, code: d.code, name: d.name, academic_period: d.academicPeriod })
      .returning('id')
      .executeTakeFirstOrThrow()
    return r.id
  }

  async updateCourse(
    id: string,
    d: { subjectId: string; code: string; name: string; academicPeriod: string | null },
    revision: number,
  ) {
    const dup = await this.db
      .selectFrom('courses')
      .select('id')
      .where('subject_id', '=', d.subjectId)
      .where('code', '=', d.code)
      .where('id', '!=', id)
      .executeTakeFirst()
    if (dup) throw DomainError.validation([{ field: 'code', message: 'Курс с таким кодом в предмете уже есть' }])
    await this.bump('courses', id, revision, {
      subject_id: d.subjectId,
      code: d.code,
      name: d.name,
      academic_period: d.academicPeriod,
    })
  }

  async setCourseTeachers(courseId: string, userIds: string[]) {
    await this.db.deleteFrom('course_teachers').where('course_id', '=', courseId).execute()
    const unique = [...new Set(userIds)]
    if (unique.length)
      await this.db
        .insertInto('course_teachers')
        .values(unique.map((user_id) => ({ course_id: courseId, user_id })))
        .execute()
  }

  // ---------------- topics ----------------
  private topics() {
    return this.db
      .selectFrom('topics as t')
      .innerJoin('courses as c', 'c.id', 't.course_id')
      .leftJoin('topics as p', 'p.id', 't.parent_id')
      .selectAll('t')
      .select([
        'c.name as course_name',
        'c.status as course_status',
        'p.status as parent_status',
        sql<string>`(with recursive anc(id, parent_id, name, lvl) as (
            select t.id, t.parent_id, t.name, 1
            union all select x.id, x.parent_id, x.name, anc.lvl + 1 from topics x join anc on x.id = anc.parent_id)
          select string_agg(name, ' / ' order by lvl desc) from anc)`.as('path'),
        sql<number>`(with recursive anc(id, parent_id) as (
            select t.id, t.parent_id union all select x.id, x.parent_id from topics x join anc on x.id = anc.parent_id)
          select count(*)::int from anc)`.as('depth'),
      ])
  }

  private toTopic(r: any): TopicRecord {
    return {
      id: r.id,
      courseId: r.course_id,
      courseName: r.course_name,
      courseStatus: r.course_status,
      parentId: r.parent_id,
      parentStatus: r.parent_status ?? null,
      name: r.name,
      path: r.path,
      depth: Number(r.depth),
      ordinal: r.ordinal,
      status: r.status,
      archivedAt: r.archived_at,
      archiveReason: r.archive_reason,
      revision: r.revision,
    }
  }

  async listTopics(filter: ScopeFilter, q: ListQuery) {
    const f = q.filters
    const base = this.topics().where((eb) => {
      const c: Expression<SqlBool>[] = [readScope(filter, 't.course_id')]
      if (f.courseId) c.push(isUuid(f.courseId) ? eb('t.course_id', '=', f.courseId) : sql<SqlBool>`false`)
      if (f.parentId) c.push(isUuid(f.parentId) ? eb('t.parent_id', '=', f.parentId) : sql<SqlBool>`false`)
      if (f.name) c.push(eb('t.name', 'ilike', like(f.name)))
      c.push(eb('t.status', '=', (f.status as 'ACTIVE' | 'ARCHIVED') ?? 'ACTIVE'))
      return eb.and(c)
    })
    const [rows, total] = await Promise.all([
      base
        .orderBy('c.name')
        .orderBy(sql`path`)
        .limit(q.limit)
        .offset(q.offset)
        .execute(),
      this.db
        .selectFrom(base.as('x'))
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .executeTakeFirstOrThrow(),
    ])
    return { records: rows.map((r) => this.toTopic(r)), total: Number(total.n) }
  }

  async findTopic(id: string) {
    if (!isUuid(id)) return null
    const r = await this.topics().where('t.id', '=', id).executeTakeFirst()
    return r ? this.toTopic(r) : null
  }

  async topicAncestorIds(id: string) {
    const r = await sql<{ id: string }>`with recursive anc(id, parent_id) as (
        select id, parent_id from topics where id = ${id}
        union all select t.id, t.parent_id from topics t join anc on t.id = anc.parent_id)
      select id from anc where id <> ${id}`.execute(this.db)
    return r.rows.map((x) => x.id)
  }

  async topicSubtreeIds(id: string) {
    if (!isUuid(id)) return []
    const r = await sql<{ id: string }>`with recursive sub(id) as (
        select id from topics where id = ${id}
        union all select t.id from topics t join sub on t.parent_id = sub.id)
      select id from sub`.execute(this.db)
    return r.rows.map((x) => x.id)
  }

  async topicSubtreeDepth(id: string) {
    const r = await sql<{ d: number }>`with recursive sub(id, lvl) as (
        select id, 1 from topics where id = ${id}
        union all select t.id, sub.lvl + 1 from topics t join sub on t.parent_id = sub.id)
      select max(lvl)::int as d from sub`.execute(this.db)
    return r.rows[0]?.d ?? 1
  }

  async insertTopic(d: { courseId: string; parentId: string | null; name: string; ordinal: number }) {
    const r = await this.db
      .insertInto('topics')
      .values({ course_id: d.courseId, parent_id: d.parentId, name: d.name, ordinal: d.ordinal })
      .returning('id')
      .executeTakeFirstOrThrow()
    return r.id
  }

  async updateTopic(id: string, d: { parentId: string | null; name: string; ordinal: number }, revision: number) {
    await this.bump('topics', id, revision, { parent_id: d.parentId, name: d.name, ordinal: d.ordinal })
  }

  // ---------------- objectives ----------------
  private objectives() {
    return this.db
      .selectFrom('learning_objectives as o')
      .innerJoin('topics as t', 't.id', 'o.topic_id')
      .selectAll('o')
      .select(['t.name as topic_name', 't.status as topic_status'])
  }

  private toObjective(r: any): ObjectiveRecord {
    return {
      id: r.id,
      courseId: r.course_id,
      topicId: r.topic_id,
      topicName: r.topic_name,
      topicStatus: r.topic_status,
      code: r.code,
      text: r.text,
      bloomLevel: r.bloom_level,
      status: r.status,
      archivedAt: r.archived_at,
      archiveReason: r.archive_reason,
      revision: r.revision,
    }
  }

  async listObjectives(filter: ScopeFilter, q: ListQuery) {
    const f = q.filters
    const base = this.objectives().where((eb) => {
      const c: Expression<SqlBool>[] = [readScope(filter, 'o.course_id')]
      if (f.courseId) c.push(isUuid(f.courseId) ? eb('o.course_id', '=', f.courseId) : sql<SqlBool>`false`)
      if (f.topicId) c.push(isUuid(f.topicId) ? eb('o.topic_id', '=', f.topicId) : sql<SqlBool>`false`)
      if (f.code) c.push(eb('o.code', 'ilike', like(f.code)))
      if (f.text) c.push(eb('o.text', 'ilike', like(f.text)))
      c.push(eb('o.status', '=', (f.status as 'ACTIVE' | 'ARCHIVED') ?? 'ACTIVE'))
      return eb.and(c)
    })
    const [rows, total] = await Promise.all([
      base.orderBy('o.code').limit(q.limit).offset(q.offset).execute(),
      this.db
        .selectFrom(base.as('x'))
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .executeTakeFirstOrThrow(),
    ])
    return { records: rows.map((r) => this.toObjective(r)), total: Number(total.n) }
  }

  async findObjective(id: string) {
    if (!isUuid(id)) return null
    const r = await this.objectives().where('o.id', '=', id).executeTakeFirst()
    return r ? this.toObjective(r) : null
  }

  async insertObjective(d: {
    courseId: string
    topicId: string
    code: string
    text: string
    bloomLevel: string | null
  }) {
    const dup = await this.db
      .selectFrom('learning_objectives')
      .select('id')
      .where('course_id', '=', d.courseId)
      .where('code', '=', d.code)
      .executeTakeFirst()
    if (dup) throw DomainError.validation([{ field: 'code', message: 'Цель с таким кодом в курсе уже есть' }])
    const r = await this.db
      .insertInto('learning_objectives')
      .values({ course_id: d.courseId, topic_id: d.topicId, code: d.code, text: d.text, bloom_level: d.bloomLevel })
      .returning('id')
      .executeTakeFirstOrThrow()
    return r.id
  }

  async updateObjective(
    id: string,
    d: { topicId: string; code: string; text: string; bloomLevel: string | null },
    revision: number,
  ) {
    const cur = await this.db
      .selectFrom('learning_objectives')
      .select('course_id')
      .where('id', '=', id)
      .executeTakeFirst()
    if (cur) {
      const dup = await this.db
        .selectFrom('learning_objectives')
        .select('id')
        .where('course_id', '=', cur.course_id)
        .where('code', '=', d.code)
        .where('id', '!=', id)
        .executeTakeFirst()
      if (dup) throw DomainError.validation([{ field: 'code', message: 'Цель с таким кодом в курсе уже есть' }])
    }
    await this.bump('learning_objectives', id, revision, {
      topic_id: d.topicId,
      code: d.code,
      text: d.text,
      bloom_level: d.bloomLevel,
    })
  }

  // ---------------- groups ----------------
  private groups() {
    return this.db
      .selectFrom('student_groups as g')
      .innerJoin('courses as c', 'c.id', 'g.course_id')
      .selectAll('g')
      .select([
        'c.name as course_name',
        'c.status as course_status',
        sql<
          string[]
        >`coalesce((select array_agg(gm.user_id order by u.display_name) from group_memberships gm join users u on u.id = gm.user_id where gm.group_id = g.id), '{}')`.as(
          'member_ids',
        ),
        sql<
          string[]
        >`coalesce((select array_agg(u.display_name order by u.display_name) from group_memberships gm join users u on u.id = gm.user_id where gm.group_id = g.id), '{}')`.as(
          'member_names',
        ),
      ])
  }

  private toGroup(r: any): GroupRecord {
    return {
      id: r.id,
      courseId: r.course_id,
      courseName: r.course_name,
      courseStatus: r.course_status,
      name: r.name,
      memberIds: r.member_ids ?? [],
      memberNames: r.member_names ?? [],
      status: r.status,
      archivedAt: r.archived_at,
      archiveReason: r.archive_reason,
      revision: r.revision,
    }
  }

  async listGroups(filter: ScopeFilter, q: ListQuery) {
    const f = q.filters
    const base = this.groups().where((eb) => {
      const c: Expression<SqlBool>[] = [teachScope(filter, 'g.course_id')]
      if (f.courseId) c.push(isUuid(f.courseId) ? eb('g.course_id', '=', f.courseId) : sql<SqlBool>`false`)
      if (f.name) c.push(eb('g.name', 'ilike', like(f.name)))
      c.push(eb('g.status', '=', (f.status as 'ACTIVE' | 'ARCHIVED') ?? 'ACTIVE'))
      return eb.and(c)
    })
    const [rows, total] = await Promise.all([
      base.orderBy('c.name').orderBy('g.name').limit(q.limit).offset(q.offset).execute(),
      this.db
        .selectFrom(base.as('x'))
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .executeTakeFirstOrThrow(),
    ])
    return { records: rows.map((r) => this.toGroup(r)), total: Number(total.n) }
  }

  async findGroup(id: string) {
    if (!isUuid(id)) return null
    const r = await this.groups().where('g.id', '=', id).executeTakeFirst()
    return r ? this.toGroup(r) : null
  }

  async insertGroup(d: { courseId: string; name: string }) {
    const dup = await this.db
      .selectFrom('student_groups')
      .select('id')
      .where('course_id', '=', d.courseId)
      .where('name', '=', d.name)
      .executeTakeFirst()
    if (dup) throw DomainError.validation([{ field: 'name', message: 'Группа с таким названием в курсе уже есть' }])
    const r = await this.db
      .insertInto('student_groups')
      .values({ course_id: d.courseId, name: d.name })
      .returning('id')
      .executeTakeFirstOrThrow()
    return r.id
  }

  async updateGroup(id: string, d: { name: string }, revision: number) {
    await this.bump('student_groups', id, revision, { name: d.name })
  }

  async setGroupMembers(groupId: string, userIds: string[]) {
    const cur = await this.db
      .selectFrom('group_memberships')
      .select('user_id')
      .where('group_id', '=', groupId)
      .execute()
    const curSet = new Set(cur.map((r) => r.user_id))
    const next = new Set(userIds)
    const del = [...curSet].filter((x) => !next.has(x))
    const add = [...next].filter((x) => !curSet.has(x))
    if (del.length)
      await this.db
        .deleteFrom('group_memberships')
        .where('group_id', '=', groupId)
        .where('user_id', 'in', del)
        .execute()
    if (add.length)
      await this.db
        .insertInto('group_memberships')
        .values(add.map((user_id) => ({ group_id: groupId, user_id })))
        .execute()
  }

  // ---------------- generic ----------------
  async setArchived(entity: Entity, id: string, archived: boolean, by: string, reason: string | null) {
    await sql`update ${sql.table(entity)} set status = ${archived ? 'ARCHIVED' : 'ACTIVE'},
      archived_at = ${archived ? new Date() : null}, archived_by = ${archived ? by : null}, archive_reason = ${archived ? reason : null},
      updated_at = now(), revision = revision + 1 where id = ${id}`.execute(this.db)
  }

  async usageCount(entity: Entity, id: string): Promise<number> {
    const q: Record<Entity, ReturnType<typeof sql<{ n: number }>>> = {
      subjects: sql<{ n: number }>`select (select count(*) from courses where subject_id = ${id})::int as n`,
      courses: sql<{
        n: number
      }>`select ((select count(*) from topics where course_id = ${id}) + (select count(*) from student_groups where course_id = ${id})
        + (select count(*) from assignments where course_id = ${id}) + (select count(*) from learning_objectives where course_id = ${id})
        + (select count(*) from items where course_id = ${id}))::int as n`,
      topics: sql<{
        n: number
      }>`select ((select count(*) from topics where parent_id = ${id}) + (select count(*) from learning_objectives where topic_id = ${id})
        + (select count(*) from assignment_topics where topic_id = ${id}) + (select count(*) from item_version_topics where topic_id = ${id})
        + (select count(*) from media_topics where topic_id = ${id}))::int as n`,
      learning_objectives: sql<{
        n: number
      }>`select (select count(*) from assignment_objectives where objective_id = ${id})::int as n`,
      student_groups: sql<{
        n: number
      }>`select ((select count(*) from group_memberships where group_id = ${id}) + (select count(*) from assignment_targets where group_id = ${id}))::int as n`,
    }
    const r = await q[entity].execute(this.db)
    return r.rows[0]?.n ?? 0
  }

  async deleteRow(entity: Entity, id: string) {
    await sql`delete from ${sql.table(entity)} where id = ${id}`.execute(this.db)
  }

  async usersWithRole(userIds: string[], roleCode: string) {
    const valid = userIds.filter(isUuid)
    if (!valid.length) return []
    const rows = await this.db
      .selectFrom('users')
      .innerJoin('user_roles', 'user_roles.user_id', 'users.id')
      .innerJoin('roles', 'roles.id', 'user_roles.role_id')
      .select('users.id')
      .where('users.id', 'in', valid)
      .where('roles.code', '=', roleCode)
      .where('users.status', 'in', ['ACTIVE', 'INVITED'])
      .execute()
    return rows.map((r) => r.id)
  }

  async userHasPermission(userId: string, key: string) {
    if (!isUuid(userId)) return false
    const r = await this.db
      .selectFrom('users')
      .innerJoin('user_roles', 'user_roles.user_id', 'users.id')
      .innerJoin('role_permissions', 'role_permissions.role_id', 'user_roles.role_id')
      .select('users.id')
      .where('users.id', '=', userId)
      .where('users.status', '=', 'ACTIVE')
      .where('role_permissions.permission_key', '=', key)
      .executeTakeFirst()
    return !!r
  }

  async listUsersByRole(roleCode: string, limit: number) {
    return this.db
      .selectFrom('users')
      .innerJoin('user_roles', 'user_roles.user_id', 'users.id')
      .innerJoin('roles', 'roles.id', 'user_roles.role_id')
      .select(['users.id', 'users.display_name as displayName', 'users.email'])
      .where('roles.code', '=', roleCode)
      .where('users.status', 'in', ['ACTIVE', 'INVITED'])
      .orderBy('users.display_name')
      .limit(limit)
      .execute()
  }

  // ---------------- question types ----------------
  async listQuestionTypes(q: ListQuery) {
    let base = this.db.selectFrom('question_types').select(['id', 'code', 'name', 'interaction_key', 'status'])
    if (q.filters.status) base = base.where('status', '=', q.filters.status as 'ACTIVE' | 'INACTIVE')
    if (q.filters.name) base = base.where('name', 'ilike', like(q.filters.name))
    const [rows, total] = await Promise.all([
      base.orderBy('name').limit(q.limit).offset(q.offset).execute(),
      this.db
        .selectFrom(base.as('x'))
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .executeTakeFirstOrThrow(),
    ])
    return { records: rows.map(toQt), total: Number(total.n) }
  }

  async findQuestionTypes(ids: string[]) {
    const valid = ids.filter(isUuid)
    if (!valid.length) return []
    const rows = await this.db
      .selectFrom('question_types')
      .select(['id', 'code', 'name', 'interaction_key', 'status'])
      .where('id', 'in', valid)
      .execute()
    return rows.map(toQt)
  }

  // ---------------- assignments ----------------
  private assignments() {
    const arr = (expr: string) => sql<string[]>`coalesce((${sql.raw(expr)}), '{}')`
    return this.db
      .selectFrom('assignments as a')
      .innerJoin('courses as c', 'c.id', 'a.course_id')
      .innerJoin('users as o', 'o.id', 'a.owner_id')
      .leftJoin('users as rv', 'rv.id', 'a.default_reviewer_id')
      .selectAll('a')
      .select([
        'c.name as course_name',
        'o.display_name as owner_name',
        'rv.display_name as reviewer_name',
        arr('select array_agg(topic_id) from assignment_topics where assignment_id = a.id').as('topic_ids'),
        arr('select array_agg(objective_id) from assignment_objectives where assignment_id = a.id').as('objective_ids'),
        arr('select array_agg(question_type_id) from assignment_question_types where assignment_id = a.id').as(
          'question_type_ids',
        ),
        arr('select array_agg(user_id) from assignment_targets where assignment_id = a.id and user_id is not null').as(
          'target_user_ids',
        ),
        arr(
          'select array_agg(group_id) from assignment_targets where assignment_id = a.id and group_id is not null',
        ).as('target_group_ids'),
      ])
  }

  private toAssignment(r: any): AssignmentRecord {
    return {
      id: r.id,
      courseId: r.course_id,
      courseName: r.course_name,
      ownerId: r.owner_id,
      ownerName: r.owner_name,
      title: r.title,
      instructions: r.instructions,
      minItems: r.min_items,
      maxItems: r.max_items,
      maxTestsPerStudent: r.max_tests_per_student,
      deadlineAt: r.deadline_at,
      defaultReviewerId: r.default_reviewer_id,
      defaultReviewerName: r.reviewer_name ?? null,
      status: r.status,
      topicIds: r.topic_ids ?? [],
      objectiveIds: r.objective_ids ?? [],
      questionTypeIds: r.question_type_ids ?? [],
      targetUserIds: r.target_user_ids ?? [],
      targetGroupIds: r.target_group_ids ?? [],
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      revision: r.revision,
    }
  }

  async listAssignments(filter: ScopeFilter, q: ListQuery) {
    const f = q.filters
    const base = this.assignments().where((eb) => {
      const c: Expression<SqlBool>[] = []
      if (filter.kind === 'SCOPED') {
        const ors: Expression<SqlBool>[] = []
        if (filter.scopes.has('COURSE')) ors.push(teaches('a.course_id', filter.userId))
        if (filter.scopes.has('ASSIGNED'))
          ors.push(sql<SqlBool>`(a.status in ('ACTIVE','CLOSED') and ${targeted('a.id', filter.userId)})`)
        ors.push(sql<SqlBool>`false`)
        c.push(eb.or(ors))
      }
      if (f.courseId) c.push(isUuid(f.courseId) ? eb('a.course_id', '=', f.courseId) : sql<SqlBool>`false`)
      if (f.title) c.push(eb('a.title', 'ilike', like(f.title)))
      if (f.status) c.push(eb('a.status', '=', f.status as AssignmentRecord['status']))
      else c.push(eb('a.status', '!=', 'ARCHIVED'))
      if (f.ownerId && isUuid(f.ownerId)) c.push(eb('a.owner_id', '=', f.ownerId))
      return eb.and(c)
    })
    const sortCol =
      { deadlineAt: 'a.deadline_at', title: 'a.title', status: 'a.status', createdAt: 'a.created_at' }[
        q.sortBy ?? ''
      ] ?? 'a.created_at'
    const [rows, total] = await Promise.all([
      base
        .orderBy(sql.ref(sortCol), q.direction === 'asc' ? 'asc' : 'desc')
        .orderBy('a.id')
        .limit(q.limit)
        .offset(q.offset)
        .execute(),
      this.db
        .selectFrom(base.as('x'))
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .executeTakeFirstOrThrow(),
    ])
    return { records: rows.map((r) => this.toAssignment(r)), total: Number(total.n) }
  }

  async findAssignment(id: string) {
    if (!isUuid(id)) return null
    const r = await this.assignments().where('a.id', '=', id).executeTakeFirst()
    return r ? this.toAssignment(r) : null
  }

  async insertAssignment(d: Parameters<EducationRepository['insertAssignment']>[0]) {
    const r = await this.db
      .insertInto('assignments')
      .values({
        course_id: d.courseId,
        owner_id: d.ownerId,
        title: d.title,
        instructions: d.instructions,
        min_items: d.minItems,
        max_items: d.maxItems,
        max_tests_per_student: d.maxTestsPerStudent,
        deadline_at: d.deadlineAt,
      })
      .returning('id')
      .executeTakeFirstOrThrow()
    return r.id
  }

  async updateAssignment(id: string, d: Parameters<EducationRepository['updateAssignment']>[1], revision?: number) {
    const map: Record<string, string> = {
      title: 'title',
      instructions: 'instructions',
      minItems: 'min_items',
      maxItems: 'max_items',
      maxTestsPerStudent: 'max_tests_per_student',
      deadlineAt: 'deadline_at',
      defaultReviewerId: 'default_reviewer_id',
      status: 'status',
    }
    const values: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(d)) if (v !== undefined) values[map[k]!] = v
    if (revision === undefined) {
      await this.db
        .updateTable('assignments')
        .set({ ...values, updated_at: new Date(), revision: sql<number>`revision + 1` } as any)
        .where('id', '=', id)
        .execute()
      return
    }
    await this.bump('assignments', id, revision, values)
  }

  async setAssignmentLinks(id: string, d: Parameters<EducationRepository['setAssignmentLinks']>[1]) {
    await this.db.deleteFrom('assignment_topics').where('assignment_id', '=', id).execute()
    await this.db.deleteFrom('assignment_objectives').where('assignment_id', '=', id).execute()
    await this.db.deleteFrom('assignment_question_types').where('assignment_id', '=', id).execute()
    await this.db.deleteFrom('assignment_targets').where('assignment_id', '=', id).execute()
    if (d.topicIds.length)
      await this.db
        .insertInto('assignment_topics')
        .values(d.topicIds.map((topic_id) => ({ assignment_id: id, topic_id })))
        .execute()
    if (d.objectiveIds.length) {
      await this.db
        .insertInto('assignment_objectives')
        .values(d.objectiveIds.map((objective_id) => ({ assignment_id: id, objective_id })))
        .execute()
    }
    if (d.questionTypeIds.length) {
      await this.db
        .insertInto('assignment_question_types')
        .values(d.questionTypeIds.map((question_type_id) => ({ assignment_id: id, question_type_id })))
        .execute()
    }
    const targets = [
      ...d.targetUserIds.map((user_id) => ({ assignment_id: id, user_id, group_id: null })),
      ...d.targetGroupIds.map((group_id) => ({ assignment_id: id, user_id: null, group_id })),
    ]
    if (targets.length) await this.db.insertInto('assignment_targets').values(targets).execute()
  }

  async isTargeted(assignmentId: string, userId: string) {
    if (!isUuid(assignmentId)) return false
    const r = await sql<{
      t: boolean
    }>`select ${targeted('a.id', userId)} as t from assignments a where a.id = ${assignmentId}`.execute(this.db)
    return !!r.rows[0]?.t
  }

  async findExtension(assignmentId: string, userId: string) {
    const r = await this.db
      .selectFrom('deadline_extensions')
      .select('new_deadline_at')
      .where('assignment_id', '=', assignmentId)
      .where('user_id', '=', userId)
      .executeTakeFirst()
    return r?.new_deadline_at ?? null
  }

  async upsertExtension(d: Parameters<EducationRepository['upsertExtension']>[0]) {
    await this.db
      .insertInto('deadline_extensions')
      .values({
        assignment_id: d.assignmentId,
        user_id: d.userId,
        new_deadline_at: d.newDeadlineAt,
        reason: d.reason,
        granted_by: d.grantedBy,
      })
      .onConflict((oc) =>
        oc.columns(['assignment_id', 'user_id']).doUpdateSet({
          new_deadline_at: d.newDeadlineAt,
          reason: d.reason,
          granted_by: d.grantedBy,
          granted_at: new Date(),
        }),
      )
      .execute()
  }

  // ---------------- helpers ----------------
  private async bump(table: string, id: string, revision: number, values: Record<string, unknown>) {
    const r = await this.db
      .updateTable(table as any)
      .set({ ...values, updated_at: new Date(), revision: sql<number>`revision + 1` } as any)
      .where('id' as any, '=', id)
      .where('revision' as any, '=', revision)
      .executeTakeFirst()
    if (Number(r.numUpdatedRows) === 0) {
      const exists = await this.db
        .selectFrom(table as any)
        .select('id' as any)
        .where('id' as any, '=', id)
        .executeTakeFirst()
      throw exists ? DomainError.conflict() : DomainError.notFound()
    }
  }

  private async assertUnique(
    table: string,
    col: string,
    value: string,
    exceptId: string | null,
    field: string,
    message: string,
  ) {
    let q = this.db
      .selectFrom(table as any)
      .select('id' as any)
      .where(col as any, '=', value)
    if (exceptId) q = q.where('id' as any, '!=', exceptId)
    if (await q.executeTakeFirst()) throw DomainError.validation([{ field, message }])
  }
}

function toQt(r: {
  id: string
  code: string
  name: string
  interaction_key: string
  status: string
}): QuestionTypeRecord {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    interactionKey: r.interaction_key,
    status: r.status as QuestionTypeRecord['status'],
  }
}
