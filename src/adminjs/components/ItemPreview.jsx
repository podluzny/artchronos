import React, { useEffect, useState } from 'react'
import { Box, Button, H3, Label, Loader, MessageBox, Select, Text, TextArea, Input } from '@adminjs/design-system'
import { ApiClient } from 'adminjs'

const api = new ApiClient()
const card = { border: '1px solid rgba(127,127,127,0.3)', borderRadius: 6, padding: 10, marginBottom: 8 }

/** Предпросмотр вопроса «как у студента» и проверка ответа (SPEC-ITEM-003). Ответ не сохраняется. */
const ItemPreview = (props) => {
  const { record, resource, action } = props
  const [seed, setSeed] = useState(1)
  const [p, setP] = useState(null)
  const [error, setError] = useState(null)
  const [answer, setAnswer] = useState({})
  const [result, setResult] = useState(null)

  const call = async (data) => {
    const body = {}
    Object.entries(data).forEach(([k, v]) => (body[k] = typeof v === 'object' && v !== null ? JSON.stringify(v) : v))
    const res = await api.recordAction({
      resourceId: resource.id,
      recordId: record.id,
      actionName: action.name,
      method: 'post',
      data: body,
    })
    return res.data || {}
  }

  const load = async (s) => {
    setResult(null)
    const r = await call({ op: 'preview', itemId: record.id, seed: s })
    if (!r.ok) return setError(r.message)
    setP(r.preview)
    const pv = r.preview
    if (pv.interactionKey === 'order')
      setAnswer({ order: pv.options.filter((o) => o.role === 'SEQUENCE_ELEMENT').map((o) => o.key) })
    else if (pv.interactionKey === 'match') setAnswer({ pairs: [] })
    else if (pv.interactionKey === 'choice') setAnswer({ selected: [] })
    else setAnswer({ text: '' })
  }

  useEffect(() => {
    load(seed)
  }, [])

  const check = async () => {
    const r = await call({ op: 'evaluate', itemId: record.id, response: answer })
    if (!r.ok) return setError(r.message)
    setError(null)
    setResult(r.result)
  }

  if (error && !p) return <MessageBox variant="danger" message={error} />
  if (!p) return <Loader />

  const media = (o) =>
    o.mediaAssetId ? (
      <img
        src={`/admin/media-file/${o.mediaAssetId}/preview`}
        alt={o.altTextOverride || o.text || 'изображение'}
        style={{ maxWidth: 220, maxHeight: 160, borderRadius: 4, display: 'block', marginTop: 6 }}
      />
    ) : null

  const label = (o) => (
    <span>
      {o.text}
      {media(o)}
    </span>
  )

  const body = () => {
    if (p.interactionKey === 'choice') {
      const single = p.config.cardinality === 'single'
      return p.options.map((o) => (
        <label key={o.key} style={{ ...card, display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}>
          <input
            type={single ? 'radio' : 'checkbox'}
            name="answer"
            checked={answer.selected.includes(o.key)}
            onChange={() =>
              setAnswer({
                selected: single
                  ? [o.key]
                  : answer.selected.includes(o.key)
                    ? answer.selected.filter((k) => k !== o.key)
                    : [...answer.selected, o.key],
              })
            }
          />
          {label(o)}
        </label>
      ))
    }
    if (p.interactionKey === 'match') {
      const responses = p.options.filter((o) => o.role === 'RESPONSE')
      const opts = responses.map((r, i) => ({
        value: r.key,
        label: `${String.fromCharCode(1040 + i)}. ${r.text || 'изображение'}`,
      }))
      return p.options
        .filter((o) => o.role === 'PREMISE')
        .map((o) => (
          <Box key={o.key} style={card} flex alignItems="center">
            <Box style={{ flex: 1 }}>{label(o)}</Box>
            <Box style={{ width: 280 }}>
              <Select
                value={opts.find((x) => x.value === (answer.pairs.find(([pk]) => pk === o.key) || [])[1]) || null}
                options={opts}
                onChange={(v) =>
                  setAnswer({
                    pairs: [...answer.pairs.filter(([pk]) => pk !== o.key), ...(v ? [[o.key, v.value]] : [])],
                  })
                }
              />
            </Box>
          </Box>
        ))
    }
    if (p.interactionKey === 'order') {
      const byKey = new Map(p.options.map((o) => [o.key, o]))
      const moveTo = (i, d) => {
        const next = [...answer.order]
        const j = i + d
        if (j < 0 || j >= next.length) return
        ;[next[i], next[j]] = [next[j], next[i]]
        setAnswer({ order: next })
      }
      return answer.order.map((k, i) => (
        <Box key={k} style={card} flex alignItems="center">
          <Text mr="default">{i + 1}.</Text>
          <Box style={{ flex: 1 }}>{label(byKey.get(k))}</Box>
          <Button size="sm" variant="text" type="button" onClick={() => moveTo(i, -1)}>
            ↑
          </Button>
          <Button size="sm" variant="text" type="button" onClick={() => moveTo(i, 1)}>
            ↓
          </Button>
        </Box>
      ))
    }
    if (p.interactionKey === 'text_entry')
      return (
        <Input
          width={1}
          value={answer.text}
          placeholder={p.content.placeholder || 'Ваш ответ'}
          onChange={(e) => setAnswer({ text: e.target.value })}
        />
      )
    return <TextArea width={1} rows={6} value={answer.text} onChange={(e) => setAnswer({ text: e.target.value })} />
  }

  const keyText = () => {
    const ak = p.answerKey
    const name = (k) => {
      const o = p.options.find((x) => x.key === k)
      return o ? o.text || 'изображение' : k
    }
    if (ak.correct) return ak.correct.map(name).join(', ')
    if (ak.pairs) return ak.pairs.map(([a, b]) => `${name(a)} → ${name(b)}`).join('; ')
    if (ak.order) return ak.order.map(name).join(' → ')
    if (ak.accepted) return ak.accepted.join(' / ')
    return ak.modelAnswer || 'оценивается экспертом'
  }

  return (
    <Box variant="container">
      <H3>
        Предпросмотр · {p.typeName} · v{p.versionNo}
      </H3>
      {p.errors.length ? (
        <MessageBox
          variant="danger"
          message={`Вопрос содержит ошибки (${p.errors.length}) — см. карточку вопроса`}
          mb="lg"
        />
      ) : null}
      {p.media
        .filter((m) => m.role === 'STIMULUS')
        .map((m) => (
          <img
            key={m.mediaAssetId}
            src={`/admin/media-file/${m.mediaAssetId}/preview`}
            alt={m.altTextOverride || 'стимул'}
            style={{ maxWidth: '100%', maxHeight: 420, borderRadius: 6, marginBottom: 16 }}
          />
        ))}
      <Box mb="lg" style={{ fontSize: 18 }} dangerouslySetInnerHTML={{ __html: p.stem }} />
      <Box mb="lg">{body()}</Box>
      <Box flex>
        <Button variant="contained" type="button" onClick={check}>
          Проверить ответ
        </Button>
        <Button ml="default" variant="outlined" type="button" onClick={() => (setSeed(seed + 1), load(seed + 1))}>
          Перемешать (seed {seed + 1})
        </Button>
      </Box>
      {error ? <MessageBox variant="danger" message={error} mt="lg" /> : null}
      {result ? (
        <Box mt="xl" data-testid="preview-result">
          <MessageBox
            variant={
              result.score === null ? 'info' : result.score >= 1 ? 'success' : result.score > 0 ? 'warning' : 'danger'
            }
            message={
              result.score === null ? 'Ответ оценивается вручную' : `Баллы: ${result.score} из ${result.maxScore}`
            }
          />
          <Label mt="lg">Верный ответ</Label>
          <Text>{keyText()}</Text>
          {p.feedback ? (
            <>
              <Label mt="lg">Пояснение</Label>
              <Text>{p.feedback}</Text>
            </>
          ) : null}
        </Box>
      ) : null}
    </Box>
  )
}

export default ItemPreview
