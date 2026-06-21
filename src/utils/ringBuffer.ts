export type RingBufferResult<T> = { items: T[]; dropped: number }
export function appendWithLimit<T>(items: T[], item: T, limit: number): RingBufferResult<T> {
  const safeLimit = Math.max(0, Math.floor(limit))
  const next = [...items, item]
  if (next.length <= safeLimit) return { items: next, dropped: 0 }
  const dropped = next.length - safeLimit
  return { items: next.slice(dropped), dropped }
}
