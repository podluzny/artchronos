import { randomUUID } from 'node:crypto'
import type { Actor } from '../../src/domain/authorization/actor.js'
import type { RequestContext } from '../../src/application/shared/context.js'
import type { Db } from '../../src/infrastructure/db/kysely.js'
import { createServices, type Services } from '../../src/server/container.js'

export const ctx: RequestContext = { requestId: 'test', ip: '127.0.0.1', userAgent: 'vitest', sessionId: null }

export const PASSWORD = 'Correct-Horse-Battery-9'

let seq = 0
export function uniqueEmail(prefix = 'user'): string {
  seq += 1
  return `${prefix}.${seq}.${randomUUID().slice(0, 6)}@test.local`
}

/** Создает активного пользователя с ролями напрямую через use case под системным администратором. */
export async function makeUser(
  services: Services,
  admin: Actor,
  roles: string[],
  opts: { email?: string; displayName?: string } = {},
): Promise<{ id: string; email: string; actor: Actor }> {
  const email = opts.email ?? uniqueEmail(roles[0]?.toLowerCase() ?? 'user')
  const r = await services.identity.createUser.run(
    admin,
    {
      email,
      displayName: opts.displayName ?? email.split('@')[0]!,
      roles,
      initialMode: 'TEMP_PASSWORD',
      tempPassword: PASSWORD,
    },
    ctx,
  )
  // Снимаем обязательную смену пароля, чтобы actor был полноценным.
  await services.uow.read.users.update(r.user.id, { mustChangePassword: false })
  const actor = (await services.identity.loadActor(r.user.id))!
  return { id: r.user.id, email, actor }
}

/** Первый администратор (bootstrap) + сервисы. */
export async function setupServices(db: Db): Promise<{ services: Services; admin: Actor; adminId: string }> {
  const services = createServices(db)
  const { bootstrapAdmin } = await import('../../src/infrastructure/db/seed.js')
  const { Argon2Hasher } = await import('../../src/infrastructure/security/crypto.js')
  await bootstrapAdmin(db, new Argon2Hasher(), 'root@test.local', PASSWORD)
  const row = await db.selectFrom('users').select('id').where('email', '=', 'root@test.local').executeTakeFirstOrThrow()
  const admin = (await services.identity.loadActor(row.id))!
  return { services, admin, adminId: row.id }
}

export async function auditActions(db: Db, resourceId: string): Promise<string[]> {
  const rows = await db
    .selectFrom('audit_log')
    .select('action')
    .where('resource_id', '=', resourceId)
    .orderBy('id')
    .execute()
  return rows.map((r) => r.action)
}
