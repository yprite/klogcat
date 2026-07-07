import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ViewerPluginSettingsPanels } from '../plugins/viewerPluginSettingsPanels'
import { defaultSettings } from '../config/defaultSettings'

describe('viewer plugin settings panels', () => {
  it('renders raw logs as an always enabled core viewer', () => {
    render(
      <ViewerPluginSettingsPanels
        draft={defaultSettings}
        settingsKey="raw"
        updateViewerPlugin={vi.fn()}
      />,
    )

    expect(screen.getByText('Raw Logs Viewer Plugin')).toBeInTheDocument()
    expect(screen.getByText('Always enabled')).toBeInTheDocument()
  })

  it('updates graph viewer enabled state through the plugin settings patch', () => {
    const updateViewerPlugin = vi.fn()
    render(
      <ViewerPluginSettingsPanels
        draft={defaultSettings}
        settingsKey="apiFlowGraph"
        updateViewerPlugin={updateViewerPlugin}
      />,
    )

    const checkbox = screen.getByRole('checkbox', { name: 'Enabled' })
    expect(checkbox).toBeChecked()
    fireEvent.click(checkbox)

    expect(updateViewerPlugin).toHaveBeenCalledWith('apiFlowGraph', { enabled: false })
  })

  it('renders nothing for unknown viewer plugin settings keys', () => {
    const { container } = render(
      <ViewerPluginSettingsPanels
        draft={defaultSettings}
        settingsKey="unknown"
        updateViewerPlugin={vi.fn()}
      />,
    )

    expect(container).toBeEmptyDOMElement()
  })
})
