import { describe, expect, it } from 'vitest'
import { appendWithLimit } from '../utils/ringBuffer'

describe('appendWithLimit', () => {
  it('overflow drops oldest lines', () => { expect(appendWithLimit([1,2], 3, 2)).toEqual({ items: [2,3], dropped: 1 }) })
  it('does not drop within limit', () => { expect(appendWithLimit([1], 2, 3)).toEqual({ items: [1,2], dropped: 0 }) })
})
