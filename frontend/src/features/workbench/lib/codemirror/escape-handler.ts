/**
 * Global Escape Key Handler for CodeMirror Editors
 *
 * Solves a fundamental conflict between CodeMirror and Radix Dialog:
 * Radix registers its Escape handler with document.addEventListener('keydown', handler, { capture: true })
 * inside useEffect. This fires BEFORE CodeMirror's bubble-phase handlers, causing dialogs to close
 * when the user only wants to close the autocomplete dropdown.
 *
 * Solution: Register a SINGLE capture-phase listener at module import time (before any React component
 * mounts). Individual CodeMirror editors register/deregister handler callbacks dynamically. The global
 * listener is always first because it's registered before Radix's useEffect runs.
 */

type EscapeHandler = (e: KeyboardEvent) => boolean

const handlers = new Set<EscapeHandler>()

// Registered at module load time - guaranteed before any React/Radix effects
document.addEventListener(
  'keydown',
  (e) => {
    if (e.key !== 'Escape') return
    for (const handler of handlers) {
      if (handler(e)) {
        e.stopImmediatePropagation()
        e.preventDefault()
        return
      }
    }
  },
  { capture: true }
)

/**
 * Register an Escape key handler. The handler should return true if it
 * handled the event (preventing further handlers and Radix from seeing it).
 * Returns an unregister function.
 */
export function registerEscapeHandler(handler: EscapeHandler): () => void {
  handlers.add(handler)
  return () => {
    handlers.delete(handler)
  }
}
