import { collectAnchors, normalizeAnchors } from '../../domain/knowledge/anchors.js'
import { DomainError, type FieldError } from '../../domain/shared/errors.js'
import type { KnowledgeRepository } from './ports.js'

export type TextFields = Record<string, string | null | undefined>

/**
 * Нормализация якорей набора полей одного источника (SPEC-KB-002).
 * Возвращает канонические тексты и ссылки {field, entryId}; ошибки — DomainError.validation с путями полей.
 * allowArchived — объекты, на которые источник уже ссылался (BR-049).
 */
export async function normalizeTexts<T extends TextFields>(
  repo: Pick<KnowledgeRepository, 'findBySlugs'>,
  texts: T,
  allowArchived: ReadonlySet<string> = new Set(),
): Promise<{ texts: T; refs: { field: string; entryId: string }[] }> {
  const anchors = Object.values(texts).flatMap((t) => collectAnchors(t))
  const out = { ...texts }
  if (!anchors.length) return { texts: out, refs: [] }
  const entries = await repo.findBySlugs(anchors.map((a) => a.slug))
  const errors: FieldError[] = []
  const refs: { field: string; entryId: string }[] = []
  for (const [field, text] of Object.entries(texts)) {
    if (!text) continue
    const r = normalizeAnchors(text, entries, field, allowArchived)
    errors.push(...r.errors)
    ;(out as TextFields)[field] = r.text
    for (const id of r.entryIds) refs.push({ field, entryId: id })
  }
  if (errors.length) throw DomainError.validation(errors, 'Ссылки на базу знаний не распознаны')
  return { texts: out, refs }
}
