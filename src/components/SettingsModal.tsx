import { useEffect, useMemo, useState } from 'react'
import { checkLogPath } from '../commands/tauriLogs'
import { useSettingsStore } from '../stores/settingsStore'
import { useLogStore } from '../stores/logStore'
import { useKubeStore } from '../stores/kubeStore'
import { defaultSettings } from '../config/defaultSettings'
import { validateSettings } from '../config/validateSettings'
import type { PersistedSettings } from '../types/settings'
import { t } from '../utils/i18n'
import {
  assertValidLogPolicy,
  buildLogPathFromPolicy,
  getLogPolicy,
  logPathTemplateTokens,
  logPolicyForBuiltinId,
  sourceTypesFromPolicy,
  type LogPolicy,
  type LogPolicySelectionId,
} from '../utils/logPolicy'
import { AdvancedSection, LogSourceSection, MaintenanceSection, RuntimeSection, SettingsFooter, SettingsNav, StatusMessages, type TestPathResult } from './SettingsModalSections'

const knownPathTokens = new Set<string>(logPathTemplateTokens.map((item) => item.token))

function clonePolicy(policy: LogPolicy): LogPolicy {
  return JSON.parse(JSON.stringify(policy)) as LogPolicy
}

function pathWarnings(pattern: string) {
  const warnings: string[] = []
  const tokens = pattern.match(/\[[^\]]+\]/g) ?? []
  for (const token of tokens) {
    if (!knownPathTokens.has(token)) {
      warnings.push(`Unknown variable: ${token}`)
      if (token === '[namesapce]') warnings.push('Did you mean [namespace]?')
    }
  }
  if (!pattern.trim()) warnings.push('Path pattern cannot be empty.')
  if (!pattern.startsWith('/')) warnings.push('Path pattern should start with /.')
  if (!pattern.includes('[namespace]')) warnings.push('Include [namespace] so namespaces resolve to separate paths.')
  if (!pattern.includes('[podname]') && !pattern.includes('[pod]')) warnings.push('Include [podname] or [pod] so pods resolve to separate paths.')
  return warnings
}

