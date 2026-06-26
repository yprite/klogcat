import { useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
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

type SuggestionKeyContext = {
  activeSuggestion: number
  insertSuggestion: (suggestion: QuerySuggestion) => void
  setActiveSuggestion: (updater: (value: number) => number) => void
  setSuggestionsOpen: (open: boolean) => void
  showSuggestions: boolean
  suggestions: QuerySuggestion[]
}

function queryStatus(grepMode: ReturnType<typeof useLogStore.getState>['grepMode'], grepQuery: string) {
  const regexMode = grepMode === 'regex'
  const queryValidation = regexMode ? undefined : validateLogQuery(grepQuery)
  const regexValid = !regexMode || isValidGrepRegex(grepQuery)
  const valid = regexMode ? regexValid : queryValidation?.ok !== false
  const invalidMessage = regexMode ? 'invalid regex' : queryValidation?.ok === false ? queryValidation.message : undefined
  const placeholder = regexMode ? 'Raw line regex' : 'Filter logs by text, field:value, -exclude, or url~:regex'
  return { invalidMessage, placeholder, regexMode, valid }
}

function handleSuggestionKey(event: KeyboardEvent<HTMLInputElement>, context: SuggestionKeyContext) {
  if (!context.showSuggestions) return false
  if (event.key === 'ArrowDown') return moveActiveSuggestion(event, context, 1)
  if (event.key === 'ArrowUp') return moveActiveSuggestion(event, context, -1)
  if (event.key === 'Enter' || event.key === 'Tab') return acceptActiveSuggestion(event, context)
  if (event.key === 'Escape') {
    context.setSuggestionsOpen(false)
    return true
  }
  return false
}

function moveActiveSuggestion(event: KeyboardEvent<HTMLInputElement>, context: SuggestionKeyContext, delta: number) {
  event.preventDefault()
  context.setActiveSuggestion((value) => (value + delta + context.suggestions.length) % context.suggestions.length)
  return true
}

function acceptActiveSuggestion(event: KeyboardEvent<HTMLInputElement>, context: SuggestionKeyContext) {
  event.preventDefault()
  context.insertSuggestion(context.suggestions[context.activeSuggestion])
  return true
}

type QueryInputProps = {
  activeSuggestion: number
  grepMode: ReturnType<typeof useLogStore.getState>['grepMode']
  grepQuery: string
  inputRef: RefObject<HTMLInputElement | null>
  insertSuggestion: (suggestion: QuerySuggestion) => void
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void
  setActiveSuggestion: (index: number) => void
  setGrepQuery: (query: string) => void
  setSuggestionsOpen: (open: boolean) => void
  showSuggestions: boolean
  suggestions: QuerySuggestion[]
}

function QueryInput({ activeSuggestion, grepMode, grepQuery, inputRef, insertSuggestion, onKeyDown, setActiveSuggestion, setGrepQuery, setSuggestionsOpen, showSuggestions, suggestions }: QueryInputProps) {
  const { placeholder, regexMode, valid } = queryStatus(grepMode, grepQuery)
  const onChange = (value: string) => {
    setGrepQuery(value)
    if (!regexMode) {
      setSuggestionsOpen(true)
      setActiveSuggestion(0)
    }
  }

  return <label className="relative flex min-w-0 flex-1 flex-col gap-1"><span className="text-xs font-semibold uppercase tracking-wide text-slate-300">Query</span>
    <input ref={inputRef} aria-invalid={!valid} aria-describedby="query-help" aria-expanded={showSuggestions} aria-controls="query-suggestions" className={`h-9 w-full rounded border border-slate-700 bg-slate-950 px-3 text-sm text-white placeholder:text-slate-500 ${valid ? '' : 'outline outline-2 outline-red-500'}`} value={grepQuery} onFocus={() => { if (!regexMode && grepQuery === '') setSuggestionsOpen(true) }} onBlur={() => window.setTimeout(() => setSuggestionsOpen(false), 100)} onKeyDown={onKeyDown} onChange={e => onChange(e.target.value)} placeholder={placeholder} />
    {showSuggestions && <SuggestionList activeSuggestion={activeSuggestion} insertSuggestion={insertSuggestion} setActiveSuggestion={setActiveSuggestion} suggestions={suggestions} />}
  </label>
}

function SuggestionList({ activeSuggestion, insertSuggestion, setActiveSuggestion, suggestions }: Pick<QueryInputProps, 'activeSuggestion' | 'insertSuggestion' | 'setActiveSuggestion' | 'suggestions'>) {
  return <div id="query-suggestions" role="listbox" className="absolute top-full z-30 mt-1 w-full overflow-hidden rounded border border-slate-700 bg-slate-900 shadow-xl">
    {suggestions.map((suggestion, index) => <button key={suggestion.insert} type="button" role="option" aria-selected={index === activeSuggestion} onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setActiveSuggestion(index)} onClick={() => insertSuggestion(suggestion)} className={`grid w-full grid-cols-[10rem_1fr] gap-3 px-3 py-2 text-left text-xs ${index === activeSuggestion ? 'bg-slate-700' : 'hover:bg-slate-800'}`}>
      <span className="font-mono text-yellow-200">{suggestion.label}</span>
      <span className="text-slate-300">{suggestion.description}</span>
    </button>)}
  </div>
}

