import React, { useEffect, useMemo, useState } from 'react'
import {
  Box,
  Button,
  CheckBox,
  FormGroup,
  H3,
  H5,
  Input,
  Label,
  Loader,
  MessageBox,
  Select,
  Text,
  TextArea,
} from '@adminjs/design-system'
import { ApiClient, useNotice } from 'adminjs'

const api = new ApiClient()

const PREFIX = { OPTION: 'o', PREMISE: 'p', RESPONSE: 'r', SEQUENCE_ELEMENT: 'e' }
/** Новый ключ варианта: не переиспользует ключи прошлых версий (INV-008). */
const newKey = (role) => `${PREFIX[role]}_${Math.random().toString(36).slice(2, 8)}`

const card = { border: '1px solid rgba(127,127,127,0.3)', borderRadius: 6, padding: 12, marginBottom: 10 }
const thumbStyle = { width: 64, height: 48, objectFit: 'cover', borderRadius: 4, display: 'block' }

const DIFFICULTY = [1, 2, 3, 4, 5].map((d) => ({
  value: d,
  label: ['', 'Очень легко', 'Легко', 'Средне', 'Сложно', 'Очень сложно'][d],
}))

/** Выбор изображения из медиатеки (только доступные для выбора: не архив и не RESTRICTED). */
const MediaPicker = ({ call, onPick, onClose }) => {
  const [text, setText] = useState('')
  const [items, setItems] = useState(null)
  const search = async (t) => {
    const r = await call({ op: 'media', text: t })
    setItems(r.ok ? r.media : [])
  }
  useEffect(() => {
    search('')
  }, [])
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.45)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Box
        bg="white"
        p="xl"
        style={{ width: 'min(880px, 94vw)', maxHeight: '86vh', overflow: 'auto', borderRadius: 8 }}
      >
        <Box flex justifyContent="space-between" alignItems="center" mb="lg">
          <H5 m={0}>Выбор изображения</H5>
          <Button size="sm" variant="text" onClick={onClose} type="button">
            Закрыть
          </Button>
        </Box>
        <Box flex mb="lg">
          <Input
            width={1}
            placeholder="Поиск: название, художник, произведение"
            aria-label="Поиск изображения в медиатеке"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), search(text))}
          />
          <Button ml="default" type="button" onClick={() => search(text)}>
            Найти
          </Button>
        </Box>
        {!items ? (
          <Loader />
        ) : items.length === 0 ? (
          <Text>Ничего не найдено. Загрузите изображение в «Медиатеке».</Text>
        ) : (
          <Box style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12 }}>
            {items.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => onPick(m)}
                style={{ ...card, cursor: 'pointer', textAlign: 'left', background: 'transparent' }}
              >
                <img
                  src={m.thumb}
                  alt={m.altText || m.title}
                  style={{ width: '100%', height: 100, objectFit: 'cover', borderRadius: 4 }}
                />
                <Text variant="sm" mt="sm">
                  {m.title}
                </Text>
                <Text variant="xs" color={m.rightsStatus === 'CLEARED' ? 'success' : 'grey60'}>
                  {m.rightsStatus === 'CLEARED' ? 'права подтверждены' : 'права не проверены'}
                </Text>
              </button>
            ))}
          </Box>
        )}
      </Box>
    </div>
  )
}

/**
 * Редактор вопроса (SPEC-ITEM-001/002). Форма определяется interaction типа (ADR-001);
 * все проверки и права — на сервере, редактор показывает результат проверки (issues).
 */
