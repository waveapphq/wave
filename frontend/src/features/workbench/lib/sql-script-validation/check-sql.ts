/**
 * The SQL editor's local checks and the mapping of the server's findings to warnings (SQL-2, SQL-10, SQL-12).
 *
 * REQ-3.4.1.6: SQL database operations
 */

import type { SqlCheckIssue, SqlTable } from '@/features/workbench/api/sql-tools'
import type { AvailableVariable } from '@/features/workbench/lib/codemirror/type-inference'
import { validateExpressions } from '@/features/workbench/lib/expression-validation/validation'
import type { ScriptWarning } from '@/features/workbench/lib/python-script-validation/script-issues'
import type { SqlDatabaseType } from '@/lib/codemirror/format-editor'
import {
  isSqlName,
  lexSql,
  sameSqlName,
  sqlNameOf,
  sqlTableNameStarts,
  type SqlToken,
} from './sql-tokens'

export interface SqlCheckInput {
  databaseType: SqlDatabaseType
  parameterNames: readonly string[] | null
  tables: readonly SqlTable[] | null
  variables: readonly AvailableVariable[]
  template: boolean
}

export interface SqlPlaceholder {
  name: string
  from: number
  to: number
  line: number
}

const NO_TOKENS: ReadonlySet<SqlToken> = new Set()

/** In an Oracle trigger these name the row being changed, not a Parameters entry. */
const TRIGGER_ROWS: ReadonlySet<string> = new Set(['new', 'old'])

const TRIGGER_HEAD = /^CREATE (OR REPLACE )?((NON)?EDITIONABLE )?TRIGGER\b/

/** The database types whose DUAL is a table every script can read. */
const DUAL_TYPES: ReadonlySet<SqlDatabaseType> = new Set(['oracle', 'mysql'])

/** Bare where a table name goes, one of these means the name is not written yet (SQL-12). */
const CLAUSE_KEYWORDS: ReadonlySet<string> = new Set([
  'AND',
  'AS',
  'CROSS',
  'DEFAULT',
  'DELETE',
  'EXCEPT',
  'FETCH',
  'FOR',
  'FROM',
  'FULL',
  'GROUP',
  'HAVING',
  'INNER',
  'INSERT',
  'INTERSECT',
  'INTO',
  'JOIN',
  'LEFT',
  'LIMIT',
  'MINUS',
  'NATURAL',
  'NOT',
  'OFFSET',
  'ON',
  'OR',
  'ORDER',
  'OUTER',
  'RETURNING',
  'RIGHT',
  'SELECT',
  'SET',
  'TABLE',
  'TOP',
  'UNION',
  'UPDATE',
  'USING',
  'VALUES',
  'WHERE',
  'WINDOW',
  'WITH',
])

type LineOf = (offset: number) => number

/** The 1-based line of an offset, found by binary search over the line starts. */
function lineLookup(doc: string): LineOf {
  const starts = [0]
  for (let at = doc.indexOf('\n'); at >= 0; at = doc.indexOf('\n', at + 1)) starts.push(at + 1)
  return (offset) => {
    let low = 0
    let high = starts.length - 1
    while (low < high) {
      const mid = Math.ceil((low + high) / 2)
      if (starts[mid] <= offset) low = mid
      else high = mid - 1
    }
    return low + 1
  }
}

function warningAt(line: number, message: string, from: number, to: number): ScriptWarning {
  return { line, message, severity: 'warning', from, to }
}

/** The loaded table a name, optionally schema-qualified, refers to (case-insensitive). */
export function findSqlTable(
  tables: readonly SqlTable[],
  names: readonly string[],
): SqlTable | undefined {
  const name = names.at(-1)
  if (name === undefined) return undefined
  const schema = names.at(-2) ?? null
  return tables.find(
    (table) =>
      sameSqlName(table.name, name) && (schema === null || sameSqlName(table.schema, schema)),
  )
}

/** The tokens of every Oracle trigger statement, which runs up to its / line. */
function oracleTriggerTokens(tokens: readonly SqlToken[]): ReadonlySet<SqlToken> {
  const inside = new Set<SqlToken>()
  let statementStart = true
  let trigger = false
  tokens.forEach((token, index) => {
    if (token.kind === 'separator') {
      statementStart = true
      trigger = false
      return
    }
    if (statementStart) {
      const head = tokens.slice(index, index + 5).map((word) => word.text.toUpperCase())
      trigger = TRIGGER_HEAD.test(head.join(' '))
    }
    if (trigger) inside.add(token)
    statementStart = !trigger && token.text === ';'
  })
  return inside
}

