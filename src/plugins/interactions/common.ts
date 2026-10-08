import type { Issue, ItemDocument, ItemOptionDoc, OptionRole } from '../../domain/itembank/interaction.js'

export const err = (path: string, code: string, message: string): Issue => ({ path, code, severity: 'ERROR', message })
export const warn = (path: string, code: string, message: string): Issue => ({
  path,
  code,
  severity: 'WARNING',
  message,
})

export function byRole(doc: ItemDocument, role: OptionRole): ItemOptionDoc[] {
  return doc.options.filter((o) => o.role === role).sort((a, b) => a.ordinal - b.ordinal)
}

export function stemIssues(doc: ItemDocument): Issue[] {
  const text = doc.stem.replace(/<[^>]*>/g, '').trim()
  return text ? [] : [err('stem', 'STEM_REQUIRED', 'Заполните формулировку вопроса')]
}

/** Вариант должен иметь текст или изображение, в зависимости от требований типа. */
export function optionContentIssues(
  opts: ItemOptionDoc[],
  media: 'none' | 'optional' | 'required',
  label: string,
): Issue[] {
  const out: Issue[] = []
  opts.forEach((o, i) => {
    const p = `options.${o.key}`
    if (media === 'required' && !o.mediaAssetId)
      out.push(err(p, 'OPTION_MEDIA_REQUIRED', `${label} ${i + 1}: выберите изображение`))
    if (media === 'none' && o.mediaAssetId)
      out.push(err(p, 'OPTION_MEDIA_FORBIDDEN', `${label} ${i + 1}: изображения в этом типе не используются`))
    if (!o.text?.trim() && !o.mediaAssetId)
      out.push(err(p, 'OPTION_EMPTY', `${label} ${i + 1}: заполните текст или выберите изображение`))
  })
  const texts = opts.map((o) => o.text?.trim().toLowerCase()).filter(Boolean)
  if (new Set(texts).size !== texts.length)
    out.push(warn('options', 'OPTION_DUPLICATE', `Есть одинаковые ${label.toLowerCase()}ы`))
  const keys = opts.map((o) => o.key)
  if (new Set(keys).size !== keys.length)
    out.push(err('options', 'OPTION_KEY_DUPLICATE', 'Ключи вариантов должны быть уникальны'))
  return out
}

export function stimulusIssues(doc: ItemDocument, stimulus: 'none' | 'optional' | 'required'): Issue[] {
  const has = doc.media.some((m) => m.role === 'STIMULUS')
  if (stimulus === 'required' && !has)
    return [err('media', 'STIMULUS_REQUIRED', 'Добавьте изображение-стимул (произведение для атрибуции)')]
  if (stimulus === 'none' && has) return [err('media', 'STIMULUS_FORBIDDEN', 'Стимул в этом типе не используется')]
  return []
}

export function stringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

export function round(n: number): number {
  return Math.round(n * 10000) / 10000
}

export const keyArraySchema = { type: 'array', items: { type: 'string', minLength: 1 } } as const
