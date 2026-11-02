/**
 * Tests for expression-decorations shared module.
 *
 * This module provides CodeMirror 6 decoration marks and a ViewPlugin factory
 * used by both the inline expression editor and the modal expression editor
 * for consistent expression highlighting and validation display.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import {
  expressionMark,
  unknownVariableMark,
  invalidFunctionMark,
  createExpressionHighlighter,
  createTemplateHighlighter,
  type DecorationIssue,
} from '@/features/workbench/lib/codemirror/expression-decorations'

// ============================================
// Test Helpers
// ============================================

/**
 * Create an EditorView with the given document and highlighter plugin.
 * The view is mounted to a real DOM element for CodeMirror to function.
 */
function createTestView(doc: string, issues: DecorationIssue[] = []) {
  const plugin = createExpressionHighlighter(issues)
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  const state = EditorState.create({ doc, extensions: [plugin] })
  const view = new EditorView({ state, parent })
  return { view, plugin, parent }
}

/**
 * Collect all decorations from a plugin instance as an array of
 * { from, to, class } objects for easy assertion.
 */
function collectDecorations(view: EditorView, plugin: ReturnType<typeof createExpressionHighlighter>) {
  const instance = view.plugin(plugin)
  if (!instance) return []
  const result: Array<{ from: number; to: number; class: string }> = []
  const cursor = instance.decorations.iter()
  while (cursor.value) {
    result.push({
      from: cursor.from,
      to: cursor.to,
      class: (cursor.value.spec as { class: string }).class,
    })
    cursor.next()
  }
  return result
}

// Track views for cleanup
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

function tracked(result: { view: EditorView; plugin: ReturnType<typeof createExpressionHighlighter>; parent: HTMLElement }) {
  views.push(result.view)
  parents.push(result.parent)
  return result
}

// ============================================
// Decoration Marks
// ============================================

describe('decoration marks', () => {
  it('expressionMark has class cm-expression', () => {
    expect((expressionMark.spec as { class: string }).class).toBe('cm-expression')
  })

  it('unknownVariableMark has class cm-unknown-variable', () => {
    expect((unknownVariableMark.spec as { class: string }).class).toBe('cm-unknown-variable')
  })

  it('invalidFunctionMark has class cm-invalid-function', () => {
    expect((invalidFunctionMark.spec as { class: string }).class).toBe('cm-invalid-function')
  })
})

// ============================================
// createExpressionHighlighter
// ============================================

