import { describe, expect, it, vi } from 'vitest'

const render = vi.fn()
const createRoot = vi.fn(() => ({ render }))
const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

vi.mock('react-dom/client', () => ({
  default: { createRoot },
  createRoot,
}))

vi.mock('../../utils/logPolicy', () => ({
  loadLogPolicyConfig: vi.fn(async () => ({ loaded: false, source: '/log-policy.json', error: 'missing' })),
}))

vi.mock('../../App', () => ({
  default: () => <div>Mock App</div>,
}))

describe('main bootstrap scenario', () => {
  it('loads runtime log policy before rendering the app root', async () => {
    document.body.innerHTML = '<div id="root"></div>'
    await import('../../main')
    await vi.waitFor(() => expect(createRoot).toHaveBeenCalledWith(document.getElementById('root')))
    expect(render).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith('Using embedded default log policy: missing')
  })
})
