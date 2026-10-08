import type { Scope } from '../authorization/scope.js'
import type { PermissionKey } from './permission-catalog.js'
import { PERMISSIONS } from './permission-catalog.js'

/** Системные роли и их состав по умолчанию (docs/permission-model.md §4). */
export type SystemRoleCode = 'ADMIN' | 'TEACHER' | 'EXPERT' | 'STUDENT'

export interface RoleGrant {
  key: PermissionKey
  scopes: Scope[]
}

const g = (key: PermissionKey, ...scopes: Scope[]): RoleGrant => ({ key, scopes })

const STUDENT: RoleGrant[] = [
  g('user.update', 'OWN'),
  g('taxonomy.read', 'COURSE'),
  g('assignment.read', 'ASSIGNED'),
  g('media.read', 'ANY'),
  g('media.upload', 'ANY'),
  g('media.update', 'OWN'),
  g('media.archive', 'OWN'),
  g('qtype.read', 'ANY'),
  g('item.read', 'OWN'),
  g('item.create', 'OWN'),
  g('item.update', 'OWN'),
  g('item.submit', 'OWN'),
  g('item.archive', 'OWN'),
  g('test.read', 'OWN'),
  g('test.create', 'OWN'),
  g('test.update', 'OWN'),
  g('test.submit', 'OWN'),
  g('test.archive', 'OWN'),
  g('review.read', 'OWN'),
  g('review.comment', 'OWN'),
]

const TEACHER: RoleGrant[] = [
  g('user.read', 'COURSE'),
  g('user.update', 'OWN'),
  g('taxonomy.read', 'COURSE'),
  g('taxonomy.manage', 'COURSE'),
  g('group.read', 'COURSE'),
  g('group.manage', 'COURSE'),
  g('assignment.read', 'COURSE'),
  g('assignment.create', 'COURSE'),
  g('assignment.update', 'OWN', 'COURSE'),
  g('media.read', 'ANY'),
  g('media.upload', 'ANY'),
  g('media.update', 'ANY'),
  g('media.archive', 'OWN'),
  g('media.rights.manage', 'ANY'),
  g('qtype.read', 'ANY'),
  g('item.read', 'OWN', 'ASSIGNED', 'COURSE'),
  g('item.create', 'OWN'),
  g('item.update', 'OWN'),
  g('item.submit', 'OWN'),
  g('item.archive', 'OWN'),
  g('test.read', 'OWN', 'ASSIGNED', 'COURSE'),
  g('test.create', 'OWN'),
  g('test.update', 'OWN'),
  g('test.random_selection', 'OWN'),
  g('test.submit', 'OWN'),
  g('test.archive', 'OWN'),
  g('review.read', 'OWN', 'ASSIGNED', 'COURSE'),
  g('review.assign', 'ASSIGNED', 'COURSE'),
  g('review.perform', 'ASSIGNED'),
  g('review.comment', 'OWN', 'ASSIGNED'),
]

const EXPERT: RoleGrant[] = [
  g('user.update', 'OWN'),
  g('taxonomy.read', 'ANY'),
  g('media.read', 'ANY'),
  g('qtype.read', 'ANY'),
  g('item.read', 'ASSIGNED'),
  g('test.read', 'ASSIGNED'),
  g('review.read', 'ASSIGNED'),
  g('review.perform', 'ASSIGNED'),
  g('review.comment', 'ASSIGNED'),
]

/** Admin: каждое permission с максимальным поддерживаемым scope; review.perform — только ASSIGNED (самоназначение). */
const ADMIN: RoleGrant[] = PERMISSIONS.map((p) => {
  const all: readonly Scope[] = p.scopes
  const scopes: Scope[] = all.includes('ANY') ? ['ANY'] : [...all]
  return { key: p.key, scopes }
})

export const SYSTEM_ROLES: Record<SystemRoleCode, { name: string; description: string; grants: RoleGrant[] }> = {
  ADMIN: { name: 'Администратор', description: 'Полный доступ в пределах бизнес-правил', grants: ADMIN },
  TEACHER: { name: 'Преподаватель', description: 'Курсы, задания, экспертиза, банк вопросов', grants: TEACHER },
  EXPERT: { name: 'Эксперт', description: 'Экспертиза назначенного контента', grants: EXPERT },
  STUDENT: { name: 'Студент', description: 'Вопросы и тесты в рамках заданий', grants: STUDENT },
}
