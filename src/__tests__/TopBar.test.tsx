import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { TopBar } from '../components/TopBar'
import { scopeKey, useKubeStore } from '../stores/kubeStore'

function resetKube() {
  useKubeStore.setState({
    contexts: [{ name: 'ctx' }, { name: 'cluster-a' }],
    currentContext: 'ctx',
    selectedContext: 'ctx',
    selectedContexts: ['ctx', 'cluster-a'],
    namespaces: [{ name: 'default' }],
    namespacesByContext: {
      ctx: [{ name: 'default' }],
      'cluster-a': [{ name: 'prod' }],
    },
    selectedNamespace: 'default',
    selectedNamespaces: { ctx: ['default'], 'cluster-a': ['prod'] },
    pods: [{ name: 'api-1', namespace: 'default', phase: 'Running', containers: ['app'] }],
    podsByScope: {
      [scopeKey('ctx', 'default')]: [
        { name: 'api-1', namespace: 'default', phase: 'Running', containers: ['app'] },
        { name: 'worker-1', namespace: 'default', phase: 'Pending', containers: ['worker'] },
      ],
      [scopeKey('cluster-a', 'prod')]: [
        { name: 'gateway-1', namespace: 'prod', phase: 'Running', containers: ['app'] },
      ],
    },
    selectedPod: 'api-1',
    selectedPods: { [scopeKey('ctx', 'default')]: ['api-1'] },
    loadingContexts: false,
    loadingNamespaces: false,
    loadingPods: false,
    error: undefined,
  })
}

describe('TopBar target picker', () => {
  beforeEach(() => resetKube())

  it('opens a tree target picker instead of exposing three native multi-selects', () => {
    render(<TopBar onSettings={() => {}} onContextChange={vi.fn()} onNamespaceChange={vi.fn()} onPodChange={vi.fn()} />)

    expect(screen.getByText('Targets: 1 selected')).toBeInTheDocument()
    expect(screen.queryByRole('listbox', { name: 'Context' })).not.toBeInTheDocument()
    expect(screen.queryByRole('listbox', { name: 'Namespace' })).not.toBeInTheDocument()
    expect(screen.queryByRole('listbox', { name: 'Pod' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /change targets/i }))

    const dialog = screen.getByRole('dialog', { name: /select log targets/i })
    expect(within(dialog).getByText('ctx')).toBeInTheDocument()
    expect(within(dialog).getByText('default')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('ctx / default / api-1')).toBeChecked()
    expect(within(dialog).getAllByText('Running').length).toBeGreaterThan(0)
  })

  it('filters the target tree and emits scoped pod selections', () => {
    const onPodChange = vi.fn()
    render(<TopBar onSettings={() => {}} onContextChange={vi.fn()} onNamespaceChange={vi.fn()} onPodChange={onPodChange} />)

    fireEvent.click(screen.getByRole('button', { name: /change targets/i }))
    const dialog = screen.getByRole('dialog', { name: /select log targets/i })
    fireEvent.change(within(dialog).getByLabelText(/search targets/i), { target: { value: 'gateway' } })

    expect(within(dialog).queryByText('api-1')).not.toBeInTheDocument()
    fireEvent.click(within(dialog).getByLabelText('cluster-a / prod / gateway-1'))

    expect(onPodChange).toHaveBeenCalledWith([`${scopeKey('ctx', 'default')}\u0000api-1`, `${scopeKey('cluster-a', 'prod')}\u0000gateway-1`])
  })
})
