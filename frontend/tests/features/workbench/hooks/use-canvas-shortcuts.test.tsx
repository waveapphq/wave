/**
 * Canvas Keyboard Shortcuts Tests
 *
 * REQ-4.2.5 Keyboard shortcuts for common operations
 *
 * Tests for the useCanvasShortcuts hook that provides clipboard and edit
 * keyboard shortcuts following the same pattern as use-undo-redo-shortcuts.ts.
 *
 * Shortcuts:
 * - Copy:       Ctrl+C (Windows/Linux), Cmd+C (macOS)
 * - Cut:        Ctrl+X (Windows/Linux), Cmd+X (macOS)
 * - Paste:      Ctrl+V (Windows/Linux), Cmd+V (macOS)
 * - Duplicate:  Ctrl+D (Windows/Linux), Cmd+D (macOS)
 * - Select All: Ctrl+A (Windows/Linux), Cmd+A (macOS)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { renderHook } from '@testing-library/react'
import { useCanvasShortcuts } from '@/features/workbench/hooks/use-canvas-shortcuts'

describe('REQ-4.2.5 Canvas Keyboard Shortcuts', () => {
  describe('useCanvasShortcuts Hook', () => {
    let copyCallback: ReturnType<typeof vi.fn>
    let cutCallback: ReturnType<typeof vi.fn>
    let pasteCallback: ReturnType<typeof vi.fn>
    let duplicateCallback: ReturnType<typeof vi.fn>
    let selectAllCallback: ReturnType<typeof vi.fn>

    beforeEach(() => {
      copyCallback = vi.fn()
      cutCallback = vi.fn()
      pasteCallback = vi.fn()
      duplicateCallback = vi.fn()
      selectAllCallback = vi.fn()
    })

    afterEach(() => {
      vi.clearAllMocks()
    })

    function renderWithAllEnabled() {
      return renderHook(() =>
        useCanvasShortcuts({
          onCopy: copyCallback,
          onCut: cutCallback,
          onPaste: pasteCallback,
          onDuplicate: duplicateCallback,
          onSelectAll: selectAllCallback,
          hasSelection: true,
          hasClipboard: true,
        })
      )
    }

    describe('Copy - Ctrl+C / ⌘+C', () => {
      it('Ctrl+C calls onCopy when hasSelection is true', () => {
        renderWithAllEnabled()

        fireEvent.keyDown(document, { key: 'c', ctrlKey: true })

        expect(copyCallback).toHaveBeenCalledTimes(1)
        expect(cutCallback).not.toHaveBeenCalled()
        expect(pasteCallback).not.toHaveBeenCalled()
      })

      it('Ctrl+C does NOT call onCopy when hasSelection is false', () => {
        renderHook(() =>
          useCanvasShortcuts({
            onCopy: copyCallback,
            onCut: cutCallback,
            onPaste: pasteCallback,
            onDuplicate: duplicateCallback,
            onSelectAll: selectAllCallback,
            hasSelection: false,
            hasClipboard: true,
          })
        )

        fireEvent.keyDown(document, { key: 'c', ctrlKey: true })

        expect(copyCallback).not.toHaveBeenCalled()
      })

      it('⌘+C (metaKey) calls onCopy on macOS', () => {
        renderWithAllEnabled()

        fireEvent.keyDown(document, { key: 'c', metaKey: true })

        expect(copyCallback).toHaveBeenCalledTimes(1)
      })

      it('Ctrl+C prevents default browser behavior', () => {
        renderWithAllEnabled()

        const event = new KeyboardEvent('keydown', {
          key: 'c',
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        })
        const preventDefaultSpy = vi.spyOn(event, 'preventDefault')

        document.dispatchEvent(event)

        expect(preventDefaultSpy).toHaveBeenCalled()
      })
    })

    // A live text selection (e.g. a copyable validation-strip error in
    // an open sheet) must own Ctrl+C / Ctrl+X - the canvas node copy/cut must not
    // hijack it, even when a node is selected on the canvas.
    describe('Text selection guard', () => {
      it('Ctrl+C does NOT copy nodes while text is selected', () => {
        const selectionSpy = vi.spyOn(globalThis, 'getSelection').mockReturnValue({
          toString: () => 'Invalid JSON: Unexpected end of input',
        } as unknown as Selection)
        try {
          renderWithAllEnabled()
          fireEvent.keyDown(document, { key: 'c', ctrlKey: true })
          expect(copyCallback).not.toHaveBeenCalled()
        } finally {
          selectionSpy.mockRestore()
        }
      })

      it('Ctrl+X does NOT cut nodes while text is selected', () => {
        const selectionSpy = vi.spyOn(globalThis, 'getSelection').mockReturnValue({
          toString: () => 'selected error text',
        } as unknown as Selection)
        try {
          renderWithAllEnabled()
          fireEvent.keyDown(document, { key: 'x', ctrlKey: true })
          expect(cutCallback).not.toHaveBeenCalled()
        } finally {
          selectionSpy.mockRestore()
        }
      })

      it('Ctrl+C still copies nodes when the selection is only whitespace', () => {
        const selectionSpy = vi.spyOn(globalThis, 'getSelection').mockReturnValue({
          toString: () => '   ',
        } as unknown as Selection)
        try {
          renderWithAllEnabled()
          fireEvent.keyDown(document, { key: 'c', ctrlKey: true })
          expect(copyCallback).toHaveBeenCalledTimes(1)
        } finally {
          selectionSpy.mockRestore()
        }
      })
    })

    describe('Cut - Ctrl+X / ⌘+X', () => {
      it('Ctrl+X calls onCut when hasSelection is true', () => {
        renderWithAllEnabled()

        fireEvent.keyDown(document, { key: 'x', ctrlKey: true })

        expect(cutCallback).toHaveBeenCalledTimes(1)
        expect(copyCallback).not.toHaveBeenCalled()
      })

      it('Ctrl+X does NOT call onCut when hasSelection is false', () => {
        renderHook(() =>
          useCanvasShortcuts({
            onCopy: copyCallback,
            onCut: cutCallback,
            onPaste: pasteCallback,
            onDuplicate: duplicateCallback,
            onSelectAll: selectAllCallback,
            hasSelection: false,
            hasClipboard: true,
          })
        )

        fireEvent.keyDown(document, { key: 'x', ctrlKey: true })

        expect(cutCallback).not.toHaveBeenCalled()
      })

      it('⌘+X (metaKey) calls onCut on macOS', () => {
        renderWithAllEnabled()

        fireEvent.keyDown(document, { key: 'x', metaKey: true })

        expect(cutCallback).toHaveBeenCalledTimes(1)
      })

      it('Ctrl+X prevents default browser behavior', () => {
        renderWithAllEnabled()

        const event = new KeyboardEvent('keydown', {
          key: 'x',
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        })
        const preventDefaultSpy = vi.spyOn(event, 'preventDefault')

        document.dispatchEvent(event)

        expect(preventDefaultSpy).toHaveBeenCalled()
      })
    })

    describe('Paste - Ctrl+V / ⌘+V', () => {
      it('Ctrl+V calls onPaste when hasClipboard is true', () => {
        renderWithAllEnabled()

        fireEvent.keyDown(document, { key: 'v', ctrlKey: true })

        expect(pasteCallback).toHaveBeenCalledTimes(1)
        expect(copyCallback).not.toHaveBeenCalled()
      })

      it('Ctrl+V does NOT call onPaste when hasClipboard is false', () => {
        renderHook(() =>
          useCanvasShortcuts({
            onCopy: copyCallback,
            onCut: cutCallback,
            onPaste: pasteCallback,
            onDuplicate: duplicateCallback,
            onSelectAll: selectAllCallback,
            hasSelection: true,
            hasClipboard: false,
          })
        )

        fireEvent.keyDown(document, { key: 'v', ctrlKey: true })

        expect(pasteCallback).not.toHaveBeenCalled()
      })

      it('⌘+V (metaKey) calls onPaste on macOS', () => {
        renderWithAllEnabled()

        fireEvent.keyDown(document, { key: 'v', metaKey: true })

        expect(pasteCallback).toHaveBeenCalledTimes(1)
      })

      it('Ctrl+V prevents default browser behavior', () => {
        renderWithAllEnabled()

        const event = new KeyboardEvent('keydown', {
          key: 'v',
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        })
        const preventDefaultSpy = vi.spyOn(event, 'preventDefault')

        document.dispatchEvent(event)

        expect(preventDefaultSpy).toHaveBeenCalled()
      })
    })

    describe('Duplicate - Ctrl+D / ⌘+D', () => {
      it('Ctrl+D calls onDuplicate when hasSelection is true', () => {
        renderWithAllEnabled()

        fireEvent.keyDown(document, { key: 'd', ctrlKey: true })

        expect(duplicateCallback).toHaveBeenCalledTimes(1)
        expect(copyCallback).not.toHaveBeenCalled()
      })

      it('Ctrl+D does NOT call onDuplicate when hasSelection is false', () => {
        renderHook(() =>
          useCanvasShortcuts({
            onCopy: copyCallback,
            onCut: cutCallback,
            onPaste: pasteCallback,
            onDuplicate: duplicateCallback,
            onSelectAll: selectAllCallback,
            hasSelection: false,
            hasClipboard: true,
          })
        )

        fireEvent.keyDown(document, { key: 'd', ctrlKey: true })

        expect(duplicateCallback).not.toHaveBeenCalled()
      })

      it('⌘+D (metaKey) calls onDuplicate on macOS', () => {
        renderWithAllEnabled()

        fireEvent.keyDown(document, { key: 'd', metaKey: true })

        expect(duplicateCallback).toHaveBeenCalledTimes(1)
      })

      it('Ctrl+D prevents default (blocks browser bookmark dialog)', () => {
        renderWithAllEnabled()

        const event = new KeyboardEvent('keydown', {
          key: 'd',
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        })
        const preventDefaultSpy = vi.spyOn(event, 'preventDefault')

        document.dispatchEvent(event)

        expect(preventDefaultSpy).toHaveBeenCalled()
      })
    })

    describe('Select All - Ctrl+A / ⌘+A', () => {
      it('Ctrl+A calls onSelectAll (always available, no selection required)', () => {
        renderHook(() =>
          useCanvasShortcuts({
            onCopy: copyCallback,
            onCut: cutCallback,
            onPaste: pasteCallback,
            onDuplicate: duplicateCallback,
            onSelectAll: selectAllCallback,
            hasSelection: false,
            hasClipboard: false,
          })
        )

        fireEvent.keyDown(document, { key: 'a', ctrlKey: true })

        expect(selectAllCallback).toHaveBeenCalledTimes(1)
      })

      it('⌘+A (metaKey) calls onSelectAll on macOS', () => {
        renderWithAllEnabled()

        fireEvent.keyDown(document, { key: 'a', metaKey: true })

        expect(selectAllCallback).toHaveBeenCalledTimes(1)
      })

      it('Ctrl+A prevents default (blocks browser select-all text)', () => {
        renderWithAllEnabled()

        const event = new KeyboardEvent('keydown', {
          key: 'a',
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        })
        const preventDefaultSpy = vi.spyOn(event, 'preventDefault')

        document.dispatchEvent(event)

        expect(preventDefaultSpy).toHaveBeenCalled()
      })
    })

    describe('Focus Guards', () => {
      /**
       * Per design: "Guard logic checks active element's tag name
       * (INPUT, TEXTAREA, SELECT) and contenteditable attribute"
       */
      it('does not trigger shortcuts when focus is in text input', () => {
        const TestComponent = () => {
          useCanvasShortcuts({
            onCopy: copyCallback,
            onCut: cutCallback,
            onPaste: pasteCallback,
            onDuplicate: duplicateCallback,
            onSelectAll: selectAllCallback,
            hasSelection: true,
            hasClipboard: true,
          })
          return <input type="text" data-testid="text-input" />
        }

        render(<TestComponent />)
        const input = screen.getByTestId('text-input')
        input.focus()

        fireEvent.keyDown(input, { key: 'c', ctrlKey: true })

        expect(copyCallback).not.toHaveBeenCalled()
      })

      it('does not trigger shortcuts when focus is in textarea', () => {
        const TestComponent = () => {
          useCanvasShortcuts({
            onCopy: copyCallback,
            onCut: cutCallback,
            onPaste: pasteCallback,
            onDuplicate: duplicateCallback,
            onSelectAll: selectAllCallback,
            hasSelection: true,
            hasClipboard: true,
          })
          return <textarea data-testid="textarea" />
        }

        render(<TestComponent />)
        const textarea = screen.getByTestId('textarea')
        textarea.focus()

        fireEvent.keyDown(textarea, { key: 'x', ctrlKey: true })

        expect(cutCallback).not.toHaveBeenCalled()
      })

      it('does not trigger shortcuts when focus is in select element', () => {
        const TestComponent = () => {
          useCanvasShortcuts({
            onCopy: copyCallback,
            onCut: cutCallback,
            onPaste: pasteCallback,
            onDuplicate: duplicateCallback,
            onSelectAll: selectAllCallback,
            hasSelection: true,
            hasClipboard: true,
          })
          return (
            <select data-testid="select-input">
              <option value="a">A</option>
            </select>
          )
        }

        render(<TestComponent />)
        const select = screen.getByTestId('select-input')
        select.focus()

        fireEvent.keyDown(select, { key: 'a', ctrlKey: true })

        expect(selectAllCallback).not.toHaveBeenCalled()
      })

      it('does not trigger shortcuts when focus is in contenteditable element', () => {
        const TestComponent = () => {
          useCanvasShortcuts({
            onCopy: copyCallback,
            onCut: cutCallback,
            onPaste: pasteCallback,
            onDuplicate: duplicateCallback,
            onSelectAll: selectAllCallback,
            hasSelection: true,
            hasClipboard: true,
          })
          return <div contentEditable data-testid="editable" />
        }

        render(<TestComponent />)
        const editable = screen.getByTestId('editable')
        editable.focus()

        fireEvent.keyDown(editable, { key: 'v', ctrlKey: true })

        expect(pasteCallback).not.toHaveBeenCalled()
      })

      it('triggers shortcuts when focus is on non-input element', () => {
        const TestComponent = () => {
          useCanvasShortcuts({
            onCopy: copyCallback,
            onCut: cutCallback,
            onPaste: pasteCallback,
            onDuplicate: duplicateCallback,
            onSelectAll: selectAllCallback,
            hasSelection: true,
            hasClipboard: true,
          })
          return <button data-testid="button">Click me</button>
        }

        render(<TestComponent />)
        const button = screen.getByTestId('button')
        button.focus()

        fireEvent.keyDown(button, { key: 'c', ctrlKey: true })

        expect(copyCallback).toHaveBeenCalledTimes(1)
      })

      it('triggers shortcuts when fired on document body', () => {
        renderWithAllEnabled()

        fireEvent.keyDown(document.body, { key: 'c', ctrlKey: true })

        expect(copyCallback).toHaveBeenCalledTimes(1)
      })
    })

    describe('Disabled State', () => {
      it('does not trigger any callbacks when disabled', () => {
        renderHook(() =>
          useCanvasShortcuts({
            onCopy: copyCallback,
            onCut: cutCallback,
            onPaste: pasteCallback,
            onDuplicate: duplicateCallback,
            onSelectAll: selectAllCallback,
            hasSelection: true,
            hasClipboard: true,
            disabled: true,
          })
        )

        fireEvent.keyDown(document, { key: 'c', ctrlKey: true })
        fireEvent.keyDown(document, { key: 'x', ctrlKey: true })
        fireEvent.keyDown(document, { key: 'v', ctrlKey: true })
        fireEvent.keyDown(document, { key: 'd', ctrlKey: true })
        fireEvent.keyDown(document, { key: 'a', ctrlKey: true })

        expect(copyCallback).not.toHaveBeenCalled()
        expect(cutCallback).not.toHaveBeenCalled()
        expect(pasteCallback).not.toHaveBeenCalled()
        expect(duplicateCallback).not.toHaveBeenCalled()
        expect(selectAllCallback).not.toHaveBeenCalled()
      })

      it('does not prevent default when disabled', () => {
        renderHook(() =>
          useCanvasShortcuts({
            onCopy: copyCallback,
            onCut: cutCallback,
            onPaste: pasteCallback,
            onDuplicate: duplicateCallback,
            onSelectAll: selectAllCallback,
            hasSelection: true,
            hasClipboard: true,
            disabled: true,
          })
        )

        const event = new KeyboardEvent('keydown', {
          key: 'c',
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        })
        const preventDefaultSpy = vi.spyOn(event, 'preventDefault')

        document.dispatchEvent(event)

        expect(preventDefaultSpy).not.toHaveBeenCalled()
      })
    })

    describe('Case Insensitivity', () => {
      it('handles uppercase key (Ctrl+C with key="C")', () => {
        renderWithAllEnabled()

        fireEvent.keyDown(document, { key: 'C', ctrlKey: true })

        expect(copyCallback).toHaveBeenCalledTimes(1)
      })

      it('handles uppercase key for all shortcuts', () => {
        renderWithAllEnabled()

        fireEvent.keyDown(document, { key: 'X', ctrlKey: true })
        fireEvent.keyDown(document, { key: 'V', ctrlKey: true })
        fireEvent.keyDown(document, { key: 'D', ctrlKey: true })
        fireEvent.keyDown(document, { key: 'A', ctrlKey: true })

        expect(cutCallback).toHaveBeenCalledTimes(1)
        expect(pasteCallback).toHaveBeenCalledTimes(1)
        expect(duplicateCallback).toHaveBeenCalledTimes(1)
        expect(selectAllCallback).toHaveBeenCalledTimes(1)
      })
    })

    describe('Modifier Key Isolation', () => {
      it('does not trigger on key without modifier (bare "c")', () => {
        renderWithAllEnabled()

        fireEvent.keyDown(document, { key: 'c' })

        expect(copyCallback).not.toHaveBeenCalled()
      })

      it('does not trigger on Alt+key (Ctrl+Alt+C)', () => {
        renderWithAllEnabled()

        fireEvent.keyDown(document, { key: 'c', ctrlKey: true, altKey: true })

        expect(copyCallback).not.toHaveBeenCalled()
      })

      it('does not trigger on Shift+key alone (Shift+C without Ctrl)', () => {
        renderWithAllEnabled()

        fireEvent.keyDown(document, { key: 'c', shiftKey: true })

        expect(copyCallback).not.toHaveBeenCalled()
      })

      it('does not trigger on Ctrl+Shift+C (Shift+modifier combos belong to undo/redo)', () => {
        renderWithAllEnabled()

        fireEvent.keyDown(document, { key: 'c', ctrlKey: true, shiftKey: true })

        expect(copyCallback).not.toHaveBeenCalled()
      })

      it('does not trigger on unrelated keys (Ctrl+Z is handled by undo/redo hook)', () => {
        renderWithAllEnabled()

        fireEvent.keyDown(document, { key: 'z', ctrlKey: true })

        expect(copyCallback).not.toHaveBeenCalled()
        expect(cutCallback).not.toHaveBeenCalled()
        expect(pasteCallback).not.toHaveBeenCalled()
        expect(duplicateCallback).not.toHaveBeenCalled()
        expect(selectAllCallback).not.toHaveBeenCalled()
      })
    })

    describe('Hook Lifecycle', () => {
      it('removes event listener on unmount', () => {
        const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener')

        const { unmount } = renderWithAllEnabled()

        unmount()

        expect(removeEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function))
      })

      it('responds to prop changes (hasSelection changes from false to true)', () => {
        const { rerender } = renderHook(
          ({ hasSelection }) =>
            useCanvasShortcuts({
              onCopy: copyCallback,
              onCut: cutCallback,
              onPaste: pasteCallback,
              onDuplicate: duplicateCallback,
              onSelectAll: selectAllCallback,
              hasSelection,
              hasClipboard: true,
            }),
          { initialProps: { hasSelection: false } }
        )

        // Should not work initially
        fireEvent.keyDown(document, { key: 'c', ctrlKey: true })
        expect(copyCallback).not.toHaveBeenCalled()

        // Rerender with selection enabled
        rerender({ hasSelection: true })

        fireEvent.keyDown(document, { key: 'c', ctrlKey: true })
        expect(copyCallback).toHaveBeenCalledTimes(1)
      })

      it('responds to callback changes', () => {
        const newCopyCallback = vi.fn()

        const { rerender } = renderHook(
          ({ onCopy }) =>
            useCanvasShortcuts({
              onCopy,
              onCut: cutCallback,
              onPaste: pasteCallback,
              onDuplicate: duplicateCallback,
              onSelectAll: selectAllCallback,
              hasSelection: true,
              hasClipboard: true,
            }),
          { initialProps: { onCopy: copyCallback } }
        )

        rerender({ onCopy: newCopyCallback })

        fireEvent.keyDown(document, { key: 'c', ctrlKey: true })

        expect(newCopyCallback).toHaveBeenCalledTimes(1)
        expect(copyCallback).not.toHaveBeenCalled()
      })
    })

    describe('No Duplicate Fires', () => {
      it('each shortcut fires exactly once per keypress', () => {
        renderWithAllEnabled()

        fireEvent.keyDown(document, { key: 'c', ctrlKey: true })

        expect(copyCallback).toHaveBeenCalledTimes(1)
        expect(cutCallback).toHaveBeenCalledTimes(0)
        expect(pasteCallback).toHaveBeenCalledTimes(0)
        expect(duplicateCallback).toHaveBeenCalledTimes(0)
        expect(selectAllCallback).toHaveBeenCalledTimes(0)
      })
    })

    describe('Delete and Backspace', () => {
      it('Delete fires onDelete when hasSelection is true', () => {
        const deleteCallback = vi.fn()
        const disconnectCallback = vi.fn()
        renderHook(() =>
          useCanvasShortcuts({
            onCopy: copyCallback,
            onCut: cutCallback,
            onPaste: pasteCallback,
            onDuplicate: duplicateCallback,
            onSelectAll: selectAllCallback,
            onDelete: deleteCallback,
            onDisconnect: disconnectCallback,
            hasSelection: true,
            hasClipboard: false,
          }),
        )
        fireEvent.keyDown(document, { key: 'Delete' })
        expect(deleteCallback).toHaveBeenCalledTimes(1)
        expect(disconnectCallback).not.toHaveBeenCalled()
      })

      it('Backspace fires onDisconnect when hasSelection is true', () => {
        const deleteCallback = vi.fn()
        const disconnectCallback = vi.fn()
        renderHook(() =>
          useCanvasShortcuts({
            onCopy: copyCallback,
            onCut: cutCallback,
            onPaste: pasteCallback,
            onDuplicate: duplicateCallback,
            onSelectAll: selectAllCallback,
            onDelete: deleteCallback,
            onDisconnect: disconnectCallback,
            hasSelection: true,
            hasClipboard: false,
          }),
        )
        fireEvent.keyDown(document, { key: 'Backspace' })
        expect(disconnectCallback).toHaveBeenCalledTimes(1)
        expect(deleteCallback).not.toHaveBeenCalled()
      })

      it('Delete does NOT fire when hasSelection is false', () => {
        const deleteCallback = vi.fn()
        renderHook(() =>
          useCanvasShortcuts({
            onCopy: copyCallback,
            onCut: cutCallback,
            onPaste: pasteCallback,
            onDuplicate: duplicateCallback,
            onSelectAll: selectAllCallback,
            onDelete: deleteCallback,
            hasSelection: false,
            hasClipboard: false,
          }),
        )
        fireEvent.keyDown(document, { key: 'Delete' })
        expect(deleteCallback).not.toHaveBeenCalled()
      })

      it('Delete does NOT fire when onDelete is omitted', () => {
        renderHook(() =>
          useCanvasShortcuts({
            onCopy: copyCallback,
            onCut: cutCallback,
            onPaste: pasteCallback,
            onDuplicate: duplicateCallback,
            onSelectAll: selectAllCallback,
            hasSelection: true,
            hasClipboard: false,
          }),
        )
        // Should not throw; just be a silent no-op.
        expect(() => {
          fireEvent.keyDown(document, { key: 'Delete' })
        }).not.toThrow()
      })

      it('Delete is ignored when focus is in a text input', () => {
        const deleteCallback = vi.fn()
        renderHook(() =>
          useCanvasShortcuts({
            onCopy: copyCallback,
            onCut: cutCallback,
            onPaste: pasteCallback,
            onDuplicate: duplicateCallback,
            onSelectAll: selectAllCallback,
            onDelete: deleteCallback,
            hasSelection: true,
            hasClipboard: false,
          }),
        )
        const input = document.createElement('input')
        document.body.appendChild(input)
        fireEvent.keyDown(input, { key: 'Delete' })
        expect(deleteCallback).not.toHaveBeenCalled()
        document.body.removeChild(input)
      })

      it('Delete with Ctrl modifier is ignored (delete + modifier is not our shortcut)', () => {
        const deleteCallback = vi.fn()
        renderHook(() =>
          useCanvasShortcuts({
            onCopy: copyCallback,
            onCut: cutCallback,
            onPaste: pasteCallback,
            onDuplicate: duplicateCallback,
            onSelectAll: selectAllCallback,
            onDelete: deleteCallback,
            hasSelection: true,
            hasClipboard: false,
          }),
        )
        fireEvent.keyDown(document, { key: 'Delete', ctrlKey: true })
        expect(deleteCallback).not.toHaveBeenCalled()
      })
    })
  })
})
