/**
 * The Query DSL CodeMirror bundle of the "Edit value" sheet, shared by the `query-dsl` and `aggregation-json` modes:
 * JSON coloring in both kinds, {{ }} in Template kind, amber warnings.
 *
 * REQ-3.3.2.6, REQ-3.4.1.15; OS-5, OS-7, OS-12
 */

import { describe, it, expect, afterEach } from 'vitest'
import { EditorSelection, EditorState } from '@codemirror/state'
import { Decoration, EditorView, keymap, type KeyBinding } from '@codemirror/view'
import { startCompletion } from '@codemirror/autocomplete'
import { indentLess, indentMore } from '@codemirror/commands'
import { jsonLanguage } from '@codemirror/lang-json'
import { ensureSyntaxTree, highlightingFor, language } from '@codemirror/language'
import { diagnosticCount, forceLinting } from '@codemirror/lint'
import { openSearchPanel } from '@codemirror/search'
import { classHighlighter, highlightTree, tags } from '@lezer/highlight'

import {
  buildQueryDslModeExtensions,
  type QueryDslModeOptions,
} from '@/features/workbench/lib/codemirror/query-dsl-mode'
import {
  createTemplateHighlighter,
  expressionMark,
} from '@/features/workbench/lib/codemirror/expression-decorations'
import { expressionHighlightTheme } from '@/features/workbench/lib/codemirror/expression-theme'
import type {
  ScriptIssue,
  ScriptWarning,
} from '@/features/workbench/lib/python-script-validation/script-issues'
import { createFormatExtensions, type ResolvedFormat } from '@/lib/codemirror/format-editor'

import { SAMPLE_AGGREGATION_JSON, SAMPLE_QUERY_DSL } from '../../opensearch-fixtures'

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

function stateFor(doc: string, template = false): EditorState {
  return EditorState.create({ doc, extensions: buildQueryDslModeExtensions({ issues: [], template }) })
}

function mount(
  doc: string,
  options: {
    issues?: readonly ScriptIssue[]
    template?: boolean
    viewRef?: QueryDslModeOptions['viewRef']
    selection?: { anchor: number; head: number }
  } = {},
): EditorView {
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  const state = EditorState.create({
    doc,
    selection: options.selection
      ? EditorSelection.single(options.selection.anchor, options.selection.head)
      : undefined,
    extensions: buildQueryDslModeExtensions({
      issues: options.issues ?? [],
      template: options.template,
      viewRef: options.viewRef,
    }),
  })
  const view = new EditorView({ state, parent })
  views.push(view)
  parents.push(parent)
  return view
}

/** The generic `tok-*` classes of every character of the body, from its syntax tree. */
function charClasses(doc: string, template = false): string[] {
  const state = stateFor(doc, template)
  const classes = new Array<string>(doc.length).fill('')
  const tree = ensureSyntaxTree(state, doc.length, 5000)
  expect(tree).not.toBeNull()
  if (tree) {
    highlightTree(tree, classHighlighter, (from, to, cls) => {
      for (let at = from; at < to; at += 1) classes[at] = cls
    })
  }
  return classes
}

/** The characters of `text` (found at or after `after`) lacking `cls`; empty when every one carries it. */
function lacking(doc: string, text: string, cls: string, { after = 0, template = false } = {}): string[] {
  const at = doc.indexOf(text, after)
  expect(at, `"${text}" in the body`).toBeGreaterThanOrEqual(0)
  return charClasses(doc, template)
    .slice(at, at + text.length)
    .filter((classes) => !classes.split(' ').includes(cls))
}

const KEY = 'tok-propertyName'
const STRING = 'tok-string'
const NUMBER = 'tok-number'
const BOOL = 'tok-bool'
const PUNCTUATION = 'tok-punctuation'

function bindingsOf(state: EditorState): KeyBinding[] {
  return state.facet(keymap).flat()
}

function bindingFor(state: EditorState, key: string): KeyBinding | undefined {
  return bindingsOf(state).find((binding) => binding.key === key)
}

