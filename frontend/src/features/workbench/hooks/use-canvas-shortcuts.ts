/**
 * useCanvasShortcuts Hook
 *
 * REQ-4.2.5 Keyboard shortcuts for common operations
 *
 * Provides keyboard shortcuts for clipboard and edit operations on the canvas:
 * - Copy:       Ctrl+C / ⌘+C
 * - Cut:        Ctrl+X / ⌘+X
 * - Paste:      Ctrl+V / ⌘+V
 * - Duplicate:  Ctrl+D / ⌘+D
 * - Select All: Ctrl+A / ⌘+A
 * - Delete:     Delete (deletes selected nodes/edges)
 * - Disconnect: Backspace (disconnects selected nodes' edges)
 *
 * Focus guards prevent shortcuts from firing when the active element is a text
 * input (INPUT, TEXTAREA, SELECT, or contentEditable).
 */

import { useEffect, useCallback } from 'react'

interface UseCanvasShortcutsOptions {
  onCopy: () => void
  onCut: () => void
  onPaste: () => void
  onDuplicate: () => void
  onSelectAll: () => void
  onDelete?: () => void
  onDisconnect?: () => void
  hasSelection: boolean
  hasClipboard: boolean
  disabled?: boolean
}

/** Returns true when focus is in a text-input element that has native clipboard behavior. */
function isEditableElement(target: EventTarget | null): boolean {
  if (!target || !(target instanceof Element)) return false

  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true

  // Check contenteditable attribute: "" (React's contentEditable), "true", or "plaintext-only"
  const ce = target.getAttribute('contenteditable')
  if (ce !== null && ce !== 'false') return true

  return false
}

type ModifierShortcutSpec = {
  key: string
  callback: () => void
  enabled: boolean
}

function hasUnmodifiedKey(event: KeyboardEvent): boolean {
  return (
    !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey
  )
}

function handleBareKey(
  event: KeyboardEvent,
  hasSelection: boolean,
  onDelete: (() => void) | undefined,
  onDisconnect: (() => void) | undefined,
): boolean {
  if (!hasUnmodifiedKey(event) || !hasSelection) return false
  if (event.key === 'Delete' && onDelete) {
    event.preventDefault()
    onDelete()
    return true
  }
  if (event.key === 'Backspace' && onDisconnect) {
    event.preventDefault()
    onDisconnect()
    return true
  }
  return false
}

function isPureCtrlOrMeta(event: KeyboardEvent): boolean {
  if (!event.ctrlKey && !event.metaKey) return false
  return !event.altKey && !event.shiftKey
}

/** True when the user has a non-empty text selection (e.g. a copyable
 *  validation-strip error in an open sheet) that should own Ctrl+C / Ctrl+X. */
function hasActiveTextSelection(): boolean {
  return globalThis.getSelection()!.toString().trim().length > 0
}

export function useCanvasShortcuts({
  onCopy,
  onCut,
  onPaste,
  onDuplicate,
  onSelectAll,
  onDelete,
  onDisconnect,
  hasSelection,
  hasClipboard,
  disabled = false,
}: UseCanvasShortcutsOptions): void {
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (disabled) return
      if (isEditableElement(event.target)) return
      if (handleBareKey(event, hasSelection, onDelete, onDisconnect)) return
      if (!isPureCtrlOrMeta(event)) return

      const key = event.key.toLowerCase()
      // A live text selection (e.g. a copyable validation-strip error) owns
      // Ctrl+C / Ctrl+X; don't hijack it for node copy/cut.
      if ((key === 'c' || key === 'x') && hasActiveTextSelection()) return

      const specs: Record<string, ModifierShortcutSpec> = {
        c: { key: 'c', callback: onCopy, enabled: hasSelection },
        x: { key: 'x', callback: onCut, enabled: hasSelection },
        v: { key: 'v', callback: onPaste, enabled: hasClipboard },
        d: { key: 'd', callback: onDuplicate, enabled: hasSelection },
        a: { key: 'a', callback: onSelectAll, enabled: true },
      }
      const spec = specs[key]
      if (!spec?.enabled) return
      event.preventDefault()
      spec.callback()
    },
    [onCopy, onCut, onPaste, onDuplicate, onSelectAll, onDelete, onDisconnect, hasSelection, hasClipboard, disabled]
  )

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [handleKeyDown])
}
