/**
 * Plain-text editor extensions for the string inspect bodies: line numbers and
 * soft wrapping. No language or linting - a variable string is plain text, not
 * code. The editor fills its host (the watcher body) and scrolls past it; the
 * watcher's auto-fit initial height keeps the default to ~5 lines, and the user
 * can resize the watcher to grow it.
 */

import type { Extension } from '@codemirror/state'
import { EditorView, lineNumbers } from '@codemirror/view'

const LINE_HEIGHT_PX = 20
const CONTENT_PAD_Y = 6

export interface PlainTextEditorOptions {
  /** False for a code body: a script is not a string value, so it reads in the normal color. */
  valueColor?: boolean
}

export function createPlainTextEditorExtensions(
  { valueColor = true }: PlainTextEditorOptions = {},
): Extension[] {
  return [
    EditorView.lineWrapping,
    lineNumbers(),
    EditorView.theme({
      '&': {
        fontSize: '13px',
        fontFamily: 'ui-monospace, monospace',
        backgroundColor: 'transparent',
      },
      '.cm-content': {
        padding: `${CONTENT_PAD_Y}px 0`,
        // sky-300 - the string value color shared with the read body.
        ...(valueColor ? { color: 'rgb(125 211 252)' } : { color: 'var(--foreground)' }),
      },
      '.cm-line': { lineHeight: `${LINE_HEIGHT_PX}px`, padding: '0 8px' },
      '.cm-gutters': { backgroundColor: 'transparent', border: 'none' },
      '.cm-gutterElement': { lineHeight: `${LINE_HEIGHT_PX}px` },
      // A semi-transparent thumb reads on both the light and dark editor bg (the
      // global var(--color-bg-muted) thumb blends into the dark editor surface).
      '.cm-scroller': {
        overflowY: 'auto',
        // A wheel at the editor's end stays in the editor, never the page behind it.
        overscrollBehavior: 'contain',
        scrollbarWidth: 'thin',
        scrollbarColor: 'rgba(127, 127, 140, 0.55) transparent',
      },
      '.cm-scroller::-webkit-scrollbar': { width: '10px', height: '10px' },
      '.cm-scroller::-webkit-scrollbar-track': { background: 'transparent' },
      '.cm-scroller::-webkit-scrollbar-thumb': {
        backgroundColor: 'rgba(127, 127, 140, 0.55)',
        borderRadius: '5px',
        border: '2px solid transparent',
        backgroundClip: 'content-box',
      },
      '.cm-scroller::-webkit-scrollbar-thumb:hover': {
        backgroundColor: 'rgba(127, 127, 140, 0.85)',
      },
      '&.cm-focused': { outline: 'none' },
    }),
  ]
}
