import { describe, expect, it } from 'vitest'
import { isValidGrepRegex, matchesGrep } from '../utils/grep'

describe('matchesGrep', () => {
  it('returns true for empty query', () => { expect(matchesGrep('anything', '')).toBe(true); expect(matchesGrep('anything', '   ')).toBe(true); expect(matchesGrep('anything', ' ', 'regex')).toBe(true) })
  it('trims and matches case-insensitively against raw', () => { expect(matchesGrep('OpenTabMigrationFailedException', ' opentabmigration ')).toBe(true) })
  it('keeps regex-like characters literal in substring mode', () => { expect(matchesGrep('abc', 'a.c')).toBe(false); expect(matchesGrep('a.c', 'a.c')).toBe(true) })
  it('supports regex semantics in regex mode', () => { expect(matchesGrep('abc', 'a.c', 'regex')).toBe(true); expect(matchesGrep('HTTP 500', 'http\\s+5\\d\\d', 'regex')).toBe(true) })
  it('treats invalid regex as non-matching and exposes validity', () => { expect(matchesGrep('abc', '[', 'regex')).toBe(false); expect(isValidGrepRegex('[')).toBe(false); expect(isValidGrepRegex('a.c')).toBe(true) })
})
