import { describe, expect, it } from 'vitest'
import { matchesGrep } from '../utils/grep'

describe('matchesGrep', () => {
  it('returns true for empty query', () => { expect(matchesGrep('anything', '')).toBe(true); expect(matchesGrep('anything', '   ')).toBe(true) })
  it('trims and matches case-insensitively against raw', () => { expect(matchesGrep('OpenTabMigrationFailedException', ' opentabmigration ')).toBe(true) })
  it('does not support regex semantics', () => { expect(matchesGrep('abc', 'a.c')).toBe(false) })
})
