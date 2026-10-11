import React from 'react'
import { Box, Icon, Tooltip } from '@adminjs/design-system'

/** Иконка «?» с короткой подсказкой (тексты — src/adminjs/hints.ts). Пустой текст — ничего не выводится. */
const HelpHint = ({ text }) => {
  if (!text || !String(text).trim()) return null
  return (
    <Box as="span" mx="sm" display="inline-flex" style={{ verticalAlign: 'middle' }} data-testid="help-hint">
      <Tooltip direction="top" title={text} size="lg">
        <Box as="span" tabIndex={0} aria-label={`Подсказка: ${text}`} role="img" display="inline-flex">
          <Icon icon="HelpCircle" color="info" />
        </Box>
      </Tooltip>
    </Box>
  )
}

export default HelpHint
