import { sql, type Kysely } from 'kysely'

/**
 * T-044…T-047: учебная структура (BL-03), задания (BL-04).
 * question_types — минимальная часть реестра (T-057 вынесен вперед для allowedQuestionTypes, см. task-registry);
 * версии типов и схемы появятся в M3.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE TABLE subjects (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      code text NOT NULL UNIQUE CHECK (length(code) BETWEEN 1 AND 40),
      name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
      status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')),
      archived_at timestamptz, archived_by uuid REFERENCES users(id) ON DELETE RESTRICT, archive_reason text,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      revision integer NOT NULL DEFAULT 1
    );

    CREATE TABLE courses (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      subject_id uuid NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
      code text NOT NULL CHECK (length(code) BETWEEN 1 AND 40),
      name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
      academic_period text,
      status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')),
      archived_at timestamptz, archived_by uuid REFERENCES users(id) ON DELETE RESTRICT, archive_reason text,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      revision integer NOT NULL DEFAULT 1,
      UNIQUE (subject_id, code)
    );

    CREATE TABLE course_teachers (
      course_id uuid NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      PRIMARY KEY (course_id, user_id)
    );
    CREATE INDEX course_teachers_user_idx ON course_teachers (user_id);

    CREATE TABLE topics (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      course_id uuid NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
      parent_id uuid REFERENCES topics(id) ON DELETE RESTRICT,
      name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
      ordinal integer NOT NULL DEFAULT 0,
      status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')),
      archived_at timestamptz, archived_by uuid REFERENCES users(id) ON DELETE RESTRICT, archive_reason text,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      revision integer NOT NULL DEFAULT 1,
      CHECK (parent_id IS NULL OR parent_id <> id)
    );
    CREATE INDEX topics_course_idx ON topics (course_id);
    CREATE INDEX topics_parent_idx ON topics (parent_id);

    CREATE TABLE learning_objectives (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      course_id uuid NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
      topic_id uuid NOT NULL REFERENCES topics(id) ON DELETE RESTRICT,
      code text NOT NULL CHECK (length(code) BETWEEN 1 AND 40),
      text text NOT NULL CHECK (length(text) BETWEEN 1 AND 1000),
      bloom_level text CHECK (bloom_level IN ('REMEMBER','UNDERSTAND','APPLY','ANALYZE','EVALUATE','CREATE')),
      status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')),
      archived_at timestamptz, archived_by uuid REFERENCES users(id) ON DELETE RESTRICT, archive_reason text,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      revision integer NOT NULL DEFAULT 1,
      UNIQUE (course_id, code)
    );
    CREATE INDEX objectives_topic_idx ON learning_objectives (topic_id);

    CREATE TABLE student_groups (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      course_id uuid NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
      name text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
      status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')),
      archived_at timestamptz, archived_by uuid REFERENCES users(id) ON DELETE RESTRICT, archive_reason text,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      revision integer NOT NULL DEFAULT 1,
      UNIQUE (course_id, name)
    );

    CREATE TABLE group_memberships (
      group_id uuid NOT NULL REFERENCES student_groups(id) ON DELETE RESTRICT,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      added_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (group_id, user_id)
    );
    CREATE INDEX group_memberships_user_idx ON group_memberships (user_id);

    CREATE TABLE question_types (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      code text NOT NULL UNIQUE CHECK (code ~ '^[a-z][a-z0-9_]{1,49}$'),
      name text NOT NULL,
      description text,
      interaction_key text NOT NULL,
      status text NOT NULL DEFAULT 'INACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      revision integer NOT NULL DEFAULT 1
    );

    CREATE TABLE assignments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      course_id uuid NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
      owner_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
      instructions text,
      min_items integer NOT NULL DEFAULT 1,
      max_items integer NOT NULL DEFAULT 10,
      max_tests_per_student integer NOT NULL DEFAULT 1 CHECK (max_tests_per_student BETWEEN 1 AND 10),
      deadline_at timestamptz,
      default_reviewer_id uuid REFERENCES users(id) ON DELETE RESTRICT,
      status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','CLOSED','ARCHIVED')),
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      revision integer NOT NULL DEFAULT 1,
      CHECK (min_items >= 1 AND min_items <= max_items AND max_items <= 100)
    );
    CREATE INDEX assignments_course_idx ON assignments (course_id);

    CREATE TABLE assignment_topics (
      assignment_id uuid NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
      topic_id uuid NOT NULL REFERENCES topics(id) ON DELETE RESTRICT,
      PRIMARY KEY (assignment_id, topic_id)
    );
    CREATE TABLE assignment_objectives (
      assignment_id uuid NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
      objective_id uuid NOT NULL REFERENCES learning_objectives(id) ON DELETE RESTRICT,
      PRIMARY KEY (assignment_id, objective_id)
    );
    CREATE TABLE assignment_question_types (
      assignment_id uuid NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
      question_type_id uuid NOT NULL REFERENCES question_types(id) ON DELETE RESTRICT,
      PRIMARY KEY (assignment_id, question_type_id)
    );
    CREATE TABLE assignment_targets (
      assignment_id uuid NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
      user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
      group_id uuid REFERENCES student_groups(id) ON DELETE RESTRICT,
      CHECK ((user_id IS NULL) <> (group_id IS NULL))
    );
    CREATE UNIQUE INDEX assignment_targets_user_uq ON assignment_targets (assignment_id, user_id) WHERE user_id IS NOT NULL;
    CREATE UNIQUE INDEX assignment_targets_group_uq ON assignment_targets (assignment_id, group_id) WHERE group_id IS NOT NULL;

    CREATE TABLE deadline_extensions (
      assignment_id uuid NOT NULL REFERENCES assignments(id) ON DELETE RESTRICT,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      new_deadline_at timestamptz NOT NULL,
      reason text,
      granted_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      granted_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (assignment_id, user_id)
    );
  `.execute(db)
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`
    DROP TABLE deadline_extensions, assignment_targets, assignment_question_types, assignment_objectives,
      assignment_topics, assignments, question_types, group_memberships, student_groups, learning_objectives,
      topics, course_teachers, courses, subjects;
  `.execute(db)
}
