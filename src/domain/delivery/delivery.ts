import { seededShuffle, type ItemDocument } from '../itembank/interaction.js'
import { DomainError } from '../shared/errors.js'
import { sanitizeRichText } from '../shared/rich-text.js'
import type { VersionState } from '../versioning/state-machine.js'

/**
 * Модель прохождения (SPEC-DELIV-001, BL-12). В MVP — только модель и прототип без UI: доказательство, что
 * контент MVP позволяет построить Runner и аналитику без миграции данных.
 */
export interface DeliveredItem {
  sectionIndex: number
  itemVersionId: string
  points: number
  /** Порядок вариантов по ключам (INV-008: ключи стабильны между версиями). */
  optionOrder: string[]
}

export interface DeliveryStructure {
  sections: { id: string; ordinal: number; shuffleItems: boolean | null }[]
  fixed: { sectionId: string; itemVersionId: string; points: number; ordinal: number }[]
  rules: { sectionId: string; count: number; pointsPerItem: number; pool: string[] }[]
  settings: { shuffleSections: boolean; shuffleItems: boolean; shuffleOptions: boolean }
}

/** BR-037: попытка начинается только по опубликованной версии. */
export function assertDeliverable(state: VersionState): void {
  if (state !== 'PUBLISHED') throw DomainError.rule('BR-037', 'Попытка возможна только по опубликованной версии теста')
}

export function assertAttemptAllowed(previousAttempts: number, maxAttempts: number | null): number {
  const next = previousAttempts + 1
  if (maxAttempts !== null && next > maxAttempts) throw DomainError.rule('BR-037', 'Исчерпано число попыток')
  return next
}

/** Детерминированная выборка и порядок по seed (AC-DELIV-001.3). */
export function buildDelivery(s: DeliveryStructure, seed: number, docs: Map<string, ItemDocument>): DeliveredItem[] {
  const sections = s.settings.shuffleSections
    ? seededShuffle(s.sections, seed)
    : [...s.sections].sort((a, b) => a.ordinal - b.ordinal)
  const out: DeliveredItem[] = []
  sections.forEach((sec, sectionIndex) => {
    const entries: { itemVersionId: string; points: number }[] = s.fixed
      .filter((f) => f.sectionId === sec.id)
      .sort((a, b) => a.ordinal - b.ordinal)
      .map((f) => ({ itemVersionId: f.itemVersionId, points: f.points }))
    s.rules
      .filter((r) => r.sectionId === sec.id)
      .forEach((r, ri) => {
        for (const iv of seededShuffle(r.pool, seed * 31 + ri + sec.ordinal).slice(0, r.count))
          entries.push({ itemVersionId: iv, points: r.pointsPerItem })
      })
    const shuffle = sec.shuffleItems ?? s.settings.shuffleItems
    for (const e of shuffle ? seededShuffle(entries, seed + 7 + sec.ordinal) : entries) {
      const doc = docs.get(e.itemVersionId)
      if (!doc) throw new Error(`Нет содержимого версии ${e.itemVersionId}`)
      out.push({ sectionIndex, ...e, optionOrder: optionOrder(doc, seed, s.settings.shuffleOptions) })
    }
  })
  return out
}

function optionOrder(doc: ItemDocument, seed: number, shuffleOptions: boolean): string[] {
  const roles = [...new Set(doc.options.map((o) => o.role))]
  return roles.flatMap((role) => {
    const list = doc.options.filter((o) => o.role === role).sort((a, b) => a.ordinal - b.ordinal)
    const typeAllows = doc.content.shuffleOptions === true || doc.content.shuffleResponses === true
    const doShuffle =
      role === 'SEQUENCE_ELEMENT' || (shuffleOptions && typeAllows && (role === 'OPTION' || role === 'RESPONSE'))
    return (doShuffle ? seededShuffle(list, seed + role.length) : list).map((o) => o.key)
  })
}

/** Представление вопроса для студента (NFR-SEC-008): без answerKey и пояснений. */
export function deliveryView(doc: ItemDocument, item: DeliveredItem) {
  const byKey = new Map(doc.options.map((o) => [o.key, o]))
  return {
    itemVersionId: item.itemVersionId,
    points: item.points,
    stem: sanitizeRichText(doc.stem),
    content: Object.fromEntries(Object.entries(doc.content).filter(([k]) => k !== 'rubric')),
    media: doc.media.map((m) => ({ mediaAssetId: m.mediaAssetId, role: m.role, altText: m.altTextOverride })),
    options: item.optionOrder.map((k) => {
      const o = byKey.get(k)!
      return { key: o.key, role: o.role, text: o.text, mediaAssetId: o.mediaAssetId, altText: o.altTextOverride }
    }),
  }
}

/** Итог: Σ (score / maxScore вопроса) × points; MANUAL-оценки ожидают проверки. */
export function computeResult(evals: { score: number | null; maxScore: number; points: number }[]) {
  let score = 0
  let pendingManual = 0
  for (const e of evals) {
    if (e.score === null) pendingManual += 1
    else score += e.maxScore > 0 ? (e.score / e.maxScore) * e.points : 0
  }
  const maxScore = evals.reduce((a, e) => a + e.points, 0)
  return { score: Math.round(score * 100) / 100, maxScore, pendingManual }
}