function placeholdersOf(
  tokens: readonly SqlToken[],
  databaseType: SqlDatabaseType,
  lineOf: LineOf,
): SqlPlaceholder[] {
  const triggerBody = databaseType === 'oracle' ? oracleTriggerTokens(tokens) : NO_TOKENS
  return tokens
    .filter(
      (token) =>
        token.kind === 'placeholder' &&
        !(triggerBody.has(token) && TRIGGER_ROWS.has(token.text.slice(1).toLowerCase())),
    )
    .map((token) => ({
      name: token.text.slice(1),
      from: token.from,
      to: token.to,
      line: lineOf(token.from),
    }))
}

/** Every `:name` placeholder of a script, in document order, read by the rules of the Database type. */
export function findSqlPlaceholders(doc: string, databaseType: SqlDatabaseType): SqlPlaceholder[] {
  return placeholdersOf(lexSql(doc, databaseType).tokens, databaseType, lineLookup(doc))
}

function parameterFindings(
  placeholders: readonly SqlPlaceholder[],
  parameterNames: readonly string[],
): ScriptWarning[] {
  const entries = new Set(parameterNames)
  const used = new Set(placeholders.map((placeholder) => placeholder.name))
  const unused = [...entries]
    .filter((name) => !used.has(name))
    .map((name) => warningAt(0, `Parameter '${name}' is defined but not used in the SQL`, 0, 0))
  const undefinedUses = placeholders
    .filter((placeholder) => !entries.has(placeholder.name))
    .map((placeholder) =>
      warningAt(
        placeholder.line,
        `Parameter '${placeholder.name}' is used in the SQL but not defined`,
        placeholder.from,
        placeholder.to,
      ),
    )
  return [...unused, ...undefinedUses]
}

/** The last statement holding more than its `;`: GO and / lines separate, and `;` splits every piece. */
function lastStatement(tokens: readonly SqlToken[]): SqlToken[] | undefined {
  let current: SqlToken[] = []
  const statements = [current]
  for (const token of tokens) {
    if (token.kind !== 'separator') current.push(token)
    if (token.kind === 'separator' || token.text === ';') {
      current = []
      statements.push(current)
    }
  }
  return statements.findLast((statement) => statement.some((token) => token.text !== ';'))
}

function sessionStateEnd(doc: string, tokens: readonly SqlToken[], lineOf: LineOf): ScriptWarning[] {
  const statement = lastStatement(tokens)
  const last = statement?.at(-1)
  if (!statement || !last) return []
  const [first, second] = statement.slice(0, 2).map((token) => token.text.toUpperCase())
  if (first !== 'USE' && first !== 'SET' && !(first === 'ALTER' && second === 'SESSION')) {
    return []
  }
  const from = statement[0].from
  const to = last.to
  const lead = doc.slice(from, to).replace(/;$/, '').split(/\s+/).slice(0, 2).join(' ')
  return [warningAt(lineOf(from), `${lead} ends the script; its effect ends with the block`, from, to)]
}

/** The name after `index`, with its schema when it is written `schema.name`. */
function dottedNameAt(tokens: readonly SqlToken[], index: number): SqlToken[] {
  const parts: SqlToken[] = []
  for (let at = index; isSqlName(tokens[at]); at += 2) {
    parts.push(tokens[at])
    if (tokens[at + 1]?.text !== '.') break
  }
  return parts
}

function isDual(databaseType: SqlDatabaseType, names: readonly string[]): boolean {
  return DUAL_TYPES.has(databaseType) && names.length === 1 && sameSqlName(names[0], 'dual')
}

/** A quoted keyword is a name; a bare one is SQL. */
function isClauseKeyword(token: SqlToken): boolean {
  return token.kind === 'word' && CLAUSE_KEYWORDS.has(token.text.toUpperCase())
}

