/**
 * Shared hook for CodeMirror modal escape handling.
 *
 * The ExpressionEditorModal needs escape-key behavior where, while the editor is
 * focused, Escape closes autocomplete if open, otherwise triggers the modal's
 * close/discard flow.
 */

import { useEffect, useRef } from 'react'
import type { ReactCodeMirrorRef } from '@uiw/react-codemirror'
import { completionStatus, closeCompletion } from '@codemirror/autocomplete'
import { registerEscapeHandler } from '@/features/workbench/lib/codemirror/escape-handler'

/**
 * Register a capture-phase Escape handler for a CodeMirror editor inside a modal.
 *
 * When the editor is focused:
 * - If autocomplete is open, closes it
 * - Otherwise, calls `onEscapeClose` (typically the modal's tryClose)
 *
 * The handler is only active while `open` is true and auto-deregisters on
 * unmount or when the modal closes.
 *
 * @param open - Whether the modal is currently open
 * @param editorRef - Ref to the CodeMirror editor instance
 * @param onEscapeClose - Callback invoked when Escape should close the modal
 */
export function useModalEscapeHandler(
  open: boolean,
  editorRef: React.RefObject<ReactCodeMirrorRef | null>,
  onEscapeClose: () => void,
) {
  // Stable ref so the handler always calls the latest onEscapeClose
  const onEscapeCloseRef = useRef(onEscapeClose)
  onEscapeCloseRef.current = onEscapeClose

  useEffect(() => {
    if (!open) return
    return registerEscapeHandler((e) => {
      const view = editorRef.current?.view
      /* v8 ignore next - COV-DEF-102 */
      if (!view) return false
      if (!(e.target instanceof HTMLElement) || !view.dom.contains(e.target)) return false

      /* v8 ignore next 3 - COV-JSDOM-013 */
      if (completionStatus(view.state) === 'active') {
        closeCompletion(view)
      } else {
        onEscapeCloseRef.current()
      }
      return true
    })
  }, [open, editorRef])
}
