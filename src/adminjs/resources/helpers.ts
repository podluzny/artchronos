import type { ActionContext } from 'adminjs'
import type { Actor } from '../../domain/authorization/actor.js'
import type { RequestContext } from '../../application/shared/context.js'
import { formAction, visibleIf } from '../actions.js'

type RunFn = (actor: Actor, input: any, ctx: RequestContext) => Promise<unknown>

const ARCHIVE_TEXT = 'Объект будет скрыт из рабочих списков и выбора; данные и ссылки сохраняются (BR-005, BR-039).'

/** Пара действий «В архив» / «Восстановить» для архивируемого ресурса. */
export function archiveActions(opts: {
  resourceId: string
  canManage: (actor: Actor, record: Record<string, any> | null) => boolean
  archive: RunFn
  restore: RunFn
  extraFields?: Parameters<typeof formAction>[0]['fields']
}) {
  const back = (h: ActionContext['h'], id: string) =>
    h.recordActionUrl({ resourceId: opts.resourceId, recordId: id, actionName: 'show' })
  return {
    archive: formAction({
      actionType: 'record',
      icon: 'Archive',
      variant: 'danger',
      description: ARCHIVE_TEXT,
      submitLabel: 'В архив',
      isAccessible: visibleIf((a, r) => r?.status === 'ACTIVE' && opts.canManage(a, r)),
      fields: [{ name: 'reason', label: 'Причина', type: 'textarea', required: true }, ...(opts.extraFields ?? [])],
      submit: async (actor, p, id, ctx, h) => {
        await opts.archive(actor, { id: id!, reason: p.reason, cascade: p.cascade === 'yes' }, ctx)
        return { redirectUrl: back(h, id!), notice: 'Перемещено в архив' }
      },
    }),
    restore: formAction({
      actionType: 'record',
      icon: 'RotateCcw',
      submitLabel: 'Восстановить',
      isAccessible: visibleIf((a, r) => r?.status === 'ARCHIVED' && opts.canManage(a, r)),
      fields: [],
      submit: async (actor, _p, id, ctx, h) => {
        await opts.restore(actor, { id: id! }, ctx)
        return { redirectUrl: back(h, id!), notice: 'Восстановлено' }
      },
    }),
  }
}

export const STATUS_ARCHIVE = [
  { value: 'ACTIVE', label: 'Активен' },
  { value: 'ARCHIVED', label: 'В архиве' },
]

export const hidden = { isVisible: { list: false, show: false, edit: false, filter: false } }
export const showOnly = { isVisible: { list: false, show: true, edit: false, filter: false } }
