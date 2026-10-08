import { describe, expect, it } from 'vitest'
import { Actor, requirePermission, requireScope, scopeFilter } from '../../src/domain/authorization/actor.js'
import type { Scope } from '../../src/domain/authorization/scope.js'
import { validatePassword } from '../../src/domain/identity/password-policy.js'
import { PERMISSIONS } from '../../src/domain/identity/permission-catalog.js'
import { SYSTEM_ROLES } from '../../src/domain/identity/system-roles.js'
import {
  assertAdminRemains,
  assertNotSelf,
  canAuthenticate,
  nextUserStatus,
} from '../../src/domain/identity/user-rules.js'
import { diff } from '../../src/application/shared/audit.js'
import { validateGrants } from '../../src/application/identity/use-cases.js'
import { DomainError } from '../../src/domain/shared/errors.js'

function actor(grants: Record<string, Scope[]>, extra: Partial<{ status: any; mustChangePassword: boolean }> = {}) {
  return new Actor({
    userId: 'u1',
    email: 'a@b.c',
    displayName: 'A',
    status: extra.status ?? 'ACTIVE',
    roleCodes: [],
    mustChangePassword: extra.mustChangePassword ?? false,
    grants: new Map(Object.entries(grants).map(([k, v]) => [k, new Set(v)])),
  })
}

describe('Actor и scope (SPEC-AUTH-003)', () => {
  it('нет permission → FORBIDDEN', () => {
    expect(() => requirePermission(actor({}), 'user.read')).toThrowError(DomainError)
  })
  it('ANY покрывает любой объект', () => {
    expect(requireScope(actor({ 'item.read': ['ANY'] }), 'item.read', new Set())).toBe('ANY')
  })
  it('OWN разрешает только свой объект; чужой при чтении маскируется как 404 (AT-AUTH-003.4)', () => {
    const a = actor({ 'item.read': ['OWN'] })
    expect(requireScope(a, 'item.read', new Set(['OWN']))).toBe('OWN')
    try {
      requireScope(a, 'item.read', new Set(), 'read')
      expect.unreachable()
    } catch (e) {
      expect((e as DomainError).code).toBe('NOT_FOUND')
    }
    expect(() => requireScope(a, 'item.read', new Set(), 'write')).toThrow(/Недостаточно прав/)
  })
  it('неактивный пользователь не имеет прав (BR-014)', () => {
    expect(actor({ 'user.read': ['ANY'] }, { status: 'BLOCKED' }).has('user.read')).toBe(false)
  })
  it('mustChangePassword блокирует все permissions (AT-AUTH-001.7)', () => {
    const a = actor({ 'user.read': ['ANY'] }, { mustChangePassword: true })
    expect(() => requirePermission(a, 'user.read')).toThrow(/сменить пароль/)
  })
  it('scopeFilter: ANY или набор scopes', () => {
    expect(scopeFilter(actor({ 'item.read': ['ANY', 'OWN'] }), 'item.read')).toEqual({ kind: 'ANY' })
    const f = scopeFilter(actor({ 'item.read': ['OWN', 'COURSE'] }), 'item.read')
    expect(f.kind).toBe('SCOPED')
  })
})

describe('Каталог прав и системные роли (T-035)', () => {
  it('все grants системных ролей ссылаются на существующие permissions с поддерживаемым scope', () => {
    for (const [code, role] of Object.entries(SYSTEM_ROLES)) {
      for (const g of role.grants) {
        const def = PERMISSIONS.find((p) => p.key === g.key)
        expect(def, `${code}: ${g.key}`).toBeDefined()
        for (const s of g.scopes)
          expect((def!.scopes as readonly string[]).includes(s), `${code}: ${g.key}:${s}`).toBe(true)
      }
    }
  })
  it('студент не может approve и управлять пользователями (permission-model §4)', () => {
    const keys = SYSTEM_ROLES.STUDENT.grants.map((g) => g.key)
    expect(keys).not.toContain('review.perform')
    expect(keys.some((k) => k.startsWith('user.') && k !== 'user.update')).toBe(false)
  })
  it('эксперт не может менять пользователей (AT-PERM-003)', () => {
    const keys = SYSTEM_ROLES.EXPERT.grants.map((g) => g.key)
    expect(keys.filter((k) => k.startsWith('user.') || k.startsWith('role.'))).toEqual(['user.update'])
    expect(SYSTEM_ROLES.EXPERT.grants.find((g) => g.key === 'user.update')!.scopes).toEqual(['OWN'])
  })
  it('review.perform у администратора только ASSIGNED (самоназначение, Q-016)', () => {
    expect(SYSTEM_ROLES.ADMIN.grants.find((g) => g.key === 'review.perform')!.scopes).toEqual(['ASSIGNED'])
  })
})

describe('Пароли (NFR-SEC-002)', () => {
  it('короткий, частый, совпадающий с email — отклоняются', () => {
    expect(validatePassword('short')).not.toHaveLength(0)
    expect(validatePassword('password1234')).not.toHaveLength(0)
    expect(validatePassword('aaaaaaaaaaaaaaa')).not.toHaveLength(0)
    expect(validatePassword('someone@mail.ru', 'someone@mail.ru')).not.toHaveLength(0)
  })
  it('надежный пароль принимается', () => {
    expect(validatePassword('Correct-Horse-Battery-9', 'x@y.z')).toEqual([])
  })
})

describe('Правила пользователей', () => {
  it('BR-014: входить может только ACTIVE', () => {
    expect(canAuthenticate('ACTIVE')).toBe(true)
    for (const s of ['INVITED', 'BLOCKED', 'ARCHIVED'] as const) expect(canAuthenticate(s)).toBe(false)
  })
  it('BR-015: нельзя действовать над собой', () => {
    expect(() => assertNotSelf('a', 'a', 'x')).toThrow(/BR-015|самому/)
    expect(() => assertNotSelf('a', 'b', 'x')).not.toThrow()
  })
  it('BR-016: без администраторов нельзя', () => {
    expect(() => assertAdminRemains(0)).toThrow()
    expect(() => assertAdminRemains(1)).not.toThrow()
  })
  it('переходы статуса', () => {
    expect(nextUserStatus('block', 'ACTIVE')).toBe('BLOCKED')
    expect(nextUserStatus('unblock', 'BLOCKED')).toBe('ACTIVE')
    expect(nextUserStatus('restore', 'ARCHIVED')).toBe('BLOCKED')
    expect(() => nextUserStatus('unblock', 'ACTIVE')).toThrow()
  })
})

describe('Grants и аудит', () => {
  it('AT-USER-002.5 неподдерживаемый scope отклоняется', () => {
    expect(() => validateGrants([{ key: 'user.create', scope: 'OWN' }])).toThrow()
    expect(() => validateGrants([{ key: 'no.such', scope: 'ANY' }])).toThrow()
    expect(validateGrants([{ key: 'user.read', scope: 'COURSE' }])).toEqual([{ key: 'user.read', scope: 'COURSE' }])
  })
  it('AT-AUDIT-001.5 секреты в диффе маскируются', () => {
    expect(diff({ password: 'a' }, { password: 'b' })).toEqual({ password: { from: '***', to: '***' } })
    expect(diff({ a: 1, b: 2 }, { a: 1, b: 3 })).toEqual({ b: { from: 2, to: 3 } })
  })
})
