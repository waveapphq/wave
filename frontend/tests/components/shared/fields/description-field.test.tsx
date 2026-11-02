/**
 * DescriptionField unit tests targeting branch coverage of the counter testid
 * and chevron expand/collapse aria-label paths that aren't reachable via the
 * consumers (ElementConfigModal always passes a data-testid).
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

import { DescriptionField } from '@/components/shared/fields/description-field'

describe('DescriptionField', () => {
  it('renders the counter without a data-testid when no testid is provided', () => {
    render(
      <DescriptionField
        value={'a'.repeat(55)}
        onChange={vi.fn()}
        maxLength={64}
        showCount
      />,
    )
    // Counter exists (the aria-live span) but has no data-testid attribute.
    const counter = screen.getByText('55/64')
    expect(counter).not.toHaveAttribute('data-testid')
  })

  describe('className', () => {
    const BASE_CLASSES = [
      'flex',
      'w-full',
      'rounded-md',
      'border',
      'border-input',
      'bg-background',
      'px-3',
      'py-2',
      'text-foreground',
    ]

    it('keeps the base classes when no className is given', () => {
      render(<DescriptionField value="" onChange={vi.fn()} data-testid="desc" />)
      const textarea = screen.getByTestId('desc')

      expect(textarea).toHaveClass(...BASE_CLASSES, 'min-h-[80px]', 'text-sm')
    })

    it('adds the given classes to the textarea beside the base classes', () => {
      render(
        <DescriptionField
          value=""
          onChange={vi.fn()}
          data-testid="desc"
          className="font-mono text-xs min-h-[138px]"
        />,
      )
      const textarea = screen.getByTestId('desc')

      expect(textarea.tagName).toBe('TEXTAREA')
      expect(textarea).toHaveClass('font-mono', 'text-xs', 'min-h-[138px]', ...BASE_CLASSES)
    })

    it('lets a given class win over the base class it conflicts with', () => {
      render(
        <DescriptionField
          value=""
          onChange={vi.fn()}
          data-testid="desc"
          className="text-xs min-h-[138px]"
        />,
      )
      const textarea = screen.getByTestId('desc')

      expect(textarea).not.toHaveClass('text-sm')
      expect(textarea).not.toHaveClass('min-h-[80px]')
    })

    it('does not put the classes on the wrapper', () => {
      render(
        <DescriptionField
          value=""
          onChange={vi.fn()}
          data-testid="desc"
          className="font-mono"
        />,
      )

      expect(screen.getByTestId('desc').parentElement).not.toHaveClass('font-mono')
    })
  })

  describe('aria-label', () => {
    it('names the textarea with the given aria-label', () => {
      render(<DescriptionField value="" onChange={vi.fn()} aria-label="Certificate PEM" />)

      expect(screen.getByRole('textbox', { name: 'Certificate PEM' }).tagName).toBe('TEXTAREA')
    })

    it('renders no aria-label when none is given', () => {
      render(<DescriptionField value="" onChange={vi.fn()} data-testid="desc" />)

      expect(screen.getByTestId('desc')).not.toHaveAttribute('aria-label')
    })

    it('still reports typed text through onChange when labeled', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const onChange = vi.fn()
      render(<DescriptionField value="" onChange={onChange} aria-label="Certificate PEM" />)

      await user.type(screen.getByRole('textbox', { name: 'Certificate PEM' }), 'A')

      expect(onChange).toHaveBeenCalledWith('A')
    })
  })
})
