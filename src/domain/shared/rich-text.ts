/** Санитизация rich text формулировки (NFR-SEC-007): разрешен минимальный набор тегов без атрибутов. */
export function sanitizeRichText(html: string): string {
  const allowed = new Set(['b', 'strong', 'i', 'em', 'u', 'p', 'br', 'ul', 'ol', 'li', 'sub', 'sup'])
  return (
    html
      .replace(/<\s*(script|style|iframe|object|embed)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
      .replace(/<\/?([a-zA-Z0-9]+)(\s[^>]*)?>/g, (m, tag: string) => {
        const t = tag.toLowerCase()
        if (!allowed.has(t)) return ''
        return m.startsWith('</') ? `</${t}>` : `<${t}>`
      })
      // всё, что осталось от разметки (например, незакрытый «<img onerror=…»), выводится как текст
      .replace(/<(?!\/?(?:b|strong|i|em|u|p|br|ul|ol|li|sub|sup)>)/gi, '&lt;')
  )
}
