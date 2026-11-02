/**
 * NameField primitive tests
 *
 * Covers the specialized name field.
 *
 * Behavioral contract:
 *   - Default `maxLength = MAX_ELEMENT_NAME_LENGTH = 64`.
 *   - Counter is on by default (inherits TextField counter thresholds).
 *   - No trim, no empty-rejection - the value is passed through verbatim
 *     so an empty name gracefully falls back to the element type label
 *     via the canvas placeholder behavior.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { NameField } from '@/components/shared/fields/name-field'
import { MAX_ELEMENT_NAME_LENGTH } from '@/lib/field-constraints'

describe('NameField', () => {
  it('exports MAX_ELEMENT_NAME_LENGTH equal to 64', () => {
    // Pin the constant: 64 matches MAX_VARIABLE_NAME_LENGTH.
    expect(MAX_ELEMENT_NAME_LENGTH).toBe(64)
  })

  describe('rendering', () => {
    it('renders an input element with the provided value', () => {
      render(<NameField value="My Block" onChange={vi.fn()} data-testid="nf" />)

      const input = screen.getByTestId('nf')
      expect(input).toBeInTheDocument()
      expect(input).toHaveValue('My Block')
    })

    it('applies the default 64-char maxLength when caller does not override', () => {
      render(<NameField value="" onChange={vi.fn()} data-testid="nf" />)

      expect(screen.getByTestId('nf')).toHaveAttribute('maxLength', '64')
    })

    it('respects a caller-provided maxLength override', () => {
      render(
        <NameField
          value=""
          onChange={vi.fn()}
          maxLength={32}
          data-testid="nf"
        />,
      )

      expect(screen.getByTestId('nf')).toHaveAttribute('maxLength', '32')
    })
  })

  describe('counter is on by default', () => {
    it('renders the counter once value crosses 80% of the default cap', () => {
      // 52/64 = 81.25% (>= 80% of 64).
      const value = 'a'.repeat(52)
      render(<NameField value={value} onChange={vi.fn()} data-testid="nf" />)

      const counter = screen.getByTestId('nf-counter')
      expect(counter).toHaveTextContent('52/64')
      expect(counter).toHaveAttribute('data-state', 'muted')
    })

    it('counter goes destructive at the cap', () => {
      const value = 'a'.repeat(64)
      render(<NameField value={value} onChange={vi.fn()} data-testid="nf" />)

      expect(screen.getByTestId('nf-counter')).toHaveAttribute(
        'data-state',
        'destructive',
      )
    })
  })

  describe('no trim, no empty-rejection', () => {
    it('reports leading/trailing whitespace verbatim - no implicit trim', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      render(<NameField value="" onChange={onChange} data-testid="nf" />)

      // Type a single space - it must propagate as-is.
      await user.type(screen.getByTestId('nf'), ' ')

      expect(onChange).toHaveBeenCalledWith(' ')
    })

    it('accepts an empty string without rejecting it', () => {
      const onChange = vi.fn()
      render(<NameField value="" onChange={onChange} data-testid="nf" />)

      // Empty value renders fine; no aria-invalid set by default.
      const input = screen.getByTestId('nf')
      expect(input).toHaveValue('')
      expect(input).not.toHaveAttribute('aria-invalid', 'true')
    })
  })

  describe('aria-invalid pass-through', () => {
    it('forwards aria-invalid when set', () => {
      render(
        <NameField
          value=""
          onChange={vi.fn()}
          aria-invalid
          data-testid="nf"
        />,
      )

      expect(screen.getByTestId('nf')).toHaveAttribute('aria-invalid', 'true')
    })
  })
})
