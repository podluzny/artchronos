import type { FieldError } from '../shared/errors.js'

/** Настройки TestVersion (assessment-model §2). */
export interface TestSettings {
  timeLimitSec: number | null
  navigation: 'LINEAR' | 'FREE'
  maxAttempts: number | null
  shuffleSections: boolean
  shuffleItems: boolean
  shuffleOptions: boolean
  feedbackMode: 'NONE' | 'AFTER_SUBMIT' | 'AFTER_CLOSE'
  scoring: { method: 'SUM'; passingScore: number | null }
}

export const DEFAULT_TEST_SETTINGS: TestSettings = {
  timeLimitSec: null,
  navigation: 'FREE',
  maxAttempts: 1,
  shuffleSections: false,
  shuffleItems: false,
  shuffleOptions: true,
  feedbackMode: 'AFTER_SUBMIT',
  scoring: { method: 'SUM', passingScore: null },
}

/** Фильтр правила случайного отбора (domain-model: SelectionRule.filter). */
export interface SelectionFilter {
  topicIds: string[]
  objectiveIds: string[]
  tags: string[]
  questionTypeIds: string[]
  difficultyMin: number | null
  difficultyMax: number | null
}

export interface StructureForScore {
  fixed: { points: number }[]
  rules: { count: number; pointsPerItem: number }[]
}

/** maxScore = Σ points фиксированных + Σ(count × pointsPerItem) правил. */
export function maxScore(s: StructureForScore): number {
  const v = s.fixed.reduce((a, f) => a + f.points, 0) + s.rules.reduce((a, r) => a + r.count * r.pointsPerItem, 0)
  return Math.round(v * 100) / 100
}

/** Число вопросов в попытке: фиксированные + Σcount (BR-032). */
export function itemCount(s: StructureForScore): number {
  return s.fixed.length + s.rules.reduce((a, r) => a + r.count, 0)
}

/** SPEC-TEST-003: валидация настроек. Секционные лимиты не превышают общий. */
export function validateSettings(
  s: TestSettings,
  ctx: { maxScore: number; sectionLimits: (number | null)[] },
): FieldError[] {
  const e: FieldError[] = []
  if (s.timeLimitSec !== null && (s.timeLimitSec < 60 || s.timeLimitSec > 6 * 3600))
    e.push({ field: 'settings.timeLimitSec', message: 'Лимит времени — от 1 минуты до 6 часов' })
  if (s.maxAttempts !== null && (s.maxAttempts < 1 || s.maxAttempts > 20))
    e.push({ field: 'settings.maxAttempts', message: 'Число попыток — от 1 до 20 (или без ограничения)' })
  if (s.scoring.passingScore !== null) {
    if (s.scoring.passingScore < 0) e.push({ field: 'settings.passingScore', message: 'Проходной балл ≥ 0' })
    else if (s.scoring.passingScore > ctx.maxScore)
      e.push({
        field: 'settings.passingScore',
        message: `Проходной балл не может превышать максимальный (${ctx.maxScore})`,
      })
  }
  if (s.timeLimitSec !== null) {
    for (const l of ctx.sectionLimits) {
      if (l !== null && l > s.timeLimitSec) {
        e.push({ field: 'settings.timeLimitSec', message: 'Лимит раздела не может превышать общий лимит теста' })
        break
      }
    }
  }
  return e
}

export function validateSectionLimit(limit: number | null, settings: TestSettings): FieldError[] {
  if (limit === null) return []
  if (limit < 60 || limit > 6 * 3600)
    return [{ field: 'timeLimitSec', message: 'Лимит раздела — от 1 минуты до 6 часов' }]
  if (settings.timeLimitSec !== null && limit > settings.timeLimitSec)
    return [{ field: 'timeLimitSec', message: 'Лимит раздела не может превышать общий лимит теста' }]
  return []
}
