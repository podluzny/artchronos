import { DomainError } from '../../domain/shared/errors.js'
import type { ListQuery } from '../shared/query.js'
import type { UnitOfWork } from '../shared/uow.js'
import { useCase } from '../shared/use-case.js'

export interface AuditRecordView {
  id: string
  occurredAt: Date
  actorId: string | null
  actorEmail: string | null
  actorRoles: string[]
  action: string
  resourceType: string
  resourceId: string | null
  changes: Record<string, unknown> | null
  reason: string | null
  requestId: string | null
  ip: string | null
}

export interface AuditReadRepository {
  list(query: ListQuery): Promise<AuditRecordView[]>
  count(query: ListQuery): Promise<number>
  findById(id: string): Promise<AuditRecordView | null>
}

export interface AuditTx {
  auditRead: AuditReadRepository
}

/** SPEC-AUDIT-001: журнал доступен только с audit.read; изменяющих use cases нет (BR-034). */
export function createAuditUseCases(deps: { uow: UnitOfWork<AuditTx> }) {
  const { uow } = deps
  return {
    listAudit: useCase<ListQuery, { records: AuditRecordView[]; total: number }>({
      name: 'audit.list',
      permission: 'audit.read',
      async run(_actor, query) {
        const [records, total] = await Promise.all([uow.read.auditRead.list(query), uow.read.auditRead.count(query)])
        return { records, total }
      },
    }),
    getAudit: useCase<{ id: string }, AuditRecordView>({
      name: 'audit.get',
      permission: 'audit.read',
      async run(_actor, input) {
        const r = await uow.read.auditRead.findById(input.id)
        if (!r) throw DomainError.notFound()
        return r
      },
    }),
  }
}

export type AuditUseCases = ReturnType<typeof createAuditUseCases>
