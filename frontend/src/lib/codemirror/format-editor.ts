/**
 * Pure CodeMirror format core: per-format language + advisory linter extensions,
 * shared by the Text Editor Modal and the string inspect watcher. No feature
 * imports - the template stack (tree-sitter / expression-bound) is host-composed
 * and injected separately.
 *
 * REQ-3.1.3.11: Variable watching UI panel
 */

import { json, jsonParseLinter } from '@codemirror/lang-json'
import { python } from '@codemirror/lang-python'
import { MSSQL, MySQL, PLSQL, PostgreSQL, SQLite, type SQLDialect } from '@codemirror/lang-sql'
import { xml } from '@codemirror/lang-xml'
import { yaml } from '@codemirror/lang-yaml'
import { linter } from '@codemirror/lint'
import { syntaxHighlighting, defaultHighlightStyle, HighlightStyle } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { oneDarkHighlightStyle } from '@codemirror/theme-one-dark'
import jsYaml, { YAMLException } from 'js-yaml'
import type { Extension } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'

// The data formats own their token colors (the editor's plain-text base sets a
// flat content color, so the language alone renders untinted). Theme-aware so
// the tokens stay legible on both surfaces (defaultHighlightStyle reads poorly
// on dark - strings render near-black).
const LIGHT_HIGHLIGHT = syntaxHighlighting(defaultHighlightStyle)
const DARK_HIGHLIGHT = syntaxHighlighting(oneDarkHighlightStyle)

// PYRUN-13, SQL-10: only keywords, strings, numbers, comments and function names take a color.
const SCRIPT_LIGHT = syntaxHighlighting(
  HighlightStyle.define([
    { tag: tags.keyword, color: '#708' },
    { tag: [tags.string, tags.special(tags.string)], color: '#a11' },
    { tag: [tags.number, tags.bool, tags.null], color: '#164' },
    { tag: [tags.comment, tags.lineComment, tags.blockComment], color: '#940' },
    { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: '#00c' },
  ]),
)
const SCRIPT_DARK = syntaxHighlighting(
  HighlightStyle.define([
    { tag: tags.keyword, color: '#c678dd' },
    { tag: [tags.string, tags.special(tags.string)], color: '#98c379' },
    { tag: [tags.number, tags.bool, tags.null], color: '#e5c07b' },
    { tag: [tags.comment, tags.lineComment, tags.blockComment], color: '#7d8799' },
    { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: '#61afef' },
  ]),
)

// OS-12: an OpenSearch query also colors its field names, its wildcards and, muted, its brackets.
const QUERY_LIGHT = syntaxHighlighting(
  HighlightStyle.define([
    { tag: tags.propertyName, color: '#085' },
    { tag: tags.keyword, color: '#708' },
    { tag: tags.string, color: '#a11' },
    { tag: [tags.number, tags.bool, tags.null], color: '#164' },
    { tag: tags.operator, color: '#e40' },
    { tag: [tags.paren, tags.brace, tags.squareBracket], color: '#737373' },
  ]),
)
// Dark follows the app's dark editors (One Dark): a field or key reads in the property-name coral.
const QUERY_DARK = syntaxHighlighting(
  HighlightStyle.define([
    { tag: tags.propertyName, color: '#e06c75' },
    { tag: tags.keyword, color: '#c678dd' },
    { tag: tags.string, color: '#98c379' },
    { tag: tags.number, color: '#e5c07b' },
    { tag: [tags.bool, tags.null], color: '#d19a66' },
    { tag: tags.operator, color: '#56b6c2' },
    { tag: [tags.paren, tags.brace, tags.squareBracket], color: '#7d8799' },
  ]),
)

/** The OpenSearch query formats: a Query in DQL or Query DSL, and a Custom (JSON) aggregation. */
type QueryFormat = 'dql' | 'query-dsl' | 'aggregation-json'

/** The format a user may pick (Auto detects; Template suppresses data linters). */
export type TextFormat = 'auto' | 'json' | 'yaml' | 'xml' | 'plain' | 'template' | 'python' | 'sql' | QueryFormat

