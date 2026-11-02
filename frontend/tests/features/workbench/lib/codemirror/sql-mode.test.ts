/**
 * The SQL-mode CodeMirror bundle of the "Edit value" sheet.
 *
 * REQ-3.4.1.6; SQL-10, SQL-11, SQL-12
 */

import { describe, it, expect, afterEach } from 'vitest'
import { EditorSelection, EditorState, type Extension } from '@codemirror/state'
import { Decoration, EditorView, keymap, lineNumbers, type KeyBinding } from '@codemirror/view'
import { startCompletion } from '@codemirror/autocomplete'
import { language } from '@codemirror/language'
import { MSSQL, MySQL, PLSQL, PostgreSQL, SQLite, type SQLDialect } from '@codemirror/lang-sql'

import { buildSqlModeExtensions, type SqlModeOptions } from '@/features/workbench/lib/codemirror/sql-mode'
import type { SqlDatabaseType } from '@/lib/codemirror/format-editor'
import {
  createTemplateHighlighter,
  expressionMark,
} from '@/features/workbench/lib/codemirror/expression-decorations'
import { expressionHighlightTheme } from '@/features/workbench/lib/codemirror/expression-theme'
import type {
  ScriptIssue,
  ScriptWarning,
} from '@/features/workbench/lib/python-script-validation/script-issues'

import { SAMPLE_SCRIPT } from '../../sql-fixtures'

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

function stateFor(doc: string, databaseType: SqlDatabaseType = 'postgresql'): EditorState {
  return EditorState.create({ doc, extensions: buildSqlModeExtensions({ databaseType, issues: [] }) })
}

