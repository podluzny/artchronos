import { DomainError } from '../shared/errors.js'

export type ReviewStatus = 'OPEN' | 'IN_PROGRESS' | 'CHANGES_REQUESTED' | 'APPROVED' | 'CANCELLED'
export type ReviewerRole = 'PRIMARY' | 'ADVISORY'
export type IssueSeverity = 'BLOCKING' | 'MAJOR' | 'MINOR'
export type IssueStatus = 'OPEN' | 'ADDRESSED' | 'RESOLVED' | 'WONT_FIX'

export interface ChecklistItem {
  code: string
  text: string
  mandatory: boolean
}

export const REVIEW_STATUS_LABEL: Record<ReviewStatus, string> = {
  OPEN: 'Ожидает начала',
  IN_PROGRESS: 'Идет экспертиза',
  CHANGES_REQUESTED: 'Возвращено на доработку',
  APPROVED: 'Принято',
  CANCELLED: 'Отменено',
}

export const SEVERITY_LABEL: Record<IssueSeverity, string> = {
  BLOCKING: 'Блокирующее',
  MAJOR: 'Существенное',
  MINOR: 'Незначительное',
}

export const ISSUE_STATUS_LABEL: Record<IssueStatus, string> = {
  OPEN: 'Открыто',
  ADDRESSED: 'Исправлено автором',
  RESOLVED: 'Закрыто',
  WONT_FIX: 'Не требует исправления',
}

export function isClosed(s: ReviewStatus): boolean {
  return s === 'CHANGES_REQUESTED' || s === 'APPROVED' || s === 'CANCELLED'
}

/** BR-040: после решения review только для чтения. */
export function assertOpen(s: ReviewStatus): void {
  if (isClosed(s)) throw DomainError.rule('BR-040', 'Экспертиза завершена — изменения невозможны')
}

/** BR-001 / INV-003: автор (владелец или соавтор) не принимает решение и не проводит экспертизу. */
export function assertNotAuthor(userId: string, authorIds: Iterable<string>, what = 'объекта'): void {
  for (const a of authorIds) {
    if (a === userId) throw DomainError.rule('BR-001', `Автор ${what} не может проводить его экспертизу`)
  }
}

/** BR-028: незаполненные обязательные пункты checklist. */
export function missingMandatory(
  items: ChecklistItem[],
  answers: { code: string; checked: boolean }[],
): ChecklistItem[] {
  const ok = new Set(answers.filter((a) => a.checked).map((a) => a.code))
  return items.filter((i) => i.mandatory && !ok.has(i.code))
}

/** BR-028: блокирующие замечания, не закрытые экспертом. */
export function blockingOpen<T extends { severity: IssueSeverity; status: IssueStatus }>(issues: T[]): T[] {
  return issues.filter((i) => i.severity === 'BLOCKING' && (i.status === 'OPEN' || i.status === 'ADDRESSED'))
}

/** BR-029: request changes требует открытое замечание или итоговый комментарий. */
export function assertCanRequestChanges(openIssues: number, summary: string | null): void {
  if (openIssues === 0 && !summary?.trim())
    throw DomainError.rule('BR-029', 'Укажите итоговый комментарий или создайте хотя бы одно замечание', 'summary')
}

/**
 * Переходы статуса замечания (SPEC-REVIEW-002): автор — только OPEN → ADDRESSED;
 * PRIMARY-эксперт — RESOLVED, WONT_FIX, повторное открытие.
 */
export function nextIssueStatus(current: IssueStatus, target: IssueStatus, as: 'AUTHOR' | 'PRIMARY'): IssueStatus {
  if (as === 'AUTHOR') {
    if (target !== 'ADDRESSED')
      throw DomainError.forbidden('Автор может только отметить замечание как исправленное (AC-REVIEW-002.4)')
    if (current !== 'OPEN') throw new DomainError('INVALID_TRANSITION', 'Отметить можно только открытое замечание')
    return target
  }
  const allowed: Record<IssueStatus, IssueStatus[]> = {
    OPEN: ['RESOLVED', 'WONT_FIX'],
    ADDRESSED: ['RESOLVED', 'WONT_FIX', 'OPEN'],
    RESOLVED: ['OPEN'],
    WONT_FIX: ['OPEN'],
  }
  if (!allowed[current].includes(target))
    throw new DomainError('INVALID_TRANSITION', `Замечание нельзя перевести из ${current} в ${target}`)
  return target
}
