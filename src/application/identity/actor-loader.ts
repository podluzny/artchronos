import { Actor } from '../../domain/authorization/actor.js'
import type { Scope } from '../../domain/authorization/scope.js'
import type { IdentityTx } from './ports.js'

/** Строит authorization context (FR-AUTH-006). Вызывается на каждый запрос — смена ролей действует сразу (AC-AUTH-003.6). */
export async function loadActor(tx: Pick<IdentityTx, 'users' | 'roles'>, userId: string): Promise<Actor | null> {
  const user = await tx.users.findById(userId)
  if (!user) return null
  const { roleCodes, grants } = await tx.roles.actorGrants(userId)
  const map = new Map<string, Set<Scope>>()
  for (const g of grants) {
    const set = map.get(g.key) ?? new Set<Scope>()
    set.add(g.scope)
    map.set(g.key, set)
  }
  return new Actor({
    userId: user.id,
    email: user.email,
    displayName: user.displayName,
    status: user.status,
    roleCodes,
    mustChangePassword: user.mustChangePassword,
    grants: map,
  })
}
