import { sql } from 'kysely'
import { PERMISSIONS } from '../../domain/identity/permission-catalog.js'
import { SYSTEM_ROLES, type SystemRoleCode } from '../../domain/identity/system-roles.js'
import { validatePassword } from '../../domain/identity/password-policy.js'
import { normalizeEmail } from '../../domain/shared/text.js'
import { MVP_QUESTION_TYPES } from '../../domain/itembank/mvp-question-types.js'
import { buildTypeVersion } from '../../application/itembank/qtype-use-cases.js'
import { createInteractionRegistry } from '../../plugins/interactions/index.js'
import type { PasswordHasher } from '../../application/identity/ports.js'
import type { Db } from './kysely.js'

/**
 * Идемпотентный seed (T-035):
 * - каталог permissions синхронизируется с кодом;
 * - системные роли создаются, если их нет; состав ADMIN всегда синхронизируется с кодом (BR-015/BR-046:
 *   через UI его изменить нельзя), состав прочих системных ролей задается только при создании.
 */
export async function seedCatalog(db: Db): Promise<void> {
  await db.transaction().execute(async (trx) => {
    for (const p of PERMISSIONS) {
      await trx
        .insertInto('permissions')
        .values({ key: p.key, description: p.description, supported_scopes: [...p.scopes] })
        .onConflict((oc) =>
          oc.column('key').doUpdateSet({ description: p.description, supported_scopes: [...p.scopes] }),
        )
        .execute()
    }
    for (const [code, def] of Object.entries(SYSTEM_ROLES) as [
      SystemRoleCode,
      (typeof SYSTEM_ROLES)[SystemRoleCode],
    ][]) {
      let role = await trx.selectFrom('roles').select('id').where('code', '=', code).executeTakeFirst()
      const created = !role
      if (!role) {
        role = await trx
          .insertInto('roles')
          .values({ code, name: def.name, description: def.description, is_system: true })
          .returning('id')
          .executeTakeFirstOrThrow()
      }
      if (created || code === 'ADMIN') {
        await trx.deleteFrom('role_permissions').where('role_id', '=', role.id).execute()
        const rows = def.grants.flatMap((g) =>
          g.scopes.map((scope) => ({ role_id: role!.id, permission_key: g.key, scope })),
        )
        if (rows.length) await trx.insertInto('role_permissions').values(rows).execute()
      }
    }
    // MVP-типы вопросов (question-type-system §3): создаются активными с версией v1, если их нет; существующие не трогаем.
    const registry = createInteractionRegistry()
    for (const t of MVP_QUESTION_TYPES) {
      await trx
        .insertInto('question_types')
        .values({
          code: t.code,
          name: t.name,
          description: t.description,
          interaction_key: t.interactionKey,
          status: 'ACTIVE',
        })
        .onConflict((oc) => oc.column('code').doNothing())
        .execute()
      const row = await trx
        .selectFrom('question_types')
        .select(['id', 'current_version_id'])
        .where('code', '=', t.code)
        .executeTakeFirstOrThrow()
      if (!row.current_version_id) {
        const built = buildTypeVersion(registry, t.interactionKey, t.config, t.evaluation)
        const v = await trx
          .insertInto('question_type_versions')
          .values({
            question_type_id: row.id,
            version_no: 1,
            interaction_config: JSON.stringify(built.interactionConfig),
            content_schema: JSON.stringify(built.contentSchema),
            response_schema: JSON.stringify(built.responseSchema),
            answer_key_schema: JSON.stringify(built.answerKeySchema),
            evaluation: JSON.stringify(built.evaluation),
          })
          .returning('id')
          .executeTakeFirstOrThrow()
        await trx
          .updateTable('question_types')
          .set({ current_version_id: v.id, description: t.description })
          .where('id', '=', row.id)
          .execute()
      }
    }
  })
}

/** Создает первого администратора, если активных администраторов нет (ADR-009 п.6). */
export async function bootstrapAdmin(
  db: Db,
  hasher: PasswordHasher,
  email: string | undefined,
  password: string | undefined,
): Promise<'created' | 'exists' | 'skipped'> {
  const admins = await db
    .selectFrom('users')
    .innerJoin('user_roles', 'user_roles.user_id', 'users.id')
    .innerJoin('roles', 'roles.id', 'user_roles.role_id')
    .where('roles.code', '=', 'ADMIN')
    .where('users.status', '=', 'ACTIVE')
    .select('users.id')
    .execute()
  if (admins.length) return 'exists'
  if (!email || !password) return 'skipped'
  const errs = validatePassword(password, email)
  if (errs.length) throw new Error(`ADMIN_PASSWORD не соответствует политике: ${errs.map((e) => e.message).join('; ')}`)
  const hash = await hasher.hash(password)
  await db.transaction().execute(async (trx) => {
    const norm = normalizeEmail(email)
    const existing = await trx
      .selectFrom('users')
      .select('id')
      .where(sql<string>`lower(email)`, '=', norm)
      .executeTakeFirst()
    const userId =
      existing?.id ??
      (
        await trx
          .insertInto('users')
          .values({
            email: norm,
            display_name: 'Администратор',
            status: 'ACTIVE',
            password_hash: hash,
            password_changed_at: new Date(),
          })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id
    if (existing) {
      await trx
        .updateTable('users')
        .set({ status: 'ACTIVE', password_hash: hash, password_changed_at: new Date() })
        .where('id', '=', userId)
        .execute()
    }
    const role = await trx.selectFrom('roles').select('id').where('code', '=', 'ADMIN').executeTakeFirstOrThrow()
    await trx
      .insertInto('user_roles')
      .values({ user_id: userId, role_id: role.id, granted_by: null })
      .onConflict((oc) => oc.doNothing())
      .execute()
    await trx
      .insertInto('audit_log')
      .values({
        actor_id: null,
        actor_roles: [],
        action: 'user.bootstrap_admin',
        resource_type: 'user',
        resource_id: userId,
        request_id: 'seed',
      })
      .execute()
  })
  return 'created'
}
