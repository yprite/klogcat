import type { ParsedLogLine, SourceLogType } from '../types/log'
import { compileGrepRegex } from './grep'
import { getLogPolicy, isFailureRowFromPolicy, levelMeetsMinimumFromPolicy, rowLevelFromPolicy, sourceTypesFromPolicy, type LogPolicy } from './logPolicy'
import { valueForColumn, accessLogColumns, errorLogColumns, type LogColumnKey } from './logColumns'

export type QueryValidation = { ok: true } | { ok: false; message: string }

type Token = { type: 'word' | 'and' | 'or' | 'not' | 'lparen' | 'rparen'; value: string }
type Expr =
  | { type: 'term'; term: string }
  | { type: 'field'; key: string; value: string; regex: boolean }
  | { type: 'not'; expr: Expr }
  | { type: 'and' | 'or'; left: Expr; right: Expr }

const searchableColumnKeys: LogColumnKey[] = Array.from(new Set([...accessLogColumns, ...errorLogColumns]))
type QuoteChar = '"' | "'"
type BoundaryChar = '(' | ')' | '&' | '|'

function isWhitespace(char: string) {
  return /\s/.test(char)
}

function isQuoteChar(char: string): char is QuoteChar {
  return char === '"' || char === "'"
}

function isBoundaryToken(char: string): char is BoundaryChar {
  return char === '(' || char === ')' || char === '&' || char === '|'
}

function boundaryToken(type: BoundaryChar): Token {
  if (type === '(') return { type: 'lparen', value: type }
  if (type === ')') return { type: 'rparen', value: type }
  if (type === '&') return { type: 'and', value: type }
  return { type: 'or', value: type }
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = []
  let current = ''
  let quoted = false
  let quote: QuoteChar = '"'
  const pushWord = () => { if (current.trim()) tokens.push(wordToken(current.trim())); current = '' }
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]
    if (quoted) {
      if (ch === quote) quoted = false
      else current += ch
      continue
    }
    if (isQuoteChar(ch)) {
      quoted = true
      quote = ch
      continue
    }
    if (isWhitespace(ch)) {
      pushWord()
      continue
    }
    if (isBoundaryToken(ch)) {
      pushWord()
      tokens.push(boundaryToken(ch))
      continue
    }
    current += ch
  }
  pushWord()
  return tokens
}

function wordToken(value: string): Token {
  const lower = value.toLowerCase()
  if (lower === 'and') return { type: 'and', value }
  if (lower === 'or') return { type: 'or', value }
  if (value === '!') return { type: 'not', value }
  return { type: 'word', value }
}

function implicitAnd(prev?: Token, next?: Token) {
  return !!prev && !!next && (prev.type === 'word' || prev.type === 'rparen') && (next.type === 'word' || next.type === 'not' || next.type === 'lparen')
}

function parseTermWord(value: string): Expr {
  if (value.startsWith('-') && value.length > 1) return { type: 'not', expr: parseTermWord(value.slice(1)) }
  const match = value.match(/^([A-Za-z][\w.-]*)(~?):(.*)$/)
  if (match) return { type: 'field', key: match[1], regex: match[2] === '~', value: match[3] }
  return { type: 'term', term: value }
}

function parse(tokens: Token[]): Expr | null {
  let i = 0
  const peek = () => tokens[i]
  const take = () => tokens[i++]
  const parsePrimary = (): Expr | null => {
    const token = take()
    if (!token) return null
    if (token.type === 'not') {
      const expr = parsePrimary()
      return expr ? { type: 'not', expr } : null
    }
    if (token.type === 'word') return parseTermWord(token.value)
    if (token.type === 'lparen') {
      const expr = parseOr()
      if (peek()?.type === 'rparen') take()
      return expr
    }
    return null
  }
  const parseAnd = (): Expr | null => {
    let left = parsePrimary()
    while (left) {
      const token = peek()
      if (token?.type === 'and') { take(); const right = parsePrimary(); if (!right) break; left = { type: 'and', left, right }; continue }
      if (implicitAnd(tokens[i - 1], token)) { const right = parsePrimary(); if (!right) break; left = { type: 'and', left, right }; continue }
      break
    }
    return left
  }
  const parseOr = (): Expr | null => {
    let left = parseAnd()
    while (left && peek()?.type === 'or') {
      take()
      const right = parseAnd()
      if (!right) break
      left = { type: 'or', left, right }
    }
    return left
  }
  return parseOr()
}

function textMatches(value: string, query: string, regex: boolean) {
  if (!query) return true
  if (!regex) return value.toLowerCase().includes(query.toLowerCase())
  const re = compileGrepRegex(query)
  return re ? re.test(value) : false
}

