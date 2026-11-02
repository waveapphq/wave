/**
 * useUndoRedoShortcuts Hook
 *
 * REQ-5.2.1.24 Undo/redo support for critical operations
 *
 * Provides keyboard shortcuts for undo/redo operations following design specifications.
 *
 * Keyboard shortcuts:
 * - Undo: Ctrl+Z (Windows/Linux), Cmd+Z (macOS)
 * - Redo: Ctrl+Shift+Z or Ctrl+Y (Windows/Linux), Cmd+Shift+Z (macOS)
 * - Shortcuts disabled when focus is within text input with native undo
 */

import { useEffect, useCallback } from 'react'

interface UseUndoRedoShortcutsOptions {
  onUndo: () => void
  onRedo: () => void
  canUndo: boolean
  canRedo: boolean
}

/**
 * Check if the active element is a text input element with native undo behavior
 */
function isTextInputElement(target: EventTarget | null): boolean {
  // Ensure target is an Element (not Document, Window, etc.)
  if (!target || !(target instanceof Element)) return false

  const element = target

  // Check for input elements with text input types
  if (element.tagName === 'INPUT') {
    const inputElement = element as HTMLInputElement
    const textInputTypes = ['text', 'password', 'email', 'search', 'tel', 'url', 'number']
    return textInputTypes.includes(inputElement.type)
  }

  // Check for textarea
  if (element.tagName === 'TEXTAREA') {
    return true
  }

  // Check for contenteditable
  if (element.getAttribute('contenteditable') === 'true' || (element as HTMLElement).isContentEditable) {
    return true
  }

  return false
}

export function useUndoRedoShortcuts({
  onUndo,
  onRedo,
  canUndo,
  canRedo,
}: UseUndoRedoShortcutsOptions): void {
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      // Skip if focus is in text input element
      if (isTextInputElement(event.target)) return

      const key = event.key.toLowerCase()
      const isModifierKey = event.ctrlKey || event.metaKey
      const isShiftKey = event.shiftKey
      const isAltKey = event.altKey

      // Skip if Alt is pressed (not a valid undo/redo shortcut)
      if (isAltKey) return

      // Skip if no modifier key
      if (!isModifierKey) return

      // Redo: Ctrl/Cmd + Shift + Z or Ctrl + Y
      if ((key === 'z' && isShiftKey) || (key === 'y' && !isShiftKey && event.ctrlKey)) {
        if (canRedo) {
          event.preventDefault()
          onRedo()
        }
        return
      }

      // Undo: Ctrl/Cmd + Z (without Shift)
      if (key === 'z' && !isShiftKey) {
        if (canUndo) {
          event.preventDefault()
          onUndo()
        }
      }
    },
    [onUndo, onRedo, canUndo, canRedo]
  )

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [handleKeyDown])
}
