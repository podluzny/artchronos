import React from 'react'
import { Box, Label } from '@adminjs/design-system'

const JsonView = (props) => {
  const { record, property } = props
  return (
    <Box mb="xl">
      <Label>{property.label}</Label>
      <pre
        style={{
          whiteSpace: 'pre-wrap',
          fontSize: 13,
          background: 'rgba(127,127,127,0.08)',
          padding: 12,
          borderRadius: 4,
          margin: 0,
        }}
      >
        {record.params[property.path]}
      </pre>
    </Box>
  )
}

export default JsonView
