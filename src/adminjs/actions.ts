import type { ActionContext, ActionRequest, ActionResponse } from 'adminjs'
import type { Actor } from '../domain/authorization/actor.js'
import { isDomainError } from '../domain/shared/errors.js'
import type { RequestContext } from '../application/shared/context.js'
import { Components } from './component-loader.js'
import { currentScope, tryActor } from './context.js'

export interface FormField {
  name: string
  label: string
  type?: 'text' | 'password' | 'textarea' | 'select' | 'checkboxes' | 'email'
  required?: boolean
  help?: string
  options?: { value: string; label: string; group?: string }[]
}

export interface FormResult {
  title?: string
  text?: string
  link?: string
  backUrl?: string
}

/** Скрывает недоступные действия в UI (FR-PERM-004). Защита — в use case. */
export function visibleIf(check: (actor: Actor, record: Record<string, any> | null) => boolean) {
  return (context: ActionContext) => {
    const actor = tryActor()
    if (!actor) return false
    try {
      return check(actor, context.record?.params ?? null)
    } catch {
      return false
    }
  }
}

function payloadOf(request: ActionRequest): Record<string, any> {
  const out: Record<string, any> = {}
  for (const [k, v] of Object.entries(request.payload ?? {})) {
    if (typeof v === 'string' && v.startsWith('[')) {
      try {
        out[k] = JSON.parse(v)
        continue
      } catch {
        /* строка */
      }
    }
    out[k] = v
  }
  return out
}

/**
 * Действие с формой ActionForm. Ошибки домена возвращаются как notice + ошибки полей,
 * чтобы форма показала их без перезагрузки.
 */
export function formAction(opts: {
  actionType: 'record' | 'resource'
  label?: string
  icon?: string
  variant?: 'contained' | 'danger' | 'primary'
  description?: string
  submitLabel?: string
  fields: FormField[]
  isAccessible: (context: ActionContext) => boolean
  load?: (
    actor: Actor,
    recordId: string | null,
  ) => Promise<{ options?: Record<string, FormField['options']>; initial?: Record<string, unknown> }>
  submit: (
    actor: Actor,
    payload: Record<string, any>,
    recordId: string | null,
    ctx: RequestContext,
    h: ActionContext['h'],
  ) => Promise<FormResult | { redirectUrl: string; notice?: string }>
}) {
  return {
    actionType: opts.actionType,
    icon: opts.icon ?? 'Edit',
    component: Components.ActionForm,
    isAccessible: opts.isAccessible,
    isVisible: opts.isAccessible,
    showInDrawer: false,
    custom: {
      fields: opts.fields,
      description: opts.description,
      submitLabel: opts.submitLabel,
      variant: opts.variant,
      loadOptions: !!opts.load,
    },
    handler: async (request: ActionRequest, _response: unknown, context: ActionContext): Promise<ActionResponse> => {
      const { actor, ctx } = currentScope()
      const recordJson = context.record ? context.record.toJSON(context.currentAdmin) : undefined
      const base: Record<string, unknown> = recordJson ? { record: recordJson } : {}
      if (!actor) return { ...base, notice: { message: 'Требуется вход', type: 'error' } } as ActionResponse
      const recordId = context.record ? String(context.record.id()) : null
      if (request.method === 'get') {
        const extra = opts.load ? await opts.load(actor, recordId) : {}
        return { ...base, ...extra } as ActionResponse
      }
      try {
        const r = await opts.submit(actor, payloadOf(request), recordId, ctx, context.h)
        if ('redirectUrl' in r) {
          return {
            ...base,
            redirectUrl: r.redirectUrl,
            notice: { message: r.notice ?? 'Готово', type: 'success' },
          } as ActionResponse
        }
        return { ...base, result: r } as ActionResponse
      } catch (e) {
        if (!isDomainError(e)) throw e
        const errors: Record<string, string> = {}
        for (const f of e.fieldErrors) errors[f.field] = f.message
        const message = e.ruleId ? `${e.message} (${e.ruleId})` : e.message
        return { ...base, notice: { message, type: 'error' }, errors } as ActionResponse
      }
    },
  }
}
