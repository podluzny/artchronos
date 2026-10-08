import { createAuditUseCases } from '../application/audit/use-cases.js'
import { systemClock, type Clock } from '../application/shared/context.js'
import { createEducationUseCases } from '../application/education/use-cases.js'
import { createIdentityUseCases } from '../application/identity/use-cases.js'
import { createItemUseCases } from '../application/itembank/item-use-cases.js'
import { createQtypeUseCases } from '../application/itembank/qtype-use-cases.js'
import { createMediaUseCases } from '../application/media/use-cases.js'
import type { MediaStorage } from '../application/media/ports.js'
import type { Db } from '../infrastructure/db/kysely.js'
import { SharpMediaProcessor } from '../infrastructure/media/processor.js'
import { createStorage } from '../infrastructure/media/storage.js'
import { createInteractionRegistry } from '../plugins/interactions/index.js'
import { Argon2Hasher, RandomTokenService } from '../infrastructure/security/crypto.js'
import { KyselyUnitOfWork } from '../infrastructure/uow.js'

/** Composition root: связывает use cases с инфраструктурой. */
export function createServices(db: Db, opts: { clock?: Clock; storage?: MediaStorage } = {}) {
  const uow = new KyselyUnitOfWork(db)
  const clock = opts.clock ?? systemClock
  const identity = createIdentityUseCases({ uow, hasher: new Argon2Hasher(), tokens: new RandomTokenService(), clock })
  const audit = createAuditUseCases({ uow })
  const education = createEducationUseCases({ uow, clock })
  const registry = createInteractionRegistry()
  const storage = opts.storage ?? createStorage(db)
  const media = createMediaUseCases({ uow, storage, processor: new SharpMediaProcessor(), clock })
  const qtypes = createQtypeUseCases({ uow, registry })
  const items = createItemUseCases({ uow, registry, clock })
  return { uow, identity, audit, education, media, qtypes, items, registry, storage }
}

export type Services = ReturnType<typeof createServices>
