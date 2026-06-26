import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { InvestigationModeSelector, type InvestigationMode } from '../components/InvestigationModeSelector'
import { getLogViewerExtensions } from '../extensions/logViewerExtensions'

describe('InvestigationModeSelector', () => {
  it('shows Raw Logs as the default selectable source-of-truth mode', () => {
    render(<InvestigationModeSelector value="raw" modes={getLogViewerExtensions()} onChange={() => undefined} />)

    expect(screen.getByRole('tab', { name: 'Raw Logs' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Source-of-truth log stream')).toBeInTheDocument()
  })

  it('emits a third-party extension id when a registered mode is selected', () => {
    const onChange = vi.fn<(mode: InvestigationMode) => void>()
    render(<InvestigationModeSelector
      value="raw"
      modes={[...getLogViewerExtensions(), { id: 'vendor.requests', label: 'Requests', description: 'Vendor request view' }]}
      onChange={onChange}
    />)

    fireEvent.click(screen.getByRole('tab', { name: 'Requests' }))

    expect(onChange).toHaveBeenCalledWith('vendor.requests')
  })

  it('renders registered third-party viewer options from the caller', () => {
    const onChange = vi.fn<(mode: InvestigationMode) => void>()
    render(<InvestigationModeSelector
      value="vendor.latency"
      modes={[...getLogViewerExtensions(), { id: 'vendor.latency', label: 'Latency Map', description: 'Vendor latency breakdown' }]}
      onChange={onChange}
    />)

    expect(screen.getByRole('tab', { name: 'Latency Map' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Vendor latency breakdown')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Raw Logs' }))
    expect(onChange).toHaveBeenCalledWith('raw')
  })

  it('wires tab accessibility metadata and keyboard navigation', () => {
    const onChange = vi.fn<(mode: InvestigationMode) => void>()
    render(<InvestigationModeSelector
      value="raw"
      modes={[...getLogViewerExtensions(), { id: 'vendor.latency', label: 'Latency Map', description: 'Vendor latency breakdown' }]}
      onChange={onChange}
    />)

    const rawTab = screen.getByRole('tab', { name: 'Raw Logs' })
    expect(rawTab).toHaveAttribute('id', 'log-viewer-tab-raw')
    expect(rawTab).toHaveAttribute('aria-controls', 'log-viewer-panel-raw')
    fireEvent.keyDown(screen.getByRole('tablist', { name: 'Investigation mode' }), { key: 'ArrowRight' })
    expect(onChange).toHaveBeenCalledWith('vendor.latency')
  })

  it('supports reverse, first, and last keyboard tab navigation', () => {
    const onChange = vi.fn<(mode: InvestigationMode) => void>()
    const modes = [
      ...getLogViewerExtensions(),
      { id: 'vendor.latency', label: 'Latency Map', description: 'Vendor latency breakdown' },
      { id: 'vendor.errors', label: 'Errors', description: 'Vendor error breakdown' },
    ]
    render(<InvestigationModeSelector value="vendor.latency" modes={modes} onChange={onChange} />)

    const tablist = screen.getByRole('tablist', { name: 'Investigation mode' })
    fireEvent.keyDown(tablist, { key: 'ArrowLeft' })
    expect(onChange).toHaveBeenCalledWith('raw')
    fireEvent.keyDown(tablist, { key: 'Home' })
    expect(onChange).toHaveBeenCalledWith('raw')
    fireEvent.keyDown(tablist, { key: 'End' })
    expect(onChange).toHaveBeenCalledWith('vendor.errors')
  })

  it('ignores keyboard navigation when no modes are available', () => {
    const onChange = vi.fn<(mode: InvestigationMode) => void>()
    render(<InvestigationModeSelector value="missing" modes={[]} onChange={onChange} />)

    fireEvent.keyDown(screen.getByRole('tablist', { name: 'Investigation mode' }), { key: 'ArrowRight' })

    expect(onChange).not.toHaveBeenCalled()
  })
})
