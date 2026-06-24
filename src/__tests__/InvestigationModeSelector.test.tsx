import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { InvestigationModeSelector, type InvestigationMode } from '../components/InvestigationModeSelector'

describe('InvestigationModeSelector', () => {
  it('shows Raw Logs as the default selectable source-of-truth mode', () => {
    render(<InvestigationModeSelector value="raw" onChange={() => undefined} />)

    expect(screen.getByRole('tab', { name: 'Raw Logs' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Failed Requests' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByText('Source-of-truth log stream')).toBeInTheDocument()
  })

  it('emits Failed Requests when the request-centric mode is selected', () => {
    const onChange = vi.fn<(mode: InvestigationMode) => void>()
    render(<InvestigationModeSelector value="raw" onChange={onChange} />)

    fireEvent.click(screen.getByRole('tab', { name: 'Failed Requests' }))

    expect(onChange).toHaveBeenCalledWith('failed')
  })
})
