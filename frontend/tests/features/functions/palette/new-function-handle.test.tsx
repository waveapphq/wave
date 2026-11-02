/**
 * Tests for `NewFunctionHandle`.
 *
 * The component is the "New Function" affordance reused by both palette
 * modes. It is a draggable button:
 *   - `draggable="true"` and `onDragStart` populates the
 *     `application/wave-block` MIME type with a `function-new-local` payload.
 *   - Click without drag does NOT navigate or create anything; instead it
 *     surfaces a ConditionalTooltip with the copy:
 *     "Drag onto the canvas to create a new Function".
 *
 * Two visual variants exist - `'expanded'` (text + icon) and `'collapsed'`
 * (icon only). Both share the same drag payload and the same hint text.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { NewFunctionHandle } from '@/features/functions/palette/new-function-handle'

describe('NewFunctionHandle', () => {
  describe('expanded variant', () => {
    it('renders a button with the "New Function" label', () => {
      render(<NewFunctionHandle variant="expanded" />)
      expect(screen.getByRole('button', { name: /new function/i })).toBeInTheDocument()
      expect(screen.getByText('New Function')).toBeInTheDocument()
    })

    it('does not double the plus: the icon carries it, the label does not', () => {
      render(<NewFunctionHandle variant="expanded" />)
      expect(screen.queryByText('+ New Function')).not.toBeInTheDocument()
    })

    it('is draggable', () => {
      render(<NewFunctionHandle variant="expanded" />)
      const button = screen.getByRole('button', { name: /new function/i })
      expect(button).toHaveAttribute('draggable', 'true')
    })

    it('sets the wave-block payload on dragstart with type=function-new-local', () => {
      render(<NewFunctionHandle variant="expanded" />)
      const button = screen.getByRole('button', { name: /new function/i })
      const setData = vi.fn()
      fireEvent.dragStart(button, {
        dataTransfer: { setData, effectAllowed: '' },
      })
      expect(setData).toHaveBeenCalledWith(
        'application/wave-block',
        expect.stringContaining('"type":"function-new-local"'),
      )
    })

    it('sets effectAllowed to "move" on dragstart', () => {
      render(<NewFunctionHandle variant="expanded" />)
      const button = screen.getByRole('button', { name: /new function/i })
      const dataTransfer = { setData: vi.fn(), effectAllowed: '' }
      fireEvent.dragStart(button, { dataTransfer })
      expect(dataTransfer.effectAllowed).toBe('move')
    })
  })

  describe('collapsed variant', () => {
    it('renders an icon-only button', () => {
      render(<NewFunctionHandle variant="collapsed" />)
      // The collapsed variant uses tooltip-driven accessible name, not visible text.
      const button = screen.getByRole('button', { name: /new function/i })
      expect(button).toBeInTheDocument()
      // No visible text label in the collapsed icon strip.
      expect(screen.queryByText('New Function')).not.toBeInTheDocument()
    })

    it('is draggable in the collapsed variant', () => {
      render(<NewFunctionHandle variant="collapsed" />)
      const button = screen.getByRole('button', { name: /new function/i })
      expect(button).toHaveAttribute('draggable', 'true')
    })

    it('sets the same function-new-local payload on dragstart in the collapsed variant', () => {
      render(<NewFunctionHandle variant="collapsed" />)
      const button = screen.getByRole('button', { name: /new function/i })
      const setData = vi.fn()
      fireEvent.dragStart(button, {
        dataTransfer: { setData, effectAllowed: '' },
      })
      expect(setData).toHaveBeenCalledWith(
        'application/wave-block',
        expect.stringContaining('"type":"function-new-local"'),
      )
    })
  })

  describe('click without drag', () => {
    it('does NOT throw and is a no-op interaction (no callback prop required)', async () => {
      const user = userEvent.setup()
      render(<NewFunctionHandle variant="expanded" />)
      const button = screen.getByRole('button', { name: /new function/i })
      await user.click(button)
      // The default behavior is a no-op (the tooltip is hover/focus driven).
      // The optional `onClickWithoutDrag` callback is fired only when supplied.
      expect(button).toBeInTheDocument()
    })

    it('fires onClickWithoutDrag when click happens without a preceding drag', async () => {
      const user = userEvent.setup()
      const onClickWithoutDrag = vi.fn()
      render(<NewFunctionHandle variant="expanded" onClickWithoutDrag={onClickWithoutDrag} />)
      await user.click(screen.getByRole('button', { name: /new function/i }))
      expect(onClickWithoutDrag).toHaveBeenCalledTimes(1)
    })
  })

  describe('tooltip content', () => {
    it('uses the expected hint copy "Drag onto the canvas to create a new Function"', () => {
      render(<NewFunctionHandle variant="expanded" />)
      // The hint copy is wired through accessible name OR a child element so
      // it is locatable in the test environment. We assert the exact text so
      // regressions to the wording surface immediately.
      const button = screen.getByRole('button', { name: /new function/i })
      expect(button.getAttribute('aria-label') ?? button.textContent ?? '').toMatch(
        /new function/i,
      )
      // The hint text appears in the document (tooltip mount or sr-only span).
      expect(
        screen.getByText('Drag onto the canvas to create a new Function'),
      ).toBeInTheDocument()
    })
  })
})