function completionBinding(state: EditorState): KeyBinding | undefined {
  return bindingsOf(state).find(
    (binding) => binding.key === 'Ctrl-Space' || binding.key === 'Mod-Space',
  )
}

/** The texts under `selector` in document order; touching pieces of one mark read as one. */
function markedText(view: EditorView, selector: string): string[] {
  const ranges: Array<[number, number]> = []
  for (const element of Array.from(view.dom.querySelectorAll(selector))) {
    const from = view.posAtDOM(element, 0)
    const to = from + (element.textContent ?? '').length
    const last = ranges.at(-1)
    if (last && last[1] === from) last[1] = to
    else ranges.push([from, to])
  }
  return ranges.map(([from, to]) => view.state.sliceDoc(from, to))
}

const amber = (view: EditorView) => markedText(view, '.cm-unknown-variable')
const red = (view: EditorView) => markedText(view, '.cm-invalid-function')
const regions = (view: EditorView) => markedText(view, '.cm-expression')

/** The variable color of the expression editors, never empty. */
function expressionVariableColor(): string {
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  const view = new EditorView({
    state: EditorState.create({
      doc: 'usr',
      extensions: [
        expressionHighlightTheme,
        EditorView.decorations.of(Decoration.set([expressionMark.range(0, 3)])),
      ],
    }),
    parent,
  })
  views.push(view)
  parents.push(parent)
  const color = getComputedStyle(view.dom.querySelector('.cm-expression') as HTMLElement).color
  expect(color).not.toBe('')
  return color
}

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

function warning(line: number, from: number, to: number): ScriptWarning {
  return { line, message: 'm', severity: 'warning', from, to }
}

const MATCH_QUERY = '{"match": {"message": {"query": "checkout failed", "lenient": true, "boost": 1.5}}}'

// ============================================
// Language (OS-12)
// ============================================

describe('buildQueryDslModeExtensions - language', () => {
  it('builds extensions an EditorState accepts', () => {
    expect(Array.isArray(buildQueryDslModeExtensions({ issues: [] }))).toBe(true)
    expect(() => stateFor(SAMPLE_QUERY_DSL)).not.toThrow()
  })

  it.each([false, true])('reads the body as JSON (Template kind: %s)', (template) => {
    expect(stateFor(SAMPLE_QUERY_DSL, template).facet(language)).toBe(jsonLanguage)
  })

  it('reads a body with no kind given as JSON', () => {
    expect(
      EditorState.create({ doc: SAMPLE_AGGREGATION_JSON, extensions: buildQueryDslModeExtensions({ issues: [] }) })
        .facet(language),
    ).toBe(jsonLanguage)
  })
})

// ============================================
// JSON coloring (OS-12)
// ============================================

describe('query-dsl-mode JSON coloring', () => {
  it.each([false, true])('marks every key of a Query DSL body as a key (Template kind: %s)', (template) => {
    for (const key of ['"bool"', '"filter"', '"term"', '"log.level"']) {
      expect(lacking(SAMPLE_QUERY_DSL, key, KEY, { template }), key).toEqual([])
    }
  })

  it.each([false, true])('marks a string value as a string (Template kind: %s)', (template) => {
    expect(lacking(SAMPLE_QUERY_DSL, '"ERROR"', STRING, { template })).toEqual([])
  })

  it('marks numbers and booleans by their kind', () => {
    expect(lacking(MATCH_QUERY, 'true', BOOL)).toEqual([])
    expect(lacking(MATCH_QUERY, '1.5', NUMBER)).toEqual([])
    expect(lacking(MATCH_QUERY, '"checkout failed"', STRING)).toEqual([])
  })

  it('marks braces and brackets as punctuation', () => {
    const at = SAMPLE_QUERY_DSL.indexOf('[')

    expect(lacking(SAMPLE_QUERY_DSL, '{', PUNCTUATION)).toEqual([])
    expect(lacking(SAMPLE_QUERY_DSL, '[', PUNCTUATION)).toEqual([])
    expect(lacking(SAMPLE_QUERY_DSL, ']', PUNCTUATION, { after: at })).toEqual([])
  })

  it('colors a Custom (JSON) aggregation the same way', () => {
    expect(lacking(SAMPLE_AGGREGATION_JSON, '"percentiles"', KEY)).toEqual([])
    expect(lacking(SAMPLE_AGGREGATION_JSON, '"field"', KEY)).toEqual([])
    expect(lacking(SAMPLE_AGGREGATION_JSON, '"latency_ms"', STRING)).toEqual([])
    expect(lacking(SAMPLE_AGGREGATION_JSON, '99', NUMBER)).toEqual([])
  })

  it('keeps coloring the keys ahead of a {{ }} standing alone as a value in Template kind', () => {
    const doc = '{"term": {"status": {{ code }}}}'

    expect(lacking(doc, '"term"', KEY, { template: true })).toEqual([])
    expect(lacking(doc, '"status"', KEY, { template: true })).toEqual([])
  })
})

