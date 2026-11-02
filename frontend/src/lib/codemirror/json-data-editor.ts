/**
 * JSON Data Editor Extensions Factory
 *
 * Shared CodeMirror 6 extensions configuration for the array, table, and map
 * data editors. All data editors use identical editor settings (JSON language,
 * linting, folding, line numbers, font styling, readOnly toggle), so this
 * factory eliminates that repetition.
 *
 * Usage:
 *   const extensions = createJsonDataEditorExtensions({ readOnly: true })
 *   const state = EditorState.create({ doc: '{"key": "value"}', extensions })
 */

import { json, jsonParseLinter } from '@codemirror/lang-json'
import { foldGutter } from '@codemirror/language'
import { linter, type Diagnostic } from '@codemirror/lint'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, lineNumbers } from '@codemirror/view'

export interface JsonDataEditorOptions {
  readOnly?: boolean
  lineNumbers?: boolean
  /** Grammar-aware lint pre-processor: rewrites the doc (e.g. masking bare
   *  {{ }} tokens to same-length strings) before the JSON linter runs, so an
   *  extended grammar validates while error positions stay on the raw text. */
  jsonMask?: (text: string) => string
}

/**
 * Format a JSON.parse failure the way the editor's lint hover does (the raw
 * V8/SpiderMonkey message), prefixed with the 1-based line when one is known.
 * V8 appends " in JSON at position N (line L column C)" - that tail is lifted into
 * the line prefix and trimmed from the message so it does not read twice.
 */
export function describeJsonError(text: string, error: unknown): string {
  const raw = error instanceof Error ? error.message : 'Invalid JSON'
  const lineCol = /\(line (\d+) column \d+\)/.exec(raw)
  const position = /at position (\d+)/.exec(raw)
  let line: number | null = null
  if (lineCol) {
    line = Number(lineCol[1])
  } else if (position) {
    const offset = Math.min(Number(position[1]), text.length)
    line = text.slice(0, offset).split('\n').length
  }
  // Strip V8's " in JSON at position N ..." tail (literal match avoids ReDoS).
  const tail = / in JSON at position \d/.exec(raw)
  const message = tail ? raw.slice(0, tail.index) : raw
  return line === null ? message : `Line ${line}: ${message}`
}

const isJsonWhitespace = (ch: string): boolean =>
  ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n'

/** True when, skipping JSON whitespace from `from`, the next character is a colon
 *  - i.e. the string that just closed was an object key, not a value. */
function followedByColon(text: string, from: number): boolean {
  let j = from
  while (j < text.length && isJsonWhitespace(text[j])) j++
  return text[j] === ':'
}

/** A token surfaced by scanJsonTokens: the start of a top-level array element, or
 *  an object key carrying its nesting depth so callers can target a level. */
type JsonToken =
  | { type: 'element'; index: number; line: number }
  | { type: 'key'; name: string; depth: number; line: number }

interface ScanCursor {
  depth: number
  inString: boolean
  escaped: boolean
  line: number
  rootOpened: boolean
  rootIsArray: boolean
  awaitingElement: boolean
  elementIndex: number
  stringStart: number
  stringLine: number
}

function newCursor(): ScanCursor {
  return {
    depth: 0,
    inString: false,
    escaped: false,
    line: 1,
    rootOpened: false,
    rootIsArray: false,
    awaitingElement: false,
    elementIndex: -1,
    stringStart: -1,
    stringLine: 0,
  }
}

/** Within a string: consume one char, returning a key token when the string
 *  closes on an object key (a string immediately followed by a colon), else null. */
function stepInString(text: string, i: number, c: ScanCursor): JsonToken | null {
  const ch = text[i]
  if (c.escaped) {
    c.escaped = false
    return null
  }
  if (ch === '\\') {
    c.escaped = true
    return null
  }
  if (ch !== '"') return null
  c.inString = false
  const name = text.slice(c.stringStart + 1, i)
  return followedByColon(text, i + 1)
    ? { type: 'key', name, depth: c.depth, line: c.stringLine }
    : null
}

/** True at the first character of a fresh top-level array element. */
function atElementStart(ch: string, c: ScanCursor): boolean {
  return (
    c.rootIsArray &&
    c.depth === 1 &&
    c.awaitingElement &&
    !isJsonWhitespace(ch) &&
    ch !== ']'
  )
}

