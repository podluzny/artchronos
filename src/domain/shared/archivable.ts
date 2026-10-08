import { DomainError } from './errors.js'

/** Единая модель soft delete (SPEC-AUDIT-002, BR-005, BR-039, BR-042). */
export type ArchiveStatus = 'ACTIVE' | 'ARCHIVED'

export function assertCanArchive(status: ArchiveStatus, reason: string | undefined | null): string {
  if (status === 'ARCHIVED') throw new DomainError('INVALID_STATE', 'Объект уже в архиве')
  const r = (reason ?? '').trim()
  if (!r) throw DomainError.validation([{ field: 'reason', message: 'Укажите причину' }])
  return r
}

export function assertCanRestore(status: ArchiveStatus, parentArchived = false): void {
  if (status !== 'ARCHIVED') throw new DomainError('INVALID_STATE', 'Объект не в архиве')
  if (parentArchived) throw new DomainError('INVALID_STATE', 'Сначала восстановите родительский объект')
}

/** BR-039: архивированный объект нельзя выбрать в новом контенте. */
export function assertSelectable(status: ArchiveStatus, what: string, field: string): void {
  if (status === 'ARCHIVED') throw DomainError.rule('BR-039', `${what} в архиве и не может быть выбран`, field)
}

/** BR-042: используемый элемент удалить нельзя — только архивировать. */
export function assertDeletable(usageCount: number, what: string): void {
  if (usageCount > 0)
    throw DomainError.rule('BR-042', `${what} используется — удаление невозможно, используйте архивирование`)
}
