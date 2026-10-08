import { ForbiddenError, NotFoundError, ValidationError } from 'adminjs'
import { isDomainError } from '../domain/shared/errors.js'

/** Перевод DomainError в ошибки AdminJS (ADR-004 п.5). */
export function toAdminError(e: unknown): unknown {
  if (!isDomainError(e)) return e
  switch (e.code) {
    case 'FORBIDDEN':
    case 'PASSWORD_CHANGE_REQUIRED':
    case 'UNAUTHENTICATED':
      return new ForbiddenError(e.message)
    case 'NOT_FOUND':
      return new NotFoundError(e.message, 'domain')
    default: {
      const fields: Record<string, { message: string }> = {}
      for (const f of e.fieldErrors) fields[f.field] = { message: f.message }
      const base = e.ruleId ? `${e.message} (${e.ruleId})` : e.message
      return new ValidationError(fields, { message: base, type: e.code })
    }
  }
}

export async function adminCall<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    throw toAdminError(e)
  }
}
