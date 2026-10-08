import { createAuditUseCases } from '../application/audit/use-cases.js'
import { systemClock, type Clock } from '../application/shared/context.js'
import { createIdentityUseCases } from '../application/identity/use-cases.js'
import type { Db } from '../infrastructure/db/kysely.js'
import { Argon2Hasher, RandomTokenService } from '../infrastructure/security/crypto.js'
import { KyselyUnitOfWork } from '../infrastructure/uow.js'

/** Composition root: связывает use cases с инфраструктурой. */
export function createServices(db: Db, opts: { clock?: Clock } = {}) {
  const uow = new KyselyUnitOfWork(db)
  const clock = opts.clock ?? systemClock
  const identity = createIdentityUseCases({ uow, hasher: new Argon2Hasher(), tokens: new RandomTokenService(), clock })
  const audit = createAuditUseCases({ uow })
  return { uow, identity, audit }
}

export type Services = ReturnType<typeof createServices>
