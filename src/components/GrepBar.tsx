import { useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useLogStore } from '../stores/logStore'
import { isValidGrepRegex } from '../utils/grep'
import { validateLogQuery } from '../utils/logQuery'

type QuerySuggestion = { insert: string; label: string; description: string }

const querySuggestions: QuerySuggestion[] = [
  { insert: 'package:', label: 'package:', description: 'Package/service/app id contains string' },
  { insert: 'tag:', label: 'tag:', description: 'Logger/module/type tag contains string' },
  { insert: 'message:', label: 'message:', description: 'Raw log line contains string' },
  { insert: 'level:', label: 'level:', description: 'Minimum severity: DEBUG, INFO, WARN, ERROR' },
  { insert: 'source:', label: 'source:', description: 'Log source: info, access, error' },
  { insert: 'namespace:', label: 'namespace:', description: 'Kubernetes namespace contains string' },
  { insert: 'pod:', label: 'pod:', description: 'Pod name contains string' },
  { insert: 'container:', label: 'container:', description: 'Container name contains string' },
  { insert: 'status:', label: 'status:', description: 'HTTP status contains string' },
  { insert: 'method:', label: 'method:', description: 'HTTP method contains string' },
  { insert: 'url:', label: 'url:', description: 'URL/path contains string' },
  { insert: 'trId:', label: 'trId:', description: 'Transaction id contains string' },
  { insert: 'is:crash', label: 'is:crash', description: 'Crash/error rows' },
  { insert: 'is:stacktrace', label: 'is:stacktrace', description: 'Stacktrace rows' },
  { insert: 'age:5m', label: 'age:5m', description: 'Rows newer than duration: 30s, 5m, 1h' },
  { insert: 'url~:', label: 'url~:', description: 'Regex match against URL/path' },
  { insert: 'message~:', label: 'message~:', description: 'Regex match against raw line' },
  { insert: '-pod:', label: '-pod:', description: 'Exclude matching pod' },
  { insert: '(', label: '( ... )', description: 'Group query clauses' },
  { insert: '|', label: '|', description: 'OR between clauses' },
]

function tokenBounds(query: string, cursor: number) {
  let start = cursor
  let end = cursor
  while (start > 0 && !/\s/.test(query[start - 1])) start -= 1
  while (end < query.length && !/\s/.test(query[end])) end += 1
  return { start, end, token: query.slice(start, end) }
}

function suggestionMatches(suggestion: QuerySuggestion, normalizedToken: string) {
  return suggestion.insert.toLowerCase().replace(/^-/, '').startsWith(normalizedToken) ||
    suggestion.label.toLowerCase().includes(normalizedToken) ||
    suggestion.description.toLowerCase().includes(normalizedToken)
}

export function suggestionsForQuery(query: string, cursor = query.length) {
  const { token } = tokenBounds(query, cursor)
  const normalized = token.toLowerCase().replace(/^-/, '')
  if (!normalized) return querySuggestions
  const matches = querySuggestions.filter((suggestion) => suggestionMatches(suggestion, normalized))
  const nonMatches = querySuggestions.filter((suggestion) => !suggestionMatches(suggestion, normalized))
  return [...matches, ...nonMatches]
}

export function applyQuerySuggestion(query: string, cursor: number, suggestion: string) {
  const { start, end } = tokenBounds(query, cursor)
  const next = `${query.slice(0, start)}${suggestion}${query.slice(end)}`
  const nextCursor = start + suggestion.length
  return { query: next, cursor: nextCursor }
}

