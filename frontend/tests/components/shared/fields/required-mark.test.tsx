// REQ-3.1.3.11 (FIELD-12): the one accessible red star after a required label.

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'

import { RequiredMark } from '@/components/shared/fields/required-mark'

function renderLabeled() {
  return render(
    <>
      <label htmlFor="field-name">
        Name <RequiredMark />
      </label>
      <input id="field-name" />
    </>,
  )
}

describe('RequiredMark', () => {
  it('draws one star hidden from assistive tech', () => {
    render(<RequiredMark />)
    const stars = screen.getAllByText('*')
    expect(stars).toHaveLength(1)
    expect(stars[0]).toHaveAttribute('aria-hidden', 'true')
  })

  it('paints the star in the one required color, text-destructive', () => {
    render(<RequiredMark />)
    expect(screen.getByText('*')).toHaveClass('text-destructive')
  })

  it('tells a screen reader "required" through sr-only text', () => {
    render(<RequiredMark />)
    const word = screen.getByText('required')
    expect(word).toHaveClass('sr-only')
    expect(word).not.toHaveAttribute('aria-hidden')
  })

  it('makes the bound control read "required" and never the star', () => {
    renderLabeled()
    const input = screen.getByRole('textbox')
    expect(input).toHaveAccessibleName(/^Name\s*required$/)
  })
})
