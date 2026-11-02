/**
 * Expression Decorations Module
 *
 * Shared CodeMirror 6 decoration marks and highlighter plugin used by
 * expression editors and template editors for consistent highlighting
 * and validation display.
 *
 * Provides:
 * - Decoration marks for expression highlighting, unknown variables, and invalid functions
 * - createExpressionHighlighter: highlights entire document as an expression
 * - createTemplateHighlighter: highlights only {{ expr }} regions, same marks
 */

import { Decoration, type DecorationSet, ViewPlugin, type ViewUpdate, EditorView } from '@codemirror/view'
import { RangeSetBuilder } from '@codemirror/state'

// ============================================
// Decoration Marks
// ============================================

/** Cyan highlight for expression content */
export const expressionMark = Decoration.mark({ class: 'cm-expression' })

/** Amber wavy underline for unknown/unresolved variables */
export const unknownVariableMark = Decoration.mark({ class: 'cm-unknown-variable' })

/** Red wavy underline for invalid function calls */
export const invalidFunctionMark = Decoration.mark({ class: 'cm-invalid-function' })

// ============================================
// Types
// ============================================

/**
 * Unified issue for decorations - merges local and backend validation formats.
 * Positions are character offsets within the document.
 */
export interface DecorationIssue {
  from: number
  to: number
  severity: 'warning' | 'error'
}

// ============================================
// Highlighter Plugin
// ============================================

/**
 * Create the expression highlighter ViewPlugin factory.
 *
 * Highlights the entire document content with expressionMark since the content
 * IS the expression (raw Python). Also applies validation issue decorations
 * (warnings as amber underlines, errors as red underlines).
 *
 * Behavior:
 * - Returns Decoration.none for empty documents
 * - Clamps issue positions to document length to prevent crashes
 * - Skips issues where from >= to after clamping (zero-width ranges)
 * - Rebuilds decorations on document or viewport changes
 */
/** Map a severity to the corresponding decoration mark */
function markForSeverity(severity: DecorationIssue['severity']): Decoration {
  return severity === 'warning' ? unknownVariableMark : invalidFunctionMark
}

/**
 * Convert issues into clamped decoration ranges.
 * Shared by both expression and template highlighters.
 */
function issueRanges(
  issues: DecorationIssue[],
  docLength: number
): { from: number; to: number; mark: Decoration }[] {
  const ranges: { from: number; to: number; mark: Decoration }[] = []
  for (const issue of issues) {
    const from = Math.min(issue.from, docLength)
    const to = Math.min(issue.to, docLength)
    if (from < to) {
      ranges.push({ from, to, mark: markForSeverity(issue.severity) })
    }
  }
  return ranges
}

/**
 * Apply issue decorations to a RangeSetBuilder.
 * Shared by both expression and template highlighters.
 */
function _applyIssueDecorations(
  builder: RangeSetBuilder<Decoration>,
  issues: DecorationIssue[],
  docLength: number
) {
  for (const r of issueRanges(issues, docLength)) {
    builder.add(r.from, r.to, r.mark)
  }
}

/** Create a ViewPlugin with a custom buildDecorations function */
function _createHighlighterPlugin(
  buildFn: (view: EditorView) => DecorationSet,
) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet

      constructor(view: EditorView) {
        this.decorations = buildFn(view)
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = buildFn(update.view)
        }
      }
    },
    {
      decorations: (v) => v.decorations,
    }
  )
}

export function createExpressionHighlighter(issues: DecorationIssue[]) {
  return _createHighlighterPlugin((view) => {
    const doc = view.state.doc.toString()
    if (doc.length === 0) return Decoration.none
    const builder = new RangeSetBuilder<Decoration>()
    builder.add(0, doc.length, expressionMark)
    _applyIssueDecorations(builder, issues, doc.length)
    return builder.finish()
  })
}

// ============================================
// Template Highlighter
// ============================================

/**
 * Create a template highlighter ViewPlugin factory.
 *
 * Finds all {{ expr }} regions in the document and:
 * - Highlights expression content (between {{ and }}) with expressionMark
 * - Applies validation issue decorations (same marks as expression highlighter)
 *
 * Issues must have document-level positions (caller maps expression-local
 * offsets to document positions).
 */
export function createTemplateHighlighter(issues: DecorationIssue[]) {
  return _createHighlighterPlugin((view) => {
    const doc = view.state.doc.toString()
    if (doc.length === 0) return Decoration.none

    // Collect all decoration ranges, then sort by position
    // (RangeSetBuilder requires sorted, non-overlapping additions)
    const ranges: { from: number; to: number; mark: Decoration }[] = []

    // Highlight entire {{ expr }} regions including delimiters
    let searchFrom = 0
    while (searchFrom < doc.length) {
      const openIdx = doc.indexOf('{{', searchFrom)
      if (openIdx === -1) break
      const closeIdx = doc.indexOf('}}', openIdx + 2)
      /* v8 ignore next - COV-DEF-103 */
      if (closeIdx === -1) break
      const regionStart = openIdx
      const regionEnd = closeIdx + 2
      searchFrom = regionEnd
      if (regionStart < regionEnd) {
        ranges.push({ from: regionStart, to: regionEnd, mark: expressionMark })
      }
    }

    // Add issue decorations (reuse shared range mapper)
    ranges.push(...issueRanges(issues, doc.length))

    // Sort by position (required by RangeSetBuilder)
    ranges.sort((a, b) => a.from - b.from || a.to - b.to)

    const builder = new RangeSetBuilder<Decoration>()
    for (const r of ranges) {
      builder.add(r.from, r.to, r.mark)
    }
    return builder.finish()
  })
}
