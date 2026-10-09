import React, { useEffect, useState } from 'react'
import {
  Badge,
  Box,
  Button,
  CheckBox,
  H3,
  H5,
  Input,
  Label,
  Loader,
  MessageBox,
  Select,
  Text,
} from '@adminjs/design-system'
import { ApiClient, useNotice } from 'adminjs'

const api = new ApiClient()
const card = { border: '1px solid rgba(127,127,127,0.3)', borderRadius: 6, padding: 12, marginBottom: 12 }
const row = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 0',
  borderBottom: '1px dashed rgba(127,127,127,0.25)',
}

const STATE = {
  DRAFT: 'Черновик',
  READY_FOR_REVIEW: 'Отправлено',
  IN_REVIEW: 'На экспертизе',
  CHANGES_REQUESTED: 'На доработке',
  APPROVED: 'Утверждено',
  PUBLISHED: 'Опубликовано',
  ARCHIVED: 'В архиве',
}
const NAV = [
  { value: 'FREE', label: 'Свободная' },
  { value: 'LINEAR', label: 'Линейная (без возврата)' },
]
const FEEDBACK = [
  { value: 'AFTER_SUBMIT', label: 'После завершения попытки' },
  { value: 'AFTER_CLOSE', label: 'После закрытия тестирования' },
  { value: 'NONE', label: 'Не показывать' },
]

