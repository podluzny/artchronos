import { DomainError } from '../../domain/shared/errors.js'
import { requirePermission, type Actor } from '../../domain/authorization/actor.js'
import type { RequestContext } from './context.js'

/**
 * Декларация use case (ADR-003 п.4, AC-AUTH-003.8): каждый use case обязан объявить permission.
 * - строка-ключ — грубая проверка права до выполнения (объектная — внутри);
 * - 'AUTHENTICATED' — нужен только активный пользователь (например, смена своего пароля);
 * - 'PUBLIC' — без пользователя (вход, активация по токену).
 */
export type UseCasePermission = string | 'AUTHENTICATED' | 'PUBLIC'

export interface UseCase<I, O> {
  readonly name: string
  readonly permission: UseCasePermission
  run(actor: Actor | null, input: I, ctx: RequestContext): Promise<O>
}

export function useCase<I, O>(def: {
  name: string
  permission: UseCasePermission
  run: (actor: Actor, input: I, ctx: RequestContext) => Promise<O>
}): UseCase<I, O>
export function useCase<I, O>(def: {
  name: string
  permission: 'PUBLIC'
  run: (actor: Actor | null, input: I, ctx: RequestContext) => Promise<O>
}): UseCase<I, O>
export function useCase<I, O>(def: {
  name: string
  permission: UseCasePermission
  run: (actor: any, input: I, ctx: RequestContext) => Promise<O>
}): UseCase<I, O> {
  if (!def.permission) throw new Error(`Use case ${def.name} не объявил permission`)
  return {
    name: def.name,
    permission: def.permission,
    async run(actor, input, ctx) {
      if (def.permission !== 'PUBLIC') {
        if (!actor) throw new DomainError('UNAUTHENTICATED', 'Требуется вход в систему')
        if (actor.status !== 'ACTIVE') throw new DomainError('UNAUTHENTICATED', 'Учетная запись неактивна')
        if (def.permission === 'AUTHENTICATED') {
          // допускается и при mustChangePassword — именно так пароль и меняется
        } else {
          requirePermission(actor, def.permission)
        }
      }
      return def.run(actor, input, ctx)
    },
  }
}
