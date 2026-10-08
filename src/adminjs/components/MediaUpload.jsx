import React, { useState } from 'react'
import {
  Box,
  Button,
  CheckBox,
  DropZone,
  FormGroup,
  H5,
  Input,
  Label,
  MessageBox,
  Select,
  Text,
  TextArea,
} from '@adminjs/design-system'
import { ApiClient, useNotice } from 'adminjs'

const api = new ApiClient()

const LICENSES = [
  ['UNKNOWN', 'Не указана'],
  ['PUBLIC_DOMAIN', 'Общественное достояние'],
  ['CC0', 'CC0'],
  ['CC_BY', 'CC BY'],
  ['CC_BY_SA', 'CC BY-SA'],
  ['CC_BY_NC', 'CC BY-NC'],
  ['CC_BY_NC_SA', 'CC BY-NC-SA'],
  ['LICENSED', 'По лицензии/договору'],
  ['EDUCATIONAL_EXCEPTION', 'Учебное использование (норма закона)'],
].map(([value, label]) => ({ value, label }))

const TEXT = [
  ['title', 'Название', true],
  ['altText', 'Альтернативный текст (что изображено) — обязателен для использования в вопросе'],
  ['artist', 'Автор произведения'],
  ['workTitle', 'Название произведения'],
  ['dateText', 'Датировка'],
  ['technique', 'Техника, материал'],
  ['collection', 'Собрание / музей'],
  ['sourceUrl', 'Источник (URL)'],
  ['rightsHolder', 'Правообладатель'],
  ['creditLine', 'Строка атрибуции (credit line)'],
  ['tags', 'Теги через запятую'],
]

/** Загрузка медиа (SPEC-MEDIA-001). Формат и права проверяет сервер; статус прав при загрузке всегда «не проверено». */
const MediaUpload = (props) => {
  const { resource, action } = props
  const [file, setFile] = useState(null)
  const [values, setValues] = useState({ depictsArtwork: true, license: 'UNKNOWN' })
  const [error, setError] = useState(null)
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const sendNotice = useNotice()
  const set = (k, v) => setValues({ ...values, [k]: v })

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setErrors({})
    const fd = new FormData()
    if (file) fd.append('file', file)
    Object.entries(values).forEach(([k, v]) => fd.append(k, String(v)))
    try {
      const res = await api.resourceAction({
        resourceId: resource.id,
        actionName: action.name,
        method: 'post',
        data: fd,
      })
      const d = res.data || {}
      if (d.notice) sendNotice(d.notice)
      if (d.notice && d.notice.type === 'error') {
        setError(d.notice.message)
        setErrors(d.errors || {})
      } else if (d.redirectUrl) window.location.href = d.redirectUrl
    } catch (err) {
      setError('Не удалось загрузить файл')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Box variant="container" as="form" onSubmit={submit}>
      <FormGroup>
        <Label required>Файл</Label>
        <DropZone
          onChange={(files) => setFile(files[0] || null)}
          validate={{
            maxSize: 50 * 1024 * 1024,
            mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/tiff', 'video/mp4', 'video/webm'],
          }}
        />
        <Text variant="sm" mt="sm">
          JPEG, PNG, WebP, TIFF до 50 МБ; MP4, WebM. Формат проверяется по содержимому файла.
        </Text>
      </FormGroup>
      {TEXT.map(([k, label, req]) => (
        <FormGroup key={k} error={!!errors[k]}>
          <Label required={!!req} htmlFor={k}>
            {label}
          </Label>
          {k === 'altText' ? (
            <TextArea id={k} width={1} rows={2} value={values[k] || ''} onChange={(e) => set(k, e.target.value)} />
          ) : (
            <Input id={k} width={1} value={values[k] || ''} onChange={(e) => set(k, e.target.value)} />
          )}
          {errors[k] ? (
            <Text variant="sm" color="error">
              {errors[k]}
            </Text>
          ) : null}
        </FormGroup>
      ))}
      <FormGroup>
        <Label>Лицензия</Label>
        <Select
          value={LICENSES.find((l) => l.value === values.license)}
          options={LICENSES}
          onChange={(o) => set('license', o ? o.value : 'UNKNOWN')}
        />
      </FormGroup>
      <FormGroup>
        <Box flex alignItems="center">
          <CheckBox
            id="depictsArtwork"
            checked={!!values.depictsArtwork}
            onChange={() => set('depictsArtwork', !values.depictsArtwork)}
          />
          <Label inline htmlFor="depictsArtwork" ml="default">
            Изображено произведение искусства
          </Label>
        </Box>
      </FormGroup>
      <H5 mt="lg">Права</H5>
      <Text variant="sm" mb="lg">
        Статус прав подтверждает преподаватель или администратор после проверки сведений (BR-045).
      </Text>
      {error ? <MessageBox variant="danger" message={error} mb="lg" /> : null}
      <Button variant="contained" type="submit" disabled={busy}>
        {busy ? 'Загрузка…' : 'Загрузить'}
      </Button>
    </Box>
  )
}

export default MediaUpload