const plain = (html, max = 120) => {
  const t = String(html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t || '(без формулировки)'
}

/** Настройки версии (SPEC-TEST-003). Время вводится в минутах. */
const SettingsForm = ({ d, disabled, onSave }) => {
  const s = d.version.settings
  const [v, setV] = useState({
    title: d.version.title,
    timeLimitMin: s.timeLimitSec ? String(s.timeLimitSec / 60) : '',
    navigation: s.navigation,
    maxAttempts: s.maxAttempts === null ? '' : String(s.maxAttempts),
    shuffleSections: s.shuffleSections,
    shuffleItems: s.shuffleItems,
    shuffleOptions: s.shuffleOptions,
    feedbackMode: s.feedbackMode,
    passingScore: s.scoring.passingScore === null ? '' : String(s.scoring.passingScore),
  })
  const set = (k, x) => setV({ ...v, [k]: x })
  const save = () =>
    onSave({
      title: v.title,
      settings: {
        timeLimitSec: v.timeLimitMin === '' ? null : Math.round(Number(v.timeLimitMin) * 60),
        navigation: v.navigation,
        maxAttempts: v.maxAttempts === '' ? null : Number(v.maxAttempts),
        shuffleSections: v.shuffleSections,
        shuffleItems: v.shuffleItems,
        shuffleOptions: v.shuffleOptions,
        feedbackMode: v.feedbackMode,
        passingScore: v.passingScore === '' ? null : Number(v.passingScore),
      },
    })
  const check = (k, label) => (
    <Box flex alignItems="center" mr="xl" mb="default">
      <CheckBox id={`set-${k}`} checked={!!v[k]} disabled={disabled} onChange={() => set(k, !v[k])} />
      <Label inline htmlFor={`set-${k}`} ml="default" mb={0}>
        {label}
      </Label>
    </Box>
  )
  return (
    <Box style={card}>
      <H5>Настройки</H5>
      <Box flex flexWrap="wrap" style={{ gap: 16 }}>
        <Box style={{ minWidth: 260, flex: 2 }}>
          <Label htmlFor="test-title">Название</Label>
          <Input
            id="test-title"
            width={1}
            value={v.title}
            disabled={disabled}
            onChange={(e) => set('title', e.target.value)}
          />
        </Box>
        <Box style={{ width: 170 }}>
          <Label htmlFor="set-time">Лимит времени, мин</Label>
          <Input
            id="set-time"
            width={1}
            value={v.timeLimitMin}
            placeholder="без лимита"
            disabled={disabled}
            onChange={(e) => set('timeLimitMin', e.target.value)}
          />
        </Box>
        <Box style={{ width: 150 }}>
          <Label htmlFor="set-attempts">Попыток</Label>
          <Input
            id="set-attempts"
            width={1}
            value={v.maxAttempts}
            placeholder="без ограничения"
            disabled={disabled}
            onChange={(e) => set('maxAttempts', e.target.value)}
          />
        </Box>
        <Box style={{ width: 150 }}>
          <Label htmlFor="set-pass">Проходной балл</Label>
          <Input
            id="set-pass"
            width={1}
            value={v.passingScore}
            placeholder={`из ${d.maxScore}`}
            disabled={disabled}
            onChange={(e) => set('passingScore', e.target.value)}
          />
        </Box>
        <Box style={{ width: 240 }}>
          <Label htmlFor="set-nav">Навигация</Label>
          <Select
            inputId="set-nav"
            isDisabled={disabled}
            value={NAV.find((x) => x.value === v.navigation)}
            options={NAV}
            onChange={(x) => set('navigation', x.value)}
          />
        </Box>
        <Box style={{ width: 280 }}>
          <Label htmlFor="set-feedback">Показ правильных ответов</Label>
          <Select
            inputId="set-feedback"
            isDisabled={disabled}
            value={FEEDBACK.find((x) => x.value === v.feedbackMode)}
            options={FEEDBACK}
            onChange={(x) => set('feedbackMode', x.value)}
          />
        </Box>
      </Box>
      <Box flex flexWrap="wrap" mt="lg">
        {check('shuffleSections', 'Перемешивать разделы')}
        {check('shuffleItems', 'Перемешивать вопросы')}
        {check('shuffleOptions', 'Перемешивать варианты')}
      </Box>
      {disabled ? null : (
        <Button type="button" onClick={save} mt="default">
          Сохранить настройки
        </Button>
      )}
    </Box>
  )
}

/** Форма правила случайного отбора (только Teacher/Admin, BR-012). */
const RuleForm = ({ ctx, call, testId, sectionId, onAdd }) => {
  const [topicIds, setTopicIds] = useState([])
  const [min, setMin] = useState('')
  const [max, setMax] = useState('')
  const [count, setCount] = useState('1')
  const [pts, setPts] = useState('1')
  const [pool, setPool] = useState(null)
  const filter = () => ({
    topicIds,
    difficultyMin: min === '' ? null : Number(min),
    difficultyMax: max === '' ? null : Number(max),
    questionTypeIds: ctx.assignmentTypeIds || [],
  })
  useEffect(() => {
    call({ op: 'poolSize', testId, filter: filter() }).then((r) => setPool(r.ok ? r.poolSize : null))
  }, [topicIds.join(), min, max])
  return (
    <Box mt="default" p="default" style={{ background: 'rgba(127,127,127,0.07)', borderRadius: 6 }}>
      <Text mb="sm">Правило случайного отбора: темы</Text>
      <Box flex flexWrap="wrap">
        {ctx.topics.map((t) => (
          <Box key={t.value} flex alignItems="center" mr="lg" mb="sm">
            <CheckBox
              id={`rt-${sectionId}-${t.value}`}
              checked={topicIds.includes(t.value)}
              onChange={() =>
                setTopicIds(topicIds.includes(t.value) ? topicIds.filter((x) => x !== t.value) : [...topicIds, t.value])
              }
            />
            <Label inline htmlFor={`rt-${sectionId}-${t.value}`} ml="default" mb={0}>
              {t.label}
            </Label>
          </Box>
        ))}
      </Box>
      <Box flex alignItems="flex-end" style={{ gap: 10 }} mt="sm">
        <Box style={{ width: 110 }}>
          <Label htmlFor={`rule-min-${sectionId}`}>Сложн. от</Label>
          <Input id={`rule-min-${sectionId}`} width={1} value={min} onChange={(e) => setMin(e.target.value)} />
        </Box>
        <Box style={{ width: 110 }}>
          <Label htmlFor={`rule-max-${sectionId}`}>до</Label>
          <Input id={`rule-max-${sectionId}`} width={1} value={max} onChange={(e) => setMax(e.target.value)} />
        </Box>
        <Box style={{ width: 110 }}>
          <Label>Вопросов</Label>
          <Input
            width={1}
            aria-label="Количество вопросов правила"
            value={count}
            onChange={(e) => setCount(e.target.value)}
          />
        </Box>
        <Box style={{ width: 110 }}>
          <Label htmlFor={`rule-pts-${sectionId}`}>Баллов за вопрос</Label>
          <Input id={`rule-pts-${sectionId}`} width={1} value={pts} onChange={(e) => setPts(e.target.value)} />
        </Box>
        <Text mb="sm" data-testid="pool-size">
          В пуле: {pool === null ? '…' : pool}
        </Text>
        <Button type="button" size="sm" onClick={() => onAdd({ filter: filter(), count, pointsPerItem: pts })}>
          Добавить правило
        </Button>
      </Box>
    </Box>
  )
}

/** Конструктор теста (SPEC-TEST-002/003): разделы, фиксированные вопросы, правила, настройки, готовность. */
const TestBuilder = (props) => {
  const { record, resource, action } = props
  const sendNotice = useNotice()
  const [d, setD] = useState(null)
  const [ctx, setCtx] = useState(null)
  const [error, setError] = useState(null)
  const [candidates, setCandidates] = useState([])
  const [target, setTarget] = useState(null)
  const [ruleFor, setRuleFor] = useState(null)
  const [newSection, setNewSection] = useState('')

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

  const load = async () => {
    const r = await call({ op: 'load', testId: record.id })
    if (!r.ok) return setError(r.message)
    setD(r.details)
    setCtx(r.context)
    setCandidates(r.candidates)
    setTarget((t) => t || r.details.sections[0]?.id || null)
  }
  useEffect(() => {
    load()
  }, [])

  const op = async (data, okMessage) => {
    const r = await call({ ...data, testId: record.id, revision: d.version.revision })
    if (!r.ok) {
      sendNotice({ message: r.message, type: 'error' })
      setError(r.message)
      return null
    }
    setError(null)
    if (okMessage) sendNotice({ message: okMessage, type: 'success' })
    await load()
    return r
  }

  if (error && !d) return <MessageBox variant="danger" message={error} />
  if (!d) return <Loader />
  const edit = d.canEdit
  const errors = d.issues.filter((i) => i.severity === 'ERROR')
  const sectionOptions = d.sections.map((s) => ({ value: s.id, label: s.title }))

  return (
    <Box data-a11y="component" variant="container">
      <Box flex justifyContent="space-between" alignItems="center" mb="lg">
        <H3 mb={0}>
          {d.version.title} · v{d.version.versionNo}{' '}
          <Badge variant={d.version.state === 'DRAFT' ? 'info' : 'primary'} data-testid="test-state">
            {STATE[d.version.state]}
          </Badge>
        </H3>
        <Text>
          Вопросов: <b data-testid="item-count">{d.itemCount}</b> · Макс. балл: <b>{d.maxScore}</b>
          {d.assignment
            ? ` · Задание: ${d.assignment.title} (${d.assignment.minItems}–${d.assignment.maxItems} вопросов)`
            : ''}
        </Text>
      </Box>
      {!edit ? (
        <MessageBox
          variant="info"
          mb="lg"
          message={
            d.version.state === 'DRAFT'
              ? 'Только просмотр'
              : 'Версия заморожена (BR-007). Изменения — через «Новая версия».'
          }
        />
      ) : null}
      {error ? <MessageBox variant="danger" message={error} mb="lg" /> : null}

      <SettingsForm
        key={d.version.revision}
        d={d}
        disabled={!edit}
        onSave={(v) => op({ op: 'saveSettings', ...v }, 'Настройки сохранены')}
      />

      {d.sections.map((s, si) => (
        <Box key={s.id} style={card} data-testid="section">
          <Box flex alignItems="center" justifyContent="space-between">
            <H5 mb={0}>
              {si + 1}. {s.title}
            </H5>
            {edit ? (
              <Box flex>
                <Button
                  size="sm"
                  variant="text"
                  type="button"
                  title="Выше"
                  onClick={() => op({ op: 'moveSection', sectionId: s.id, direction: -1 })}
                >
                  ↑
                </Button>
                <Button
                  size="sm"
                  variant="text"
                  type="button"
                  title="Ниже"
                  onClick={() => op({ op: 'moveSection', sectionId: s.id, direction: 1 })}
                >
                  ↓
                </Button>
                <Button
                  size="sm"
                  variant="text"
                  type="button"
                  onClick={() => {
                    const t = window.prompt('Название раздела', s.title)
                    if (t) op({ op: 'renameSection', sectionId: s.id, title: t })
                  }}
                >
                  Переименовать
                </Button>
                <Button
                  size="sm"
                  variant="text"
                  type="button"
                  color="danger"
                  onClick={() => op({ op: 'removeSection', sectionId: s.id })}
                >
                  Удалить раздел
                </Button>
              </Box>
            ) : null}
          </Box>
          {s.items.length === 0 && s.rules.length === 0 ? <Text mt="default">Раздел пуст</Text> : null}
          {s.items.map((it) => (
            <div key={it.id} style={row} data-testid="test-item">
              <Box style={{ flex: 1 }}>
                <Text>{plain(it.stem)}</Text>
                <Text variant="sm">
                  {it.questionTypeName} · v{it.versionNo} · {STATE[it.versionState]}
                  {it.newerApprovedVersionNo ? ` · доступна версия ${it.newerApprovedVersionNo}` : ''}
                </Text>
              </Box>
              {edit && it.newerApprovedVersionNo ? (
                <Button
                  size="sm"
                  type="button"
                  variant="outlined"
                  onClick={() => op({ op: 'upgradeItem', entryId: it.id }, 'Ссылка обновлена')}
                >
                  Обновить до v{it.newerApprovedVersionNo}
                </Button>
              ) : null}
              <Box style={{ width: 90 }}>
                <Input
                  width={1}
                  aria-label="Баллы"
                  defaultValue={it.points}
                  disabled={!edit}
                  onBlur={(e) =>
                    Number(e.target.value) !== it.points &&
                    op({ op: 'updateItem', entryId: it.id, points: e.target.value })
                  }
                />
              </Box>
              {edit ? (
                <>
                  <Button
                    size="sm"
                    variant="text"
                    type="button"
                    onClick={() => op({ op: 'moveItem', entryId: it.id, direction: -1 })}
                  >
                    ↑
                  </Button>
                  <Button
                    size="sm"
                    variant="text"
                    type="button"
                    onClick={() => op({ op: 'moveItem', entryId: it.id, direction: 1 })}
                  >
                    ↓
                  </Button>
                  <Button
                    size="sm"
                    variant="text"
                    type="button"
                    title="Убрать из теста"
                    onClick={() => op({ op: 'removeItem', entryId: it.id })}
                  >
                    ✕
                  </Button>
                </>
              ) : null}
            </div>
          ))}
          {s.rules.map((r) => (
            <div key={r.id} style={row} data-testid="test-rule">
              <Box style={{ flex: 1 }}>
                <Text>
                  Случайно {r.count} вопр. × {r.pointsPerItem} б. — темы:{' '}
                  {r.filter.topicIds.map((t) => ctx.topics.find((x) => x.value === t)?.label || t).join(', ') || 'все'}
                  {r.filter.difficultyMin || r.filter.difficultyMax
                    ? ` · сложность ${r.filter.difficultyMin || 1}–${r.filter.difficultyMax || 5}`
                    : ''}
                </Text>
                <Text variant="sm" color={r.poolSize < r.count ? 'error' : undefined}>
                  В пуле: {r.poolSize} {r.poolSize < r.count ? '— недостаточно (BR-012)' : ''}
                </Text>
              </Box>
              {edit ? (
                <Button size="sm" variant="text" type="button" onClick={() => op({ op: 'removeRule', ruleId: r.id })}>
                  ✕
                </Button>
              ) : null}
            </div>
          ))}
          {edit && d.canUseRules ? (
            ruleFor === s.id ? (
              <RuleForm
                ctx={ctx}
                call={call}
                testId={record.id}
                sectionId={s.id}
                onAdd={async (x) => {
                  if (await op({ op: 'addRule', sectionId: s.id, ...x }, 'Правило добавлено')) setRuleFor(null)
                }}
              />
            ) : (
              <Button size="sm" variant="text" type="button" mt="default" onClick={() => setRuleFor(s.id)}>
                + Правило случайного отбора
              </Button>
            )
          ) : null}
        </Box>
      ))}

      {edit ? (
        <Box flex alignItems="center" mb="xl" style={{ gap: 8 }}>
          <Input
            value={newSection}
            aria-label="Название нового раздела"
            placeholder="Название нового раздела"
            onChange={(e) => setNewSection(e.target.value)}
          />
          <Button
            type="button"
            variant="outlined"
            onClick={async () => {
              if (await op({ op: 'addSection', title: newSection || `Раздел ${d.sections.length + 1}` }))
                setNewSection('')
            }}
          >
            Добавить раздел
          </Button>
        </Box>
      ) : null}

      {edit ? (
        <Box style={card}>
          <H5>Добавить вопросы</H5>
          <Box flex alignItems="center" mb="default" style={{ gap: 8 }}>
            <Text>В раздел:</Text>
            <Box style={{ width: 260 }}>
              <Select
                aria-label="Раздел для добавления вопросов"
                value={sectionOptions.find((x) => x.value === target) || null}
                options={sectionOptions}
                onChange={(x) => setTarget(x.value)}
              />
            </Box>
            <a href={`/admin/resources/Item/actions/new${d.assignment ? `?assignmentId=${d.assignment.id}` : ''}`}>
              Создать новый вопрос
            </a>
          </Box>
          {candidates.length === 0 ? <Text>Нет доступных вопросов: все уже в тесте или банк пуст.</Text> : null}
          {candidates.map((c) => (
            <div key={c.id} style={row} data-testid="candidate">
              <Box style={{ flex: 1 }}>
                <Text>{c.stem}</Text>
                <Text variant="sm">
                  {c.questionType} · v{c.versionNo} · {STATE[c.state]} · {c.owner}
                </Text>
              </Box>
              <Button
                size="sm"
                type="button"
                disabled={!target}
                onClick={() => op({ op: 'addItem', sectionId: target, itemId: c.id }, 'Вопрос добавлен')}
              >
                Добавить
              </Button>
            </div>
          ))}
        </Box>
      ) : null}

      {d.version.state === 'DRAFT' ? (
        <Box style={card} data-testid="readiness">
          <H5>Готовность к отправке</H5>
          {errors.length === 0 ? (
            <MessageBox variant="success" message="Тест готов к отправке на экспертизу" />
          ) : (
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {errors.map((i, k) => (
                <li key={k}>
                  <Text color="error">{i.message}</Text>
                </li>
              ))}
            </ul>
          )}
        </Box>
      ) : null}
    </Box>
  )
}

export default TestBuilder
