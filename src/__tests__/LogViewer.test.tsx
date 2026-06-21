import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LogRow } from '../components/LogRow'
import type { ParsedLogLine } from '../types/log'

const row: ParsedLogLine = { id: 1, streamId: 's', sourceId: 'src', sourceType: 'access', namespace: 'ns', pod: 'p', container: 'c', filePath: '/x', raw: '{"message":"hello"}', parseStatus: 'parsed', receivedAt: Date.UTC(2026,0,1), status: '500', method: 'POST', url: '/x', elapsed: 42, summary: 'POST /x 500 42ms', trId: 't' }

describe('LogRow', () => {
  it('renders summary and source label', () => { render(<LogRow row={row} grepQuery="post" />); expect(screen.getByText('ACC')).toBeInTheDocument(); expect(screen.getAllByText(/POST/).length).toBeGreaterThan(0) })
})
