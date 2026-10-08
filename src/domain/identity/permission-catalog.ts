import type { Scope } from '../authorization/scope.js'

/**
 * Каталог permissions (docs/permission-model.md §3). Каталог — часть кода (ADR-003):
 * через UI permissions не создаются, только комбинируются в роли.
 */
export interface PermissionDef {
  key: string
  description: string
  scopes: readonly Scope[]
}

export const PERMISSIONS = [
  { key: 'user.read', description: 'Просмотр пользователей', scopes: ['COURSE', 'ANY'] },
  { key: 'user.create', description: 'Создание пользователя', scopes: ['ANY'] },
  { key: 'user.update', description: 'Изменение профиля', scopes: ['OWN', 'ANY'] },
  { key: 'user.status.manage', description: 'Блокировка, разблокировка, архивирование', scopes: ['ANY'] },
  { key: 'user.role.assign', description: 'Назначение ролей', scopes: ['ANY'] },
  { key: 'user.password.reset', description: 'Сброс пароля другому пользователю', scopes: ['ANY'] },
  { key: 'role.read', description: 'Просмотр ролей', scopes: ['ANY'] },
  { key: 'role.manage', description: 'Управление ролями и составом permissions', scopes: ['ANY'] },
  { key: 'taxonomy.read', description: 'Чтение предметов, курсов, тем, целей', scopes: ['COURSE', 'ANY'] },
  { key: 'taxonomy.manage', description: 'Ведение предметов, курсов, тем, целей', scopes: ['COURSE', 'ANY'] },
  { key: 'group.read', description: 'Просмотр групп студентов', scopes: ['COURSE', 'ANY'] },
  { key: 'group.manage', description: 'Ведение групп студентов', scopes: ['COURSE', 'ANY'] },
  { key: 'assignment.read', description: 'Чтение заданий', scopes: ['ASSIGNED', 'COURSE', 'ANY'] },
  { key: 'assignment.create', description: 'Создание задания', scopes: ['COURSE', 'ANY'] },
  {
    key: 'assignment.update',
    description: 'Изменение, активация, закрытие, продление задания',
    scopes: ['OWN', 'COURSE', 'ANY'],
  },
  { key: 'media.read', description: 'Просмотр медиа', scopes: ['ANY'] },
  { key: 'media.upload', description: 'Загрузка медиа', scopes: ['ANY'] },
  { key: 'media.update', description: 'Изменение метаданных медиа', scopes: ['OWN', 'ANY'] },
  { key: 'media.archive', description: 'Архивирование медиа', scopes: ['OWN', 'ANY'] },
  { key: 'media.rights.manage', description: 'Подтверждение прав на медиа', scopes: ['ANY'] },
  { key: 'qtype.read', description: 'Просмотр реестра типов вопросов', scopes: ['ANY'] },
  { key: 'qtype.manage', description: 'Управление типами вопросов', scopes: ['ANY'] },
  { key: 'item.read', description: 'Чтение вопросов', scopes: ['OWN', 'ASSIGNED', 'COURSE', 'ANY'] },
  { key: 'item.create', description: 'Создание вопроса', scopes: ['OWN'] },
  { key: 'item.update', description: 'Редактирование черновика, новая версия вопроса', scopes: ['OWN', 'ANY'] },
  { key: 'item.submit', description: 'Отправка вопроса на экспертизу', scopes: ['OWN'] },
  { key: 'item.archive', description: 'Архивирование вопроса', scopes: ['OWN', 'ANY'] },
  { key: 'test.read', description: 'Чтение тестов', scopes: ['OWN', 'ASSIGNED', 'COURSE', 'ANY'] },
  { key: 'test.create', description: 'Создание теста', scopes: ['OWN'] },
  { key: 'test.update', description: 'Редактирование черновика, новая версия теста', scopes: ['OWN', 'ANY'] },
  { key: 'test.random_selection', description: 'Правила случайного отбора', scopes: ['OWN', 'ANY'] },
  { key: 'test.submit', description: 'Отправка теста на экспертизу', scopes: ['OWN'] },
  { key: 'test.archive', description: 'Архивирование теста', scopes: ['OWN', 'ANY'] },
  { key: 'test.publish', description: 'Публикация теста', scopes: ['ANY'] },
  { key: 'test.withdraw', description: 'Отзыв публикации', scopes: ['ANY'] },
  { key: 'review.read', description: 'Чтение экспертиз', scopes: ['OWN', 'ASSIGNED', 'COURSE', 'ANY'] },
  { key: 'review.assign', description: 'Назначение экспертов', scopes: ['ASSIGNED', 'COURSE', 'ANY'] },
  { key: 'review.perform', description: 'Проведение экспертизы и решения', scopes: ['ASSIGNED'] },
  { key: 'review.comment', description: 'Комментарии в экспертизе', scopes: ['OWN', 'ASSIGNED'] },
  { key: 'checklist.manage', description: 'Шаблоны checklist', scopes: ['ANY'] },
  { key: 'audit.read', description: 'Журнал аудита', scopes: ['ANY'] },
] as const satisfies readonly PermissionDef[]

export type PermissionKey = (typeof PERMISSIONS)[number]['key']

export const PERMISSION_KEYS: ReadonlySet<string> = new Set(PERMISSIONS.map((p) => p.key))

export function permissionDef(key: string): PermissionDef | undefined {
  return PERMISSIONS.find((p) => p.key === key)
}
