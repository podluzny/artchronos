import { sql, type Kysely } from 'kysely'

/**
 * M4 (T-066…T-070): конструктор тестов (BL-08). Test / TestVersion / Section / TestSectionItem / SelectionRule /
 * SelectionPoolEntry. Неизменяемость версии теста вне DRAFT (BR-002, BR-007, INV-001) обеспечивается триггерами.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE TABLE tests (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
      owner_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      assignment_id uuid REFERENCES assignments(id) ON DELETE RESTRICT,
      course_id uuid NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
      current_draft_version_id uuid,
      published_version_id uuid,
      status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')),
      archived_at timestamptz, archived_by uuid REFERENCES users(id) ON DELETE RESTRICT, archive_reason text,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      revision integer NOT NULL DEFAULT 1
    );
    CREATE INDEX tests_owner_idx ON tests (owner_id);
    CREATE INDEX tests_assignment_idx ON tests (assignment_id);
    CREATE INDEX tests_course_idx ON tests (course_id);

    CREATE TABLE test_versions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      test_id uuid NOT NULL REFERENCES tests(id) ON DELETE RESTRICT,
      version_no integer NOT NULL,
      based_on_version_id uuid REFERENCES test_versions(id) ON DELETE RESTRICT,
      state text NOT NULL DEFAULT 'DRAFT' CHECK (state IN ('DRAFT','READY_FOR_REVIEW','IN_REVIEW','CHANGES_REQUESTED','APPROVED','PUBLISHED','ARCHIVED')),
      title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
      description text,
      instructions text,
      settings jsonb NOT NULL,
      author_ids uuid[] NOT NULL,
      -- пакет review (versioning-model §6): версии вопросов, отправленные каскадом вместе с тестом
      package_item_version_ids uuid[] NOT NULL DEFAULT '{}',
      ever_submitted boolean NOT NULL DEFAULT false,
      submitted_at timestamptz,
      approved_at timestamptz, approved_by uuid REFERENCES users(id) ON DELETE RESTRICT,
      published_at timestamptz, published_by uuid REFERENCES users(id) ON DELETE RESTRICT,
      archived_at timestamptz, archive_reason text,
      content_hash text,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      revision integer NOT NULL DEFAULT 1,
      UNIQUE (test_id, version_no)
    );
    -- BR-041 и BR-009 (INV-005)
    CREATE UNIQUE INDEX test_versions_one_draft ON test_versions (test_id) WHERE state = 'DRAFT';
    CREATE UNIQUE INDEX test_versions_one_published ON test_versions (test_id) WHERE state = 'PUBLISHED';
    ALTER TABLE tests ADD CONSTRAINT tests_draft_fk FOREIGN KEY (current_draft_version_id) REFERENCES test_versions(id) ON DELETE SET NULL;
    ALTER TABLE tests ADD CONSTRAINT tests_published_fk FOREIGN KEY (published_version_id) REFERENCES test_versions(id) ON DELETE RESTRICT;

    CREATE TABLE test_sections (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      test_version_id uuid NOT NULL REFERENCES test_versions(id) ON DELETE CASCADE,
      title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
      instructions text,
      ordinal integer NOT NULL,
      time_limit_sec integer CHECK (time_limit_sec IS NULL OR time_limit_sec > 0),
      shuffle_items boolean
    );
    CREATE INDEX test_sections_version_idx ON test_sections (test_version_id);

    CREATE TABLE test_section_items (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      test_version_id uuid NOT NULL REFERENCES test_versions(id) ON DELETE CASCADE,
      section_id uuid NOT NULL REFERENCES test_sections(id) ON DELETE CASCADE,
      item_id uuid NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
      item_version_id uuid NOT NULL REFERENCES item_versions(id) ON DELETE RESTRICT,
      ordinal integer NOT NULL,
      points numeric NOT NULL CHECK (points > 0 AND points <= 100),
      -- AC-TEST-002.2: один Item не более одного раза в версии теста
      UNIQUE (test_version_id, item_id)
    );
    CREATE INDEX test_section_items_iv_idx ON test_section_items (item_version_id);

    CREATE TABLE selection_rules (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      test_version_id uuid NOT NULL REFERENCES test_versions(id) ON DELETE CASCADE,
      section_id uuid NOT NULL REFERENCES test_sections(id) ON DELETE CASCADE,
      ordinal integer NOT NULL,
      count integer NOT NULL CHECK (count BETWEEN 1 AND 100),
      points_per_item numeric NOT NULL CHECK (points_per_item > 0 AND points_per_item <= 100),
      filter jsonb NOT NULL
    );

    CREATE TABLE selection_pool_entries (
      selection_rule_id uuid NOT NULL REFERENCES selection_rules(id) ON DELETE CASCADE,
      item_version_id uuid NOT NULL REFERENCES item_versions(id) ON DELETE RESTRICT,
      PRIMARY KEY (selection_rule_id, item_version_id)
    );
    CREATE INDEX selection_pool_iv_idx ON selection_pool_entries (item_version_id);

    -- ADR-002: содержимое версии теста меняется только в DRAFT (BR-002, BR-007)
    CREATE FUNCTION test_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN
        IF OLD.state <> 'DRAFT' OR OLD.ever_submitted THEN
          RAISE EXCEPTION 'test version % cannot be deleted', OLD.id USING ERRCODE = 'integrity_constraint_violation';
        END IF;
        RETURN OLD;
      END IF;
      IF OLD.state <> 'DRAFT' AND (
           NEW.title IS DISTINCT FROM OLD.title OR NEW.description IS DISTINCT FROM OLD.description
        OR NEW.instructions IS DISTINCT FROM OLD.instructions OR NEW.settings IS DISTINCT FROM OLD.settings
        OR NEW.test_id IS DISTINCT FROM OLD.test_id OR NEW.version_no IS DISTINCT FROM OLD.version_no
        OR NEW.author_ids IS DISTINCT FROM OLD.author_ids OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
        OR NEW.package_item_version_ids IS DISTINCT FROM OLD.package_item_version_ids) THEN
        RAISE EXCEPTION 'test version % is frozen in state % (BR-002/BR-007)', OLD.id, OLD.state USING ERRCODE = 'integrity_constraint_violation';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER test_version_guard BEFORE UPDATE OR DELETE ON test_versions FOR EACH ROW EXECUTE FUNCTION test_version_guard();

    CREATE FUNCTION test_child_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE v_id uuid; v_state text;
    BEGIN
      v_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.test_version_id ELSE NEW.test_version_id END;
      SELECT state INTO v_state FROM test_versions WHERE id = v_id;
      IF v_state IS NOT NULL AND v_state <> 'DRAFT' THEN
        RAISE EXCEPTION 'content of test version % is frozen (state %)', v_id, v_state USING ERRCODE = 'integrity_constraint_violation';
      END IF;
      RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END $$;
    CREATE TRIGGER test_sections_guard BEFORE INSERT OR UPDATE OR DELETE ON test_sections FOR EACH ROW EXECUTE FUNCTION test_child_guard();
    CREATE TRIGGER test_section_items_guard BEFORE INSERT OR UPDATE OR DELETE ON test_section_items FOR EACH ROW EXECUTE FUNCTION test_child_guard();
    CREATE TRIGGER selection_rules_guard BEFORE INSERT OR UPDATE OR DELETE ON selection_rules FOR EACH ROW EXECUTE FUNCTION test_child_guard();

    -- BR-012: пул замораживается при approve (вставка — только пока версия IN_REVIEW), далее неизменен
    CREATE FUNCTION selection_pool_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE v_state text;
    BEGIN
      SELECT tv.state INTO v_state FROM selection_rules r JOIN test_versions tv ON tv.id = r.test_version_id
        WHERE r.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.selection_rule_id ELSE NEW.selection_rule_id END;
      IF v_state IS NOT NULL AND (TG_OP <> 'INSERT' OR v_state <> 'IN_REVIEW') THEN
        RAISE EXCEPTION 'selection pool is frozen (state %)', v_state USING ERRCODE = 'integrity_constraint_violation';
      END IF;
      RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END $$;
    CREATE TRIGGER selection_pool_guard BEFORE INSERT OR UPDATE OR DELETE ON selection_pool_entries FOR EACH ROW EXECUTE FUNCTION selection_pool_guard();
  `.execute(db)
}

export async function down(): Promise<void> {
  throw new Error('Откат миграции 0004 не поддерживается (неизменяемые версии)')
}
