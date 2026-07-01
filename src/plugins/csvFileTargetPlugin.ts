import type { SettingsValidationError } from '../types/settings'
import type { CsvFileTargetPluginSettings, TargetPluginSettings, VmTargetInfo } from '../types/vm'
import type { TargetPluginDefinition } from './pluginModel'

export const CSV_FILE_TARGET_PLUGIN_ID = 'csv-file'
export const CSV_FILE_TARGET_SETTINGS_KEY = 'csvFile'
export const CSV_FILE_TARGET_KIND = 'csv-file'

export const defaultCsvFileTargetPluginSettings: CsvFileTargetPluginSettings = {
  enabled: false,
  csvText: '',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function rejectExtraKeys(value: Record<string, unknown>, allowed: readonly string[], prefix: string, errors: SettingsValidationError[]) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) errors.push({ field: `${prefix}.${key}`, message: `Unknown key: ${key}` })
  }
}

function parseCsvLine(line: string) {
  const values: string[] = []
  let current = ''
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    const next = line[index + 1]
    if (char === '"' && quoted && next === '"') {
      current += '"'
      index += 1
    } else if (char === '"') {
      quoted = !quoted
    } else if (char === ',' && !quoted) {
      values.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  values.push(current.trim())
  return values
}

function normalizeHeader(header: string) {
  return header.trim().toLowerCase()
}

function rowValue(row: Record<string, string>, keys: string[]) {
  return keys.map((key) => row[key]).find((value) => value && value.trim())?.trim()
}

function targetId(rawId: string | undefined, name: string, address: string) {
  return `csv:${rawId || name || address}`
}

export function csvTargetsFromText(csvText: string): VmTargetInfo[] {
  const lines = csvText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  if (lines.length < 2) return []
  const headers = parseCsvLine(lines[0]).map(normalizeHeader)
  return lines.slice(1).flatMap((line) => {
    const values = parseCsvLine(line)
    const row = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']))
    const address = rowValue(row, ['address', 'ip', 'host'])
    if (!address) return []
    const name = rowValue(row, ['name', 'node', 'hostname']) ?? address
    const id = targetId(rowValue(row, ['id']), name, address)
    const tags = rowValue(row, ['tags'])?.split(/[|;]/).map((tag) => tag.trim()).filter(Boolean)
    return [{
      id,
      name,
      address,
      service: rowValue(row, ['service', 'servicename']),
      datacenter: rowValue(row, ['datacenter', 'dc']),
      tags,
    }]
  })
}

export function validateCsvFileTargetPluginSettings(value: unknown, errors: SettingsValidationError[]) {
  if (!isRecord(value)) {
    errors.push({ field: 'targetPlugins.csvFile', message: 'csvFile plugin config must be an object' })
    return
  }
  rejectExtraKeys(value, ['enabled', 'csvText'], 'targetPlugins.csvFile', errors)
  if (typeof value.enabled !== 'boolean') errors.push({ field: 'targetPlugins.csvFile.enabled', message: 'enabled must be a boolean' })
  if (typeof value.csvText !== 'string') errors.push({ field: 'targetPlugins.csvFile.csvText', message: 'csvText must be a string' })
  if (value.enabled === true && typeof value.csvText === 'string' && csvTargetsFromText(value.csvText).length === 0) {
    errors.push({ field: 'targetPlugins.csvFile.csvText', message: 'csvText must include a header and at least one row with address/ip/host' })
  }
}

export const csvFileTargetPlugin: TargetPluginDefinition<CsvFileTargetPluginSettings> = {
  manifest: {
    id: CSV_FILE_TARGET_PLUGIN_ID,
    ownerId: 'klogcat.core',
    kind: 'target',
    label: 'CSV File',
    description: 'Load VM log targets from a CSV file.',
    source: 'core',
    order: 30,
  },
  settingsKey: CSV_FILE_TARGET_SETTINGS_KEY,
  targetKind: CSV_FILE_TARGET_KIND,
  requiredCapabilities: ['target.discovery', 'file.read'],
  defaultSettings: defaultCsvFileTargetPluginSettings,
  isEnabled(settings: TargetPluginSettings | undefined) {
    return Boolean(settings?.csvFile.enabled)
  },
  validate: validateCsvFileTargetPluginSettings,
}

export function isCsvTargetId(id: string) {
  return id.startsWith('csv:')
}
