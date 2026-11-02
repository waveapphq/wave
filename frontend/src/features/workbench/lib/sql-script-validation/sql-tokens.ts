/**
 * The SQL editor's lexer: the per-dialect regions a placeholder or a separator never reads inside, and the places a table name goes (SQL-2, SQL-10, SQL-12).
 *
 * REQ-3.4.1.6: SQL database operations
 */

import type { SqlDatabaseType } from '@/lib/codemirror/format-editor'

export type SqlTokenKind =
  | 'word'
  | 'number'
  | 'quoted'
  | 'string'
  | 'placeholder'
  | 'template'
  | 'separator'
  | 'symbol'

export type SqlScanKind = SqlTokenKind | 'space' | 'comment'

export interface SqlToken {
  kind: SqlTokenKind
  text: string
  from: number
  to: number
}

export interface SqlLex {
  /** Every token outside whitespace and comments, in document order. */
  tokens: SqlToken[]
  /** The region the text ends inside (an unclosed string, identifier, comment or {{ }}), else null. */
  open: SqlScanKind | null
}

/** The keywords a table name follows. */
const TABLE_KEYWORDS: ReadonlySet<string> = new Set(['FROM', 'JOIN', 'INTO', 'UPDATE'])

/** UPDATE after these is an action or a trigger event (DO UPDATE, FOR UPDATE, ON UPDATE CASCADE, BEFORE UPDATE, INSERT OR UPDATE, INSTEAD OF UPDATE), not a statement. */
const UPDATE_ACTION_LEADS: ReadonlySet<string> = new Set([
  'DO',
  'KEY',
  'FOR',
  'ON',
  'BEFORE',
  'AFTER',
  'OR',
  'OF',
])

/** A `(` opening one of these holds a statement, not a call's arguments. */
const STATEMENT_OPENERS: ReadonlySet<string> = new Set(['SELECT', 'WITH', 'DELETE'])

/** In these statements UPDATE is a privilege and FROM names a grantee. */
const PRIVILEGE_STATEMENTS: ReadonlySet<string> = new Set(['GRANT', 'REVOKE'])

interface Scan {
  kind: SqlScanKind
  to: number
  closed: boolean
}

type ScanFn = (doc: string, from: number, match: RegExpExecArray) => Scan

interface LexRule {
  pattern: RegExp
  scan: ScanFn
}

const COMMENT_DEPTH: Readonly<Record<string, number>> = { '/*': 1, '*/': -1 }

const Q_QUOTE_CLOSERS: Readonly<Partial<Record<string, string>>> = {
  '[': ']',
  '{': '}',
  '(': ')',
  '<': '>',
}

function plain(kind: SqlScanKind): ScanFn {
  return (_doc, from, match) => ({ kind, to: from + match[0].length, closed: true })
}

function closedBy(doc: string, start: number, closer: string, kind: SqlScanKind): Scan {
  const at = doc.indexOf(closer, start)
  return at < 0 ? { kind, to: doc.length, closed: false } : { kind, to: at + closer.length, closed: true }
}

/** A doubled closer is part of the text; with `backslash` a backslash escapes the next character. */
function quoted(close: string, backslash: boolean, kind: SqlScanKind): ScanFn {
  return (doc, from, match) => {
    let at = from + match[0].length
    while (at < doc.length) {
      const char = doc[at]
      if (backslash && char === '\\') at += 2
      else if (char !== close) at += 1
      else if (doc[at + 1] === close) at += 2
      else return { kind, to: at + 1, closed: true }
    }
    return { kind, to: doc.length, closed: false }
  }
}

function blockComment(marks: RegExp): ScanFn {
  return (doc, from) => {
    const found = new RegExp(marks.source, 'g')
    found.lastIndex = from + 2
    let depth = 1
    let match: RegExpExecArray | null
    while (depth > 0 && (match = found.exec(doc)) !== null) depth += COMMENT_DEPTH[match[0]]
    return depth > 0
      ? { kind: 'comment', to: doc.length, closed: false }
      : { kind: 'comment', to: found.lastIndex, closed: true }
  }
}

const lineComment: ScanFn = (doc, from) => {
  const at = doc.indexOf('\n', from)
  return at < 0
    ? { kind: 'comment', to: doc.length, closed: false }
    : { kind: 'comment', to: at, closed: true }
}