describe('createExpressionHighlighter', () => {
  it('creates a valid ViewPlugin usable as extension', () => {
    const plugin = createExpressionHighlighter([])
    // Should not throw when used as an extension
    const state = EditorState.create({ doc: 'test', extensions: [plugin] })
    expect(state).toBeDefined()
  })

  it('returns Decoration.none for empty document', () => {
    const { view, plugin } = tracked(createTestView(''))
    const decorations = collectDecorations(view, plugin)
    expect(decorations).toHaveLength(0)
  })

  it('applies expressionMark covering the full range with no issues', () => {
    const { view, plugin } = tracked(createTestView('x + 1'))
    const decorations = collectDecorations(view, plugin)
    expect(decorations).toHaveLength(1)
    expect(decorations[0]).toEqual({
      from: 0,
      to: 5,
      class: 'cm-expression',
    })
  })

  it('applies unknownVariableMark for warning issues', () => {
    const issues: DecorationIssue[] = [{ from: 4, to: 7, severity: 'warning' }]
    const { view, plugin } = tracked(createTestView('foo + bar', issues))
    const decorations = collectDecorations(view, plugin)
    expect(decorations).toHaveLength(2)
    // Expression mark covers the full document
    expect(decorations[0]).toEqual({
      from: 0,
      to: 9,
      class: 'cm-expression',
    })
    // Warning underline at the issue position
    expect(decorations[1]).toEqual({
      from: 4,
      to: 7,
      class: 'cm-unknown-variable',
    })
  })

  it('applies invalidFunctionMark for error issues', () => {
    const issues: DecorationIssue[] = [{ from: 2, to: 5, severity: 'error' }]
    const { view, plugin } = tracked(createTestView('badFn()', issues))
    const decorations = collectDecorations(view, plugin)
    expect(decorations).toHaveLength(2)
    // Expression mark covers the full document
    expect(decorations[0]).toEqual({
      from: 0,
      to: 7,
      class: 'cm-expression',
    })
    // Error underline at the issue position
    expect(decorations[1]).toEqual({
      from: 2,
      to: 5,
      class: 'cm-invalid-function',
    })
  })

  it('applies both warning and error issues together', () => {
    const issues: DecorationIssue[] = [
      { from: 2, to: 4, severity: 'warning' },
      { from: 6, to: 9, severity: 'error' },
    ]
    const { view, plugin } = tracked(createTestView('foo + bar', issues))
    const decorations = collectDecorations(view, plugin)
    expect(decorations).toHaveLength(3)
    expect(decorations[0]).toEqual({ from: 0, to: 9, class: 'cm-expression' })
    expect(decorations[1]).toEqual({ from: 2, to: 4, class: 'cm-unknown-variable' })
    expect(decorations[2]).toEqual({ from: 6, to: 9, class: 'cm-invalid-function' })
  })

  it('clamps issue positions to document length without crashing', () => {
    // Issue extends beyond document length (doc is 5 chars, issue from=1 to=100)
    const issues: DecorationIssue[] = [{ from: 1, to: 100, severity: 'warning' }]
    const { view, plugin } = tracked(createTestView('abcde', issues))
    const decorations = collectDecorations(view, plugin)
    expect(decorations).toHaveLength(2)
    expect(decorations[0]).toEqual({ from: 0, to: 5, class: 'cm-expression' })
    // to is clamped to doc length (5)
    expect(decorations[1]).toEqual({ from: 1, to: 5, class: 'cm-unknown-variable' })
  })

  it('produces no decoration when from >= to after clamping', () => {
    // Both from and to are beyond document length, so both clamp to doc.length
    // After clamping: from=3, to=3 -> from < to is false, so no issue decoration
    const issues: DecorationIssue[] = [{ from: 10, to: 20, severity: 'error' }]
    const { view, plugin } = tracked(createTestView('abc', issues))
    const decorations = collectDecorations(view, plugin)
    // Only the expression mark, no issue decoration
    expect(decorations).toHaveLength(1)
    expect(decorations[0].class).toBe('cm-expression')
  })

  it('rebuilds decorations on document change', () => {
    const { view, plugin } = tracked(createTestView('hi'))
    // Initially covers "hi" (0-2)
    let decorations = collectDecorations(view, plugin)
    expect(decorations).toHaveLength(1)
    expect(decorations[0]).toEqual({ from: 0, to: 2, class: 'cm-expression' })

    // Change document to longer text
    view.dispatch({
      changes: { from: 2, insert: ' there' },
    })

    // Now covers "hi there" (0-8)
    decorations = collectDecorations(view, plugin)
    expect(decorations).toHaveLength(1)
    expect(decorations[0]).toEqual({ from: 0, to: 8, class: 'cm-expression' })
  })

  it('transitions to Decoration.none when document becomes empty', () => {
    const { view, plugin } = tracked(createTestView('abc'))
    // Initially has decorations
    let decorations = collectDecorations(view, plugin)
    expect(decorations).toHaveLength(1)

    // Delete all content
    view.dispatch({
      changes: { from: 0, to: 3 },
    })

    // Now empty - should have no decorations
    decorations = collectDecorations(view, plugin)
    expect(decorations).toHaveLength(0)
  })

  it('does not rebuild decorations on selection-only change', () => {
    const { view, plugin } = tracked(createTestView('hello'))
    const decorationsBefore = collectDecorations(view, plugin)
    expect(decorationsBefore).toHaveLength(1)

    // Dispatch a selection-only change (no docChanged, no viewportChanged)
    view.dispatch({
      selection: { anchor: 2 },
    })

    // Decorations should remain the same (not rebuilt)
    const decorationsAfter = collectDecorations(view, plugin)
    expect(decorationsAfter).toHaveLength(1)
    expect(decorationsAfter[0]).toEqual({ from: 0, to: 5, class: 'cm-expression' })
  })

  it('clamps from position when from exceeds doc length but to does not', () => {
    // from > doc.length but to <= doc.length (edge case - after clamping from >= to)
    const issues: DecorationIssue[] = [{ from: 5, to: 3, severity: 'warning' }]
    const { view, plugin } = tracked(createTestView('abc', issues))
    const decorations = collectDecorations(view, plugin)
    // from clamped to 3, to clamped to 3: from < to is false, so no issue decoration
    expect(decorations).toHaveLength(1)
    expect(decorations[0].class).toBe('cm-expression')
  })
})

// ============================================
// Template Highlighter
// ============================================

