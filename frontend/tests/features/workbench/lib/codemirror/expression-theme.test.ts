/**
 * Tests for expression-theme shared module.
 *
 * This module provides composable CodeMirror 6 theme extensions used by both
 * the inline expression editor and the modal expression editor for consistent
 * visual styling.
 *
 * Since themes produce CSS-in-JS styling that is ultimately visual, these are
 * smoke tests verifying that each export is a valid CodeMirror extension,
 * can be applied to EditorState, composed together, and used in an EditorView.
 * Visual correctness is validated through Playwright tests.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import {
  expressionEditorTheme,
  expressionHighlightTheme,
  autocompleteDropdownTheme,
} from '@/features/workbench/lib/codemirror/expression-theme'

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

// ============================================
// Individual Theme Validity
// ============================================

describe('expression-theme', () => {
  describe('expressionEditorTheme', () => {
    it('is a valid extension that can be applied to EditorState', () => {
      const state = EditorState.create({
        doc: 'hello world',
        extensions: [expressionEditorTheme],
      })
      expect(state).toBeDefined()
      expect(state.doc.toString()).toBe('hello world')
    })

    it('can be used to create an EditorView', () => {
      const view = createView('test content', [expressionEditorTheme])
      expect(view).toBeDefined()
      expect(view.state.doc.toString()).toBe('test content')
    })
  })

  describe('expressionHighlightTheme', () => {
    it('is a valid extension that can be applied to EditorState', () => {
      const state = EditorState.create({
        doc: 'var_name()',
        extensions: [expressionHighlightTheme],
      })
      expect(state).toBeDefined()
      expect(state.doc.toString()).toBe('var_name()')
    })

    it('can be used to create an EditorView', () => {
      const view = createView('some expression', [expressionHighlightTheme])
      expect(view).toBeDefined()
      expect(view.state.doc.toString()).toBe('some expression')
    })
  })

  describe('autocompleteDropdownTheme', () => {
    it('is a valid extension that can be applied to EditorState', () => {
      const state = EditorState.create({
        doc: 'autocomplete test',
        extensions: [autocompleteDropdownTheme],
      })
      expect(state).toBeDefined()
      expect(state.doc.toString()).toBe('autocomplete test')
    })

    it('can be used to create an EditorView', () => {
      const view = createView('dropdown styling', [autocompleteDropdownTheme])
      expect(view).toBeDefined()
      expect(view.state.doc.toString()).toBe('dropdown styling')
    })
  })

  // ============================================
  // Theme Composition
  // ============================================

  describe('theme composition', () => {
    it('all three themes can be composed into a single EditorState', () => {
      const state = EditorState.create({
        doc: 'composed themes',
        extensions: [
          expressionEditorTheme,
          expressionHighlightTheme,
          autocompleteDropdownTheme,
        ],
      })
      expect(state).toBeDefined()
      expect(state.doc.toString()).toBe('composed themes')
    })

    it('all three themes can be applied to an EditorView together', () => {
      const view = createView('full theme stack', [
        expressionEditorTheme,
        expressionHighlightTheme,
        autocompleteDropdownTheme,
      ])
      expect(view).toBeDefined()
      expect(view.state.doc.toString()).toBe('full theme stack')
    })

    it('themes work in any order', () => {
      const view = createView('order test', [
        autocompleteDropdownTheme,
        expressionEditorTheme,
        expressionHighlightTheme,
      ])
      expect(view).toBeDefined()
      expect(view.state.doc.toString()).toBe('order test')
    })

    it('allows additional extensions alongside themes', () => {
      const readOnly = EditorState.readOnly.of(true)
      const view = createView('with extra extensions', [
        expressionEditorTheme,
        expressionHighlightTheme,
        autocompleteDropdownTheme,
        readOnly,
      ])
      expect(view).toBeDefined()
      expect(view.state.doc.toString()).toBe('with extra extensions')
      expect(view.state.readOnly).toBe(true)
    })
  })
})

// ============================================
// Suggestion list row colors
// ============================================

/** The declarations of every mounted rule whose selector ends in `selector`. */
function mountedRules(selector: string): string[] {
  const css = [...document.querySelectorAll('style')].map((style) => style.textContent ?? '').join('\n')
  return css
    .split('\n')
    .filter((line) => line.includes(` ${selector} {`))
    .map((line) => line.slice(line.indexOf('{')))
}

describe('autocompleteDropdownTheme row colors', () => {
  it.each([
    ['light', false],
    ['dark', true],
  ])('paints every row in light text on the dark list in the %s theme', (_name, dark) => {
    createView('rows', [EditorView.darkTheme.of(dark), autocompleteDropdownTheme])

    const list = mountedRules('.cm-tooltip-autocomplete')
    expect(list.some((rule) => rule.includes('background-color: #1c1c1c !important'))).toBe(true)
    expect(list.some((rule) => rule.includes('color: #e5e5e5 !important'))).toBe(true)
  })

  it('keeps the selected row white', () => {
    createView('rows', [autocompleteDropdownTheme])

    expect(mountedRules('.cm-tooltip-autocomplete li[aria-selected]')).toContainEqual(
      expect.stringContaining('color: #fff !important'),
    )
  })
})
