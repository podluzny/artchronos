import { describe, expect, it } from 'vitest'
import { createAuditUseCases } from '../../src/application/audit/use-cases.js'
import { createTestUseCases } from '../../src/application/assessment/test-use-cases.js'
import { createEducationUseCases } from '../../src/application/education/use-cases.js'
import { createIdentityUseCases } from '../../src/application/identity/use-cases.js'
import { createItemUseCases } from '../../src/application/itembank/item-use-cases.js'
import { createQtypeUseCases } from '../../src/application/itembank/qtype-use-cases.js'
import { createMediaUseCases } from '../../src/application/media/use-cases.js'
import { PERMISSION_KEYS } from '../../src/domain/identity/permission-catalog.js'

const stub = new Proxy({}, { get: () => stub }) as any

/** Все фабрики use cases приложения. Новая фабрика обязана быть добавлена сюда. */
export const USE_CASE_FACTORIES = {
  identity: () => createIdentityUseCases({ uow: stub, hasher: stub, tokens: stub, clock: stub }),
  audit: () => createAuditUseCases({ uow: stub }),
  education: () => createEducationUseCases({ uow: stub, clock: stub }),
  media: () => createMediaUseCases({ uow: stub, storage: stub, processor: stub, clock: stub }),
  qtypes: () => createQtypeUseCases({ uow: stub, registry: stub }),
  items: () => createItemUseCases({ uow: stub, registry: stub, clock: stub }),
  tests: () => createTestUseCases({ uow: stub, clock: stub, items: stub }),
}

describe('AT-AUTH-003.8: каждый use case декларирует permission', () => {
  for (const [module, factory] of Object.entries(USE_CASE_FACTORIES)) {
    it(module, () => {
      const ucs = Object.entries(factory()).filter(([, v]) => v && typeof v === 'object' && 'run' in (v as object))
      expect(ucs.length).toBeGreaterThan(0)
      for (const [name, uc] of ucs) {
        const p = (uc as { permission: string }).permission
        expect(p, `${module}.${name}`).toBeTruthy()
        if (p !== 'PUBLIC' && p !== 'AUTHENTICATED')
          expect(PERMISSION_KEYS.has(p), `${module}.${name}: ${p}`).toBe(true)
      }
    })
  }
})