const SPACE: LexRule = { pattern: /[^\S\n]+|\n/y, scan: plain('space') }
const LINE_COMMENT: LexRule = { pattern: /--/y, scan: lineComment }
const HASH_COMMENT: LexRule = { pattern: /#/y, scan: lineComment }
const BLOCK_COMMENT: LexRule = { pattern: /\/\*/y, scan: blockComment(/\*\//) }
// PostgreSQL block comments nest.
const NESTED_BLOCK_COMMENT: LexRule = { pattern: /\/\*/y, scan: blockComment(/\/\*|\*\//) }
const TEMPLATE: LexRule = {
  pattern: /\{\{/y,
  scan: (doc, from) => closedBy(doc, from + 2, '}}', 'template'),
}
const STRING: LexRule = { pattern: /'/y, scan: quoted("'", false, 'string') }
const BACKSLASH_STRING: LexRule = { pattern: /'/y, scan: quoted("'", true, 'string') }
const ESCAPE_STRING: LexRule = { pattern: /[Ee]'/y, scan: quoted("'", true, 'string') }
const DOUBLE_QUOTED: LexRule = { pattern: /"/y, scan: quoted('"', false, 'quoted') }
const BACKSLASH_DOUBLE_QUOTED: LexRule = { pattern: /"/y, scan: quoted('"', true, 'quoted') }
const BACKTICK: LexRule = { pattern: /`/y, scan: quoted('`', false, 'quoted') }
const BRACKETED: LexRule = { pattern: /\[/y, scan: quoted(']', false, 'quoted') }
const DOLLAR_QUOTED: LexRule = {
  pattern: /\$(?:[A-Za-z_]\w*)?\$/y,
  scan: (doc, from, match) => closedBy(doc, from + match[0].length, match[0], 'string'),
}
const Q_QUOTED: LexRule = {
  pattern: /[Qq]'([\s\S])/y,
  scan: (doc, from, match) =>
    closedBy(doc, from + 3, `${Q_QUOTE_CLOSERS[match[1]] ?? match[1]}'`, 'string'),
}
const GO_LINE: LexRule = { pattern: /(?<=^|\n)[^\S\n]*go[^\S\n]*(?=\n|$)/yi, scan: plain('separator') }
const SLASH_LINE: LexRule = { pattern: /(?<=^|\n)[^\S\n]*\/[^\S\n]*(?=\n|$)/y, scan: plain('separator') }
const PLACEHOLDER: LexRule = { pattern: /(?<!:):[A-Za-z_]\w*/y, scan: plain('placeholder') }
const WORD: LexRule = { pattern: /[\p{L}_][\p{L}\p{N}_$]*/uy, scan: plain('word') }
const NUMBER: LexRule = { pattern: /\p{N}[\p{L}\p{N}_]*/uy, scan: plain('number') }

const DIALECT_RULES: Readonly<Record<SqlDatabaseType, readonly LexRule[]>> = {
  postgresql: [
    SPACE,
    LINE_COMMENT,
    NESTED_BLOCK_COMMENT,
    TEMPLATE,
    ESCAPE_STRING,
    STRING,
    DOUBLE_QUOTED,
    DOLLAR_QUOTED,
    PLACEHOLDER,
    WORD,
    NUMBER,
  ],
  mysql: [
    SPACE,
    LINE_COMMENT,
    HASH_COMMENT,
    BLOCK_COMMENT,
    TEMPLATE,
    BACKSLASH_STRING,
    BACKSLASH_DOUBLE_QUOTED,
    BACKTICK,
    PLACEHOLDER,
    WORD,
    NUMBER,
  ],
  oracle: [
    SLASH_LINE,
    SPACE,
    LINE_COMMENT,
    BLOCK_COMMENT,
    TEMPLATE,
    Q_QUOTED,
    STRING,
    DOUBLE_QUOTED,
    PLACEHOLDER,
    WORD,
    NUMBER,
  ],
  mssql: [
    GO_LINE,
    SPACE,
    LINE_COMMENT,
    BLOCK_COMMENT,
    TEMPLATE,
    STRING,
    DOUBLE_QUOTED,
    BRACKETED,
    PLACEHOLDER,
    WORD,
    NUMBER,
  ],
  sqlite: [
    SPACE,
    LINE_COMMENT,
    BLOCK_COMMENT,
    TEMPLATE,
    STRING,
    DOUBLE_QUOTED,
    BACKTICK,
    BRACKETED,
    PLACEHOLDER,
    WORD,
    NUMBER,
  ],
}

function scanAt(doc: string, from: number, rules: readonly LexRule[]): Scan {
  for (const rule of rules) {
    rule.pattern.lastIndex = from
    const match = rule.pattern.exec(doc)
    if (match) return rule.scan(doc, from, match)
  }
  return { kind: 'symbol', to: from + 1, closed: true }
}

function isTokenKind(kind: SqlScanKind): kind is SqlTokenKind {
  return kind !== 'space' && kind !== 'comment'
}

/** Splits a script into tokens by the lexical rules of the Database type. */
export function lexSql(doc: string, databaseType: SqlDatabaseType): SqlLex {
  const rules = DIALECT_RULES[databaseType]
  const tokens: SqlToken[] = []
  let open: SqlScanKind | null = null
  let from = 0
  while (from < doc.length) {
    const scan = scanAt(doc, from, rules)
    if (isTokenKind(scan.kind)) {
      tokens.push({ kind: scan.kind, text: doc.slice(from, scan.to), from, to: scan.to })
    }
    open = scan.closed ? null : scan.kind
    from = scan.to
  }
  return { tokens, open }
}

/** A bare or quoted identifier. */
export function isSqlName(token: SqlToken | undefined): token is SqlToken {
  return token?.kind === 'word' || token?.kind === 'quoted'
}

/** An identifier as the database reads it: the quotes of a quoted one stripped. */
export function sqlNameOf(token: SqlToken): string {
  return token.kind === 'quoted' ? token.text.slice(1, -1) : token.text
}

export function sameSqlName(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase()
}

function upperWord(token: SqlToken | undefined): string {
  return token?.kind === 'word' ? token.text.toUpperCase() : ''
}

/** For each token, the index of the innermost `(` it sits inside within its statement, else -1. */
function enclosingParens(tokens: readonly SqlToken[]): number[] {
  const open: number[] = []
  return tokens.map((token, index) => {
    const inside = open.at(-1) ?? -1
    if (token.text === '(') open.push(index)
    else if (token.text === ')') open.pop()
    else if (token.text === ';' || token.kind === 'separator') open.length = 0
    return inside
  })
}

/** A `(` after a name that opens no statement is a call, such as EXTRACT(YEAR FROM x). */
function isCallParen(tokens: readonly SqlToken[], paren: number): boolean {
  return (
    paren >= 0 &&
    isSqlName(tokens[paren - 1]) &&
    !STATEMENT_OPENERS.has(upperWord(tokens[paren + 1]))
  )
}

/** For each token, the index of the first token of its statement. */
function statementHeads(tokens: readonly SqlToken[]): number[] {
  let head = 0
  return tokens.map((token, index) => {
    const current = head
    if (token.text === ';' || token.kind === 'separator') head = index + 1
    return current
  })
}

/** An UPDATE that starts no statement: an action, a trigger event or one of a list of events or privileges. */
function isUpdateAction(lead: SqlToken | undefined): boolean {
  return lead?.text === ',' || UPDATE_ACTION_LEADS.has(upperWord(lead))
}

/** The first ON after TRIGGER in a CREATE ... TRIGGER statement names the trigger's table. */
function isTriggerTableOn(tokens: readonly SqlToken[], head: number, on: number): boolean {
  if (upperWord(tokens[head]) !== 'CREATE') return false
  let at = on - 1
  while (at > head && upperWord(tokens[at]) !== 'TRIGGER' && upperWord(tokens[at]) !== 'ON') at -= 1
  return upperWord(tokens[at]) === 'TRIGGER'
}

/** The token index of every place a table name goes, whether or not a name is written there yet. */
export function sqlTableNameStarts(tokens: readonly SqlToken[]): ReadonlySet<number> {
  const parens = enclosingParens(tokens)
  const heads = statementHeads(tokens)
  const starts = new Set<number>()
  tokens.forEach((token, index) => {
    const keyword = upperWord(token)
    if (PRIVILEGE_STATEMENTS.has(upperWord(tokens[heads[index]]))) return
    if (keyword === 'ON' && isTriggerTableOn(tokens, heads[index], index)) starts.add(index + 1)
    if (!TABLE_KEYWORDS.has(keyword)) return
    if (keyword === 'UPDATE' && isUpdateAction(tokens[index - 1])) return
    if (keyword === 'FROM' && isCallParen(tokens, parens[index])) return
    const next = upperWord(tokens[index + 1])
    if (next === 'LATERAL') return
    starts.add(index + (next === 'ONLY' ? 2 : 1))
  })
  return starts
}
