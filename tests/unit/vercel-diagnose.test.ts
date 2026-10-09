import { describe, expect, it } from 'vitest'
import { diagnose } from '../../src/server/vercel.js'

describe('диагностика запуска на Vercel (без раскрытия секретов)', () => {
  it('называет недостающую переменную и найденные переменные БД', () => {
    const m = diagnose(new Error('DATABASE_URL не задан'), { POSTGRES_URL: 'postgres://u:secret@h/db' })
    expect(m).toMatch(/DATABASE_URL/)
    expect(m).toMatch(/POSTGRES_URL/)
    expect(m).not.toMatch(/secret/)
  })
  it('короткий SESSION_SECRET — длина, но не значение', () => {
    const m = diagnose(new Error('SESSION_SECRET должен быть не короче 32 символов'), { SESSION_SECRET: 'abc' })
    expect(m).toMatch(/сейчас: 3/)
    expect(m).not.toContain('abc')
  })
  it('нет таблиц — миграции не применены', () => {
    expect(diagnose(Object.assign(new Error('relation "question_types" does not exist'), { code: '42P01' }))).toMatch(
      /миграции/,
    )
  })
  it('строка подключения в сообщении маскируется', () => {
    expect(diagnose(new Error('fail postgresql://u:pw@host/db x'))).not.toMatch(/pw@/)
  })
})
