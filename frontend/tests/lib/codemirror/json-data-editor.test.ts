/**
 * Tests for json-data-editor shared module.
 *
 * This module provides a CodeMirror 6 extensions factory for the array, table,
 * and map data editors. Since the factory produces extensions that configure
 * JSON language support, linting, folding, theming, line numbers, and readOnly
 * mode, these tests verify that each option correctly influences the resulting
 * editor state and view.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import {
  createJsonDataEditorExtensions,
  describeJsonError,
  jsonCellLine,
  jsonElementLine,
  jsonMemberLine,
  maskedJsonLintSource,
} from '@/lib/codemirror/json-data-editor'
import { maskBareExpressionsForLint } from '@/lib/variable-validation'

// ============================================
// Test Helpers
// ============================================

/** Track views and DOM parents for cleanup after each test. */
const views: EditorView[] = []
const parents: HTMLElement[] = []

function createView(doc: string, extensions: Extension[]): EditorView {
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  const state = EditorState.create({ doc, extensions })
  const view = new EditorView({ state, parent })
  views.push(view)
  parents.push(parent)
  return view
}

afterEach(() => {
  for (const view of views) {
    view.destroy()
  }
  for (const parent of parents) {
    parent.remove()
  }
  views.length = 0
  parents.length = 0
})

describe('maskedJsonLintSource (grammar-aware JSON lint)', () => {
  const lint = (doc: string) =>
    maskedJsonLintSource(maskBareExpressionsForLint)({
      state: EditorState.create({ doc }),
    } as unknown as EditorView)

  it('accepts a bare {{ }} value as valid JSON (no diagnostics)', () => {
    expect(lint('{"k": {{ abs(-1) }}}')).toEqual([])
  })

  it('accepts an empty {{}} value', () => {
    expect(lint('{"k": {{}}}')).toEqual([])
  })

  it('still flags genuinely broken JSON', () => {
    expect(lint('{"k": ').length).toBeGreaterThan(0)
  })
})

describe('createJsonDataEditorExtensions jsonMask option', () => {
  it('builds a working editor when a jsonMask is supplied', () => {
    const extensions = createJsonDataEditorExtensions({ jsonMask: maskBareExpressionsForLint })
    const view = createView('{"k": {{ x }}}', extensions)
    expect(view.state.doc.toString()).toBe('{"k": {{ x }}}')
  })
})

// ============================================
// createJsonDataEditorExtensions
// ============================================

