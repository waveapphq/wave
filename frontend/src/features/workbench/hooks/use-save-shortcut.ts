/**
 * useSaveShortcut Hook
 *
 * Cmd/Ctrl+S saves the currently-open Test, mirroring the Save button.
 * Intercepts the browser's native save dialog (preventDefault) so the
 * shortcut always routes to the workbench save handler, including while
 * focus is in a canvas text input. Disabled on read-only (historical)
 * canvases where there is nothing to persist.
 */

import { useEffect, useCallback } from 'react'

interface UseSaveShortcutOptions {
  onSave: () => void
  disabled?: boolean
}

export function useSaveShortcut({ onSave, disabled = false }: UseSaveShortcutOptions): void {
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (disabled) return
      const isModifierKey = event.ctrlKey || event.metaKey
      if (!isModifierKey || event.shiftKey || event.altKey) return
      if (event.key.toLowerCase() !== 's') return
      event.preventDefault()
      onSave()
    },
    [onSave, disabled],
  )

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [handleKeyDown])
}
