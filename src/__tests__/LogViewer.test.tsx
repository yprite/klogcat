import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { LogRow } from '../components/LogRow'
import { columnWidthsForRows, defaultVisibleColumnsFor, exportRowsAsJsonl, forceScrollToBottom, LogViewer, LOG_VIEWER_COLUMN_SETTINGS_STORAGE_KEY, measureLogRowElement, mergeColumnSettingsWithAvailable, moveColumnInOrder, nextVisibleColumnsForToggle, reorderColumnByDrop } from '../components/LogViewer'
import { scopeKey, useKubeStore } from '../stores/kubeStore'
import { resetLogStoreForTests, useLogStore } from '../stores/logStore'
import type { ParsedLogLine } from '../types/log'
import { accessLogColumns, columnsForSource, errorLogColumns, labelForColumn } from '../utils/logColumns'

const row: ParsedLogLine = { id: 1, streamId: 's', sourceId: 'src', sourceType: 'access', namespace: 'ns', pod: 'p', container: 'c', filePath: '/x', raw: '{"message":"hello"}', parseStatus: 'parsed', receivedAt: Date.UTC(2026,0,1), status: '500', method: 'POST', url: '/x', elapsed: 42, body: '{"rcode":"5000999"}', summary: 'POST /x 500 42ms', trId: 't' }
const okRow: ParsedLogLine = { ...row, id: 3, status: '200', method: 'GET', url: '/ok', summary: 'GET /ok 200 5ms', raw: '{"status":200}' }
const errRow: ParsedLogLine = { id: 2, streamId: 's', sourceId: 'src', sourceType: 'error', namespace: 'ns', pod: 'p', container: 'c', filePath: '/x', raw: '{"message":"oops"}', parseStatus: 'parsed', receivedAt: Date.UTC(2026,0,1), errorMethod: 'GET', errorPath: '/fail', errorReason: 'boom', summary: 'boom GET /fail', traceId: 'trace' }
const appRow: ParsedLogLine = { id: 10, streamId: 's', sourceId: 'src', sourceType: 'info', namespace: 'ns', pod: 'p', container: 'c', filePath: '/x', raw: '{"message":"old app"}', parseStatus: 'parsed', receivedAt: Date.UTC(2026,0,1), status: '201', method: 'POST', url: '/info', elapsed: 7, summary: 'POST /info 201 7ms' }

function installLocalStorageMock() {
  let store: Record<string, string> = {}
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => { store[key] = value },
      removeItem: (key: string) => { delete store[key] },
      clear: () => { store = {} },
    },
  })
}

function resetKubeStoreForViewerTests() {
  useKubeStore.setState({
    contexts: [],
    currentContext: undefined,
    selectedContext: undefined,
    selectedContexts: [],
    namespaces: [],
    namespacesByContext: {},
    selectedNamespace: undefined,
    selectedNamespaces: {},
    pods: [],
    podsByScope: {},
    selectedPod: undefined,
    selectedPods: {},
    selectedWorkloads: {},
    loadingContexts: false,
    loadingNamespaces: false,
    loadingPods: false,
    cacheLoaded: false,
    cacheRefreshing: false,
    cacheLastRefreshAt: undefined,
    error: undefined,
  })
}

function seedViewerTarget() {
  const key = scopeKey('ctx', 'prod')
  useKubeStore.setState({
    selectedContexts: ['ctx'],
    selectedNamespaces: { ctx: ['prod'] },
    podsByScope: { [key]: [{ name: 'api-1', namespace: 'prod', phase: 'Running', containers: ['app'] }] },
    selectedPods: { [key]: ['api-1'] },
  })
}

