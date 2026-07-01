import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { stopLogStream } from '../commands/tauriLogs'
import { useSettingsStore } from '../stores/settingsStore'
import { useLogStore } from '../stores/logStore'
import { useKubeStore } from '../stores/kubeStore'
import { useVmStore } from '../stores/vmStore'
import { isTargetPluginEnabled } from '../plugins/targetPluginRegistry'
import { defaultSettings } from '../config/defaultSettings'
import { validateSettings } from '../config/validateSettings'
import type { PersistedSettings } from '../types/settings'
import type { SourceLogType } from '../types/log'
import { t } from '../utils/i18n'
import {
  defaultLogSourcesFromPolicy,
  getLogPolicy,
  logPolicyForBuiltinId,
  sourceTypesFromPolicy,
  type LogPolicy,
  type LogPolicySelectionId,
} from '../utils/logPolicy'
import { buildPreviewWarnings, defaultPolicyText, parseLogPolicyText, policyTextForSelection, testLogPaths, trapTabFocus } from './SettingsModalLogic'
import { SettingsSectionContent } from './SettingsSectionContent'
import { SettingsFooter, SettingsNav, type SettingsSectionId, type TestPathResult } from './SettingsModalSections'

function settingsOrDefault(settings: PersistedSettings | undefined) {
  return settings ?? defaultSettings
}

function languageForDraft(draft: PersistedSettings, settings: PersistedSettings | undefined) {
  return draft.language ?? settings?.language ?? 'en'
}

function hasVmLikeTargetPlugin(settings: PersistedSettings | undefined) {
  return isTargetPluginEnabled(settings?.targetPlugins, 'awsVm') || isTargetPluginEnabled(settings?.targetPlugins, 'csvFile')
}

function policyIdForSettings(settings: PersistedSettings) {
  return settings.logPolicyId ?? 'scloud'
}

function resolvePolicyState(selectedPolicyId: LogPolicySelectionId, parsedCustomPolicy: ReturnType<typeof parseLogPolicyText>) {
  if (selectedPolicyId === 'custom') return { policyDraft: parsedCustomPolicy.policy, policyError: parsedCustomPolicy.error }
  return { policyDraft: logPolicyForBuiltinId(selectedPolicyId), policyError: undefined }
}

function buildSaveState({ draft, selectedPolicyId, policyDraft, policyError, warnings, language }: { draft: PersistedSettings; selectedPolicyId: LogPolicySelectionId; policyDraft: LogPolicy | undefined; policyError: string | undefined; warnings: string[]; language: PersistedSettings['language'] }) {
  const derivedLogSources = policyDraft ? defaultLogSourcesFromPolicy(policyDraft) : draft.logSources
  const validationErrors = validateSettings({ ...draft, logPolicyId: selectedPolicyId, logPolicy: policyDraft ?? draft.logPolicy, logSources: derivedLogSources })
  const errors = policyError ? [...validationErrors, { field: 'logPolicy', message: policyError }] : validationErrors
  const canSave = policyDraft !== undefined && errors.length === 0 && warnings.length === 0
  const saveBlockedReason = canSave
    ? undefined
    : t(language, errors.length > 0 ? 'Fix validation errors before saving.' : 'Fix path warnings before saving.')
  return { canSave, derivedLogSources, errors, saveBlockedReason }
}