describe('createTemplateHighlighter', () => {
  function createTemplateView(doc: string, issues: DecorationIssue[] = []) {
    const plugin = createTemplateHighlighter(issues)
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    const state = EditorState.create({ doc, extensions: [plugin] })
    const view = new EditorView({ state, parent })
    return { view, plugin, parent }
  }

  function collectTemplateDecorations(view: EditorView, plugin: ReturnType<typeof createTemplateHighlighter>) {
    const instance = view.plugin(plugin)
    if (!instance) return []
    const result: Array<{ from: number; to: number; class: string }> = []
    const cursor = instance.decorations.iter()
    while (cursor.value) {
      result.push({
        from: cursor.from,
        to: cursor.to,
        class: (cursor.value.spec as { class: string }).class,
      })
      cursor.next()
    }
    return result
  }

  function trackedTpl(result: { view: EditorView; plugin: ReturnType<typeof createTemplateHighlighter>; parent: HTMLElement }) {
    views.push(result.view)
    parents.push(result.parent)
    return result
  }

  it('highlights {{ expr }} regions with expression mark', () => {
    const { view, plugin } = trackedTpl(createTemplateView('text {{host}} end'))
    const decos = collectTemplateDecorations(view, plugin)
    expect(decos).toHaveLength(1)
    expect(decos[0]).toEqual({ from: 5, to: 13, class: 'cm-expression' })
  })

  it('highlights multiple template regions', () => {
    const { view, plugin } = trackedTpl(createTemplateView('{{a}} and {{b}}'))
    const decos = collectTemplateDecorations(view, plugin)
    expect(decos.length).toBe(2)
    expect(decos[0].class).toBe('cm-expression')
    expect(decos[1].class).toBe('cm-expression')
  })

  it('returns no decorations for empty document', () => {
    const { view, plugin } = trackedTpl(createTemplateView(''))
    const decos = collectTemplateDecorations(view, plugin)
    expect(decos).toHaveLength(0)
  })

  it('returns no decorations for plain text without markers', () => {
    const { view, plugin } = trackedTpl(createTemplateView('no templates here'))
    const decos = collectTemplateDecorations(view, plugin)
    expect(decos).toHaveLength(0)
  })

  it('adds warning decoration for unknown variable issues', () => {
    const issues: DecorationIssue[] = [{ from: 7, to: 11, severity: 'warning' }]
    const { view, plugin } = trackedTpl(createTemplateView('text {{host}} end', issues))
    const decos = collectTemplateDecorations(view, plugin)
    // Should have expression mark + warning mark
    const warnings = decos.filter(d => d.class === 'cm-unknown-variable')
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toEqual({ from: 7, to: 11, class: 'cm-unknown-variable' })
  })

  it('adds error decoration for invalid function issues', () => {
    const issues: DecorationIssue[] = [{ from: 2, to: 8, severity: 'error' }]
    const { view, plugin } = trackedTpl(createTemplateView('{{bad_fn()}}', issues))
    const decos = collectTemplateDecorations(view, plugin)
    const errors = decos.filter(d => d.class === 'cm-invalid-function')
    expect(errors).toHaveLength(1)
  })

  it('rebuilds decorations on document change', () => {
    const { view, plugin } = trackedTpl(createTemplateView('{{a}}'))
    const before = collectTemplateDecorations(view, plugin)
    expect(before).toHaveLength(1)

    // Change document
    view.dispatch({
      changes: { from: 0, to: 5, insert: '{{a}} {{b}}' },
    })

    const after = collectTemplateDecorations(view, plugin)
    expect(after).toHaveLength(2)
  })

  it('does not rebuild on selection-only change', () => {
    const { view, plugin } = trackedTpl(createTemplateView('{{a}}'))
    const before = collectTemplateDecorations(view, plugin)
    expect(before).toHaveLength(1)

    view.dispatch({ selection: { anchor: 2 } })

    const after = collectTemplateDecorations(view, plugin)
    expect(after).toHaveLength(1)
    expect(after[0]).toEqual(before[0])
  })

  it('clamps issue positions to document bounds', () => {
    const issues: DecorationIssue[] = [{ from: 100, to: 200, severity: 'warning' }]
    const { view, plugin } = trackedTpl(createTemplateView('{{x}}', issues))
    const decos = collectTemplateDecorations(view, plugin)
    // from clamped to doc.length (5), to clamped to 5: from < to is false, no issue deco
    const warnings = decos.filter(d => d.class === 'cm-unknown-variable')
    expect(warnings).toHaveLength(0)
  })

  it('sorts decorations by from then to when issues share same from position', () => {
    // Two issues starting at the same position but different lengths
    // This exercises the sort tiebreaker: a.from - b.from || a.to - b.to
    const issues: DecorationIssue[] = [
      { from: 2, to: 4, severity: 'error' },
      { from: 2, to: 3, severity: 'warning' },
    ]
    const { view, plugin } = trackedTpl(createTemplateView('{{abcd}}', issues))
    const decos = collectTemplateDecorations(view, plugin)
    // Expression mark for the region + 2 issue marks, sorted by (from, to)
    const issueDecos = decos.filter(d => d.class !== 'cm-expression')
    expect(issueDecos).toHaveLength(2)
    // Shorter range (2,3) should come before longer range (2,4) due to tiebreaker sort
    expect(issueDecos[0]).toEqual({ from: 2, to: 3, class: 'cm-unknown-variable' })
    expect(issueDecos[1]).toEqual({ from: 2, to: 4, class: 'cm-invalid-function' })
  })
})
