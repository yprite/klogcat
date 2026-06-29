import type { KeyboardEvent, RefObject } from 'react'
import { checkLogPath } from '../commands/tauriLogs'
import type { SelectedPodTarget } from '../stores/kubeStore'
import type { PersistedSettings } from '../types/settings'
import { t } from '../utils/i18n'
import {
  assertValidLogPolicy,
  buildLogPathFromPolicy,
  getLogPolicy,
  logPathTemplateTokens,
  logPolicyForBuiltinId,
  type LogPolicy,
  type LogPolicySelectionId,
} from '../utils/logPolicy'
import type { TestPathResult } from './SettingsModalSections'

const knownPathTokens = new Set<string>(logPathTemplateTokens.map((item) => item.token))

export function clonePolicy(policy: LogPolicy): LogPolicy {
  return JSON.parse(JSON.stringify(policy)) as LogPolicy
}

function pathWarnings(pattern: string, language: PersistedSettings['language']) {
  const warnings: string[] = []
  const tokens = pattern.match(/\[[^\]]+\]/g) ?? []
  for (const token of tokens) {
    if (!knownPathTokens.has(token)) {
      warnings.push(t(language, 'Unknown variable: {token}', { token }))
      if (token === '[namesapce]') warnings.push(t(language, 'Did you mean [namespace]?'))
    }
  }
  if (!pattern.trim()) warnings.push(t(language, 'Path pattern cannot be empty.'))
  if (!pattern.startsWith('/')) warnings.push(t(language, 'Path pattern should start with /.'))
  if (!pattern.includes('[namespace]')) warnings.push(t(language, 'Include [namespace] so namespaces resolve to separate paths.'))
  if (!pattern.includes('[podname]') && !pattern.includes('[pod]')) warnings.push(t(language, 'Include [podname] or [pod] so pods resolve to separate paths.'))
  return warnings
}

export function buildPreviewWarnings(previewPolicy: LogPolicy, sourceTypes: string[], language: PersistedSettings['language']) {
  return [
    ...pathWarnings(previewPolicy.pathTemplate, language),
    ...sourceTypes.flatMap((sourceType) => {
      const sourcePathTemplate = previewPolicy.sources[sourceType]?.pathTemplate
      if (!sourcePathTemplate) return []
      const label = previewPolicy.sources[sourceType]?.label ?? sourceType
      return pathWarnings(sourcePathTemplate, language).map((warning) => `${label}: ${warning}`)
    }),
  ]
}

export function parseLogPolicyText(policyText: string) {
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
}

export function policyTextForSelection(value: LogPolicySelectionId, previewPolicy: LogPolicy) {
  const policy = value === 'custom' ? clonePolicy(previewPolicy) : logPolicyForBuiltinId(value)
  return JSON.stringify(policy, null, 2)
}

export function trapTabFocus(event: KeyboardEvent<HTMLDivElement>, dialogRef: RefObject<HTMLDivElement | null>) {
  if (event.key !== 'Tab') return
  const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? [])
  if (focusable.length === 0) return
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

function containerForTarget(activeTarget: SelectedPodTarget, previewPolicy: LogPolicy) {
  if (activeTarget.pod.containers.includes(previewPolicy.defaultContainer)) return previewPolicy.defaultContainer
  return activeTarget.pod.containers[0] ?? previewPolicy.defaultContainer
}

export async function testLogPaths(activeTarget: SelectedPodTarget, sourceTypes: string[], previewPolicy: LogPolicy): Promise<TestPathResult[]> {
  return Promise.all(sourceTypes.map(async (sourceType) => {
    const path = buildLogPathFromPolicy(previewPolicy, activeTarget.namespace, activeTarget.pod.name, sourceType)
    const container = containerForTarget(activeTarget, previewPolicy)
    try {
      const result = await checkLogPath({ context: activeTarget.context, namespace: activeTarget.namespace, pod: activeTarget.pod.name, container, sourceType, filePath: path })
      return { sourceType, label: previewPolicy.sources[sourceType]?.label ?? sourceType, path, ok: result.exists, message: result.exists ? 'OK' : result.message ?? 'Not found' }
    } catch (error) {
      return { sourceType, label: previewPolicy.sources[sourceType]?.label ?? sourceType, path, ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  }))
}

export function defaultPolicyText(settings: PersistedSettings) {
  return JSON.stringify(settings.logPolicy ?? getLogPolicy(), null, 2)
}
