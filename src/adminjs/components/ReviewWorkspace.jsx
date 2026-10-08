import React, { useEffect, useState } from 'react'
import {
  Badge,
  Box,
  Button,
  CheckBox,
  H3,
  H5,
  Label,
  Loader,
  MessageBox,
  Select,
  Text,
  TextArea,
} from '@adminjs/design-system'
import { ApiClient, useNotice } from 'adminjs'

const api = new ApiClient()
const card = { border: '1px solid rgba(127,127,127,0.3)', borderRadius: 6, padding: 12, marginBottom: 12 }
const STATUS = {
  OPEN: 'Ожидает начала',
  IN_PROGRESS: 'Идет экспертиза',
  CHANGES_REQUESTED: 'Возвращено на доработку',
  APPROVED: 'Принято',
  CANCELLED: 'Отменено',
}
const SEVERITY = { BLOCKING: 'Блокирующее', MAJOR: 'Существенное', MINOR: 'Незначительное' }
const ISSUE = {
  OPEN: 'Открыто',
  ADDRESSED: 'Исправлено автором',
  RESOLVED: 'Закрыто',
  WONT_FIX: 'Не требует исправления',
}
const SEV_OPTIONS = [
  { value: '', label: 'Комментарий (без замечания)' },
  { value: 'BLOCKING', label: 'Замечание: блокирующее' },
  { value: 'MAJOR', label: 'Замечание: существенное' },
  { value: 'MINOR', label: 'Замечание: незначительное' },
]

/** Буквенная метка варианта (А, Б, В…) — в порядке показа. */
const letter = (i) => String.fromCharCode(1040 + (i >= 9 ? i + 1 : i))
const labelOf = (p, k) => {
  const i = p.options.findIndex((x) => x.key === k)
  if (i < 0) return k
  const o = p.options[i]
  return `${letter(i)}${o.text ? ` (${o.text})` : ''}`
}

const keyText = (p) => {
  const ak = p.answerKey || {}
  if (ak.correct) return ak.correct.map((k) => labelOf(p, k)).join(', ')
  if (ak.pairs) return ak.pairs.map(([a, b]) => `${labelOf(p, a)} → ${labelOf(p, b)}`).join('; ')
  if (ak.order) return ak.order.map((k) => labelOf(p, k)).join(' → ')
  if (ak.accepted) return ak.accepted.join(' / ')
  return ak.modelAnswer || 'оценивается вручную'
}

/** Карточка вопроса пакета с ключом и комментариями к нему (AC-REVIEW-002.2). */
const ItemCard = ({ n, it, comments, onAnchor, selected }) => (
  <Box style={{ ...card, borderColor: selected ? '#3040d6' : 'rgba(127,127,127,0.3)' }} data-testid="review-item">
    <Text variant="sm">
      Вопрос {n} · {it.preview.typeName} · v{it.preview.versionNo} · {it.points} б.
    </Text>
    {it.preview.media
      .filter((m) => m.role === 'STIMULUS')
      .map((m) => (
        <img
          key={m.mediaAssetId}
          src={`/admin/media-file/${m.mediaAssetId}/thumb`}
          alt={m.altTextOverride || 'стимул'}
          style={{ maxWidth: 200, borderRadius: 4 }}
        />
      ))}
    <Box my="default" dangerouslySetInnerHTML={{ __html: it.preview.stem }} />
    <Box>
      {it.preview.options.map((o, i) => (
        <Box key={o.key} flex alignItems="flex-start" mb="sm">
          <Text mr="default" style={{ minWidth: 18 }}>
            <b>{letter(i)}.</b>
          </Text>
          <Box>
            {o.text ? <Text>{o.text}</Text> : null}
            {o.mediaAssetId ? (
              <img
                src={`/admin/media-file/${o.mediaAssetId}/thumb`}
                alt={o.altTextOverride || o.text || 'изображение'}
                style={{ maxWidth: 120, display: 'block', borderRadius: 4 }}
              />
            ) : null}
          </Box>
        </Box>
      ))}
    </Box>
    <Text mt="default" variant="sm">
      <b>Ключ:</b> {keyText(it.preview)}
    </Text>
    {comments.map((c) => (
      <Box key={c.id} mt="sm" p="sm" style={{ background: 'rgba(48,64,214,0.07)', borderRadius: 4 }}>
        <Text variant="sm">
          <b>{c.authorName}:</b> {c.body}
        </Text>
      </Box>
    ))}
    {onAnchor ? (
      <Button size="sm" variant="text" type="button" mt="sm" onClick={() => onAnchor(it.itemVersionId)}>
        {selected ? 'Комментарий будет привязан к этому вопросу' : 'Комментировать этот вопрос'}
      </Button>
    ) : null}
  </Box>
)

