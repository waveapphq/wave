/**
 * Undo/Redo Keyboard Shortcuts Tests
 *
 * REQ-5.2.1.24 Undo/redo support for critical operations
 *
 * Keyboard shortcuts:
 * - Undo: Ctrl+Z (Windows/Linux), Cmd+Z (macOS)
 * - Redo: Ctrl+Shift+Z or Ctrl+Y (Windows/Linux), Cmd+Shift+Z (macOS)
 * - Shortcuts disabled when focus is within text input with native undo
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { renderHook } from '@testing-library/react'
import { useUndoRedoShortcuts } from '@/features/workbench/hooks/use-undo-redo-shortcuts'

describe('REQ-5.2.1.24 Undo/Redo Keyboard Shortcuts', () => {
  describe('useUndoRedoShortcuts Hook', () => {
    let undoCallback: ReturnType<typeof vi.fn>
    let redoCallback: ReturnType<typeof vi.fn>

    beforeEach(() => {
      undoCallback = vi.fn()
      redoCallback = vi.fn()
    })

    afterEach(() => {
      vi.clearAllMocks()
    })

    describe('Windows/Linux Shortcuts', () => {
      it('Ctrl+Z triggers undo callback', () => {
        renderHook(() =>
          useUndoRedoShortcuts({
            onUndo: undoCallback,
            onRedo: redoCallback,
            canUndo: true,
            canRedo: true,
          })
        )

        fireEvent.keyDown(document, { key: 'z', ctrlKey: true })

        expect(undoCallback).toHaveBeenCalledTimes(1)
        expect(redoCallback).not.toHaveBeenCalled()
      })

      it('Ctrl+Shift+Z triggers redo callback', () => {
        renderHook(() =>
          useUndoRedoShortcuts({
            onUndo: undoCallback,
            onRedo: redoCallback,
            canUndo: true,
            canRedo: true,
          })
        )

        fireEvent.keyDown(document, { key: 'z', ctrlKey: true, shiftKey: true })

        expect(redoCallback).toHaveBeenCalledTimes(1)
        expect(undoCallback).not.toHaveBeenCalled()
      })

      it('Ctrl+Y triggers redo callback (alternative)', () => {
        renderHook(() =>
          useUndoRedoShortcuts({
            onUndo: undoCallback,
            onRedo: redoCallback,
            canUndo: true,
            canRedo: true,
          })
        )

        fireEvent.keyDown(document, { key: 'y', ctrlKey: true })

        expect(redoCallback).toHaveBeenCalledTimes(1)
        expect(undoCallback).not.toHaveBeenCalled()
      })
    })

    describe('macOS Shortcuts', () => {
      it('Cmd+Z triggers undo callback', () => {
        renderHook(() =>
          useUndoRedoShortcuts({
            onUndo: undoCallback,
            onRedo: redoCallback,
            canUndo: true,
            canRedo: true,
          })
        )

        fireEvent.keyDown(document, { key: 'z', metaKey: true })

        expect(undoCallback).toHaveBeenCalledTimes(1)
        expect(redoCallback).not.toHaveBeenCalled()
      })

      it('Cmd+Shift+Z triggers redo callback', () => {
        renderHook(() =>
          useUndoRedoShortcuts({
            onUndo: undoCallback,
            onRedo: redoCallback,
            canUndo: true,
            canRedo: true,
          })
        )

        fireEvent.keyDown(document, { key: 'z', metaKey: true, shiftKey: true })

        expect(redoCallback).toHaveBeenCalledTimes(1)
        expect(undoCallback).not.toHaveBeenCalled()
      })
    })

    describe('Conditional Execution', () => {
      it('does not trigger undo when canUndo is false', () => {
        renderHook(() =>
          useUndoRedoShortcuts({
            onUndo: undoCallback,
            onRedo: redoCallback,
            canUndo: false,
            canRedo: true,
          })
        )

        fireEvent.keyDown(document, { key: 'z', ctrlKey: true })

        expect(undoCallback).not.toHaveBeenCalled()
      })

      it('does not trigger redo when canRedo is false', () => {
        renderHook(() =>
          useUndoRedoShortcuts({
            onUndo: undoCallback,
            onRedo: redoCallback,
            canUndo: true,
            canRedo: false,
          })
        )

        fireEvent.keyDown(document, { key: 'z', ctrlKey: true, shiftKey: true })

        expect(redoCallback).not.toHaveBeenCalled()
      })

      it('does not trigger redo with Ctrl+Y when canRedo is false', () => {
        renderHook(() =>
          useUndoRedoShortcuts({
            onUndo: undoCallback,
            onRedo: redoCallback,
            canUndo: true,
            canRedo: false,
          })
        )

        fireEvent.keyDown(document, { key: 'y', ctrlKey: true })

        expect(redoCallback).not.toHaveBeenCalled()
      })
    })

    describe('Text Input Focus Behavior', () => {
      /**
       * Per design: "These shortcuts are disabled when focus is within a text
       * input field that has its own undo behavior"
       */
      it('does not trigger undo when focus is in text input', () => {
        const TestComponent = () => {
          useUndoRedoShortcuts({
            onUndo: undoCallback,
            onRedo: redoCallback,
            canUndo: true,
            canRedo: true,
          })
          return <input type="text" data-testid="text-input" />
        }

        render(<TestComponent />)
        const input = screen.getByTestId('text-input')

        // Focus the input
        input.focus()

        // Fire keydown on the input (simulating user typing Ctrl+Z in input)
        fireEvent.keyDown(input, { key: 'z', ctrlKey: true })

        expect(undoCallback).not.toHaveBeenCalled()
      })

      it('does not trigger redo when focus is in text input', () => {
        const TestComponent = () => {
          useUndoRedoShortcuts({
            onUndo: undoCallback,
            onRedo: redoCallback,
            canUndo: true,
            canRedo: true,
          })
          return <input type="text" data-testid="text-input" />
        }

        render(<TestComponent />)
        const input = screen.getByTestId('text-input')

        input.focus()
        fireEvent.keyDown(input, { key: 'z', ctrlKey: true, shiftKey: true })

        expect(redoCallback).not.toHaveBeenCalled()
      })

      it('does not trigger undo when focus is in textarea', () => {
        const TestComponent = () => {
          useUndoRedoShortcuts({
            onUndo: undoCallback,
            onRedo: redoCallback,
            canUndo: true,
            canRedo: true,
          })
          return <textarea data-testid="textarea" />
        }

        render(<TestComponent />)
        const textarea = screen.getByTestId('textarea')

        textarea.focus()
        fireEvent.keyDown(textarea, { key: 'z', ctrlKey: true })

        expect(undoCallback).not.toHaveBeenCalled()
      })

      it('does not trigger undo when focus is in contenteditable element', () => {
        const TestComponent = () => {
          useUndoRedoShortcuts({
            onUndo: undoCallback,
            onRedo: redoCallback,
            canUndo: true,
            canRedo: true,
          })
          return <div contentEditable data-testid="editable" />
        }

        render(<TestComponent />)
        const editable = screen.getByTestId('editable')

        editable.focus()
        fireEvent.keyDown(editable, { key: 'z', ctrlKey: true })

        expect(undoCallback).not.toHaveBeenCalled()
      })

      it('triggers undo when focus is on non-input element', () => {
        const TestComponent = () => {
          useUndoRedoShortcuts({
            onUndo: undoCallback,
            onRedo: redoCallback,
            canUndo: true,
            canRedo: true,
          })
          return <button data-testid="button">Click me</button>
        }

        render(<TestComponent />)
        const button = screen.getByTestId('button')

        button.focus()
        fireEvent.keyDown(button, { key: 'z', ctrlKey: true })

        expect(undoCallback).toHaveBeenCalledTimes(1)
      })

      it('triggers undo when focus is on document body', () => {
        renderHook(() =>
          useUndoRedoShortcuts({
            onUndo: undoCallback,
            onRedo: redoCallback,
            canUndo: true,
            canRedo: true,
          })
        )

        fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })

        expect(undoCallback).toHaveBeenCalledTimes(1)
      })
    })

    describe('Event Prevention', () => {
      it('prevents default when undo shortcut is triggered', () => {
        renderHook(() =>
          useUndoRedoShortcuts({
            onUndo: undoCallback,
            onRedo: redoCallback,
            canUndo: true,
            canRedo: true,
          })
        )

        const event = new KeyboardEvent('keydown', {
          key: 'z',
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        })
        const preventDefaultSpy = vi.spyOn(event, 'preventDefault')

        document.dispatchEvent(event)

        expect(preventDefaultSpy).toHaveBeenCalled()
      })

      it('prevents default when redo shortcut is triggered', () => {
        renderHook(() =>
          useUndoRedoShortcuts({
            onUndo: undoCallback,
            onRedo: redoCallback,
            canUndo: true,
            canRedo: true,
          })
        )

        const event = new KeyboardEvent('keydown', {
          key: 'z',
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        })
        const preventDefaultSpy = vi.spyOn(event, 'preventDefault')

        document.dispatchEvent(event)

        expect(preventDefaultSpy).toHaveBeenCalled()
      })

      it('does not prevent default when shortcuts are disabled', () => {
        renderHook(() =>
          useUndoRedoShortcuts({
            onUndo: undoCallback,
            onRedo: redoCallback,
            canUndo: false,
            canRedo: false,
          })
        )

        const event = new KeyboardEvent('keydown', {
          key: 'z',
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        })
        const preventDefaultSpy = vi.spyOn(event, 'preventDefault')

        document.dispatchEvent(event)

        expect(preventDefaultSpy).not.toHaveBeenCalled()
      })
    })

    describe('Hook Lifecycle', () => {
      it('removes event listener on unmount', () => {
        const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener')

        const { unmount } = renderHook(() =>
          useUndoRedoShortcuts({
            onUndo: undoCallback,
            onRedo: redoCallback,
            canUndo: true,
            canRedo: true,
          })
        )

        unmount()

        expect(removeEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function))
      })

      it('updates callbacks when props change', () => {
        const newUndoCallback = vi.fn()

        const { rerender } = renderHook(
          ({ onUndo }) =>
            useUndoRedoShortcuts({
              onUndo,
              onRedo: redoCallback,
              canUndo: true,
              canRedo: true,
            }),
          { initialProps: { onUndo: undoCallback } }
        )

        // Rerender with new callback
        rerender({ onUndo: newUndoCallback })

        fireEvent.keyDown(document, { key: 'z', ctrlKey: true })

        expect(newUndoCallback).toHaveBeenCalledTimes(1)
        expect(undoCallback).not.toHaveBeenCalled()
      })
    })

    describe('Unavailable State', () => {
      it('does not trigger callbacks when the store guards report unavailable', () => {
        // canUndo/canRedo are the execution-aware store guards; the hook has
        // no separate disabled flag.
        renderHook(() =>
          useUndoRedoShortcuts({
            onUndo: undoCallback,
            onRedo: redoCallback,
            canUndo: false,
            canRedo: false,
          })
        )

        fireEvent.keyDown(document, { key: 'z', ctrlKey: true })
        fireEvent.keyDown(document, { key: 'z', ctrlKey: true, shiftKey: true })

        expect(undoCallback).not.toHaveBeenCalled()
        expect(redoCallback).not.toHaveBeenCalled()
      })
    })

    describe('Case Insensitivity', () => {
      it('handles uppercase Z key', () => {
        renderHook(() =>
          useUndoRedoShortcuts({
            onUndo: undoCallback,
            onRedo: redoCallback,
            canUndo: true,
            canRedo: true,
          })
        )

        fireEvent.keyDown(document, { key: 'Z', ctrlKey: true })

        expect(undoCallback).toHaveBeenCalledTimes(1)
      })

      it('handles uppercase Y key for redo', () => {
        renderHook(() =>
          useUndoRedoShortcuts({
            onUndo: undoCallback,
            onRedo: redoCallback,
            canUndo: true,
            canRedo: true,
          })
        )

        fireEvent.keyDown(document, { key: 'Y', ctrlKey: true })

        expect(redoCallback).toHaveBeenCalledTimes(1)
      })
    })

    describe('Modifier Key Isolation', () => {
      it('does not trigger on Z without modifier keys', () => {
        renderHook(() =>
          useUndoRedoShortcuts({
            onUndo: undoCallback,
            onRedo: redoCallback,
            canUndo: true,
            canRedo: true,
          })
        )

        fireEvent.keyDown(document, { key: 'z' })

        expect(undoCallback).not.toHaveBeenCalled()
        expect(redoCallback).not.toHaveBeenCalled()
      })

      it('does not trigger on Alt+Z', () => {
        renderHook(() =>
          useUndoRedoShortcuts({
            onUndo: undoCallback,
            onRedo: redoCallback,
            canUndo: true,
            canRedo: true,
          })
        )

        fireEvent.keyDown(document, { key: 'z', altKey: true })

        expect(undoCallback).not.toHaveBeenCalled()
      })

      it('does not trigger on Ctrl+Alt+Z', () => {
        renderHook(() =>
          useUndoRedoShortcuts({
            onUndo: undoCallback,
            onRedo: redoCallback,
            canUndo: true,
            canRedo: true,
          })
        )

        fireEvent.keyDown(document, { key: 'z', ctrlKey: true, altKey: true })

        expect(undoCallback).not.toHaveBeenCalled()
      })
    })
  })
})