export function SettingsModal({ open, onClose, onRestart = () => window.location.reload() }: { open: boolean; onClose: () => void; onRestart?: () => void }) {
  const { settings, saveSettings, resetSettings, error, loading } = useSettingsStore()
  const recordActionDebug = useLogStore((s) => s.recordActionDebug)
  const clearCachedTargets = useKubeStore((s) => s.clearCachedTargets)
  const [draft, setDraft] = useState<PersistedSettings>(() => settingsOrDefault(settings))
  const language = languageForDraft(draft, settings)
  const [selectedPolicyId, setSelectedPolicyId] = useState<LogPolicySelectionId>(() => policyIdForSettings(settingsOrDefault(settings)))
  const [policyText, setPolicyText] = useState(() => defaultPolicyText(settingsOrDefault(settings)))
  const [showPathOverrides, setShowPathOverrides] = useState(false)
  const [showRawJson, setShowRawJson] = useState(false)
  const [activeSection, setActiveSection] = useState<SettingsSectionId>('runtime')
  const [notice, setNotice] = useState<string>()
  const [testResults, setTestResults] = useState<TestPathResult[]>([])
  const [testingPaths, setTestingPaths] = useState(false)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const previouslyFocusedElementRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const next = settingsOrDefault(settings)
    setDraft(next)
    setSelectedPolicyId(policyIdForSettings(next))
    setPolicyText(defaultPolicyText(next))
    setShowPathOverrides(false)
    setShowRawJson(false)
    setActiveSection('runtime')
    setNotice(undefined)
    setTestResults([])
  }, [settings, open])

  useEffect(() => {
    if (!open) return
    previouslyFocusedElementRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeButtonRef.current?.focus()
    return () => {
      previouslyFocusedElementRef.current?.focus()
      previouslyFocusedElementRef.current = null
    }
  }, [open])

  const handleDialogKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      recordActionDebug('Settings escape pressed')
      onClose()
      return
    }
    trapTabFocus(event, dialogRef)
  }

  const parsedCustomPolicy = useMemo(() => parseLogPolicyText(policyText), [policyText])

  if (!open) return null

  const { policyDraft, policyError } = resolvePolicyState(selectedPolicyId, parsedCustomPolicy)
  const previewPolicy = policyDraft ?? getLogPolicy()
  const sourceTypes = sourceTypesFromPolicy(previewPolicy)
  const activeTarget = useKubeStore.getState().getSelectedPodTargets()[0]
  const warnings = buildPreviewWarnings(previewPolicy, sourceTypes, language)
  const { canSave, derivedLogSources, errors, saveBlockedReason } = buildSaveState({ draft, selectedPolicyId, policyDraft, policyError, warnings, language })

  const setNum = (key: 'initialTailLines' | 'bufferLimit', value: string) => { setNotice(undefined); setDraft({ ...draft, [key]: Number(value) }) }
  const setLanguage = (value: PersistedSettings['language']) => { setNotice(undefined); setDraft({ ...draft, language: value }) }
  const setDefaultNamespace = (value: string) => { setNotice(undefined); setDraft({ ...draft, defaultNamespace: value.trim() || undefined }) }
  const setShortcut = (key: keyof NonNullable<PersistedSettings['shortcuts']>, value: string) => {
    setNotice(undefined)
    setDraft({ ...draft, shortcuts: { ...(draft.shortcuts ?? {}), [key]: value.trim() } })
  }
  const updateAwsVmPlugin = (patch: Partial<PersistedSettings['targetPlugins']['awsVm']>) => {
    setNotice(undefined)
    setDraft({ ...draft, targetPlugins: { ...draft.targetPlugins, awsVm: { ...draft.targetPlugins.awsVm, ...patch } } })
  }
  const updateAwsVmLogPath = (sourceType: SourceLogType, path: string) => {
    setNotice(undefined)
    setDraft({ ...draft, targetPlugins: { ...draft.targetPlugins, awsVm: { ...draft.targetPlugins.awsVm, logPaths: { ...draft.targetPlugins.awsVm.logPaths, [sourceType]: path } } } })
  }
  const updateCsvFilePlugin = (patch: Partial<PersistedSettings['targetPlugins']['csvFile']>) => {
    setNotice(undefined)
    setDraft({ ...draft, targetPlugins: { ...draft.targetPlugins, csvFile: { ...draft.targetPlugins.csvFile, ...patch } } })
  }
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
    setPolicyText(policyTextForSelection(value, previewPolicy))
    if (value === 'custom') setShowRawJson(false)
  }
  const handleReset = async () => {
    recordActionDebug('Reset clicked')
    setNotice(undefined)
    const ok = await resetSettings()
    if (ok) {
      const saved = settingsOrDefault(useSettingsStore.getState().settings)
      if (!hasVmLikeTargetPlugin(saved)) await cleanupDisabledAwsVmPlugin()
      setDraft(saved)
      setSelectedPolicyId(policyIdForSettings(saved))
      setPolicyText(defaultPolicyText(saved))
      setNotice(t(language, 'Settings reset to defaults'))
    }
  }
  const handleSave = async () => {
    recordActionDebug(`Save clicked: validationErrors=${errors.length + warnings.length}`)
    setNotice(undefined)
    const nextDraft = {
      ...draft,
      logPolicyId: selectedPolicyId,
      logPolicy: policyDraft,
      logSources: derivedLogSources,
    }
    const wasAwsVmEnabled = isTargetPluginEnabled(settings?.targetPlugins, 'awsVm')
    const hadVmLikeTargets = hasVmLikeTargetPlugin(settings)
    const ok = canSave ? await saveSettings(nextDraft) : false
    if (ok) {
      if (!hasVmLikeTargetPlugin(nextDraft)) {
        await cleanupDisabledAwsVmPlugin()
      } else if (!hadVmLikeTargets || !wasAwsVmEnabled || isTargetPluginEnabled(nextDraft.targetPlugins, 'csvFile')) {
        await useVmStore.getState().loadTargets(nextDraft.targetPlugins)
      }
      onClose()
    }
  }
  const cleanupDisabledAwsVmPlugin = async () => {
    const logState = useLogStore.getState()
    const vmStreamIds = Object.values(logState.activeStreamMetas).filter((meta) => meta.targetKind === 'aws-vm').map((meta) => meta.streamId)
    await Promise.all(vmStreamIds.map(async (streamId) => {
      logState.markStopping(streamId)
      try { await stopLogStream(streamId); useLogStore.getState().markStopped(streamId) }
      catch (error) { useLogStore.getState().markError(streamId, error instanceof Error ? error.message : String(error)) }
    }))
    useVmStore.getState().clearTargets()
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
      setTestResults(await testLogPaths(activeTarget, sourceTypes, previewPolicy))
    } finally {
      setTestingPaths(false)
    }
  }

  return <div className="fixed inset-0 z-10 flex items-start justify-center overflow-y-auto overscroll-contain bg-black/60 p-3 sm:p-6">
    <div aria-labelledby="settings-title" aria-modal="true" onKeyDown={handleDialogKeyDown} ref={dialogRef} role="dialog" className="flex max-h-[92vh] w-[1080px] max-w-[95vw] flex-col overflow-hidden rounded border border-slate-700 bg-slate-900 shadow-2xl">
      <div className="flex shrink-0 items-center justify-between border-b border-slate-700 bg-slate-900 p-4">
        <h2 className="text-lg font-bold" id="settings-title">{t(language, 'Settings')}</h2>
        <button aria-label={t(language, 'Close settings')} ref={closeButtonRef} onClick={() => { recordActionDebug('Settings close clicked'); onClose() }}>✕</button>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden sm:grid-cols-[12rem_minmax(0,1fr)]">
        <SettingsNav activeSection={activeSection} language={language} onSectionChange={setActiveSection} />
        <div className="min-h-0 space-y-4 overflow-y-auto p-4" data-testid="settings-scroll-panel">
          <SettingsSectionContent activeSection={activeSection} activeTarget={activeTarget} draft={draft} error={error} errors={errors} handleClearTargetCache={handleClearTargetCache} handlePolicySelect={handlePolicySelect} handleRawPolicyTextChange={handleRawPolicyTextChange} handleRestart={handleRestart} handleTestPaths={handleTestPaths} language={language} loading={loading} notice={notice} policyText={policyText} previewPolicy={previewPolicy} selectedPolicyId={selectedPolicyId} setCustomPolicy={setCustomPolicy} setDefaultNamespace={setDefaultNamespace} setLanguage={setLanguage} setNum={setNum} setShortcut={setShortcut} setShowPathOverrides={setShowPathOverrides} setShowRawJson={setShowRawJson} showPathOverrides={showPathOverrides} showRawJson={showRawJson} sourceTypes={sourceTypes} testingPaths={testingPaths} testResults={testResults} updateCsvFilePlugin={updateCsvFilePlugin} updateAwsVmLogPath={updateAwsVmLogPath} updateAwsVmPlugin={updateAwsVmPlugin} warnings={warnings} />
        </div>
      </div>
      <SettingsFooter canSave={canSave} handleReset={handleReset} handleSave={handleSave} language={language} loading={loading} saveBlockedReason={saveBlockedReason} />
    </div>
  </div>
}
