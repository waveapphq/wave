/**
 * The base bundle every script body of the "Edit value" sheet builds on; each mode adds its language (PYRUN-13, SQL-10).
 */

import { closeBrackets, completionKeymap } from '@codemirror/autocomplete'
import { indentWithTab, toggleComment } from '@codemirror/commands'
import { bracketMatching } from '@codemirror/language'
import {
  closeSearchPanel,
  findNext,
  findPrevious,
  gotoLine,
  openSearchPanel,
  search,
} from '@codemirror/search'
import { Prec, type Extension } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, highlightActiveLine, keymap } from '@codemirror/view'

import {
  autocompleteDropdownTheme,
  scriptEditorTheme,
  tooltipHostReset,
} from '@/features/workbench/lib/codemirror/expression-theme'
import { unknownVariableMark } from '@/features/workbench/lib/codemirror/expression-decorations'
import {
  isScriptWarning,
  type ScriptIssue,
} from '@/features/workbench/lib/python-script-validation/script-issues'

/** Ctrl+D select-next-occurrence is left out on purpose: multi-cursor is not offered. */
const scriptKeymap = keymap.of([
  indentWithTab,
  { key: 'Mod-/', run: toggleComment },
  { key: 'Mod-f', run: openSearchPanel, scope: 'editor search-panel' },
  { key: 'F3', run: findNext, shift: findPrevious, scope: 'editor search-panel', preventDefault: true },
  { key: 'Escape', run: closeSearchPanel, scope: 'editor search-panel' },
  ...completionKeymap,
])

// Above the host's basic setup, whose search keymap binds Mod-g to find next.
const gotoLineKeymap = Prec.high(keymap.of([{ key: 'Mod-g', run: gotoLine }]))

// A row's detail (types, a signature) reads upright in mono, as the SQL catalog's column line does.
const completionDetailTheme = EditorView.theme({
  '.cm-completionDetail': {
    fontStyle: 'normal',
    fontFamily: 'ui-monospace, SFMono-Regular, monospace',
  },
})

export function buildScriptBodyExtensions(): Extension[] {
  return [
    scriptEditorTheme,
    autocompleteDropdownTheme,
    completionDetailTheme,
    // The body parents its tooltips to <body>; without this the host CodeMirror puts there scrolls the page.
    tooltipHostReset,
    highlightActiveLine(),
    bracketMatching(),
    closeBrackets(),
    search(),
    scriptKeymap,
    gotoLineKeymap,
  ]
}

// The lucide Database icon, painted in the row's own color through a mask.
const DATABASE_ICON_URL = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="black" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/>' +
    '<path d="M3 12A9 3 0 0 0 21 12"/></svg>',
)}")`

/** The Database icon in CodeMirror's completion icon slot of every row of `type`: a row that starts a catalog pull. */
export function databaseIconTheme(type: string): Extension {
  return EditorView.theme({
    [`.cm-completionIcon-${type}`]: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
    },
    [`.cm-completionIcon-${type}::after`]: {
      content: '""',
      flexShrink: '0',
      width: '14px',
      height: '14px',
      backgroundColor: 'currentColor',
      mask: `${DATABASE_ICON_URL} center / contain no-repeat`,
    },
  })
}

/** Every warning of a body is underlined amber over its own span; nothing is ever red. */
export function warningHighlighter(issues: readonly ScriptIssue[]): Extension {
  const warnings = issues.filter(isScriptWarning)
  return EditorView.decorations.compute(['doc'], (state) =>
    Decoration.set(
      warnings.flatMap((warning) => {
        const to = Math.min(warning.to, state.doc.length)
        return warning.from < to ? [unknownVariableMark.range(warning.from, to)] : []
      }),
      true,
    ),
  )
}

/** Holds the editor view while it is mounted, null after it is destroyed. */
export function viewRefPlugin(viewRef: { current: EditorView | null }): Extension {
  return ViewPlugin.define((view) => {
    viewRef.current = view
    return {
      destroy: () => {
        viewRef.current = null
      },
    }
  })
}

/** Replaces the main selection with `text` and leaves the cursor after it; null does nothing. */
export function insertAtCursor(view: EditorView | null, text: string): void {
  if (!view) return
  const { from, to } = view.state.selection.main
  view.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: from + text.length },
    scrollIntoView: true,
  })
}
