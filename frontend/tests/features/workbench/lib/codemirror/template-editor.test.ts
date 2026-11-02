/**
 * Tests for the host-composed template extension builder. The isTemplateMode
 * branch of the Text Editor Modal's buildEditorExtensions is extracted here so
 * the inspect-modal host can inject the same {{expr}} autocomplete + highlight +
 * tooltip stack into the shared string editor.
 *
 * Contract under test:
 *   - returns a valid CodeMirror Extension[] (autocomplete + keymaps base)
 *   - includes the caller-supplied highlighter + tooltip when provided
 *   - omits them when null (both ternary branches)
 *
 * REQ-3.1.3.11: Variable watching UI panel
 * REQ-3.1.3.13: Computed variables with expressions and runtime evaluation
 */

import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import type { CompletionContext } from '@codemirror/autocomplete'

import { buildTemplateExtensions } from '@/features/workbench/lib/codemirror/template-editor'

const completionSource = (_context: CompletionContext) => null

describe('buildTemplateExtensions', () => {
  it('builds the autocomplete + keymap base usable in an EditorState', () => {
    const extensions = buildTemplateExtensions({
      completionSource,
      templateHighlighter: null,
      templateTooltip: null,
    })
    expect(Array.isArray(extensions)).toBe(true)
    expect(extensions.length).toBeGreaterThan(0)
    expect(() =>
      EditorState.create({ doc: '{{x}}', extensions }),
    ).not.toThrow()
  })

  it('includes the highlighter and tooltip when both are provided', () => {
    const templateHighlighter = EditorView.theme({ '.template-hl': {} })
    const templateTooltip = EditorView.theme({ '.template-tt': {} })
    const extensions = buildTemplateExtensions({
      completionSource,
      templateHighlighter,
      templateTooltip,
    })
    expect(extensions).toContain(templateHighlighter)
    expect(extensions).toContain(templateTooltip)
    expect(() =>
      EditorState.create({ doc: '{{x}}', extensions }),
    ).not.toThrow()
  })

  it('omits the highlighter and tooltip when both are null', () => {
    const templateHighlighter = EditorView.theme({ '.template-hl': {} })
    const templateTooltip = EditorView.theme({ '.template-tt': {} })
    const withBoth = buildTemplateExtensions({
      completionSource,
      templateHighlighter,
      templateTooltip,
    })
    const withNeither = buildTemplateExtensions({
      completionSource,
      templateHighlighter: null,
      templateTooltip: null,
    })
    expect(withNeither).not.toContain(templateHighlighter)
    expect(withNeither).not.toContain(templateTooltip)
    expect(withBoth.length).toBe(withNeither.length + 2)
  })
})
