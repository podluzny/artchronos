/** Scopes модели прав (permission-model §2). */
export const SCOPES = ['OWN', 'ASSIGNED', 'COURSE', 'ANY'] as const
export type Scope = (typeof SCOPES)[number]

export function isScope(v: string): v is Scope {
  return (SCOPES as readonly string[]).includes(v)
}