const directFieldReaders: Record<string, (row: ParsedLogLine) => string> = {
  line: (row) => row.raw,
  message: (row) => row.raw,
  raw: (row) => row.raw,
  summary: (row) => row.summary,
  namespace: (row) => row.namespace,
  ns: (row) => row.namespace,
  pod: (row) => row.pod,
  container: (row) => row.container,
  tag: (row) => row.logger || row.module || row.service || row.jsonLogType || '',
  package: (row) => row.service || row.serviceId || row.appId || '',
}

function rowFieldValue(row: ParsedLogLine, key: string, policy: LogPolicy): string {
  const k = key.toLowerCase()
  const directReader = directFieldReaders[k]
  if (directReader) return directReader(row)
  if (policy.query.sourceAliases.includes(k)) return row.sourceType
  if (k === 'level' || k === 'priority') return rowLevelFromPolicy(row, policy) ?? ''
  const column = searchableColumnKeys.find((candidate) => candidate.toLowerCase() === k)
  return column ? valueForColumn(row, column) : String((row as unknown as Record<string, unknown>)[key] ?? '')
}

function ageSeconds(row: ParsedLogLine) {
  const stamp = row.epochTime ? row.epochTime : row.receivedAt
  const ms = stamp < 10_000_000_000 ? stamp * 1000 : stamp
  return Math.max(0, Math.floor((Date.now() - ms) / 1000))
}

function parseAge(value: string) {
  const match = value.match(/^(\d+)([smhd])$/i)
  if (!match) return undefined
  const amount = Number(match[1])
  const unit = match[2].toLowerCase()
  return amount * (unit === 's' ? 1 : unit === 'm' ? 60 : unit === 'h' ? 3600 : 86400)
}

function evalField(row: ParsedLogLine, key: string, value: string, regex: boolean, policy: LogPolicy) {
  const k = key.toLowerCase()
  if (k === 'is') return evalIsField(row, value, policy)
  if (isLevelField(k)) return evalLevelField(row, value, regex, policy)
  if (k === 'age') return evalAgeField(row, value)
  if (isSourceAliasMatch(k, value, policy)) return row.sourceType === value as SourceLogType
  return textMatches(rowFieldValue(row, key, policy), value, regex)
}

function evalIsField(row: ParsedLogLine, value: string, policy: LogPolicy) {
  const matchers: Record<string, () => boolean> = {
    stacktrace: () => Boolean(row.isStacktrace || row.stacktraceLines?.length),
    crash: () => isFailureRowFromPolicy(row, policy),
    error: () => isFailureRowFromPolicy(row, policy),
  }
  return matchers[value.toLowerCase()]?.() ?? false
}

function isLevelField(key: string) {
  return key === 'level' || key === 'priority'
}

function evalLevelField(row: ParsedLogLine, value: string, regex: boolean, policy: LogPolicy) {
  const actual = rowLevelFromPolicy(row, policy)
  const wanted = value.toUpperCase()
  return levelMeetsMinimumFromPolicy(actual, wanted, policy) || textMatches(actual ?? '', value, regex)
}

function evalAgeField(row: ParsedLogLine, value: string) {
  const seconds = parseAge(value)
  return seconds === undefined ? false : ageSeconds(row) <= seconds
}

function isSourceAliasMatch(key: string, value: string, policy: LogPolicy) {
  return policy.query.sourceAliases.includes(key) && sourceTypesFromPolicy(policy).includes(value as SourceLogType)
}

function evalExpr(row: ParsedLogLine, expr: Expr, policy: LogPolicy): boolean {
  if (expr.type === 'term') return textMatches(row.raw, expr.term, false)
  if (expr.type === 'field') return evalField(row, expr.key, expr.value, expr.regex, policy)
  if (expr.type === 'not') return !evalExpr(row, expr.expr, policy)
  if (expr.type === 'and') return evalExpr(row, expr.left, policy) && evalExpr(row, expr.right, policy)
  return evalExpr(row, expr.left, policy) || evalExpr(row, expr.right, policy)
}

export function validateLogQuery(query: string): QueryValidation {
  const tokens = tokenize(query.trim())
  for (const token of tokens) {
    if (token.type !== 'word') continue
    const expr = parseTermWord(token.value)
    const field = expr.type === 'not' ? expr.expr : expr
    if (field.type === 'field' && field.regex && field.value && !compileGrepRegex(field.value)) return { ok: false, message: `invalid regex: ${field.key}~:${field.value}` }
  }
  const balance = tokens.reduce((count, token) => count + (token.type === 'lparen' ? 1 : token.type === 'rparen' ? -1 : 0), 0)
  return balance === 0 ? { ok: true } : { ok: false, message: 'unbalanced parentheses' }
}

export function matchesLogQuery(row: ParsedLogLine, query: string, policy: LogPolicy = getLogPolicy()): boolean {
  const trimmed = query.trim()
  if (!trimmed) return true
  const tokens = tokenize(trimmed)
  const expr = parse(tokens)
  return expr ? evalExpr(row, expr, policy) : true
}
