import React, { useEffect, useState } from 'react'
import { Box, H4, H5, Loader, MessageBox, Text } from '@adminjs/design-system'
import { ApiClient } from 'adminjs'

const api = new ApiClient()
const letter = (i) => String.fromCharCode(1040 + (i >= 9 ? i + 1 : i))
const fmt = (d) => (d ? new Date(d).toLocaleDateString('ru-RU') : '')

/** Быстрый просмотр вопроса в выдвижной панели списка банка (SPEC-ITEM-005): предпросмотр и история версий. */
const ItemCard = (props) => {
  const { record, resource, action } = props
  const [d, setD] = useState(null)
  const [error, setError] = useState(null)
  useEffect(() => {
    api
      .recordAction({
        resourceId: resource.id,
        recordId: record.id,
        actionName: action.name,
        method: 'post',
        data: { op: 'card', itemId: record.id },
      })
      .then((res) => {
        const r = res.data || {}
        if (!r.ok) setError(r.message)
        else setD(r)
      })
  }, [record.id])
  if (error) return <MessageBox variant="danger" message={error} />
  if (!d) return <Loader />
  const p = d.preview
  return (
    <Box data-a11y="component" p="lg" data-testid="item-card">
      <H4>
        {p.typeName} · v{p.versionNo}
      </H4>
      <Text variant="sm" mb="default">
        {d.meta.owner} · {d.meta.course}
        {d.meta.assignment ? ` · ${d.meta.assignment}` : ''}
        {d.meta.issues ? ` · ошибок проверки: ${d.meta.issues}` : ''}
      </Text>
      {p.media
        .filter((m) => m.role === 'STIMULUS')
        .map((m) => (
          <img
            key={m.mediaAssetId}
            src={`/admin/media-file/${m.mediaAssetId}/thumb`}
            alt={m.altTextOverride || 'стимул'}
            style={{ maxWidth: 240, borderRadius: 4 }}
          />
        ))}
      <Box my="default" dangerouslySetInnerHTML={{ __html: p.stem }} />
      {p.options.map((o, i) => (
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
      <H5 mt="xl">История версий</H5>
      <Box data-testid="item-card-versions">
        {d.versions.map((v) => (
          <Text key={v.versionNo}>
            v{v.versionNo} — {v.label} · создана {fmt(v.createdAt)}
            {v.approvedAt ? ` · утверждена ${fmt(v.approvedAt)}` : ''}
          </Text>
        ))}
      </Box>
    </Box>
  )
}

export default ItemCard
