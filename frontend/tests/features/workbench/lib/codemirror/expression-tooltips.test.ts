/**
 * Tests for expression-tooltips shared module.
 *
 * This module provides a CodeMirror 6 hover tooltip extension for validation
 * issues used by both the inline expression editor and the modal expression
 * editor for consistent validation tooltip display.
 */

import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import type { ValidationIssue } from '@/features/workbench/lib/expression-validation'
import {
  validationTooltipSource,
  createValidationTooltip,
} from '@/features/workbench/lib/codemirror/expression-tooltips'

// ============================================
// Test Helpers
// ============================================

/** Dummy EditorView for passing to the tooltip source (not used by the function) */
function createDummyView(): EditorView {
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  const state = EditorState.create({ doc: 'test' })
  const view = new EditorView({ state, parent })
  return view
}

// ============================================
// createValidationTooltip
// ============================================

describe('createValidationTooltip', () => {
  it('returns a valid extension when given empty issues', () => {
    const ext = createValidationTooltip([])
    const state = EditorState.create({ doc: 'hello', extensions: [ext] })
    expect(state).toBeDefined()
  })

  it('returns a valid extension when given issues', () => {
    const issues: ValidationIssue[] = [
      {
        type: 'unknown_variable',
        from: 0,
        to: 3,
        message: "Unknown variable 'foo'",
        identifier: 'foo',
      },
    ]
    const ext = createValidationTooltip(issues)
    const state = EditorState.create({ doc: 'foo + bar', extensions: [ext] })
    expect(state).toBeDefined()
  })
})

// ============================================
// validationTooltipSource
// ============================================

