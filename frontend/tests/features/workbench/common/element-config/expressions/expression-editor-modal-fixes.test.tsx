/**
 * ExpressionEditorModal: title, width and resize tests
 *
 * Pins:
 *   - Title fallback: empty/undefined title -> "Edit expression".
 *   - Modal width is persisted to localStorage under
 *     `wave.expression-editor-modal.width`.
 *   - A right-edge resize handle is rendered.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'

import { ExpressionEditorModal } from '@/features/workbench/common/element-config/expressions/expression-editor-modal'
import type { AvailableVariable } from '@/features/workbench/common/element-config/expressions/expression-input'

const variables: AvailableVariable[] = []

const baseProps = {
  open: true,
  onOpenChange: vi.fn(),
  value: '',
  onChange: vi.fn(),
  availableVariables: variables,
}

describe('ExpressionEditorModal: title, width and resize', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  describe('title fallback', () => {
    it('falls back to "Edit expression" when title is undefined', async () => {
      render(<ExpressionEditorModal {...baseProps} />)

      await waitFor(() => {
        expect(screen.getByText('Edit expression')).toBeInTheDocument()
      })
    })

    it('falls back to "Edit expression" when title is an empty string', async () => {
      render(<ExpressionEditorModal {...baseProps} title="" />)

      await waitFor(() => {
        expect(screen.getByText('Edit expression')).toBeInTheDocument()
      })
    })

    it('falls back when title contains only whitespace', async () => {
      render(<ExpressionEditorModal {...baseProps} title="   " />)

      await waitFor(() => {
        expect(screen.getByText('Edit expression')).toBeInTheDocument()
      })
    })

    it('uses the provided meaningful title verbatim', async () => {
      render(<ExpressionEditorModal {...baseProps} title="Edit Request URL" />)

      await waitFor(() => {
        expect(screen.getByText('Edit Request URL')).toBeInTheDocument()
      })
    })
  })

  describe('width persistence', () => {
    it('renders a resize handle with the documented testid', async () => {
      render(<ExpressionEditorModal {...baseProps} />)

      await waitFor(() => {
        expect(
          screen.getByTestId('expression-editor-modal-resize-handle'),
        ).toBeInTheDocument()
      })
    })

    it('reads the persisted width from localStorage on mount', async () => {
      localStorage.setItem('wave.expression-editor-modal.width', '720')

      render(<ExpressionEditorModal {...baseProps} />)

      await waitFor(() => {
        const dialog = screen.getByTestId('expression-editor-modal')
        expect(dialog.getAttribute('style') ?? '').toContain('720')
      })
    })

    it('clamps an out-of-bounds persisted width to a sensible default', async () => {
      // 99999px is far above any reasonable cap; the modal must not blindly
      // restore garbage values from localStorage.
      localStorage.setItem('wave.expression-editor-modal.width', '99999')

      render(<ExpressionEditorModal {...baseProps} />)

      await waitFor(() => {
        const dialog = screen.getByTestId('expression-editor-modal')
        const style = dialog.getAttribute('style') ?? ''
        // Should NOT carry the bogus 99999 - either clamped or default.
        expect(style).not.toContain('99999')
      })
    })

    it('ignores a non-numeric persisted width', async () => {
      localStorage.setItem('wave.expression-editor-modal.width', 'not-a-number')

      // Just rendering without throwing is enough; the modal must tolerate
      // corrupted localStorage entries.
      render(<ExpressionEditorModal {...baseProps} />)

      await waitFor(() => {
        expect(screen.getByTestId('expression-editor-modal')).toBeInTheDocument()
      })
    })
  })

  describe('resize handle interaction', () => {
    function readWidth() {
      const dialog = screen.getByTestId('expression-editor-modal') as HTMLElement
      const m = (dialog.getAttribute('style') ?? '').match(/width:\s*(\d+)px/)
      return m ? Number(m[1]) : NaN
    }

    function fireKey(handle: HTMLElement, key: string) {
      // RTL's fireEvent wraps the dispatch in act() so React state updates
      // commit synchronously without warnings.
      fireEvent.keyDown(handle, { key, bubbles: true, cancelable: true })
    }

    it('ArrowRight grows the modal by 16 px', async () => {
      render(<ExpressionEditorModal {...baseProps} />)
      await waitFor(() =>
        expect(screen.getByTestId('expression-editor-modal-resize-handle')).toBeInTheDocument(),
      )
      const handle = screen.getByTestId('expression-editor-modal-resize-handle') as HTMLElement
      const before = readWidth()
      fireKey(handle, 'ArrowRight')
      await waitFor(() => expect(readWidth()).toBe(before + 16))
    })

    it('ArrowLeft shrinks the modal by 16 px', async () => {
      render(<ExpressionEditorModal {...baseProps} />)
      await waitFor(() =>
        expect(screen.getByTestId('expression-editor-modal-resize-handle')).toBeInTheDocument(),
      )
      const handle = screen.getByTestId('expression-editor-modal-resize-handle') as HTMLElement
      const before = readWidth()
      fireKey(handle, 'ArrowLeft')
      await waitFor(() => expect(readWidth()).toBe(before - 16))
    })

    it('keys other than ArrowLeft/Right do not change width', async () => {
      render(<ExpressionEditorModal {...baseProps} />)
      await waitFor(() =>
        expect(screen.getByTestId('expression-editor-modal-resize-handle')).toBeInTheDocument(),
      )
      const handle = screen.getByTestId('expression-editor-modal-resize-handle') as HTMLElement
      const before = readWidth()
      fireKey(handle, 'Enter')
      fireKey(handle, ' ')
      fireKey(handle, 'Escape')
      expect(readWidth()).toBe(before)
    })

    it('pointer drag updates the persisted width', async () => {
      render(<ExpressionEditorModal {...baseProps} />)
      await waitFor(() =>
        expect(screen.getByTestId('expression-editor-modal-resize-handle')).toBeInTheDocument(),
      )
      const handle = screen.getByTestId('expression-editor-modal-resize-handle') as HTMLElement

      // jsdom supports PointerEvent constructor sufficiently for our handler.
      // setPointerCapture is a no-op stub on jsdom; we wrap to swallow that.
      const originalSPC = (handle as unknown as { setPointerCapture?: (id: number) => void })
        .setPointerCapture
      ;(handle as unknown as { setPointerCapture: (id: number) => void }).setPointerCapture = () => {}

      const startEvent = new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        clientX: 100,
        pointerId: 1,
      })
      const moveEvent = new PointerEvent('pointermove', {
        bubbles: true,
        cancelable: true,
        clientX: 150,
        pointerId: 1,
      })
      const endEvent = new PointerEvent('pointerup', {
        bubbles: true,
        cancelable: true,
        clientX: 150,
        pointerId: 1,
      })

      const before = readWidth()
      // Wrap raw dispatchEvent in act() so React's state updates commit
      // before the assertion. RTL's fireEvent doesn't construct
      // PointerEvent instances with proper pointerId/clientX, so we keep
      // dispatchEvent here and lift the surrounding act() ourselves.
      act(() => {
        handle.dispatchEvent(startEvent)
        handle.dispatchEvent(moveEvent)
        handle.dispatchEvent(endEvent)
      })

      // Width grew by approximately the drag delta (50 px), bounded by min/max
      // clamping inside `usePersistedModalWidth`.
      await waitFor(() => expect(readWidth()).toBe(before + 50))

      ;(handle as unknown as { setPointerCapture?: (id: number) => void }).setPointerCapture =
        originalSPC
    })

    it('a pointer move over the handle without a press leaves the width alone', async () => {
      render(<ExpressionEditorModal {...baseProps} />)
      await waitFor(() =>
        expect(screen.getByTestId('expression-editor-modal-resize-handle')).toBeInTheDocument(),
      )
      const handle = screen.getByTestId('expression-editor-modal-resize-handle') as HTMLElement
      const before = readWidth()

      act(() => {
        handle.dispatchEvent(
          new PointerEvent('pointermove', { bubbles: true, cancelable: true, clientX: 150, pointerId: 1 }),
        )
      })

      expect(readWidth()).toBe(before)
      expect(localStorage.getItem('wave.expression-editor-modal.width')).toBeNull()
    })
  })
})