// ============================================
// Colors in the sheet (OS-12)
// ============================================

const JSON_FORMATS = ['query-dsl', 'aggregation-json'] as const satisfies readonly ResolvedFormat[]

describe('query-dsl-mode colors in the sheet', () => {
  it.each(JSON_FORMATS.flatMap((format) => [[format, false] as const, [format, true] as const]))(
    'gives strings, numbers and booleans a color in the %s mode (dark: %s)',
    (format, isDark) => {
      const state = EditorState.create({
        doc: '',
        extensions: [...createFormatExtensions(format, isDark), ...buildQueryDslModeExtensions({ issues: [] })],
      })

      for (const tag of [tags.string, tags.number, tags.bool]) {
        expect(highlightingFor(state, [tag])).toBeTruthy()
      }
    },
  )
})

// ============================================
// Template kind (OS-5, OS-12)
// ============================================

describe('query-dsl-mode Template kind', () => {
  const inString = '{"match": {"message": "{{ msg }}"}}'
  const standing = '{"term": {"status": {{ code }}}}'

  it('highlights a {{ }} region inside a JSON string, braces included', () => {
    expect(regions(mount(inString, { template: true }))).toEqual(['{{ msg }}'])
  })

  it('highlights a {{ }} region standing alone as a JSON value', () => {
    expect(regions(mount(standing, { template: true }))).toEqual(['{{ code }}'])
  })

  it('highlights the regions exactly as a Template body of any other kind', () => {
    const doc = `{"bool": {"filter": [{"term": {"service.name": "{{ svc }}"}}, {"range": {"latency_ms": {"gte": {{ min }}}}}]}}`

    expect(regions(mount(doc, { template: true }))).toEqual(regions(mountTemplateBody(doc)))
    expect(regions(mount(doc, { template: true }))).toEqual(['{{ svc }}', '{{ min }}'])
  })

  it('colors a {{ }} region the way the expression editors color a variable', () => {
    const reference = expressionVariableColor()
    const marks = Array.from(mount(inString, { template: true }).dom.querySelectorAll('.cm-expression'))

    expect(marks.map((mark) => mark.textContent).join('')).toBe('{{ msg }}')
    // Nested token colors under the mark are a stylesheet matter, checked in the browser.
    for (const mark of marks) {
      expect(getComputedStyle(mark).color, mark.textContent ?? '').toBe(reference)
    }
  })

  it('does not highlight {{ }} in Literal kind', () => {
    expect(regions(mount(inString, { template: false }))).toEqual([])
  })

  it('does not highlight {{ }} when no kind is given, as a Custom (JSON) stat opens', () => {
    expect(regions(mount(inString))).toEqual([])
  })

  it('does not highlight an unclosed {{', () => {
    expect(regions(mount('{"match": {"message": "{{ msg', { template: true }))).toEqual([])
  })
})

// ============================================
// Warning underlines (OS-12)
// ============================================

