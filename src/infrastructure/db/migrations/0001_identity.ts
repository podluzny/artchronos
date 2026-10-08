import { sql, type Kysely } from 'kysely'

/** T-032, T-033: identity, сессии, токены, журнал аудита (append-only, BR-034). */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE TABLE users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email text NOT NULL,
      display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 200),
      password_hash text,
      status text NOT NULL CHECK (status IN ('INVITED','ACTIVE','BLOCKED','ARCHIVED')),
      failed_login_count integer NOT NULL DEFAULT 0,
      locked_until timestamptz,
      last_login_at timestamptz,
      password_changed_at timestamptz,
      must_change_password boolean NOT NULL DEFAULT false,
      status_reason text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      revision integer NOT NULL DEFAULT 1
    );
    CREATE UNIQUE INDEX users_email_lower_uq ON users (lower(email));

    CREATE TABLE roles (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      code text NOT NULL UNIQUE CHECK (code ~ '^[A-Z_]{2,40}$'),
      name text NOT NULL,
      description text,
      is_system boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      revision integer NOT NULL DEFAULT 1
    );

    CREATE TABLE permissions (
      key text PRIMARY KEY,
      description text NOT NULL,
      supported_scopes text[] NOT NULL
    );

    CREATE TABLE role_permissions (
      role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      permission_key text NOT NULL REFERENCES permissions(key) ON DELETE RESTRICT,
      scope text NOT NULL CHECK (scope IN ('OWN','ASSIGNED','COURSE','ANY')),
      PRIMARY KEY (role_id, permission_key, scope)
    );

    CREATE TABLE user_roles (
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      role_id uuid NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
      granted_by uuid REFERENCES users(id) ON DELETE RESTRICT,
      granted_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, role_id)
    );

    CREATE TABLE sessions (
      sid text PRIMARY KEY,
      user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
      data jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      last_seen_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL,
      revoked_at timestamptz,
      ip text,
      user_agent text
    );
    CREATE INDEX sessions_user_idx ON sessions (user_id);
    CREATE INDEX sessions_expires_idx ON sessions (expires_at);

    CREATE TABLE password_tokens (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      purpose text NOT NULL CHECK (purpose IN ('ACTIVATION','RESET')),
      token_hash text NOT NULL UNIQUE,
      expires_at timestamptz NOT NULL,
      used_at timestamptz,
      created_by uuid REFERENCES users(id) ON DELETE RESTRICT,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE audit_log (
      id bigserial PRIMARY KEY,
      occurred_at timestamptz NOT NULL DEFAULT now(),
      actor_id uuid REFERENCES users(id) ON DELETE RESTRICT,
      actor_roles text[] NOT NULL DEFAULT '{}',
      action text NOT NULL,
      resource_type text NOT NULL,
      resource_id text,
      changes jsonb,
      reason text,
      request_id text,
      ip text,
      user_agent text
    );
    CREATE INDEX audit_resource_idx ON audit_log (resource_type, resource_id, occurred_at DESC);
    CREATE INDEX audit_actor_idx ON audit_log (actor_id, occurred_at DESC);
    CREATE INDEX audit_action_idx ON audit_log (action, occurred_at DESC);

    -- BR-034 / NFR-AUDIT-003: журнал неизменяем для всех ролей, включая владельца таблицы.
    CREATE FUNCTION audit_log_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'audit_log is append-only (BR-034)' USING ERRCODE = 'insufficient_privilege';
    END $$;
    CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON audit_log
      FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();
    CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log
      FOR EACH STATEMENT EXECUTE FUNCTION audit_log_immutable();
  `.execute(db)
}

export async function down(): Promise<void> {
  throw new Error('Откат миграции 0001 не поддерживается: журнал аудита не удаляется (BR-034)')
}
