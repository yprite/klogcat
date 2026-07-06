import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { TargetPickerDialog } from '../components/TargetPickerDialog'
import { defaultSettings } from '../config/defaultSettings'
import { useSettingsStore } from '../stores/settingsStore'
import { useVmStore } from '../stores/vmStore'

describe('VM target tree', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      settings: {
        ...defaultSettings,
        plugins: {
          ...defaultSettings.plugins,
          targets: {
            ...defaultSettings.plugins.targets,
            awsVm: {
              ...defaultSettings.plugins.targets.awsVm,
              enabled: true,
              targetGroups: [{
                id: 'prod',
                name: 'Prod',
                enabled: true,
                bastionHost: 'bastion-prod.example.com',
                modules: [{ id: 'api', name: 'API' }],
              }],
            },
          },
        },
      },
      warning: undefined,
      loading: false,
      error: undefined,
    })
    useVmStore.setState({
      targets: [{
        id: 'prod:api:api-1',
        name: 'api-1',
        address: '10.0.0.7',
        service: 'api',
        datacenter: 'prod-dc',
        tags: ['blue'],
        bastionId: 'prod',
        bastionName: 'Prod',
        moduleId: 'api',
        moduleName: 'API',
      }],
      selectedTargetIds: [],
      loading: false,
      error: undefined,
    })
  })

  it('renders VM targets as Region/Bastion to Module to VM and selects the VM like a pod', () => {
    const onVmTargetChange = vi.fn()
    render(<TargetPickerDialog onClose={vi.fn()} onContextChange={vi.fn()} onNamespaceChange={vi.fn()} onPodChange={vi.fn()} onVmTargetChange={onVmTargetChange} />)

    fireEvent.click(screen.getByRole('tab', { name: 'AWS VM' }))

    expect(screen.getByText('Region/Bastion → Module → VM. VM instances map to Kubernetes pods.')).toBeInTheDocument()
    expect(screen.getByText('Prod')).toBeInTheDocument()
    expect(screen.getByText('API')).toBeInTheDocument()
    expect(screen.getByText('api-1')).toBeInTheDocument()
    expect(screen.getByText('10.0.0.7')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Prod / API / api-1'))

    expect(onVmTargetChange).toHaveBeenCalledWith(['prod:api:api-1'])
    expect(screen.getByLabelText('Selected targets')).toHaveTextContent('AWS VM / Prod / API / api-1 / 10.0.0.7')
  })
})
