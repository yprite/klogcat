import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { resetLogStoreForTests, useLogStore } from '../../stores/logStore'
import type { ParsedLogLine } from '../../types/log'

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: () => ({
    getTotalSize: () => 44,
    getVirtualItems: () => [{ key: 'row-1', index: 0, start: 0 }],
    scrollToIndex: vi.fn(),
  }),
}))

const row: ParsedLogLine = {
  id: 1,
  streamId: 's',
  sourceId: 'src',
  sourceType: 'access',
  namespace: 'ns',
  pod: 'api',
  container: 'app',
  filePath: '/x',
  raw: '{"status":500}',
  parseStatus: 'parsed',
  receivedAt: Date.UTC(2026, 0, 1),
  status: '500',
  method: 'POST',
  url: '/fail',
  elapsed: 42,
  summary: 'POST /fail 500',
}

function installBrowserMocks() {
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
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn(async () => undefined) },
  })
}

describe('log viewer virtual row scenario', () => {
  beforeEach(() => {
    vi.useRealTimers()
    installBrowserMocks()
    resetLogStoreForTests()
    window.localStorage.clear()
  })

  it('renders virtual rows and opens, copies, and closes row detail', async () => {
    const { LogViewer } = await import('../../components/LogViewer')
    useLogStore.setState({ rows: [row], visibleRows: [row] })

    render(<LogViewer />)

    await waitFor(() => expect(screen.getByTestId('log-row-1')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('log-row-1'))
    expect(screen.getByRole('complementary', { name: /log row detail/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Copy raw' }))
    fireEvent.click(screen.getByRole('button', { name: 'Copy JSON' }))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: 'Close' })).toHaveAttribute('title', 'Close log row detail')
    fireEvent.click(screen.getByRole('button', { name: 'Collapse detail' }))
    expect(screen.queryByRole('complementary', { name: /log row detail/i })).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('log-row-1'))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('complementary', { name: /log row detail/i })).not.toBeInTheDocument()

    vi.useFakeTimers()
    act(() => {
      useLogStore.setState({ rows: [row, { ...row, id: 2, raw: '{"status":200}', status: '200' }], visibleRows: [row, { ...row, id: 2, raw: '{"status":200}', status: '200' }] })
    })
    act(() => {
      vi.advanceTimersByTime(1800)
    })
    vi.useRealTimers()
  })
})
