import type { SourceLogType, LogColumnKey } from '../types/log'

export type QuerySuggestionPolicy = {
  insert: string
  label: string
  description: string
}

export type LogSourcePolicy = {
  label: string
  pathSuffix: string
  columns: readonly LogColumnKey[]
}

export type LogPolicy = {
  version: 1
  pathTemplate: string
  defaultContainer: string
  sources: Record<SourceLogType, LogSourcePolicy>
  columns: {
    labels: Partial<Record<LogColumnKey, string>>
    defaultVisiblePriority: readonly LogColumnKey[]
  }
  query: {
    sourceAliases: readonly string[]
    correlationFields: readonly LogColumnKey[]
    suggestions: readonly QuerySuggestionPolicy[]
  }
}

export const accessLogColumnPolicy = ['timestamp', 'jsonLogType', 'host', 'service', 'module', 'serviceId', 'trId', 'epochTime', 'pSpanId', 'spanId', 'method', 'url', 'length', 'srcIp', 'elapsed', 'status', 'userId', 'appId', 'body', 'rcode', 'rmsg', 'exceptionName', 'apiName'] as const satisfies readonly LogColumnKey[]
export const errorLogColumnPolicy = ['timestamp', 'jsonLogType', 'host', 'logger', 'service', 'module', 'submodule', 'trId', 'epochTime', 'thread', 'body', 'errorServerName', 'errorPath', 'errorMethod', 'errorTimestamp', 'traceId', 'errorReason'] as const satisfies readonly LogColumnKey[]

export const defaultLogPolicy: LogPolicy = {
  version: 1,
  pathTemplate: '/scloud/[namespace]/logs/[podname]/[namespace][suffix].log',
  defaultContainer: 'app',
  sources: {
    info: { label: 'INFO', pathSuffix: '', columns: accessLogColumnPolicy },
    access: { label: 'ACC', pathSuffix: '_ACC', columns: accessLogColumnPolicy },
    error: { label: 'ERR', pathSuffix: '_ERR', columns: errorLogColumnPolicy },
  },
  columns: {
    labels: {
      timestamp: 'time',
      jsonLogType: 'logType',
      apiName: 'api_name',
      errorServerName: 'errorDetails.serverName',
      errorPath: 'errorDetails.path',
      errorMethod: 'errorDetails.method',
      errorTimestamp: 'errorDetails.timestamp',
      errorReason: 'errorDetails.errors.reason',
    },
    defaultVisiblePriority: [
      'trId', 'traceId', 'method', 'url', 'status', 'elapsed',
      'rcode', 'rmsg', 'exceptionName', 'apiName',
      'errorMethod', 'errorPath', 'errorReason',
    ],
  },
  query: {
    sourceAliases: ['source', 'type'],
    correlationFields: ['trId', 'traceId'],
    suggestions: [
      { insert: 'package:', label: 'package:', description: 'Package/service/app id contains string' },
      { insert: 'tag:', label: 'tag:', description: 'Logger/module/type tag contains string' },
      { insert: 'message:', label: 'message:', description: 'Raw log line contains string' },
      { insert: 'level:', label: 'level:', description: 'Minimum severity: DEBUG, INFO, WARN, ERROR' },
      { insert: 'source:', label: 'source:', description: 'Log source: info, access, error' },
      { insert: 'namespace:', label: 'namespace:', description: 'Kubernetes namespace contains string' },
      { insert: 'pod:', label: 'pod:', description: 'Pod name contains string' },
      { insert: 'container:', label: 'container:', description: 'Container name contains string' },
      { insert: 'status:', label: 'status:', description: 'HTTP status contains string' },
      { insert: 'method:', label: 'method:', description: 'HTTP method contains string' },
      { insert: 'url:', label: 'url:', description: 'URL/path contains string' },
      { insert: 'trId:', label: 'trId:', description: 'Transaction id contains string' },
      { insert: 'is:crash', label: 'is:crash', description: 'Crash/error rows' },
      { insert: 'is:stacktrace', label: 'is:stacktrace', description: 'Stacktrace rows' },
      { insert: 'age:5m', label: 'age:5m', description: 'Rows newer than duration: 30s, 5m, 1h' },
      { insert: 'url~:', label: 'url~:', description: 'Regex match against URL/path' },
      { insert: 'message~:', label: 'message~:', description: 'Regex match against raw line' },
      { insert: '-pod:', label: '-pod:', description: 'Exclude matching pod' },
      { insert: '(', label: '( ... )', description: 'Group query clauses' },
      { insert: '|', label: '|', description: 'OR between clauses' },
    ],
  },
}

export function sourceTypesFromPolicy(policy: LogPolicy = defaultLogPolicy): SourceLogType[] {
  return Object.keys(policy.sources) as SourceLogType[]
}

export function buildLogPathTemplateFromPolicy(policy: LogPolicy, sourceType: SourceLogType) {
  const suffix = policy.sources[sourceType]?.pathSuffix ?? ''
  return policy.pathTemplate.replace('[suffix]', suffix)
}

export function buildLogPathFromPolicy(policy: LogPolicy, namespace: string, pod: string, sourceType: SourceLogType) {
  return buildLogPathTemplateFromPolicy(policy, sourceType)
    .replaceAll('[namespace]', namespace)
    .replaceAll('[podname]', pod)
}

export function defaultLogSourcesFromPolicy(policy: LogPolicy) {
  return Object.fromEntries(sourceTypesFromPolicy(policy).map((sourceType) => [sourceType, {
    container: policy.defaultContainer,
    filePath: buildLogPathTemplateFromPolicy(policy, sourceType),
  }])) as Record<SourceLogType, { container: string; filePath: string }>
}

export function columnsForSourceFromPolicy(policy: LogPolicy, sourceType: SourceLogType): LogColumnKey[] {
  return [...(policy.sources[sourceType]?.columns ?? [])]
}

export function defaultVisibleColumnsForPolicy(policy: LogPolicy, availableColumns: readonly LogColumnKey[]) {
  const available = new Set(availableColumns)
  const defaults = policy.columns.defaultVisiblePriority.filter((column) => available.has(column))
  return defaults.length > 0 ? defaults : availableColumns.slice(0, Math.min(6, availableColumns.length))
}

export function labelForColumnFromPolicy(policy: LogPolicy, key: LogColumnKey) {
  return policy.columns.labels[key] ?? key
}

export function querySuggestionsFromPolicy(policy: LogPolicy = defaultLogPolicy) {
  return [...policy.query.suggestions]
}