function QueryModePanel({ grepMode, grepQuery, setGrepMode, setSuggestionsOpen }: Pick<QueryInputProps, 'grepMode' | 'grepQuery' | 'setSuggestionsOpen'> & { setGrepMode: (mode: 'substring' | 'regex') => void }) {
  const { invalidMessage, regexMode, valid } = queryStatus(grepMode, grepQuery)
  return <div className="flex w-80 shrink-0 flex-col gap-1">
    <button type="button" aria-pressed={regexMode} onClick={() => { setGrepMode(regexMode ? 'substring' : 'regex'); setSuggestionsOpen(false) }} className={`h-9 self-start rounded border px-3 text-xs font-semibold ${regexMode ? 'border-yellow-300 bg-yellow-300 text-black' : 'border-slate-600 bg-slate-800 text-slate-200 hover:border-yellow-300'}`}>Regex</button>
    <span id="query-help" className="text-[11px] leading-4 text-slate-400">{regexMode ? 'Search raw log lines with a regular expression.' : 'Ctrl+Space opens suggestions. Supports field:value, -exclude, |, (), field~:regex.'}</span>
    {!valid && <span className="text-xs text-red-300">{invalidMessage}</span>}
  </div>
}

export function GrepBar() {
  const { grepQuery, grepMode, setGrepQuery, setGrepMode } = useLogStore()
  const inputRef = useRef<HTMLInputElement>(null)
  const [suggestionsOpen, setSuggestionsOpen] = useState(false)
  const [activeSuggestion, setActiveSuggestion] = useState(0)
  const suggestions = useMemo(() => suggestionsForQuery(grepQuery, inputRef.current?.selectionStart ?? grepQuery.length), [grepQuery, suggestionsOpen])
  const regexMode = grepMode === 'regex'
  const showSuggestions = !regexMode && suggestionsOpen && suggestions.length > 0

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
    handleSuggestionKey(event, { activeSuggestion, insertSuggestion, setActiveSuggestion, setSuggestionsOpen, showSuggestions, suggestions })
  }

  return <section aria-label="Log query" className="shrink-0 rounded border border-slate-800 bg-slate-900/80 px-3 py-2">
    <div className="flex items-end gap-3">
      <QueryInput activeSuggestion={activeSuggestion} grepMode={grepMode} grepQuery={grepQuery} inputRef={inputRef} insertSuggestion={insertSuggestion} onKeyDown={onKeyDown} setActiveSuggestion={setActiveSuggestion} setGrepQuery={setGrepQuery} setSuggestionsOpen={setSuggestionsOpen} showSuggestions={showSuggestions} suggestions={suggestions} />
      <QueryModePanel grepMode={grepMode} grepQuery={grepQuery} setGrepMode={setGrepMode} setSuggestionsOpen={setSuggestionsOpen} />
    </div>
  </section>
}
