/**
 * The SQL body's suggestion source: each kind of suggestion only in its place (SQL-11, SQL-12).
 *
 * REQ-3.4.1.6: SQL database operations
 */

import type {
  Completion,
  CompletionContext,
  CompletionResult,
  CompletionSection,
} from '@codemirror/autocomplete'
import { keywordCompletionSource } from '@codemirror/lang-sql'

import type { SqlTable } from '@/features/workbench/api/sql-tools'
import { findSqlTable } from '@/features/workbench/lib/sql-script-validation/check-sql'
import {
  isSqlName,
  lexSql,
  sameSqlName,
  sqlNameOf,
  sqlTableNameStarts,
  type SqlToken,
} from '@/features/workbench/lib/sql-script-validation/sql-tokens'
import { sqlDialectFor, type SqlDatabaseType } from '@/lib/codemirror/format-editor'
import { SQL_GET_TABLES_TYPE, SQL_PARAMETER_TYPE } from './sql-mode'
import {
  createSectionHeader,
  createTemplateCompletionSource,
  type AvailableVariable,
} from './expression-completion'

export interface SqlCompletionOptions {
  databaseType: SqlDatabaseType
  /** Parameters entry names in row order; null while Parameters is an expression. */
  parameterNames: readonly string[] | null
  /** Loaded tables; null while nothing is loaded. */
  tables: readonly SqlTable[] | null
  /** WAVE variables offered inside {{ }}. */
  variables: AvailableVariable[]
  /** The body is Template kind: {{ }} regions are expressions. */
  template: boolean
  /** The Get tables action row: starts (or joins) the catalog pull. */
  onGetTables: () => void
}

type SqlCompletionSource = (context: CompletionContext) => CompletionResult | null

const GET_TABLES_LABEL = 'Get tables from the database'

function sectionHeader(section: CompletionSection): HTMLElement {
  return createSectionHeader(section.name)
}

const TABLES_SECTION: CompletionSection = { name: 'Tables', header: sectionHeader }
const PARAMETERS_SECTION: CompletionSection = { name: 'Parameters', header: sectionHeader }

function getTablesRow(pos: number, onGetTables: () => void): CompletionResult {
  const option: Completion = {
    label: GET_TABLES_LABEL,
    type: SQL_GET_TABLES_TYPE,
    section: TABLES_SECTION,
    apply: () => {
      onGetTables()
    },
  }
  return { from: pos, options: [option] }
}

function tableRows(from: number, tables: readonly SqlTable[]): CompletionResult {
  return {
    from,
    options: tables.map((table) => ({ label: table.name, type: 'type', section: TABLES_SECTION })),
  }
}

function columnRows(from: number, table: SqlTable): CompletionResult {
  return {
    from,
    options: table.columns.map((column) => ({
      label: column.name,
      type: 'property',
      section: TABLES_SECTION,
    })),
  }
}

function parameterRows(from: number, parameterNames: readonly string[] | null): CompletionResult | null {
  const names = parameterNames ?? []
  return names.length > 0
    ? {
        from,
        options: names.map((name) => ({
          label: name,
          type: SQL_PARAMETER_TYPE,
          section: PARAMETERS_SECTION,
        })),
      }
    : null
}

/** The names before the dot at `dotIndex`: `table`, or `schema.table`. */
function qualifierBefore(tokens: readonly SqlToken[], dotIndex: number): string[] {
  const names: string[] = []
  for (let at = dotIndex - 1; isSqlName(tokens[at]); at -= 2) {
    names.unshift(sqlNameOf(tokens[at]))
    if (tokens[at - 1]?.text !== '.') break
  }
  return names
}

/** After `table.` its columns; after `schema.` that schema's tables; after any other name nothing. */
function memberRows(
  names: readonly string[],
  schema: string,
  from: number,
  pos: number,
  options: SqlCompletionOptions,
): CompletionResult | null {
  if (!options.tables) return getTablesRow(pos, options.onGetTables)
  const table = findSqlTable(options.tables, names)
  if (table) return columnRows(from, table)
  const schemaTables = options.tables.filter((candidate) => sameSqlName(candidate.schema, schema))
  return schemaTables.length > 0 ? tableRows(from, schemaTables) : null
}

/** The SQL body's suggestions: variables inside {{ }}, Parameters after `:`, tables and columns where a name goes, keywords elsewhere. */
export function createSqlCompletionSource(options: SqlCompletionOptions): SqlCompletionSource {
  // lang-sql's keyword source answers synchronously.
  const keywords = keywordCompletionSource(
    sqlDialectFor(options.databaseType),
    true,
  ) as SqlCompletionSource
  const templates = createTemplateCompletionSource(options.variables, true)

  return (context) => {
    const { pos } = context
    const text = context.state.doc.sliceString(0, pos)
    const { tokens, open } = lexSql(text, options.databaseType)
    if (open === 'template' && options.template) return templates(context)
    if (open !== null) return keywords(context)

    const last = tokens.at(-1)
    if (last?.kind === 'placeholder' && last.to === pos) {
      return parameterRows(last.from + 1, options.parameterNames)
    }
    if (last?.text === ':' && last.to === pos && text[pos - 2] !== ':') {
      return parameterRows(pos, options.parameterNames)
    }

    const partial = isSqlName(last) && last.to === pos ? last : undefined
    const before = tokens.length - (partial ? 2 : 1)
    const from = partial?.from ?? pos
    const beforeToken: SqlToken | undefined = tokens[before]
    const beforeDot: SqlToken | undefined = tokens[before - 1]
    if (beforeToken?.text === '.' && beforeToken.to === from && isSqlName(beforeDot)) {
      return memberRows(qualifierBefore(tokens, before), sqlNameOf(beforeDot), from, pos, options)
    }
    if (sqlTableNameStarts(tokens).has(before + 1)) {
      return options.tables ? tableRows(from, options.tables) : getTablesRow(pos, options.onGetTables)
    }
    return keywords(context)
  }
}
