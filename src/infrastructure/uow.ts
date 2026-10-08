import type { AssessmentTx } from '../application/assessment/ports.js'
import type { AuditTx } from '../application/audit/use-cases.js'
import type { EducationTx } from '../application/education/ports.js'
import type { IdentityTx } from '../application/identity/ports.js'
import type { ItemBankTx } from '../application/itembank/ports.js'
import type { MediaTx } from '../application/media/ports.js'
import type { UnitOfWork } from '../application/shared/uow.js'
import { KyselyTestRepository } from './assessment/test-repository.js'
import { KyselyAuditReadRepository } from './audit/audit-read-repository.js'
import { KyselyAuditWriter } from './audit/audit-writer.js'
import type { Db } from './db/kysely.js'
import { KyselyEducationRepository } from './education/education-repository.js'
import { KyselyItemRepository } from './itembank/item-repository.js'
import { KyselyQuestionTypeRepository } from './itembank/qtype-repository.js'
import { KyselyMediaRepository } from './media/media-repository.js'
import { KyselyRoleRepository } from './identity/role-repository.js'
import { KyselyPasswordTokenRepository, KyselySessionRepository } from './identity/token-repositories.js'
import { KyselyUserRepository } from './identity/user-repository.js'

/** Полный набор репозиториев приложения, привязанный к соединению или транзакции. */
export type AppTx = IdentityTx & AuditTx & EducationTx & MediaTx & ItemBankTx & AssessmentTx

export function bindRepositories(db: Db): AppTx {
  return {
    users: new KyselyUserRepository(db),
    roles: new KyselyRoleRepository(db),
    sessions: new KyselySessionRepository(db),
    tokens: new KyselyPasswordTokenRepository(db),
    audit: new KyselyAuditWriter(db),
    auditRead: new KyselyAuditReadRepository(db),
    education: new KyselyEducationRepository(db),
    media: new KyselyMediaRepository(db),
    qtypes: new KyselyQuestionTypeRepository(db),
    items: new KyselyItemRepository(db),
    tests: new KyselyTestRepository(db),
  }
}

export class KyselyUnitOfWork implements UnitOfWork<AppTx> {
  readonly read: AppTx

  constructor(private readonly db: Db) {
    this.read = bindRepositories(db)
  }

  transaction<R>(fn: (tx: AppTx) => Promise<R>): Promise<R> {
    return this.db.transaction().execute((trx) => fn(bindRepositories(trx as unknown as Db)))
  }
}
