import type { CommandError } from '../commands/types'
export function ErrorBanner({ error }: { error?: CommandError | string }) {
  if (!error) return null
  const message = typeof error === 'string' ? error : error.message
  const details = typeof error === 'string' ? undefined : error.details
  return <div className="rounded border border-red-700 bg-red-950 px-2 py-1 text-xs text-red-100">
    <p>{message}</p>
    {details && <p className="mt-1 whitespace-pre-wrap text-red-200/80">{details}</p>}
  </div>
}
