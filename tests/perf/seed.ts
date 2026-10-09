import { sql } from 'kysely'
import type { Db } from '../../src/infrastructure/db/kysely.js'

/**
 * Объемный seed для NFR-PERF-001: 50 000 вопросов (половина утверждена) и 10 000 медиа в одном курсе,
 * 200 студентов-авторов. Вставка множествами (generate_series), переходы состояний — по допустимым шагам (BR-013).
 */
export async function seedVolume(
  db: Db,
  w: { courseId: string; assignmentId: string; topicId: string; subtopicId: string; teacherId: string; qtId: string },
  opts: { items: number; media: number; students: string[] },
) {
  const qtv = (
    await sql<{ id: string }>`select current_version_id as id from question_types where id = ${w.qtId}`.execute(db)
  ).rows[0]!.id
  await db.transaction().execute(async (trx) => {
    await sql`
      create temporary table seed_items on commit drop as
      select gen_random_uuid() as id, gen_random_uuid() as vid, g as n,
        (${sql.val(opts.students)}::uuid[])[1 + (g % ${opts.students.length})] as owner_id
      from generate_series(1, ${opts.items}) g`.execute(trx)
    await sql`
      insert into items (id, question_type_id, owner_id, assignment_id, course_id, created_at, updated_at)
      select id, ${w.qtId}, owner_id, case when n % 2 = 0 then ${w.assignmentId}::uuid else null end, ${w.courseId},
        now() - (n || ' minutes')::interval, now() - (n || ' minutes')::interval
      from seed_items`.execute(trx)
    await sql`
      insert into item_versions (id, item_id, version_no, question_type_version_id, stem, content, answer_key,
        difficulty, author_ids, created_at, updated_at)
      select vid, id, 1, ${qtv}, 'Кто автор произведения №' || n || '? Пейзаж, жанр, школа',
        '{"shuffleOptions": true}'::jsonb, '{"correct": ["o1"]}'::jsonb, 1 + n % 5, array[owner_id],
        now() - (n || ' minutes')::interval, now() - (n || ' minutes')::interval
      from seed_items`.execute(trx)
    await sql`
      insert into item_options (item_version_id, key, role, text, ordinal)
      select vid, 'o' || k, 'OPTION', 'Вариант ' || k, k - 1 from seed_items, generate_series(1, 3) k`.execute(trx)
    await sql`
      insert into item_version_topics (item_version_id, topic_id)
      select vid, case when n % 3 = 0 then ${w.subtopicId}::uuid else ${w.topicId}::uuid end from seed_items`.execute(
      trx,
    )
    // половина утверждена: DRAFT → READY_FOR_REVIEW → IN_REVIEW → APPROVED
    for (const state of ['READY_FOR_REVIEW', 'IN_REVIEW', 'APPROVED'])
      await sql`update item_versions set state = ${state}, ever_submitted = true
        where id in (select vid from seed_items where n % 2 = 1)`.execute(trx)
    await sql`update items i set latest_approved_version_id = s.vid from seed_items s where s.id = i.id and s.n % 2 = 1`.execute(
      trx,
    )
    await sql`update items i set current_draft_version_id = s.vid from seed_items s where s.id = i.id and s.n % 2 = 0`.execute(
      trx,
    )
    await sql`
      insert into media_assets (kind, storage_key, mime_type, size_bytes, sha256, width, height, title, alt_text, artist,
        work_title, license, rights_status, owner_id, derivatives_status, created_at, updated_at)
      select 'IMAGE', 'perf/' || g || '/' || gen_random_uuid(), 'image/jpeg', 100000 + g, md5(g::text), 800, 600,
        'Произведение ' || g, 'Описание изображения ' || g,
        (array['Шишкин','Левитан','Саврасов','Куинджи','Айвазовский','Репин'])[1 + g % 6],
        'Картина ' || g, 'PUBLIC_DOMAIN', case when g % 4 = 0 then 'PENDING' else 'CLEARED' end, ${w.teacherId}, 'READY',
        now() - (g || ' minutes')::interval, now() - (g || ' minutes')::interval
      from generate_series(1, ${opts.media}) g`.execute(trx)
  })
  await sql`analyze`.execute(db)
}