export function GrepBar() {
  const { grepQuery, grepMode, setGrepQuery, setGrepMode } = useLogStore()
  const regexMode = grepMode === 'regex'
  const queryValidation = regexMode ? undefined : validateLogQuery(grepQuery)
  const regexValid = !regexMode || isValidGrepRegex(grepQuery)
  const valid = regexMode ? regexValid : queryValidation?.ok !== false
  const invalidMessage = regexMode ? 'invalid regex' : queryValidation?.ok === false ? queryValidation.message : undefined
  const inputRef = useRef<HTMLInputElement>(null)
  const [suggestionsOpen, setSuggestionsOpen] = useState(false)
  const [activeSuggestion, setActiveSuggestion] = useState(0)
  const suggestions = useMemo(() => suggestionsForQuery(grepQuery, inputRef.current?.selectionStart ?? grepQuery.length), [grepQuery, suggestionsOpen])
  const showSuggestions = !regexMode && suggestionsOpen && suggestions.length > 0
  const placeholder = regexMode ? 'raw-line regex' : 'Press ^Space to see query suggestions: package:, tag:, level:, status:, -pod:, url~:'

  const insertSuggestion = (suggestion: QuerySuggestion) => {
    const cursor = inputRef.current?.selectionStart ?? grepQuery.length
    const next = applyQuerySuggestion(grepQuery, cursor, suggestion.insert)
    setGrepQuery(next.query)
    setSuggestionsOpen(false)
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.setSelectionRange(next.cursor, next.cursor)
    })
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!regexMode && event.ctrlKey && event.code === 'Space') {
      event.preventDefault()
      setSuggestionsOpen(true)
      setActiveSuggestion(0)
      return
    }
    if (!showSuggestions) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveSuggestion((value) => (value + 1) % suggestions.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveSuggestion((value) => (value - 1 + suggestions.length) % suggestions.length)
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault()
      insertSuggestion(suggestions[activeSuggestion])
    } else if (event.key === 'Escape') {
      setSuggestionsOpen(false)
    }
  }

  return <div className="flex shrink-0 items-center gap-2">
    <label className="relative flex flex-1 items-center gap-2"><span className="shrink-0 text-xs font-semibold uppercase text-slate-300">Query</span>
      <input ref={inputRef} aria-invalid={!valid} aria-describedby="query-help" aria-expanded={showSuggestions} aria-controls="query-suggestions" className={`w-full max-w-3xl rounded border border-slate-700 bg-slate-950 px-2 py-1 text-white placeholder:text-slate-500 ${valid ? '' : 'outline outline-2 outline-red-500'}`} value={grepQuery} onFocus={() => { if (!regexMode && grepQuery === '') setSuggestionsOpen(true) }} onBlur={() => window.setTimeout(() => setSuggestionsOpen(false), 100)} onKeyDown={onKeyDown} onChange={e => { setGrepQuery(e.target.value); if (!regexMode) { setSuggestionsOpen(true); setActiveSuggestion(0) } }} placeholder={placeholder} />
      {showSuggestions && <div id="query-suggestions" role="listbox" className="absolute left-12 top-full z-30 mt-1 w-[calc(100%-3rem)] max-w-3xl overflow-hidden rounded border border-slate-700 bg-slate-900 shadow-xl">
        {suggestions.map((suggestion, index) => <button key={suggestion.insert} type="button" role="option" aria-selected={index === activeSuggestion} onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setActiveSuggestion(index)} onClick={() => insertSuggestion(suggestion)} className={`grid w-full grid-cols-[10rem_1fr] gap-3 px-3 py-2 text-left text-xs ${index === activeSuggestion ? 'bg-slate-700' : 'hover:bg-slate-800'}`}>
          <span className="font-mono text-yellow-200">{suggestion.label}</span>
          <span className="text-slate-300">{suggestion.description}</span>
        </button>)}
      </div>}
    </label>
    <button type="button" aria-pressed={regexMode} onClick={() => { setGrepMode(regexMode ? 'substring' : 'regex'); setSuggestionsOpen(false) }} className={`rounded border px-2 py-1 text-xs font-semibold ${regexMode ? 'border-yellow-300 bg-yellow-300 text-black' : 'border-slate-600 bg-slate-800 text-slate-200'}`}>Regex</button>
    <span id="query-help" className="pb-1 text-[11px] text-slate-400">{regexMode ? '전체 raw line 정규식 검색' : 'Android Logcat style: text, field:value, -exclude, |, (), field~:regex'}</span>
    {!valid && <span className="pb-1 text-xs text-red-300">{invalidMessage}</span>}
  </div>
}
