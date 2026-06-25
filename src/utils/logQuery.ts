import type { ParsedLogLine, SourceLogType } from '../types/log'
import { compileGrepRegex } from './grep'
import { defaultLogPolicy, isFailureRowFromPolicy, levelMeetsMinimumFromPolicy, rowLevelFromPolicy, sourceTypesFromPolicy, type LogPolicy } from './logPolicy'
import { valueForColumn, accessLogColumns, errorLogColumns, type LogColumnKey } from './logColumns'

export type QueryValidation = { ok: true } | { ok: false; message: string }

type Token = { type: 'word' | 'and' | 'or' | 'not' | 'lparen' | 'rparen'; value: string }
type Expr =
  | { type: 'term'; term: string }
  | { type: 'field'; key: string; value: string; regex: boolean }
  | { type: 'not'; expr: Expr }
  | { type: 'and' | 'or'; left: Expr; right: Expr }

const searchableColumnKeys: LogColumnKey[] = Array.from(new Set([...accessLogColumns, ...errorLogColumns]))

function tokenize(input: string): Token[] {
  const tokens: Token[] = []
  let current = ''
  let quoted = false
  let quote = ''
  const pushWord = () => { if (current.trim()) tokens.push(wordToken(current.trim())); current = '' }
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]
    if (quoted) {
      if (ch === quote) quoted = false
      else current += ch
      continue
    }
    if (ch === '"' || ch === "'") { quoted = true; quote = ch; continue }
    if (/\s/.test(ch)) { pushWord(); continue }
    if (ch === '(') { pushWord(); tokens.push({ type: 'lparen', value: ch }); continue }
    if (ch === ')') { pushWord(); tokens.push({ type: 'rparen', value: ch }); continue }
    if (ch === '&') { pushWord(); tokens.push({ type: 'and', value: ch }); continue }
    if (ch === '|') { pushWord(); tokens.push({ type: 'or', value: ch }); continue }
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

function isValueStart(token?: Token) { return !!token && token.type !== 'and' && token.type !== 'or' && token.type !== 'rparen' }
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

function rowFieldValue(row: ParsedLogLine, key: string, policy: LogPolicy): string {
  const k = key.toLowerCase()
  if (k === 'line' || k === 'message' || k === 'raw') return row.raw
  if (k === 'summary') return row.summary
  if (policy.query.sourceAliases.includes(k)) return row.sourceType
  if (k === 'namespace' || k === 'ns') return row.namespace
  if (k === 'pod') return row.pod
  if (k === 'container') return row.container
  if (k === 'tag') return row.logger || row.module || row.service || row.jsonLogType || ''
  if (k === 'package') return row.service || row.serviceId || row.appId || ''
  if (k === 'level' || k === 'priority') return rowLevelFromPolicy(row, policy) ?? ''
  if (k === 'age') return String(ageSeconds(row))
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
  if (k === 'is') {
    const v = value.toLowerCase()
    if (v === 'stacktrace') return !!row.isStacktrace || !!row.stacktraceLines?.length
    if (v === 'crash' || v === 'error') return isFailureRowFromPolicy(row, policy)
    return false
  }
  if (k === 'level' || k === 'priority') {
    const actual = rowLevelFromPolicy(row, policy)
    const wanted = value.toUpperCase()
    if (!levelMeetsMinimumFromPolicy(actual, wanted, policy)) return textMatches(actual ?? '', value, regex)
    return true
  }
  if (k === 'age') {
    const seconds = parseAge(value)
    return seconds === undefined ? false : ageSeconds(row) <= seconds
  }
  if (policy.query.sourceAliases.includes(k) && sourceTypesFromPolicy(policy).includes(value as SourceLogType)) return row.sourceType === value as SourceLogType
  return textMatches(rowFieldValue(row, key, policy), value, regex)
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

export function matchesLogQuery(row: ParsedLogLine, query: string, policy: LogPolicy = defaultLogPolicy): boolean {
  const trimmed = query.trim()
  if (!trimmed) return true
  const tokens = tokenize(trimmed)
  const expr = parse(tokens)
  return expr ? evalExpr(row, expr, policy) : true
}
