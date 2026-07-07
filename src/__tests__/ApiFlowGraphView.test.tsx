import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ApiFlowGraphExtensionView, buildApiFlowGraph } from '../extensions/examples/ApiFlowGraphExtension'
import type { LogViewerExtensionHostApi, LogViewerExtensionSnapshot, SdkLogRow } from '../sdk/log-viewer'

function row(overrides: Partial<SdkLogRow>): SdkLogRow {
  return {
    id: 1,
    sourceId: 'src',
    sourceType: 'access',
    raw: '{}',
    parseStatus: 'parsed',
    receivedAt: 1,
    timestamp: '2026-01-01T00:00:00.000Z',
    summary: 'GET /api/orders 200',
    target: { namespace: 'prod', pod: 'gateway-1', container: 'app' },
    correlationIds: { trId: 'tr-1' },
    request: { method: 'GET', url: '/api/orders', status: '200', elapsed: 12 },
    fields: { trId: 'tr-1', module: 'gateway', userId: 'user-7', srcIp: '10.0.0.7' },
    ...overrides,
  }
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

describe('ApiFlowGraphExtensionView', () => {
  it('builds server nodes and animated trID edges from visible SDK rows', () => {
    const rows = [
      row({ id: 1, receivedAt: 10, fields: { trId: 'tr-1', module: 'gateway', userId: 'user-7' } }),
      row({ id: 2, receivedAt: 30, target: { namespace: 'prod', pod: 'orders-1', container: 'app' }, request: { method: 'POST', url: '/internal/orders', status: '200', elapsed: 28 }, fields: { trId: 'tr-1', module: 'orders' } }),
      row({ id: 3, receivedAt: 80, target: { namespace: 'prod', pod: 'payment-1', container: 'app' }, request: { method: 'POST', url: '/internal/payments', status: '200', elapsed: 55 }, fields: { trId: 'tr-1', module: 'payment' } }),
    ]

    const graph = buildApiFlowGraph(rows)

    expect(graph.nodes.map((node) => node.id)).toEqual(['gateway', 'orders', 'payment'])
    expect(graph.edges.map((edge) => edge.id)).toEqual(['gateway=>orders', 'orders=>payment'])
    expect(graph.traces[0]).toMatchObject({ trId: 'tr-1', user: 'user-7', entryApi: 'GET /api/orders', rowCount: 3 })
  })

  it('renders a graph viewer tab panel with hover tooltip data', () => {
    const rows = [
      row({ id: 1, receivedAt: 10, correlationIds: { trId: 'tr-9' }, fields: { trId: 'tr-9', module: 'gateway', userId: 'user-9' } }),
      row({ id: 2, receivedAt: 30, correlationIds: { trId: 'tr-9' }, target: { namespace: 'prod', pod: 'orders-1', container: 'app' }, request: { method: 'POST', url: '/internal/orders', status: '503', elapsed: 1200 }, fields: { trId: 'tr-9', module: 'orders' } }),
    ]

    render(<ApiFlowGraphExtensionView sdk={sdk} snapshot={snapshot(rows)} />)

    expect(screen.getByTestId('api-flow-graph-view')).toBeInTheDocument()
    expect(screen.getByTestId('api-flow-graph-svg')).toBeInTheDocument()
    expect(screen.getAllByTestId('api-flow-node')).toHaveLength(2)
    expect(screen.getAllByTestId('api-flow-edge')).toHaveLength(1)
    expect(screen.getByText('tr-9')).toBeInTheDocument()
    expect(screen.getByText((_content, element) => element?.textContent === 'User: user-9')).toBeInTheDocument()
    expect(screen.getByText(/gateway -> orders/)).toBeInTheDocument()
  })
})
