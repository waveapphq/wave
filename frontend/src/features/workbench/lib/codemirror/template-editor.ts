/**
 * Host-composed template extension builder: the {{expr}} autocomplete + keymap +
 * highlight + tooltip stack, extracted so both the Text Editor Modal and the
 * inspect-modal host can inject it into a shared CodeMirror editor. Feature-bound
 * (tree-sitter / expression-engine) - never built inside a components/shared body.
 *
 * REQ-3.1.3.11: Variable watching UI panel
 * REQ-3.1.3.13: Computed variables with expressions and runtime evaluation
 */

import { keymap, tooltips } from '@codemirror/view'
import { Prec } from '@codemirror/state'
import { completionStatus, startCompletion, acceptCompletion } from '@codemirror/autocomplete'
import type { CompletionSource } from '@codemirror/autocomplete'
import type { Extension } from '@codemirror/state'

import {
  expressionHighlightTheme,
  autocompleteDropdownTheme,
  tooltipHostReset,
} from '@/features/workbench/lib/codemirror/expression-theme'
import { suggestionList } from '@/features/workbench/lib/codemirror/suggestion-list'

export interface BuildTemplateExtensionsOptions {
  completionSource: CompletionSource
  templateHighlighter: Extension | null
  templateTooltip: Extension | null
  /** When set, autocomplete/validation tooltips are parented here (to escape a
   *  clipped container - the Text Editor Modal). Omit to keep tooltips inside the
   *  editor (the inspect watcher), which avoids a stray host <div> on <body>. */
  tooltipParent?: HTMLElement
}

/** Autocomplete + Ctrl/Cmd-Space + Tab keymaps + highlight/tooltip themes for
 *  {{expr}} template editing. The highlighter/tooltip are injected when present. */
export function buildTemplateExtensions({
  completionSource,
  templateHighlighter,
  templateTooltip,
  tooltipParent,
}: BuildTemplateExtensionsOptions): Extension[] {
  return [
    expressionHighlightTheme,
    autocompleteDropdownTheme,
    // Body-parent only when asked (the modal). position: 'fixed' positions the
    // tooltip elements in viewport coords; tooltipHostReset collapses the host.
    ...(tooltipParent
      ? [tooltipHostReset, tooltips({ parent: tooltipParent, position: 'fixed' })]
      : []),
    suggestionList({
      override: [completionSource],
      activateOnTyping: true,
    }),
    Prec.highest(keymap.of([
      { key: 'Ctrl-Space', run: (view) => { startCompletion(view); return true } },
      { key: 'Cmd-Space', run: (view) => { startCompletion(view); return true } },
      {
        key: 'Tab',
        /* v8 ignore next 7 - COV-JSDOM-015 */
        run: (view) => {
          if (completionStatus(view.state) === 'active') {
            acceptCompletion(view)
            return true
          }
          return false // fall through to normal Tab (indent)
        },
      },
    ])),
    ...(templateHighlighter ? [templateHighlighter] : []),
    ...(templateTooltip ? [templateTooltip] : []),
  ]
}