function mount(
  doc: string,
  options: {
    databaseType?: SqlDatabaseType
    issues?: readonly ScriptIssue[]
    viewRef?: SqlModeOptions['viewRef']
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
      buildSqlModeExtensions({
        databaseType: options.databaseType ?? 'postgresql',
        issues: options.issues ?? [],
        viewRef: options.viewRef,
      }),
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

function markedText(view: EditorView, selector: string): string[] {
  return Array.from(view.dom.querySelectorAll(selector)).map((element) => element.textContent ?? '')
}

const placeholders = (view: EditorView) => markedText(view, '.cm-sql-placeholder')
const amber = (view: EditorView) => markedText(view, '.cm-unknown-variable')
const red = (view: EditorView) => markedText(view, '.cm-invalid-function')

/** An expression editor's view of `doc`, highlighted the way it highlights a variable. */
function mountExpression(doc: string): EditorView {
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  const view = new EditorView({
    state: EditorState.create({
      doc,
      extensions: [
        expressionHighlightTheme,
        EditorView.decorations.of(Decoration.set([expressionMark.range(0, doc.length)])),
      ],
    }),
    parent,
  })
  views.push(view)
  parents.push(parent)
  return view
}

/** The color every element of a mark computes, itself and anything nested in it. */
function colorsOf(mark: Element): string[] {
  return [mark, ...Array.from(mark.querySelectorAll('*'))].map((element) => getComputedStyle(element).color)
}

function warning(line: number, from: number, to: number): ScriptWarning {
  return { line, message: 'm', severity: 'warning', from, to }
}

// ============================================
// Dialect (SQL-10)
// ============================================

describe('buildSqlModeExtensions - dialect', () => {
  it('builds extensions an EditorState accepts', () => {
    expect(Array.isArray(buildSqlModeExtensions({ databaseType: 'postgresql', issues: [] }))).toBe(
      true,
    )
    expect(() => stateFor(SAMPLE_SCRIPT)).not.toThrow()
  })

  it.each<[SqlDatabaseType, SQLDialect]>([
    ['postgresql', PostgreSQL],
    ['mysql', MySQL],
    ['oracle', PLSQL],
    ['mssql', MSSQL],
    ['sqlite', SQLite],
  ])('loads the %s dialect language', (databaseType, dialect) => {
    expect(stateFor('SELECT 1', databaseType).facet(language)).toBe(dialect.language)
  })
})

// ============================================
// Editor facilities (SQL-10)
// ============================================

describe('buildSqlModeExtensions - editor facilities', () => {
  it('highlights the active line', () => {
    const view = mount('SELECT 1\nFROM orders', { selection: { anchor: 0, head: 0 } })
    const active = view.dom.querySelectorAll('.cm-activeLine')

    expect(active.length).toBe(1)
    expect(active[0].textContent).toBe('SELECT 1')
  })

  it('marks the bracket matching the one at the cursor', () => {
    const view = mount('SELECT (1)', { selection: { anchor: 8, head: 8 } })

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
    const view = mount('SELECT 1')

    expect(startCompletion(view)).toBe(false)
  })

  it('adds no line-number gutter of its own', () => {
    const view = mount('SELECT 1\nFROM orders')

    expect(view.dom.querySelectorAll('.cm-lineNumbers').length).toBe(0)
  })

  // The sheet host renders the line numbers; a second gutter reads as doubled numbers.
  it('numbers every line exactly once beside the host gutter', () => {
    const view = mount('SELECT 1\nFROM orders\nWHERE id = :id', { extra: [lineNumbers()] })
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
// Keymap (SQL-10): the shared script keymap is covered in script-body.test.ts
// ============================================

describe('sql-mode keymap', () => {
  it('comments the line with -- on Ctrl+/', () => {
    const view = mount('SELECT 1', { selection: { anchor: 0, head: 0 } })
    const binding = bindingFor(view.state, 'Mod-/')

    expect(binding?.run?.(view)).toBe(true)
    expect(view.state.doc.toString()).toBe('-- SELECT 1')
  })

  it('removes the -- comment on a second Ctrl+/', () => {
    const view = mount('SELECT 1', { selection: { anchor: 0, head: 0 } })
    const binding = bindingFor(view.state, 'Mod-/')

    binding?.run?.(view)
    expect(binding?.run?.(view)).toBe(true)
    expect(view.state.doc.toString()).toBe('SELECT 1')
  })
})

// ============================================
// Placeholders (SQL-2, SQL-10)
// ============================================

describe('sql-mode placeholders', () => {
  it('marks every :name placeholder of the script', () => {
    const view = mount(SAMPLE_SCRIPT)

    expect(placeholders(view)).toEqual([':customer', ':status'])
  })

  it('marks every use of a placeholder, in document order', () => {
    const view = mount('SELECT :a, :b\nWHERE x = :a')

    expect(placeholders(view)).toEqual([':a', ':b', ':a'])
  })

  it.each([
    ['a string', "SELECT 'a:b'"],
    ['a cast', 'SELECT x::int'],
    ['a line comment', 'SELECT 1 -- :c'],
    ['a block comment', 'SELECT 1 /* :c */'],
    ['a quoted identifier', 'SELECT "a:b" FROM t'],
    ['a {{ }} region', 'SELECT {{ :d }}'],
  ])('marks nothing inside %s', (_label, doc) => {
    expect(placeholders(mount(doc))).toEqual([])
  })

  it('does not read := as a placeholder', () => {
    expect(placeholders(mount('SELECT @a := 1'))).toEqual([])
  })

  it('marks the placeholder in front of a cast', () => {
    expect(placeholders(mount('SELECT :id::int'))).toEqual([':id'])
  })

  it('reads the placeholders by the rules of the Database type', () => {
    const doc = 'SELECT 1 # :c'

    expect(placeholders(mount(doc, { databaseType: 'mysql' }))).toEqual([])
    expect(placeholders(mount(doc, { databaseType: 'postgresql' }))).toEqual([':c'])
  })

  it('marks a placeholder as it is typed', () => {
    const view = mount('SELECT 1 WHERE id = ')

    view.dispatch({ changes: { from: view.state.doc.length, insert: ':id' } })

    expect(placeholders(view)).toEqual([':id'])
  })

  it('gives every placeholder, and nothing else, the highlight class the expression editors give a variable', () => {
    const view = mount(SAMPLE_SCRIPT)

    expect(markedText(view, '.cm-expression')).toEqual([':customer', ':status'])
  })

  it('colors a placeholder the way the expression editors color a variable', () => {
    const reference = expressionVariableColor()
    const view = mount(SAMPLE_SCRIPT)
    const marks = Array.from(view.dom.querySelectorAll('.cm-sql-placeholder'))

    expect(marks).toHaveLength(2)
    for (const mark of marks) {
      expect(colorsOf(mark), mark.textContent ?? '').toEqual(colorsOf(mark).map(() => reference))
    }
  })

  it('colors a placeholder apart from the SQL around it', () => {
    const reference = expressionVariableColor()
    const view = mount('SELECT id FROM orders WHERE id = :id')
    const line = view.dom.querySelector('.cm-line') as HTMLElement

    expect(getComputedStyle(line).color).not.toBe(reference)
  })
})

/** The variable color of the expression editors, never empty. */
function expressionVariableColor(): string {
  const reference = mountExpression('usr')
  const mark = reference.dom.querySelector('.cm-expression') as HTMLElement
  const color = getComputedStyle(mark).color
  expect(color).not.toBe('')
  return color
}

// ============================================
// Warning underlines (SQL-10): the span rules are covered in script-body.test.ts
// ============================================

describe('sql-mode warning underlines', () => {
  // Offsets: "SELECT id FROM ordrs" - "ordrs" is 15..20; line 2 "SET search_path TO x;" is 21..42.
  const script = 'SELECT id FROM ordrs\nSET search_path TO x;'

  it('underlines nothing when the script has no warnings', () => {
    const view = mount(script)

    expect(amber(view)).toEqual([])
    expect(red(view)).toEqual([])
  })

  it('underlines a warning span in amber, not its whole line', () => {
    const view = mount(script, { issues: [warning(1, 15, 20)] })

    expect(amber(view)).toEqual(['ordrs'])
    expect(red(view)).toEqual([])
  })

  it('underlines a placeholder warning over the placeholder mark', () => {
    const view = mount('SELECT :cust', { issues: [warning(1, 7, 12)] })

    expect(amber(view)).toEqual([':cust'])
    expect(placeholders(view)).toEqual([':cust'])
  })

  it('never paints a SQL body red, even for a syntax error entry', () => {
    const view = mount(script, { issues: [{ line: 1, message: 'Syntax error' }] })

    expect(red(view)).toEqual([])
  })
})

// ============================================
// View reference (SQL-12)
// ============================================

describe('sql-mode view reference', () => {
  it('holds the view while it is mounted and null after it is destroyed', () => {
    const viewRef: { current: EditorView | null } = { current: null }
    const view = mount('SELECT 1', { viewRef })

    expect(viewRef.current).toBe(view)

    views.splice(views.indexOf(view), 1)
    view.destroy()

    expect(viewRef.current).toBeNull()
  })
})

// ============================================
// Template kind (SQL-10)
// ============================================

/** A SQL body of `doc` in Template kind (`template`) or Literal kind. */
function mountKind(doc: string, template: boolean): EditorView {
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  const view = new EditorView({
    state: EditorState.create({
      doc,
      extensions: buildSqlModeExtensions({ databaseType: 'postgresql', issues: [], template }),
    }),
    parent,
  })
  views.push(view)
  parents.push(parent)
  return view
}

/** A Template body of `doc` as the template stack every other Template body gets draws it. */
function mountTemplateBody(doc: string): EditorView {
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  const view = new EditorView({
    state: EditorState.create({ doc, extensions: [expressionHighlightTheme, createTemplateHighlighter([])] }),
    parent,
  })
  views.push(view)
  parents.push(parent)
  return view
}

describe('sql-mode Template kind', () => {
  const doc = 'SELECT * FROM orders WHERE id = {{ order_id }} AND status = {{ status }}'

  it('highlights each {{ }} region, braces included, in Template kind', () => {
    expect(markedText(mountKind(doc, true), '.cm-expression')).toEqual(['{{ order_id }}', '{{ status }}'])
  })

  it('highlights the regions exactly as a Template body of any other kind', () => {
    expect(markedText(mountKind(doc, true), '.cm-expression')).toEqual(
      markedText(mountTemplateBody(doc), '.cm-expression'),
    )
  })

  it('colors a {{ }} region the way the expression editors color a variable', () => {
    const reference = expressionVariableColor()
    const marks = Array.from(mountKind(doc, true).dom.querySelectorAll('.cm-expression'))

    expect(marks).toHaveLength(2)
    for (const mark of marks) {
      expect(colorsOf(mark), mark.textContent ?? '').toEqual(colorsOf(mark).map(() => reference))
    }
  })

  it('keeps the placeholder marks beside the {{ }} highlight', () => {
    const view = mountKind('SELECT :id, {{ x }}', true)

    expect(placeholders(view)).toEqual([':id'])
    expect(markedText(view, '.cm-expression')).toEqual([':id', '{{ x }}'])
  })

  it('does not highlight {{ }} in Literal kind', () => {
    expect(markedText(mountKind(doc, false), '.cm-expression')).toEqual([])
  })

  it('does not highlight an unclosed {{', () => {
    expect(markedText(mountKind('SELECT {{ order_id', true), '.cm-expression')).toEqual([])
  })
})
