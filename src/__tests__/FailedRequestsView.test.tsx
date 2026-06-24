import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FailedRequestsView } from '../components/FailedRequestsView'
import { resetLogStoreForTests, useLogStore } from '../stores/logStore'
import type { ParsedLogLine } from '../types/log'

const row: ParsedLogLine = { id: 1, streamId: 's', sourceId: 'src', sourceType: 'access', namespace: 'ns', pod: 'p', container: 'c', filePath: '/x', raw: '{}', parseStatus: 'parsed', receivedAt: 1, summary: 'raw', trId: 'trace-1' }

describe('FailedRequestsView', () => {
  beforeEach(() => resetLogStoreForTests())

  it('introduces the request-centric layer without replacing raw logs', () => {
    useLogStore.setState({ rows: [row], visibleRows: [row] })
    render(<FailedRequestsView />)

    expect(screen.getByTestId('failed-requests-view')).toBeInTheDocument()
    expect(screen.getByText('Request-centric investigation layer')).toBeInTheDocument()
    expect(screen.getAllByText('trId')).toHaveLength(2)
    expect(screen.getByText('Preserved as source of truth')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
  })
})
