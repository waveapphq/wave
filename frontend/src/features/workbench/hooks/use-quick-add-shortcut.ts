/**
 * useQuickAddShortcut (REQ-4.2.5, CANVAS-223): Ctrl+Space toggles the
 * quick-add popover. Bound to Ctrl (not Cmd) on every platform because
 * Cmd+Space is macOS Spotlight. Suppressed inside editable elements and
 * while disabled (read-only / executing canvas).
 */

import { useEffect, useState } from 'react'

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return true
  const contentEditable = target.getAttribute('contenteditable')
  return contentEditable !== null && contentEditable !== 'false'
}

export function useQuickAddShortcut({ disabled }: { disabled: boolean }): {
  isOpen: boolean
  setIsOpen: (open: boolean) => void
} {
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    if (disabled) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.key !== ' ') return
      if (event.metaKey) return
      if (isEditableTarget(event.target)) return
      event.preventDefault()
      setIsOpen((prev) => !prev)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [disabled])

  return { isOpen, setIsOpen }
}
