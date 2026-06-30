import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { GrepBar } from '../components/GrepBar'
import { InvestigationModeSelector } from '../components/InvestigationModeSelector'
import { LogToolbar } from '../components/LogToolbar'
import { LogViewer } from '../components/LogViewer'
import { TargetPickerDialog } from '../components/TargetPickerDialog'
import { TopBar } from '../components/TopBar'
import { defaultSettings } from '../config/defaultSettings'
import { useKubeStore } from '../stores/kubeStore'
import { resetLogStoreForTests } from '../stores/logStore'
import { useSettingsStore } from '../stores/settingsStore'

function setKoreanSettings() {
  useSettingsStore.setState({
    settings: { ...defaultSettings, language: 'ko' },
    warning: undefined,
    loading: false,
    error: undefined,
  })
}

function resetKubeStore() {
  useKubeStore.setState({
    contexts: [{ name: 'ctx' }],
    currentContext: 'ctx',
    selectedContext: 'ctx',
    selectedContexts: ['ctx'],
    namespaces: [{ name: 'default' }],
    namespacesByContext: { ctx: [{ name: 'default' }] },
    selectedNamespace: 'default',
    selectedNamespaces: { ctx: ['default'] },
    pods: [{ name: 'api-1', namespace: 'default', phase: 'Running', containers: ['app'] }],
    podsByScope: { 'ctx\u0000default': [{ name: 'api-1', namespace: 'default', phase: 'Running', containers: ['app'] }] },
    selectedPod: 'api-1',
    selectedPods: { 'ctx\u0000default': ['api-1'] },
    loadingContexts: false,
    loadingNamespaces: false,
    loadingPods: false,
    cacheRefreshing: false,
    cacheLoaded: true,
    cacheLastRefreshAt: Date.now(),
    error: undefined,
  })
}

const koreanModes = [
  { id: 'raw', label: 'Raw Logs', description: 'Source-of-truth log stream' },
  { id: 'klogcat.example.failed-requests', label: 'Failed Requests', description: 'SDK-only request-centric investigation view' },
]

describe('Korean i18n rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetLogStoreForTests()
    setKoreanSettings()
    resetKubeStore()
  })

  it('renders investigation tabs and query controls in Korean', () => {
    render(<>
      <InvestigationModeSelector value="raw" modes={koreanModes} onChange={() => undefined} />
      <GrepBar />
    </>)

    expect(screen.getByRole('tab', { name: '원본 로그' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: '실패 요청' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByText('신뢰 원본 로그 스트림')).toBeInTheDocument()
    expect(screen.getByLabelText('쿼리')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '정규식' })).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/텍스트, field:value/)).toBeInTheDocument()
  })

  it('renders toolbar and target picker chrome in Korean', () => {
    render(<>
      <LogToolbar sourceTypes={['info']} onSourceTypesChange={() => undefined} />
      <TargetPickerDialog onClose={() => undefined} onContextChange={() => undefined} onNamespaceChange={() => undefined} onPodChange={() => undefined} />
    </>)

    expect(screen.getByLabelText('뷰어 컨트롤')).toContainElement(screen.getByRole('button', { name: '시작' }))
    expect(screen.getByLabelText('뷰어 컨트롤')).toContainElement(screen.getByRole('button', { name: '지우기' }))
    expect(screen.getByLabelText('런타임 상태')).toHaveTextContent(/시작: 활성화됨/)
    expect(screen.getByRole('dialog', { name: '로그 대상 선택' })).toBeInTheDocument()
    expect(screen.getByLabelText('대상 검색')).toHaveAttribute('placeholder', 'context / namespace / pod / phase / container / VM 이름 / IP')
    expect(screen.getByLabelText('선택된 대상')).toHaveTextContent('1개 선택됨')
  })

  it('shows Korean Choose Target CTAs before a log target is selected', () => {
    useKubeStore.setState({ selectedPod: undefined, selectedPods: {} })
    render(<>
      <TopBar onSettings={() => undefined} onContextChange={() => undefined} onNamespaceChange={() => undefined} onPodChange={() => undefined} />
      <LogViewer />
    </>)

    expect(screen.getByText('선택된 로그 대상 없음')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '대상 변경' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: '대상 선택' })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: '대상 선택' }).every((button) => !button.hasAttribute('disabled'))).toBe(true)
  })
})
