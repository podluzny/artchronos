import { sql } from 'kysely'
import { DomainError } from '../../domain/shared/errors.js'
import type {
  QuestionTypeFull,
  QuestionTypeRepository,
  QuestionTypeVersionRecord,
} from '../../application/itembank/ports.js'
import type { ListQuery } from '../../application/shared/query.js'
import type { Db } from '../db/kysely.js'
import { escapeLike, isUuid } from '../identity/user-repository.js'

function toVersion(r: any): QuestionTypeVersionRecord {
  return {
    id: r.id,
    questionTypeId: r.question_type_id,
    versionNo: r.version_no,
    interactionConfig: r.interaction_config,
    contentSchema: r.content_schema,
    responseSchema: r.response_schema,
    answerKeySchema: r.answer_key_schema,
    evaluation: r.evaluation,
    createdAt: r.created_at,
  }
}

export class KyselyQuestionTypeRepository implements QuestionTypeRepository {
  constructor(private readonly db: Db) {}

  private base() {
    return this.db
      .selectFrom('question_types as t')
      .leftJoin('question_type_versions as v', 'v.id', 't.current_version_id')
      .selectAll('t')
      .select([
        sql<any>`case when v.id is null then null else row_to_json(v.*) end`.as('current'),
        sql<
          { id: string; versionNo: number; createdAt: string }[]
        >`coalesce((select json_agg(json_build_object('id', x.id, 'versionNo', x.version_no, 'createdAt', x.created_at) order by x.version_no) from question_type_versions x where x.question_type_id = t.id), '[]'::json)`.as(
          'versions',
        ),
        sql<string>`(select count(*) from items i where i.question_type_id = t.id)`.as('item_count'),
        sql<string>`(select count(*) from assignment_question_types aq join assignments a on a.id = aq.assignment_id where aq.question_type_id = t.id and a.status = 'ACTIVE')`.as(
          'active_assignments',
        ),
      ])
  }

  private toFull(r: any): QuestionTypeFull {
    return {
      id: r.id,
      code: r.code,
      name: r.name,
      description: r.description,
      interactionKey: r.interaction_key,
      status: r.status,
      currentVersionId: r.current_version_id,
      currentVersion: r.current ? toVersion({ ...r.current, created_at: new Date(r.current.created_at) }) : null,
      versions: (r.versions ?? []).map((v: any) => ({
        id: v.id,
        versionNo: v.versionNo,
        createdAt: new Date(v.createdAt),
      })),
      itemCount: Number(r.item_count),
      activeAssignmentCount: Number(r.active_assignments),
      revision: r.revision,
    }
  }

  async list(q: ListQuery) {
    let base = this.base()
    if (q.filters.status) base = base.where('t.status', '=', q.filters.status as 'ACTIVE')
    if (q.filters.name) base = base.where('t.name', 'ilike', `%${escapeLike(q.filters.name)}%`)
    if (q.filters.interactionKey) base = base.where('t.interaction_key', '=', q.filters.interactionKey)
    const [rows, total] = await Promise.all([
      base.orderBy('t.name').limit(q.limit).offset(q.offset).execute(),
      this.db
        .selectFrom(base.as('x'))
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .executeTakeFirstOrThrow(),
    ])
    return { records: rows.map((r) => this.toFull(r)), total: Number(total.n) }
  }

  async findById(id: string) {
    if (!isUuid(id)) return null
    const r = await this.base().where('t.id', '=', id).executeTakeFirst()
    return r ? this.toFull(r) : null
  }

  async findByCode(code: string) {
    const r = await this.base().where('t.code', '=', code).executeTakeFirst()
    return r ? this.toFull(r) : null
  }

  async findVersion(id: string) {
    if (!isUuid(id)) return null
    const r = await this.db.selectFrom('question_type_versions').selectAll().where('id', '=', id).executeTakeFirst()
    return r ? toVersion(r) : null
  }

  async insertType(d: { code: string; name: string; description: string | null; interactionKey: string }) {
    const r = await this.db
      .insertInto('question_types')
      .values({
        code: d.code,
        name: d.name,
        description: d.description,
        interaction_key: d.interactionKey,
        status: 'INACTIVE',
      })
      .returning('id')
      .executeTakeFirstOrThrow()
    return r.id
  }

  async insertVersion(d: Parameters<QuestionTypeRepository['insertVersion']>[0]) {
    const next = await this.db
      .selectFrom('question_type_versions')
      .select(sql<number>`coalesce(max(version_no), 0) + 1`.as('n'))
      .where('question_type_id', '=', d.questionTypeId)
      .executeTakeFirstOrThrow()
    const r = await this.db
      .insertInto('question_type_versions')
      .values({
        question_type_id: d.questionTypeId,
        version_no: next.n,
        interaction_config: JSON.stringify(d.interactionConfig),
        content_schema: JSON.stringify(d.contentSchema),
        response_schema: JSON.stringify(d.responseSchema),
        answer_key_schema: JSON.stringify(d.answerKeySchema),
        evaluation: JSON.stringify(d.evaluation),
        created_by: d.createdBy,
      })
      .returningAll()
      .executeTakeFirstOrThrow()
    return toVersion(r)
  }

  async update(id: string, d: Parameters<QuestionTypeRepository['update']>[1], revision?: number) {
    const values: Record<string, unknown> = {}
    if (d.name !== undefined) values.name = d.name
    if (d.description !== undefined) values.description = d.description
    if (d.status !== undefined) values.status = d.status
    if (d.currentVersionId !== undefined) values.current_version_id = d.currentVersionId
    let q = this.db
      .updateTable('question_types')
      .set({ ...values, updated_at: new Date(), revision: sql<number>`revision + 1` } as any)
      .where('id', '=', id)
    if (revision !== undefined) q = q.where('revision', '=', revision)
    const r = await q.executeTakeFirst()
    if (Number(r.numUpdatedRows) === 0)
      throw (await this.findById(id)) ? DomainError.conflict() : DomainError.notFound()
  }
}