function tableFindings(
  tokens: readonly SqlToken[],
  tables: readonly SqlTable[],
  databaseType: SqlDatabaseType,
  lineOf: LineOf,
): ScriptWarning[] {
  const found: ScriptWarning[] = []
  for (const start of sqlTableNameStarts(tokens)) {
    const parts = dottedNameAt(tokens, start)
    const names = parts.map(sqlNameOf)
    const last = parts.at(-1)
    if (last === undefined || isClauseKeyword(parts[0])) continue
    if (findSqlTable(tables, names) || isDual(databaseType, names)) continue
    const from = parts[0].from
    found.push(
      warningAt(lineOf(from), `Table '${names.join('.')}' is not in the loaded tables`, from, last.to),
    )
  }
  return found
}

/** `t.c` where `t` names a loaded table; a qualifier that names none, such as an alias, is never checked. */
function columnFindings(
  tokens: readonly SqlToken[],
  tables: readonly SqlTable[],
  lineOf: LineOf,
): ScriptWarning[] {
  const found: ScriptWarning[] = []
  tokens.forEach((token, index) => {
    const column = tokens[index + 2]
    if (!isSqlName(token) || tokens[index + 1]?.text !== '.' || !isSqlName(column)) return
    const table = findSqlTable(tables, [sqlNameOf(token)])
    const name = sqlNameOf(column)
    if (!table || table.columns.some((known) => sameSqlName(known.name, name))) return
    found.push(
      warningAt(
        lineOf(column.from),
        `Column '${name}' is not in ${sqlNameOf(token)}`,
        column.from,
        column.to,
      ),
    )
  })
  return found
}

interface TemplateRegion {
  inside: string
  offset: number
}

/** Each closed `{{ }}` region in order: its text up to the first `}}`, and where that text starts. */
function templateRegions(doc: string): TemplateRegion[] {
  const regions: TemplateRegion[] = []
  let open = doc.indexOf('{{')
  while (open >= 0) {
    const close = doc.indexOf('}}', open + 2)
    if (close < 0) break
    regions.push({ inside: doc.slice(open + 2, close), offset: open + 2 })
    open = doc.indexOf('{{', close + 2)
  }
  return regions
}

/** What the expression field would say of each closed `{{ }}` region, shifted into the script. */
function expressionFindings(
  doc: string,
  variables: readonly AvailableVariable[],
  lineOf: LineOf,
): ScriptWarning[] {
  const names = new Set(variables.map((variable) => variable.name))
  const types = new Map(variables.map((variable) => [variable.name, variable.type]))
  return templateRegions(doc).flatMap(({ inside, offset }) =>
    validateExpressions(inside, names, types, false).map((issue) =>
      warningAt(lineOf(issue.from + offset), issue.message, issue.from + offset, issue.to + offset),
    ),
  )
}

function orderOf(warning: ScriptWarning): number {
  return warning.line === 0 ? -1 : warning.from
}

/** The editor's own findings, line-0 findings first and then by position. None of them blocks Save or Run. */
export function checkSqlScript(doc: string, input: SqlCheckInput): ScriptWarning[] {
  const { tokens } = lexSql(doc, input.databaseType)
  const lineOf = lineLookup(doc)
  const found = sessionStateEnd(doc, tokens, lineOf)
  if (input.parameterNames) {
    found.push(
      ...parameterFindings(placeholdersOf(tokens, input.databaseType, lineOf), input.parameterNames),
    )
  }
  if (input.tables) {
    found.push(
      ...tableFindings(tokens, input.tables, input.databaseType, lineOf),
      ...columnFindings(tokens, input.tables, lineOf),
    )
  }
  if (input.template) found.push(...expressionFindings(doc, input.variables, lineOf))
  return found.sort((left, right) => orderOf(left) - orderOf(right))
}

/** One warning per server finding, over the whole of its line; a finding outside the script is dropped. */
export function sqlServerIssueWarnings(
  doc: string,
  issues: readonly SqlCheckIssue[],
): ScriptWarning[] {
  const lines = doc.split('\n')
  return issues
    .filter((issue) => issue.line >= 1 && issue.line <= lines.length)
    .map((issue) => {
      const from = lines
        .slice(0, issue.line - 1)
        .reduce((offset, text) => offset + text.length + 1, 0)
      return warningAt(issue.line, issue.message, from, from + lines[issue.line - 1].length)
    })
}
