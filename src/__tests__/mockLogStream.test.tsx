import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { LogViewer } from '../components/LogViewer'
import { resetLogStoreForTests, useLogStore } from '../stores/logStore'
import type { ActiveStreamMeta, SourceLogType } from '../types/log'
import { generateMockLogStreamBatch, generateMockLogStreamEvents } from '../utils/mockLogStream'

const meta = (streamId: string, sourceType: SourceLogType = 'info'): ActiveStreamMeta => ({
  streamId,
  sourceId: `mock/${streamId}/${sourceType}`,
  sourceType,
  context: 'ctx',
  namespace: 'mock-ns',
  pod: 'mock-api-7d9c8f6b8d-x2abc',
  container: 'app',
  filePath: `/scloud/mock-ns/logs/mock-api-7d9c8f6b8d-x2abc/mock-ns${sourceType === 'access' ? '_ACC' : sourceType === 'error' ? '_ERR' : ''}.log`,
  initialTailLines: 50,
})

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

describe('mock log stream generator', () => {
  beforeEach(() => {
    installLocalStorageMock()
    window.localStorage.clear()
    resetLogStoreForTests()
  })

  it('generates deterministic random-looking stream events for output tests', () => {
    const first = generateMockLogStreamEvents({ streamId: 'mock-stream', sourceType: 'access', count: 4, seed: 42 })
    const second = generateMockLogStreamEvents({ streamId: 'mock-stream', sourceType: 'access', count: 4, seed: 42 })
    const info = generateMockLogStreamEvents({ streamId: 'mock-info', sourceType: 'info', count: 1, seed: 3 })
    const error = generateMockLogStreamEvents({ streamId: 'mock-error', sourceType: 'error', count: 1, seed: 4 })

    expect(second).toEqual(first)
    expect(first).toHaveLength(4)
    expect(first.map((line) => line.streamId)).toEqual(['mock-stream', 'mock-stream', 'mock-stream', 'mock-stream'])
    expect(new Set(first.map((line) => JSON.parse(line.raw).url)).size).toBeGreaterThan(1)
    expect(first.every((line) => line.sourceType === 'access')).toBe(true)
    expect(JSON.parse(info[0].raw)).toMatchObject({ logType: 'INFO', service: 'klogcat-mock', message: expect.stringContaining('mock stream line 0') })
    expect(JSON.parse(error[0].raw)).toMatchObject({ logType: 'ERR', level: 'ERROR', body: { errorDetails: { traceId: 'mock-trace-0' } } })
  })

  it('prints a generated mock batch through the log store and renders the streamed rows', async () => {
    const streamId = 'mock-access-stream'
    const batch = generateMockLogStreamBatch({ streamId, sourceType: 'access', count: 8, seed: 7 })

    act(() => {
      useLogStore.getState().prepareStarting(meta(streamId, 'access'))
      useLogStore.getState().markRunning(streamId)
      useLogStore.getState().appendLines(batch.lines)
    })

    expect(useLogStore.getState().rows).toHaveLength(8)
    expect(useLogStore.getState().visibleRows).toHaveLength(8)
    expect(useLogStore.getState().rows.some((row) => row.url?.startsWith('/api/'))).toBe(true)
    expect(useLogStore.getState().rows.some((row) => row.trId?.startsWith('mock-tr-'))).toBe(true)

    render(<LogViewer />)

    await waitFor(() => expect(screen.getAllByText('Rows: 8/8').length).toBeGreaterThan(0))
    expect(screen.getByLabelText('Filter url')).toBeInTheDocument()
    expect(screen.getByLabelText('Filter status')).toBeInTheDocument()
    expect(screen.getByLabelText('Filter trId')).toBeInTheDocument()
  })
})
