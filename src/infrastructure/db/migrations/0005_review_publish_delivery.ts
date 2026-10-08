import { sql, type Kysely } from 'kysely'

/**
 * M5 (T-072…T-077): экспертиза (BL-09), публикация (BL-10), модель прохождения (BL-12, только схема).
 * Дублирующая защита в БД: допустимые переходы состояний версий (BR-013), закрытый review неизменен (BR-040),
 * один активный PRIMARY (BR-030), Attempt только по PUBLISHED версии (BR-037).
 */
const TEST_CHECKLIST = [
  ['TOPICS', 'Соответствие темам и учебным целям задания', true],
  ['KEYS', 'Корректность ключей ответов во всех вопросах', true],
  ['WORDING', 'Однозначность формулировок, отсутствие подсказок в формулировке', true],
  ['DISTRACTORS', 'Качество дистракторов (правдоподобны, однозначно неверны)', true],
  ['FACTS', 'Фактическая точность атрибуций (автор, название, датировка, место хранения)', true],
  ['MEDIA', 'Медиа: права подтверждены, alt text содержателен, подписи корректны', true],
  ['BALANCE', 'Баланс сложности и баллов соответствует назначению теста', true],
  ['STYLE', 'Грамотность и стиль', true],
  ['SETTINGS', 'Инструкции и настройки теста понятны студенту', false],
] as const
const ITEM_CODES = new Set(['KEYS', 'WORDING', 'DISTRACTORS', 'FACTS', 'MEDIA', 'STYLE'])

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE TABLE checklist_templates (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL,
      applies_to text NOT NULL CHECK (applies_to IN ('TEST_VERSION','ITEM_VERSION')),
      version_no integer NOT NULL,
      items jsonb NOT NULL,
      status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')),
      created_by uuid REFERENCES users(id) ON DELETE RESTRICT,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (applies_to, version_no)
    );
    -- шаблон, применяемый к новым Review: один активный на тип объекта
    CREATE UNIQUE INDEX checklist_templates_one_active ON checklist_templates (applies_to) WHERE status = 'ACTIVE';

    CREATE TABLE reviews (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      subject_type text NOT NULL CHECK (subject_type IN ('TEST_VERSION','ITEM_VERSION')),
      test_version_id uuid REFERENCES test_versions(id) ON DELETE RESTRICT,
      item_version_id uuid REFERENCES item_versions(id) ON DELETE RESTRICT,
      test_id uuid REFERENCES tests(id) ON DELETE RESTRICT,
      item_id uuid REFERENCES items(id) ON DELETE RESTRICT,
      course_id uuid NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
      assignment_id uuid REFERENCES assignments(id) ON DELETE RESTRICT,
      status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','IN_PROGRESS','CHANGES_REQUESTED','APPROVED','CANCELLED')),
      checklist_template_id uuid NOT NULL REFERENCES checklist_templates(id) ON DELETE RESTRICT,
      decision text CHECK (decision IN ('REQUEST_CHANGES','APPROVE')),
      decided_by uuid REFERENCES users(id) ON DELETE RESTRICT,
      decided_at timestamptz,
      summary text,
      submitted_at timestamptz NOT NULL DEFAULT now(),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      revision integer NOT NULL DEFAULT 1,
      CHECK ((subject_type = 'TEST_VERSION') = (test_version_id IS NOT NULL)),
      CHECK ((subject_type = 'ITEM_VERSION') = (item_version_id IS NOT NULL))
    );
    CREATE UNIQUE INDEX reviews_one_open_test ON reviews (test_version_id) WHERE status IN ('OPEN','IN_PROGRESS');
    CREATE UNIQUE INDEX reviews_one_open_item ON reviews (item_version_id) WHERE status IN ('OPEN','IN_PROGRESS');
    CREATE INDEX reviews_test_idx ON reviews (test_id);
    CREATE INDEX reviews_item_idx ON reviews (item_id);

    CREATE TABLE review_assignments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      review_id uuid NOT NULL REFERENCES reviews(id) ON DELETE RESTRICT,
      reviewer_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      role text NOT NULL CHECK (role IN ('PRIMARY','ADVISORY')),
      status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','REVOKED','COMPLETED')),
      assigned_by uuid REFERENCES users(id) ON DELETE RESTRICT,
      assigned_at timestamptz NOT NULL DEFAULT now(),
      reason text
    );
    -- BR-030: ровно один активный PRIMARY
    CREATE UNIQUE INDEX review_assignments_one_primary ON review_assignments (review_id) WHERE role = 'PRIMARY' AND status = 'ACTIVE';
    CREATE INDEX review_assignments_reviewer_idx ON review_assignments (reviewer_id, status);

    CREATE TABLE review_checklist_answers (
      review_id uuid NOT NULL REFERENCES reviews(id) ON DELETE RESTRICT,
      item_code text NOT NULL,
      checked boolean NOT NULL,
      note text,
      answered_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      answered_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (review_id, item_code)
    );

    CREATE TABLE review_comments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      review_id uuid NOT NULL REFERENCES reviews(id) ON DELETE RESTRICT,
      parent_id uuid REFERENCES review_comments(id) ON DELETE RESTRICT,
      author_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      anchor jsonb NOT NULL DEFAULT '{}',
      body text NOT NULL CHECK (length(body) BETWEEN 1 AND 5000),
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX review_comments_review_idx ON review_comments (review_id);

    -- Замечания живут на уровне контейнера (тест/вопрос) и переносятся между версиями (FR-REVIEW-009)
    CREATE TABLE content_issues (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      review_id uuid NOT NULL REFERENCES reviews(id) ON DELETE RESTRICT,
      origin_comment_id uuid REFERENCES review_comments(id) ON DELETE RESTRICT,
      test_id uuid REFERENCES tests(id) ON DELETE RESTRICT,
      item_id uuid REFERENCES items(id) ON DELETE RESTRICT,
      linked_version_id uuid,
      anchor jsonb NOT NULL DEFAULT '{}',
      body text NOT NULL,
      severity text NOT NULL CHECK (severity IN ('BLOCKING','MAJOR','MINOR')),
      status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','ADDRESSED','RESOLVED','WONT_FIX')),
      raised_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      addressed_in_version_id uuid,
      status_note text,
      status_by uuid REFERENCES users(id) ON DELETE RESTRICT,
      status_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CHECK ((test_id IS NULL) <> (item_id IS NULL))
    );
    CREATE INDEX content_issues_test_idx ON content_issues (test_id, status);
    CREATE INDEX content_issues_item_idx ON content_issues (item_id, status);

    -- BR-040: закрытый review неизменен (комментарии и checklist)
    CREATE FUNCTION review_closed_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE v_status text;
    BEGIN
      SELECT status INTO v_status FROM reviews WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.review_id ELSE NEW.review_id END;
      IF v_status IN ('CHANGES_REQUESTED','APPROVED','CANCELLED') THEN
        RAISE EXCEPTION 'review is closed (BR-040)' USING ERRCODE = 'integrity_constraint_violation';
      END IF;
      RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END $$;
    CREATE TRIGGER review_comments_guard BEFORE INSERT OR UPDATE OR DELETE ON review_comments FOR EACH ROW EXECUTE FUNCTION review_closed_guard();
    CREATE TRIGGER review_checklist_guard BEFORE INSERT OR UPDATE OR DELETE ON review_checklist_answers FOR EACH ROW EXECUTE FUNCTION review_closed_guard();

    CREATE FUNCTION review_decision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'reviews cannot be deleted' USING ERRCODE = 'integrity_constraint_violation';
      END IF;
      IF OLD.status IN ('CHANGES_REQUESTED','APPROVED','CANCELLED') AND (
           NEW.status IS DISTINCT FROM OLD.status OR NEW.decision IS DISTINCT FROM OLD.decision
        OR NEW.summary IS DISTINCT FROM OLD.summary OR NEW.decided_by IS DISTINCT FROM OLD.decided_by) THEN
        RAISE EXCEPTION 'review is closed (BR-040)' USING ERRCODE = 'integrity_constraint_violation';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER review_decision_guard BEFORE UPDATE OR DELETE ON reviews FOR EACH ROW EXECUTE FUNCTION review_decision_guard();

    -- BR-013 (SPEC-PUB-001 п.3): только переходы из таблицы lifecycle-state-machine §3
    CREATE FUNCTION version_transition_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.state = OLD.state THEN RETURN NEW; END IF;
      IF (OLD.state, NEW.state) IN (
           ('DRAFT','READY_FOR_REVIEW'), ('READY_FOR_REVIEW','DRAFT'), ('READY_FOR_REVIEW','IN_REVIEW'),
           ('IN_REVIEW','CHANGES_REQUESTED'), ('IN_REVIEW','APPROVED'), ('APPROVED','PUBLISHED'),
           ('PUBLISHED','ARCHIVED'), ('DRAFT','ARCHIVED'), ('READY_FOR_REVIEW','ARCHIVED'),
           ('CHANGES_REQUESTED','ARCHIVED'), ('APPROVED','ARCHIVED')) THEN
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'invalid state transition % -> % (BR-013)', OLD.state, NEW.state USING ERRCODE = 'integrity_constraint_violation';
    END $$;
    CREATE TRIGGER test_version_transition BEFORE UPDATE OF state ON test_versions FOR EACH ROW EXECUTE FUNCTION version_transition_guard();
    CREATE TRIGGER item_version_transition BEFORE UPDATE OF state ON item_versions FOR EACH ROW EXECUTE FUNCTION version_transition_guard();

    -- ===== BL-12: модель прохождения (только схема; Runner вне MVP) =====
    CREATE TABLE attempts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      test_version_id uuid NOT NULL REFERENCES test_versions(id) ON DELETE RESTRICT,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      attempt_no integer NOT NULL CHECK (attempt_no >= 1),
      status text NOT NULL DEFAULT 'IN_PROGRESS' CHECK (status IN ('IN_PROGRESS','SUBMITTED','EXPIRED','ABANDONED')),
      seed integer NOT NULL,
      delivered_items jsonb NOT NULL,
      started_at timestamptz NOT NULL DEFAULT now(),
      submitted_at timestamptz,
      deadline_at timestamptz,
      UNIQUE (test_version_id, user_id, attempt_no)
    );
    CREATE TABLE responses (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      attempt_id uuid NOT NULL REFERENCES attempts(id) ON DELETE RESTRICT,
      item_version_id uuid NOT NULL REFERENCES item_versions(id) ON DELETE RESTRICT,
      payload jsonb NOT NULL,
      answered_at timestamptz NOT NULL DEFAULT now(),
      time_spent_ms integer,
      UNIQUE (attempt_id, item_version_id)
    );
    CREATE TABLE response_evaluations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      response_id uuid NOT NULL REFERENCES responses(id) ON DELETE RESTRICT,
      method text NOT NULL CHECK (method IN ('AUTO','MANUAL')),
      score numeric,
      max_score numeric NOT NULL,
      evaluator_id uuid REFERENCES users(id) ON DELETE RESTRICT,
      evaluated_at timestamptz NOT NULL DEFAULT now(),
      details jsonb NOT NULL DEFAULT '{}'
    );
    CREATE TABLE results (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      attempt_id uuid NOT NULL UNIQUE REFERENCES attempts(id) ON DELETE RESTRICT,
      score numeric NOT NULL,
      max_score numeric NOT NULL,
      passed boolean,
      pending_manual integer NOT NULL DEFAULT 0,
      section_scores jsonb NOT NULL DEFAULT '[]',
      computed_at timestamptz NOT NULL DEFAULT now()
    );

    -- BR-037: попытка начинается только по опубликованной версии; ссылка неизменна
    CREATE FUNCTION attempt_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE v_state text;
    BEGIN
      IF TG_OP = 'INSERT' THEN
        SELECT state INTO v_state FROM test_versions WHERE id = NEW.test_version_id;
        IF v_state IS DISTINCT FROM 'PUBLISHED' THEN
          RAISE EXCEPTION 'attempt requires a PUBLISHED test version (BR-037)' USING ERRCODE = 'integrity_constraint_violation';
        END IF;
      ELSIF NEW.test_version_id IS DISTINCT FROM OLD.test_version_id OR NEW.delivered_items IS DISTINCT FROM OLD.delivered_items THEN
        RAISE EXCEPTION 'attempt version reference is immutable (BR-037)' USING ERRCODE = 'integrity_constraint_violation';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER attempt_guard BEFORE INSERT OR UPDATE ON attempts FOR EACH ROW EXECUTE FUNCTION attempt_guard();
  `.execute(db)

  const items = (filter: (code: string) => boolean) =>
    JSON.stringify(
      TEST_CHECKLIST.filter(([c]) => filter(c)).map(([code, text, mandatory]) => ({ code, text, mandatory })),
    )
  await sql`
    INSERT INTO checklist_templates (name, applies_to, version_no, items) VALUES
      ('Экспертиза теста', 'TEST_VERSION', 1, ${items(() => true)}::jsonb),
      ('Экспертиза вопроса', 'ITEM_VERSION', 1, ${items((c) => ITEM_CODES.has(c))}::jsonb)
  `.execute(db)
}

export async function down(): Promise<void> {
  throw new Error('Откат миграции 0005 не поддерживается')
}
