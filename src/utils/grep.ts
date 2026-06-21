export function normalizeGrepQuery(query: string): string { return query.trim().toLowerCase() }
export function matchesGrep(raw: string, query: string): boolean {
  const normalized = normalizeGrepQuery(query)
  return normalized === '' || raw.toLowerCase().includes(normalized)
}
