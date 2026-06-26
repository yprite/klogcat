import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FailedRequestsView } from '../components/FailedRequestsView'
import { resetLogStoreForTests, useLogStore } from '../stores/logStore'
import type { ParsedLogLine } from '../types/log'

const row: ParsedLogLine = { id: 1, streamId: 's', sourceId: 'src', sourceType: 'access', namespace: 'ns', pod: 'p', container: 'c', filePath: '/x', raw: '{}', parseStatus: 'parsed', receivedAt: 1, summary: 'raw', trId: 'trx-1' }

describe('FailedRequestsView', () => {
  beforeEach(() => resetLogStoreForTests())

  it('introduces the request-centric layer without replacing raw logs', () => {
    useLogStore.setState({ rows: [row], visibleRows: [row] })
    render(<FailedRequestsView />)

    expect(screen.getByTestId('failed-requests-view')).toBeInTheDocument()
    expect(screen.getByText('Request-centric investigation layer')).toBeInTheDocument()
    expect(screen.getByText('trId → traceId')).toBeInTheDocument()
    expect(screen.getByText('Preserved as source of truth')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
  })

  it('groups failed access and error rows into request cards without dropping raw rows', () => {
    const accessFailure: ParsedLogLine = { ...row, id: 1, raw: 'access raw', summary: 'GET /api/orders 503', sourceType: 'access', sourceId: 'src-a', status: '503', method: 'GET', url: '/api/orders', elapsed: 87 }
    const errorFailure: ParsedLogLine = { ...row, id: 2, raw: 'error raw', summary: 'IllegalStateException', sourceType: 'error', sourceId: 'src-e', errorMethod: 'GET', errorPath: '/api/orders', errorReason: 'db timeout' }
    const successfulRequest: ParsedLogLine = { ...row, id: 3, trId: 'ok-1', raw: 'ok raw', summary: 'GET /health 200', status: '200' }

    useLogStore.setState({ rows: [accessFailure, errorFailure, successfulRequest], visibleRows: [accessFailure, errorFailure, successfulRequest] })
    render(<FailedRequestsView />)

    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('trx-1')).toBeInTheDocument()
    expect(screen.getByText('GET /api/orders')).toBeInTheDocument()
    expect(screen.getByText('503')).toBeInTheDocument()
    expect(screen.getByText('db timeout')).toBeInTheDocument()
    expect(screen.getByText((_content, element) => element?.textContent === 'Raw rows: 2')).toBeInTheDocument()
    expect(screen.queryByText('ok-1')).not.toBeInTheDocument()
  })

  it('keeps full correlated evidence when the query only leaves one row visible', () => {
    const accessFailure: ParsedLogLine = { ...row, id: 1, raw: 'access raw', summary: 'GET /api/orders 503', sourceType: 'access', sourceId: 'src-a', status: '503', method: 'GET', url: '/api/orders', elapsed: 87 }
    const errorFailure: ParsedLogLine = { ...row, id: 2, raw: 'error raw boom', summary: 'IllegalStateException boom', sourceType: 'error', sourceId: 'src-e', errorMethod: 'GET', errorPath: '/api/orders', errorReason: 'db timeout' }
    const unrelatedFailure: ParsedLogLine = { ...row, id: 3, trId: 'trx-2', raw: 'other access raw', summary: 'POST /api/pay 500', sourceType: 'access', sourceId: 'src-other', status: '500', method: 'POST', url: '/api/pay' }

    useLogStore.setState({
      rows: [accessFailure, errorFailure, unrelatedFailure],
      visibleRows: [errorFailure],
      grepQuery: 'boom',
    })
    render(<FailedRequestsView />)

    expect(screen.getByText('trx-1')).toBeInTheDocument()
    expect(screen.getByText('GET /api/orders')).toBeInTheDocument()
    expect(screen.getByText('503')).toBeInTheDocument()
    expect(screen.getByText((_content, element) => element?.textContent === 'Raw rows: 2')).toBeInTheDocument()
    expect(screen.queryByText('trx-2')).not.toBeInTheDocument()
  })
})
