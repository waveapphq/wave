/**
 * The script editor base bundle every script body of the "Edit value" sheet builds on: the facilities, the shared
 * keymap, the body-parented tooltip reset, the amber warning underlines, the view reference and insert at cursor.
 *
 * REQ-3.4.1.2, REQ-3.4.1.6, REQ-3.3.2.6; PYRUN-13, PYRUN-18, SQL-10, SQL-12
 */

import { describe, it, expect, afterEach } from 'vitest'
import { EditorSelection, EditorState, type Extension } from '@codemirror/state'
import {
  EditorView,
  keymap,
  lineNumbers,
  showTooltip,
  tooltips,
  type Command,
  type KeyBinding,
} from '@codemirror/view'
import { startCompletion } from '@codemirror/autocomplete'
import { indentLess, indentMore } from '@codemirror/commands'
import { language } from '@codemirror/language'
import { closeSearchPanel, findNext, findPrevious, gotoLine, openSearchPanel } from '@codemirror/search'

import {
  buildScriptBodyExtensions,
  insertAtCursor,
  viewRefPlugin,
  warningHighlighter,
} from '@/features/workbench/lib/codemirror/script-body'
import type {
  ScriptIssue,
  ScriptWarning,
} from '@/features/workbench/lib/python-script-validation/script-issues'

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

// A language's line comment token, as the host's language would supply it.
const SLASH_COMMENTS = EditorState.languageData.of(() => [{ commentTokens: { line: '//' } }])

function stateFor(doc: string, extra: Extension[] = []): EditorState {
  return EditorState.create({ doc, extensions: [buildScriptBodyExtensions(), ...extra] })
}

function mount(
  doc: string,
  options: {
    selection?: { anchor: number; head: number }
    extra?: Extension[]
    base?: boolean
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
      ...(options.base === false ? [] : [buildScriptBodyExtensions()]),
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

function commandsFor(state: EditorState, key: string): (Command | undefined)[] {
  return bindingsOf(state)
    .filter((binding) => binding.key === key)
    .map((binding) => binding.run)
}

/** Ctrl+Space carries either spelling; both mean Ctrl on this platform. */
function completionBinding(state: EditorState): KeyBinding | undefined {
  return bindingsOf(state).find(
    (binding) => binding.key === 'Ctrl-Space' || binding.key === 'Mod-Space',
  )
}

/** A real keydown on the editor content, so the view's own handlers see it. */
function pressKey(view: EditorView, key: string, keyCode: number, shiftKey = false): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true })
  Object.defineProperty(event, 'keyCode', { get: () => keyCode })
  view.contentDOM.dispatchEvent(event)
  return event
}

function markedText(view: EditorView, selector: string): string[] {
  return Array.from(view.dom.querySelectorAll(selector)).map((element) => element.textContent ?? '')
}

const amber = (view: EditorView) => markedText(view, '.cm-unknown-variable')
const red = (view: EditorView) => markedText(view, '.cm-invalid-function')

function warning(line: number, from: number, to: number): ScriptWarning {
  return { line, message: 'm', severity: 'warning', from, to }
}

/** The base bundle with the amber underlines of `issues` on top, as a mode composes them. */
function mountWarnings(doc: string, issues: readonly ScriptIssue[]): EditorView {
  return mount(doc, { extra: [warningHighlighter(issues)] })
}

/** What the sheet loads around the bundle: body-parented tooltips and a provider,
 *  without which CodeMirror never instantiates its tooltip plugin. */
const bodyTooltips: Extension[] = [
  tooltips({ parent: document.body, position: 'fixed' }),
  showTooltip.of(null),
]

/** The <div> CodeMirror appends to <body> when its tooltips are parented there. */
function bodyTooltipHost(before: readonly Element[]): HTMLElement {
  const added = Array.from(document.body.children).filter((node) => !before.includes(node))
  const host = added.find((node) => !node.querySelector('.cm-editor'))
  if (!host) throw new Error('no body-level tooltip host was created')
  return host as HTMLElement
}

// ============================================
// Editor facilities
// ============================================

