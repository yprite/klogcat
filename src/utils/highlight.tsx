import type { ReactNode } from 'react'
import { compileGrepRegex, normalizeGrepQuery, type GrepMode } from './grep'

export function highlightText(text: string, query: string, mode: GrepMode = 'substring'): ReactNode {
  if (mode === 'regex') {
    const regex = compileGrepRegex(query)
    if (!regex) return text
    const match = regex.exec(text)
    if (!match || match.index < 0 || match[0].length === 0) return text
    return <>{text.slice(0, match.index)}<mark>{text.slice(match.index, match.index + match[0].length)}</mark>{text.slice(match.index + match[0].length)}</>
  }
  const q = normalizeGrepQuery(query)
  if (!q) return text
  const i = text.toLowerCase().indexOf(q)
  if (i < 0) return text
  return <>{text.slice(0, i)}<mark>{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}</>
}
