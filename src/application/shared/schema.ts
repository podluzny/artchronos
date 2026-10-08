import { Ajv, type ErrorObject } from 'ajv'

/** Структурная валидация JSON Schema (draft-07 совместимые схемы плагинов). */
const ajv = new Ajv({ allErrors: true, strict: false })
const cache = new WeakMap<object, ReturnType<typeof ajv.compile>>()

export function schemaErrors(
  schema: Record<string, unknown>,
  data: unknown,
  prefix = '',
): { field: string; message: string }[] {
  let validate = cache.get(schema)
  if (!validate) {
    validate = ajv.compile(schema)
    cache.set(schema, validate)
  }
  if (validate(data)) return []
  return (validate.errors ?? []).map((e: ErrorObject) => ({
    field: `${prefix}${e.instancePath.replace(/^\//, '').replace(/\//g, '.')}` || prefix.replace(/\.$/, '') || 'form',
    message: `${e.instancePath || 'значение'} ${e.message ?? 'некорректно'}`,
  }))
}
