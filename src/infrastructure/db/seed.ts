import { sql } from 'kysely'
import { PERMISSIONS } from '../../domain/identity/permission-catalog.js'
import { SYSTEM_ROLES, type SystemRoleCode } from '../../domain/identity/system-roles.js'
import { validatePassword } from '../../domain/identity/password-policy.js'
import { normalizeEmail } from '../../domain/shared/text.js'
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
