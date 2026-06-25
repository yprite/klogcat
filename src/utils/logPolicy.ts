import type { SourceLogType, LogColumnKey, ParsedLogLine } from '../types/log'

export type QuerySuggestionPolicy = {
  insert: string
  label: string
  description: string
}

export type FieldPath = string

export type BaseParserPolicy = {
  timestamp: FieldPath
  epochTime: FieldPath
  jsonLogType: FieldPath
  levelCandidates: readonly FieldPath[]
  host: FieldPath
  service: FieldPath
  serviceId: FieldPath
  module: FieldPath
  submodule: FieldPath
  trId: FieldPath
  logger: FieldPath
  thread: FieldPath
  body: FieldPath
}

export type AccessParserPolicy = {
  method: FieldPath
  url: FieldPath
  status: FieldPath
  elapsed: FieldPath
  length: FieldPath
  pSpanId: FieldPath
  spanId: FieldPath
  srcIp: FieldPath
  userId: FieldPath
  appId: FieldPath
  rcode: FieldPath
  rmsg: FieldPath
  exceptionName: FieldPath
  apiName: FieldPath
}

export type ErrorParserPolicy = {
  traceId: FieldPath
  errorReason: FieldPath
  errorMethod: FieldPath
  errorPath: FieldPath
  errorServerName: FieldPath
  errorTimestamp: FieldPath
}

export type InfoParserPolicy = {
  message: FieldPath
}

export type SeverityPolicy = {
  levelRanks: Record<string, number>
  fallbackLevelBySource: Partial<Record<SourceLogType, string>>
  exceptionLevel: string
  errorLevel: string
}

export type FailurePolicy = {
  sourceTypes: readonly SourceLogType[]
  minimumStatus: number
  exceptionFields: readonly LogColumnKey[]
}

export type GroupingPolicy = {
  correlationFields: readonly LogColumnKey[]
  accessSourceTypes: readonly SourceLogType[]
  errorSourceTypes: readonly SourceLogType[]
}

export type FailedRequestGroup = {
  correlationKey: string
  rows: ParsedLogLine[]
  rawRows: ParsedLogLine[]
  accessRow?: ParsedLogLine
  errorRow?: ParsedLogLine
  representativeRow: ParsedLogLine
  failed: boolean
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
  severity: SeverityPolicy
  failure: FailurePolicy
  grouping: GroupingPolicy
  parser: {
    base: BaseParserPolicy
    access: AccessParserPolicy
    error: ErrorParserPolicy
    info: InfoParserPolicy
  }
}

export type BuiltinLogPolicyId = 'scloud'
export type LogPolicySelectionId = BuiltinLogPolicyId | 'custom'

export const builtinLogPolicyOptions = [
  {
    id: 'scloud' as const,
    label: 'SCloud INFO / ACC / ERR',
    description: 'Use the built-in SCloud log paths, source labels, query suggestions, parser fields, severity, and grouping policy.',
  },
] as const

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
  severity: {
    levelRanks: { TRACE: 0, VERBOSE: 0, DEBUG: 1, INFO: 2, WARN: 3, WARNING: 3, ERROR: 4, FATAL: 5 },
    fallbackLevelBySource: { error: 'ERROR' },
    exceptionLevel: 'ERROR',
    errorLevel: 'ERROR',
  },
  failure: {
    sourceTypes: ['error'],
    minimumStatus: 500,
    exceptionFields: ['exceptionName', 'errorReason'],
  },
  grouping: {
    correlationFields: ['trId', 'traceId'],
    accessSourceTypes: ['access', 'info'],
    errorSourceTypes: ['error'],
  },
  parser: {
    base: {
      timestamp: 'time',
      epochTime: 'epochTime',
      jsonLogType: 'logType',
      levelCandidates: ['level', 'severity', 'logLevel', 'priority'],
      host: 'host',
      service: 'service',
      serviceId: 'serviceId',
      module: 'module',
      submodule: 'submodule',
      trId: 'trId',
      logger: 'logger',
      thread: 'thread',
      body: 'body',
    },
    access: {
      method: 'method',
      url: 'url',
      status: 'status',
      elapsed: 'elapsed',
      length: 'length',
      pSpanId: 'pSpanId',
      spanId: 'spanId',
      srcIp: 'srcIp',
      userId: 'userId',
      appId: 'appId',
      rcode: 'body.rcode',
      rmsg: 'body.rmsg',
      exceptionName: 'body.exceptionName',
      apiName: 'body.api_name',
    },
    error: {
      traceId: 'body.errorDetails.traceId',
      errorReason: 'body.errorDetails.errors.0.reason',
      errorMethod: 'body.errorDetails.method',
      errorPath: 'body.errorDetails.path',
      errorServerName: 'body.errorDetails.serverName',
      errorTimestamp: 'body.errorDetails.timestamp',
    },
    info: {
      message: 'message',
    },
  },
}

