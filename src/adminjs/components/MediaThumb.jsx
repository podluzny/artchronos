import React from 'react'
import { Box, Text } from '@adminjs/design-system'

/** Превью медиа в списке и карточке (файл выдается авторизованным endpoint). */
const MediaThumb = (props) => {
  const { record, where } = props
  const src = record.params.thumb
  const big = where === 'show'
  if (!src) return <Text>{record.params.kind === 'VIDEO' ? '🎬 видео' : '—'}</Text>
  return (
    <Box>
      <a href={record.params.file} target="_blank" rel="noreferrer">
        <img
          src={big ? record.params.file.replace('/original', '/preview') : src}
          alt={record.params.altText || record.params.title}
          style={{
            maxWidth: big ? 480 : 72,
            maxHeight: big ? 360 : 54,
            borderRadius: 4,
            objectFit: 'cover',
            display: 'block',
          }}
        />
      </a>
    </Box>
  )
}

export default MediaThumb
