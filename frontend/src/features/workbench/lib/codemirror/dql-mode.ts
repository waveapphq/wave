/**
 * DQL-mode CodeMirror bundle for the OpenSearch Query row; the host adds line numbers, colors and suggestions (OS-12).
 *
 * REQ-3.3.2.6: OpenSearch query editor
 */

import { StreamLanguage, type StringStream } from '@codemirror/language'
import type { Extension } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'

import { expressionHighlightTheme } from '@/features/workbench/lib/codemirror/expression-theme'
import {
  createTemplateHighlighter,
  type DecorationIssue,
} from '@/features/workbench/lib/codemirror/expression-decorations'
import {
  buildScriptBodyExtensions,
  databaseIconTheme,
  viewRefPlugin,
  warningHighlighter,
} from '@/features/workbench/lib/codemirror/script-body'
import type { ScriptIssue } from '@/features/workbench/lib/python-script-validation/script-issues'

export interface DqlModeOptions {
  issues: readonly ScriptIssue[]
  /** Template kind: each {{ }} region takes the highlight every Template body gives it. */
  template?: boolean
  /** Receives the editor view while it is mounted, null after it is destroyed. */
  viewRef?: { current: EditorView | null }
}

/** The completion type of the Get fields row, drawn with the Database icon. */
export const OPENSEARCH_GET_FIELDS_TYPE = 'opensearch-get-fields'

const getFieldsIconTheme = databaseIconTheme(OPENSEARCH_GET_FIELDS_TYPE)

// A term runs to whitespace, a quote, a bracket, a wildcard, a colon or a range operator; `\` escapes one character.
const TERM = /^(?:\\.|[^\s"(){}*:<>\\])+/
const KEYWORD = /^(?:and|or|not)$/i
const FIELD_END = /^\s*[:<>]/
const RANGE_OPERATOR = /^[<>]=?/
const VALUE_START = /[:<>=]\s*$/
const PHRASE = /^"(?:\\.|[^"\\])*"?/
const TOKENS: Readonly<Record<string, string>> = {
  '(': 'paren',
  ')': 'paren',
  '{': 'brace',
  '}': 'brace',
  '*': 'operator',
}

/** Fields before `:` or a range operator, `and` / `or` / `not` in any case, quoted phrases, `*` and brackets. */
function dqlToken(stream: StringStream): string | null {
  if (stream.eatSpace()) return null
  if (stream.match(PHRASE)) return 'string'
  const term = stream.match(TERM) as RegExpMatchArray | null
  if (term) {
    if (KEYWORD.test(term[0])) return 'keyword'
    if (stream.match(FIELD_END, false)) return 'propertyName'
    // A dotted name still being typed where a field goes reads as a field already.
    return term[0].endsWith('.') && !VALUE_START.test(stream.string.slice(0, stream.start)) ? 'propertyName' : null
  }
  if (stream.match(RANGE_OPERATOR)) return null
  return TOKENS[stream.next() as string] ?? null
}

const dqlLanguage = StreamLanguage.define({ name: 'dql', token: dqlToken })

// The body's own warning underlines already cover what the {{ }} check finds.
const NO_TEMPLATE_ISSUES: DecorationIssue[] = []

/** The base every OpenSearch query body builds on; each mode brings its language. */
export function buildQueryBodyExtensions(language: Extension, options: DqlModeOptions): Extension[] {
  return [
    language,
    ...buildScriptBodyExtensions(),
    expressionHighlightTheme,
    getFieldsIconTheme,
    warningHighlighter(options.issues),
    ...(options.template ? [createTemplateHighlighter(NO_TEMPLATE_ISSUES)] : []),
    ...(options.viewRef ? [viewRefPlugin(options.viewRef)] : []),
  ]
}

export function buildDqlModeExtensions(options: DqlModeOptions): Extension[] {
  return buildQueryBodyExtensions(dqlLanguage, options)
}
