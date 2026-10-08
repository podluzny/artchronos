import AdminJS, { type AdminJSOptions } from 'adminjs'
import type { AuditUseCases } from '../application/audit/use-cases.js'
import type { EducationUseCases } from '../application/education/use-cases.js'
import type { IdentityUseCases } from '../application/identity/use-cases.js'
import { componentLoader, Components } from './component-loader.js'
import { ru } from './locale-ru.js'
import { educationResources } from './resources/education.js'
import { identityResources } from './resources/identity.js'

export interface AdminServices {
  identity: IdentityUseCases
  audit: AuditUseCases
  education: EducationUseCases
}

export const ADMIN_ROOT = '/admin'

export function buildAdminOptions(services: AdminServices, opts: { assetsCDN?: string } = {}): AdminJSOptions {
  return {
    rootPath: ADMIN_ROOT,
    loginPath: `${ADMIN_ROOT}/login`,
    logoutPath: `${ADMIN_ROOT}/logout`,
    componentLoader,
    ...(opts.assetsCDN ? { assetsCDN: opts.assetsCDN } : {}),
    resources: [...educationResources(services.education), ...identityResources(services)],
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
            Subject: {
              properties: {
                code: 'Код',
                name: 'Название',
                courseCount: 'Курсов',
                status: 'Статус',
                archiveReason: 'Причина архивации',
              },
            },
            Course: {
              properties: {
                subjectId: 'Предмет',
                code: 'Код',
                name: 'Название',
                academicPeriod: 'Период',
                teachers: 'Преподаватели',
                status: 'Статус',
                archiveReason: 'Причина архивации',
              },
              actions: { teachers: 'Назначить преподавателей' },
            },
            Topic: {
              properties: {
                courseId: 'Курс',
                parentId: 'Родительская тема',
                name: 'Название',
                path: 'Тема',
                ordinal: 'Порядок',
                status: 'Статус',
                archiveReason: 'Причина архивации',
              },
            },
            LearningObjective: {
              properties: {
                courseId: 'Курс',
                topicId: 'Тема',
                code: 'Код',
                text: 'Формулировка',
                bloomLevel: 'Уровень (Блум)',
                status: 'Статус',
                archiveReason: 'Причина архивации',
              },
            },
            StudentGroup: {
              properties: {
                courseId: 'Курс',
                name: 'Название',
                members: 'Студенты',
                memberCount: 'Число студентов',
                status: 'Статус',
                archiveReason: 'Причина архивации',
              },
              actions: { members: 'Изменить состав' },
            },
            QuestionType: {
              properties: { code: 'Код', name: 'Название', interactionKey: 'Interaction', status: 'Статус' },
            },
            Assignment: {
              properties: {
                courseId: 'Курс',
                title: 'Название',
                instructions: 'Инструкции',
                minItems: 'Вопросов, мин.',
                maxItems: 'Вопросов, макс.',
                maxTestsPerStudent: 'Тестов на студента',
                deadlineAt: 'Дедлайн',
                myDeadline: 'Мой срок',
                status: 'Статус',
                owner: 'Автор',
                defaultReviewer: 'Эксперт по умолчанию',
                topicCount: 'Тем',
                questionTypeCount: 'Типов вопросов',
                targetCount: 'Адресатов',
              },
              actions: {
                configure: 'Настроить',
                activate: 'Активировать',
                close: 'Закрыть',
                reopen: 'Открыть заново',
                extendDeadline: 'Продлить срок',
              },
            },
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
            Subject: 'Предметы',
            Course: 'Курсы',
            Topic: 'Темы',
            LearningObjective: 'Учебные цели',
            StudentGroup: 'Группы',
            QuestionType: 'Типы вопросов',
            Assignment: 'Задания',
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
