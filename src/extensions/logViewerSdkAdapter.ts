import type { ParsedLogLine } from '../types/log'
import type { LogViewerExtensionSnapshot, SdkLogFields, SdkLogRow } from '../sdk/log-viewer'
import type { LogStoreState } from '../stores/logStore'
import type { KubeStoreState } from '../stores/kubeStore'
import { useVmStore } from '../stores/vmStore'
import { useSettingsStore } from '../stores/settingsStore'
import { isTargetPluginEnabled } from '../plugins/targetPluginRegistry'

const publicFieldKeys = [
  'timestamp',
  'jsonLogType',
  'level',
  'host',
  'service',
  'serviceId',
  'module',
  'submodule',
  'trId',
  'traceId',
  'method',
  'url',
  'status',
  'elapsed',
  'length',
  'rcode',
  'rmsg',
  'exceptionName',
  'apiName',
  'logger',
  'thread',
  'errorReason',
  'errorMethod',
  'errorPath',
  'errorServerName',
  'errorTimestamp',
  'message',
] as const

function sdkValue(value: unknown) {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  return value === null ? null : undefined
}

export function toSdkLogRow(row: ParsedLogLine): SdkLogRow {
  const fields = Object.fromEntries(publicFieldKeys.flatMap((key) => {
    const value = sdkValue(row[key])
    return value === undefined ? [] : [[key, value]]
  })) as SdkLogFields

  return {
    id: row.id,
    sourceId: row.sourceId,
    sourceType: row.sourceType,
    raw: row.raw,
    parseStatus: row.parseStatus,
    receivedAt: row.receivedAt,
    timestamp: row.timestamp,
    summary: row.summary,
    target: {
      kind: row.targetKind ?? 'kubernetes',
      context: row.context,
      namespace: row.namespace,
      pod: row.pod,
      container: row.container,
      vm: row.targetKind === 'aws-vm' ? row.vm?.target : undefined,
    },
    correlationIds: {
      trId: row.trId,
      traceId: row.traceId,
    },
    request: row.method || row.url || row.status || row.elapsed !== undefined ? {
      method: row.method,
      url: row.url,
      status: row.status,
      elapsed: row.elapsed,
    } : undefined,
    error: row.errorMethod || row.errorPath || row.errorReason ? {
      method: row.errorMethod,
      path: row.errorPath,
      reason: row.errorReason,
    } : undefined,
    fields,
    diagnostics: row.diagnostics,
  }
}

export function toLogViewerExtensionSnapshot(
  log: LogStoreState,
  kube: KubeStoreState,
  vm = useVmStore.getState(),
  settings = useSettingsStore.getState(),
): LogViewerExtensionSnapshot {
  const vmTargetsEnabled = isTargetPluginEnabled(settings.settings?.targetPlugins, 'awsVm')
  return {
    rows: log.rows.map(toSdkLogRow),
    visibleRows: log.visibleRows.map(toSdkLogRow),
    totalRowCount: log.rows.length,
    visibleRowCount: log.visibleRows.length,
    rowLimit: log.bufferLimit,
    grepQuery: log.grepQuery,
    grepMode: log.grepMode,
    viewerPaused: log.viewerPaused,
    autoScrollEnabled: log.autoScrollEnabled,
    streamStatus: log.streamStatus,
    selectedTargetCount: kube.getSelectedPodTargets().length + (vmTargetsEnabled ? vm.getSelectedVmTargets().length : 0),
  }
}
