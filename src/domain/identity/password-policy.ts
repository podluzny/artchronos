import type { FieldError } from '../shared/errors.js'

/** NFR-SEC-002: ≥ 12 символов, не из списка частых, не совпадает с email. */
export const PASSWORD_MIN_LENGTH = 12
export const PASSWORD_MAX_LENGTH = 1024

const COMMON = new Set([
  '123456789012',
  'qwertyuiopas',
  'password1234',
  'passwordpassword',
  'qwerty123456',
  '111111111111',
  'adminadmin12',
  'administrator',
  'iloveyou1234',
  'letmein12345',
  'йцукенгшщзхъ',
  'пароль123456',
])

export function validatePassword(password: string, email?: string): FieldError[] {
  const errors: FieldError[] = []
  if (password.length < PASSWORD_MIN_LENGTH) {
    errors.push({ field: 'password', message: `Пароль должен содержать не менее ${PASSWORD_MIN_LENGTH} символов` })
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    errors.push({ field: 'password', message: 'Пароль слишком длинный' })
  }
  const lower = password.toLowerCase()
  if (COMMON.has(lower) || /^(.)\1+$/.test(password)) {
    errors.push({ field: 'password', message: 'Пароль слишком простой' })
  }
  if (email && lower === email.toLowerCase()) {
    errors.push({ field: 'password', message: 'Пароль не должен совпадать с email' })
  }
  return errors
}
