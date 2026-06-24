import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { LogRow } from '../components/LogRow'
import { columnWidthsForRows, exportRowsAsJsonl, forceScrollToBottom, LogViewer, moveColumnInOrder, nextVisibleColumnsForToggle, reorderColumnByDrop } from '../components/LogViewer'
import { resetLogStoreForTests, useLogStore } from '../stores/logStore'
import type { ParsedLogLine } from '../types/log'
import { accessLogColumns, errorLogColumns, labelForColumn } from '../utils/logColumns'

const row: ParsedLogLine = { id: 1, streamId: 's', sourceId: 'src', sourceType: 'access', namespace: 'ns', pod: 'p', container: 'c', filePath: '/x', raw: '{"message":"hello"}', parseStatus: 'parsed', receivedAt: Date.UTC(2026,0,1), status: '500', method: 'POST', url: '/x', elapsed: 42, body: '{"rcode":"5000999"}', summary: 'POST /x 500 42ms', trId: 't' }
const okRow: ParsedLogLine = { ...row, id: 3, status: '200', method: 'GET', url: '/ok', summary: 'GET /ok 200 5ms', raw: '{"status":200}' }
const errRow: ParsedLogLine = { id: 2, streamId: 's', sourceId: 'src', sourceType: 'error', namespace: 'ns', pod: 'p', container: 'c', filePath: '/x', raw: '{"message":"oops"}', parseStatus: 'parsed', receivedAt: Date.UTC(2026,0,1), errorMethod: 'GET', errorPath: '/fail', errorReason: 'boom', summary: 'boom GET /fail', traceId: 'trace' }
const appRow: ParsedLogLine = { id: 10, streamId: 's', sourceId: 'src', sourceType: 'info', namespace: 'ns', pod: 'p', container: 'c', filePath: '/x', raw: '{"message":"old app"}', parseStatus: 'parsed', receivedAt: Date.UTC(2026,0,1), summary: 'old app' }

describe('LogRow', () => {
  it('includes every visible key from the ACC and ERR sample logs as columns', () => {
    expect(accessLogColumns).toEqual(['timestamp','jsonLogType','host','service','module','serviceId','trId','epochTime','pSpanId','spanId','method','url','length','srcIp','elapsed','status','userId','appId','body','rcode','rmsg','exceptionName','apiName'])
    expect(errorLogColumns).toEqual(['timestamp','jsonLogType','host','logger','service','module','submodule','trId','epochTime','thread','body','errorServerName','errorPath','errorMethod','errorTimestamp','traceId','errorReason'])
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

  it('sizes parsed columns to their content instead of truncating values', () => {
    render(<LogRow row={{ ...row, url: '/very/long/path/that/should/remain/fully/visible', rmsg: 'a long response message that should not be ellipsized' }} grepQuery="" visibleColumns={['url','rmsg']} />)

    expect(screen.getByText('/very/long/path/that/should/remain/fully/visible').parentElement).toHaveClass('w-max')
    expect(screen.getByText('/very/long/path/that/should/remain/fully/visible').parentElement).not.toHaveClass('overflow-hidden')
    expect(screen.getByText('a long response message that should not be ellipsized').parentElement).not.toHaveClass('text-ellipsis')
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
  beforeEach(() => resetLogStoreForTests())

  it('uses an Excel-style header to filter rows and toggle column visibility', async () => {
    useLogStore.setState({ rows: [row, okRow], visibleRows: [row, okRow] })
    render(<LogViewer />)

    expect(screen.queryByRole('group', { name: /column visibility/i })).not.toBeInTheDocument()
    expect(screen.getByRole('row', { name: /Excel-style column filters/i })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Filter status'), { target: { value: '500' } })

    await waitFor(() => expect(screen.getByText('Rows: 1/2')).toBeInTheDocument())
    fireEvent.click(screen.getByLabelText('Show status'))
    expect(screen.getByLabelText('Show status')).not.toBeChecked()
    await waitFor(() => expect(screen.queryByText('500')).not.toBeInTheDocument())
  })

  it('uses an always-visible scroll container and exposes filter controls in the header', () => {
    useLogStore.setState({ rows: [row, errRow], visibleRows: [row, errRow] })
    render(<LogViewer />)

    expect(screen.getByTestId('log-scroll')).toHaveClass('overflow-scroll')
    expect(screen.getByLabelText('Filter status')).toBeInTheDocument()
    expect(screen.getByLabelText('Show errorDetails.errors.reason')).toBeChecked()
  })

  it('restores a re-enabled column at its filter header position instead of appending it', () => {
    expect(nextVisibleColumnsForToggle(['url', 'status'], ['method', 'url', 'elapsed', 'status'], 'method', true)).toEqual(['method', 'url', 'status'])
    expect(nextVisibleColumnsForToggle(['method', 'url', 'status'], ['method', 'url', 'elapsed', 'status'], 'url', false)).toEqual(['method', 'status'])
  })

  it('moves columns left and right in user-controlled order', async () => {
    useLogStore.setState({ rows: [row], visibleRows: [row] })
    render(<LogViewer />)

    expect(moveColumnInOrder(['method', 'url', 'status'], 'status', 'left')).toEqual(['method', 'status', 'url'])
    fireEvent.click(screen.getByLabelText('Move status left'))

    await waitFor(() => {
      const controls = Array.from(screen.getByRole('row', { name: /Excel-style column filters/i }).querySelectorAll('[data-testid="column-control"]'))
      const keys = controls.map((control) => control.getAttribute('data-column-key'))
      expect(keys.indexOf('status')).toBeLessThan(keys.indexOf('elapsed'))
    })
  })

  it('reorders columns by dragging a header and dropping it on another header', async () => {
    useLogStore.setState({ rows: [row], visibleRows: [row] })
    render(<LogViewer />)

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
      const controls = Array.from(screen.getByRole('row', { name: /Excel-style column filters/i }).querySelectorAll('[data-testid="column-control"]'))
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

  it('forces the log scroll container to the bottom when auto-scroll is on', () => {
    const element = document.createElement('div')
    Object.defineProperty(element, 'scrollHeight', { configurable: true, value: 2400 })
    forceScrollToBottom(element)

    expect(element.scrollTop).toBe(2400)
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