export function SettingsModal({ open, onClose, onRestart = () => window.location.reload() }: { open: boolean; onClose: () => void; onRestart?: () => void }) {
  const { settings, saveSettings, resetSettings, error, loading } = useSettingsStore()
  const recordActionDebug = useLogStore((s) => s.recordActionDebug)
  const clearCachedTargets = useKubeStore((s) => s.clearCachedTargets)
  const [draft, setDraft] = useState<PersistedSettings>(settings ?? defaultSettings)
  const language = draft.language ?? settings?.language ?? 'en'
  const [selectedPolicyId, setSelectedPolicyId] = useState<LogPolicySelectionId>((settings ?? defaultSettings).logPolicyId ?? 'scloud')
  const [policyText, setPolicyText] = useState(() => JSON.stringify((settings ?? defaultSettings).logPolicy ?? getLogPolicy(), null, 2))
  const [showPathOverrides, setShowPathOverrides] = useState(false)
  const [showRawJson, setShowRawJson] = useState(false)
  const [notice, setNotice] = useState<string>()
  const [testResults, setTestResults] = useState<TestPathResult[]>([])
  const [testingPaths, setTestingPaths] = useState(false)

  useEffect(() => {
    const next = settings ?? defaultSettings
    setDraft(next)
    setSelectedPolicyId(next.logPolicyId ?? 'scloud')
    setPolicyText(JSON.stringify(next.logPolicy ?? getLogPolicy(), null, 2))
    setShowPathOverrides(false)
    setShowRawJson(false)
    setNotice(undefined)
    setTestResults([])
  }, [settings, open])

  const parsedCustomPolicy = useMemo(() => {
    try {
      const parsed = JSON.parse(policyText) as unknown
      try {
        assertValidLogPolicy(parsed)
        return { policy: parsed as LogPolicy }
      } catch (error) {
        return { policy: parsed as LogPolicy, error: error instanceof Error ? error.message : String(error) }
      }
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }, [policyText])

  if (!open) return null

  const policyDraft = selectedPolicyId === 'custom'
    ? parsedCustomPolicy.policy
    : logPolicyForBuiltinId(selectedPolicyId)
  const policyError = selectedPolicyId === 'custom' ? parsedCustomPolicy.error : undefined
  const previewPolicy = policyDraft ?? getLogPolicy()
  const sourceTypes = sourceTypesFromPolicy(previewPolicy)
  const activeTarget = useKubeStore.getState().getSelectedPodTargets()[0]
  const warnings = pathWarnings(previewPolicy.pathTemplate)
  const errors = [...validateSettings({ ...draft, logPolicyId: selectedPolicyId, logPolicy: policyDraft ?? draft.logPolicy }), ...(policyError ? [{ field: 'logPolicy', message: policyError }] : [])]

  const setNum = (key: 'initialTailLines' | 'bufferLimit', value: string) => { setNotice(undefined); setDraft({ ...draft, [key]: Number(value) }) }
  const setLanguage = (value: PersistedSettings['language']) => { setNotice(undefined); setDraft({ ...draft, language: value }) }
  const setCustomPolicy = (policy: LogPolicy, message = t(language, 'Profile: Custom, based on SCloud')) => {
    setNotice(message)
    setSelectedPolicyId('custom')
    setPolicyText(JSON.stringify(policy, null, 2))
    setShowRawJson(false)
    setTestResults([])
  }
  const handlePolicySelect = (value: LogPolicySelectionId) => {
    setNotice(undefined)
    setSelectedPolicyId(value)
    setTestResults([])
    if (value !== 'custom') setPolicyText(JSON.stringify(logPolicyForBuiltinId(value), null, 2))
    else {
      setPolicyText(JSON.stringify(clonePolicy(previewPolicy), null, 2))
      setShowRawJson(false)
    }
  }
  const handleReset = async () => {
    recordActionDebug('Reset clicked')
    setNotice(undefined)
    const ok = await resetSettings()
    if (ok) {
      const saved = useSettingsStore.getState().settings ?? defaultSettings
      setDraft(saved)
      setSelectedPolicyId(saved.logPolicyId ?? 'scloud')
      setPolicyText(JSON.stringify(saved.logPolicy ?? getLogPolicy(), null, 2))
      setNotice(t(language, 'Settings reset to defaults'))
    }
  }
  const handleSave = async () => {
    recordActionDebug(`Save clicked: validationErrors=${errors.length + warnings.length}`)
    setNotice(undefined)
    const nextDraft = { ...draft, logPolicyId: selectedPolicyId, logPolicy: policyDraft }
    const ok = policyDraft && errors.length === 0 && warnings.filter((warning) => warning.startsWith('Unknown') || warning.includes('cannot')).length === 0 ? await saveSettings(nextDraft) : false
    if (ok) onClose()
  }
  const handleClearTargetCache = () => {
    recordActionDebug('Clear target cache clicked')
    clearCachedTargets()
    setNotice(t(language, 'Target cache cleared. Restart to reload fresh Kubernetes targets.'))
  }
  const handleRestart = () => {
    recordActionDebug('Restart app clicked')
    onRestart()
  }
  const handleRawPolicyTextChange = (value: string) => {
    setNotice(undefined)
    setSelectedPolicyId('custom')
    setPolicyText(value)
  }
  const handleTestPaths = async () => {
    if (!activeTarget) {
      setNotice(t(language, 'Select a namespace and pod before testing paths.'))
      return
    }
    setTestingPaths(true)
    setNotice(undefined)
    try {
      const results = await Promise.all(sourceTypes.map(async (sourceType) => {
        const path = buildLogPathFromPolicy(previewPolicy, activeTarget.namespace, activeTarget.pod.name, sourceType)
        const container = activeTarget.pod.containers.includes(previewPolicy.defaultContainer) ? previewPolicy.defaultContainer : activeTarget.pod.containers[0] ?? previewPolicy.defaultContainer
        try {
          const result = await checkLogPath({ context: activeTarget.context, namespace: activeTarget.namespace, pod: activeTarget.pod.name, container, sourceType, filePath: path })
          return { sourceType, label: previewPolicy.sources[sourceType]?.label ?? sourceType, path, ok: result.exists, message: result.exists ? 'OK' : result.message ?? 'Not found' }
        } catch (error) {
          return { sourceType, label: previewPolicy.sources[sourceType]?.label ?? sourceType, path, ok: false, message: error instanceof Error ? error.message : String(error) }
        }
      }))
      setTestResults(results)
    } finally {
      setTestingPaths(false)
    }
  }

  return <div className="fixed inset-0 z-10 flex items-start justify-center overflow-y-auto overscroll-contain bg-black/60 p-3 sm:p-6">
    <div aria-labelledby="settings-title" aria-modal="true" role="dialog" className="flex max-h-[92vh] w-[1080px] max-w-[95vw] flex-col overflow-hidden rounded border border-slate-700 bg-slate-900 shadow-2xl">
      <div className="flex shrink-0 items-center justify-between border-b border-slate-700 bg-slate-900 p-4">
        <h2 className="text-lg font-bold" id="settings-title">{t(language, 'Settings')}</h2>
        <button onClick={() => { recordActionDebug('Settings close clicked'); onClose() }}>✕</button>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[12rem_minmax(0,1fr)] overflow-hidden">
        <SettingsNav />
        <div className="min-h-0 space-y-4 overflow-y-auto p-4" data-testid="settings-scroll-panel">
          <RuntimeSection draft={draft} setNum={setNum} />
          <section id="settings-appearance" className="rounded border border-slate-700 bg-slate-950/60 p-3">
            <h3 className="text-sm font-semibold text-white">{t(language, 'Appearance')}</h3>
            <p className="mt-1 text-xs text-slate-400">{t(language, 'Choose the UI language used by top-level navigation and future localized labels.')}</p>
            <label className="mt-2 block text-sm" htmlFor="settings-language">{t(language, 'Language')}</label>
            <select id="settings-language" className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2 text-sm text-white" value={draft.language ?? 'en'} onChange={(e) => setLanguage(e.target.value as PersistedSettings['language'])}>
              <option value="en">English / {t(language, 'English')}</option>
              <option value="ko">한국어 / {t(language, 'Korean')}</option>
            </select>
          </section>
          <LogSourceSection activeTarget={activeTarget} handlePolicySelect={handlePolicySelect} handleTestPaths={handleTestPaths} previewPolicy={previewPolicy} selectedPolicyId={selectedPolicyId} setCustomPolicy={setCustomPolicy} sourceTypes={sourceTypes} testingPaths={testingPaths} testResults={testResults} warnings={warnings} />
          <AdvancedSection onRawPolicyTextChange={handleRawPolicyTextChange} policyText={policyText} previewPolicy={previewPolicy} setCustomPolicy={setCustomPolicy} setShowPathOverrides={setShowPathOverrides} setShowRawJson={setShowRawJson} showPathOverrides={showPathOverrides} showRawJson={showRawJson} sourceTypes={sourceTypes} />
          <StatusMessages error={error} errors={errors} notice={notice} />
          <MaintenanceSection handleClearTargetCache={handleClearTargetCache} handleRestart={handleRestart} loading={loading} />
        </div>
      </div>
      <SettingsFooter handleReset={handleReset} handleSave={handleSave} loading={loading} />
    </div>
  </div>
}
