import type { AuditTx } from '../application/audit/use-cases.js'
import type { IdentityTx } from '../application/identity/ports.js'
import type { UnitOfWork } from '../application/shared/uow.js'
import { KyselyAuditReadRepository } from './audit/audit-read-repository.js'
import { KyselyAuditWriter } from './audit/audit-writer.js'
import type { Db } from './db/kysely.js'
import { KyselyRoleRepository } from './identity/role-repository.js'
import { KyselyPasswordTokenRepository, KyselySessionRepository } from './identity/token-repositories.js'
import { KyselyUserRepository } from './identity/user-repository.js'

/** Полный набор репозиториев приложения, привязанный к соединению или транзакции. */
export type AppTx = IdentityTx & AuditTx

export function bindRepositories(db: Db): AppTx {
  return {
    users: new KyselyUserRepository(db),
    roles: new KyselyRoleRepository(db),
    sessions: new KyselySessionRepository(db),
    tokens: new KyselyPasswordTokenRepository(db),
    audit: new KyselyAuditWriter(db),
    auditRead: new KyselyAuditReadRepository(db),
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
