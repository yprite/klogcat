import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { LogTypeSelector } from '../components/LogTypeSelector'

const selectedClass = 'bg-blue-700'

describe('LogTypeSelector', () => {
  it('lets All toggle INFO, ACC, and ERR on together', () => {
    const onChange = vi.fn()
    render(<LogTypeSelector value={['info']} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'ALL' }))

    expect(onChange).toHaveBeenCalledWith(['info', 'access', 'error'])
  })

  it('lets All toggle the three selected log types off', () => {
    const onChange = vi.fn()
    render(<LogTypeSelector value={['info', 'access', 'error']} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'ALL' }))

    expect(onChange).toHaveBeenCalledWith([])
  })

  it('toggles individual INFO, ACC, and ERR buttons independently', () => {
    const onChange = vi.fn()
    render(<LogTypeSelector value={['info']} onChange={onChange} />)

    expect(screen.getByRole('button', { name: 'INFO' })).toHaveClass(selectedClass)
    expect(screen.getByRole('button', { name: 'ACC' })).not.toHaveClass(selectedClass)

    fireEvent.click(screen.getByRole('button', { name: 'ACC' }))

    expect(onChange).toHaveBeenCalledWith(['info', 'access'])
  })
})
