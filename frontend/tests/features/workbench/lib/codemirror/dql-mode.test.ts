/**
 * The DQL-mode CodeMirror bundle of the "Edit value" sheet: token classes, {{ }} in Template kind, amber warnings.
 *
 * REQ-3.3.2.6, REQ-3.4.1.15; OS-5, OS-12
 */

import { describe, it, expect, afterEach } from 'vitest'
import { EditorSelection, EditorState, type Extension } from '@codemirror/state'
import { Decoration, EditorView, keymap, type KeyBinding } from '@codemirror/view'
import { startCompletion } from '@codemirror/autocomplete'
import { indentLess, indentMore } from '@codemirror/commands'
import { ensureSyntaxTree, highlightingFor, language } from '@codemirror/language'
import { openSearchPanel } from '@codemirror/search'
import { classHighlighter, highlightTree, tags, type Tag } from '@lezer/highlight'

import {
  buildDqlModeExtensions,
  type DqlModeOptions,
} from '@/features/workbench/lib/codemirror/dql-mode'
import {
  createTemplateHighlighter,
  expressionMark,
} from '@/features/workbench/lib/codemirror/expression-decorations'
import { expressionHighlightTheme } from '@/features/workbench/lib/codemirror/expression-theme'
import type {
  ScriptIssue,
  ScriptWarning,
} from '@/features/workbench/lib/python-script-validation/script-issues'
import { createFormatExtensions } from '@/lib/codemirror/format-editor'

import { SAMPLE_DQL } from '../../opensearch-fixtures'

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
  return EditorState.create({ doc, extensions: buildDqlModeExtensions({ issues: [], template }) })
}