/** Apply a structural (non-string) character to the cursor: open / close brackets,
 *  the root container, and top-level element separators. */
function applyStructural(ch: string, c: ScanCursor): void {
  if (ch === '[' || ch === '{') {
    if (c.rootOpened) {
      c.depth++
    } else {
      c.rootOpened = true
      c.rootIsArray = ch === '['
      c.depth = 1
      c.awaitingElement = c.rootIsArray
    }
  } else if (ch === ']' || ch === '}') {
    c.depth--
  } else if (ch === ',' && c.depth === 1 && c.rootIsArray) {
    c.awaitingElement = true
  }
}

/** Outside a string: consume one char, returning an element token when a new
 *  top-level element begins, else null. */
function stepStructural(text: string, i: number, c: ScanCursor): JsonToken | null {
  const ch = text[i]
  let token: JsonToken | null = null
  if (atElementStart(ch, c)) {
    c.elementIndex++
    c.awaitingElement = false
    token = { type: 'element', index: c.elementIndex, line: c.line }
  }
  if (ch === '"') {
    c.inString = true
    c.stringStart = i
    c.stringLine = c.line
  } else {
    applyStructural(ch, c)
  }
  return token
}

/** Walk JSON text (depth + string aware), yielding element-start and object-key
 *  tokens. The root container type is detected from its first bracket, so one scan
 *  serves a top-level array (element / cell lookups) and a top-level object
 *  (member lookups); brackets inside strings never miscount. */
function* scanJsonTokens(text: string): Generator<JsonToken> {
  const c = newCursor()
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '\n') {
      c.line++
      continue
    }
    if (c.inString) {
      const key = stepInString(text, i, c)
      if (key) yield key
      continue
    }
    const element = stepStructural(text, i, c)
    if (element) yield element
  }
}

/**
 * The 1-based line where the `column` key of the `rowIndex`-th top-level array
 * element sits, or null when the cell cannot be located. Used to point a table
 * cell error at its exact line in the Code editor.
 */
export function jsonCellLine(text: string, rowIndex: number, column: string): number | null {
  let inTargetRow = false
  for (const token of scanJsonTokens(text)) {
    if (token.type === 'element') {
      inTargetRow = token.index === rowIndex
    } else if (inTargetRow && token.depth === 2 && token.name === column) {
      return token.line
    }
  }
  return null
}

/** The 1-based line where the `index`-th top-level array element begins, or null.
 *  Points an array item's Code error at its line. */
export function jsonElementLine(text: string, index: number): number | null {
  for (const token of scanJsonTokens(text)) {
    if (token.type === 'element' && token.index === index) return token.line
  }
  return null
}

/** The 1-based line where the top-level object member `key` sits, or null. Points
 *  a map value's Code error at its line. */
export function jsonMemberLine(text: string, key: string): number | null {
  for (const token of scanJsonTokens(text)) {
    if (token.type === 'key' && token.depth === 1 && token.name === key) return token.line
  }
  return null
}

/** A JSON lint source that validates a grammar-masked copy of the doc; the mask
 *  is same-length so the diagnostics' positions stay on the original text. */
export function maskedJsonLintSource(
  mask: (text: string) => string,
): (view: EditorView) => readonly Diagnostic[] {
  const base = jsonParseLinter()
  return (view) =>
    base({
      state: EditorState.create({ doc: mask(view.state.doc.toString()) }),
    } as unknown as EditorView)
}

export function createJsonDataEditorExtensions(
  options: JsonDataEditorOptions = {}
): Extension[] {
  const { readOnly = false, lineNumbers: showLineNumbers = true, jsonMask } = options

  const activeLinter = jsonMask
    ? linter(maskedJsonLintSource(jsonMask))
    : linter(jsonParseLinter())

  const extensions: Extension[] = [
    json(),
    activeLinter,
    foldGutter(),
    EditorView.theme({
      '&': {
        fontSize: '13px',
        fontFamily: 'ui-monospace, monospace',
      },
      '.cm-content': {
        padding: '8px',
      },
      '&.cm-focused': {
        outline: 'none',
      },
    }),
  ]

  if (showLineNumbers) {
    extensions.push(lineNumbers())
  }

  if (readOnly) {
    extensions.push(EditorState.readOnly.of(true))
  }

  return extensions
}