export function logPolicyForBuiltinId(id: BuiltinLogPolicyId): LogPolicy {
  if (id === 'scloud') return defaultLogPolicy
  return defaultLogPolicy
}

let activeLogPolicy: LogPolicy = defaultLogPolicy

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertString(value: unknown, path: string): asserts value is string {
  if (typeof value !== 'string') throw new Error(`log policy ${path} must be a string`)
}

function assertStringArray(value: unknown, path: string) {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) throw new Error(`log policy ${path} must be a string array`)
}

function assertNumberRecord(value: unknown, path: string) {
  if (!isRecord(value) || Object.values(value).some((item) => typeof item !== 'number' || !Number.isFinite(item))) throw new Error(`log policy ${path} must be a number map`)
}

export function getLogPolicy() {
  return activeLogPolicy
}

export function setActiveLogPolicy(policy: LogPolicy) {
  activeLogPolicy = policy
}

export type LogPolicyLoadResult = {
  loaded: boolean
  source: string
  error?: string
}

export function assertValidLogPolicy(value: unknown): asserts value is LogPolicy {
  if (!isRecord(value)) throw new Error('log policy must be an object')
  if (value.version !== 1) throw new Error('log policy version must be 1')
  assertString(value.pathTemplate, 'pathTemplate')
  const pathTemplate = value.pathTemplate
  if (!pathTemplate.includes('[namespace]') || !pathTemplate.includes('[podname]')) throw new Error('log policy pathTemplate must include [namespace] and [podname]')
  assertString(value.defaultContainer, 'defaultContainer')
  const defaultContainer = value.defaultContainer
  if (defaultContainer.trim() === '') throw new Error('log policy defaultContainer is required')

  const sources = value.sources
  if (!isRecord(sources)) throw new Error('log policy sources must be an object')
  const sourceKeys = Object.keys(defaultLogPolicy.sources)
  for (const key of sourceKeys) {
    const source = sources[key]
    if (!isRecord(source)) throw new Error(`log policy source ${key} must be an object`)
    assertString(source.label, `sources.${key}.label`)
    assertString(source.pathSuffix, `sources.${key}.pathSuffix`)
    assertStringArray(source.columns, `sources.${key}.columns`)
  }

  const columns = value.columns
  if (!isRecord(columns)) throw new Error('log policy columns must be an object')
  if (!isRecord(columns.labels)) throw new Error('log policy columns.labels must be an object')
  for (const [key, label] of Object.entries(columns.labels)) assertString(label, `columns.labels.${key}`)
  assertStringArray(columns.defaultVisiblePriority, 'columns.defaultVisiblePriority')

  const query = value.query
  if (!isRecord(query)) throw new Error('log policy query must be an object')
  assertStringArray(query.sourceAliases, 'query.sourceAliases')
  assertStringArray(query.correlationFields, 'query.correlationFields')
  if (!Array.isArray(query.suggestions)) throw new Error('log policy query.suggestions must be an array')
  query.suggestions.forEach((suggestion, index) => {
    if (!isRecord(suggestion)) throw new Error(`log policy query.suggestions.${index} must be an object`)
    assertString(suggestion.insert, `query.suggestions.${index}.insert`)
    assertString(suggestion.label, `query.suggestions.${index}.label`)
    assertString(suggestion.description, `query.suggestions.${index}.description`)
  })

  const severity = value.severity
  if (!isRecord(severity)) throw new Error('log policy severity must be an object')
  assertNumberRecord(severity.levelRanks, 'severity.levelRanks')
  if (!isRecord(severity.fallbackLevelBySource)) throw new Error('log policy severity.fallbackLevelBySource must be an object')
  for (const [key, level] of Object.entries(severity.fallbackLevelBySource)) if (level !== undefined) assertString(level, `severity.fallbackLevelBySource.${key}`)
  assertString(severity.exceptionLevel, 'severity.exceptionLevel')
  assertString(severity.errorLevel, 'severity.errorLevel')

  const failure = value.failure
  if (!isRecord(failure)) throw new Error('log policy failure must be an object')
  assertStringArray(failure.sourceTypes, 'failure.sourceTypes')
  if (typeof failure.minimumStatus !== 'number' || !Number.isFinite(failure.minimumStatus)) throw new Error('log policy failure.minimumStatus must be a number')
  assertStringArray(failure.exceptionFields, 'failure.exceptionFields')

  const grouping = value.grouping
  if (!isRecord(grouping)) throw new Error('log policy grouping must be an object')
  assertStringArray(grouping.correlationFields, 'grouping.correlationFields')
  assertStringArray(grouping.accessSourceTypes, 'grouping.accessSourceTypes')
  assertStringArray(grouping.errorSourceTypes, 'grouping.errorSourceTypes')

  const parser = value.parser
  if (!isRecord(parser)) throw new Error('log policy parser must be an object')
  const parserSections = ['base', 'access', 'error', 'info'] as const
  for (const sectionName of parserSections) {
    const section = parser[sectionName]
    if (!isRecord(section)) throw new Error(`log policy parser.${sectionName} must be an object`)
    for (const [key, fieldPath] of Object.entries(section)) {
      if (sectionName === 'base' && key === 'levelCandidates') assertStringArray(fieldPath, 'parser.base.levelCandidates')
      else assertString(fieldPath, `parser.${sectionName}.${key}`)
    }
  }
}

