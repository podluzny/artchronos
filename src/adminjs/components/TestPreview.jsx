import React, { useEffect, useState } from 'react'
import { Box, Button, H3, H5, Input, Label, Loader, MessageBox, Text } from '@adminjs/design-system'
import { ApiClient } from 'adminjs'

const api = new ApiClient()
const card = { border: '1px solid rgba(127,127,127,0.3)', borderRadius: 6, padding: 12, marginBottom: 10 }

const Option = ({ o }) => (
  <li style={{ marginBottom: 4 }}>
    {o.text}
    {o.mediaAssetId ? (
      <img
        src={`/admin/media-file/${o.mediaAssetId}/thumb`}
        alt={o.altTextOverride || o.text || 'изображение'}
        style={{ maxWidth: 160, maxHeight: 110, borderRadius: 4, display: 'block', marginTop: 4 }}
      />
    ) : null}
  </li>
)

/** Предпросмотр теста — «виртуальная попытка» по seed (SPEC-TEST-003). Ничего не сохраняется. */
const TestPreview = (props) => {
  const { record, resource, action } = props
  const [seed, setSeed] = useState('1')
  const [p, setP] = useState(null)
  const [error, setError] = useState(null)

  const load = async (s) => {
    const res = await api.recordAction({
      resourceId: resource.id,
      recordId: record.id,
      actionName: action.name,
      method: 'post',
      data: { op: 'preview', testId: record.id, seed: s },
    })
    const r = res.data || {}
    if (!r.ok) return setError(r.message)
    setError(null)
    setP(r.preview)
  }
  useEffect(() => {
    load(seed)
  }, [])

  if (error && !p) return <MessageBox variant="danger" message={error} />
  if (!p) return <Loader />
  let n = 0
  return (
    <Box variant="container">
      <H3>
        {p.title} · v{p.versionNo} — предпросмотр
      </H3>
      <Box flex alignItems="flex-end" mb="lg" style={{ gap: 10 }}>
        <Box style={{ width: 140 }}>
          <Label htmlFor="seed">Seed</Label>
          <Input id="seed" width={1} value={seed} onChange={(e) => setSeed(e.target.value)} />
        </Box>
        <Button type="button" onClick={() => load(seed)}>
          Показать
        </Button>
        <Text mb="sm">
          Макс. балл: {p.maxScore}
          {p.settings.timeLimitSec ? ` · лимит ${Math.round(p.settings.timeLimitSec / 60)} мин` : ''} · навигация:{' '}
          {p.settings.navigation === 'LINEAR' ? 'линейная' : 'свободная'}
        </Text>
      </Box>
      {p.warnings.map((w, i) => (
        <MessageBox key={i} variant="warning" message={w} mb="default" />
      ))}
      {p.sections.map((s, si) => (
        <Box key={si} mb="xl">
          <H5>{s.title}</H5>
          {s.items.map((it) => {
            n += 1
            return (
              <Box key={it.itemVersionId} style={card} data-testid="preview-item">
                <Text variant="sm">
                  Вопрос {n} · {it.points} б. · {it.preview.typeName}
                  {it.source === 'RULE' ? ' · случайный отбор' : ''}
                </Text>
                {it.preview.media
                  .filter((m) => m.role === 'STIMULUS')
                  .map((m) => (
                    <img
                      key={m.mediaAssetId}
                      src={`/admin/media-file/${m.mediaAssetId}/preview`}
                      alt={m.altTextOverride || 'стимул'}
                      style={{ maxWidth: 360, borderRadius: 4 }}
                    />
                  ))}
                <Box my="default" dangerouslySetInnerHTML={{ __html: it.preview.stem }} />
                <ol style={{ margin: 0, paddingLeft: 20 }}>
                  {it.preview.options.map((o) => (
                    <Option key={o.key} o={o} />
                  ))}
                </ol>
              </Box>
            )
          })}
        </Box>
      ))}
    </Box>
  )
}

export default TestPreview
