/**
 * Структурированные логи (NFR-OBS-001): одна JSON-строка на событие, с requestId и userId.
 * Значения полей, похожих на секреты, маскируются; персональные данные (email, IP) в лог не пишутся.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
const ORDER: Record<LogLevel | 'silent', number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 }
const SECRET = /pass(word)?|token|secret|cookie|authorization|session(id)?|answerkey/i
const PERSONAL = /^(email|ip|useragent|user_agent|displayname)$/i

export function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[…]'
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => sanitize(v, depth + 1))
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      if (SECRET.test(k)) out[k] = '[REDACTED]'
      else if (PERSONAL.test(k)) out[k] = '[PII]'
      else out[k] = sanitize(v, depth + 1)
    }
    return out
  }
  if (typeof value === 'string' && value.length > 500) return `${value.slice(0, 500)}…`
  return value
}

export type LogSink = (line: string) => void
let sink: LogSink = (line) => process.stdout.write(`${line}\n`)

/** Подмена приемника (тесты, внешний сборщик логов). */
export function setLogSink(s: LogSink): LogSink {
  const prev = sink
  sink = s
  return prev
}

export function log(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
  const min = (process.env.LOG_LEVEL ?? 'info') as LogLevel | 'silent'
  if (ORDER[level] < (ORDER[min] ?? ORDER.info)) return
  sink(JSON.stringify({ ts: new Date().toISOString(), level, event, ...(sanitize(fields) as object) }))
}