describe('validationTooltipSource', () => {
  it('returns null when issues list is empty', () => {
    const source = validationTooltipSource([])
    const view = createDummyView()
    try {
      const result = source(view, 0)
      expect(result).toBeNull()
    } finally {
      view.destroy()
    }
  })

  it('returns null when position is outside all issue ranges', () => {
    const issues: ValidationIssue[] = [
      {
        type: 'unknown_variable',
        from: 5,
        to: 10,
        message: "Unknown variable 'bar'",
        identifier: 'bar',
      },
    ]
    const source = validationTooltipSource(issues)
    const view = createDummyView()
    try {
      // Position before the issue range
      expect(source(view, 0)).toBeNull()
      expect(source(view, 4)).toBeNull()
      // Position after the issue range
      expect(source(view, 11)).toBeNull()
    } finally {
      view.destroy()
    }
  })

  it('returns tooltip for unknown_variable (warning style)', () => {
    const issues: ValidationIssue[] = [
      {
        type: 'unknown_variable',
        from: 0,
        to: 3,
        message: "Unknown variable 'foo'",
        identifier: 'foo',
      },
    ]
    const source = validationTooltipSource(issues)
    const view = createDummyView()
    try {
      const tooltip = source(view, 1)
      expect(tooltip).not.toBeNull()
      expect(tooltip!.pos).toBe(0)
      expect(tooltip!.end).toBe(3)
      expect(tooltip!.above).toBe(true)

      // Verify the DOM element
      const created = tooltip!.create!(view)
      expect(created.dom.className).toBe('cm-validation-tooltip cm-validation-tooltip-amber')
      expect(created.dom.innerHTML).toContain('\u26A0\uFE0F')
      expect(created.dom.innerHTML).toContain("Unknown variable 'foo'")
    } finally {
      view.destroy()
    }
  })

  it('returns tooltip for invalid_function (error style)', () => {
    const issues: ValidationIssue[] = [
      {
        type: 'invalid_function',
        from: 0,
        to: 5,
        message: "Invalid function 'eval'",
        identifier: 'eval',
      },
    ]
    const source = validationTooltipSource(issues)
    const view = createDummyView()
    try {
      const tooltip = source(view, 3)
      expect(tooltip).not.toBeNull()
      expect(tooltip!.pos).toBe(0)
      expect(tooltip!.end).toBe(5)
      expect(tooltip!.above).toBe(true)

      const created = tooltip!.create!(view)
      expect(created.dom.className).toBe('cm-validation-tooltip cm-validation-tooltip-red')
      expect(created.dom.innerHTML).toContain('\u26D4')
      expect(created.dom.innerHTML).toContain("Invalid function 'eval'")
    } finally {
      view.destroy()
    }
  })

  it('returns tooltip for blocked_function (error style)', () => {
    const issues: ValidationIssue[] = [
      {
        type: 'blocked_function',
        from: 2,
        to: 8,
        message: "Blocked function 'exec'",
        identifier: 'exec',
      },
    ]
    const source = validationTooltipSource(issues)
    const view = createDummyView()
    try {
      const tooltip = source(view, 5)
      expect(tooltip).not.toBeNull()

      const created = tooltip!.create!(view)
      expect(created.dom.className).toBe('cm-validation-tooltip cm-validation-tooltip-red')
      expect(created.dom.innerHTML).toContain('\u26D4')
    } finally {
      view.destroy()
    }
  })

  it('highlights suggestion text in cyan when issue has a suggestion', () => {
    const issues: ValidationIssue[] = [
      {
        type: 'unknown_variable',
        from: 0,
        to: 3,
        message: "Unknown variable 'foo'. Did you mean 'fooBar'?",
        identifier: 'foo',
        suggestion: 'fooBar',
      },
    ]
    const source = validationTooltipSource(issues)
    const view = createDummyView()
    try {
      const tooltip = source(view, 1)
      expect(tooltip).not.toBeNull()

      const created = tooltip!.create!(view)
      // The suggestion should be wrapped in a span with the suggestion class
      expect(created.dom.innerHTML).toContain(
        '<span class="cm-validation-tooltip-suggestion">fooBar</span>'
      )
      // The original quoted suggestion should be replaced
      expect(created.dom.innerHTML).not.toContain("'fooBar'")
    } finally {
      view.destroy()
    }
  })

  it('does not modify message when issue has no suggestion', () => {
    const issues: ValidationIssue[] = [
      {
        type: 'unknown_variable',
        from: 0,
        to: 3,
        message: "Unknown variable 'foo'",
        identifier: 'foo',
      },
    ]
    const source = validationTooltipSource(issues)
    const view = createDummyView()
    try {
      const tooltip = source(view, 2)
      expect(tooltip).not.toBeNull()

      const created = tooltip!.create!(view)
      expect(created.dom.innerHTML).toContain("Unknown variable 'foo'")
      expect(created.dom.innerHTML).not.toContain('cm-validation-tooltip-suggestion')
    } finally {
      view.destroy()
    }
  })

  it('matches at exact boundary positions (from and to)', () => {
    const issues: ValidationIssue[] = [
      {
        type: 'unknown_variable',
        from: 5,
        to: 10,
        message: 'Test issue',
        identifier: 'test',
      },
    ]
    const source = validationTooltipSource(issues)
    const view = createDummyView()
    try {
      // At exact from position
      const atFrom = source(view, 5)
      expect(atFrom).not.toBeNull()
      expect(atFrom!.pos).toBe(5)
      expect(atFrom!.end).toBe(10)

      // At exact to position
      const atTo = source(view, 10)
      expect(atTo).not.toBeNull()
      expect(atTo!.pos).toBe(5)
      expect(atTo!.end).toBe(10)
    } finally {
      view.destroy()
    }
  })

  it('returns the first matching issue when multiple issues overlap', () => {
    const issues: ValidationIssue[] = [
      {
        type: 'unknown_variable',
        from: 0,
        to: 10,
        message: 'First issue',
        identifier: 'first',
      },
      {
        type: 'invalid_function',
        from: 5,
        to: 15,
        message: 'Second issue',
        identifier: 'second',
      },
    ]
    const source = validationTooltipSource(issues)
    const view = createDummyView()
    try {
      // Position 7 is within both issues - should return the first one
      const tooltip = source(view, 7)
      expect(tooltip).not.toBeNull()

      const created = tooltip!.create!(view)
      // Should be warning style (from first issue, unknown_variable)
      expect(created.dom.className).toBe('cm-validation-tooltip cm-validation-tooltip-amber')
      expect(created.dom.innerHTML).toContain('First issue')
    } finally {
      view.destroy()
    }
  })

  it('leaves message unchanged when suggestion text is not found in message', () => {
    const issues: ValidationIssue[] = [
      {
        type: 'unknown_variable',
        from: 0,
        to: 3,
        message: 'Variable not found',
        identifier: 'foo',
        suggestion: 'bar',
      },
    ]
    const source = validationTooltipSource(issues)
    const view = createDummyView()
    try {
      const tooltip = source(view, 1)
      expect(tooltip).not.toBeNull()

      const created = tooltip!.create!(view)
      // The suggestion pattern 'bar' is not in the message as "'bar'",
      // so message stays unchanged
      expect(created.dom.innerHTML).toContain('Variable not found')
    } finally {
      view.destroy()
    }
  })
})