const ItemEditor = (props) => {
  const { record, resource, action } = props
  const sendNotice = useNotice()
  const [phase, setPhase] = useState('loading')
  const [ctx, setCtx] = useState(null)
  const [scope, setScope] = useState({ assignmentId: '', courseId: '' })
  const [itemId, setItemId] = useState(record ? record.id : null)
  const [type, setType] = useState(null)
  const [doc, setDoc] = useState(null)
  const [meta, setMeta] = useState({
    difficulty: 3,
    defaultPoints: 1,
    feedback: '',
    topicIds: [],
    objectiveIds: [],
    tags: [],
  })
  const [revision, setRevision] = useState(1)
  const [issues, setIssues] = useState([])
  const [errors, setErrors] = useState({})
  const [message, setMessage] = useState(null)
  const [busy, setBusy] = useState(false)
  const [picker, setPicker] = useState(null)

  const call = async (data) => {
    const body = {}
    Object.entries(data).forEach(([k, v]) => (body[k] = typeof v === 'object' && v !== null ? JSON.stringify(v) : v))
    const res = record
      ? await api.recordAction({
          resourceId: resource.id,
          recordId: record.id,
          actionName: action.name,
          method: 'post',
          data: body,
        })
      : await api.resourceAction({ resourceId: resource.id, actionName: action.name, method: 'post', data: body })
    return res.data || {}
  }

  const loadContext = async (params) => {
    const r = await call({ op: 'context', ...params })
    if (!r.ok) throw new Error(r.message)
    setCtx(r)
    return r
  }

  useEffect(() => {
    ;(async () => {
      try {
        if (record) {
          const r = await call({ op: 'load', itemId: record.id })
          if (!r.ok) throw new Error(r.message)
          if (!r.canEdit) throw new Error('Редактировать можно только черновик. Создайте новую версию.')
          const c = await loadContext({ itemId: record.id })
          setType({
            id: r.item.questionTypeId,
            name: r.item.questionTypeName,
            interactionKey: r.item.interactionKey,
            config: r.typeConfig,
          })
          setDoc(r.version.document)
          setMeta({ ...r.version.meta, feedback: r.version.meta.feedback || '' })
          setRevision(r.version.revision)
          setIssues(r.issues)
          setScope({ assignmentId: r.item.assignmentId || '', courseId: r.item.courseId })
          setPhase(c ? 'edit' : 'error')
        } else {
          await loadContext({})
          setPhase('scope')
        }
      } catch (e) {
        setMessage(e.message)
        setPhase('error')
      }
    })()
  }, [])

  // ---------- выбор задания/курса и типа ----------
  const chooseScope = async (patch) => {
    const next = { ...scope, ...patch }
    setScope(next)
    setBusy(true)
    try {
      await loadContext({ assignmentId: next.assignmentId, courseId: next.courseId })
      setPhase('type')
    } catch (e) {
      setMessage(e.message)
    } finally {
      setBusy(false)
    }
  }

  const chooseType = (t) => {
    setType(t)
    setDoc(JSON.parse(JSON.stringify(ctx.emptyDocuments[t.id])))
    setMeta({ ...meta, topicIds: ctx.topics.length === 1 ? [ctx.topics[0].value] : [] })
    setIssues([])
    setPhase('edit')
  }

  // ---------- изменения документа ----------
  const roleOptions = (role) =>
    doc ? doc.options.filter((o) => o.role === role).sort((a, b) => a.ordinal - b.ordinal) : []
  const patchDoc = (patch) => setDoc({ ...doc, ...patch })
  const setOption = (key, patch) =>
    patchDoc({ options: doc.options.map((o) => (o.key === key ? { ...o, ...patch } : o)) })
  const addOption = (role) => {
    const list = roleOptions(role)
    patchDoc({
      options: [
        ...doc.options,
        {
          key: newKey(role),
          role,
          text: '',
          mediaAssetId: null,
          altTextOverride: null,
          ordinal: list.length ? list[list.length - 1].ordinal + 1 : 0,
        },
      ],
    })
  }
  const removeOption = (key) => {
    const ak = { ...doc.answerKey }
    if (Array.isArray(ak.correct)) ak.correct = ak.correct.filter((k) => k !== key)
    if (Array.isArray(ak.pairs)) ak.pairs = ak.pairs.filter(([p, r]) => p !== key && r !== key)
    patchDoc({ options: doc.options.filter((o) => o.key !== key), answerKey: ak })
  }
  const move = (key, dir) => {
    const o = doc.options.find((x) => x.key === key)
    const list = roleOptions(o.role)
    const i = list.findIndex((x) => x.key === key)
    const j = i + dir
    if (j < 0 || j >= list.length) return
    const reordered = [...list]
    ;[reordered[i], reordered[j]] = [reordered[j], reordered[i]]
    const ord = new Map(reordered.map((x, n) => [x.key, n]))
    patchDoc({ options: doc.options.map((x) => (ord.has(x.key) ? { ...x, ordinal: ord.get(x.key) } : x)) })
  }
  const correct = (doc && doc.answerKey.correct) || []
  const toggleCorrect = (key) => {
    const single = type.config.cardinality === 'single'
    const next = single ? [key] : correct.includes(key) ? correct.filter((k) => k !== key) : [...correct, key]
    patchDoc({ answerKey: { ...doc.answerKey, correct: next } })
  }
  const pairs = (doc && doc.answerKey.pairs) || []
  const setPair = (premise, response) => {
    const rest = pairs.filter(([p]) => p !== premise)
    patchDoc({ answerKey: { ...doc.answerKey, pairs: response ? [...rest, [premise, response]] : rest } })
  }

  /** Перед сохранением: порядок хронологии = порядок в редакторе. */
  const finalDoc = () => {
    if (type.interactionKey !== 'order') return doc
    return { ...doc, answerKey: { order: roleOptions('SEQUENCE_ELEMENT').map((o) => o.key) } }
  }

  const save = async () => {
    setBusy(true)
    setErrors({})
    setMessage(null)
    try {
      const body = {
        document: finalDoc(),
        meta: {
          ...meta,
          tags: (Array.isArray(meta.tags) ? meta.tags : String(meta.tags).split(','))
            .map((t) => t.trim())
            .filter(Boolean),
        },
      }
      const r = itemId
        ? await call({ op: 'save', itemId, revision, ...body })
        : await call({
            op: 'create',
            assignmentId: scope.assignmentId,
            courseId: scope.courseId,
            questionTypeId: type.id,
            ...body,
          })
      if (!r.ok) {
        setMessage(r.message)
        setErrors(r.errors || {})
        return
      }
      setIssues(r.issues || [])
      if (!itemId) {
        sendNotice({ message: 'Вопрос создан (черновик)', type: 'success' })
        window.location.href = r.redirectUrl
        return
      }
      setRevision(r.revision)
      sendNotice({ message: 'Черновик сохранен', type: 'success' })
    } catch (e) {
      setMessage('Не удалось сохранить')
    } finally {
      setBusy(false)
    }
  }

  const pickMedia = (m) => {
    if (picker.kind === 'option') setOption(picker.key, { mediaAssetId: m.id })
    else {
      const others = doc.media.filter((x) => x.role !== 'STIMULUS')
      patchDoc({ media: [...others, { mediaAssetId: m.id, role: 'STIMULUS', altTextOverride: null, ordinal: 0 }] })
    }
    setPicker(null)
  }

  const optionMedia = (o) =>
    type.config.optionMedia === 'none' ? null : (
      <Box flex alignItems="center" mt="sm">
        {o.mediaAssetId ? <img src={`/admin/media-file/${o.mediaAssetId}/thumb`} alt="" style={thumbStyle} /> : null}
        <Button
          size="sm"
          variant="outlined"
          type="button"
          ml={o.mediaAssetId ? 'default' : 0}
          onClick={() => setPicker({ kind: 'option', key: o.key })}
        >
          {o.mediaAssetId ? 'Заменить изображение' : 'Выбрать изображение'}
        </Button>
        {o.mediaAssetId ? (
          <>
            <Button size="sm" variant="text" type="button" onClick={() => setOption(o.key, { mediaAssetId: null })}>
              Убрать
            </Button>
            <Input
              ml="default"
              style={{ flex: 1 }}
              placeholder="Alt-текст (если отличается от медиатеки)"
              aria-label="Alt-текст изображения варианта"
              value={o.altTextOverride || ''}
              onChange={(e) => setOption(o.key, { altTextOverride: e.target.value })}
            />
          </>
        ) : null}
      </Box>
    )

  const optionRow = (o, idx, list, children = null) => (
    <div style={card} key={o.key}>
      <Box flex alignItems="center">
        <Text mr="default" style={{ minWidth: 24 }}>
          {idx + 1}.
        </Text>
        {children}
        <Input
          style={{ flex: 1 }}
          value={o.text || ''}
          placeholder="Текст"
          aria-label={`Вариант ${idx + 1}: текст`}
          onChange={(e) => setOption(o.key, { text: e.target.value })}
          disabled={!!type.config.fixedOptions}
        />
        <Button
          size="sm"
          variant="text"
          type="button"
          onClick={() => move(o.key, -1)}
          disabled={idx === 0}
          title="Выше"
        >
          ↑
        </Button>
        <Button
          size="sm"
          variant="text"
          type="button"
          onClick={() => move(o.key, 1)}
          disabled={idx === list.length - 1}
          title="Ниже"
        >
          ↓
        </Button>
        {type.config.fixedOptions ? null : (
          <Button
            size="sm"
            variant="text"
            color="danger"
            type="button"
            onClick={() => removeOption(o.key)}
            title="Удалить"
          >
            ✕
          </Button>
        )}
      </Box>
      {optionMedia(o)}
    </div>
  )

  const editors = {
    choice: () => {
      const list = roleOptions('OPTION')
      const stimulus = doc.media.find((m) => m.role === 'STIMULUS')
      return (
        <Box>
          {type.config.stimulus !== 'none' ? (
            <FormGroup>
              <Label required={type.config.stimulus === 'required'}>Изображение-стимул</Label>
              <Box flex alignItems="center">
                {stimulus ? (
                  <img
                    src={`/admin/media-file/${stimulus.mediaAssetId}/thumb`}
                    alt=""
                    style={{ ...thumbStyle, width: 120, height: 90 }}
                  />
                ) : null}
                <Button
                  size="sm"
                  variant="outlined"
                  type="button"
                  ml={stimulus ? 'default' : 0}
                  onClick={() => setPicker({ kind: 'stimulus' })}
                >
                  {stimulus ? 'Заменить' : 'Выбрать изображение'}
                </Button>
                {stimulus ? (
                  <Button
                    size="sm"
                    variant="text"
                    type="button"
                    onClick={() => patchDoc({ media: doc.media.filter((m) => m.role !== 'STIMULUS') })}
                  >
                    Убрать
                  </Button>
                ) : null}
              </Box>
            </FormGroup>
          ) : null}
          <Label required>
            Варианты ответа · {type.config.cardinality === 'single' ? 'отметьте один верный' : 'отметьте все верные'}
          </Label>
          {list.map((o, i) =>
            optionRow(
              o,
              i,
              list,
              <input
                type={type.config.cardinality === 'single' ? 'radio' : 'checkbox'}
                name="correct"
                aria-label={`Вариант ${i + 1} верный`}
                checked={correct.includes(o.key)}
                onChange={() => toggleCorrect(o.key)}
                style={{ marginRight: 10, width: 18, height: 18 }}
              />,
            ),
          )}
          {type.config.fixedOptions ? null : (
            <Button
              size="sm"
              type="button"
              variant="outlined"
              onClick={() => addOption('OPTION')}
              disabled={list.length >= type.config.maxOptions}
            >
              + Вариант
            </Button>
          )}
          {type.config.fixedOptions ? null : (
            <Box flex alignItems="center" mt="lg">
              <CheckBox
                id="shuffle"
                checked={doc.content.shuffleOptions !== false}
                onChange={() =>
                  patchDoc({ content: { ...doc.content, shuffleOptions: doc.content.shuffleOptions === false } })
                }
              />
              <Label inline htmlFor="shuffle" ml="default">
                Перемешивать варианты
              </Label>
            </Box>
          )}
        </Box>
      )
    },
    match: () => {
      const premises = roleOptions('PREMISE')
      const responses = roleOptions('RESPONSE')
      const respOpts = responses.map((r, i) => ({
        value: r.key,
        label: `${String.fromCharCode(1040 + i)}. ${r.text || '(изображение)'}`,
      }))
      return (
        <Box>
          <Label required>Элементы и их соответствия</Label>
          {premises.map((o, i) =>
            optionRow(
              o,
              i,
              premises,
              <Box style={{ width: 260 }} mr="default">
                <Select
                  aria-label={`Соответствие для элемента ${i + 1}`}
                  placeholder="Соответствие…"
                  value={respOpts.find((x) => x.value === (pairs.find(([p]) => p === o.key) || [])[1]) || null}
                  options={respOpts}
                  onChange={(v) => setPair(o.key, v ? v.value : null)}
                />
              </Box>,
            ),
          )}
          <Button size="sm" type="button" variant="outlined" onClick={() => addOption('PREMISE')}>
            + Элемент
          </Button>
          <Label mt="xl">Соответствия (лишние — дистракторы)</Label>
          {responses.map((o, i) =>
            optionRow(o, i, responses, <Text mr="default">{String.fromCharCode(1040 + i)}</Text>),
          )}
          <Button size="sm" type="button" variant="outlined" onClick={() => addOption('RESPONSE')}>
            + Соответствие
          </Button>
        </Box>
      )
    },
    order: () => {
      const list = roleOptions('SEQUENCE_ELEMENT')
      return (
        <Box>
          <Label required>Элементы в ВЕРНОМ порядке (студенту они будут перемешаны)</Label>
          {list.map((o, i) => optionRow(o, i, list))}
          <Button
            size="sm"
            type="button"
            variant="outlined"
            onClick={() => addOption('SEQUENCE_ELEMENT')}
            disabled={list.length >= type.config.maxElements}
          >
            + Элемент
          </Button>
        </Box>
      )
    },
    text_entry: () => (
      <FormGroup>
        <Label required htmlFor="f-accepted">
          Допустимые ответы — по одному на строку
        </Label>
        <TextArea
          id="f-accepted"
          width={1}
          rows={4}
          value={(doc.answerKey.accepted || []).join('\n')}
          onChange={(e) => patchDoc({ answerKey: { accepted: e.target.value.split('\n') } })}
        />
        <Text variant="sm" mt="sm">
          Сравнение без учета регистра, лишних пробелов, кавычек, концевой точки и «ё/е».
        </Text>
      </FormGroup>
    ),
    extended_text: () => (
      <Box>
        <FormGroup>
          <Label required htmlFor="f-rubric">
            Критерии оценивания
          </Label>
          <TextArea
            id="f-rubric"
            width={1}
            rows={4}
            value={doc.content.rubric || ''}
            onChange={(e) => patchDoc({ content: { ...doc.content, rubric: e.target.value } })}
          />
        </FormGroup>
        <Box flex>
          <FormGroup mr="xl">
            <Label htmlFor="f-min-words">Минимум слов</Label>
            <Input
              id="f-min-words"
              type="number"
              value={doc.content.minWords ?? ''}
              onChange={(e) =>
                patchDoc({
                  content: { ...doc.content, minWords: e.target.value === '' ? undefined : Number(e.target.value) },
                })
              }
            />
          </FormGroup>
          <FormGroup>
            <Label htmlFor="f-max-words">Максимум слов</Label>
            <Input
              id="f-max-words"
              type="number"
              value={doc.content.maxWords ?? ''}
              onChange={(e) =>
                patchDoc({
                  content: { ...doc.content, maxWords: e.target.value === '' ? undefined : Number(e.target.value) },
                })
              }
            />
          </FormGroup>
        </Box>
        <FormGroup>
          <Label htmlFor="f-model">Образец ответа (для эксперта)</Label>
          <TextArea
            id="f-model"
            width={1}
            rows={3}
            value={doc.answerKey.modelAnswer || ''}
            onChange={(e) => patchDoc({ answerKey: { modelAnswer: e.target.value } })}
          />
        </FormGroup>
      </Box>
    ),
  }

  const toggleMeta = (field, value) => {
    const cur = new Set(meta[field] || [])
    cur.has(value) ? cur.delete(value) : cur.add(value)
    setMeta({ ...meta, [field]: [...cur] })
  }

  const errorIssues = issues.filter((i) => i.severity === 'ERROR')
  const warnIssues = issues.filter((i) => i.severity === 'WARNING')
  const objectivesForTopics = useMemo(() => (ctx ? ctx.objectives : []), [ctx])

  // ---------- рендер ----------
  if (phase === 'loading') return <Loader />
  if (phase === 'error') return <MessageBox variant="danger" message={message || 'Ошибка'} />

  if (phase === 'scope') {
    const assignments = ctx.assignments
    const courses = ctx.courses
    return (
      <Box data-a11y="component" variant="container">
        <H3>Новый вопрос</H3>
        {assignments.length ? (
          <FormGroup>
            <Label htmlFor="item-assignment">Задание</Label>
            <Select
              inputId="item-assignment"
              placeholder="Выберите задание…"
              options={assignments}
              onChange={(o) => o && chooseScope({ assignmentId: o.value, courseId: '' })}
            />
            <Text variant="sm" mt="sm">
              Студенты создают вопросы только в рамках назначенного активного задания (BR-017).
            </Text>
          </FormGroup>
        ) : null}
        {courses.length ? (
          <FormGroup>
            <Label htmlFor="item-course">или курс (вопрос для банка)</Label>
            <Select
              inputId="item-course"
              placeholder="Выберите курс…"
              options={courses}
              onChange={(o) => o && chooseScope({ courseId: o.value, assignmentId: '' })}
            />
          </FormGroup>
        ) : null}
        {!assignments.length && !courses.length ? (
          <MessageBox variant="info" message="Нет активных заданий или курсов, в которых можно создать вопрос." />
        ) : null}
        {busy ? <Loader /> : null}
        {message ? <MessageBox variant="danger" message={message} mt="lg" /> : null}
      </Box>
    )
  }

  if (phase === 'type') {
    return (
      <Box data-a11y="component" variant="container">
        <H3>Тип вопроса</H3>
        {ctx.assignment ? (
          <Text mb="lg">Задание: {ctx.assignment.title} — доступны только разрешенные заданием типы (BR-018).</Text>
        ) : null}
        <Box style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
          {ctx.types.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => chooseType(t)}
              style={{ ...card, cursor: 'pointer', textAlign: 'left', background: 'transparent' }}
              data-type={t.code}
            >
              <H5 m={0}>{t.name}</H5>
              <Text variant="sm" mt="sm">
                {t.description}
              </Text>
            </button>
          ))}
        </Box>
      </Box>
    )
  }

  const renderEditor = editors[type.interactionKey]
  return (
    <Box data-a11y="component" variant="container">
      {picker ? <MediaPicker call={call} onPick={pickMedia} onClose={() => setPicker(null)} /> : null}
      <H3>
        {itemId ? 'Черновик вопроса' : 'Новый вопрос'} · {type.name}
      </H3>
      {ctx && ctx.assignment ? <Text mb="lg">Задание: {ctx.assignment.title}</Text> : null}

      <FormGroup error={!!errors['document.stem']}>
        <Label required htmlFor="stem">
          Формулировка
        </Label>
        <TextArea id="stem" width={1} rows={3} value={doc.stem} onChange={(e) => patchDoc({ stem: e.target.value })} />
      </FormGroup>

      {renderEditor ? (
        renderEditor()
      ) : (
        <MessageBox variant="danger" message={`Нет редактора для interaction ${type.interactionKey}`} />
      )}

      <H5 mt="xl">Классификация</H5>
      <FormGroup>
        <Label required>Темы</Label>
        <Box flex flexWrap="wrap">
          {ctx.topics.map((t) => (
            <Box key={t.value} mr="xl" mb="sm" flex alignItems="center">
              <CheckBox
                id={`t-${t.value}`}
                checked={meta.topicIds.includes(t.value)}
                onChange={() => toggleMeta('topicIds', t.value)}
              />
              <Label inline htmlFor={`t-${t.value}`} ml="default">
                {t.label}
              </Label>
            </Box>
          ))}
        </Box>
      </FormGroup>
      {objectivesForTopics.length ? (
        <FormGroup>
          <Label>Учебные цели</Label>
          {objectivesForTopics.map((o) => (
            <Box key={o.value} mb="sm" flex alignItems="center">
              <CheckBox
                id={`o-${o.value}`}
                checked={meta.objectiveIds.includes(o.value)}
                onChange={() => toggleMeta('objectiveIds', o.value)}
              />
              <Label inline htmlFor={`o-${o.value}`} ml="default">
                {o.label}
              </Label>
            </Box>
          ))}
        </FormGroup>
      ) : null}
      <Box flex>
        <FormGroup mr="xl" style={{ width: 220 }}>
          <Label htmlFor="item-difficulty">Сложность</Label>
          <Select
            inputId="item-difficulty"
            value={DIFFICULTY.find((d) => d.value === meta.difficulty)}
            options={DIFFICULTY}
            onChange={(o) => setMeta({ ...meta, difficulty: o ? o.value : 3 })}
          />
        </FormGroup>
        <FormGroup mr="xl">
          <Label htmlFor="f-points">Баллы по умолчанию</Label>
          <Input
            id="f-points"
            type="number"
            min="0.5"
            step="0.5"
            value={meta.defaultPoints}
            onChange={(e) => setMeta({ ...meta, defaultPoints: e.target.value })}
          />
        </FormGroup>
        <FormGroup style={{ flex: 1 }}>
          <Label htmlFor="f-tags">Теги (через запятую)</Label>
          <Input
            id="f-tags"
            width={1}
            value={Array.isArray(meta.tags) ? meta.tags.join(', ') : meta.tags}
            onChange={(e) => setMeta({ ...meta, tags: e.target.value })}
          />
        </FormGroup>
      </Box>
      <FormGroup>
        <Label htmlFor="f-feedback">Пояснение после ответа (feedback)</Label>
        <TextArea
          id="f-feedback"
          width={1}
          rows={2}
          value={meta.feedback || ''}
          onChange={(e) => setMeta({ ...meta, feedback: e.target.value })}
        />
      </FormGroup>

      {message ? <MessageBox variant="danger" message={message} mb="lg" /> : null}
      {Object.keys(errors).length ? (
        <MessageBox variant="danger" mb="lg">
          {Object.entries(errors).map(([k, v]) => (
            <Text key={k}>• {v}</Text>
          ))}
        </MessageBox>
      ) : null}
      {itemId && (errorIssues.length || warnIssues.length) ? (
        <Box mb="lg" data-testid="issues">
          <Label>Проверка перед экспертизой</Label>
          {errorIssues.map((i, n) => (
            <Text key={`e${n}`} color="error">
              ✖ {i.message}
            </Text>
          ))}
          {warnIssues.map((i, n) => (
            <Text key={`w${n}`} color="grey60">
              ⚠ {i.message}
            </Text>
          ))}
        </Box>
      ) : itemId ? (
        <MessageBox variant="success" message="Проверка пройдена: вопрос готов к экспертизе" mb="lg" />
      ) : null}

      <Box flex>
        <Button variant="contained" type="button" onClick={save} disabled={busy}>
          {busy ? 'Сохранение…' : itemId ? 'Сохранить черновик' : 'Создать вопрос'}
        </Button>
        {itemId ? (
          <Button
            ml="default"
            variant="text"
            type="button"
            as="a"
            href={`/admin/resources/Item/records/${itemId}/show`}
          >
            К карточке вопроса
          </Button>
        ) : null}
      </Box>
    </Box>
  )
}

export default ItemEditor
