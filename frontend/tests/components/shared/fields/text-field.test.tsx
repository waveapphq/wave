/**
 * TextField primitive tests
 *
 * Covers the Field Primitives overflow + maxLength + counter contract.
 *
 * Behavioral contract:
 *   - Single-line input with `w-full` and a `min-w-0` parent contract.
 *   - Native `maxLength` enforces the cap.
 *   - Counter (`X/N`) is hidden under 80% of cap, muted at 80-99%, destructive at 100%.
 *   - Counter only renders when `maxLength` is set.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { TextField } from '@/components/shared/fields/text-field'

describe('TextField', () => {
  describe('basic rendering', () => {
    it('renders an input element with the provided value', () => {
      render(<TextField value="hello" onChange={vi.fn()} data-testid="tf" />)

      const input = screen.getByTestId('tf')
      expect(input).toBeInTheDocument()
      expect(input).toHaveValue('hello')
    })

    it('passes the input mode to the box, and sets none by default', () => {
      const { rerender } = render(<TextField value="" onChange={vi.fn()} data-testid="tf" inputMode="numeric" />)
      expect(screen.getByTestId('tf')).toHaveAttribute('inputmode', 'numeric')

      rerender(<TextField value="" onChange={vi.fn()} data-testid="tf" />)
      expect(screen.getByTestId('tf')).not.toHaveAttribute('inputmode')
    })

    it('renders with the provided placeholder', () => {
      render(
        <TextField
          value=""
          onChange={vi.fn()}
          placeholder="enter value"
          data-testid="tf"
        />,
      )

      expect(screen.getByTestId('tf')).toHaveAttribute('placeholder', 'enter value')
    })

    it('forwards aria-invalid when set', () => {
      render(
        <TextField value="" onChange={vi.fn()} aria-invalid data-testid="tf" />,
      )

      expect(screen.getByTestId('tf')).toHaveAttribute('aria-invalid', 'true')
    })
  })

  describe('change & blur', () => {
    it('calls onChange with the typed character', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      render(<TextField value="" onChange={onChange} data-testid="tf" />)

      await user.type(screen.getByTestId('tf'), 'a')

      expect(onChange).toHaveBeenCalledWith('a')
    })

    it('calls onBlur when the input loses focus', async () => {
      const user = userEvent.setup()
      const onBlur = vi.fn()
      render(
        <TextField value="x" onChange={vi.fn()} onBlur={onBlur} data-testid="tf" />,
      )

      const input = screen.getByTestId('tf')
      input.focus()
      await user.tab()

      expect(onBlur).toHaveBeenCalled()
    })
  })

  describe('maxLength enforcement', () => {
    it('applies the native maxLength attribute', () => {
      render(
        <TextField value="" onChange={vi.fn()} maxLength={64} data-testid="tf" />,
      )

      expect(screen.getByTestId('tf')).toHaveAttribute('maxLength', '64')
    })
  })

  describe('counter visibility thresholds', () => {
    it('does not render the counter when no maxLength is provided', () => {
      render(<TextField value="abcdefg" onChange={vi.fn()} data-testid="tf" />)

      expect(screen.queryByTestId('tf-counter')).not.toBeInTheDocument()
    })

    it('hides the counter below 80% of the cap', () => {
      // 51/64 = 79.7% (below threshold)
      const value = 'a'.repeat(51)
      render(
        <TextField
          value={value}
          onChange={vi.fn()}
          maxLength={64}
          data-testid="tf"
        />,
      )

      expect(screen.queryByTestId('tf-counter')).not.toBeInTheDocument()
    })

    it('shows a muted counter at >=80% of the cap', () => {
      // 52/64 = 81.25% (>= threshold, < cap)
      const value = 'a'.repeat(52)
      render(
        <TextField
          value={value}
          onChange={vi.fn()}
          maxLength={64}
          data-testid="tf"
        />,
      )

      const counter = screen.getByTestId('tf-counter')
      expect(counter).toBeInTheDocument()
      expect(counter).toHaveTextContent('52/64')
      expect(counter).toHaveAttribute('data-state', 'muted')
    })

    it('shows a destructive counter at 100% of the cap', () => {
      const value = 'a'.repeat(64)
      render(
        <TextField
          value={value}
          onChange={vi.fn()}
          maxLength={64}
          data-testid="tf"
        />,
      )

      const counter = screen.getByTestId('tf-counter')
      expect(counter).toBeInTheDocument()
      expect(counter).toHaveTextContent('64/64')
      expect(counter).toHaveAttribute('data-state', 'destructive')
    })

    it('counter has aria-live="polite" so AT announces threshold crossings', () => {
      const value = 'a'.repeat(60)
      render(
        <TextField
          value={value}
          onChange={vi.fn()}
          maxLength={64}
          data-testid="tf"
        />,
      )

      expect(screen.getByTestId('tf-counter')).toHaveAttribute('aria-live', 'polite')
    })

    it('omits the counter testid when no data-testid is provided', () => {
      // Branch coverage: TextField generates the counter testid only if a
      // data-testid was provided on the input. Without one, the counter
      // renders without a testid (still functional, just not addressable in
      // tests).
      const value = 'a'.repeat(60)
      const { container } = render(
        <TextField value={value} onChange={vi.fn()} maxLength={64} />,
      )
      const counter = container.querySelector('span[aria-live="polite"]')
      expect(counter).not.toBeNull()
      expect(counter).not.toHaveAttribute('data-testid')
    })
  })

  describe('overflow CSS contract', () => {
    it('field has w-full and min-w-0 so it cooperates with flex parents', () => {
      render(<TextField value="" onChange={vi.fn()} data-testid="tf" />)

      const field = screen.getByTestId('tf')
      expect(field.className).toContain('w-full')
      expect(field.className).toContain('min-w-0')
    })

    it('field is single-line with a visible horizontal scrollbar on overflow', () => {
      render(<TextField value="" onChange={vi.fn()} data-testid="tf" />)

      const field = screen.getByTestId('tf')
      // whitespace-pre keeps content single-line; overflow-x-auto shows the
      // native scrollbar when content extends past the visible width.
      expect(field.className).toContain('whitespace-pre')
      expect(field.className).toContain('overflow-x-auto')
      expect(field.className).toContain('overflow-y-hidden')
      expect(field.className).toContain('resize-none')
    })
  })

  describe('disabled & readOnly', () => {
    it('renders disabled when disabled prop is set', () => {
      render(
        <TextField value="" onChange={vi.fn()} disabled data-testid="tf" />,
      )

      expect(screen.getByTestId('tf')).toBeDisabled()
    })

    it('renders readOnly when readOnly prop is set', () => {
      render(
        <TextField value="" onChange={vi.fn()} readOnly data-testid="tf" />,
      )

      expect(screen.getByTestId('tf')).toHaveAttribute('readonly')
    })
  })

  describe('Enter key blur handler', () => {
    it('blurs the field on Enter (single-line behavior)', async () => {
      const user = userEvent.setup()
      render(<TextField value="" onChange={vi.fn()} data-testid="tf" />)
      const field = screen.getByTestId('tf') as HTMLTextAreaElement
      field.focus()
      expect(document.activeElement).toBe(field)
      await user.keyboard('{Enter}')
      expect(document.activeElement).not.toBe(field)
    })

    it('lets the caller pre-empt the Enter blocker via preventDefault', async () => {
      const user = userEvent.setup()
      const onKeyDown = vi.fn((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter') e.preventDefault()
      })
      render(
        <TextField
          value=""
          onChange={vi.fn()}
          onKeyDown={onKeyDown}
          data-testid="tf"
        />,
      )
      const field = screen.getByTestId('tf') as HTMLTextAreaElement
      field.focus()
      await user.keyboard('{Enter}')
      // Caller's preventDefault skips the internal blur path; field remains focused.
      expect(document.activeElement).toBe(field)
      expect(onKeyDown).toHaveBeenCalled()
    })

    it('does not blur on non-Enter keys', async () => {
      const user = userEvent.setup()
      render(<TextField value="" onChange={vi.fn()} data-testid="tf" />)
      const field = screen.getByTestId('tf') as HTMLTextAreaElement
      field.focus()
      await user.keyboard('a')
      expect(document.activeElement).toBe(field)
    })
  })

  describe('newline stripping on paste', () => {
    it('strips newlines so paste-with-newlines stays single-line', () => {
      const onChange = vi.fn()
      render(
        <TextField value="hello" onChange={onChange} data-testid="tf" />,
      )
      const field = screen.getByTestId('tf') as HTMLTextAreaElement
      // Simulate paste-with-newline by firing a change event with embedded newlines.
      // userEvent's paste path mocks the clipboard API which jsdom doesn't fully
      // support; we trigger the underlying change handler directly.
      field.value = 'line1\nline2\r\nline3'
      field.dispatchEvent(new Event('input', { bubbles: true }))
      expect(onChange).toHaveBeenCalledWith('line1line2line3')
    })
  })
})