function mount(
  doc: string,
  options: {
    issues?: readonly ScriptIssue[]
    template?: boolean
    viewRef?: DqlModeOptions['viewRef']
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
      buildDqlModeExtensions({
        issues: options.issues ?? [],
        template: options.template,
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

/** The classes over each character of `text`, found at or after `after`. */
function classesOver(doc: string, text: string, { after = 0, template = false } = {}): string[] {
  const at = doc.indexOf(text, after)
  expect(at, `"${text}" in "${doc}"`).toBeGreaterThanOrEqual(0)
  return charClasses(doc, template).slice(at, at + text.length)
}

const carries = (classes: string, cls: string): boolean => classes.split(' ').includes(cls)

/** The characters of `text` lacking `cls`, shown by their classes; empty when every one carries it. */
function lacking(doc: string, text: string, cls: string, options: { after?: number; template?: boolean } = {}) {
  return classesOver(doc, text, options).filter((classes) => !carries(classes, cls))
}

/** The characters of `text` carrying `cls`; empty when none does. */
function carrying(doc: string, text: string, cls: string, options: { after?: number; template?: boolean } = {}) {
  return classesOver(doc, text, options).filter((classes) => carries(classes, cls))
}

const FIELD = 'tok-propertyName'
const KEYWORD = 'tok-keyword'
const STRING = 'tok-string'
const OPERATOR = 'tok-operator'
const PUNCTUATION = 'tok-punctuation'
const COLORED = [FIELD, KEYWORD, STRING, OPERATOR, PUNCTUATION]

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

function warning(line: number, from: number, to: number): ScriptWarning {
  return { line, message: 'm', severity: 'warning', from, to }
}

// The first line of the approved DQL wireframe, with the unknown field it underlines.
const WIREFRAME_LINE = 'log.invalid:ERROR or (log.level:INFO and message:"Load test finished")'

// ============================================
// Language
// ============================================

describe('buildDqlModeExtensions - language', () => {
  it('builds extensions an EditorState accepts', () => {
    expect(Array.isArray(buildDqlModeExtensions({ issues: [] }))).toBe(true)
    expect(() => stateFor(SAMPLE_DQL)).not.toThrow()
  })

  it('gives the body a language of its own in both kinds', () => {
    expect(stateFor(SAMPLE_DQL).facet(language)).toBeTruthy()
    expect(stateFor(SAMPLE_DQL, true).facet(language)).toBeTruthy()
  })
})

// ============================================
// Field names (OS-12)
// ============================================

describe('dql-mode field names', () => {
  it('marks every field name before a colon as a field', () => {
    expect(lacking(SAMPLE_DQL, 'log.level', FIELD)).toEqual([])
    expect(lacking(SAMPLE_DQL, 'service.name', FIELD)).toEqual([])
  })

  it('marks a field name with no space before the colon', () => {
    expect(lacking(WIREFRAME_LINE, 'log.invalid', FIELD)).toEqual([])
    expect(lacking(WIREFRAME_LINE, 'log.level', FIELD, { after: 12 })).toEqual([])
    expect(lacking(WIREFRAME_LINE, 'message', FIELD)).toEqual([])
  })

  it('marks a field name with spaces around the colon', () => {
    expect(lacking('log.level : ERROR', 'log.level', FIELD)).toEqual([])
  })

  it.each(['@timestamp: *', '_id: 4f2a', 'trace.id: abc123'])('marks the field name of %j', (doc) => {
    const field = doc.slice(0, doc.indexOf(':'))

    expect(lacking(doc, field, FIELD)).toEqual([])
  })

  it.each(['>=', '<=', '>', '<'])('marks the field name before the %s range operator', (operator) => {
    expect(lacking(`latency_ms ${operator} 500`, 'latency_ms', FIELD)).toEqual([])
    expect(lacking(`latency_ms${operator}500`, 'latency_ms', FIELD)).toEqual([])
  })

  it('marks a field name after not and inside parentheses', () => {
    const doc = 'not (log.level: DEBUG or host.name: build-01)'

    expect(lacking(doc, 'log.level', FIELD)).toEqual([])
    expect(lacking(doc, 'host.name', FIELD)).toEqual([])
  })

  it('marks the field names on every line of the body', () => {
    const doc = `${WIREFRAME_LINE}\nand service.name:checkout and host.name:check`

    expect(lacking(doc, 'service.name', FIELD)).toEqual([])
    expect(lacking(doc, 'host.name', FIELD)).toEqual([])
  })

  it('does not mark a free-text term with no field as a field', () => {
    expect(carrying('ERROR', 'ERROR', FIELD)).toEqual([])
    expect(carrying('checkout and log.level: ERROR', 'checkout', FIELD)).toEqual([])
  })

  it('does not mark a value as a field', () => {
    expect(carrying(SAMPLE_DQL, 'ERROR', FIELD)).toEqual([])
    expect(carrying('latency_ms >= 500', '500', FIELD)).toEqual([])
  })
})

// ============================================
// Keywords (OS-12)
// ============================================

describe('dql-mode keywords', () => {
  it.each(['and', 'AND', 'And', 'or', 'OR', 'Or'])('marks %s between two expressions as a keyword', (word) => {
    const doc = `log.level: ERROR ${word} service.name: checkout`

    expect(lacking(doc, word, KEYWORD, { after: 16 })).toEqual([])
  })

  it.each(['not', 'NOT', 'Not'])('marks %s in front of an expression as a keyword', (word) => {
    const doc = `${word} log.level: DEBUG`

    expect(lacking(doc, word, KEYWORD)).toEqual([])
    expect(lacking(doc, 'log.level', FIELD)).toEqual([])
  })

  it('marks both keywords of the wireframe line', () => {
    expect(lacking(WIREFRAME_LINE, 'or', KEYWORD, { after: 17 })).toEqual([])
    expect(lacking(WIREFRAME_LINE, 'and', KEYWORD)).toEqual([])
  })

  it.each([
    ['android', 'user.id: android'],
    ['order', 'user.id: order'],
    ['nothing', 'user.id: nothing'],
    ['sandor', 'user.id: sandor'],
  ])('does not mark %s, a word holding a keyword, as a keyword', (word, doc) => {
    expect(carrying(doc, word, KEYWORD)).toEqual([])
  })
})

// ============================================
// Values (OS-12)
// ============================================

describe('dql-mode values', () => {
  it('marks a quoted phrase, quotes included, as a string', () => {
    expect(lacking(SAMPLE_DQL, '"checkout"', STRING)).toEqual([])
    expect(lacking(WIREFRAME_LINE, '"Load test finished"', STRING)).toEqual([])
  })

  it('keeps and, or, not and * inside a quoted phrase as text', () => {
    const doc = 'message: "cats and dogs or not *"'
    const phrase = '"cats and dogs or not *"'

    expect(lacking(doc, phrase, STRING)).toEqual([])
    expect(carrying(doc, phrase, KEYWORD)).toEqual([])
    expect(carrying(doc, phrase, OPERATOR)).toEqual([])
  })

  it('keeps an escaped quote inside the phrase', () => {
    const doc = 'message: "say \\"hi\\" now" and log.level: INFO'

    expect(lacking(doc, '"say \\"hi\\" now"', STRING)).toEqual([])
    expect(lacking(doc, 'and', KEYWORD, { after: 20 })).toEqual([])
    expect(lacking(doc, 'log.level', FIELD)).toEqual([])
  })

  it.each([
    ['ERROR', 'log.level: ERROR'],
    ['check', 'host.name:check'],
    ['build-01', 'host.name: build-01'],
    ['hello world', 'message: hello world'],
  ])('leaves the unquoted value %j in the plain text color', (value, doc) => {
    for (const cls of COLORED) {
      expect(carrying(doc, value, cls), cls).toEqual([])
    }
  })
})

// ============================================
// Wildcards, parentheses and nested queries (OS-12)
// ============================================

describe('dql-mode wildcards and brackets', () => {
  it('marks a wildcard at the end of a value as an operator, not the value before it', () => {
    const doc = 'service.name: check*'

    expect(lacking(doc, '*', OPERATOR)).toEqual([])
    expect(carrying(doc, 'check', OPERATOR)).toEqual([])
  })

  it('marks the field existence wildcard as an operator', () => {
    const doc = 'service.name:*'

    expect(lacking(doc, 'service.name', FIELD)).toEqual([])
    expect(lacking(doc, '*', OPERATOR)).toEqual([])
  })

  it('marks a wildcard inside a value as an operator', () => {
    expect(lacking('host.name: web-*-01', '*', OPERATOR)).toEqual([])
  })

  it('marks both parentheses as punctuation', () => {
    expect(lacking(WIREFRAME_LINE, '(', PUNCTUATION)).toEqual([])
    expect(lacking(WIREFRAME_LINE, ')', PUNCTUATION)).toEqual([])
  })

  it('marks the braces of a nested query as punctuation and the fields inside it as fields', () => {
    const doc = 'items:{ name: banana and stock > 10 }'

    expect(lacking(doc, 'items', FIELD)).toEqual([])
    expect(lacking(doc, '{', PUNCTUATION)).toEqual([])
    expect(lacking(doc, '}', PUNCTUATION)).toEqual([])
    expect(lacking(doc, 'name', FIELD)).toEqual([])
    expect(lacking(doc, 'stock', FIELD)).toEqual([])
    expect(lacking(doc, 'and', KEYWORD)).toEqual([])
  })
})

// ============================================
// Colors in the sheet (OS-12)
// ============================================

/** The Query editor as the sheet composes it: the host's highlight style for the format, then the DQL bundle. */
function sheetState(isDark: boolean): EditorState {
  return EditorState.create({
    doc: '',
    extensions: [...createFormatExtensions('dql', isDark), ...buildDqlModeExtensions({ issues: [] })],
  })
}

const TOKEN_TAGS: Array<[string, Tag]> = [
  ['field', tags.propertyName],
  ['keyword', tags.keyword],
  ['string', tags.string],
  ['operator', tags.operator],
  ['parenthesis', tags.paren],
  ['brace', tags.brace],
]

describe('dql-mode colors in the sheet', () => {
  it.each([false, true])('gives every token class a color (dark: %s)', (isDark) => {
    const state = sheetState(isDark)

    for (const [name, tag] of TOKEN_TAGS) {
      expect(highlightingFor(state, [tag]), name).toBeTruthy()
    }
  })

  it.each([false, true])('gives fields, keywords, strings and operators each their own color (dark: %s)', (isDark) => {
    const state = sheetState(isDark)
    const styles = [tags.propertyName, tags.keyword, tags.string, tags.operator].map((tag) =>
      highlightingFor(state, [tag]),
    )

    expect(new Set(styles).size).toBe(4)
  })

  it.each([false, true])('draws parentheses and braces apart from the fields (dark: %s)', (isDark) => {
    const state = sheetState(isDark)
    const field = highlightingFor(state, [tags.propertyName])

    expect(highlightingFor(state, [tags.paren])).not.toBe(field)
    expect(highlightingFor(state, [tags.brace])).not.toBe(field)
  })
})

// ============================================
// Template kind (OS-5, OS-12)
// ============================================

describe('dql-mode Template kind', () => {
  const doc = 'service.name: {{ svc }} and host.name: "{{ host }}"'

  it('highlights each {{ }} region, braces included, in Template kind', () => {
    expect(regions(mount(doc, { template: true }))).toEqual(['{{ svc }}', '{{ host }}'])
  })

  it('highlights the regions exactly as a Template body of any other kind', () => {
    expect(regions(mount(doc, { template: true }))).toEqual(regions(mountTemplateBody(doc)))
  })

  it('colors a {{ }} region the way the expression editors color a variable', () => {
    const reference = expressionVariableColor()
    const marks = Array.from(mount(doc, { template: true }).dom.querySelectorAll('.cm-expression'))

    expect(marks.map((mark) => mark.textContent).join('')).toBe('{{ svc }}{{ host }}')
    // Nested token colors under the mark are a stylesheet matter, checked in the browser.
    for (const mark of marks) {
      expect(getComputedStyle(mark).color, mark.textContent ?? '').toBe(reference)
    }
  })

  it('colors the DQL around a region apart from it', () => {
    const reference = expressionVariableColor()
    const view = mount('service.name: {{ svc }}', { template: true })
    const line = view.dom.querySelector('.cm-line') as HTMLElement

    expect(getComputedStyle(line).color).not.toBe(reference)
  })

  it('does not highlight {{ }} in Literal kind', () => {
    expect(regions(mount(doc, { template: false }))).toEqual([])
  })

  it('does not highlight {{ }} when no kind is given', () => {
    expect(regions(mount(doc))).toEqual([])
  })

  it('does not highlight an unclosed {{', () => {
    expect(regions(mount('service.name: {{ svc', { template: true }))).toEqual([])
  })

  it('keeps the DQL token classes outside the regions in both kinds', () => {
    const body = `log.level: {{ level }} and message: "done" or ${WIREFRAME_LINE}`

    expect(charClasses(body, true).slice(0, 10)).toEqual(charClasses(body, false).slice(0, 10))
    expect(lacking(body, 'log.level', FIELD, { template: true })).toEqual([])
    expect(lacking(body, 'and', KEYWORD, { template: true })).toEqual([])
    expect(lacking(body, '"done"', STRING, { template: true })).toEqual([])
    expect(lacking(body, '(', PUNCTUATION, { template: true })).toEqual([])
  })

  it('highlights a region as it is typed', () => {
    const view = mount('service.name: ', { template: true })

    view.dispatch({ changes: { from: view.state.doc.length, insert: '{{ svc }}' } })

    expect(regions(view)).toEqual(['{{ svc }}'])
  })
})

// ============================================
// Warning underlines (OS-12)
// ============================================

describe('dql-mode warning underlines', () => {
  // "log.invalid" is 0..11; line 2 "and host.name:check" starts at 71.
  const body = `${WIREFRAME_LINE}\nand host.name:check`
  const line2 = WIREFRAME_LINE.length + 1

  it('underlines nothing when the body has no warnings', () => {
    const view = mount(body)

    expect(amber(view)).toEqual([])
    expect(red(view)).toEqual([])
  })

  it('underlines an unknown field in amber, not its whole line', () => {
    const view = mount(body, { issues: [warning(1, 0, 11)] })

    expect(amber(view)).toEqual(['log.invalid'])
    expect(red(view)).toEqual([])
  })

  it('underlines every warning span, in document order', () => {
    const view = mount(body, { issues: [warning(2, line2 + 4, line2 + 13), warning(1, 0, 11)] })

    expect(amber(view)).toEqual(['log.invalid', 'host.name'])
    expect(red(view)).toEqual([])
  })

  it('underlines a warning over a {{ }} region and keeps the region highlight', () => {
    const doc = 'service.name: {{ svc }}'
    const view = mount(doc, { template: true, issues: [warning(1, 14, 23)] })

    expect(amber(view)).toEqual(['{{ svc }}'])
    expect(regions(view)).toEqual(['{{ svc }}'])
  })

  it('marks nothing for a line-0 warning', () => {
    expect(amber(mount(body, { issues: [warning(0, 0, 0)] }))).toEqual([])
  })

  it('marks nothing for an empty span', () => {
    expect(amber(mount(body, { issues: [warning(1, 9, 9)] }))).toEqual([])
  })

  it('drops a span that starts past the end of the body', () => {
    expect(amber(mount(body, { issues: [warning(9, 900, 999)] }))).toEqual([])
  })

  it('never paints a DQL body red, even for a syntax error entry', () => {
    expect(red(mount(body, { issues: [{ line: 1, message: 'Syntax error' }] }))).toEqual([])
  })

  it('styles the amber mark in the DQL body', () => {
    const view = mount(body, { issues: [warning(1, 0, 11)] })
    const mark = view.dom.querySelector('.cm-unknown-variable') as HTMLElement

    expect(getComputedStyle(mark).textDecorationColor).toBe('#f59e0b')
  })
})

// ============================================
// Editor facilities (OS-12)
// ============================================

describe('dql-mode editor facilities', () => {
  it('opens find and replace on Ctrl+F', () => {
    expect(bindingFor(stateFor(SAMPLE_DQL), 'Mod-f')?.run).toBe(openSearchPanel)
  })

  it('opens the suggestions on Ctrl+Space', () => {
    expect(completionBinding(stateFor(SAMPLE_DQL))?.run).toBe(startCompletion)
  })

  it('indents with Tab and outdents with Shift+Tab', () => {
    const tab = bindingFor(stateFor(SAMPLE_DQL), 'Tab')

    expect(tab?.run).toBe(indentMore)
    expect(tab?.shift).toBe(indentLess)
  })

  it('does not offer select-next-occurrence', () => {
    expect(bindingsOf(stateFor(SAMPLE_DQL)).map((binding) => binding.key)).not.toContain('Mod-d')
  })

  // The host composes the suggestion list; a second autocompletion would open two lists.
  it('adds no autocompletion of its own', () => {
    expect(startCompletion(mount(SAMPLE_DQL))).toBe(false)
  })

  it('adds no line-number gutter of its own', () => {
    expect(mount(`${SAMPLE_DQL}\nor host.name: web-01`).dom.querySelectorAll('.cm-lineNumbers').length).toBe(0)
  })

  it('highlights the active line', () => {
    const view = mount(`${SAMPLE_DQL}\nor host.name: web-01`, { selection: { anchor: 0, head: 0 } })
    const active = view.dom.querySelectorAll('.cm-activeLine')

    expect(active.length).toBe(1)
    expect(active[0].textContent).toBe(SAMPLE_DQL)
  })

  it('holds the view while it is mounted and null after it is destroyed', () => {
    const viewRef: { current: EditorView | null } = { current: null }
    const view = mount(SAMPLE_DQL, { viewRef })

    expect(viewRef.current).toBe(view)

    views.splice(views.indexOf(view), 1)
    view.destroy()

    expect(viewRef.current).toBeNull()
  })
})

// ============================================
// Get fields row icon (OS-12)
// ============================================

describe('dql-mode Get fields row icon', () => {
  /** The declarations of every mounted rule whose selector ends in `selector`. */
  function mountedRules(selector: string): string[] {
    const css = [...document.querySelectorAll('style')].map((style) => style.textContent ?? '').join('\n')
    return css
      .split('\n')
      .filter((line) => line.includes(` ${selector} {`))
      .map((line) => line.slice(line.indexOf('{')))
  }

  it('draws the Database icon in the Get fields icon slot, in the row color', async () => {
    const { OPENSEARCH_GET_FIELDS_TYPE } = await import('@/features/workbench/lib/codemirror/dql-mode')
    mount(SAMPLE_DQL)

    const [icon] = mountedRules(`.cm-completionIcon-${OPENSEARCH_GET_FIELDS_TYPE}::after`)
    expect(icon).toContain('background-color: currentColor')
    expect(icon).toMatch(/mask: url\("data:image\/svg\+xml,[^"]*ellipse[^"]*"\) center \/ contain no-repeat/)
  })
})

// ============================================
// A dotted name still being typed (OS-12)
// ============================================

describe('dql-mode a dotted name being typed', () => {
  it('marks a name ending in a dot after a keyword as a field', () => {
    const doc = 'log.level: ERROR and service.'

    expect(lacking(doc, 'service.', FIELD)).toEqual([])
  })

  it('marks a name ending in a dot at the start as a field', () => {
    expect(lacking('service.', 'service.', FIELD)).toEqual([])
  })

  it('leaves a value ending in a dot after a colon in the plain text color', () => {
    const doc = 'message: done.'

    expect(carrying(doc, 'done.', FIELD)).toEqual([])
  })

  it('leaves a value ending in a dot after a range operator in the plain text color', () => {
    expect(carrying('version >= 2.', '2.', FIELD)).toEqual([])
  })

  it('still leaves a lone free-text term in the plain text color', () => {
    expect(carrying('checkout', 'checkout', FIELD)).toEqual([])
  })
})
