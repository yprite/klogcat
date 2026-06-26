import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { LogRow } from '../../components/LogRow'
import {
  LOG_VIEWER_COLUMN_SETTINGS_STORAGE_KEY,
  LogViewer,
  columnWidthsForRows,
  defaultVisibleColumnsFor,
  downloadTextFile,
  exportRowsAsJsonl,
  forceScrollToBottom,
  mergeColumnSettingsWithAvailable,
  moveColumnInOrder,
  nextVisibleColumnsForToggle,
  readLogViewerColumnSettings,
  reorderColumnByDrop,
  writeLogViewerColumnSettings,
} from '../../components/LogViewer'
import { TopBar } from '../../components/TopBar'
import { accessLogColumns, columnsForRows, columnsForSource, errorLogColumns, labelForColumn } from '../../utils/logColumns'
import { resetLogStoreForTests, useLogStore } from '../../stores/logStore'
import { scopeKey, useKubeStore } from '../../stores/kubeStore'
import type { ParsedLogLine } from '../../types/log'

const row: ParsedLogLine = { id: 1, streamId: 's', sourceId: 'src', sourceType: 'access', namespace: 'ns', pod: 'p', container: 'c', filePath: '/x', raw: '{"message":"hello"}', parseStatus: 'parsed', receivedAt: Date.UTC(2026, 0, 1), status: '500', method: 'POST', url: '/x', elapsed: 42, body: '{"rcode":"5000999"}', summary: 'POST /x 500 42ms', trId: 't' }
const okRow: ParsedLogLine = { ...row, id: 2, status: '200', method: 'GET', url: '/ok', summary: 'GET /ok 200 5ms', raw: '{"status":200}' }
const errRow: ParsedLogLine = { id: 3, streamId: 's', sourceId: 'src', sourceType: 'error', namespace: 'ns', pod: 'p', container: 'c', filePath: '/x', raw: '{"message":"oops"}', parseStatus: 'parsed', receivedAt: Date.UTC(2026, 0, 1), errorMethod: 'GET', errorPath: '/fail', errorReason: 'boom', summary: 'boom GET /fail', traceId: 'trace' }
const rawRow: ParsedLogLine = { ...row, id: 4, parseStatus: 'raw', raw: 'plain raw line', summary: 'plain raw line', sourceType: 'info' }
const infoRow: ParsedLogLine = { ...row, id: 5, sourceType: 'info', jsonLogType: 'INFO', summary: 'info summary', trId: 'info-trace', parseStatus: 'parsed' }

function installBrowserMocks() {
  let store: Record<string, string> = {}
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => { store[key] = value },
      removeItem: (key: string) => { delete store[key] },
      clear: () => { store = {} },
      key: (index: number) => Object.keys(store)[index] ?? null,
      get length() { return Object.keys(store).length },
    },
  })
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn(async () => undefined) },
  })
  URL.createObjectURL = vi.fn(() => 'blob:klogcat')
  URL.revokeObjectURL = vi.fn()
}

function resetKube() {
  useKubeStore.setState({
    contexts: [{ name: 'ctx' }, { name: 'cluster-a' }],
    currentContext: 'ctx',
    selectedContext: 'ctx',
    selectedContexts: ['ctx', 'cluster-a'],
    namespaces: [{ name: 'default' }],
    namespacesByContext: { ctx: [{ name: 'default' }], 'cluster-a': [{ name: 'prod' }] },
    selectedNamespace: 'default',
    selectedNamespaces: { ctx: ['default'], 'cluster-a': ['prod'] },
    pods: [{ name: 'api-1', namespace: 'default', phase: 'Running', containers: ['app'] }],
    podsByScope: {
      [scopeKey('ctx', 'default')]: [
        { name: 'api-1', namespace: 'default', phase: 'Running', containers: ['app'] },
        { name: 'worker-1', namespace: 'default', phase: 'Pending', containers: ['worker'] },
        { name: 'failed-1', namespace: 'default', phase: 'Failed', containers: ['app'] },
        { name: 'done-1', namespace: 'default', phase: 'Succeeded', containers: ['app'] },
      ],
      [scopeKey('cluster-a', 'prod')]: [{ name: 'gateway-1', namespace: 'prod', phase: 'Running', containers: ['app'] }],
    },
    selectedPod: 'api-1',
    selectedPods: { [scopeKey('ctx', 'default')]: ['api-1'] },
    selectedWorkloads: {},
    loadingContexts: false,
    loadingNamespaces: false,
    loadingPods: false,
    cacheRefreshing: false,
    cacheLoaded: true,
    cacheLastRefreshAt: Date.now(),
    error: undefined,
  })
}

