/**
 * Shared CodeMirror keymap builders for expression editors.
 *
 * Provides autocomplete navigation keybindings (ArrowUp/Down, PageUp/Down,
 * Tab accept, Ctrl+Space trigger) shared by both the inline ExpressionInput
 * and the full ExpressionEditorModal.
 */

import { keymap } from '@codemirror/view'
import { Prec } from '@codemirror/state'
import {
  completionStatus,
  acceptCompletion,
  moveCompletionSelection,
  startCompletion,
} from '@codemirror/autocomplete'
import type { KeyBinding } from '@codemirror/view'

/**
 * Core autocomplete navigation keybindings shared by all expression editors.
 *
 * Includes: ArrowDown/Up (scroll completion list), PageDown/Up (5-item jump),
 * Ctrl+Space / Cmd+Space (trigger autocomplete).
 *
 * Does NOT include Enter, Tab, Shift-Tab, or editor-specific bindings -
 * those differ between inline and modal editors.
 */
export function autocompleteNavigationKeys(): KeyBinding[] {
  return [
    {
      key: 'ArrowDown',
      run: (view) => {
        if (completionStatus(view.state) === 'active') {
          moveCompletionSelection(true)(view)
          return true
        }
        return false
      },
    },
    {
      key: 'ArrowUp',
      run: (view) => {
        if (completionStatus(view.state) === 'active') {
          moveCompletionSelection(false)(view)
          return true
        }
        return false
      },
    },
    {
      key: 'PageDown',
      run: (view) => {
        if (completionStatus(view.state) === 'active') {
          for (let i = 0; i < 5; i++) moveCompletionSelection(true)(view)
          return true
        }
        return false
      },
    },
    {
      key: 'PageUp',
      run: (view) => {
        if (completionStatus(view.state) === 'active') {
          for (let i = 0; i < 5; i++) moveCompletionSelection(false)(view)
          return true
        }
        return false
      },
    },
    {
      key: 'Ctrl-Space',
      mac: 'Cmd-Space',
      run: (view) => {
        startCompletion(view)
        return true
      },
    },
  ]
}

/**
 * Build the keymap for the single-line inline expression editor.
 *
 * Enter: accept completion or blur.
 * Tab: accept completion or block (stay in field).
 * Shift-Tab / Ctrl-Tab: blocked (no tab navigation out).
 * Ctrl+E / Cmd+E: open full editor (if callback provided).
 */
export function buildInlineExpressionKeymap(onOpenFullEditor?: () => void) {
  return Prec.highest(
    keymap.of([
      {
        key: 'Enter',
        run: (view) => {
          if (completionStatus(view.state) === 'active') {
            acceptCompletion(view)
          } else {
            view.contentDOM.blur()
          }
          return true
        },
      },
      ...autocompleteNavigationKeys(),
      {
        key: 'Tab',
        run: (view) => {
          if (completionStatus(view.state) === 'active') {
            acceptCompletion(view)
          }
          return true
        },
      },
      { key: 'Shift-Tab', run: () => true },
      { key: 'Ctrl-Tab', run: () => true },
      {
        key: 'Ctrl-e',
        mac: 'Cmd-e',
        run: (view) => {
          if (onOpenFullEditor) {
            // Blur the inline editor first. The full-editor Dialog is
            // about to mount and Radix will aria-hide everything outside
            // it - including this inline editor's ancestors. Leaving
            // focus on `.cm-content` inside that subtree trips the
            // browser's aria-hidden-with-focused-descendant warning.
            view.contentDOM.blur()
            onOpenFullEditor()
            return true
          }
          return false
        },
      },
    ])
  )
}

/**
 * Build the keymap for the modal expression editor.
 *
 * Enter: accept completion, or block newline in single-line mode.
 * Tab: accept completion; in multi-line mode allow indent, in single-line block.
 * Shift-Tab: block in single-line, allow in multi-line.
 *
 * Note: Ctrl+Enter (apply) and Escape are handled separately via DOM event
 * handlers and the global escape handler respectively - not via keymaps.
 */
export function buildModalExpressionKeymap(singleLine: boolean) {
  return Prec.highest(
    keymap.of([
      {
        key: 'Enter',
        run: (view) => {
          /* v8 ignore next 4 - COV-JSDOM-013 */
          if (completionStatus(view.state) === 'active') {
            acceptCompletion(view)
            return true
          }
          if (singleLine) return true // Block newline in single-line mode
          return false
        },
      },
      ...autocompleteNavigationKeys(),
      {
        key: 'Tab',
        run: (view) => {
          /* v8 ignore next 4 - COV-JSDOM-013 */
          if (completionStatus(view.state) === 'active') {
            acceptCompletion(view)
            return true
          }
          return !singleLine // In multi-line, let Tab insert indent; in single-line, block it
        },
      },
      {
        key: 'Shift-Tab',
        run: () => !singleLine, // Block in single-line mode
      },
    ])
  )
}