describe('query-dsl-mode warning underlines', () => {
  const doc = '{"term": {"log.invalid": "ERROR"}}\n'
  const field = doc.indexOf('log.invalid')
  const value = doc.indexOf('"ERROR"')

  it('underlines nothing when the body has no warnings', () => {
    const view = mount(doc)

    expect(amber(view)).toEqual([])
    expect(red(view)).toEqual([])
  })

  it('underlines a warning span in amber, not its whole line', () => {
    const view = mount(doc, { issues: [warning(1, field, field + 11)] })

    expect(amber(view)).toEqual(['log.invalid'])
    expect(red(view)).toEqual([])
  })

  it('underlines every warning span, in document order', () => {
    const view = mount(doc, { issues: [warning(1, value, value + 7), warning(1, field, field + 11)] })

    expect(amber(view)).toEqual(['log.invalid', '"ERROR"'])
    expect(red(view)).toEqual([])
  })

  it('marks nothing for a line-0 warning or an empty span', () => {
    expect(amber(mount(doc, { issues: [warning(0, 0, 0), warning(1, field, field)] }))).toEqual([])
  })

  it('drops a span that starts past the end of the body', () => {
    expect(amber(mount(doc, { issues: [warning(9, 900, 999)] }))).toEqual([])
  })

  it('never paints the body red, even for a syntax error entry', () => {
    expect(red(mount(doc, { issues: [{ line: 1, message: 'Syntax error' }] }))).toEqual([])
  })

  // The JSON findings come from the server check as warnings; a client parse linter would paint them red.
  it('adds no parse linter of its own', async () => {
    const view = mount('{"match": {"message": }')

    forceLinting(view)
    await Promise.resolve()

    expect(diagnosticCount(view.state)).toBe(0)
    expect(view.dom.querySelectorAll('.cm-lintRange-error').length).toBe(0)
  })

  it('styles the amber mark in the body', () => {
    const view = mount(doc, { issues: [warning(1, field, field + 11)] })
    const mark = view.dom.querySelector('.cm-unknown-variable') as HTMLElement

    expect(getComputedStyle(mark).textDecorationColor).toBe('#f59e0b')
  })
})

// ============================================
// Editor facilities (OS-12)
// ============================================

describe('query-dsl-mode editor facilities', () => {
  it('opens find and replace on Ctrl+F', () => {
    expect(bindingFor(stateFor(SAMPLE_QUERY_DSL), 'Mod-f')?.run).toBe(openSearchPanel)
  })

  it('opens the suggestions on Ctrl+Space', () => {
    expect(completionBinding(stateFor(SAMPLE_QUERY_DSL))?.run).toBe(startCompletion)
  })

  it('indents with Tab and outdents with Shift+Tab', () => {
    const tab = bindingFor(stateFor(SAMPLE_QUERY_DSL), 'Tab')

    expect(tab?.run).toBe(indentMore)
    expect(tab?.shift).toBe(indentLess)
  })

  // The host composes the suggestion list; a second autocompletion would open two lists.
  it('adds no autocompletion of its own', () => {
    expect(startCompletion(mount(SAMPLE_QUERY_DSL))).toBe(false)
  })

  it('adds no line-number gutter of its own', () => {
    expect(mount(SAMPLE_QUERY_DSL).dom.querySelectorAll('.cm-lineNumbers').length).toBe(0)
  })

  it('marks the bracket matching the one at the cursor', () => {
    const view = mount('{"match_all": {}}', { selection: { anchor: 0, head: 0 } })

    expect(view.dom.querySelectorAll('.cm-matchingBracket').length).toBe(2)
  })

  it('holds the view while it is mounted and null after it is destroyed', () => {
    const viewRef: { current: EditorView | null } = { current: null }
    const view = mount(SAMPLE_QUERY_DSL, { viewRef })

    expect(viewRef.current).toBe(view)

    views.splice(views.indexOf(view), 1)
    view.destroy()

    expect(viewRef.current).toBeNull()
  })
})