describe('LogRow', () => {
  it('includes every visible key from the ACC and ERR sample logs as columns', () => {
    expect(accessLogColumns).toEqual(['timestamp','jsonLogType','host','service','module','serviceId','trId','epochTime','pSpanId','spanId','method','url','length','srcIp','elapsed','status','userId','appId','body','rcode','rmsg','exceptionName','apiName'])
    expect(errorLogColumns).toEqual(['timestamp','jsonLogType','host','logger','service','module','submodule','trId','epochTime','thread','body','errorServerName','errorPath','errorMethod','errorTimestamp','traceId','errorReason'])
    expect(columnsForSource('info')).toEqual(accessLogColumns)
  })

  it('uses sample-key labels for renamed or flattened fields', () => {
    expect(labelForColumn('timestamp')).toBe('time')
    expect(labelForColumn('jsonLogType')).toBe('logType')
    expect(labelForColumn('apiName')).toBe('api_name')
    expect(labelForColumn('errorReason')).toBe('errorDetails.errors.reason')
  })

  it('renders the JSON body as a normal column when selected', () => {
    render(<LogRow row={row} grepQuery="" visibleColumns={['body']} />)

    expect(screen.getByText('body')).toBeInTheDocument()
    expect(screen.getByText('{"rcode":"5000999"}')).toBeInTheDocument()
  })

  it('renders access logs as key columns instead of one collapsed sentence', () => {
    render(<LogRow row={row} grepQuery="post" visibleColumns={['method','url','status','elapsed','trId']} />)
    expect(screen.getByText('method')).toBeInTheDocument()
    expect(screen.getByText('url')).toBeInTheDocument()
    expect(screen.getByText('status')).toBeInTheDocument()
    expect(screen.getByText('POST')).toBeInTheDocument()
    expect(screen.getByText('/x')).toBeInTheDocument()
    expect(screen.getByText('500')).toBeInTheDocument()
  })

  it('renders info logs with the ACC column structure', () => {
    render(<LogRow row={appRow} grepQuery="" visibleColumns={['method','url','status','elapsed']} />)
    expect(screen.getByText('method')).toBeInTheDocument()
    expect(screen.getByText('url')).toBeInTheDocument()
    expect(screen.getByText('status')).toBeInTheDocument()
    expect(screen.getByText('POST')).toBeInTheDocument()
    expect(screen.getByText('/info')).toBeInTheDocument()
    expect(screen.getByText('201')).toBeInTheDocument()
  })

  it('keeps parsed columns and metadata on fixed tracks so rows align', () => {
    render(<LogRow row={{ ...row, url: '/very/long/path/that/should/remain/fully/visible', rmsg: 'a long response message that should not be ellipsized' }} grepQuery="" visibleColumns={['url','rmsg']} />)

    expect(screen.getByTestId('log-row-1').children[2]).toHaveClass('w-52')
    expect(screen.getByText('/very/long/path/that/should/remain/fully/visible')).toHaveClass('overflow-hidden')
    expect(screen.getByText('/very/long/path/that/should/remain/fully/visible')).toHaveClass('text-ellipsis')
    expect(screen.getByText('a long response message that should not be ellipsized')).toHaveClass('text-ellipsis')
  })

  it('uses the longest visible value as the shared width for that column', () => {
    const shortUrlRow = { ...row, url: '/x' }
    const longUrlRow = { ...row, id: 4, url: '/longest/visible/url/in/current/logs' }
    const widths = columnWidthsForRows([shortUrlRow, longUrlRow], ['url'])

    render(<>
      <LogRow row={shortUrlRow} grepQuery="" visibleColumns={['url']} columnWidths={widths} />
      <LogRow row={longUrlRow} grepQuery="" visibleColumns={['url']} columnWidths={widths} />
    </>)

    const urlColumns = screen.getAllByTestId('log-column-url')
    expect(urlColumns[0]).toHaveStyle({ width: `${widths.url}ch` })
    expect(urlColumns[1]).toHaveStyle({ width: `${widths.url}ch` })
    expect(widths.url).toBe('/longest/visible/url/in/current/logs'.length + 2)
  })

  it('renders error logs as key columns', () => {
    render(<LogRow row={errRow} grepQuery="" visibleColumns={['errorMethod','errorPath','errorReason','traceId']} />)
    expect(screen.getByText('errorDetails.method')).toBeInTheDocument()
    expect(screen.getByText('errorDetails.path')).toBeInTheDocument()
    expect(screen.getByText('GET')).toBeInTheDocument()
    expect(screen.getByText('/fail')).toBeInTheDocument()
  })
})

