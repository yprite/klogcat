export type GrepMode = 'substring' | 'regex'

export function normalizeGrepQuery(query: string): string { return query.trim().toLowerCase() }

export function compileGrepRegex(query: string): RegExp | null {
  const pattern = query.trim()
  if (!pattern) return null
  try {
    return new RegExp(pattern, 'i')
  } catch {
    return null
  }
}

export function isValidGrepRegex(query: string): boolean {
  const pattern = query.trim()
  return pattern === '' || compileGrepRegex(pattern) !== null
}

export function matchesGrep(raw: string, query: string, mode: GrepMode = 'substring'): boolean {
  if (mode === 'regex') {
    const pattern = query.trim()
    if (!pattern) return true
    const regex = compileGrepRegex(pattern)
    return regex ? regex.test(raw) : false
  }
  const normalized = normalizeGrepQuery(query)
  return normalized === '' || raw.toLowerCase().includes(normalized)
}
