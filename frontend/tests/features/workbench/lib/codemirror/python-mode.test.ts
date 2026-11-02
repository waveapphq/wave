/**
 * Python-mode CodeMirror bundle for the script body of the "Edit value" sheet.
 *
 * Contract under test (PYRUN-13, PYRUN-18):
 *   - the editor facilities are wired: indent on input, a 4-space indent unit,
 *     Tab / Shift+Tab on the selection, close brackets, bracket matching,
 *     fold gutter, line numbers, active-line highlight, selection-match highlight
 *   - Ctrl+/ comments with # (the shared script keymap, Tab and the tooltip
 *     host reset are covered in script-body.test.ts)
 *   - a {line, message} issue list underlines exactly those lines
 *   - a check warning underlines its own span with the expression field's mark:
 *     amber for an unknown variable, red for anything else
 *
 * REQ-3.4.1.2: Python script execution
 * REQ-3.4.2.2: Plugin parameter definition
 */

import { describe, it, expect, afterEach } from 'vitest'
import { EditorSelection, EditorState, type Extension } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, type KeyBinding } from '@codemirror/view'
import { indentService, indentUnit } from '@codemirror/language'

import { buildPythonModeExtensions } from '@/features/workbench/lib/codemirror/python-mode'
import type { ScriptIssue } from '@/features/workbench/lib/python-script-validation/script-issues'
import type { PythonScriptWarning } from '@/features/workbench/lib/python-script-validation/check-script'

// ============================================
// Test Helpers
// ============================================

const views: EditorView[] = []
const parents: HTMLElement[] = []

afterEach(() => {
  for (const view of views) {
    view.destroy()
  }
  views.length = 0
  for (const parent of parents) {
    parent.remove()
  }
  parents.length = 0
})

function stateFor(doc: string): EditorState {
  return EditorState.create({ doc, extensions: buildPythonModeExtensions({ issues: [] }) })
}

function mount(
  doc: string,
  options: {
    issues?: ScriptIssue[]
    selection?: { anchor: number; head: number }
    extra?: Extension[]
  } = {},
): EditorView {
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  const state = EditorState.create({
    doc,
    selection: options.selection
      ? EditorSelection.single(options.selection.anchor, options.selection.head)
      : undefined,
    extensions: [
      buildPythonModeExtensions({ issues: options.issues ?? [] }),
      ...(options.extra ?? []),
    ],
  })
  const view = new EditorView({ state, parent })
  views.push(view)
  parents.push(parent)
  return view
}

function bindingsOf(state: EditorState): KeyBinding[] {
  return state.facet(keymap).flat()
}

function bindingFor(state: EditorState, key: string): KeyBinding | undefined {
  return bindingsOf(state).find((binding) => binding.key === key)
}

function underlinedText(view: EditorView, mark = '.cm-invalid-function'): string[] {
  return Array.from(view.dom.querySelectorAll(mark)).map((element) => element.textContent ?? '')
}

// ============================================
// Editor facilities (PYRUN-18)
// ============================================