export async function loadLogPolicyConfig(source = '/log-policy.json'): Promise<LogPolicyLoadResult> {
  try {
    const response = await fetch(source, { cache: 'no-cache' })
    if (!response.ok) {
      setActiveLogPolicy(defaultLogPolicy)
      return { loaded: false, source, error: `HTTP ${response.status}` }
    }
    const policy = await response.json() as unknown
    assertValidLogPolicy(policy)
    setActiveLogPolicy(policy)
    return { loaded: true, source }
  } catch (error) {
    setActiveLogPolicy(defaultLogPolicy)
    return { loaded: false, source, error: error instanceof Error ? error.message : String(error) }
  }
}

export function fieldPathValueFromPolicy(json: unknown, fieldPath: FieldPath): unknown {
  if (!fieldPath) return undefined
  return fieldPath.split('.').reduce<unknown>((value, segment) => {
    if (value === undefined || value === null) return undefined
    if (Array.isArray(value) && /^\d+$/.test(segment)) return value[Number(segment)]
    if (typeof value === 'object' && !Array.isArray(value)) return (value as Record<string, unknown>)[segment]
    return undefined
  }, json)
}

export function rowLevelFromPolicy(row: ParsedLogLine, policy: LogPolicy = getLogPolicy()) {
  const candidates = [
    row.level,
    row.jsonLogType,
    policy.failure.exceptionFields.some((field) => Boolean(row[field])) ? policy.severity.exceptionLevel : undefined,
    policy.severity.fallbackLevelBySource[row.sourceType],
  ]
  return candidates.find((value) => value && policy.severity.levelRanks[value.toUpperCase()] !== undefined)?.toUpperCase()
}

export function levelMeetsMinimumFromPolicy(level: string | undefined, minimumLevel: string, policy: LogPolicy = getLogPolicy()) {
  const actualRank = level ? policy.severity.levelRanks[level.toUpperCase()] : undefined
  const minimumRank = policy.severity.levelRanks[minimumLevel.toUpperCase()]
  return actualRank !== undefined && minimumRank !== undefined && actualRank >= minimumRank
}

export function isFailureRowFromPolicy(row: ParsedLogLine, policy: LogPolicy = getLogPolicy()) {
  const status = Number(row.status)
  return policy.failure.sourceTypes.includes(row.sourceType)
    || (Number.isFinite(status) && status >= policy.failure.minimumStatus)
    || policy.failure.exceptionFields.some((field) => Boolean(row[field]))
    || levelMeetsMinimumFromPolicy(rowLevelFromPolicy(row, policy), policy.severity.errorLevel, policy)
}

export function correlationKeyFromPolicy(row: ParsedLogLine, policy: LogPolicy = getLogPolicy()) {
  for (const field of policy.grouping.correlationFields) {
    const value = row[field]
    const key = value === undefined || value === null ? '' : String(value).trim()
    if (key) return key
  }
  return undefined
}

export function groupFailedRequestsFromPolicy(rows: readonly ParsedLogLine[], policy: LogPolicy = getLogPolicy()): FailedRequestGroup[] {
  const byKey = new Map<string, ParsedLogLine[]>()
  for (const row of rows) {
    const key = correlationKeyFromPolicy(row, policy)
    if (!key) continue
    const groupRows = byKey.get(key)
    if (groupRows) groupRows.push(row)
    else byKey.set(key, [row])
  }

  const groups: FailedRequestGroup[] = []
  for (const [correlationKey, groupRows] of byKey) {
    if (!groupRows.some((row) => isFailureRowFromPolicy(row, policy))) continue
    const accessRow = groupRows.find((row) => policy.grouping.accessSourceTypes.includes(row.sourceType))
    const errorRow = groupRows.find((row) => policy.grouping.errorSourceTypes.includes(row.sourceType))
    groups.push({
      correlationKey,
      rows: groupRows,
      rawRows: groupRows,
      accessRow,
      errorRow,
      representativeRow: accessRow ?? errorRow ?? groupRows[0],
      failed: true,
    })
  }
  return groups
}

export function sourceTypesFromPolicy(policy: LogPolicy = getLogPolicy()): SourceLogType[] {
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

export function querySuggestionsFromPolicy(policy: LogPolicy = getLogPolicy()) {
  return [...policy.query.suggestions]
}
