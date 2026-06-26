import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { applyQuerySuggestion, GrepBar, suggestionsForQuery } from '../components/GrepBar'
import { resetLogStoreForTests, useLogStore } from '../stores/logStore'

describe('QueryBar', () => {
  beforeEach(() => resetLogStoreForTests())

  it('toggles between query and regex grep modes', () => {
    render(<GrepBar />)

    const toggle = screen.getByRole('button', { name: 'Regex' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByPlaceholderText(/Filter logs by text/)).toBeInTheDocument()
    expect(screen.getByRole('region', { name: /log query/i })).toBeInTheDocument()

    fireEvent.click(toggle)
    expect(useLogStore.getState().grepMode).toBe('regex')
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByPlaceholderText('Raw line regex')).toBeInTheDocument()
  })

  it('marks invalid regex while regex mode is active', () => {
    render(<GrepBar />)

    fireEvent.click(screen.getByRole('button', { name: 'Regex' }))
    fireEvent.change(screen.getByLabelText('Query'), { target: { value: '[' } })

    expect(screen.getByLabelText('Query')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('invalid regex')).toBeInTheDocument()
  })

  it('marks incomplete boolean query syntax while query mode is active', () => {
    render(<GrepBar />)

    fireEvent.change(screen.getByLabelText('Query'), { target: { value: 'status:500 |' } })

    expect(screen.getByLabelText('Query')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('incomplete query expression')).toBeInTheDocument()
  })

  it('opens Android Logcat style query suggestions with Ctrl+Space and inserts one', () => {
    render(<GrepBar />)

    const input = screen.getByLabelText('Query')
    fireEvent.keyDown(input, { code: 'Space', ctrlKey: true })

    expect(screen.getByRole('listbox')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('option', { name: /package:/ }))

    expect(useLogStore.getState().grepQuery).toBe('package:')
  })
})

describe('query suggestion helpers', () => {
  it('keeps the full suggestion menu open while ranking active-token matches first', () => {
    const suggestions = suggestionsForQuery('sta', 3).map((suggestion) => suggestion.insert)
    expect(suggestions[0]).toBe('status:')
    expect(suggestions).toContain('package:')
    expect(suggestions.length).toBeGreaterThan(8)
  })

  it('replaces only the active token when inserting a suggestion', () => {
    expect(applyQuerySuggestion('level:ERROR sta', 15, 'status:500').query).toBe('level:ERROR status:500')
  })
})