describe('buildScriptBodyExtensions - editor facilities', () => {
  it('builds extensions an EditorState accepts', () => {
    expect(Array.isArray(buildScriptBodyExtensions())).toBe(true)
    expect(() => stateFor('a = 1')).not.toThrow()
  })

  it('carries no language of its own: each mode adds its own', () => {
    expect(stateFor('a = 1').facet(language)).toBeNull()
  })

  it('highlights the active line', () => {
    const view = mount('first\nsecond', { selection: { anchor: 0, head: 0 } })
    const active = view.dom.querySelectorAll('.cm-activeLine')

    expect(active.length).toBe(1)
    expect(active[0].textContent).toBe('first')
  })

  it('marks the bracket matching the one at the cursor', () => {
    const view = mount('x = (1)', { selection: { anchor: 5, head: 5 } })

    expect(view.dom.querySelectorAll('.cm-matchingBracket').length).toBe(2)
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

  // The host composes the suggestion list; a second autocompletion would open two lists.
  it('adds no autocompletion of its own', () => {
    const view = mount('a = 1')

    expect(startCompletion(view)).toBe(false)
  })

  it('adds no line-number gutter of its own', () => {
    const view = mount('a = 1\nb = 2')

    expect(view.dom.querySelectorAll('.cm-lineNumbers').length).toBe(0)
  })

  // The sheet host renders the line numbers; a second gutter reads as doubled numbers.
  it('numbers every line exactly once beside the host gutter', () => {
    const view = mount('a = 1\nb = 2\nc = 3', { extra: [lineNumbers()] })
    const gutters = view.dom.querySelectorAll('.cm-lineNumbers')

    expect(gutters.length).toBe(1)
    // The first element of a stock line-number gutter is its width spacer.
    const numbers = Array.from(gutters[0].querySelectorAll('.cm-gutterElement'))
      .map((element) => element.textContent)
      .filter((text) => text !== '')

    expect(numbers.slice(-3)).toEqual(['1', '2', '3'])
  })
})

// ============================================
// Keymap
// ============================================

describe('buildScriptBodyExtensions - keymap', () => {
  it('opens find and replace on Ctrl+F', () => {
    expect(bindingFor(stateFor('a = 1'), 'Mod-f')?.run).toBe(openSearchPanel)
  })

  it('goes to line on Ctrl+G', () => {
    expect(bindingFor(stateFor('a = 1'), 'Mod-g')?.run).toBe(gotoLine)
  })

  it('opens autocomplete on Ctrl+Space', () => {
    expect(completionBinding(stateFor('a = 1'))?.run).toBe(startCompletion)
  })

  it('finds the next match on F3 and the previous one on Shift+F3', () => {
    const state = stateFor('a = 1')
    const f3 = bindingFor(state, 'F3')
    const previous = [f3?.shift, ...commandsFor(state, 'Shift-F3')]

    expect(f3?.run).toBe(findNext)
    expect(previous).toContain(findPrevious)
  })

  it('closes the search panel on Escape', () => {
    expect(commandsFor(stateFor('a = 1'), 'Escape')).toContain(closeSearchPanel)
  })

  it('indents with Tab and outdents with Shift+Tab', () => {
    const tab = bindingFor(stateFor('a = 1'), 'Tab')

    expect(tab?.run).toBe(indentMore)
    expect(tab?.shift).toBe(indentLess)
  })

  it('does not offer select-next-occurrence', () => {
    const keys = bindingsOf(stateFor('a = 1')).map((binding) => binding.key)

    expect(keys).not.toContain('Mod-d')
  })

  it("comments the line with the language's own token on Ctrl+/", () => {
    const view = mount('a = 1', { selection: { anchor: 0, head: 0 }, extra: [SLASH_COMMENTS] })
    const binding = bindingFor(view.state, 'Mod-/')

    expect(binding?.run?.(view)).toBe(true)
    expect(view.state.doc.toString()).toBe('// a = 1')
  })

  it('removes the comment on a second Ctrl+/', () => {
    const view = mount('a = 1', { selection: { anchor: 0, head: 0 }, extra: [SLASH_COMMENTS] })
    const binding = bindingFor(view.state, 'Mod-/')

    binding?.run?.(view)
    expect(binding?.run?.(view)).toBe(true)
    expect(view.state.doc.toString()).toBe('a = 1')
  })
})

// ============================================
// Tab and the focus escape hatch
// ============================================

describe('buildScriptBodyExtensions - Tab handling', () => {
  it('indents at the cursor and keeps focus in the editor', () => {
    const view = mount('a = 1', { selection: { anchor: 0, head: 0 } })
    const event = pressKey(view, 'Tab', 9)

    expect(view.state.doc.toString()).toBe('  a = 1')
    expect(event.defaultPrevented).toBe(true)
  })

  it('outdents at the cursor and keeps focus in the editor', () => {
    const view = mount('  a = 1', { selection: { anchor: 4, head: 4 } })
    const event = pressKey(view, 'Tab', 9, true)

    expect(view.state.doc.toString()).toBe('a = 1')
    expect(event.defaultPrevented).toBe(true)
  })

  it('hands Tab back to the page after Escape, so focus can move on', () => {
    const view = mount('a = 1', { selection: { anchor: 0, head: 0 } })

    pressKey(view, 'Escape', 27)
    const tab = pressKey(view, 'Tab', 9)

    expect(view.state.doc.toString()).toBe('a = 1')
    expect(tab.defaultPrevented).toBe(false)
  })

  it('leaves Escape itself to the sheet when no completion list is open', () => {
    const view = mount('a = 1', { selection: { anchor: 0, head: 0 } })
    const escape = pressKey(view, 'Escape', 27)

    expect(escape.defaultPrevented).toBe(false)
  })
})

// ============================================
// Body-parented tooltip host
// ============================================

describe('buildScriptBodyExtensions - body-parented tooltip host', () => {
  it('collapses the host CodeMirror appends to the page body', () => {
    const before = Array.from(document.body.children)
    mount('a = 1', { extra: bodyTooltips })

    const host = bodyTooltipHost(before)
    expect(host.matches('.cm-editor')).toBe(false)
    expect(parseFloat(getComputedStyle(host).height)).toBe(0)
    expect(parseFloat(getComputedStyle(host).minHeight)).toBe(0)
  })

  it('leaves the editor itself alone', () => {
    const before = Array.from(document.body.children)
    const view = mount('a = 1', { extra: bodyTooltips })

    expect(view.dom.matches('.cm-editor')).toBe(true)
    // The reset forces 0px; an untouched editor resolves to no height at all here.
    expect(getComputedStyle(view.dom).height).not.toBe('0px')
    // The host carries the editor's theme classes, minus cm-editor: that is how
    // an editor theme rule reaches it in the first place.
    expect(bodyTooltipHost(before).className.split(' ')).toEqual(
      view.dom.className.split(' ').filter((cls) => cls !== 'cm-editor'),
    )
  })
})

// ============================================
// Warning underlines
// ============================================

describe('warningHighlighter', () => {
  // Offsets: "SELECT id FROM ordrs" - "ordrs" is 15..20; line 2 "SET search_path TO x;" is 21..42.
  const script = 'SELECT id FROM ordrs\nSET search_path TO x;'

  it('underlines nothing when the script has no warnings', () => {
    const view = mountWarnings(script, [])

    expect(amber(view)).toEqual([])
    expect(red(view)).toEqual([])
  })

  it('underlines a warning span in amber, not its whole line', () => {
    const view = mountWarnings(script, [warning(1, 15, 20)])

    expect(amber(view)).toEqual(['ordrs'])
    expect(red(view)).toEqual([])
  })

  it('underlines every warning span, in document order', () => {
    const view = mountWarnings(script, [warning(2, 21, 42), warning(1, 15, 20)])

    expect(amber(view)).toEqual(['ordrs', 'SET search_path TO x;'])
    expect(red(view)).toEqual([])
  })

  it('underlines a warning that sits inside another one', () => {
    // "SET x = :v;" is flagged whole, and ":v" (8..10) on its own.
    const view = mountWarnings('SET x = :v;', [warning(1, 0, 11), warning(1, 8, 10)])

    expect(amber(view)).toContain(':v')
    expect(amber(view).join('')).toContain('SET x = ')
    expect(amber(view).join('')).toContain(';')
    expect(red(view)).toEqual([])
  })

  it('marks nothing for a line-0 warning', () => {
    expect(amber(mountWarnings(script, [warning(0, 0, 0)]))).toEqual([])
  })

  it('marks nothing for an empty span', () => {
    expect(amber(mountWarnings(script, [warning(1, 15, 15)]))).toEqual([])
  })

  it('drops a span that starts past the end of the script', () => {
    expect(amber(mountWarnings(script, [warning(9, 90, 99)]))).toEqual([])
  })

  it('keeps a span running past the end inside the script, or drops it', () => {
    const view = mountWarnings(script, [warning(2, 21, 99)])

    expect([['SET search_path TO x;'], []]).toContainEqual(amber(view))
  })

  it('never paints red, even for a syntax error entry', () => {
    const view = mountWarnings(script, [{ line: 1, message: 'Syntax error' }])

    expect(red(view)).toEqual([])
    expect(amber(view)).toEqual([])
  })

  it('underlines the warnings of a mixed list and skips its syntax entries', () => {
    const view = mountWarnings(script, [{ line: 2, message: 'Syntax error' }, warning(1, 15, 20)])

    expect(amber(view)).toEqual(['ordrs'])
    expect(red(view)).toEqual([])
  })

  it('styles the amber mark in the script body', () => {
    const view = mountWarnings(script, [warning(1, 15, 20)])
    const mark = view.dom.querySelector('.cm-unknown-variable') as HTMLElement

    expect(getComputedStyle(mark).textDecorationColor).toBe('#f59e0b')
  })

  it('underlines the same span without the base bundle, so any body can carry it', () => {
    const view = mount(script, { base: false, extra: [warningHighlighter([warning(1, 15, 20)])] })

    expect(amber(view)).toEqual(['ordrs'])
  })
})

// ============================================
// View reference
// ============================================

describe('viewRefPlugin', () => {
  it('holds the view while it is mounted and null after it is destroyed', () => {
    const viewRef: { current: EditorView | null } = { current: null }
    const view = mount('a = 1', { extra: [viewRefPlugin(viewRef)] })

    expect(viewRef.current).toBe(view)

    views.splice(views.indexOf(view), 1)
    view.destroy()

    expect(viewRef.current).toBeNull()
  })

  it('points each reference at its own view', () => {
    const first: { current: EditorView | null } = { current: null }
    const second: { current: EditorView | null } = { current: null }
    const firstView = mount('a = 1', { extra: [viewRefPlugin(first)] })
    const secondView = mount('b = 2', { extra: [viewRefPlugin(second)] })

    expect(first.current).toBe(firstView)
    expect(second.current).toBe(secondView)
  })
})

// ============================================
// Insert at cursor
// ============================================

describe('insertAtCursor', () => {
  it('inserts the text at the cursor and leaves the cursor after it', () => {
    const view = mount('SELECT * FROM ', { selection: { anchor: 14, head: 14 } })

    insertAtCursor(view, 'orders')

    expect(view.state.doc.toString()).toBe('SELECT * FROM orders')
    expect(view.state.selection.main.empty).toBe(true)
    expect(view.state.selection.main.head).toBe(20)
  })

  it('inserts in the middle of the script', () => {
    const view = mount('SELECT * FROM  WHERE id = 1', { selection: { anchor: 14, head: 14 } })

    insertAtCursor(view, 'orders')

    expect(view.state.doc.toString()).toBe('SELECT * FROM orders WHERE id = 1')
    expect(view.state.selection.main.head).toBe(20)
  })

  it('replaces the selection', () => {
    const view = mount('SELECT * FROM tbl WHERE id = 1', { selection: { anchor: 14, head: 17 } })

    insertAtCursor(view, 'orders')

    expect(view.state.doc.toString()).toBe('SELECT * FROM orders WHERE id = 1')
    expect(view.state.selection.main.empty).toBe(true)
    expect(view.state.selection.main.head).toBe(20)
  })

  it('inserts a dotted field name whole', () => {
    const view = mount('log.level: ERROR and ', { selection: { anchor: 21, head: 21 } })

    insertAtCursor(view, 'service.name')

    expect(view.state.doc.toString()).toBe('log.level: ERROR and service.name')
    expect(view.state.selection.main.head).toBe(33)
  })

  it('does nothing without a view', () => {
    expect(() => insertAtCursor(null, 'orders')).not.toThrow()
  })
})

// ============================================
// Suggestion row detail (PYRUN-19, SQL-12, OS-12)
// ============================================

describe('buildScriptBodyExtensions - suggestion row detail', () => {
  it('draws a row detail upright in mono, like the catalog column line', () => {
    mount('SELECT 1')

    const css = [...document.querySelectorAll('style')].map((style) => style.textContent ?? '').join('\n')
    const rules = css.split('\n').filter((line) => line.includes(' .cm-completionDetail {'))

    expect(rules).toContainEqual(expect.stringContaining('font-style: normal'))
    expect(rules).toContainEqual(expect.stringContaining('font-family: ui-monospace'))
  })
})
