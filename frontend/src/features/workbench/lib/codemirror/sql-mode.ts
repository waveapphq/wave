/**
 * SQL-mode CodeMirror bundle for a SQL body; the host adds line numbers and suggestions (SQL-10, SQL-12).
 */

import { sql } from '@codemirror/lang-sql'
import type { Extension } from '@codemirror/state'
import { Decoration, EditorView } from '@codemirror/view'

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
import { findSqlPlaceholders } from '@/features/workbench/lib/sql-script-validation/check-sql'
import { sqlDialectFor, type SqlDatabaseType } from '@/lib/codemirror/format-editor'

export interface SqlModeOptions {
  databaseType: SqlDatabaseType
  issues: readonly ScriptIssue[]
  /** Template kind: each {{ }} region takes the highlight every Template body gives it. */
  template?: boolean
  /** Receives the editor view while it is mounted, null after it is destroyed. */
  viewRef?: { current: EditorView | null }
}

/** Completion types whose icons the SQL body draws: a `:` for a Parameters entry, a database for Get tables. */
export const SQL_PARAMETER_TYPE = 'sql-parameter'
export const SQL_GET_TABLES_TYPE = 'sql-get-tables'

/** The : of a Parameters row, drawn in CodeMirror's own completion icon slot. */
const sqlParameterIconTheme = EditorView.theme({
  [`.cm-completionIcon-${SQL_PARAMETER_TYPE}::after`]: { content: '":"' },
})

const getTablesIconTheme = databaseIconTheme(SQL_GET_TABLES_TYPE)

// A placeholder takes the class, and so the color, the expression editors give a variable.
const placeholderMark = Decoration.mark({ class: 'cm-sql-placeholder cm-expression' })

// The body's own warning underlines already cover what the {{ }} check finds.
const NO_TEMPLATE_ISSUES: DecorationIssue[] = []

function placeholderHighlighter(databaseType: SqlDatabaseType): Extension {
  return EditorView.decorations.compute(['doc'], (state) =>
    Decoration.set(
      findSqlPlaceholders(state.doc.toString(), databaseType).map((placeholder) =>
        placeholderMark.range(placeholder.from, placeholder.to),
      ),
    ),
  )
}

export function buildSqlModeExtensions(options: SqlModeOptions): Extension[] {
  return [
    sql({ dialect: sqlDialectFor(options.databaseType), upperCaseKeywords: true }),
    ...buildScriptBodyExtensions(),
    expressionHighlightTheme,
    sqlParameterIconTheme,
    getTablesIconTheme,
    placeholderHighlighter(options.databaseType),
    warningHighlighter(options.issues),
    ...(options.template ? [createTemplateHighlighter(NO_TEMPLATE_ISSUES)] : []),
    ...(options.viewRef ? [viewRefPlugin(options.viewRef)] : []),
  ]
}
