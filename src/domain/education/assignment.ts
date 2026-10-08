import { DomainError, type FieldError } from '../shared/errors.js'

export type AssignmentStatus = 'DRAFT' | 'ACTIVE' | 'CLOSED' | 'ARCHIVED'

export interface AssignmentState {
  status: AssignmentStatus
  minItems: number
  maxItems: number
  deadlineAt: Date | null
  topicCount: number
  targetCount: number
  questionTypeCount: number
}

/** lifecycle-state-machine §6. */
const TRANSITIONS: Record<string, { from: AssignmentStatus[]; to: AssignmentStatus }> = {
  activate: { from: ['DRAFT'], to: 'ACTIVE' },
  close: { from: ['ACTIVE'], to: 'CLOSED' },
  reopen: { from: ['CLOSED'], to: 'ACTIVE' },
  archive: { from: ['CLOSED', 'DRAFT'], to: 'ARCHIVED' },
}

export type AssignmentTransition = keyof typeof TRANSITIONS

export function nextAssignmentStatus(action: string, current: AssignmentStatus): AssignmentStatus {
  const t = TRANSITIONS[action]
  if (!t || !t.from.includes(current))
    throw new DomainError('INVALID_TRANSITION', 'Недопустимое изменение статуса задания')
  return t.to
}

export function validateLimits(minItems: number, maxItems: number, maxTests: number): FieldError[] {
  const e: FieldError[] = []
  if (!Number.isInteger(minItems) || minItems < 1) e.push({ field: 'minItems', message: 'Минимум — целое число ≥ 1' })
  if (!Number.isInteger(maxItems) || maxItems > 100)
    e.push({ field: 'maxItems', message: 'Максимум — целое число ≤ 100' })
  if (minItems > maxItems) e.push({ field: 'maxItems', message: 'Минимум вопросов не может превышать максимум' })
  if (!Number.isInteger(maxTests) || maxTests < 1 || maxTests > 10)
    e.push({ field: 'maxTestsPerStudent', message: 'От 1 до 10' })
  return e
}

/** SPEC-ASSIGN-002 п.1: условия активации. */
export function validateActivation(a: AssignmentState, now: Date): void {
  const e: FieldError[] = []
  if (a.topicCount < 1) e.push({ field: 'topics', message: 'Выберите хотя бы одну тему' })
  if (a.questionTypeCount < 1) e.push({ field: 'questionTypes', message: 'Выберите хотя бы один тип вопроса' })
  if (a.targetCount < 1) e.push({ field: 'targets', message: 'Назначьте задание студентам или группам' })
  if (!a.deadlineAt) e.push({ field: 'deadlineAt', message: 'Укажите дедлайн' })
  else if (a.deadlineAt <= now) e.push({ field: 'deadlineAt', message: 'Дедлайн должен быть в будущем' })
  e.push(...validateLimits(a.minItems, a.maxItems, 1))
  if (e.length) throw DomainError.validation(e, 'Задание не готово к активации')
}

/** Персональный дедлайн с учетом продления. */
export function effectiveDeadline(deadlineAt: Date | null, extension: Date | null): Date | null {
  if (!deadlineAt) return extension
  if (!extension) return deadlineAt
  return extension > deadlineAt ? extension : deadlineAt
}

/** BR-017: контент студента создается только в ACTIVE задании, адресованном ему. */
export function assertStudentCanCreate(a: { status: AssignmentStatus; targeted: boolean }): void {
  if (a.status !== 'ACTIVE' || !a.targeted) {
    throw DomainError.rule('BR-017', 'Создавать вопросы и тесты можно только в активном задании, назначенном вам')
  }
}

/**
 * BR-031: первая отправка — до персонального дедлайна; повторные (после замечаний) — пока задание не закрыто.
 */
export function assertCanSubmit(a: {
  status: AssignmentStatus
  deadline: Date | null
  firstSubmission: boolean
  now: Date
}): void {
  if (a.status !== 'ACTIVE') throw DomainError.rule('BR-031', 'Задание закрыто — отправка невозможна')
  if (a.firstSubmission && a.deadline && a.now > a.deadline) {
    throw DomainError.rule('BR-031', 'Срок задания истек — первая отправка невозможна')
  }
}

/** Продление не раньше общего дедлайна (SPEC-ASSIGN-002 A2). */
export function validateExtension(deadlineAt: Date | null, newDeadline: Date): void {
  if (deadlineAt && newDeadline <= deadlineAt) {
    throw DomainError.validation([{ field: 'newDeadlineAt', message: 'Новый срок должен быть позже общего дедлайна' }])
  }
}
