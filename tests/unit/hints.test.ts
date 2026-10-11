import { describe, expect, it } from 'vitest'
import { HINTS, actionHints, propertyHints } from '../../src/adminjs/hints.js'

describe('подсказки к полям', () => {
  it('actionHints возвращает поля действия без префикса и пропускает пустые', () => {
    const h = actionHints('User', 'new')
    expect(h.email).toBe(HINTS.User!['new.email'])
    expect('tempPassword' in h).toBe(false)
    expect('reason' in h).toBe(false)
  })
  it('propertyHints берет только ключи без точки', () => {
    const h = propertyHints('Subject')
    expect(Object.keys(h).sort()).toEqual(['code', 'name'])
    expect(propertyHints('Unknown')).toEqual({})
  })
  it('подсказки короткие', () => {
    for (const r of Object.values(HINTS)) for (const t of Object.values(r)) expect(t.length).toBeLessThanOrEqual(200)
  })
})
