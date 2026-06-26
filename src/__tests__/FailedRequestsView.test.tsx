import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FailedRequestsExtensionView } from '../extensions/examples/FailedRequestsExtension'
import type { LogViewerExtensionHostApi, LogViewerExtensionSnapshot, SdkLogRow } from '../sdk/log-viewer'

const row: SdkLogRow = {
  id: 1,
  sourceId: 'src',
  sourceType: 'access',
  raw: '{}',
  parseStatus: 'parsed',
  receivedAt: 1,
  summary: 'raw',
  target: { namespace: 'ns', pod: 'p', container: 'c' },
  correlationIds: { trId: 'trx-1' },
  fields: { trId: 'trx-1' },
}

function snapshot(rows: SdkLogRow[]): LogViewerExtensionSnapshot {
  return {
    rows,
    visibleRows: rows,
    totalRowCount: rows.length,
    visibleRowCount: rows.length,
    rowLimit: 50000,
    grepQuery: '',
    grepMode: 'substring',
    viewerPaused: false,
    autoScrollEnabled: true,
    streamStatus: 'running',
    selectedTargetCount: 1,
  }
}

const sdk = {
  protocol: { name: 'klogcat.logViewer', version: 1 },
  getSnapshot: () => snapshot([]),
  subscribe: () => () => undefined,
  grep: { setQuery: () => undefined, setMode: () => undefined },
  viewer: { pause: () => undefined, resume: () => undefined, clear: () => undefined, setAutoScrollEnabled: () => undefined },
  export: { rowsAsJsonl: () => '' },
} satisfies LogViewerExtensionHostApi

describe('FailedRequestsView', () => {
  it('introduces the request-centric layer without replacing raw logs', () => {
    render(<FailedRequestsExtensionView sdk={sdk} snapshot={snapshot([row])} />)

    expect(screen.getByTestId('failed-requests-view')).toBeInTheDocument()
    expect(screen.getByText('Request-centric investigation layer')).toBeInTheDocument()
    expect(screen.getByText('trId -> traceId')).toBeInTheDocument()
    expect(screen.getByText('Preserved as source of truth')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
  })

  it('groups failed access and error rows into request cards without dropping raw rows', () => {
    const accessFailure: SdkLogRow = { ...row, id: 1, raw: 'access raw', summary: 'GET /api/orders 503', sourceType: 'access', sourceId: 'src-a', request: { status: '503', method: 'GET', url: '/api/orders', elapsed: 87 }, fields: { trId: 'trx-1', status: '503', method: 'GET', url: '/api/orders' } }
    const errorFailure: SdkLogRow = { ...row, id: 2, raw: 'error raw', summary: 'IllegalStateException', sourceType: 'error', sourceId: 'src-e', error: { method: 'GET', path: '/api/orders', reason: 'db timeout' }, fields: { trId: 'trx-1', errorMethod: 'GET', errorPath: '/api/orders', errorReason: 'db timeout' } }
    const successfulRequest: SdkLogRow = { ...row, id: 3, correlationIds: { trId: 'ok-1' }, raw: 'ok raw', summary: 'GET /health 200', request: { status: '200' }, fields: { trId: 'ok-1', status: '200' } }

    render(<FailedRequestsExtensionView sdk={sdk} snapshot={snapshot([accessFailure, errorFailure, successfulRequest])} />)

    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('trx-1')).toBeInTheDocument()
    expect(screen.getByText('GET /api/orders')).toBeInTheDocument()
    expect(screen.getByText('503')).toBeInTheDocument()
    expect(screen.getByText('db timeout')).toBeInTheDocument()
    expect(screen.getByText((_content, element) => element?.textContent === 'Raw rows: 2')).toBeInTheDocument()
    expect(screen.queryByText('ok-1')).not.toBeInTheDocument()
  })
})