describe('buildPythonModeExtensions', () => {
  it('builds extensions an EditorState accepts', () => {
    expect(Array.isArray(buildPythonModeExtensions({ issues: [] }))).toBe(true)
    expect(() => stateFor('a = 1')).not.toThrow()
  })

  it('uses a 4-space indent unit', () => {
    expect(stateFor('a = 1').facet(indentUnit)).toBe('    ')
  })

  it('indents every selected line with Tab', () => {
    const view = mount('a = 1\nb = 2', { selection: { anchor: 0, head: 11 } })
    const tab = bindingFor(view.state, 'Tab')

    expect(tab).toBeDefined()
    expect(tab?.run?.(view)).toBe(true)
    expect(view.state.doc.toString()).toBe('    a = 1\n    b = 2')
  })

  it('outdents every selected line with Shift+Tab', () => {
    const view = mount('    a = 1\n    b = 2', { selection: { anchor: 0, head: 19 } })
    const tab = bindingFor(view.state, 'Tab')

    expect(tab?.shift).toBeDefined()
    expect(tab?.shift?.(view)).toBe(true)
    expect(view.state.doc.toString()).toBe('a = 1\nb = 2')
  })

  it('re-indents a line as it is typed', () => {
    const doc = 'if x:\n    pass\n  else'
    const view = mount(doc, {
      extra: [
        EditorState.languageData.of(() => [{ indentOnInput: /^\s*else:$/ }]),
        indentService.of(() => 4),
      ],
    })

    view.dispatch({
      changes: { from: doc.length, to: doc.length, insert: ':' },
      selection: { anchor: doc.length + 1 },
      userEvent: 'input.type',
    })

    expect(view.state.doc.toString()).toBe('if x:\n    pass\n    else:')
  })

  it('closes a bracket as it is typed', () => {
    const view = mount('', { selection: { anchor: 0, head: 0 } })
    const handlers = view.state.facet(EditorView.inputHandler)

    expect(handlers.length).toBeGreaterThan(0)
    const handled = handlers.some((handler) =>
      handler(view, 0, 0, '(', () =>
        view.state.update({ changes: { from: 0, to: 0, insert: '(' } }),
      ),
    )

    expect(handled).toBe(true)
    expect(view.state.doc.toString()).toBe('()')
  })

  it('marks the bracket matching the one at the cursor', () => {
    const view = mount('x = (1)', { selection: { anchor: 5, head: 5 } })

    expect(view.dom.querySelectorAll('.cm-matchingBracket').length).toBe(2)
  })

  it('renders a fold gutter', () => {
    const view = mount('def f():\n    return 1')

    expect(view.dom.querySelectorAll('.cm-foldGutter').length).toBe(1)
  })

  // The sheet host already renders line numbers, so the bundle must not add a
  // second gutter: two of them read as doubled numbers on screen (PYRUN-13).
  it('numbers every line exactly once beside the host gutter (PYRUN-13)', () => {
    const view = mount('a = 1\nb = 2\nc = 3', { extra: [lineNumbers()] })
    const gutters = view.dom.querySelectorAll('.cm-lineNumbers')

    expect(gutters.length).toBe(1)
    // The first element of a stock line-number gutter is its width spacer.
    const numbers = Array.from(gutters[0].querySelectorAll('.cm-gutterElement'))
      .map((element) => element.textContent)
      .filter((text) => text !== '')

    expect(numbers.slice(-3)).toEqual(['1', '2', '3'])
  })

  it('adds no line-number gutter of its own', () => {
    const view = mount('a = 1\nb = 2')

    expect(view.dom.querySelectorAll('.cm-lineNumbers').length).toBe(0)
  })

  it('highlights the active line', () => {
    const view = mount('a = 1\nb = 2', { selection: { anchor: 0, head: 0 } })
    const active = view.dom.querySelectorAll('.cm-activeLine')

    expect(active.length).toBe(1)
    expect(active[0].textContent).toBe('a = 1')
  })

  it('highlights the other occurrences of the selection', () => {
    const view = mount('foo = 1\nbar = (foo)\nfoo = 2', { selection: { anchor: 0, head: 3 } })
    const matches = Array.from(view.dom.querySelectorAll('.cm-selectionMatch')).map(
      (element) => element.textContent,
    )

    expect(matches).toEqual(['foo', 'foo'])
  })
})

// ============================================
// Keymap (PYRUN-13, PYRUN-18): the shared script keymap is covered in script-body.test.ts
// ============================================

