import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ParsedLogLine } from '../types/log'
import { IncidentTriagePanel } from '../components/IncidentTriagePanel'

const base = { streamId: 's1', sourceId: 'src1', context: 'kind-dev', namespace: 'prod', pod: 'checkout-1', container: 'app', filePath: '/x', parseStatus: 'parsed' as const, receivedAt: 1, raw: '{}', summary: '{}' }
const row = (patch: Partial<ParsedLogLine>): ParsedLogLine => ({ id: 1, sourceType: 'access', ...base, ...patch })

describe('IncidentTriagePanel', () => {
  beforeEach(() => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => undefined) } })
  })

  it('renders failed and slow findings from visible rows without hiding raw logs', () => {
    render(<IncidentTriagePanel rows={[row({ id: 1, status: '503', method: 'GET', url: '/checkout', elapsed: 100 }), row({ id: 2, status: '200', method: 'POST', url: '/pay', elapsed: 2500 })]} />)

    expect(screen.getByRole('region', { name: 'Incident triage' })).toBeInTheDocument()
    expect(screen.getByText('2 findings')).toBeInTheDocument()
    expect(screen.getByText('Failed request GET /checkout')).toBeInTheDocument()
    expect(screen.getByText('Slow request POST /pay')).toBeInTheDocument()
    expect(screen.getByText('Raw Logs remain source of truth')).toBeInTheDocument()
  })

  it('shows parser blind spots and copies a redacted summary', async () => {
    render(<IncidentTriagePanel rows={[row({ id: 3, parseStatus: 'raw', raw: 'token=abc', status: undefined, elapsed: undefined })]} />)

    expect(screen.getByText('No finding: parser_fields_missing')).toBeInTheDocument()
    expect(screen.getByText('Blind spots: status, elapsed')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Copy redacted incident summary' }))

    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('No finding: parser_fields_missing')))
    expect(screen.getByText('Copied')).toBeInTheDocument()
  })
})