describe('LogViewer', () => {
  beforeEach(() => {
    installLocalStorageMock()
    resetLogStoreForTests()
    resetKubeStoreForViewerTests()
    window.localStorage.clear()
  })

  it('guides the user to choose targets when the log surface is empty', () => {
    render(<LogViewer />)

    expect(screen.getByText('No log target selected')).toBeInTheDocument()
    expect(screen.getByText(/Use Choose Target/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Choose Target' })).toBeEnabled()
  })

  it('guides the user to start streaming when targets exist but rows are empty', () => {
    seedViewerTarget()
    render(<LogViewer />)

    expect(screen.getByText('Ready to stream logs')).toBeInTheDocument()
    expect(screen.getByText(/Targets selected: 1/)).toBeInTheDocument()
  })

  it('explains when query or column filters hide all rows', () => {
    act(() => {
      useLogStore.setState({ rows: [row], visibleRows: [] })
    })
    render(<LogViewer />)

    expect(screen.getByText('No rows match current filters')).toBeInTheDocument()
    expect(screen.getByText(/Adjust Query or column filters/)).toBeInTheDocument()
  })

  it('uses visible-column filters and a column manager to show only chosen columns', async () => {
    act(() => {
      useLogStore.setState({ rows: [row, okRow], visibleRows: [row, okRow] })
    })
    render(<LogViewer />)

    expect(screen.getByText('Columns')).toBeInTheDocument()
    expect(screen.getByText(/shown/)).toBeInTheDocument()
    expect(screen.getByRole('row', { name: /Visible column filters/i })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Filter status'), { target: { value: '500' } })

    await waitFor(() => expect(screen.getAllByText('Rows: 1/2').length).toBeGreaterThan(0))
    fireEvent.click(screen.getByLabelText('Hide status'))
    await waitFor(() => expect(screen.queryByLabelText('Filter status')).not.toBeInTheDocument())
    expect(screen.queryByTestId('log-column-status')).not.toBeInTheDocument()
  })

  it('uses an always-visible scroll container and exposes filter controls in the header', () => {
    useLogStore.setState({ rows: [row, errRow], visibleRows: [row, errRow] })
    render(<LogViewer />)

    expect(screen.getByTestId('log-scroll')).toHaveClass('overflow-scroll')
    expect(screen.getByLabelText('Filter status')).toBeInTheDocument()
    expect(screen.getByLabelText('Filter errorDetails.errors.reason')).toBeInTheDocument()
  })

  it('starts from essential columns instead of showing every parsed field', () => {
    expect(defaultVisibleColumnsFor(accessLogColumns)).toEqual(['trId','method','url','status','elapsed','rcode','rmsg','exceptionName','apiName'])
    useLogStore.setState({ rows: [row], visibleRows: [row] })
    render(<LogViewer />)

    expect(screen.getByText('9/23 shown')).toBeInTheDocument()
    expect(screen.queryByLabelText('Filter host')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Manage columns' }))
    expect(screen.getByRole('group', { name: /column visibility/i })).toBeInTheDocument()
    expect(screen.getByLabelText('Show host')).not.toBeChecked()
  })

  it('preserves an intentional empty column selection when rows update', async () => {
    useLogStore.setState({ rows: [row], visibleRows: [row] })
    render(<LogViewer />)

    fireEvent.click(screen.getByRole('button', { name: 'None' }))
    expect(screen.getByText('0/23 shown')).toBeInTheDocument()
    expect(screen.getByText(/No data columns selected/i)).toBeInTheDocument()

    act(() => {
      useLogStore.setState({ rows: [row, okRow], visibleRows: [row, okRow] })
    })

    await waitFor(() => expect(screen.getByText('0/23 shown')).toBeInTheDocument())
    expect(screen.queryByLabelText('Filter status')).not.toBeInTheDocument()
    expect(screen.queryByTestId('log-column-status')).not.toBeInTheDocument()
  })

  it('refreshes default essentials when new source columns appear before customization', async () => {
    useLogStore.setState({ rows: [row], visibleRows: [row] })
    render(<LogViewer />)

    expect(screen.queryByLabelText('Filter errorDetails.errors.reason')).not.toBeInTheDocument()

    act(() => {
      useLogStore.setState({ rows: [row, errRow], visibleRows: [row, errRow] })
    })

    await waitFor(() => expect(screen.getByText('13/32 shown')).toBeInTheDocument())
    expect(screen.getByLabelText('Filter errorDetails.errors.reason')).toBeInTheDocument()
  })

  it('restores a re-enabled column at its filter header position instead of appending it', () => {
    expect(nextVisibleColumnsForToggle(['url', 'status'], ['method', 'url', 'elapsed', 'status'], 'method', true)).toEqual(['method', 'url', 'status'])
    expect(nextVisibleColumnsForToggle(['method', 'url', 'status'], ['method', 'url', 'elapsed', 'status'], 'url', false)).toEqual(['method', 'status'])
  })

  it('merges saved column order and visibility with currently available columns', () => {
    const merged = mergeColumnSettingsWithAvailable({
      version: 1,
      columnOrder: ['status', 'method', 'status', 'missing' as never, 'url'],
      visibleColumns: ['status', 'url', 'status', 'missing' as never],
    }, ['method', 'url', 'elapsed', 'status'])

    expect(merged.columnOrder).toEqual(['status', 'method', 'url', 'elapsed'])
    expect(merged.visibleColumns).toEqual(['status', 'url'])
  })

  it('persists user-selected visible columns and column order to local storage', async () => {
    useLogStore.setState({ rows: [row], visibleRows: [row] })
    render(<LogViewer />)

    fireEvent.click(screen.getByLabelText('Hide status'))
    fireEvent.click(screen.getByLabelText('Move url left'))

    await waitFor(() => {
      const saved = JSON.parse(window.localStorage.getItem(LOG_VIEWER_COLUMN_SETTINGS_STORAGE_KEY) ?? '{}')
      expect(saved.version).toBe(1)
      expect(saved.visibleColumns).not.toContain('status')
      expect(saved.columnOrder.indexOf('url')).toBeLessThan(saved.columnOrder.indexOf('method'))
    })
  })

  it('restores saved visible columns and column order from local storage', async () => {
    window.localStorage.setItem(LOG_VIEWER_COLUMN_SETTINGS_STORAGE_KEY, JSON.stringify({
      version: 1,
      columnOrder: ['status', 'url', 'method'],
      visibleColumns: ['status', 'url'],
    }))
    useLogStore.setState({ rows: [row], visibleRows: [row] })
    render(<LogViewer />)

    await waitFor(() => expect(screen.getByText('2/23 shown')).toBeInTheDocument())
    expect(screen.getByLabelText('Filter status')).toBeInTheDocument()
    expect(screen.getByLabelText('Filter url')).toBeInTheDocument()
    expect(screen.queryByLabelText('Filter method')).not.toBeInTheDocument()
    const controls = Array.from(screen.getByRole('row', { name: /Visible column filters/i }).querySelectorAll('[data-testid="column-control"]'))
    const keys = controls.map((control) => control.getAttribute('data-column-key'))
    expect(keys).toEqual(['status', 'url'])
  })

  it('restores saved columns when rows arrive after the viewer mounts', async () => {
    window.localStorage.setItem(LOG_VIEWER_COLUMN_SETTINGS_STORAGE_KEY, JSON.stringify({
      version: 1,
      columnOrder: ['status', 'url', 'method'],
      visibleColumns: ['status', 'url'],
    }))
    render(<LogViewer />)

    act(() => {
      useLogStore.setState({ rows: [row], visibleRows: [row] })
    })

    await waitFor(() => expect(screen.getByText('2/23 shown')).toBeInTheDocument())
    const controls = Array.from(screen.getByRole('row', { name: /Visible column filters/i }).querySelectorAll('[data-testid="column-control"]'))
    const keys = controls.map((control) => control.getAttribute('data-column-key'))
    expect(keys).toEqual(['status', 'url'])
    const saved = JSON.parse(window.localStorage.getItem(LOG_VIEWER_COLUMN_SETTINGS_STORAGE_KEY) ?? '{}')
    expect(saved.visibleColumns).toEqual(['status', 'url'])
  })

  it('moves columns left and right in user-controlled order', async () => {
    useLogStore.setState({ rows: [row], visibleRows: [row] })
    render(<LogViewer />)

    expect(moveColumnInOrder(['method', 'url', 'status'], 'status', 'left')).toEqual(['method', 'status', 'url'])
    fireEvent.click(screen.getByLabelText('Move status left'))

    await waitFor(() => {
      const controls = Array.from(screen.getByRole('row', { name: /Visible column filters/i }).querySelectorAll('[data-testid="column-control"]'))
      const keys = controls.map((control) => control.getAttribute('data-column-key'))
      expect(keys.indexOf('status')).toBeLessThan(keys.indexOf('elapsed'))
    })
  })

  it('reorders columns by dragging a header and dropping it on another header', async () => {
    useLogStore.setState({ rows: [row], visibleRows: [row] })
    render(<LogViewer />)
    fireEvent.click(screen.getByRole('button', { name: 'All' }))

    expect(reorderColumnByDrop(['method', 'url', 'status', 'body'], 'body', 'method')).toEqual(['body', 'method', 'url', 'status'])
    const bodyColumn = document.querySelector('[data-column-key="body"]') as HTMLElement
    const methodColumn = document.querySelector('[data-column-key="method"]') as HTMLElement
    expect(bodyColumn).toBeTruthy()
    expect(methodColumn).toBeTruthy()
    fireEvent.dragStart(bodyColumn)
    fireEvent.dragEnter(methodColumn)
    fireEvent.dragOver(methodColumn)
    fireEvent.drop(methodColumn)

    await waitFor(() => {
      const controls = Array.from(screen.getByRole('row', { name: /Visible column filters/i }).querySelectorAll('[data-testid="column-control"]'))
      const keys = controls.map((control) => control.getAttribute('data-column-key'))
      expect(keys.indexOf('body')).toBeLessThan(keys.indexOf('method'))
    })
  })

  it('uses a flex-only scroll container so page scrolling stays outside the app shell', () => {
    useLogStore.setState({ rows: [row, errRow], visibleRows: [row, errRow] })
    render(<LogViewer />)

    expect(screen.getByTestId('log-scroll')).toHaveClass('flex-1')
    expect(screen.getByTestId('log-scroll')).toHaveClass('min-h-0')
    expect(screen.getByTestId('log-scroll')).not.toHaveClass('h-[70vh]')
  })

  it('shows an actionable empty state and disables export actions before logs arrive', () => {
    const listener = vi.fn()
    window.addEventListener('klogcat:open-target-picker', listener)
    render(<LogViewer />)

    expect(screen.getByText('No log target selected')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy filtered' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Export filtered JSONL' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Choose Target' }))
    expect(listener).toHaveBeenCalledTimes(1)
    window.removeEventListener('klogcat:open-target-picker', listener)
  })

  it('forces the log scroll container to the bottom when auto-scroll is on', () => {
    const element = document.createElement('div')
    Object.defineProperty(element, 'scrollHeight', { configurable: true, value: 2400 })
    forceScrollToBottom(element)

    expect(element.scrollTop).toBe(2400)
  })

  it('measures rendered row height for the virtual log list', () => {
    const element = document.createElement('div')
    element.getBoundingClientRect = () => ({ height: 52 }) as DOMRect

    expect(measureLogRowElement(element)).toBe(52)
  })

  it('serializes exported rows as JSONL', () => {
    const exported = exportRowsAsJsonl([row, okRow])
    expect(exported.split('\n')).toHaveLength(2)
    expect(exported).toContain('"status":"500"')
    expect(exported).toContain('"status":"200"')
  })

  it('applies a yellow blinking highlight when a row is marked as newly arrived', () => {
    render(<LogRow row={appRow} grepQuery="" isNew />)

    expect(screen.getByTestId('log-row-10')).toHaveClass('klogcat-new-log')
  })
})
