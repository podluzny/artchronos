/** Контекст запроса для аудита и логов (NFR-AUDIT-002). */
export interface RequestContext {
  requestId: string
  ip: string | null
  userAgent: string | null
  /** id текущей сессии (для отзыва «прочих» сессий). */
  sessionId?: string | null
}

export const SYSTEM_CONTEXT: RequestContext = { requestId: 'system', ip: null, userAgent: null }

export interface Clock {
  now(): Date
}

export const systemClock: Clock = { now: () => new Date() }
