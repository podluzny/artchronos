/** Типизированные доменные ошибки (ADR-004). Код определяет HTTP-статус и сообщение UI. */
export type DomainErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION'
  | 'RULE_VIOLATION'
  | 'INVALID_STATE'
  | 'INVALID_TRANSITION'
  | 'CONFLICT'
  | 'PASSWORD_CHANGE_REQUIRED'

const HTTP_STATUS: Record<DomainErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 422,
  RULE_VIOLATION: 422,
  INVALID_STATE: 409,
  INVALID_TRANSITION: 409,
  CONFLICT: 409,
  PASSWORD_CHANGE_REQUIRED: 403,
}

export interface FieldError {
  field: string
  message: string
}

export class DomainError extends Error {
  readonly code: DomainErrorCode
  /** Идентификатор нарушенного бизнес-правила (BR-NNN), если применимо. */
  readonly ruleId: string | undefined
  readonly fieldErrors: FieldError[]

  constructor(code: DomainErrorCode, message: string, opts: { ruleId?: string; fieldErrors?: FieldError[] } = {}) {
    super(message)
    this.name = 'DomainError'
    this.code = code
    this.ruleId = opts.ruleId
    this.fieldErrors = opts.fieldErrors ?? []
  }

  get httpStatus(): number {
    return HTTP_STATUS[this.code]
  }

  static forbidden(message = 'Недостаточно прав', ruleId?: string): DomainError {
    return new DomainError('FORBIDDEN', message, ruleId ? { ruleId } : {})
  }

  static notFound(message = 'Объект не найден'): DomainError {
    return new DomainError('NOT_FOUND', message)
  }

  static rule(ruleId: string, message: string, field?: string): DomainError {
    return new DomainError('RULE_VIOLATION', message, {
      ruleId,
      fieldErrors: field ? [{ field, message }] : [],
    })
  }

  static validation(fieldErrors: FieldError[], message = 'Ошибка валидации'): DomainError {
    return new DomainError('VALIDATION', message, { fieldErrors })
  }

  static conflict(message = 'Объект был изменен другим пользователем. Обновите страницу.'): DomainError {
    return new DomainError('CONFLICT', message)
  }
}

export function isDomainError(e: unknown): e is DomainError {
  return e instanceof DomainError
}