/** The resolved format used for syntax highlighting and linting; Auto never resolves to a script format. */
export type ResolvedFormat = 'json' | 'yaml' | 'xml' | 'plain' | 'python' | 'sql' | QueryFormat

/** The Database type of a SQL block. */
export type SqlDatabaseType = 'postgresql' | 'mysql' | 'oracle' | 'mssql' | 'sqlite'

const SQL_DIALECTS: Record<SqlDatabaseType, SQLDialect> = {
  postgresql: PostgreSQL,
  mysql: MySQL,
  oracle: PLSQL,
  mssql: MSSQL,
  sqlite: SQLite,
}

/** The editor dialect of a Database type. */
export function sqlDialectFor(databaseType: SqlDatabaseType): SQLDialect {
  return SQL_DIALECTS[databaseType]
}

// ============================================================================
// Linters (advisory)
// ============================================================================

export function yamlParseLinter() {
  return (view: EditorView) => {
    const content = view.state.doc.toString()
    if (!content.trim()) return []
    try {
      jsYaml.load(content)
      return []
    } catch (e) {
      if (e instanceof YAMLException && e.mark) {
        const pos = Math.min(e.mark.position, content.length)
        return [{
          from: pos,
          to: pos,
          severity: 'error' as const,
          message: e.reason || 'YAML syntax error',
        }]
      }
      return []
    }
  }
}

export function xmlParseLinter() {
  return (view: EditorView) => {
    const content = view.state.doc.toString()
    if (!content.trim()) return []
    const parser = new DOMParser()
    const doc = parser.parseFromString(content, 'application/xml')
    const errorNode = doc.querySelector('parsererror')
    if (!errorNode) return []
    // Extract error message, strip xmlns noise
    /* v8 ignore next - COV-JSDOM-017 */
    const message = (errorNode.textContent || 'XML syntax error')
      .replace(/Below is a rendering.*$/s, '')
      .trim()
    // Try to extract line/column from error message (format varies by browser)
    const lineMatch = /line\s+(\d+)/i.exec(message)
    const colMatch = /column\s+(\d+)/i.exec(message)
    let pos = 0
    /* v8 ignore next 5 - COV-JSDOM-014 */
    if (lineMatch) {
      const line = Math.min(Number.parseInt(lineMatch[1], 10), view.state.doc.lines)
      const lineObj = view.state.doc.line(line)
      pos = lineObj.from + (colMatch ? Math.min(Number.parseInt(colMatch[1], 10) - 1, lineObj.length) : 0)
    }
    return [{
      from: pos,
      to: pos,
      severity: 'error' as const,
      message,
    }]
  }
}

// ============================================================================
// Format Extensions (language + advisory linter)
// ============================================================================

/**
 * Language highlighting + advisory linter for a resolved format. Plain returns
 * the base only (no language, no linter); the linter is advisory and never gates.
 */
export function createFormatExtensions(format: ResolvedFormat, isDark = false): Extension[] {
  const highlight = isDark ? DARK_HIGHLIGHT : LIGHT_HIGHLIGHT
  switch (format) {
    case 'json':
      return [json(), highlight, linter(jsonParseLinter())]
    case 'yaml':
      return [yaml(), highlight, linter(yamlParseLinter())]
    case 'xml':
      return [xml(), highlight, linter(xmlParseLinter())]
    // No advisory linter: the Python syntax check is host-composed (PYRUN-13).
    case 'python':
      return [python(), isDark ? SCRIPT_DARK : SCRIPT_LIGHT]
    // The dialect and the checks are host-composed (SQL-10).
    case 'sql':
      return [isDark ? SCRIPT_DARK : SCRIPT_LIGHT]
    // The language and the checks are host-composed (OS-12).
    case 'dql':
    case 'query-dsl':
    case 'aggregation-json':
      return [isDark ? QUERY_DARK : QUERY_LIGHT]
    case 'plain':
      return []
  }
}
