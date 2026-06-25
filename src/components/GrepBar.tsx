import { useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useLogStore } from '../stores/logStore'
import { isValidGrepRegex } from '../utils/grep'
import { validateLogQuery } from '../utils/logQuery'
import { getLogPolicy, querySuggestionsFromPolicy, type QuerySuggestionPolicy } from '../utils/logPolicy'

type QuerySuggestion = QuerySuggestionPolicy

function activeQuerySuggestions() { return querySuggestionsFromPolicy(getLogPolicy()) }

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

export function suggestionsForQuery(query: string, cursor = query.length, suggestions: QuerySuggestion[] = activeQuerySuggestions()) {
  const { token } = tokenBounds(query, cursor)
  const normalized = token.toLowerCase().replace(/^-/, '')
  if (!normalized) return suggestions
  const matches = suggestions.filter((suggestion) => suggestionMatches(suggestion, normalized))
  const nonMatches = suggestions.filter((suggestion) => !suggestionMatches(suggestion, normalized))
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
  const placeholder = regexMode ? 'Raw line regex' : 'Filter logs by text, field:value, -exclude, or url~:regex'

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

  return <section aria-label="Log query" className="shrink-0 rounded border border-slate-800 bg-slate-900/80 px-3 py-2">
    <div className="flex items-end gap-3">
      <label className="relative flex min-w-0 flex-1 flex-col gap-1"><span className="text-xs font-semibold uppercase tracking-wide text-slate-300">Query</span>
        <input ref={inputRef} aria-invalid={!valid} aria-describedby="query-help" aria-expanded={showSuggestions} aria-controls="query-suggestions" className={`h-9 w-full rounded border border-slate-700 bg-slate-950 px-3 text-sm text-white placeholder:text-slate-500 ${valid ? '' : 'outline outline-2 outline-red-500'}`} value={grepQuery} onFocus={() => { if (!regexMode && grepQuery === '') setSuggestionsOpen(true) }} onBlur={() => window.setTimeout(() => setSuggestionsOpen(false), 100)} onKeyDown={onKeyDown} onChange={e => { setGrepQuery(e.target.value); if (!regexMode) { setSuggestionsOpen(true); setActiveSuggestion(0) } }} placeholder={placeholder} />
        {showSuggestions && <div id="query-suggestions" role="listbox" className="absolute top-full z-30 mt-1 w-full overflow-hidden rounded border border-slate-700 bg-slate-900 shadow-xl">
        {suggestions.map((suggestion, index) => <button key={suggestion.insert} type="button" role="option" aria-selected={index === activeSuggestion} onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setActiveSuggestion(index)} onClick={() => insertSuggestion(suggestion)} className={`grid w-full grid-cols-[10rem_1fr] gap-3 px-3 py-2 text-left text-xs ${index === activeSuggestion ? 'bg-slate-700' : 'hover:bg-slate-800'}`}>
          <span className="font-mono text-yellow-200">{suggestion.label}</span>
          <span className="text-slate-300">{suggestion.description}</span>
        </button>)}
        </div>}
      </label>
      <div className="flex w-80 shrink-0 flex-col gap-1">
        <button type="button" aria-pressed={regexMode} onClick={() => { setGrepMode(regexMode ? 'substring' : 'regex'); setSuggestionsOpen(false) }} className={`h-9 self-start rounded border px-3 text-xs font-semibold ${regexMode ? 'border-yellow-300 bg-yellow-300 text-black' : 'border-slate-600 bg-slate-800 text-slate-200 hover:border-yellow-300'}`}>Regex</button>
        <span id="query-help" className="text-[11px] leading-4 text-slate-400">{regexMode ? 'Search raw log lines with a regular expression.' : 'Ctrl+Space opens suggestions. Supports field:value, -exclude, |, (), field~:regex.'}</span>
        {!valid && <span className="text-xs text-red-300">{invalidMessage}</span>}
      </div>
    </div>
  </section>
}
