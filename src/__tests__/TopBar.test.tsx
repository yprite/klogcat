import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { TopBar } from '../components/TopBar'
import { scopeKey, useKubeStore } from '../stores/kubeStore'
import { listNamespaces } from '../commands/tauriKube'

vi.mock('../commands/tauriKube', () => ({
  getCurrentContext: vi.fn(async () => 'ctx'),
  listContexts: vi.fn(async () => ({ contexts: [{ name: 'ctx' }, { name: 'cluster-a' }] })),
  listNamespaces: vi.fn(async (context: string) => ({ context, namespaces: [{ name: context === 'cluster-a' ? 'prod' : 'default' }] })),
  listPods: vi.fn(async (namespace: string, context: string) => ({ context, namespace, pods: [{ name: `${namespace}-pod`, namespace, phase: 'Running', containers: ['app'] }] })),
}))

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
    cacheRefreshing: false,
    cacheLoaded: true,
    cacheLastRefreshAt: Date.now(),
    error: undefined,
  })
}

describe('TopBar target picker', () => {
  beforeEach(() => {
    resetKube()
    vi.clearAllMocks()
    vi.mocked(listNamespaces).mockImplementation(async (context?: string) => ({ context, namespaces: [{ name: context === 'cluster-a' ? 'prod' : 'default' }] }))
  })

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

  it('collapses and expands each cluster in the target picker', () => {
    render(<TopBar onSettings={() => {}} onContextChange={vi.fn()} onNamespaceChange={vi.fn()} onPodChange={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /change targets/i }))
    const dialog = screen.getByRole('dialog', { name: /select log targets/i })

    expect(within(dialog).getByText('default')).toBeInTheDocument()
    const collapseCtx = within(dialog).getByRole('button', { name: 'Collapse ctx' })
    expect(collapseCtx).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(collapseCtx)

    expect(within(dialog).queryByText('default')).not.toBeInTheDocument()
    expect(within(dialog).queryByLabelText('ctx / default / api-1')).not.toBeInTheDocument()
    const expandCtx = within(dialog).getByRole('button', { name: 'Expand ctx' })
    expect(expandCtx).toHaveAttribute('aria-expanded', 'false')
    expect(within(dialog).getByText('cluster-a')).toBeInTheDocument()
    expect(within(dialog).getByText('prod')).toBeInTheDocument()

    fireEvent.click(expandCtx)

    expect(within(dialog).getByText('default')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('ctx / default / api-1')).toBeChecked()
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

  it('locks target controls while an async selection change is pending', async () => {
    let resolveSelection!: () => void
    const onPodChange = vi.fn((pods: string[]) => new Promise<void>((resolve) => {
      resolveSelection = () => {
        useKubeStore.getState().selectPods(pods)
        resolve()
      }
    }))
    render(<TopBar onSettings={() => {}} onContextChange={vi.fn()} onNamespaceChange={vi.fn()} onPodChange={onPodChange} />)

    fireEvent.click(screen.getByRole('button', { name: /change targets/i }))
    const dialog = screen.getByRole('dialog', { name: /select log targets/i })
    fireEvent.click(within(dialog).getByLabelText('cluster-a / prod / gateway-1'))

    expect(within(dialog).getByLabelText('ctx / default / worker-1')).toBeDisabled()
    fireEvent.click(within(dialog).getByLabelText('ctx / default / worker-1'))
    expect(onPodChange).toHaveBeenCalledTimes(1)

    await act(async () => { resolveSelection() })
    await waitFor(() => expect(within(dialog).getByLabelText('ctx / default / worker-1')).not.toBeDisabled())
    fireEvent.click(within(dialog).getByLabelText('ctx / default / worker-1'))

    expect(onPodChange).toHaveBeenLastCalledWith([
      `${scopeKey('ctx', 'default')}\u0000api-1`,
      `${scopeKey('cluster-a', 'prod')}\u0000gateway-1`,
      `${scopeKey('ctx', 'default')}\u0000worker-1`,
    ])
  })

  it('keeps the target tree and selected-targets panes scrollable inside the picker', () => {
    render(<TopBar onSettings={() => {}} onContextChange={vi.fn()} onNamespaceChange={vi.fn()} onPodChange={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /change targets/i }))
    const dialog = screen.getByRole('dialog', { name: /select log targets/i })

    expect(within(dialog).getByLabelText('Target tree')).toHaveClass('overflow-y-auto')
    expect(within(dialog).getByLabelText('Selected targets')).toHaveClass('overflow-y-auto')
  })

  it('hides clusters that cannot load pod-accessible namespaces', async () => {
    vi.mocked(listNamespaces).mockImplementation(async (context?: string) => {
      if (context === 'blocked') throw { code: 'list_namespaces_failed', message: 'failed to list namespaces' }
      if (context === 'empty') return { context, namespaces: [] }
      return { context, namespaces: [{ name: 'default' }] }
    })
    useKubeStore.setState({
      contexts: [{ name: 'ctx' }, { name: 'blocked' }, { name: 'empty' }],
      selectedContext: 'ctx',
      selectedContexts: ['ctx'],
      namespacesByContext: { ctx: [{ name: 'default' }] },
    })
    render(<TopBar onSettings={() => {}} onContextChange={vi.fn()} onNamespaceChange={vi.fn()} onPodChange={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /change targets/i }))
    const dialog = screen.getByRole('dialog', { name: /select log targets/i })

    await waitFor(() => expect(within(dialog).queryByText('blocked')).not.toBeInTheDocument())
    expect(within(dialog).queryByText('empty')).not.toBeInTheDocument()
    expect(within(dialog).getByText('ctx')).toBeInTheDocument()
  })

  it('shows an immediate loading state while lazy namespaces are loading', async () => {
    useKubeStore.setState({ selectedContext: undefined, selectedContexts: [], namespacesByContext: {}, namespaces: [], loadingNamespaces: true })
    render(<TopBar onSettings={() => {}} onContextChange={vi.fn()} onNamespaceChange={vi.fn()} onPodChange={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /change targets/i }))
    const dialog = screen.getByRole('dialog', { name: /select log targets/i })

    expect(within(dialog).getByRole('status', { name: /loading targets/i })).toHaveClass('animate-klogcat-status-glow')
    expect(within(dialog).getByLabelText(/target discovery progress/i).querySelector('.animate-klogcat-progress')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Loading namespaces for ctx')).toBeInTheDocument()
    await waitFor(() => expect(useKubeStore.getState().loadingNamespaces).toBe(false))
  })

  it('animates cache refresh progress in the top bar', () => {
    useKubeStore.setState({ cacheRefreshing: true })
    render(<TopBar onSettings={() => {}} onContextChange={vi.fn()} onNamespaceChange={vi.fn()} onPodChange={vi.fn()} />)

    expect(screen.getByRole('status', { name: /refreshing target cache/i })).toHaveClass('animate-klogcat-status-glow')
    expect(screen.getByText(/Targets: 1 selected/)).toBeInTheDocument()
  })
})
