import AdminJS, { type AdminJSOptions, type ResourceWithOptions } from 'adminjs'
import type { TestUseCases } from '../application/assessment/test-use-cases.js'
import type { ReviewUseCases } from '../application/review/review-use-cases.js'
import type { AuditUseCases } from '../application/audit/use-cases.js'
import type { EducationUseCases } from '../application/education/use-cases.js'
import type { IdentityUseCases } from '../application/identity/use-cases.js'
import type { ItemUseCases } from '../application/itembank/item-use-cases.js'
import type { QtypeUseCases } from '../application/itembank/qtype-use-cases.js'
import type { MediaUseCases } from '../application/media/use-cases.js'
import { componentLoader, Components } from './component-loader.js'
import { actionHints, propertyHints } from './hints.js'
import { ru } from './locale-ru.js'
import { educationResources } from './resources/education.js'
import { identityResources } from './resources/identity.js'
import { itemResources } from './resources/items.js'
import type { KnowledgeUseCases } from '../application/knowledge/use-cases.js'
import { knowledgeResources } from './resources/knowledge.js'
import { mediaResources } from './resources/media.js'
import { qtypeResources } from './resources/qtypes.js'
import { reviewResources } from './resources/reviews.js'
import { assignmentSummaryAction, testResources } from './resources/tests.js'

export interface AdminServices {
  identity: IdentityUseCases
  audit: AuditUseCases
  education: EducationUseCases
  media: MediaUseCases
  knowledge: KnowledgeUseCases
  qtypes: QtypeUseCases
  items: ItemUseCases
  tests: TestUseCases
  reviews: ReviewUseCases
}

export const ADMIN_ROOT = '/admin'

/**
 * Подсказки из hints.ts: стандартные поля — `description` свойства (иконка «?» с тултипом AdminJS),
 * формы действий и собственные компоненты — `custom.hints` и `field.hint`.
 */
function withHints(resources: ResourceWithOptions[]): ResourceWithOptions[] {
  for (const r of resources) {
    const options = r.options as Record<string, any>
    const id = String(options.id)
    options.properties ??= {}
    for (const [path, text] of Object.entries(propertyHints(id)))
      options.properties[path] = { ...(options.properties[path] ?? {}), description: text }
    for (const [name, action] of Object.entries((options.actions ?? {}) as Record<string, any>)) {
      if (!action || typeof action !== 'object') continue
      const hints = { ...propertyHints(id), ...actionHints(id, 'new'), ...actionHints(id, name) }
      const own = actionHints(id, name)
      action.custom = { ...(action.custom ?? {}), hints }
      if (Array.isArray(action.custom.fields))
        action.custom.fields = action.custom.fields.map((f: { name: string }) =>
          own[f.name] ? { ...f, hint: own[f.name] } : f,
        )
    }
  }
  return resources
}

/** Подписи полей справочников «Материалы» (SPEC-KB-001). */
function knowledgeTranslations() {
  const common = {
    name: 'Название',
    slug: 'Slug (ключ ссылки)',
    anchor: 'Ссылка в тексте',
    altNames: 'Варианты написания',
    yearFrom: 'Год (от)',
    yearTo: 'Год (до)',
    description: 'Описание',
    usageCount: 'Ссылок',
    usages: 'Где используется',
    status: 'Статус',
    archiveReason: 'Причина архивации',
    'attrs.birthText': 'Годы жизни: рождение',
    'attrs.deathText': 'Годы жизни: смерть',
    'attrs.country': 'Страна',
    'attrs.workKind': 'Вид произведения',
    'attrs.dateText': 'Датировка',
    'attrs.dimensions': 'Размеры',
    'attrs.inventoryNo': 'Инв. номер',
    'attrs.location': 'Местонахождение (архитектура)',
    'attrs.city': 'Город',
    'attrs.url': 'Сайт',
    'attrs.creditLineTemplate': 'Шаблон строки атрибуции',
    'attrs.forms': 'Словоформы',
    'links.AUTHOR': 'Авторы',
    'links.COLLECTION': 'Собрание',
    'links.TECHNIQUE': 'Техники',
    'links.MOVEMENT': 'Направления',
    'links.PERIOD': 'Периоды',
    'links.PARENT': 'Входит в',
    'links.SEE_ALSO': 'См. также',
  }
  return Object.fromEntries(
    ['Person', 'Artwork', 'Collection', 'Movement', 'Period', 'Technique', 'Term'].map((r) => [
      r,
      { properties: common },
    ]),
  )
}

