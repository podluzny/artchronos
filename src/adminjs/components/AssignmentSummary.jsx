import React, { useEffect, useState } from 'react'
import {
  Box,
  H3,
  Loader,
  MessageBox,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Text,
} from '@adminjs/design-system'
import { ApiClient } from 'adminjs'

const api = new ApiClient()
const STATE = {
  DRAFT: 'Черновик',
  READY_FOR_REVIEW: 'Отправлено на экспертизу',
  IN_REVIEW: 'На экспертизе',
  CHANGES_REQUESTED: 'Возвращено на доработку',
  APPROVED: 'Утверждено',
  PUBLISHED: 'Опубликовано',
  ARCHIVED: 'В архиве',
}
const fmt = (d) => (d ? new Date(d).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }) : '—')

/** Сводка по заданию (AC-ASSIGN-002.6): состояние последней версии теста каждого адресата. */
const AssignmentSummary = (props) => {
  const { record, resource, action } = props
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)
  useEffect(() => {
    api
      .recordAction({
        resourceId: resource.id,
        recordId: record.id,
        actionName: action.name,
        method: 'post',
        data: { op: 'summary' },
      })
      .then((res) => {
        const r = res.data || {}
        if (!r.ok) setError(r.message)
        else setRows(r.rows)
      })
  }, [])
  if (error) return <MessageBox variant="danger" message={error} />
  if (!rows) return <Loader />
  return (
    <Box variant="container">
      <H3>Сводка: {record.params.title}</H3>
      {rows.length === 0 ? <Text>Адресатов нет</Text> : null}
      <Table data-testid="assignment-summary">
        <TableHead>
          <TableRow>
            <TableCell>Студент</TableCell>
            <TableCell>Тестов</TableCell>
            <TableCell>Последний тест</TableCell>
            <TableCell>Состояние</TableCell>
            <TableCell>Изменен</TableCell>
            <TableCell>Срок</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.userId}>
              <TableCell>
                {r.displayName}
                <Text variant="sm">{r.email}</Text>
              </TableCell>
              <TableCell>{r.testCount}</TableCell>
              <TableCell>
                {r.latestTestId ? (
                  <a href={`/admin/resources/Test/records/${r.latestTestId}/show`}>{r.latestTestTitle}</a>
                ) : (
                  '—'
                )}
              </TableCell>
              <TableCell>{r.latestState ? `v${r.latestVersionNo} — ${STATE[r.latestState]}` : 'не начат'}</TableCell>
              <TableCell>{fmt(r.latestUpdatedAt)}</TableCell>
              <TableCell>
                {fmt(r.deadline)}
                {r.extendedUntil ? ' (продлен)' : ''}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  )
}

export default AssignmentSummary