describe('json-data-editor', () => {
  describe('describeJsonError', () => {
    it('derives the line from an "at position" error with no line/column tail', () => {
      const text = '{\n  "a": 1,\n  bad\n}'
      const err = new Error('Unexpected token b in JSON at position 14')
      expect(describeJsonError(text, err)).toBe('Line 3: Unexpected token b')
    })

    it('uses the line/column tail directly when present', () => {
      const err = new Error('Unexpected token in JSON at position 5 (line 2 column 1)')
      expect(describeJsonError('{\n}', err)).toBe('Line 2: Unexpected token')
    })

    it('falls back to a bare message for a non-Error / position-less failure', () => {
      expect(describeJsonError('x', 'boom')).toBe('Invalid JSON')
    })
  })

  describe('jsonCellLine', () => {
    it('locates a table cell key by its line in multi-line JSON', () => {
      const text = '[\n  {\n    "id": 1,\n    "name": "x"\n  }\n]'
      expect(jsonCellLine(text, 0, 'name')).toBe(4)
    })

    it('returns null when the cell column cannot be located', () => {
      const text = '[\n  { "id": 1 }\n]'
      expect(jsonCellLine(text, 0, 'missing')).toBeNull()
    })

    it('locates a cell in a later row, past the element-separator comma', () => {
      const text = '[\n  { "id": 1 },\n  { "id": 2, "name": "y" }\n]'
      expect(jsonCellLine(text, 1, 'name')).toBe(3)
    })

    it('skips escaped quotes in a value and whitespace before a cell key colon', () => {
      const text = '[\n  { "id": "a\\"b", "name" : "x" }\n]'
      expect(jsonCellLine(text, 0, 'name')).toBe(2)
    })
  })

  describe('jsonElementLine / jsonMemberLine', () => {
    it('locates a top-level array element by index', () => {
      const text = '[\n  1,\n  {"a": 2},\n  3\n]'
      expect(jsonElementLine(text, 0)).toBe(2)
      expect(jsonElementLine(text, 1)).toBe(3)
      expect(jsonElementLine(text, 2)).toBe(4)
      expect(jsonElementLine(text, 5)).toBeNull()
    })

    it('locates a top-level object member by key', () => {
      const text = '{\n  "host": "x",\n  "port": 8000\n}'
      expect(jsonMemberLine(text, 'host')).toBe(2)
      expect(jsonMemberLine(text, 'port')).toBe(3)
      expect(jsonMemberLine(text, 'missing')).toBeNull()
    })

    it('skips escaped characters inside an array element string', () => {
      const text = '[\n  "a\\"b",\n  "second"\n]'
      expect(jsonElementLine(text, 1)).toBe(3)
    })

    it('skips escaped characters and whitespace before a member colon', () => {
      const text = '{\n  "a": "x\\"y",\n  "target" : 1\n}'
      expect(jsonMemberLine(text, 'target')).toBe(3)
    })

    it('ignores a same-named key nested inside a value', () => {
      const text = '{\n  "outer": {"host": 1},\n  "host": 2\n}'
      expect(jsonMemberLine(text, 'host')).toBe(3)
    })
  })

  describe('default options', () => {
    it('returns valid extensions with default options (no arguments)', () => {
      const extensions = createJsonDataEditorExtensions()
      const state = EditorState.create({ doc: '{"key": "value"}', extensions })
      expect(state).toBeDefined()
      expect(state.doc.toString()).toBe('{"key": "value"}')
    })

    it('creates an EditorView with default options', () => {
      const extensions = createJsonDataEditorExtensions()
      const view = createView('{}', extensions)
      expect(view).toBeDefined()
      expect(view.state.doc.toString()).toBe('{}')
    })

    it('readOnly defaults to false', () => {
      const extensions = createJsonDataEditorExtensions()
      const state = EditorState.create({ doc: '{}', extensions })
      expect(state.readOnly).toBe(false)
    })

    it('lineNumbers defaults to true (gutter present)', () => {
      const extensions = createJsonDataEditorExtensions()
      const view = createView('{}', extensions)
      const lineNumberGutter = view.dom.querySelector('.cm-lineNumbers')
      expect(lineNumberGutter).toBeTruthy()
    })

    it('empty options object uses defaults', () => {
      const extensions = createJsonDataEditorExtensions({})
      const state = EditorState.create({ doc: '[]', extensions })
      expect(state.readOnly).toBe(false)
    })
  })

  describe('readOnly option', () => {
    it('readOnly: true sets state.readOnly to true', () => {
      const extensions = createJsonDataEditorExtensions({ readOnly: true })
      const state = EditorState.create({ doc: '{}', extensions })
      expect(state.readOnly).toBe(true)
    })

    it('readOnly: false keeps state editable', () => {
      const extensions = createJsonDataEditorExtensions({ readOnly: false })
      const state = EditorState.create({ doc: '{}', extensions })
      expect(state.readOnly).toBe(false)
    })
  })

  describe('lineNumbers option', () => {
    it('lineNumbers: true shows line number gutter', () => {
      const extensions = createJsonDataEditorExtensions({ lineNumbers: true })
      const view = createView('{}', extensions)
      const lineNumberGutter = view.dom.querySelector('.cm-lineNumbers')
      expect(lineNumberGutter).toBeTruthy()
    })

    it('lineNumbers: false excludes line number gutter', () => {
      const extensions = createJsonDataEditorExtensions({ lineNumbers: false })
      const view = createView('{}', extensions)
      const lineNumberGutter = view.dom.querySelector('.cm-lineNumbers')
      expect(lineNumberGutter).toBeNull()
    })
  })

  describe('combined options', () => {
    it('readOnly and lineNumbers can both be set', () => {
      const extensions = createJsonDataEditorExtensions({
        readOnly: true,
        lineNumbers: false,
      })
      const state = EditorState.create({ doc: '{}', extensions })
      expect(state.readOnly).toBe(true)

      const view = createView('{}', extensions)
      const lineNumberGutter = view.dom.querySelector('.cm-lineNumbers')
      expect(lineNumberGutter).toBeNull()
    })
  })

  describe('JSON content handling', () => {
    it('works with valid JSON content', () => {
      const extensions = createJsonDataEditorExtensions()
      const view = createView('{"name": "test", "value": 42}', extensions)
      expect(view.state.doc.toString()).toBe('{"name": "test", "value": 42}')
    })

    it('works with invalid JSON content (linter will flag it)', () => {
      const extensions = createJsonDataEditorExtensions()
      const view = createView('{invalid}', extensions)
      expect(view.state.doc.toString()).toBe('{invalid}')
    })

    it('works with JSON array content', () => {
      const extensions = createJsonDataEditorExtensions()
      const view = createView('[1, 2, 3]', extensions)
      expect(view.state.doc.toString()).toBe('[1, 2, 3]')
    })
  })
})
