/**
 * Python-mode CodeMirror extension bundle for a script body (PYRUN-13, PYRUN-18).
 *
 * The bundle carries the editor facilities and the keymap only. The language
 * itself is composed by the host through the format-extension factory.
 */

import { EditorState, RangeSetBuilder, type Extension, type Text } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view'
import { foldGutter, indentOnInput, indentUnit } from '@codemirror/language'
import { highlightSelectionMatches } from '@codemirror/search'

import { invalidFunctionMark, unknownVariableMark } from './expression-decorations'
import { buildScriptBodyExtensions } from '@/features/workbench/lib/codemirror/script-body'
import {
  isScriptWarning,
  type ScriptIssue,
} from '@/features/workbench/lib/python-script-validation/script-issues'

// ============================================
// Types
// ============================================

export interface PythonModeOptions {
  issues: ScriptIssue[]
}

// ============================================
// Issue underlines
// ============================================

interface MarkedRange {
  from: number
  to: number
  mark: Decoration
}

/** A syntax error marks its whole line; a check warning its own span, as the expression field marks it. */
function issueRange(doc: Text, issue: ScriptIssue): MarkedRange | null {
  if (isScriptWarning(issue)) {
    const to = Math.min(issue.to, doc.length)
    const mark =
      'type' in issue && issue.type === 'unknown_variable' ? unknownVariableMark : invalidFunctionMark
    return issue.from < to ? { from: issue.from, to, mark } : null
  }
  if (issue.line < 1 || issue.line > doc.lines) return null
  const line = doc.line(issue.line)
  return line.from < line.to ? { from: line.from, to: line.to, mark: invalidFunctionMark } : null
}

function issueDecorations(doc: Text, issues: ScriptIssue[]): DecorationSet {
  const ranges: MarkedRange[] = []
  for (const issue of issues) {
    const range = issueRange(doc, issue)
    if (range) ranges.push(range)
  }
  ranges.sort((a, b) => a.from - b.from)

  const builder = new RangeSetBuilder<Decoration>()
  for (const range of ranges) {
    builder.add(range.from, range.to, range.mark)
  }
  return builder.finish()
}

function createIssueHighlighter(issues: ScriptIssue[]): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet

      constructor(view: EditorView) {
        this.decorations = issueDecorations(view.state.doc, issues)
      }

      update(update: ViewUpdate) {
        this.decorations = issueDecorations(update.state.doc, issues)
      }
    },
    { decorations: (plugin) => plugin.decorations }
  )
}

// ============================================
// Extension bundle
// ============================================

const PYTHON_LANGUAGE_DATA = [{ commentTokens: { line: '#' } }]

export function buildPythonModeExtensions(options: PythonModeOptions): Extension[] {
  return [
    ...buildScriptBodyExtensions(),
    foldGutter(),
    highlightSelectionMatches(),
    indentOnInput(),
    indentUnit.of('    '),
    EditorState.languageData.of(() => PYTHON_LANGUAGE_DATA),
    createIssueHighlighter(options.issues),
  ]
}
