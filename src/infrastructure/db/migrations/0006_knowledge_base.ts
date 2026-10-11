import { sql, type Kysely } from 'kysely'

/**
 * M7 (T-089): база знаний (BL-13, ADR-010) — справочники, связи, ссылки из контента, медиа ↔ произведение.
 * Права системных ролей добавляются здесь: seed обновляет состав прав только у ADMIN.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE TABLE knowledge_entries (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      kind text NOT NULL CHECK (kind IN ('PERSON','ARTWORK','COLLECTION','MOVEMENT','PERIOD','TECHNIQUE','TERM')),
      slug text NOT NULL CHECK (length(slug) BETWEEN 1 AND 80),
      name text NOT NULL CHECK (length(name) BETWEEN 1 AND 300),
      alt_names text[] NOT NULL DEFAULT '{}',
      description text,
      year_from integer,
      year_to integer,
      attrs jsonb NOT NULL DEFAULT '{}',
      status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')),
      archived_at timestamptz, archived_by uuid REFERENCES users(id) ON DELETE RESTRICT, archive_reason text,
      created_by uuid REFERENCES users(id) ON DELETE RESTRICT,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      revision integer NOT NULL DEFAULT 1,
      UNIQUE (kind, slug),
      CHECK (year_from IS NULL OR year_to IS NULL OR year_from <= year_to)
    );
    CREATE INDEX knowledge_entries_slug_idx ON knowledge_entries (slug);
    CREATE INDEX knowledge_entries_name_idx ON knowledge_entries (kind, lower(name));

    CREATE TABLE knowledge_links (
      from_id uuid NOT NULL REFERENCES knowledge_entries(id) ON DELETE CASCADE,
      to_id uuid NOT NULL REFERENCES knowledge_entries(id) ON DELETE RESTRICT,
      relation text NOT NULL CHECK (relation IN ('AUTHOR','COLLECTION','TECHNIQUE','MOVEMENT','PERIOD','PARENT','SEE_ALSO')),
      ordinal integer NOT NULL DEFAULT 0,
      PRIMARY KEY (from_id, relation, to_id),
      CHECK (from_id <> to_id)
    );
    CREATE INDEX knowledge_links_to_idx ON knowledge_links (to_id);

    CREATE TABLE content_references (
      source_type text NOT NULL CHECK (source_type IN ('ITEM_VERSION','TEST_VERSION','ASSIGNMENT','MEDIA','KNOWLEDGE')),
      source_id uuid NOT NULL,
      field text NOT NULL,
      entry_id uuid NOT NULL REFERENCES knowledge_entries(id) ON DELETE RESTRICT,
      PRIMARY KEY (source_type, source_id, field, entry_id)
    );
    CREATE INDEX content_references_entry_idx ON content_references (entry_id);

    -- источник удален (discard draft, удаление медиа или объекта) — его ссылки удаляются вместе с ним
    CREATE FUNCTION content_references_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      DELETE FROM content_references WHERE source_type = TG_ARGV[0] AND source_id = OLD.id;
      RETURN OLD;
    END $$;
    CREATE TRIGGER item_versions_refs_cleanup AFTER DELETE ON item_versions
      FOR EACH ROW EXECUTE FUNCTION content_references_cleanup('ITEM_VERSION');
    CREATE TRIGGER test_versions_refs_cleanup AFTER DELETE ON test_versions
      FOR EACH ROW EXECUTE FUNCTION content_references_cleanup('TEST_VERSION');
    CREATE TRIGGER assignments_refs_cleanup AFTER DELETE ON assignments
      FOR EACH ROW EXECUTE FUNCTION content_references_cleanup('ASSIGNMENT');
    CREATE TRIGGER media_assets_refs_cleanup AFTER DELETE ON media_assets
      FOR EACH ROW EXECUTE FUNCTION content_references_cleanup('MEDIA');
    CREATE TRIGGER knowledge_entries_refs_cleanup BEFORE DELETE ON knowledge_entries
      FOR EACH ROW EXECUTE FUNCTION content_references_cleanup('KNOWLEDGE');

    ALTER TABLE media_assets ADD COLUMN artwork_id uuid REFERENCES knowledge_entries(id) ON DELETE RESTRICT;
    CREATE INDEX media_assets_artwork_idx ON media_assets (artwork_id);

    INSERT INTO permissions (key, description, supported_scopes) VALUES
      ('knowledge.read', 'Чтение справочников базы знаний', '{ANY}'),
      ('knowledge.manage', 'Ведение справочников базы знаний', '{ANY}')
    ON CONFLICT (key) DO NOTHING;

    INSERT INTO role_permissions (role_id, permission_key, scope)
      SELECT r.id, p.key, 'ANY' FROM roles r
      CROSS JOIN (VALUES ('knowledge.read'), ('knowledge.manage')) AS p(key)
      WHERE r.is_system AND (r.code IN ('ADMIN','TEACHER') OR (r.code IN ('STUDENT','EXPERT') AND p.key = 'knowledge.read'))
    ON CONFLICT DO NOTHING;
  `.execute(db)
}

export async function down(): Promise<void> {
  throw new Error('Откат миграции 0006 не поддерживается')
}
