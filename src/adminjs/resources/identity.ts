import type { ResourceWithOptions } from 'adminjs'
import { PERMISSIONS } from '../../domain/identity/permission-catalog.js'
import type { IdentityUseCases, RoleView, UserView } from '../../application/identity/use-cases.js'
import type { AuditUseCases } from '../../application/audit/use-cases.js'
import { formAction, visibleIf } from '../actions.js'
import { currentScope } from '../context.js'
import { DomainResource, type ResourceGateway } from './domain-resource.js'

const STATUS_VALUES = [
  { value: 'INVITED', label: 'Приглашен' },
  { value: 'ACTIVE', label: 'Активен' },
  { value: 'BLOCKED', label: 'Заблокирован' },
  { value: 'ARCHIVED', label: 'В архиве' },
]

const SCOPE_LABEL: Record<string, string> = { OWN: 'свои', ASSIGNED: 'назначенные', COURSE: 'курса', ANY: 'все' }

function userRecord(u: UserView) {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    status: u.status,
    roles: u.roleCodes.join(', '),
    mustChangePassword: u.mustChangePassword,
    lastLoginAt: u.lastLoginAt,
    statusReason: u.statusReason ?? '',
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
    revision: u.revision,
  }
}

function roleRecord(r: RoleView) {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    description: r.description ?? '',
    isSystem: r.isSystem,
    userCount: r.userCount,
    permissions: r.grants.map((g) => `${g.key}: ${SCOPE_LABEL[g.scope] ?? g.scope}`).join('\n'),
    revision: r.revision,
  }
}

function link(path: string) {
  return `${currentScope().origin}${path}`
}