/** Рабочее место экспертизы (SPEC-REVIEW-002/003): объект, checklist, замечания, обсуждение, решение. */
const ReviewWorkspace = (props) => {
  const { record, resource, action } = props
  const sendNotice = useNotice()
  const [d, setD] = useState(null)
  const [error, setError] = useState(null)
  const [body, setBody] = useState('')
  const [severity, setSeverity] = useState('')
  const [anchor, setAnchor] = useState(null)
  const [summary, setSummary] = useState('')

  const call = async (data) => {
    const payload = {}
    Object.entries(data).forEach(([k, v]) => (payload[k] = typeof v === 'object' && v !== null ? JSON.stringify(v) : v))
    const res = await api.recordAction({
      resourceId: resource.id,
      recordId: record.id,
      actionName: action.name,
      method: 'post',
      data: payload,
    })
    return res.data || {}
  }
  const load = async () => {
    const r = await call({ op: 'load' })
    if (!r.ok) return setError(r.message)
    setD(r)
  }
  useEffect(() => {
    load()
  }, [])
  const op = async (data, ok) => {
    const r = await call(data)
    if (!r.ok) {
      setError(r.message)
      sendNotice({ message: r.message, type: 'error' })
      return null
    }
    setError(null)
    if (ok) sendNotice({ message: ok, type: 'success' })
    await load()
    return r
  }

  if (error && !d) return <MessageBox variant="danger" message={error} />
  if (!d) return <Loader />
  const x = d.details
  const rv = x.review
  const answered = new Map(x.answers.map((a) => [a.code, a.checked]))
  const items = d.preview ? d.preview.sections.flatMap((s) => s.items) : []
  let n = 0

  return (
    <Box variant="container">
      <Box flex justifyContent="space-between" alignItems="center" mb="lg">
        <H3 mb={0}>
          {rv.subjectType === 'TEST_VERSION' ? 'Тест' : 'Вопрос'}: {rv.subjectTitle.replace(/<[^>]*>/g, '')} · v
          {rv.versionNo} <Badge data-testid="review-status">{STATUS[rv.status]}</Badge>
        </H3>
        <Text>
          Автор: {rv.ownerName}
          {rv.assignmentTitle ? ` · Задание: ${rv.assignmentTitle}` : ''} · Эксперт:{' '}
          {rv.primaryReviewerName || 'не назначен'}
          {x.myRole ? ` · Ваша роль: ${x.myRole === 'PRIMARY' ? 'основной эксперт' : 'консультант'}` : ''}
        </Text>
      </Box>
      {error ? <MessageBox variant="danger" message={error} mb="lg" /> : null}
      {x.isAuthor && (rv.status === 'OPEN' || rv.status === 'IN_PROGRESS') ? (
        <MessageBox
          variant="info"
          mb="lg"
          message="Вы автор: можно отвечать на комментарии и отмечать замечания исправленными."
        />
      ) : null}
      {x.canStart ? (
        <Box mb="lg">
          <Button type="button" onClick={() => op({ op: 'start' }, 'Экспертиза начата')}>
            Начать экспертизу
          </Button>
        </Box>
      ) : null}

      <Box flex style={{ gap: 20, alignItems: 'flex-start' }}>
        <Box style={{ flex: 3, minWidth: 0 }}>
          <H5>Содержимое</H5>
          {items.map((it) => {
            n += 1
            return (
              <ItemCard
                key={it.itemVersionId}
                n={n}
                it={it}
                selected={anchor === it.itemVersionId}
                comments={x.comments.filter((c) => c.anchor.itemVersionId === it.itemVersionId)}
                onAnchor={x.canComment ? (id) => setAnchor(anchor === id ? null : id) : null}
              />
            )
          })}
          {d.itemPreview ? (
            <ItemCard
              n={1}
              it={{ itemVersionId: rv.itemVersionId, points: d.itemPreview.points, preview: d.itemPreview }}
              comments={x.comments.filter((c) => c.anchor.itemVersionId)}
            />
          ) : null}
        </Box>

        <Box style={{ flex: 2, minWidth: 320 }}>
          <Box style={card} data-testid="checklist">
            <H5>Checklist</H5>
            {x.template.items.map((i) => (
              <Box key={i.code} flex alignItems="flex-start" mb="sm">
                <CheckBox
                  id={`ck-${i.code}`}
                  checked={!!answered.get(i.code)}
                  disabled={!x.canChecklist}
                  onChange={() => op({ op: 'checklist', code: i.code, checked: !answered.get(i.code) })}
                />
                <Label inline htmlFor={`ck-${i.code}`} ml="default" mb={0}>
                  {i.text}
                  {i.mandatory ? '' : ' (необязательно)'}
                </Label>
              </Box>
            ))}
          </Box>

          <Box style={card} data-testid="issues">
            <H5>
              Замечания {x.openBlocking ? <Badge variant="danger">блокирующих открыто: {x.openBlocking}</Badge> : null}
            </H5>
            {x.issues.length === 0 ? <Text>Замечаний нет</Text> : null}
            {x.issues.map((i) => (
              <Box
                key={i.id}
                mb="default"
                pb="sm"
                style={{ borderBottom: '1px dashed rgba(127,127,127,0.3)' }}
                data-testid="issue"
              >
                <Text>
                  <Badge variant={i.severity === 'BLOCKING' ? 'danger' : 'default'}>{SEVERITY[i.severity]}</Badge>{' '}
                  {i.body}
                </Text>
                <Text variant="sm">
                  {ISSUE[i.status]} · {i.raisedByName}
                  {i.carried ? ' · из предыдущей версии' : ''}
                </Text>
                <Box flex style={{ gap: 6 }}>
                  {x.isAuthor && i.status === 'OPEN' ? (
                    <Button
                      size="sm"
                      variant="outlined"
                      type="button"
                      onClick={() =>
                        op({ op: 'issueStatus', issueId: i.id, status: 'ADDRESSED' }, 'Отмечено как исправленное')
                      }
                    >
                      Исправлено
                    </Button>
                  ) : null}
                  {x.myRole === 'PRIMARY' &&
                  rv.status === 'IN_PROGRESS' &&
                  (i.status === 'OPEN' || i.status === 'ADDRESSED') ? (
                    <>
                      <Button
                        size="sm"
                        variant="outlined"
                        type="button"
                        onClick={() =>
                          op({ op: 'issueStatus', issueId: i.id, status: 'RESOLVED' }, 'Замечание закрыто')
                        }
                      >
                        Закрыть
                      </Button>
                      <Button
                        size="sm"
                        variant="text"
                        type="button"
                        onClick={() => op({ op: 'issueStatus', issueId: i.id, status: 'WONT_FIX' })}
                      >
                        Не требует исправления
                      </Button>
                    </>
                  ) : null}
                  {x.myRole === 'PRIMARY' &&
                  rv.status === 'IN_PROGRESS' &&
                  (i.status === 'RESOLVED' || i.status === 'WONT_FIX') ? (
                    <Button
                      size="sm"
                      variant="text"
                      type="button"
                      onClick={() => op({ op: 'issueStatus', issueId: i.id, status: 'OPEN' })}
                    >
                      Открыть снова
                    </Button>
                  ) : null}
                </Box>
              </Box>
            ))}
          </Box>

          <Box style={card} data-testid="discussion">
            <H5>Обсуждение</H5>
            {x.comments
              .filter((c) => !c.anchor.itemVersionId)
              .map((c) => (
                <Box key={c.id} mb="sm">
                  <Text variant="sm">
                    <b>{c.authorName}:</b> {c.body}
                  </Text>
                </Box>
              ))}
            {x.canComment ? (
              <Box mt="default">
                <Label htmlFor="review-comment">
                  {anchor ? 'Комментарий к выбранному вопросу' : 'Комментарий к тесту'}
                </Label>
                <TextArea
                  id="review-comment"
                  width={1}
                  rows={3}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                />
                {x.canRaiseIssue ? (
                  <Box mt="sm">
                    <Select
                      value={SEV_OPTIONS.find((o) => o.value === severity)}
                      options={SEV_OPTIONS}
                      onChange={(o) => setSeverity(o ? o.value : '')}
                    />
                  </Box>
                ) : null}
                <Button
                  mt="sm"
                  type="button"
                  size="sm"
                  onClick={async () => {
                    if (
                      await op(
                        { op: 'comment', body, severity, anchor: anchor ? { itemVersionId: anchor } : {} },
                        severity ? 'Замечание создано' : 'Комментарий добавлен',
                      )
                    ) {
                      setBody('')
                      setSeverity('')
                      setAnchor(null)
                    }
                  }}
                >
                  Отправить
                </Button>
              </Box>
            ) : null}
          </Box>

          {x.canDecide ? (
            <Box style={card} data-testid="decision">
              <H5>Решение</H5>
              {x.missingChecklist.length || x.openBlocking ? (
                <MessageBox
                  variant="warning"
                  mb="default"
                  message={`Для принятия: ${x.missingChecklist.length ? `не отмечено пунктов checklist — ${x.missingChecklist.length}` : ''}${x.missingChecklist.length && x.openBlocking ? '; ' : ''}${x.openBlocking ? `открыто блокирующих замечаний — ${x.openBlocking}` : ''} (BR-028)`}
                />
              ) : null}
              <Label htmlFor="review-summary">Итоговый комментарий</Label>
              <TextArea
                id="review-summary"
                width={1}
                rows={3}
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
              />
              <Box flex mt="default" style={{ gap: 8 }}>
                <Button
                  type="button"
                  variant="outlined"
                  onClick={() => op({ op: 'requestChanges', summary }, 'Возвращено на доработку')}
                >
                  Вернуть на доработку
                </Button>
                <Button type="button" onClick={() => op({ op: 'approve' }, 'Принято')}>
                  Принять
                </Button>
              </Box>
            </Box>
          ) : null}
          {rv.summary ? <MessageBox variant="info" message={`Итог: ${rv.summary}`} /> : null}
        </Box>
      </Box>
    </Box>
  )
}

export default ReviewWorkspace
