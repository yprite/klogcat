import type { CommandError } from '../commands/types'
export function ErrorBanner({ error }: { error?: CommandError | string }) {
  if (!error) return null
  const message = typeof error === 'string' ? error : error.message
  return <div className="bg-red-950 border border-red-700 text-red-100 p-2 rounded">{message}</div>
}
