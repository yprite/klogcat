import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LogRow } from '../components/LogRow'
import { LogViewer } from '../components/LogViewer'
import { resetLogStoreForTests, useLogStore } from '../stores/logStore'
import type { ParsedLogLine } from '../types/log'

const row: ParsedLogLine = { id: 1, streamId: 's', sourceId: 'src', sourceType: 'access', namespace: 'ns', pod: 'p', container: 'c', filePath: '/x', raw: '{"message":"hello"}', parseStatus: 'parsed', receivedAt: Date.UTC(2026,0,1), status: '500', method: 'POST', url: '/x', elapsed: 42, summary: 'POST /x 500 42ms', trId: 't' }
const errRow: ParsedLogLine = { id: 2, streamId: 's', sourceId: 'src', sourceType: 'error', namespace: 'ns', pod: 'p', container: 'c', filePath: '/x', raw: '{"message":"oops"}', parseStatus: 'parsed', receivedAt: Date.UTC(2026,0,1), errorMethod: 'GET', errorPath: '/fail', errorReason: 'boom', summary: 'boom GET /fail', traceId: 'trace' }

describe('LogRow', () => {
  it('renders access logs as key columns instead of one collapsed sentence', () => {
    render(<LogRow row={row} grepQuery="post" visibleColumns={['method','url','status','elapsed','trId']} />)
    expect(screen.getByText('method')).toBeInTheDocument()
    expect(screen.getByText('url')).toBeInTheDocument()
    expect(screen.getByText('status')).toBeInTheDocument()
    expect(screen.getByText('POST')).toBeInTheDocument()
    expect(screen.getByText('/x')).toBeInTheDocument()
    expect(screen.getByText('500')).toBeInTheDocument()
  })

  it('renders error logs as key columns', () => {
    render(<LogRow row={errRow} grepQuery="" visibleColumns={['errorMethod','errorPath','errorReason','traceId']} />)
    expect(screen.getByText('errorMethod')).toBeInTheDocument()
    expect(screen.getByText('errorPath')).toBeInTheDocument()
    expect(screen.getByText('GET')).toBeInTheDocument()
    expect(screen.getByText('/fail')).toBeInTheDocument()
  })
})

describe('LogViewer', () => {
  beforeEach(() => resetLogStoreForTests())

  it('uses an always-visible scroll container and shows right-side column visibility options', () => {
    useLogStore.setState({ rows: [row, errRow], visibleRows: [row, errRow] })
    render(<LogViewer />)

    expect(screen.getByTestId('log-scroll')).toHaveClass('overflow-scroll')
    expect(screen.getByRole('group', { name: /column visibility/i })).toHaveClass('order-last')
    expect(screen.getByLabelText('status')).toBeChecked()
    expect(screen.getByLabelText('errorReason')).toBeChecked()
  })
})
