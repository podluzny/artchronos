import type { AssessmentTx } from '../application/assessment/ports.js'
import type { DeliveryTx } from '../application/delivery/ports.js'
import type { ReviewTx } from '../application/review/ports.js'
import type { AuditTx } from '../application/audit/use-cases.js'
import type { EducationTx } from '../application/education/ports.js'
import type { IdentityTx } from '../application/identity/ports.js'
import type { ItemBankTx } from '../application/itembank/ports.js'
import type { MediaTx } from '../application/media/ports.js'
import type { UnitOfWork } from '../application/shared/uow.js'
import { DomainError } from '../domain/shared/errors.js'
import { KyselyTestRepository } from './assessment/test-repository.js'
import { KyselyReviewRepository } from './review/review-repository.js'
import { KyselyDeliveryRepository } from './delivery/delivery-repository.js'
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
export type AppTx = IdentityTx & AuditTx & EducationTx & MediaTx & ItemBankTx & AssessmentTx & ReviewTx & DeliveryTx

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
    reviews: new KyselyReviewRepository(db),
    delivery: new KyselyDeliveryRepository(db),
  }
}

export class KyselyUnitOfWork implements UnitOfWork<AppTx> {
  readonly read: AppTx

  constructor(private readonly db: Db) {
    this.read = bindRepositories(db)
  }

  transaction<R>(fn: (tx: AppTx) => Promise<R>): Promise<R> {
    return this.db
      .transaction()
      .execute((trx) => fn(bindRepositories(trx as unknown as Db)))
      .catch((e) => {
        throw translateDbError(e)
      })
  }
}

/**
 * Ошибки ограничений БД, возникающие при гонках (NFR-DATA-003/004), — в понятные доменные ошибки.
 * Транзакция к этому моменту уже откатилась целиком.
 */
export function translateDbError(e: unknown): unknown {
  const code = (e as { code?: string })?.code
  if (code === '23505' || code === '40001' || code === '40P01')
    return DomainError.conflict('Объект был одновременно изменен другим действием — обновите страницу и повторите')
  if (code === '23000')
    return new DomainError('INVALID_STATE', 'Операция противоречит текущему состоянию данных (защита целостности)')
  return e
}
