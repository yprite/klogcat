export function formatDisplayTime(row: { epochTime?: number; timestamp?: string; receivedAt: number }): string {
  const parsedTimestamp = Date.parse(row.timestamp ?? '')
  const millis = Number.isFinite(row.epochTime) ? row.epochTime! : (Number.isFinite(parsedTimestamp) ? parsedTimestamp : row.receivedAt)
  const date = new Date(millis)
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  const ss = String(date.getSeconds()).padStart(2, '0')
  const ms = String(date.getMilliseconds()).padStart(3, '0')
  return `${hh}:${mm}:${ss}.${ms}`
}
