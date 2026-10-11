import { describe, expect, it } from 'vitest'
import {
  collectAnchors,
  normalizeAnchors,
  renderAnchorsHtml,
  stripAnchors,
  type ResolvableEntry,
} from '../../src/domain/knowledge/anchors.js'
import { slugify, validateLinks, validateSlug } from '../../src/domain/knowledge/knowledge.js'
import { sanitizeRichText } from '../../src/domain/shared/rich-text.js'

const E = (kind: ResolvableEntry['kind'], slug: string, name: string, status: 'ACTIVE' | 'ARCHIVED' = 'ACTIVE') => ({
  id: `${kind}-${slug}`,
  kind,
  slug,
  name,
  status,
})
const entries: ResolvableEntry[] = [
  E('PERSON', 'kuindzhi', 'Архип Куинджи'),
  E('MOVEMENT', 'передвижники', 'Передвижники'),
  E('TERM', 'impressionism', 'Импрессионизм'),
  E('MOVEMENT', 'impressionism', 'Импрессионизм (направление)'),
  E('TERM', 'old', 'Устаревший', 'ARCHIVED'),
]
const norm = (t: string, allow?: Set<string>) => normalizeAnchors(t, entries, 'f', allow)

describe('SPEC-KB-002 якоря в тексте (домен)', () => {
  it('AT-KB-002.1 @slug нормализуется в [Название](@kind:slug)', () => {
    const r = norm('Картина @kuindzhi.')
    expect(r.errors).toEqual([])
    expect(r.text).toBe('Картина [Архип Куинджи](@person:kuindzhi).')
    expect(r.entryIds).toEqual(['PERSON-kuindzhi'])
  })

  it('AT-KB-002.2 подпись и вид сохраняются; нормализация идемпотентна; кириллический slug', () => {
    const r = norm('Стиль [передвижников](@передвижники) и @term:impressionism')
    expect(r.errors).toEqual([])
    expect(r.text).toBe('Стиль [передвижников](@movement:передвижники) и [Импрессионизм](@term:impressionism)')
    expect(norm(r.text).text).toBe(r.text)
  })

  it('AT-KB-002.3 неизвестный, неоднозначный slug, неизвестный вид, архивный объект — ошибки поля', () => {
    expect(norm('@nobody').errors[0]!.message).toMatch(/Не найден/)
    const amb = norm('@impressionism').errors[0]!
    expect(amb.field).toBe('f')
    expect(amb.message).toMatch(
      /@term:impressionism.*@movement:impressionism|@movement:impressionism.*@term:impressionism/,
    )
    expect(norm('@foo:kuindzhi').errors[0]!.message).toMatch(/неизвестный вид/)
    expect(norm('@old').errors[0]!.message).toMatch(/BR-049/)
    expect(norm('@old', new Set(['TERM-old'])).errors).toEqual([])
  })

  it('AT-KB-002.4 \\@, e-mail и @ внутри слова не являются якорями', () => {
    const t = 'Пишите на user@mail.ru, \\@kuindzhi — не ссылка, a@kuindzhi тоже'
    expect(collectAnchors(t)).toEqual([])
    const r = norm(t)
    expect(r.errors).toEqual([])
    expect(r.text).toBe(t)
    expect(stripAnchors(r.text)).toContain('@kuindzhi — не ссылка')
  })

  it('AT-KB-002.5 рендер после санитизации — span.kb-ref; для студента только подпись', () => {
    const stored = norm('<p>Автор — [Куинджи](@kuindzhi)</p>').text
    const html = renderAnchorsHtml(sanitizeRichText(stored))
    expect(html).toContain('<span class="kb-ref"')
    expect(html).toContain('title="Автор: kuindzhi">Куинджи</span>')
    expect(stripAnchors(stored)).toBe('<p>Автор — Куинджи</p>')
  })

  it('AT-KB-002.6 XSS-полезные нагрузки не порождают разметку', () => {
    const payloads = [
      '[<img src=x onerror=alert(1)>](@kuindzhi)',
      '[x" onmouseover="alert(1)](@kuindzhi)',
      '@kuindzhi"><script>alert(1)</script>',
      '[a](@person:kuindzhi"onclick=1)',
    ]
    for (const p of payloads) {
      const stored = norm(p).text
      const html = renderAnchorsHtml(sanitizeRichText(stored))
      expect(html).not.toMatch(/<(img|script)/i)
      // каждый тег — из allow-list санитайзера или span якоря без иных атрибутов
      for (const tag of html.match(/<[^>]*>/g) ?? [])
        expect(tag).toMatch(
          /^<\/?(p|b|strong|i|em|u|br|ul|ol|li|sub|sup|span)>$|^<span class="kb-ref" style="[^"<>]*" title="[^"<>]*">$/,
        )
    }
    // подпись с кавычкой остается текстом внутри span, атрибуты span — только class/style/title
    const q = renderAnchorsHtml(sanitizeRichText(norm('[x" onmouseover="alert(1)](@kuindzhi)').text))
    expect(q).toMatch(/<span class="kb-ref" style="[^"]*" title="[^"]*">x" onmouseover="alert\(1\)<\/span>/)
  })

  it('slug: генерация из названия и правила', () => {
    expect(slugify('Архип Иванович Куинджи')).toBe('архип-иванович-куинджи')
    expect(slugify('Ёлки, палки!')).toBe('елки-палки')
    expect(validateSlug('kuindzhi')).toBeNull()
    expect(validateSlug('-bad')).not.toBeNull()
    expect(validateSlug('two words')).not.toBeNull()
  })

  it('связи: вид цели, кратность, архив и ссылка на себя', () => {
    const t = new Map([
      ['p1', { kind: 'PERSON' as const, status: 'ACTIVE' as const, name: 'Автор' }],
      ['c1', { kind: 'COLLECTION' as const, status: 'ACTIVE' as const, name: 'ГТГ' }],
      ['c2', { kind: 'COLLECTION' as const, status: 'ARCHIVED' as const, name: 'Старое' }],
    ])
    expect(validateLinks('ARTWORK', 'a1', { AUTHOR: ['p1'], COLLECTION: ['c1'] }, t)).toEqual([])
    expect(validateLinks('ARTWORK', 'a1', { AUTHOR: ['c1'] }, t)[0]!.message).toMatch(/Автор/)
    expect(validateLinks('ARTWORK', 'a1', { COLLECTION: ['c1', 'c2'] }, t).length).toBeGreaterThan(0)
    expect(validateLinks('ARTWORK', 'a1', { COLLECTION: ['c2'] }, t, new Set(['COLLECTION:c2']))).toEqual([])
    expect(validateLinks('TERM', 't1', { SEE_ALSO: ['t1'] }, t)[0]!.message).toMatch(/себя/)
    expect(validateLinks('TERM', 't1', { AUTHOR: ['p1'] }, t)[0]!.message).toMatch(/Недопустимая/)
  })
})
