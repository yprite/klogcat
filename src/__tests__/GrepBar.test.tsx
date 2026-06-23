import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { GrepBar } from '../components/GrepBar'
import { resetLogStoreForTests, useLogStore } from '../stores/logStore'

describe('QueryBar', () => {
  beforeEach(() => resetLogStoreForTests())

  it('toggles between substring and regex grep modes', () => {
    render(<GrepBar />)

    const toggle = screen.getByRole('button', { name: 'Regex' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(toggle)
    expect(useLogStore.getState().grepMode).toBe('regex')
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByPlaceholderText('raw-line regex')).toBeInTheDocument()
  })

  it('marks invalid regex while regex mode is active', () => {
    render(<GrepBar />)

    fireEvent.click(screen.getByRole('button', { name: 'Regex' }))
    fireEvent.change(screen.getByLabelText('Query'), { target: { value: '[' } })

    expect(screen.getByLabelText('Query')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('invalid regex')).toBeInTheDocument()
  })
})
