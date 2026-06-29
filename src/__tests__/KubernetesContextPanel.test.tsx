import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { KubernetesContextPanel } from '../components/KubernetesContextPanel'

describe('KubernetesContextPanel', () => {
  beforeEach(() => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => undefined) } })
  })

  it('renders structured kubectl diagnostics for the selected target and copies argv-rendered command', async () => {
    render(<KubernetesContextPanel target={{ context: 'kind dev', namespace: 'prod', pod: { name: 'api-1', namespace: 'prod', phase: 'Running', containers: ['app'] } }} />)

    expect(screen.getByRole('region', { name: 'Kubernetes context' })).toBeInTheDocument()
    expect(screen.getByText('kind dev / prod / api-1')).toBeInTheDocument()
    expect(screen.getByText("kubectl --context 'kind dev' get pod -n prod api-1 -o json")).toBeInTheDocument()
    expect(screen.getByText("kubectl --context 'kind dev' get events.events.k8s.io -n prod --field-selector involvedObject.name=api-1 -o json")).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Copy pod context command' }))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith("kubectl --context 'kind dev' get pod -n prod api-1 -o json"))
  })

  it('shows an explicit no-target state', () => {
    render(<KubernetesContextPanel />)
    expect(screen.getByText('Select a target to inspect Kubernetes context.')).toBeInTheDocument()
  })
})
