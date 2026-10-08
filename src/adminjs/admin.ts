import AdminJS, { type AdminJSOptions } from 'adminjs'
import type { AuditUseCases } from '../application/audit/use-cases.js'
import type { IdentityUseCases } from '../application/identity/use-cases.js'
import { componentLoader, Components } from './component-loader.js'
import { ru } from './locale-ru.js'
import { identityResources } from './resources/identity.js'

export interface AdminServices {
  identity: IdentityUseCases
  audit: AuditUseCases
}

export const ADMIN_ROOT = '/admin'

export function buildAdminOptions(services: AdminServices, opts: { assetsCDN?: string } = {}): AdminJSOptions {
  return {
    rootPath: ADMIN_ROOT,
    loginPath: `${ADMIN_ROOT}/login`,
    logoutPath: `${ADMIN_ROOT}/logout`,
    componentLoader,
    ...(opts.assetsCDN ? { assetsCDN: opts.assetsCDN } : {}),
    resources: [...identityResources(services)],
    dashboard: { component: Components.Dashboard },
    branding: {
      companyName: 'ArtChronos',
      withMadeWithLove: false,
      logo: false,
    },
    locale: {
      language: 'ru',
      availableLanguages: ['ru'],
      localeDetection: false,
      translations: {
        ru: {
          ...ru,
          resources: {
            User: {
              properties: {
                email: 'Email',
                displayName: 'Имя',
                status: 'Статус',
                roles: 'Роли',
                role: 'Роль',
                mustChangePassword: 'Требуется смена пароля',
                statusReason: 'Причина статуса',
                lastLoginAt: 'Последний вход',
                createdAt: 'Создан',
                updatedAt: 'Изменен',
              },
              actions: {
                changeRoles: 'Роли',
                block: 'Заблокировать',
                unblock: 'Разблокировать',
                archive: 'В архив',
                restore: 'Восстановить',
                resetPassword: 'Сбросить пароль',
                reissueActivation: 'Ссылка активации',
                history: 'История',
              },
            },
            Role: {
              properties: {
                code: 'Код',
                name: 'Название',
                description: 'Описание',
                isSystem: 'Системная',
                userCount: 'Пользователей',
                permissions: 'Права',
              },
              actions: { grants: 'Права роли' },
            },
            AuditLog: {
              properties: {
                occurredAt: 'Время',
                actorEmail: 'Пользователь',
                actorRoles: 'Роли',
                action: 'Действие',
                resourceType: 'Тип объекта',
                resourceId: 'ID объекта',
                changes: 'Изменения',
                reason: 'Причина',
                requestId: 'ID запроса',
                ip: 'IP',
              },
            },
          },
          labels: {
            ...ru.labels,
            User: 'Пользователи',
            Role: 'Роли',
            AuditLog: 'Журнал аудита',
            Администрирование: 'Администрирование',
          },
        },
      },
    },
  }
}

export function buildAdmin(services: AdminServices, opts: { assetsCDN?: string } = {}): AdminJS {
  return new AdminJS(buildAdminOptions(services, opts))
}