describe('log analysis UI scenario', () => {
  beforeEach(() => {
    installBrowserMocks()
    resetLogStoreForTests()
    resetKube()
    window.localStorage.clear()
    vi.clearAllMocks()
  })

  it('opens target picker, filters targets, toggles selections, and closes the dialog', async () => {
    const onContextChange = vi.fn(async () => undefined)
    const onNamespaceChange = vi.fn(async () => undefined)
    const onPodChange = vi.fn(async () => undefined)
    render(<TopBar onSettings={vi.fn()} onContextChange={onContextChange} onNamespaceChange={onNamespaceChange} onPodChange={onPodChange} />)

    fireEvent.click(screen.getByRole('button', { name: /change targets/i }))
    const dialog = screen.getByRole('dialog', { name: /select log targets/i })
    fireEvent.change(within(dialog).getByLabelText('Search targets'), { target: { value: 'gateway' } })
    expect(within(dialog).getByText('gateway-1')).toBeInTheDocument()
    fireEvent.change(within(dialog).getByLabelText('Search targets'), { target: { value: '' } })
    expect(within(dialog).getByText('Failed')).toBeInTheDocument()
    expect(within(dialog).getByText('Succeeded')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByText('cluster-a').closest('label')!.querySelector('input')!)
    await waitFor(() => expect(onContextChange).toHaveBeenCalled())
    fireEvent.click(within(dialog).getByText('prod').closest('label')!.querySelector('input')!)
    await waitFor(() => expect(onNamespaceChange).toHaveBeenCalled())
    fireEvent.change(within(dialog).getByLabelText('Search targets'), { target: { value: 'gateway' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Collapse cluster-a' }))
    expect(within(dialog).queryByText('gateway-1')).not.toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Expand cluster-a' }))
    fireEvent.click(within(dialog).getByLabelText('cluster-a / prod / gateway-1'))
    await waitFor(() => expect(onPodChange).toHaveBeenCalled())
    fireEvent.click(within(dialog).getByText(/ctx \/ default \/ api-1/))
    await waitFor(() => expect(onPodChange).toHaveBeenCalledTimes(2))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog', { name: /select log targets/i })).not.toBeInTheDocument()
  })

  it('renders row formats and drives column manager, filters, copy, export, and detail interactions', async () => {
    expect(accessLogColumns).toContain('apiName')
    expect(errorLogColumns).toContain('errorReason')
    expect(columnsForSource('info')).toEqual(accessLogColumns)
    expect(columnsForRows([row, errRow])).toContain('status')
    expect(labelForColumn('errorReason')).toBe('errorDetails.errors.reason')
    expect(defaultVisibleColumnsFor(accessLogColumns)).toContain('status')
    expect(nextVisibleColumnsForToggle(['url', 'status'], ['method', 'url', 'status'], 'method', true)).toEqual(['method', 'url', 'status'])
    expect(moveColumnInOrder(['method', 'url', 'status'], 'status', 'left')).toEqual(['method', 'status', 'url'])
    expect(reorderColumnByDrop(['method', 'url', 'status'], 'status', 'method')).toEqual(['status', 'method', 'url'])
    expect(mergeColumnSettingsWithAvailable({ version: 1, columnOrder: ['status', 'missing' as never, 'url'], visibleColumns: ['status'] }, ['method', 'url', 'status']).columnOrder).toEqual(['status', 'url', 'method'])
    writeLogViewerColumnSettings({ version: 1, columnOrder: ['status', 'url', 'method'], visibleColumns: ['status', 'url'] })
    expect(readLogViewerColumnSettings()?.visibleColumns).toEqual(['status', 'url'])
    expect(readLogViewerColumnSettings({ getItem: () => { throw new Error('storage blocked') } })).toBeNull()

    const widths = columnWidthsForRows([row, { ...row, id: 9, url: '/long/url' }], ['url'])
    render(<>
      <LogRow row={row} grepQuery="post" visibleColumns={['method', 'url', 'status', 'elapsed', 'body']} columnWidths={widths} isNew />
      <LogRow row={errRow} grepQuery="" visibleColumns={['errorMethod', 'errorPath', 'errorReason', 'traceId']} isSelected />
      <LogRow row={rawRow} grepQuery="raw" />
      <LogRow row={infoRow} grepQuery="summary" />
    </>)
    expect(screen.getByTestId('log-row-1')).toHaveClass('klogcat-new-log')
    expect(screen.getByTestId('log-row-3')).toHaveClass('bg-slate-800')
    expect(screen.getByTestId('log-row-4')).toHaveTextContent('plain raw line')
    expect(screen.getByTestId('log-row-5')).toHaveTextContent('info summary')

    document.body.innerHTML = ''
    act(() => useLogStore.setState({ rows: [row, okRow, errRow], visibleRows: [row, okRow, errRow] }))
    render(<LogViewer />)

    await waitFor(() => expect(screen.getByText('2/32 shown')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    await waitFor(() => expect(screen.getByText('32/32 shown')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'None' }))
    await waitFor(() => expect(screen.getByText('0/32 shown')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    await waitFor(() => expect(screen.getByText('32/32 shown')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Filter status'), { target: { value: '500' } })
    await waitFor(() => expect(screen.getAllByText('Rows: 1/3').length).toBeGreaterThan(0))
    fireEvent.click(screen.getByLabelText('Move status right'))
    fireEvent.click(screen.getByLabelText('Move status left'))
    const dataTransfer = { effectAllowed: '', dropEffect: '', setData: vi.fn() }
    const statusColumn = document.querySelector('[data-column-key="status"]') as HTMLElement
    const urlColumn = document.querySelector('[data-column-key="url"]') as HTMLElement
    fireEvent.dragStart(statusColumn, { dataTransfer })
    fireEvent.dragOver(urlColumn, { dataTransfer })
    fireEvent.drop(urlColumn, { dataTransfer })
    fireEvent.click(screen.getByLabelText('Hide status'))
    await waitFor(() => expect(screen.queryByLabelText('Filter status')).not.toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Manage columns' }))
    expect(screen.getByRole('group', { name: /column visibility/i })).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Show status'))
    await waitFor(() => expect(screen.getByLabelText('Filter status')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Essentials' }))
    fireEvent.click(screen.getByRole('button', { name: 'Copy filtered' }))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Export filtered JSONL' }))
    expect(URL.createObjectURL).toHaveBeenCalled()
    expect(exportRowsAsJsonl([row, okRow]).split('\n')).toHaveLength(2)
    const element = document.createElement('div')
    Object.defineProperty(element, 'scrollHeight', { configurable: true, value: 1200 })
    forceScrollToBottom(element)
    expect(element.scrollTop).toBe(1200)
    downloadTextFile('manual.jsonl', '{}')
    expect(window.localStorage.getItem(LOG_VIEWER_COLUMN_SETTINGS_STORAGE_KEY)).toBeTruthy()
  })

  it('keeps customized visible columns when new source columns arrive', async () => {
    cleanup()
    resetLogStoreForTests()
    window.localStorage.clear()
    act(() => useLogStore.setState({ rows: [row], visibleRows: [row] }))
    render(<LogViewer />)

    await waitFor(() => expect(screen.getByText('9/23 shown')).toBeInTheDocument())
    fireEvent.click(screen.getByLabelText('Hide status'))
    await waitFor(() => expect(screen.queryByLabelText('Filter status')).not.toBeInTheDocument())
    act(() => useLogStore.setState({ rows: [row, errRow], visibleRows: [row, errRow] }))
    await waitFor(() => expect(screen.getByText(/8\/32 shown/)).toBeInTheDocument())
    expect(screen.queryByLabelText('Filter status')).not.toBeInTheDocument()
  })
})