export function identityResources(uc: { identity: IdentityUseCases; audit: AuditUseCases }): ResourceWithOptions[] {
  const { identity } = uc

  const usersGateway: ResourceGateway = {
    async list(actor, query, ctx) {
      const r = await identity.listUsers.run(actor, query, ctx)
      return { records: r.records.map(userRecord), total: r.total }
    },
    async get(actor, id, ctx) {
      return userRecord(await identity.getUser.run(actor, { id }, ctx))
    },
    async update(actor, id, p, ctx) {
      return userRecord(
        await identity.updateUser.run(
          actor,
          { id, email: p.email, displayName: p.displayName, revision: Number(p.revision) },
          ctx,
        ),
      )
    },
  }

  const rolesGateway: ResourceGateway = {
    async list(actor, query, ctx) {
      const r = await identity.listRoles.run(actor, query, ctx)
      return { records: r.records.map(roleRecord), total: r.total }
    },
    async get(actor, id, ctx) {
      return roleRecord(await identity.getRole.run(actor, { id }, ctx))
    },
    async create(actor, p, ctx) {
      return roleRecord(
        await identity.createRole.run(
          actor,
          { code: p.code, name: p.name, description: p.description, grants: [] },
          ctx,
        ),
      )
    },
    async update(actor, id, p, ctx) {
      const current = await identity.getRole.run(actor, { id }, ctx)
      return roleRecord(
        await identity.updateRole.run(
          actor,
          { id, name: p.name, description: p.description, grants: current.grants, revision: Number(p.revision) },
          ctx,
        ),
      )
    },
    async delete(actor, id, ctx) {
      await identity.deleteRole.run(actor, { id }, ctx)
    },
  }

  const roleOptions = async (actor: Parameters<ResourceGateway['list']>[0]) => {
    const r = await identity.listRoles.run(actor, { filters: {}, limit: 200, offset: 0 }, currentScope().ctx)
    return r.records.map((x) => ({ value: x.code, label: `${x.name} (${x.code})` }))
  }

  const isSelf = (actor: { userId: string }, rec: Record<string, any> | null) => rec?.id === actor.userId

  const users: ResourceWithOptions = {
    resource: new DomainResource({
      id: 'User',
      gateway: usersGateway,
      properties: [
        { path: 'id', isId: true, type: 'uuid' },
        { path: 'email', isSortable: true },
        { path: 'displayName', isSortable: true },
        { path: 'status', isSortable: true, availableValues: STATUS_VALUES },
        { path: 'roles' },
        { path: 'role' },
        { path: 'mustChangePassword', type: 'boolean' },
        { path: 'statusReason' },
        { path: 'lastLoginAt', type: 'datetime', isSortable: true },
        { path: 'createdAt', type: 'datetime', isSortable: true },
        { path: 'updatedAt', type: 'datetime' },
        { path: 'revision', type: 'number' },
      ],
    }),
    options: {
      id: 'User',
      navigation: { name: 'Администрирование', icon: 'Users' },
      listProperties: ['email', 'displayName', 'roles', 'status', 'lastLoginAt'],
      showProperties: [
        'email',
        'displayName',
        'roles',
        'status',
        'statusReason',
        'mustChangePassword',
        'lastLoginAt',
        'createdAt',
        'updatedAt',
      ],
      editProperties: ['email', 'displayName'],
      filterProperties: ['email', 'displayName', 'status', 'role'],
      properties: {
        revision: { isVisible: { list: false, show: false, edit: false, filter: false } },
        role: {
          isVisible: { list: false, show: false, edit: false, filter: true },
          availableValues: [
            { value: 'ADMIN', label: 'Администратор' },
            { value: 'TEACHER', label: 'Преподаватель' },
            { value: 'EXPERT', label: 'Эксперт' },
            { value: 'STUDENT', label: 'Студент' },
          ],
        },
        status: { availableValues: STATUS_VALUES },
      },
      actions: {
        list: { isAccessible: visibleIf((a) => a.has('user.read')) },
        search: { isAccessible: visibleIf((a) => a.has('user.read')) },
        show: { isAccessible: visibleIf((a, r) => a.has('user.read') || isSelf(a, r)) },
        edit: {
          isAccessible: visibleIf(
            (a, r) => a.has('user.update', 'ANY') || (isSelf(a, r) && a.has('user.update', 'OWN')),
          ),
        },
        delete: { isAccessible: false, isVisible: false },
        bulkDelete: { isAccessible: false, isVisible: false },
        new: formAction({
          actionType: 'resource',
          icon: 'Plus',
          isAccessible: visibleIf((a) => a.has('user.create')),
          submitLabel: 'Создать пользователя',
          fields: [
            { name: 'email', label: 'Email', type: 'email', required: true },
            { name: 'displayName', label: 'Имя', required: true },
            { name: 'roles', label: 'Роли', type: 'checkboxes', required: true },
            {
              name: 'initialMode',
              label: 'Способ входа',
              type: 'select',
              options: [
                { value: 'INVITE', label: 'Приглашение (пользователь сам задаст пароль по ссылке)' },
                { value: 'TEMP_PASSWORD', label: 'Временный пароль (смена при первом входе)' },
              ],
            },
            {
              name: 'tempPassword',
              label: 'Временный пароль',
              type: 'password',
              help: 'Только для способа «Временный пароль». Не менее 12 символов.',
            },
          ],
          load: async (actor) => ({
            options: { roles: await roleOptions(actor) },
            initial: { initialMode: 'INVITE', roles: [] },
          }),
          submit: async (actor, p, _id, ctx, h) => {
            const r = await identity.createUser.run(
              actor,
              {
                email: p.email,
                displayName: p.displayName,
                roles: p.roles ?? [],
                initialMode: p.initialMode || 'INVITE',
                tempPassword: p.tempPassword,
              },
              ctx,
            )
            const backUrl = h.recordActionUrl({ resourceId: 'User', recordId: r.user.id, actionName: 'show' })
            return r.activationToken
              ? {
                  title: 'Пользователь создан',
                  text: 'Передайте пользователю ссылку для активации (действует 7 дней).',
                  link: link(`/account/activate?token=${r.activationToken}`),
                  backUrl,
                }
              : {
                  title: 'Пользователь создан',
                  text: 'При первом входе пользователь должен будет сменить временный пароль.',
                  backUrl,
                }
          },
        }),
        changeRoles: formAction({
          actionType: 'record',
          label: 'Роли',
          icon: 'Key',
          isAccessible: visibleIf((a, r) => a.has('user.role.assign') && !isSelf(a, r)),
          submitLabel: 'Сохранить роли',
          fields: [{ name: 'roles', label: 'Роли', type: 'checkboxes', required: true }],
          load: async (actor, id) => {
            const u = await identity.getUser.run(actor, { id: id! }, currentScope().ctx)
            return { options: { roles: await roleOptions(actor) }, initial: { roles: u.roleCodes } }
          },
          submit: async (actor, p, id, ctx, h) => {
            await identity.setUserRoles.run(actor, { id: id!, roles: p.roles ?? [] }, ctx)
            return {
              redirectUrl: h.recordActionUrl({ resourceId: 'User', recordId: id!, actionName: 'show' }),
              notice: 'Роли изменены',
            }
          },
        }),
        block: formAction({
          actionType: 'record',
          icon: 'Lock',
          variant: 'danger',
          isAccessible: visibleIf(
            (a, r) => a.has('user.status.manage') && !isSelf(a, r) && ['ACTIVE', 'INVITED'].includes(r?.status),
          ),
          description:
            'Пользователь не сможет войти; все его сессии будут завершены. Созданный им контент сохраняется.',
          submitLabel: 'Заблокировать',
          fields: [{ name: 'reason', label: 'Причина', type: 'textarea', required: true }],
          submit: async (actor, p, id, ctx, h) => {
            await identity.changeUserStatus.run(actor, { id: id!, action: 'block', reason: p.reason }, ctx)
            return {
              redirectUrl: h.recordActionUrl({ resourceId: 'User', recordId: id!, actionName: 'show' }),
              notice: 'Пользователь заблокирован',
            }
          },
        }),
        unblock: formAction({
          actionType: 'record',
          icon: 'Unlock',
          isAccessible: visibleIf((a, r) => a.has('user.status.manage') && !isSelf(a, r) && r?.status === 'BLOCKED'),
          submitLabel: 'Разблокировать',
          fields: [],
          submit: async (actor, _p, id, ctx, h) => {
            await identity.changeUserStatus.run(actor, { id: id!, action: 'unblock' }, ctx)
            return {
              redirectUrl: h.recordActionUrl({ resourceId: 'User', recordId: id!, actionName: 'show' }),
              notice: 'Пользователь разблокирован',
            }
          },
        }),
        archive: formAction({
          actionType: 'record',
          icon: 'Archive',
          variant: 'danger',
          isAccessible: visibleIf((a, r) => a.has('user.status.manage') && !isSelf(a, r) && r?.status !== 'ARCHIVED'),
          description: 'Учетная запись переводится в архив (физически не удаляется, BR-005).',
          submitLabel: 'В архив',
          fields: [{ name: 'reason', label: 'Причина', type: 'textarea', required: true }],
          submit: async (actor, p, id, ctx, h) => {
            await identity.changeUserStatus.run(actor, { id: id!, action: 'archive', reason: p.reason }, ctx)
            return {
              redirectUrl: h.recordActionUrl({ resourceId: 'User', recordId: id!, actionName: 'show' }),
              notice: 'Пользователь в архиве',
            }
          },
        }),
        restore: formAction({
          actionType: 'record',
          icon: 'RotateCcw',
          isAccessible: visibleIf((a, r) => a.has('user.status.manage') && r?.status === 'ARCHIVED'),
          description: 'Восстановленный пользователь получает статус «Заблокирован»; разблокируйте его отдельно.',
          submitLabel: 'Восстановить',
          fields: [],
          submit: async (actor, _p, id, ctx, h) => {
            await identity.changeUserStatus.run(actor, { id: id!, action: 'restore' }, ctx)
            return {
              redirectUrl: h.recordActionUrl({ resourceId: 'User', recordId: id!, actionName: 'show' }),
              notice: 'Пользователь восстановлен',
            }
          },
        }),
        resetPassword: formAction({
          actionType: 'record',
          icon: 'RefreshCw',
          isAccessible: visibleIf((a, r) => a.has('user.password.reset') && !isSelf(a, r) && r?.status === 'ACTIVE'),
          description: 'Будет создана одноразовая ссылка (1 час). Все сессии пользователя завершатся.',
          submitLabel: 'Сбросить пароль',
          fields: [],
          submit: async (actor, _p, id, ctx) => {
            const r = await identity.resetPassword.run(actor, { userId: id! }, ctx)
            return { title: 'Пароль сброшен', link: link(`/account/reset?token=${r.token}`) }
          },
        }),
        reissueActivation: formAction({
          actionType: 'record',
          icon: 'Send',
          isAccessible: visibleIf((a, r) => a.has('user.create') && r?.status === 'INVITED'),
          description: 'Новая ссылка активации (7 дней). Предыдущие ссылки перестанут работать.',
          submitLabel: 'Создать ссылку',
          fields: [],
          submit: async (actor, _p, id, ctx) => {
            const r = await identity.reissueActivation.run(actor, { userId: id! }, ctx)
            return { title: 'Ссылка создана', link: link(`/account/activate?token=${r.token}`) }
          },
        }),
        history: {
          actionType: 'record',
          icon: 'Clock',
          component: false,
          isAccessible: visibleIf((a) => a.has('audit.read')),
          handler: async (_req: unknown, _res: unknown, context: any) => ({
            record: context.record.toJSON(context.currentAdmin),
            redirectUrl: `${context.h.resourceActionUrl({ resourceId: 'AuditLog', actionName: 'list' })}?filters.resourceType=user&filters.resourceId=${context.record.id()}`,
          }),
        },
      },
    },
  }

  const permissionOptions = PERMISSIONS.flatMap((p) =>
    p.scopes.map((s) => ({ value: `${p.key}:${s}`, label: `${SCOPE_LABEL[s]}`, group: `${p.key} — ${p.description}` })),
  )

  const roles: ResourceWithOptions = {
    resource: new DomainResource({
      id: 'Role',
      gateway: rolesGateway,
      properties: [
        { path: 'id', isId: true, type: 'uuid' },
        { path: 'code' },
        { path: 'name' },
        { path: 'description', type: 'textarea' },
        { path: 'isSystem', type: 'boolean' },
        { path: 'userCount', type: 'number' },
        { path: 'permissions', type: 'textarea' },
        { path: 'revision', type: 'number' },
      ],
    }),
    options: {
      id: 'Role',
      navigation: { name: 'Администрирование', icon: 'Users' },
      listProperties: ['code', 'name', 'isSystem', 'userCount'],
      showProperties: ['code', 'name', 'description', 'isSystem', 'userCount', 'permissions'],
      editProperties: ['code', 'name', 'description'],
      filterProperties: ['code', 'name'],
      properties: {
        code: { isDisabled: false },
        revision: { isVisible: { list: false, show: false, edit: false, filter: false } },
      },
      actions: {
        list: { isAccessible: visibleIf((a) => a.has('role.read')) },
        search: { isAccessible: visibleIf((a) => a.has('role.read')) },
        show: { isAccessible: visibleIf((a) => a.has('role.read')) },
        new: { isAccessible: visibleIf((a) => a.has('role.manage')) },
        edit: { isAccessible: visibleIf((a, r) => a.has('role.manage') && !a.roleCodes.includes(r?.code)) },
        delete: { isAccessible: visibleIf((a, r) => a.has('role.manage') && !r?.isSystem) },
        bulkDelete: { isAccessible: false, isVisible: false },
        grants: formAction({
          actionType: 'record',
          icon: 'Key',
          isAccessible: visibleIf((a, r) => a.has('role.manage') && !a.roleCodes.includes(r?.code)),
          description:
            'Отметьте permissions и область действия (scope). Изменения применяются со следующего запроса пользователей роли.',
          submitLabel: 'Сохранить права роли',
          fields: [{ name: 'grants', label: 'Permissions', type: 'checkboxes' }],
          load: async (actor, id) => {
            const role = await identity.getRole.run(actor, { id: id! }, currentScope().ctx)
            return {
              options: { grants: permissionOptions },
              initial: { grants: role.grants.map((g) => `${g.key}:${g.scope}`) },
            }
          },
          submit: async (actor, p, id, ctx, h) => {
            const role = await identity.getRole.run(actor, { id: id! }, ctx)
            const grants = (p.grants ?? []).map((s: string) => {
              const i = s.lastIndexOf(':')
              return { key: s.slice(0, i), scope: s.slice(i + 1) }
            })
            await identity.updateRole.run(
              actor,
              { id: id!, name: role.name, description: role.description, grants, revision: role.revision },
              ctx,
            )
            return {
              redirectUrl: h.recordActionUrl({ resourceId: 'Role', recordId: id!, actionName: 'show' }),
              notice: 'Права роли сохранены',
            }
          },
        }),
      },
    },
  }

  const auditGateway: ResourceGateway = {
    async list(actor, query, ctx) {
      const r = await uc.audit.listAudit.run(actor, query, ctx)
      return { records: r.records.map(auditRecord), total: r.total }
    },
    async get(actor, id, ctx) {
      return auditRecord(await uc.audit.getAudit.run(actor, { id }, ctx))
    },
  }

  const auditLog: ResourceWithOptions = {
    resource: new DomainResource({
      id: 'AuditLog',
      gateway: auditGateway,
      properties: [
        { path: 'id', isId: true },
        { path: 'occurredAt', type: 'datetime', isSortable: true },
        { path: 'actorEmail' },
        { path: 'actorId' },
        { path: 'actorRoles' },
        { path: 'action' },
        { path: 'resourceType' },
        { path: 'resourceId' },
        { path: 'changes', type: 'textarea' },
        { path: 'reason' },
        { path: 'requestId' },
        { path: 'ip' },
      ],
    }),
    options: {
      id: 'AuditLog',
      navigation: { name: 'Администрирование', icon: 'Users' },
      listProperties: ['occurredAt', 'actorEmail', 'action', 'resourceType', 'resourceId'],
      showProperties: [
        'occurredAt',
        'actorEmail',
        'actorRoles',
        'action',
        'resourceType',
        'resourceId',
        'changes',
        'reason',
        'requestId',
        'ip',
      ],
      filterProperties: ['occurredAt', 'actorEmail', 'action', 'resourceType', 'resourceId'],
      sort: { sortBy: 'occurredAt', direction: 'desc' },
      actions: {
        list: { isAccessible: visibleIf((a) => a.has('audit.read')) },
        search: { isAccessible: visibleIf((a) => a.has('audit.read')) },
        show: { isAccessible: visibleIf((a) => a.has('audit.read')) },
        new: { isAccessible: false, isVisible: false },
        edit: { isAccessible: false, isVisible: false },
        delete: { isAccessible: false, isVisible: false },
        bulkDelete: { isAccessible: false, isVisible: false },
      },
    },
  }

  return [users, roles, auditLog]
}

function auditRecord(a: Awaited<ReturnType<AuditUseCases['getAudit']['run']>>) {
  return {
    id: a.id,
    occurredAt: a.occurredAt,
    actorEmail: a.actorEmail ?? (a.actorId ? a.actorId : 'система'),
    actorId: a.actorId ?? '',
    actorRoles: a.actorRoles.join(', '),
    action: a.action,
    resourceType: a.resourceType,
    resourceId: a.resourceId ?? '',
    changes: a.changes ? JSON.stringify(a.changes, null, 2) : '',
    reason: a.reason ?? '',
    requestId: a.requestId ?? '',
    ip: a.ip ?? '',
  }
}
