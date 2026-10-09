import React, { useEffect, useState } from 'react'
import {
  Box,
  Button,
  CheckBox,
  FormGroup,
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

/**
 * Универсальная форма действия (record- или resource-level).
 * - поля: action.custom.fields = [{ name, label, type: text|password|textarea|select|checkboxes, required }]
 * - варианты и начальные значения: GET-ответ обработчика { options: {field: [{value,label,group?}]}, initial: {...} }
 * - результат: POST-ответ { result: { title, text, link } } или { redirectUrl } или { notice }
 * Компонент не принимает решений о правах: доступность и проверки — на сервере (ADR-004).
 */
const ActionForm = (props) => {
  const { record, resource, action } = props
  const custom = action.custom || {}
  const fields = custom.fields || []
  const [values, setValues] = useState({})
  const [options, setOptions] = useState({})
  const [loading, setLoading] = useState(!!custom.loadOptions)
  const [error, setError] = useState(null)
  const [fieldErrors, setFieldErrors] = useState({})
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const sendNotice = useNotice()

  const call = (method, data) =>
    record
      ? api.recordAction({ resourceId: resource.id, recordId: record.id, actionName: action.name, method, data })
      : api.resourceAction({ resourceId: resource.id, actionName: action.name, method, data })

  useEffect(() => {
    if (!custom.loadOptions) return
    call('get')
      .then((response) => {
        const data = response.data || {}
        setOptions(data.options || {})
        setValues(data.initial || {})
      })
      .catch(() => setError('Не удалось загрузить данные формы'))
      .finally(() => setLoading(false))
  }, [])

  const set = (name, value) => setValues({ ...values, [name]: value })

  const toggle = (name, value) => {
    const cur = new Set(values[name] || [])
    if (cur.has(value)) cur.delete(value)
    else cur.add(value)
    set(name, [...cur])
  }

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setFieldErrors({})
    try {
      const payload = {}
      for (const f of fields) {
        const v = values[f.name]
        if (f.type === 'checkboxes') payload[f.name] = JSON.stringify(v || [])
        else if (v !== undefined) payload[f.name] = v
      }
      const response = await call('post', payload)
      const data = response.data || {}
      if (data.notice && data.notice.type === 'error') {
        setError(data.notice.message)
        setFieldErrors(data.errors || {})
        return
      }
      if (data.notice) sendNotice(data.notice)
      if (data.result) setResult(data.result)
      else if (data.redirectUrl) window.location.href = data.redirectUrl
    } catch (e) {
      setError('Не удалось выполнить действие')
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <Loader />

  if (result) {
    return (
      <Box data-a11y="component" variant="container">
        <MessageBox variant="success" message={result.title || 'Готово'} />
        {result.text ? <Text mt="lg">{result.text}</Text> : null}
        {result.link ? (
          <Box mt="lg">
            <Label>Одноразовая ссылка — передайте пользователю, повторно она не показывается</Label>
            <Input width={1} readOnly value={result.link} onFocus={(e) => e.target.select()} />
          </Box>
        ) : null}
        {result.backUrl ? (
          <Box mt="xl">
            <Button as="a" href={result.backUrl}>
              Продолжить
            </Button>
          </Box>
        ) : null}
      </Box>
    )
  }

  const renderField = (f) => {
    const opts = options[f.name] || f.options || []
    if (f.type === 'textarea') {
      return (
        <TextArea
          id={f.name}
          width={1}
          rows={4}
          value={values[f.name] || ''}
          onChange={(e) => set(f.name, e.target.value)}
        />
      )
    }
    if (f.type === 'select') {
      const selected = opts.find((o) => o.value === values[f.name]) || null
      return <Select inputId={f.name} value={selected} options={opts} onChange={(o) => set(f.name, o ? o.value : '')} />
    }
    if (f.type === 'checkboxes') {
      const groups = []
      for (const o of opts) {
        const g = o.group || ''
        let bucket = groups.find((x) => x.name === g)
        if (!bucket) groups.push((bucket = { name: g, items: [] }))
        bucket.items.push(o)
      }
      const checked = new Set(values[f.name] || [])
      return (
        <Box>
          {groups.map((g) => (
            <Box key={g.name} mb="md">
              {g.name ? <H5 mb="sm">{g.name}</H5> : null}
              <Box flex flexWrap="wrap">
                {g.items.map((o) => (
                  <Box key={o.value} mr="xl" mb="sm" flex alignItems="center">
                    <CheckBox
                      id={`${f.name}-${o.value}`}
                      checked={checked.has(o.value)}
                      onChange={() => toggle(f.name, o.value)}
                    />
                    <Label inline htmlFor={`${f.name}-${o.value}`} ml="default">
                      {o.label}
                    </Label>
                  </Box>
                ))}
              </Box>
            </Box>
          ))}
        </Box>
      )
    }
    return (
      <Input
        id={f.name}
        width={1}
        type={f.type || 'text'}
        value={values[f.name] || ''}
        onChange={(e) => set(f.name, e.target.value)}
      />
    )
  }

  return (
    <Box data-a11y="component" variant="container" as="form" onSubmit={submit}>
      {custom.description ? <Text mb="xl">{custom.description}</Text> : null}
      {fields.map((f) => (
        <FormGroup key={f.name} error={!!fieldErrors[f.name]}>
          <Label required={!!f.required} htmlFor={f.name}>
            {f.label}
          </Label>
          {renderField(f)}
          {f.help ? (
            <Text variant="sm" mt="sm">
              {f.help}
            </Text>
          ) : null}
          {fieldErrors[f.name] ? (
            <Text variant="sm" color="error" mt="sm">
              {fieldErrors[f.name]}
            </Text>
          ) : null}
        </FormGroup>
      ))}
      {error ? <MessageBox variant="danger" message={error} mb="lg" /> : null}
      <Button variant={custom.variant || 'contained'} type="submit" disabled={busy}>
        {custom.submitLabel || 'Выполнить'}
      </Button>
    </Box>
  )
}

export default ActionForm
