import type { ReactNode } from 'react'
import { normalizeGrepQuery } from './grep'

export function highlightText(text: string, query: string): ReactNode {
  const q = normalizeGrepQuery(query)
  if (!q) return text
  const i = text.toLowerCase().indexOf(q)
  if (i < 0) return text
  return <>{text.slice(0, i)}<mark>{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}</>
}
