import { AsyncLocalStorage } from 'node:async_hooks'
import type { Actor } from '../domain/authorization/actor.js'
import { DomainError } from '../domain/shared/errors.js'
import type { RequestContext } from '../application/shared/context.js'

/** Контекст текущего HTTP-запроса: actor + данные для аудита. Устанавливается middleware сервера. */
export interface RequestScope {
  actor: Actor | null
  ctx: RequestContext
  /** Внешний адрес приложения (для одноразовых ссылок). */
  origin: string
}

export const requestStore = new AsyncLocalStorage<RequestScope>()

export function currentScope(): RequestScope {
  const s = requestStore.getStore()
  if (!s) throw new DomainError('UNAUTHENTICATED', 'Нет контекста запроса')
  return s
}

export function currentActor(): Actor {
  const { actor } = currentScope()
  if (!actor) throw new DomainError('UNAUTHENTICATED', 'Требуется вход в систему')
  return actor
}

export function tryActor(): Actor | null {
  return requestStore.getStore()?.actor ?? null
}