describe('python-mode keymap', () => {
  it('comments the line with # on Ctrl+/', () => {
    const view = mount('a = 1', { selection: { anchor: 0, head: 0 } })
    const binding = bindingFor(view.state, 'Mod-/')

    expect(binding).toBeDefined()
    expect(binding?.run?.(view)).toBe(true)
    expect(view.state.doc.toString()).toBe('# a = 1')
  })

  it('removes the # comment on a second Ctrl+/', () => {
    const view = mount('# a = 1', { selection: { anchor: 0, head: 0 } })
    const binding = bindingFor(view.state, 'Mod-/')

    expect(binding?.run?.(view)).toBe(true)
    expect(view.state.doc.toString()).toBe('a = 1')
  })
})

// ============================================
// Syntax issue underlines (PYRUN-13)
// ============================================

describe('python-mode syntax issue underlines', () => {
  const script = 'a = 1\nb = (\nc = 3\nd = )'

  it('underlines nothing when the script has no issues', () => {
    const view = mount(script)

    expect(underlinedText(view)).toEqual([])
  })

  it('underlines the line an issue names', () => {
    const view = mount(script, { issues: [{ line: 2, message: 'Unexpected token' }] })

    expect(underlinedText(view)).toEqual(['b = ('])
  })

  it('underlines every line an issue names, in document order', () => {
    const view = mount(script, {
      issues: [
        { line: 4, message: 'Unexpected token' },
        { line: 2, message: 'Unexpected token' },
      ],
    })

    expect(underlinedText(view)).toEqual(['b = (', 'd = )'])
  })

  it('ignores a line number outside the script', () => {
    const view = mount(script, {
      issues: [
        { line: 0, message: 'Unexpected token' },
        { line: 99, message: 'Unexpected token' },
      ],
    })

    expect(underlinedText(view)).toEqual([])
  })

  it('ignores an issue on an empty line', () => {
    const view = mount('a = 1\n\nc = 3', {
      issues: [{ line: 2, message: 'Unexpected token' }],
    })

    expect(underlinedText(view)).toEqual([])
  })
})

// ============================================
// Check warning underlines (PYRUN-13)
// ============================================

function warning(from: number, to: number, type: PythonScriptWarning['type']): PythonScriptWarning {
  return { line: 1, message: 'm', severity: 'warning', from, to, type }
}

describe('python-mode check warning underlines', () => {
  const script = "puts('x')\nprint(totl)"

  it('underlines a warning span, not its whole line', () => {
    const view = mount(script, { issues: [warning(0, 4, 'invalid_function')] })

    expect(underlinedText(view)).toEqual(['puts'])
  })

  it('underlines an unknown variable in amber and nothing in red', () => {
    const view = mount(script, { issues: [warning(16, 20, 'unknown_variable')] })

    expect(underlinedText(view, '.cm-unknown-variable')).toEqual(['totl'])
    expect(underlinedText(view)).toEqual([])
  })

  it('underlines syntax lines and warning spans together, in document order', () => {
    const view = mount(script, {
      issues: [warning(16, 20, 'unknown_variable'), { line: 1, message: 'Syntax error' }],
    })

    expect(underlinedText(view)).toEqual(["puts('x')"])
    expect(underlinedText(view, '.cm-unknown-variable')).toEqual(['totl'])
  })

  it('keeps a warning span inside the script and drops one that falls outside', () => {
    const view = mount(script, {
      issues: [warning(16, 99, 'unknown_variable'), warning(40, 44, 'invalid_function')],
    })

    expect(underlinedText(view, '.cm-unknown-variable')).toEqual(['totl)'])
    expect(underlinedText(view)).toEqual([])
  })

  it('styles both underline marks in the script body', () => {
    const view = mount(script, {
      issues: [warning(0, 4, 'invalid_function'), warning(16, 20, 'unknown_variable')],
    })
    const red = view.dom.querySelector('.cm-invalid-function') as HTMLElement
    const amber = view.dom.querySelector('.cm-unknown-variable') as HTMLElement

    expect(getComputedStyle(red).textDecorationColor).toBe('#ef4444')
    expect(getComputedStyle(amber).textDecorationColor).toBe('#f59e0b')
  })
})