export function buildAdminOptions(services: AdminServices, opts: { assetsCDN?: string } = {}): AdminJSOptions {
  return {
    rootPath: ADMIN_ROOT,
    loginPath: `${ADMIN_ROOT}/login`,
    logoutPath: `${ADMIN_ROOT}/logout`,
    componentLoader,
    ...(opts.assetsCDN ? { assetsCDN: opts.assetsCDN } : {}),
    resources: withHints([
      ...reviewResources(services.reviews, services.tests, services.items),
      ...testResources(services.tests, services.items, services.education),
      ...itemResources(services.items, services.media),
      ...qtypeResources(services.qtypes),
      ...mediaResources(services.media),
      ...knowledgeResources(services.knowledge),
      ...educationResources(services.education, { summary: assignmentSummaryAction(services.tests) }),
      ...identityResources(services),
    ]),
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
            ...knowledgeTranslations(),
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
            Test: {
              properties: {
                title: 'Название',
                state: 'Состояние версии',
                versionNo: 'Версия',
                owner: 'Автор',
                assignment: 'Задание',
                assignmentId: 'Задание',
                course: 'Курс',
                courseId: 'Курс',
                itemCount: 'Вопросов',
                maxScore: 'Макс. балл',
                structure: 'Структура',
                issues: 'Готовность',
                versions: 'Версии',
                contentHash: 'Хэш содержимого',
                status: 'Статус',
                updatedAt: 'Изменен',
              },
              actions: {
                new: 'Создать тест',
                builder: 'Конструктор',
                preview: 'Предпросмотр',
                submit: 'Отправить на экспертизу',
                recall: 'Отозвать отправку',
                newVersion: 'Новая версия',
                publish: 'Опубликовать',
                withdraw: 'Отозвать публикацию',
                archive: 'В архив',
                restore: 'Восстановить',
                publications: 'Публикации',
                history: 'Журнал',
              },
            },
            Review: {
              properties: {
                subject: 'Объект',
                subjectType: 'Тип объекта',
                versionState: 'Состояние версии',
                status: 'Статус экспертизы',
                queue: 'Очередь',
                owner: 'Автор',
                assignment: 'Задание',
                course: 'Курс',
                reviewer: 'Эксперт',
                assignments: 'Назначения',
                summary: 'Итоговый комментарий',
                submittedAt: 'Отправлено',
                decidedAt: 'Решение',
              },
              actions: { workspace: 'Открыть экспертизу', assign: 'Назначить эксперта' },
            },
            ChecklistTemplate: {
              properties: {
                name: 'Название',
                appliesTo: 'Применяется к',
                versionNo: 'Версия',
                status: 'Статус',
                items: 'Пункты',
                createdAt: 'Создан',
              },
              actions: { newTemplateVersion: 'Изменить пункты' },
            },
            Item: {
              properties: {
                stem: 'Формулировка',
                questionType: 'Тип',
                questionTypeId: 'Тип вопроса',
                state: 'Состояние версии',
                versionNo: 'Версия',
                owner: 'Автор',
                assignment: 'Задание',
                assignmentId: 'Задание',
                courseId: 'Курс',
                course: 'Курс',
                topicId: 'Тема',
                difficulty: 'Сложность',
                points: 'Баллы',
                topics: 'Темы',
                tags: 'Теги',
                tag: 'Тег',
                status: 'Статус',
                archiveReason: 'Причина архивации',
                versions: 'Версии',
                issues: 'Проверка',
                contentHash: 'Хэш содержимого',
                updatedAt: 'Изменен',
              },
              actions: {
                new: 'Создать вопрос',
                editDraft: 'Редактировать черновик',
                preview: 'Предпросмотр',
                card: 'Быстрый просмотр',
                newVersion: 'Новая версия',
                submit: 'Отправить на экспертизу',
                recall: 'Отозвать отправку',
                discard: 'Удалить черновик',
                compare: 'Сравнить версии',
              },
            },
            MediaAsset: {
              properties: {
                thumb: 'Превью',
                kind: 'Тип',
                title: 'Название',
                altText: 'Альтернативный текст',
                caption: 'Подпись',
                transcript: 'Расшифровка (видео)',
                depictsArtwork: 'Изображено произведение',
                artist: 'Автор произведения',
                artworkId: 'Произведение (справочник)',
                workTitle: 'Название произведения',
                dateText: 'Датировка',
                technique: 'Техника',
                collection: 'Собрание',
                inventoryNo: 'Инв. номер',
                sourceUrl: 'Источник (URL)',
                sourceDescription: 'Источник (описание)',
                license: 'Лицензия',
                rightsHolder: 'Правообладатель',
                creditLine: 'Атрибуция (credit line)',
                rightsNote: 'Основание прав',
                rightsStatus: 'Права',
                tags: 'Теги',
                tag: 'Тег',
                size: 'Файл',
                owner: 'Загрузил',
                status: 'Статус',
                archiveReason: 'Причина архивации',
                usage: 'Где используется',
              },
              actions: { new: 'Загрузить', rights: 'Права' },
            },
            QuestionType: {
              properties: {
                code: 'Код',
                name: 'Название',
                description: 'Описание',
                interactionKey: 'Interaction',
                status: 'Статус',
                version: 'Версия',
                config: 'Конфигурация',
                evaluation: 'Оценивание',
                versions: 'История версий',
                itemCount: 'Вопросов',
                activeAssignmentCount: 'В активных заданиях',
              },
              actions: { configure: 'Изменить конфигурацию', activate: 'Активировать', deactivate: 'Деактивировать' },
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
                summary: 'Сводка по тестам',
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
            Item: 'Вопросы',
            Test: 'Тесты',
            Review: 'Экспертизы',
            ChecklistTemplate: 'Шаблоны checklist',
            MediaAsset: 'Медиатека',
            Person: 'Авторы',
            Artwork: 'Произведения',
            Collection: 'Собрания и музеи',
            Movement: 'Направления и стили',
            Period: 'Периоды',
            Technique: 'Техники и материалы',
            Term: 'Термины',
            Материалы: 'Материалы',
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
