import type { ParsedLogLine } from '../types/log'

export function buildFacetCounts(rows: ParsedLogLine[], field: keyof ParsedLogLine) {
  const counts = new Map<string, number>()
  for (const row of rows) {
    const value = row[field]
    if (value === undefined || value === null || typeof value === 'object') continue
    const key = String(value)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value))
}
