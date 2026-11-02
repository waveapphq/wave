/**
 * The script editors' keys as the Edit value sheet hosts them: the real host editor, its basic setup on, each mode's
 * bundle on top, so a basic-setup binding that shadows a script key fails here.
 *
 * REQ-3.4.1.2, REQ-3.4.1.6, REQ-3.3.2.6; PYRUN-13, SQL-10, OS-12
 */

import { describe, it, expect } from 'vitest'
import { act, render } from '@testing-library/react'
import type { Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

import { StringCodeMirror } from '@/components/shared/variable-bodies/string-code-mirror'
import type { ResolvedFormat } from '@/lib/codemirror/format-editor'
import { buildPythonModeExtensions } from '@/features/workbench/lib/codemirror/python-mode'
import { buildSqlModeExtensions } from '@/features/workbench/lib/codemirror/sql-mode'
import { buildDqlModeExtensions } from '@/features/workbench/lib/codemirror/dql-mode'
import { buildQueryDslModeExtensions } from '@/features/workbench/lib/codemirror/query-dsl-mode'

interface ScriptEditor {
  name: string
  format: ResolvedFormat
  extensions: () => Extension[]
}

const SCRIPT_EDITORS: ScriptEditor[] = [
  { name: 'Python', format: 'python', extensions: () => buildPythonModeExtensions({ issues: [] }) },
  {
    name: 'SQL',
    format: 'sql',
    extensions: () => buildSqlModeExtensions({ databaseType: 'postgresql', issues: [] }),
  },
  { name: 'DQL', format: 'dql', extensions: () => buildDqlModeExtensions({ issues: [] }) },
  {
    name: 'Query DSL',
    format: 'query-dsl',
    extensions: () => buildQueryDslModeExtensions({ issues: [] }),
  },
]

const DOC = 'first\nsecond\nthird'

/** The host the sheet renders a script body in; the editor view is read back from its DOM. */
function mountHost(options: { format?: ResolvedFormat; extensions?: Extension[]; doc?: string }) {
  const { container } = render(
    <div style={{ position: 'relative', height: 300 }}>
      <StringCodeMirror
        value={options.doc ?? DOC}
        onChange={() => {}}
        format={options.format}
        extraExtensions={options.extensions}
      />
    </div>,
  )
  const editor = container.querySelector('.cm-editor')
  if (!(editor instanceof HTMLElement)) throw new Error('the host rendered no editor')
  const view = EditorView.findFromDOM(editor)
  if (!view) throw new Error('the host editor has no view')
  return view
}

/** A real keydown, so every keymap the host installs sees it in its precedence order. */
function press(
  target: HTMLElement,
  key: string,
  keyCode: number,
  modifiers: { ctrlKey?: boolean } = {},
): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers })
  Object.defineProperty(event, 'keyCode', { get: () => keyCode })
  // An edit reaches the host's draft state.
  act(() => {
    target.dispatchEvent(event)
  })
  return event
}

const ctrlG = (view: EditorView) => press(view.contentDOM, 'g', 71, { ctrlKey: true })
const ctrlF = (view: EditorView) => press(view.contentDOM, 'f', 70, { ctrlKey: true })

const gotoLinePrompt = (view: EditorView) => view.dom.querySelector('.cm-goto-line')
const findPanel = (view: EditorView) => view.dom.querySelector('.cm-search')

describe.each(SCRIPT_EDITORS)('the $name editor in the sheet host', ({ format, extensions }) => {
  it("opens Go to line on Ctrl+G, holding the cursor's line, and not the find panel", () => {
    const view = mountHost({ format, extensions: extensions() })
    view.dispatch({ selection: { anchor: view.state.doc.line(2).from } })

    const event = ctrlG(view)

    expect(event.defaultPrevented).toBe(true)
    expect(gotoLinePrompt(view)).not.toBeNull()
    expect(gotoLinePrompt(view)?.querySelector<HTMLInputElement>('input[name=line]')?.value).toBe('2')
    expect(findPanel(view)).toBeNull()
  })

  it('opens find and replace on Ctrl+F and closes it on Escape', () => {
    const view = mountHost({ format, extensions: extensions() })

    ctrlF(view)
    const field = findPanel(view)?.querySelector<HTMLInputElement>('input[name=search]')
    expect(field).toBeInstanceOf(HTMLInputElement)

    press(field as HTMLInputElement, 'Escape', 27)
    expect(findPanel(view)).toBeNull()
  })
})

describe.each([
  { name: 'Python', format: 'python' as const, extensions: SCRIPT_EDITORS[0].extensions, commented: '# a = 1' },
  { name: 'SQL', format: 'sql' as const, extensions: SCRIPT_EDITORS[1].extensions, commented: '-- a = 1' },
])('the $name editor in the sheet host - Ctrl+/', ({ format, extensions, commented }) => {
  it("comments the line with the language's own token", () => {
    const view = mountHost({ format, extensions: extensions(), doc: 'a = 1' })

    press(view.contentDOM, '/', 191, { ctrlKey: true })

    expect(view.state.doc.toString()).toBe(commented)
  })
})

// A plain Edit value sheet has no script keymap: the basic setup's own keys stay.
describe('a plain editor in the sheet host', () => {
  it('keeps the basic setup find next on Ctrl+G, which opens the find panel', () => {
    const view = mountHost({})

    ctrlG(view)

    expect(findPanel(view)).not.toBeNull()
    expect(gotoLinePrompt(view)).toBeNull()
  })
})
