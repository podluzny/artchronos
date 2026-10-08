import { sql, type Kysely } from 'kysely'

/**
 * M3 (T-049…T-064): медиатека (BL-05), версии типов вопросов (BL-06), банк вопросов (BL-07).
 * Неизменяемость (ADR-002, NFR-DATA-001): триггеры запрещают изменение содержимого версий вне DRAFT
 * и изменение QuestionTypeVersion вообще.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE TABLE tags (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
      normalized text NOT NULL UNIQUE,
      status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')),
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE media_assets (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      kind text NOT NULL CHECK (kind IN ('IMAGE','VIDEO')),
      storage_key text NOT NULL UNIQUE,
      mime_type text NOT NULL,
      size_bytes bigint NOT NULL,
      sha256 text NOT NULL,
      width integer, height integer, duration_sec numeric,
      title text NOT NULL CHECK (length(title) BETWEEN 1 AND 300),
      alt_text text,
      caption text,
      transcript text,
      depicts_artwork boolean NOT NULL DEFAULT true,
      artist text, work_title text, date_text text, technique text, collection text, inventory_no text,
      source_url text, source_description text,
      license text NOT NULL DEFAULT 'UNKNOWN' CHECK (license IN ('PUBLIC_DOMAIN','CC0','CC_BY','CC_BY_SA','CC_BY_NC','CC_BY_NC_SA','LICENSED','EDUCATIONAL_EXCEPTION','UNKNOWN')),
      rights_holder text, credit_line text,
      rights_status text NOT NULL DEFAULT 'PENDING' CHECK (rights_status IN ('PENDING','CLEARED','RESTRICTED')),
      rights_note text,
      rights_verified_by uuid REFERENCES users(id) ON DELETE RESTRICT,
      rights_verified_at timestamptz,
      owner_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      derivatives_status text NOT NULL DEFAULT 'PENDING' CHECK (derivatives_status IN ('PENDING','READY','FAILED','SKIPPED')),
      status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')),
      archived_at timestamptz, archived_by uuid REFERENCES users(id) ON DELETE RESTRICT, archive_reason text,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      revision integer NOT NULL DEFAULT 1
    );
    CREATE INDEX media_sha_idx ON media_assets (sha256);
    CREATE INDEX media_search_idx ON media_assets USING gin (to_tsvector('russian',
      coalesce(title,'') || ' ' || coalesce(artist,'') || ' ' || coalesce(work_title,'') || ' ' || coalesce(caption,'')));

    CREATE TABLE media_derivatives (
      media_id uuid NOT NULL REFERENCES media_assets(id) ON DELETE RESTRICT,
      variant text NOT NULL CHECK (variant IN ('THUMB','PREVIEW','POSTER')),
      storage_key text NOT NULL,
      mime_type text NOT NULL,
      width integer, height integer,
      PRIMARY KEY (media_id, variant)
    );

    -- Драйвер хранилища 'db' для тестового стенда (ADR-009): байты в PostgreSQL. В production — S3 (ADR-007).
    CREATE TABLE media_blobs (
      storage_key text PRIMARY KEY,
      data bytea NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE media_tags (
      media_id uuid NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
      tag_id uuid NOT NULL REFERENCES tags(id) ON DELETE RESTRICT,
      PRIMARY KEY (media_id, tag_id)
    );
    CREATE TABLE media_topics (
      media_id uuid NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
      topic_id uuid NOT NULL REFERENCES topics(id) ON DELETE RESTRICT,
      PRIMARY KEY (media_id, topic_id)
    );

    ALTER TABLE question_types ADD COLUMN current_version_id uuid;
    CREATE TABLE question_type_versions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      question_type_id uuid NOT NULL REFERENCES question_types(id) ON DELETE RESTRICT,
      version_no integer NOT NULL,
      interaction_config jsonb NOT NULL,
      content_schema jsonb NOT NULL,
      response_schema jsonb NOT NULL,
      answer_key_schema jsonb NOT NULL,
      evaluation jsonb NOT NULL,
      created_by uuid REFERENCES users(id) ON DELETE RESTRICT,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (question_type_id, version_no)
    );
    ALTER TABLE question_types ADD CONSTRAINT question_types_current_version_fk
      FOREIGN KEY (current_version_id) REFERENCES question_type_versions(id) ON DELETE RESTRICT;

    CREATE TABLE items (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      question_type_id uuid NOT NULL REFERENCES question_types(id) ON DELETE RESTRICT,
      owner_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      assignment_id uuid REFERENCES assignments(id) ON DELETE RESTRICT,
      course_id uuid NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
      current_draft_version_id uuid,
      latest_approved_version_id uuid,
      status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')),
      archived_at timestamptz, archived_by uuid REFERENCES users(id) ON DELETE RESTRICT, archive_reason text,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      revision integer NOT NULL DEFAULT 1
    );
    CREATE INDEX items_owner_idx ON items (owner_id);
    CREATE INDEX items_assignment_idx ON items (assignment_id);
    CREATE INDEX items_course_idx ON items (course_id);

    CREATE TABLE item_versions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      item_id uuid NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
      version_no integer NOT NULL,
      based_on_version_id uuid REFERENCES item_versions(id) ON DELETE RESTRICT,
      question_type_version_id uuid NOT NULL REFERENCES question_type_versions(id) ON DELETE RESTRICT,
      state text NOT NULL DEFAULT 'DRAFT' CHECK (state IN ('DRAFT','READY_FOR_REVIEW','IN_REVIEW','CHANGES_REQUESTED','APPROVED','ARCHIVED')),
      stem text NOT NULL DEFAULT '',
      content jsonb NOT NULL DEFAULT '{}',
      answer_key jsonb NOT NULL DEFAULT '{}',
      default_points numeric NOT NULL DEFAULT 1 CHECK (default_points > 0 AND default_points <= 100),
      difficulty integer NOT NULL DEFAULT 3 CHECK (difficulty BETWEEN 1 AND 5),
      feedback text,
      author_ids uuid[] NOT NULL,
      ever_submitted boolean NOT NULL DEFAULT false,
      submitted_at timestamptz,
      approved_at timestamptz,
      approved_by uuid REFERENCES users(id) ON DELETE RESTRICT,
      content_hash text,
      archive_reason text,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      revision integer NOT NULL DEFAULT 1,
      UNIQUE (item_id, version_no)
    );
    -- BR-041: не более одного черновика у вопроса
    CREATE UNIQUE INDEX item_versions_one_draft ON item_versions (item_id) WHERE state = 'DRAFT';
    ALTER TABLE items ADD CONSTRAINT items_draft_fk FOREIGN KEY (current_draft_version_id) REFERENCES item_versions(id) ON DELETE SET NULL;
    ALTER TABLE items ADD CONSTRAINT items_approved_fk FOREIGN KEY (latest_approved_version_id) REFERENCES item_versions(id) ON DELETE RESTRICT;

    CREATE TABLE item_options (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      item_version_id uuid NOT NULL REFERENCES item_versions(id) ON DELETE CASCADE,
      key text NOT NULL,
      role text NOT NULL CHECK (role IN ('OPTION','PREMISE','RESPONSE','SEQUENCE_ELEMENT')),
      text text,
      media_asset_id uuid REFERENCES media_assets(id) ON DELETE RESTRICT,
      alt_text_override text,
      ordinal integer NOT NULL,
      UNIQUE (item_version_id, key)
    );
    CREATE INDEX item_options_media_idx ON item_options (media_asset_id);

    CREATE TABLE item_media (
      item_version_id uuid NOT NULL REFERENCES item_versions(id) ON DELETE CASCADE,
      media_asset_id uuid NOT NULL REFERENCES media_assets(id) ON DELETE RESTRICT,
      role text NOT NULL CHECK (role IN ('STIMULUS','ILLUSTRATION')),
      alt_text_override text,
      ordinal integer NOT NULL DEFAULT 0,
      PRIMARY KEY (item_version_id, media_asset_id)
    );
    CREATE INDEX item_media_media_idx ON item_media (media_asset_id);

    CREATE TABLE item_version_topics (
      item_version_id uuid NOT NULL REFERENCES item_versions(id) ON DELETE CASCADE,
      topic_id uuid NOT NULL REFERENCES topics(id) ON DELETE RESTRICT,
      PRIMARY KEY (item_version_id, topic_id)
    );
    CREATE TABLE item_version_objectives (
      item_version_id uuid NOT NULL REFERENCES item_versions(id) ON DELETE CASCADE,
      objective_id uuid NOT NULL REFERENCES learning_objectives(id) ON DELETE RESTRICT,
      PRIMARY KEY (item_version_id, objective_id)
    );
    CREATE TABLE item_version_tags (
      item_version_id uuid NOT NULL REFERENCES item_versions(id) ON DELETE CASCADE,
      tag_id uuid NOT NULL REFERENCES tags(id) ON DELETE RESTRICT,
      PRIMARY KEY (item_version_id, tag_id)
    );

    -- ADR-002: QuestionTypeVersion неизменна (BR-022)
    CREATE FUNCTION qtv_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'question_type_versions are immutable (BR-022)' USING ERRCODE = 'integrity_constraint_violation'; END $$;
    CREATE TRIGGER qtv_no_update BEFORE UPDATE OR DELETE ON question_type_versions FOR EACH ROW EXECUTE FUNCTION qtv_immutable();

    -- ADR-002: содержимое версии вопроса меняется только в DRAFT (BR-006, BR-007, NFR-DATA-001)
    CREATE FUNCTION item_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN
        IF OLD.state <> 'DRAFT' OR OLD.ever_submitted THEN
          RAISE EXCEPTION 'item version % cannot be deleted (BR-005, BR-044)', OLD.id USING ERRCODE = 'integrity_constraint_violation';
        END IF;
        RETURN OLD;
      END IF;
      IF OLD.state <> 'DRAFT' AND (
           NEW.stem IS DISTINCT FROM OLD.stem OR NEW.content IS DISTINCT FROM OLD.content
        OR NEW.answer_key IS DISTINCT FROM OLD.answer_key OR NEW.default_points IS DISTINCT FROM OLD.default_points
        OR NEW.difficulty IS DISTINCT FROM OLD.difficulty OR NEW.feedback IS DISTINCT FROM OLD.feedback
        OR NEW.question_type_version_id IS DISTINCT FROM OLD.question_type_version_id
        OR NEW.item_id IS DISTINCT FROM OLD.item_id OR NEW.version_no IS DISTINCT FROM OLD.version_no
        OR NEW.author_ids IS DISTINCT FROM OLD.author_ids OR NEW.content_hash IS DISTINCT FROM OLD.content_hash) THEN
        RAISE EXCEPTION 'item version % is frozen in state % (BR-006/BR-007)', OLD.id, OLD.state USING ERRCODE = 'integrity_constraint_violation';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER item_version_guard BEFORE UPDATE OR DELETE ON item_versions FOR EACH ROW EXECUTE FUNCTION item_version_guard();

    CREATE FUNCTION item_child_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE v_id uuid; v_state text;
    BEGIN
      v_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.item_version_id ELSE NEW.item_version_id END;
      SELECT state INTO v_state FROM item_versions WHERE id = v_id;
      IF v_state IS NOT NULL AND v_state <> 'DRAFT' THEN
        RAISE EXCEPTION 'content of item version % is frozen (state %)', v_id, v_state USING ERRCODE = 'integrity_constraint_violation';
      END IF;
      RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END $$;
    CREATE TRIGGER item_options_guard BEFORE INSERT OR UPDATE OR DELETE ON item_options FOR EACH ROW EXECUTE FUNCTION item_child_guard();
    CREATE TRIGGER item_media_guard BEFORE INSERT OR UPDATE OR DELETE ON item_media FOR EACH ROW EXECUTE FUNCTION item_child_guard();
    CREATE TRIGGER item_topics_guard BEFORE INSERT OR UPDATE OR DELETE ON item_version_topics FOR EACH ROW EXECUTE FUNCTION item_child_guard();
    CREATE TRIGGER item_objectives_guard BEFORE INSERT OR UPDATE OR DELETE ON item_version_objectives FOR EACH ROW EXECUTE FUNCTION item_child_guard();
    CREATE TRIGGER item_tags_guard BEFORE INSERT OR UPDATE OR DELETE ON item_version_tags FOR EACH ROW EXECUTE FUNCTION item_child_guard();
  `.execute(db)
}

export async function down(): Promise<void> {
  throw new Error('Откат миграции 0003 не поддерживается (неизменяемые версии)')
}
