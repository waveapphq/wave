/**
 * The SQL editor's local checks and the mapping of the server's issues to warnings.
 *
 * REQ-3.4.1.6; SQL-2, SQL-3, SQL-10, SQL-12
 */

import { describe, it, expect } from 'vitest'

import {
  checkSqlScript,
  findSqlPlaceholders,
  findSqlTable,
  sqlServerIssueWarnings,
  type SqlCheckInput,
  type SqlPlaceholder,
} from '@/features/workbench/lib/sql-script-validation/check-sql'
import type { ScriptWarning } from '@/features/workbench/lib/python-script-validation/script-issues'
import type { SqlDatabaseType } from '@/lib/codemirror/format-editor'
import type { AvailableVariable } from '@/features/workbench/lib/codemirror/type-inference'
import { validateExpressions } from '@/features/workbench/lib/expression-validation/validation'
import { SAMPLE_SCRIPT, SAMPLE_TABLES } from '../../sql-fixtures'

// ============================================
// Test Helpers
// ============================================

const ALL_TYPES: SqlDatabaseType[] = ['postgresql', 'mysql', 'oracle', 'mssql', 'sqlite']

function input(overrides: Partial<SqlCheckInput> = {}): SqlCheckInput {
  return {
    databaseType: 'postgresql',
    parameterNames: null,
    tables: null,
    variables: [],
    template: false,
    ...overrides,
  }
}

/** Offset of the nth (0-based) occurrence of `text` in `doc`. */
function at(doc: string, text: string, nth = 0): number {
  let index = -1
  for (let count = 0; count <= nth; count += 1) {
    index = doc.indexOf(text, index + 1)
    if (index < 0) throw new Error(`'${text}' occurs fewer than ${nth + 1} times in the fixture`)
  }
  return index
}

function placeholder(doc: string, name: string, line: number, nth = 0): SqlPlaceholder {
  const from = at(doc, `:${name}`, nth)
  return { name, from, to: from + name.length + 1, line }
}

function names(doc: string, databaseType: SqlDatabaseType = 'postgresql'): string[] {
  return findSqlPlaceholders(doc, databaseType).map((found: SqlPlaceholder) => found.name)
}

function warning(line: number, message: string, from: number, to: number): ScriptWarning {
  return { line, message, severity: 'warning', from, to }
}

function unused(name: string): ScriptWarning {
  return warning(0, `Parameter '${name}' is defined but not used in the SQL`, 0, 0)
}

function undefinedAt(doc: string, name: string, line: number, nth = 0): ScriptWarning {
  const from = at(doc, `:${name}`, nth)
  return warning(
    line,
    `Parameter '${name}' is used in the SQL but not defined`,
    from,
    from + name.length + 1,
  )
}

function sessionEnd(doc: string, statement: string, lead: string, line: number): ScriptWarning {
  const from = at(doc, statement)
  return warning(
    line,
    `${lead} ends the script; its effect ends with the block`,
    from,
    from + statement.length,
  )
}

function unknownTable(doc: string, name: string, line: number): ScriptWarning {
  const from = at(doc, name)
  return warning(line, `Table '${name}' is not in the loaded tables`, from, from + name.length)
}

function unknownColumn(doc: string, table: string, column: string, line: number): ScriptWarning {
  const from = at(doc, `${table}.${column}`) + table.length + 1
  return warning(line, `Column '${column}' is not in ${table}`, from, from + column.length)
}

/** What the expression validator says of each closed `{{ }}` region, shifted into the doc. */
function expressionWarnings(doc: string, variables: readonly AvailableVariable[]): ScriptWarning[] {
  const known = new Set(variables.map((variable) => variable.name))
  const types = new Map(variables.map((variable) => [variable.name, variable.type]))
  const found: ScriptWarning[] = []
  let searchFrom = 0
  for (;;) {
    const open = doc.indexOf('{{', searchFrom)
    if (open < 0) break
    const close = doc.indexOf('}}', open + 2)
    if (close < 0) break
    const offset = open + 2
    for (const issue of validateExpressions(doc.slice(offset, close), known, types, false)) {
      const from = issue.from + offset
      const line = doc.slice(0, from).split('\n').length
      found.push(warning(line, issue.message, from, issue.to + offset))
    }
    searchFrom = close + 2
  }
  return found
}

const MOCKUP_SCRIPT = `${SAMPLE_SCRIPT};\nSET search_path TO reporting;`

// ============================================
// findSqlPlaceholders
// ============================================

describe('findSqlTable', () => {
  it('finds a table by its name alone, in any case', () => {
    expect(findSqlTable(SAMPLE_TABLES, ['ORDERS'])).toBe(SAMPLE_TABLES[0])
  })

  it('finds a table by its schema and name', () => {
    expect(findSqlTable(SAMPLE_TABLES, ['public', 'orders'])).toBe(SAMPLE_TABLES[0])
  })

  it('finds nothing under another schema', () => {
    expect(findSqlTable(SAMPLE_TABLES, ['sales', 'orders'])).toBeUndefined()
  })

  it('finds nothing for no name at all', () => {
    expect(findSqlTable(SAMPLE_TABLES, [])).toBeUndefined()
  })
})

describe('findSqlPlaceholders', () => {
  it('finds each placeholder of the sample script with its span and 1-based line', () => {
    expect(findSqlPlaceholders(SAMPLE_SCRIPT, 'postgresql')).toEqual([
      placeholder(SAMPLE_SCRIPT, 'customer', 3),
      placeholder(SAMPLE_SCRIPT, 'status', 4),
    ])
  })

  it('starts the span at the colon and ends it after the name', () => {
    expect(findSqlPlaceholders(':id', 'postgresql')).toEqual([
      { name: 'id', from: 0, to: 3, line: 1 },
    ])
  })

  it('counts lines across blank lines', () => {
    const doc = 'SELECT\n\n\n  :x'

    expect(findSqlPlaceholders(doc, 'postgresql')).toEqual([placeholder(doc, 'x', 4)])
  })

  it('reads a name of letters, digits and underscores that does not start with a digit', () => {
    expect(names('SELECT :a1_b2, :_x, (:id), :id2,')).toEqual(['a1_b2', '_x', 'id', 'id2'])
  })

  it('finds nothing after a colon followed by a digit', () => {
    expect(names('SELECT :1, :2abc')).toEqual([])
  })

  it('lists every use of a name, in document order', () => {
    const doc = 'SELECT :b, :a, :b'

    expect(findSqlPlaceholders(doc, 'postgresql')).toEqual([
      placeholder(doc, 'b', 1),
      placeholder(doc, 'a', 1),
      placeholder(doc, 'b', 1, 1),
    ])
  })

  it('keeps the case of a name, so two spellings are two names', () => {
    expect(names('WHERE a = :Customer OR b = :customer')).toEqual(['Customer', 'customer'])
  })

  it('reads x::int as a cast, not a placeholder', () => {
    expect(names('SELECT x::int, y::text FROM t')).toEqual([])
  })

  it('reads :id::int as the placeholder id followed by a cast', () => {
    const doc = 'SELECT :id::int'

    expect(findSqlPlaceholders(doc, 'postgresql')).toEqual([
      { name: 'id', from: 7, to: 10, line: 1 },
    ])
  })

  it('reads := as an assignment, not a placeholder', () => {
    expect(names('BEGIN a := 1; b:= :x; END;')).toEqual(['x'])
  })

  it('finds a placeholder written right after a word', () => {
    expect(names('SELECT a:b')).toEqual(['b'])
  })

  describe.each(ALL_TYPES)('regions skipped on %s', (databaseType) => {
    it.each([
      ["a string", "SELECT 'a :x b', :y"],
      ["a string with a doubled quote", "SELECT 'it'' :x', :y"],
      ['a double-quoted identifier', 'SELECT ":x", :y'],
      ['a line comment', 'SELECT 1 -- :x\n, :y'],
      ['a block comment', 'SELECT /* :x */ :y'],
      ['a block comment over several lines', 'SELECT /* one\n:x\n */ :y'],
      ['a {{ }} region', 'SELECT {{ :x }}, :y'],
    ])('skips %s', (_region, doc) => {
      expect(names(doc, databaseType)).toEqual(['y'])
    })
  })

  describe('regions of one database type', () => {
    it.each([
      ['postgresql', 'a $$ body', 'SELECT $$ :x $$, :y'],
      ['postgresql', 'a tagged $fn$ body', 'SELECT $fn$ it is :x $fn$, :y'],
      ['postgresql', "an E'' string with a backslash escape", "SELECT E'it\\'s :x', :y"],
      ['mysql', 'a # comment', 'SELECT 1 # :x\n, :y'],
      ['mysql', 'a backtick identifier', 'SELECT `:x`, :y'],
      ['mysql', 'a string with a backslash escape', "SELECT 'it\\'s :x', :y"],
      ['mssql', 'a bracketed identifier', 'SELECT [:x], :y'],
      ['sqlite', 'a backtick identifier', 'SELECT `:x`, :y'],
      ['sqlite', 'a bracketed identifier', 'SELECT [:x], :y'],
      ['oracle', "a q'[ ]' literal", "SELECT q'[it's :x]', :y FROM dual"],
      ['oracle', "a q'# #' literal", "SELECT q'#it's :x#', :y FROM dual"],
    ] as const)('%s skips %s', (databaseType, _region, doc) => {
      expect(names(doc, databaseType)).toEqual(['y'])
    })

    it('reads # as an operator on PostgreSQL, so a placeholder after it counts', () => {
      expect(names('SELECT 1 # :x', 'postgresql')).toEqual(['x'])
    })

    it('reads [ ] as an array subscript on PostgreSQL, so a placeholder inside counts', () => {
      expect(names('SELECT tags[:i] FROM t', 'postgresql')).toEqual(['i'])
    })
  })

  describe('Oracle triggers', () => {
    const body = [
      'BEFORE UPDATE ON orders FOR EACH ROW',
      'BEGIN',
      '  IF :NEW.status <> :old.status THEN',
      '    :New.updated_at := SYSDATE;',
      '  END IF;',
      'END;',
      '/',
      'SELECT :new AS n, :OLD AS o FROM dual',
    ].join('\n')

    it.each([
      'CREATE TRIGGER orders_bu',
      'CREATE OR REPLACE TRIGGER orders_bu',
      'CREATE EDITIONABLE TRIGGER orders_bu',
      'CREATE OR REPLACE NONEDITIONABLE TRIGGER orders_bu',
      'create or replace trigger orders_bu',
    ])('does not read :new or :old inside "%s" as placeholders', (head) => {
      expect(names(`${head}\n${body}`, 'oracle')).toEqual(['new', 'OLD'])
    })

    it('reads :new and :old as placeholders outside a trigger', () => {
      expect(names('SELECT :new, :old FROM dual', 'oracle')).toEqual(['new', 'old'])
    })

    it('reads :new and :old as placeholders on every other database type', () => {
      const doc = `CREATE OR REPLACE TRIGGER orders_bu\n${body}`

      for (const databaseType of ['postgresql', 'mysql', 'mssql', 'sqlite'] as const) {
        expect(names(doc, databaseType)).toEqual(['NEW', 'old', 'New', 'new', 'OLD'])
      }
    })
  })
})

// ============================================
// checkSqlScript: Parameters entries
// ============================================

describe('checkSqlScript Parameters entries', () => {
  it('flags an unused entry and a script ending on SET as the editor mockup shows them', () => {
    const found = checkSqlScript(
      MOCKUP_SCRIPT,
      input({ parameterNames: ['customer', 'status', 'limit'] }),
    )

    expect(found).toEqual([
      unused('limit'),
      sessionEnd(MOCKUP_SCRIPT, 'SET search_path TO reporting;', 'SET search_path', 6),
    ])
  })

  it('flags nothing when every placeholder has an entry and every entry is used', () => {
    expect(checkSqlScript(SAMPLE_SCRIPT, input({ parameterNames: ['customer', 'status'] }))).toEqual(
      [],
    )
  })

  it('flags each use of a placeholder that has no entry', () => {
    const doc = 'SELECT :a,\n  :b,\n  :a'

    expect(checkSqlScript(doc, input({ parameterNames: ['b'] }))).toEqual([
      undefinedAt(doc, 'a', 1),
      undefinedAt(doc, 'a', 3, 1),
    ])
  })

  it('flags each entry no placeholder uses once, at line 0 with an empty span', () => {
    const found = checkSqlScript('SELECT :a', input({ parameterNames: ['a', 'b', 'c'] }))

    expect(found).toHaveLength(2)
    expect(found).toEqual(expect.arrayContaining([unused('b'), unused('c')]))
  })

  it('flags every placeholder when Parameters has no entries, and no entry as unused', () => {
    const doc = 'SELECT :a, :b'

    expect(checkSqlScript(doc, input({ parameterNames: [] }))).toEqual([
      undefinedAt(doc, 'a', 1),
      undefinedAt(doc, 'b', 1),
    ])
  })

  it('checks neither rule while Parameters is an expression', () => {
    expect(checkSqlScript('SELECT :a', input({ parameterNames: null }))).toEqual([])
  })

  it('matches entries to placeholders case-sensitively', () => {
    const doc = 'SELECT :Customer'

    expect(checkSqlScript(doc, input({ parameterNames: ['customer'] }))).toEqual([
      unused('customer'),
      undefinedAt(doc, 'Customer', 1),
    ])
  })

  it('does not count a name inside a string or a comment as a use', () => {
    expect(
      checkSqlScript("SELECT ':x' -- :x\n", input({ parameterNames: ['x'] })),
    ).toEqual([unused('x')])
  })

  it('reads placeholders with the rules of the database type it was given', () => {
    const doc = 'SELECT 1 # :x'

    expect(checkSqlScript(doc, input({ databaseType: 'mysql', parameterNames: [] }))).toEqual([])
    expect(checkSqlScript(doc, input({ databaseType: 'postgresql', parameterNames: [] }))).toEqual(
      [undefinedAt(doc, 'x', 1)],
    )
  })

  it('flags every entry of an empty script as unused', () => {
    expect(checkSqlScript('', input({ parameterNames: ['a'] }))).toEqual([unused('a')])
  })
})

// ============================================
// checkSqlScript: a script ending on a session-state statement
// ============================================

describe('checkSqlScript session-state end', () => {
  it.each([
    { databaseType: 'postgresql', statement: 'SET ROLE analyst;', lead: 'SET ROLE' },
    { databaseType: 'postgresql', statement: 'set search_path to reporting;', lead: 'set search_path' },
    { databaseType: 'mysql', statement: 'USE shop', lead: 'USE shop' },
    { databaseType: 'mysql', statement: 'USE shop;', lead: 'USE shop' },
    { databaseType: 'mssql', statement: 'SET @v = 1;', lead: 'SET @v' },
    {
      databaseType: 'oracle',
      statement: "ALTER SESSION SET NLS_DATE_FORMAT = 'YYYY-MM-DD';",
      lead: 'ALTER SESSION',
    },
    { databaseType: 'oracle', statement: "alter session set time_zone = 'UTC'", lead: 'alter session' },
  ] as const)('flags "$statement" on $databaseType as ending the script', ({ databaseType, statement, lead }) => {
    const doc = `SELECT 1;\n${statement}`

    expect(checkSqlScript(doc, input({ databaseType }))).toEqual([
      sessionEnd(doc, statement, lead, 2),
    ])
  })

  it('names the first line of a statement over several lines and spans all of it', () => {
    const doc = 'SELECT 1;\n\nSET search_path\n  TO reporting;'

    expect(checkSqlScript(doc, input())).toEqual([
      sessionEnd(doc, 'SET search_path\n  TO reporting;', 'SET search_path', 3),
    ])
  })

  it('ignores blank lines and comments after the last statement', () => {
    const doc = 'SELECT 1;\nSET search_path TO reporting;\n\n-- done\n/* the end */\n\n'

    expect(checkSqlScript(doc, input())).toEqual([
      sessionEnd(doc, 'SET search_path TO reporting;', 'SET search_path', 2),
    ])
  })

  it('does not split on a ; inside a string', () => {
    const doc = "SELECT 1;\nSET application_name = 'nightly;run';"

    expect(checkSqlScript(doc, input())).toEqual([
      sessionEnd(doc, "SET application_name = 'nightly;run';", 'SET application_name', 2),
    ])
  })

  it('flags a SET that follows a comment line', () => {
    const doc = 'SELECT 1;\n-- switch schema\nSET search_path TO reporting;'

    expect(checkSqlScript(doc, input()).map((found: ScriptWarning) => found.message)).toEqual([
      'SET search_path ends the script; its effect ends with the block',
    ])
  })

  it.each([
    ['another statement follows', 'SET search_path TO reporting;\nSELECT 1;'],
    ['another statement without ; follows', 'USE shop;\nSELECT 1'],
    ['ALTER TABLE', 'ALTER TABLE orders ADD COLUMN note text;'],
    ['RESET', 'SELECT 1;\nRESET ROLE;'],
    ['an UPDATE with a SET clause', "UPDATE orders SET status = 'x';"],
    ['a SELECT', 'SELECT 1;'],
    ['an empty script', ''],
    ['whitespace only', '  \n\n  '],
    ['comments only', '-- nothing\n/* here */'],
    ['a word that only begins with SET', 'SELECT 1;\nsettle_orders;'],
    ['a word that only begins with USE', 'SELECT 1;\nuser_cleanup;'],
  ])('does not flag a script whose end is %s', (_case, doc) => {
    expect(checkSqlScript(doc, input())).toEqual([])
  })

  describe('GO lines on SQL Server', () => {
    const doc = 'SELECT 1\nGO\nSET NOCOUNT ON\nGO\n'

    it('splits on a GO line and flags the last batch', () => {
      expect(checkSqlScript(doc, input({ databaseType: 'mssql' }))).toEqual([
        sessionEnd(doc, 'SET NOCOUNT ON', 'SET NOCOUNT', 3),
      ])
    })

    it('reads a GO line in any case', () => {
      const lower = 'SELECT 1\ngo\nUSE shop'

      expect(checkSqlScript(lower, input({ databaseType: 'mssql' }))).toEqual([
        sessionEnd(lower, 'USE shop', 'USE shop', 3),
      ])
    })

    it('splits the last batch on ; for this check', () => {
      const batch = 'SELECT 1\nGO\nSELECT 2; SET NOCOUNT ON;'

      expect(checkSqlScript(batch, input({ databaseType: 'mssql' }))).toEqual([
        sessionEnd(batch, 'SET NOCOUNT ON;', 'SET NOCOUNT', 3),
      ])
    })

    it('does not flag a SET in an earlier batch', () => {
      expect(checkSqlScript('SET NOCOUNT ON\nGO\nSELECT 1', input({ databaseType: 'mssql' }))).toEqual(
        [],
      )
    })

    it.each(['postgresql', 'mysql', 'oracle', 'sqlite'] as const)(
      'does not split on a GO line on %s',
      (databaseType) => {
        expect(checkSqlScript(doc, input({ databaseType }))).toEqual([])
      },
    )
  })

  describe('/ lines on Oracle', () => {
    const doc = "SELECT 1 FROM dual\n/\nALTER SESSION SET NLS_DATE_FORMAT = 'YYYY-MM-DD'\n/\n"

    it('splits on a / line and flags the last statement', () => {
      expect(checkSqlScript(doc, input({ databaseType: 'oracle' }))).toEqual([
        sessionEnd(doc, "ALTER SESSION SET NLS_DATE_FORMAT = 'YYYY-MM-DD'", 'ALTER SESSION', 3),
      ])
    })

    it.each(['postgresql', 'mysql', 'mssql', 'sqlite'] as const)(
      'does not split on a / line on %s',
      (databaseType) => {
        expect(checkSqlScript(doc, input({ databaseType }))).toEqual([])
      },
    )
  })
})

// ============================================
// checkSqlScript: tables and columns
// ============================================

describe('checkSqlScript unknown tables and columns', () => {
  const loaded = input({ tables: SAMPLE_TABLES })

  it('flags nothing in the sample script against the loaded tables', () => {
    expect(checkSqlScript(SAMPLE_SCRIPT, loaded)).toEqual([])
  })

  it.each([
    ['FROM', 'SELECT * FROM nope'],
    ['JOIN', 'SELECT * FROM orders JOIN nope ON true'],
    ['INTO', 'INSERT INTO nope (id) VALUES (1)'],
    ['UPDATE', "UPDATE nope SET status = 'x'"],
    ['from in lower case', 'select * from nope'],
  ])('flags a table after %s that is not loaded, spanning its name', (_keyword, doc) => {
    expect(checkSqlScript(doc, loaded)).toEqual([unknownTable(doc, 'nope', 1)])
  })

  it('names the line of the unknown table', () => {
    const doc = 'SELECT *\nFROM orderz'

    expect(checkSqlScript(doc, loaded)).toEqual([unknownTable(doc, 'orderz', 2)])
  })

  it.each([
    ['a name in another case', 'SELECT * FROM ORDERS'],
    ['a quoted name', 'SELECT * FROM "orders"'],
    ['a schema-qualified name', 'SELECT * FROM public.orders'],
    ['a quoted schema-qualified name', 'SELECT * FROM "public"."orders"'],
    ['a JOIN', 'SELECT * FROM orders JOIN order_items ON true'],
    ['an INTO', 'INSERT INTO customers (id) VALUES (1)'],
    ['a view', "UPDATE active_customers SET email = 'x'"],
    ['a subquery', 'SELECT * FROM (SELECT id FROM orders) AS o'],
  ])('flags nothing for %s', (_case, doc) => {
    expect(checkSqlScript(doc, loaded)).toEqual([])
  })

  it('flags every table while the loaded list is empty', () => {
    const doc = 'SELECT * FROM orders'

    expect(checkSqlScript(doc, input({ tables: [] }))).toEqual([unknownTable(doc, 'orders', 1)])
  })

  it('never checks a name inside {{ }}', () => {
    expect(checkSqlScript('SELECT * FROM {{ table_name }}', loaded)).toEqual([])
    expect(
      checkSqlScript(
        'SELECT * FROM {{ table_name }}',
        input({
          tables: SAMPLE_TABLES,
          template: true,
          variables: [{ name: 'table_name', type: 'string' }],
        }),
      ),
    ).toEqual([])
  })

  it('flags a column its table does not have, spanning the column name', () => {
    const doc = 'SELECT orders.nope\nFROM orders'

    expect(checkSqlScript(doc, loaded)).toEqual([unknownColumn(doc, 'orders', 'nope', 1)])
  })

  it('flags a column a view does not have', () => {
    const doc = 'SELECT active_customers.nope FROM active_customers'

    expect(checkSqlScript(doc, loaded)).toEqual([
      unknownColumn(doc, 'active_customers', 'nope', 1),
    ])
  })

  it('flags nothing for columns the tables have', () => {
    const doc =
      'SELECT orders.status, customers.order_count FROM orders JOIN customers ON customers.id = orders.customer_id'

    expect(checkSqlScript(doc, loaded)).toEqual([])
  })

  it('flags nothing for table.*', () => {
    expect(checkSqlScript('SELECT orders.* FROM orders', loaded)).toEqual([])
  })

  it('never checks a qualifier that names no loaded table, such as an alias', () => {
    expect(checkSqlScript('SELECT o.nope FROM orders o', loaded)).toEqual([])
  })

  it('checks neither tables nor columns while nothing is loaded', () => {
    expect(checkSqlScript('SELECT nope.x, orders.nope FROM nope JOIN orders ON true', input())).toEqual(
      [],
    )
  })
})

// ============================================
// checkSqlScript: {{ }} expressions
// ============================================

describe('checkSqlScript {{ }} expressions', () => {
  const doc = 'SELECT *\nFROM orders\nWHERE id = {{usr}}'
  const spaced = 'SELECT *\nFROM orders\nWHERE id = {{ usr }}'

  it('flags an unknown variable in Template kind at its span', () => {
    const from = at(doc, 'usr')

    expect(checkSqlScript(doc, input({ template: true }))).toEqual([
      warning(3, "Variable 'usr' is not defined", from, from + 3),
    ])
  })

  it("maps the validator's finding for the raw text between the braces into the script", () => {
    const expected = expressionWarnings(spaced, [])

    expect(expected.map((found) => found.message)).toEqual(["Variable 'usr' is not defined"])
    expect(checkSqlScript(spaced, input({ template: true }))).toEqual(expected)
  })

  it('checks nothing inside {{ }} in Literal kind', () => {
    expect(checkSqlScript(doc, input({ template: false }))).toEqual([])
    expect(checkSqlScript(spaced, input({ template: false }))).toEqual([])
  })

  it('knows the variables it was given', () => {
    const variables: AvailableVariable[] = [{ name: 'usr', type: 'string' }]

    expect(checkSqlScript(spaced, input({ template: true, variables }))).toEqual([])
  })

  it('checks with the types of the variables it was given', () => {
    const typed = 'SELECT {{ customer_id.upper() }}'
    const variables: AvailableVariable[] = [{ name: 'customer_id', type: 'integer' }]
    const expected = expressionWarnings(typed, variables)

    expect(expected).toHaveLength(1)
    expect(checkSqlScript(typed, input({ template: true, variables }))).toEqual(expected)
  })

  it('checks every closed region and keeps each finding of one region', () => {
    const two = 'SELECT {{ a + usr }}\nFROM {{ tbl }}'
    const expected = expressionWarnings(two, [])

    expect(expected).toHaveLength(3)
    expect(checkSqlScript(two, input({ template: true }))).toEqual(expected)
  })

  it('does not check an unclosed region', () => {
    expect(checkSqlScript('SELECT {{ usr', input({ template: true }))).toEqual([])
  })

  it('ends each region at its first closing braces and reads on after them', () => {
    const doc = 'SELECT {{usr}}}} FROM {{tbl}}'
    const usr = at(doc, 'usr')
    const tbl = at(doc, 'tbl')

    expect(checkSqlScript(doc, input({ template: true }))).toEqual([
      warning(1, "Variable 'usr' is not defined", usr, usr + 3),
      warning(1, "Variable 'tbl' is not defined", tbl, tbl + 3),
    ])
  })

  it('reads an opening inside a region as part of it', () => {
    const doc = 'SELECT {{ a {{ b }}'

    expect(checkSqlScript(doc, input({ template: true }))).toEqual(expressionWarnings(doc, []))
    expect(expressionWarnings(doc, [])).not.toEqual([])
  })

  it('checks an empty region and nothing else when the braces touch', () => {
    expect(checkSqlScript('SELECT {{}}', input({ template: true }))).toEqual(
      expressionWarnings('SELECT {{}}', []),
    )
  })

  it('scans a long run of openings that never close in linear time', () => {
    const doc = `SELECT ${'{{'.repeat(100_000)}`
    const started = performance.now()

    expect(checkSqlScript(doc, input({ template: true }))).toEqual([])
    expect(performance.now() - started).toBeLessThan(1000)
  })

  it('scans a long run of openings each followed by a lone closing brace in linear time', () => {
    const doc = `SELECT ${'{{}'.repeat(70_000)}`
    const started = performance.now()

    expect(checkSqlScript(doc, input({ template: true }))).toEqual([])
    expect(performance.now() - started).toBeLessThan(1000)
  })
})

// ============================================
// checkSqlScript: order
// ============================================

describe('checkSqlScript order', () => {
  it('lists line-0 findings first, then every finding by position', () => {
    const doc = 'SELECT {{usr}} FROM nope WHERE id = :missing;\nSET search_path TO reporting;'
    const usr = at(doc, 'usr')

    expect(
      checkSqlScript(
        doc,
        input({ parameterNames: ['limit'], tables: SAMPLE_TABLES, template: true }),
      ),
    ).toEqual([
      unused('limit'),
      warning(1, "Variable 'usr' is not defined", usr, usr + 3),
      unknownTable(doc, 'nope', 1),
      undefinedAt(doc, 'missing', 1),
      sessionEnd(doc, 'SET search_path TO reporting;', 'SET search_path', 2),
    ])
  })

  it('lists an unused entry ahead of a finding at the very start of the script', () => {
    const doc = 'SET ROLE analyst;'

    expect(checkSqlScript(doc, input({ parameterNames: ['limit'] }))).toEqual([
      unused('limit'),
      sessionEnd(doc, 'SET ROLE analyst;', 'SET ROLE', 1),
    ])
  })
})

// ============================================
// sqlServerIssueWarnings
// ============================================

describe('sqlServerIssueWarnings', () => {
  const doc = 'SELECT 1;\nSELECT * FORM orders WHERE id = :id'

  it("turns a server issue into a warning over its whole line, with the parser's own text", () => {
    expect(
      sqlServerIssueWarnings(doc, [
        { line: 2, col: 20, message: 'Invalid expression / Unexpected token' },
      ]),
    ).toEqual([warning(2, 'Invalid expression / Unexpected token', 10, doc.length)])
  })

  it('spans the first line from its start to its end', () => {
    expect(sqlServerIssueWarnings(doc, [{ line: 1, col: 1, message: 'Expecting )' }])).toEqual([
      warning(1, 'Expecting )', 0, 9),
    ])
  })

  it('keeps one warning per issue', () => {
    expect(
      sqlServerIssueWarnings(doc, [
        { line: 1, col: 1, message: 'first' },
        { line: 2, col: 5, message: 'second' },
        { line: 2, col: 9, message: 'third' },
      ]),
    ).toEqual([
      warning(1, 'first', 0, 9),
      warning(2, 'second', 10, doc.length),
      warning(2, 'third', 10, doc.length),
    ])
  })

  it('drops an issue whose line is outside the script', () => {
    expect(
      sqlServerIssueWarnings(doc, [
        { line: 0, col: 1, message: 'before' },
        { line: 3, col: 1, message: 'after' },
      ]),
    ).toEqual([])
  })

  it('answers nothing for no issues', () => {
    expect(sqlServerIssueWarnings(doc, [])).toEqual([])
  })
})

// ============================================
// checkSqlScript: spots that are no table position
// ============================================

describe('checkSqlScript table positions (SQL-10, SQL-12)', () => {
  const loaded = input({ tables: SAMPLE_TABLES })

  it.each([
    ['EXTRACT', 'SELECT EXTRACT(YEAR FROM created_at) FROM orders'],
    ['SUBSTRING', 'SELECT SUBSTRING(email FROM pos) FROM customers'],
    ['SUBSTRING with a number', 'SELECT SUBSTRING(email FROM 2) FROM customers'],
    ['TRIM', "SELECT TRIM(BOTH ' ' FROM email) FROM customers"],
    ['OVERLAY', "SELECT OVERLAY(email PLACING 'x' FROM pos) FROM customers"],
    ['a call in lower case', 'select extract(year from created_at) from orders'],
  ])('flags nothing for the FROM inside %s', (_call, doc) => {
    expect(checkSqlScript(doc, loaded)).toEqual([])
  })

  it('still checks the table after the FROM that follows the call', () => {
    const doc = 'SELECT EXTRACT(YEAR FROM created_at) FROM nope'

    expect(checkSqlScript(doc, loaded)).toEqual([unknownTable(doc, 'nope', 1)])
  })

  it.each([
    ['IN', 'SELECT * FROM orders WHERE id IN (SELECT id FROM nope)'],
    ['EXISTS with WITH', 'SELECT 1 WHERE EXISTS (WITH x AS (SELECT 1) SELECT * FROM nope)'],
    ['a comparison', 'SELECT * FROM orders WHERE id = (SELECT max(id) FROM nope)'],
    ['a call', 'SELECT EXTRACT(YEAR FROM (SELECT max(created_at) FROM nope))'],
    ['a CTE', 'WITH o AS (SELECT * FROM nope) SELECT * FROM o'],
  ])('checks the table of a subquery after %s', (_case, doc) => {
    expect(checkSqlScript(doc, loaded)).toContainEqual(unknownTable(doc, 'nope', 1))
  })

  it('checks the next statement after one that leaves a ( open', () => {
    const doc = 'SELECT EXTRACT(YEAR;\nSELECT * FROM nope'

    expect(checkSqlScript(doc, loaded)).toEqual([unknownTable(doc, 'nope', 2)])
  })

  it('checks the next batch after one that leaves a ( open on SQL Server', () => {
    const doc = 'SELECT EXTRACT(YEAR\nGO\nSELECT * FROM nope'

    expect(checkSqlScript(doc, input({ databaseType: 'mssql', tables: SAMPLE_TABLES }))).toEqual([
      unknownTable(doc, 'nope', 3),
    ])
  })

  it.each([
    ['DO UPDATE', "INSERT INTO orders (id) VALUES (1) ON CONFLICT (id) DO UPDATE SET status = 'x'"],
    ['ON DUPLICATE KEY UPDATE', "INSERT INTO orders (id) VALUES (1) ON DUPLICATE KEY UPDATE status = 'x'"],
    ['FOR UPDATE', 'SELECT * FROM orders FOR UPDATE SKIP LOCKED'],
    ['FOR NO KEY UPDATE', 'SELECT * FROM orders FOR NO KEY UPDATE NOWAIT'],
    ['for update in lower case', 'select * from orders for update nowait'],
  ])('flags nothing after %s', (_case, doc) => {
    expect(checkSqlScript(doc, loaded)).toEqual([])
  })

  it('still checks the table of an UPDATE statement after a FOR UPDATE', () => {
    const doc = "SELECT * FROM orders FOR UPDATE;\nUPDATE nope SET status = 'x'"

    expect(checkSqlScript(doc, loaded)).toEqual([unknownTable(doc, 'nope', 2)])
  })

  it.each([
    ['oracle', 'SELECT 1 FROM dual'],
    ['oracle', 'SELECT SYSDATE FROM DUAL'],
    ['mysql', 'SELECT 1 FROM Dual'],
  ] as const)('never flags DUAL on %s: %s', (databaseType, doc) => {
    expect(checkSqlScript(doc, input({ databaseType, tables: SAMPLE_TABLES }))).toEqual([])
  })

  it.each(['oracle', 'mysql'] as const)('still checks any other table on %s', (databaseType) => {
    const doc = 'SELECT 1 FROM nope'

    expect(checkSqlScript(doc, input({ databaseType, tables: SAMPLE_TABLES }))).toEqual([
      unknownTable(doc, 'nope', 1),
    ])
  })

  it.each(['postgresql', 'mssql', 'sqlite'] as const)('flags DUAL like any other table on %s', (databaseType) => {
    const doc = 'SELECT 1 FROM dual'

    expect(checkSqlScript(doc, input({ databaseType, tables: SAMPLE_TABLES }))).toEqual([
      unknownTable(doc, 'dual', 1),
    ])
  })

  it.each([
    ['FROM ONLY', 'SELECT * FROM ONLY orders'],
    ['JOIN ONLY', 'SELECT * FROM orders JOIN ONLY customers ON true'],
    ['from only in lower case', 'select * from only orders'],
    ['JOIN LATERAL', 'SELECT * FROM orders JOIN LATERAL (SELECT id FROM order_items) AS i ON true'],
    ['CROSS JOIN LATERAL', 'SELECT * FROM orders CROSS JOIN LATERAL unnest(tags) AS t'],
    ['FROM LATERAL', 'SELECT * FROM LATERAL generate_series(1, 3)'],
  ])('reads %s as a keyword, not a table', (_case, doc) => {
    expect(checkSqlScript(doc, loaded)).toEqual([])
  })

  it.each([
    ['FROM ONLY', 'SELECT * FROM ONLY nope'],
    ['JOIN ONLY', 'SELECT * FROM orders JOIN ONLY nope ON true'],
  ])('checks the table after %s', (_case, doc) => {
    expect(checkSqlScript(doc, loaded)).toEqual([unknownTable(doc, 'nope', 1)])
  })

  it('checks the tables inside a LATERAL subquery', () => {
    const doc = 'SELECT * FROM orders JOIN LATERAL (SELECT id FROM nope) AS i ON true'

    expect(checkSqlScript(doc, loaded)).toEqual([unknownTable(doc, 'nope', 1)])
  })
})

// ============================================
// UPDATE that starts no statement, trigger tables and statement bodies (SQL-10, SQL-12)
// ============================================

describe('checkSqlScript table positions beyond FROM, JOIN, INTO and UPDATE', () => {
  const loaded = input({ tables: SAMPLE_TABLES })

  it.each([
    ['GRANT with a privilege list', 'GRANT SELECT, UPDATE ON orders TO reporter'],
    ['GRANT UPDATE', 'GRANT UPDATE ON orders TO reporter'],
    ['GRANT UPDATE on columns', 'GRANT UPDATE (status) ON orders TO reporter'],
    ['REVOKE, whose FROM names a grantee', 'REVOKE INSERT, UPDATE ON orders FROM reporter'],
    ['grant in lower case', 'grant select, update on orders to reporter'],
    ['BEFORE UPDATE', 'CREATE TRIGGER trg BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION f()'],
    ['AFTER INSERT OR UPDATE', 'CREATE TRIGGER trg AFTER INSERT OR UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION f()'],
    ['UPDATE OF a column', 'CREATE TRIGGER trg AFTER INSERT OR UPDATE OF status ON orders FOR EACH ROW EXECUTE FUNCTION f()'],
    ['INSTEAD OF UPDATE', 'CREATE TRIGGER trg INSTEAD OF UPDATE ON active_customers FOR EACH ROW EXECUTE FUNCTION f()'],
    ['ON UPDATE CASCADE', 'CREATE TABLE lines (order_id int REFERENCES orders (id) ON UPDATE CASCADE ON DELETE SET NULL)'],
    ['ON UPDATE SET NULL', 'ALTER TABLE order_items ADD FOREIGN KEY (order_id) REFERENCES orders (id) ON UPDATE SET NULL'],
    ['MySQL ON UPDATE CURRENT_TIMESTAMP', 'CREATE TABLE audit (at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)'],
  ])('flags nothing for %s', (_case, doc) => {
    expect(checkSqlScript(doc, loaded)).toEqual([])
  })

  it.each([
    ['BEFORE UPDATE', 'CREATE TRIGGER trg BEFORE UPDATE ON nope FOR EACH ROW EXECUTE FUNCTION f()'],
    ['AFTER INSERT OR UPDATE', 'CREATE OR REPLACE TRIGGER trg AFTER INSERT OR UPDATE ON nope FOR EACH ROW EXECUTE FUNCTION f()'],
    ['the SQL Server form', 'CREATE TRIGGER trg ON nope AFTER INSERT, UPDATE AS SELECT 1'],
  ])('checks the table after ON in a trigger header: %s', (_case, doc) => {
    expect(checkSqlScript(doc, loaded)).toEqual([unknownTable(doc, 'nope', 1)])
  })

  it('checks the tables a trigger body writes, not the ON of a join inside it', () => {
    const doc =
      'CREATE TRIGGER trg AFTER UPDATE ON orders FOR EACH ROW\n' +
      'UPDATE nope JOIN customers ON customers.id = nope.id SET x = 1'

    expect(checkSqlScript(doc, loaded)).toEqual([unknownTable(doc, 'nope', 2)])
  })

  it('reads the ON of CREATE INDEX as no table position', () => {
    expect(checkSqlScript('CREATE INDEX idx ON whatever (status)', loaded)).toEqual([])
  })

  it('checks the statement after a GRANT', () => {
    const doc = 'GRANT UPDATE ON orders TO reporter;\nUPDATE nope SET x = 1'

    expect(checkSqlScript(doc, loaded)).toEqual([unknownTable(doc, 'nope', 2)])
  })

  it.each([
    ['UPDATE ONLY', "UPDATE ONLY nope SET status = 'x'"],
    ['update only in lower case', "update only nope set status = 'x'"],
  ])('checks the table after %s, not ONLY', (_case, doc) => {
    expect(checkSqlScript(doc, loaded)).toEqual([unknownTable(doc, 'nope', 1)])
  })

  it('flags nothing for UPDATE ONLY on a loaded table', () => {
    expect(checkSqlScript("UPDATE ONLY orders SET status = 'x'", loaded)).toEqual([])
  })

  it('checks the table in a data-modifying WITH', () => {
    const doc = 'WITH d AS (DELETE FROM nope RETURNING id) SELECT * FROM d'

    expect(checkSqlScript(doc, loaded)).toContainEqual(unknownTable(doc, 'nope', 1))
  })

  it('flags nothing for a data-modifying WITH on a loaded table', () => {
    const doc = 'WITH d AS (DELETE FROM orders RETURNING id) SELECT id FROM orders'

    expect(checkSqlScript(doc, loaded)).toEqual([])
  })
})

// ============================================
// A keyword where a table name goes (SQL-12)
// ============================================

describe('checkSqlScript a keyword where a table name goes (SQL-12)', () => {
  const loaded = input({ tables: SAMPLE_TABLES })

  it.each([
    ['FROM then WHERE', 'SELECT * FROM WHERE id = 1'],
    ['FROM at a line end, WHERE on the next line', 'SELECT id, status\nFROM \nWHERE customer_id = 1'],
    ['FROM then GROUP BY', 'SELECT status FROM GROUP BY status'],
    ['FROM then ORDER BY', 'SELECT * FROM ORDER BY id'],
    ['FROM then LIMIT', 'SELECT * FROM LIMIT 5'],
    ['FROM then UNION', 'SELECT id FROM UNION SELECT id FROM orders'],
    ['FROM then JOIN', 'SELECT * FROM JOIN orders ON true'],
    ['FROM then LEFT JOIN', 'SELECT * FROM LEFT JOIN orders ON true'],
    ['JOIN then ON', 'SELECT * FROM orders JOIN ON true'],
    ['JOIN then USING', 'SELECT * FROM orders JOIN USING (id)'],
    ['INTO then VALUES', 'INSERT INTO VALUES (1)'],
    ['INTO then SELECT', 'INSERT INTO SELECT * FROM orders'],
    ['UPDATE then SET', "UPDATE SET status = 'x'"],
    ['DELETE FROM then WHERE', 'DELETE FROM WHERE id = 1'],
    ['a keyword in lower case', 'select * from where id = 1'],
  ])('reads %s as no table name', (_case, doc) => {
    expect(checkSqlScript(doc, loaded)).toEqual([])
  })

  it.each(ALL_TYPES)('reads FROM WHERE as no table name on %s', (databaseType) => {
    expect(
      checkSqlScript('SELECT * FROM WHERE id = 1', input({ databaseType, tables: SAMPLE_TABLES })),
    ).toEqual([])
  })

  it('reads the TABLE of an Oracle table function as no table name', () => {
    expect(
      checkSqlScript(
        'SELECT * FROM TABLE(order_lines(1))',
        input({ databaseType: 'oracle', tables: SAMPLE_TABLES }),
      ),
    ).toEqual([])
  })

  it('reads the TOP of a SQL Server UPDATE TOP (n) as no table name', () => {
    expect(
      checkSqlScript(
        "UPDATE TOP (5) orders SET status = 'x'",
        input({ databaseType: 'mssql', tables: SAMPLE_TABLES }),
      ),
    ).toEqual([])
  })

  it('still flags an unknown table in the same script', () => {
    const doc = 'SELECT id FROM ordrs; SELECT id FROM WHERE id = 1'

    expect(checkSqlScript(doc, loaded)).toEqual([unknownTable(doc, 'ordrs', 1)])
  })

  it('checks a quoted keyword, which is a table name', () => {
    const doc = 'SELECT * FROM "where"'
    const from = at(doc, '"where"')

    expect(checkSqlScript(doc, loaded)).toEqual([
      warning(1, "Table 'where' is not in the loaded tables", from, from + '"where"'.length),
    ])
  })
})

// ============================================
// Nested block comments (SQL-2, SQL-10)
// ============================================

describe('findSqlPlaceholders nested block comments', () => {
  const OTHER_TYPES = ['mysql', 'oracle', 'mssql', 'sqlite'] as const

  it('reads a block comment inside a block comment as one comment on PostgreSQL', () => {
    expect(names('SELECT /* outer /* inner */ :x */ :y', 'postgresql')).toEqual(['y'])
  })

  it('nests block comments to any depth on PostgreSQL', () => {
    expect(names('SELECT /* 1 /* 2 /* 3 */ :x */ :y */ :z', 'postgresql')).toEqual(['z'])
  })

  it('reads the rest of the script as comment while a nested comment stays open on PostgreSQL', () => {
    expect(names('SELECT /* outer /* inner */ :x', 'postgresql')).toEqual([])
  })

  it.each(OTHER_TYPES)('ends a block comment at the first */ on %s', (databaseType) => {
    expect(names('SELECT /* outer /* inner */ :x */ :y', databaseType)).toEqual(['x', 'y'])
  })

  it.each(OTHER_TYPES)('does not nest three levels on %s', (databaseType) => {
    expect(names('SELECT /* 1 /* 2 /* 3 */ :x */ :y */ :z', databaseType)).toEqual(['x', 'y', 'z'])
  })

  it('checks the table after a nested comment on PostgreSQL only', () => {
    const doc = 'SELECT * /* a /* b */ FROM nope */ FROM orders'

    expect(checkSqlScript(doc, input({ tables: SAMPLE_TABLES }))).toEqual([])
    expect(checkSqlScript(doc, input({ databaseType: 'mysql', tables: SAMPLE_TABLES }))).toEqual([
      unknownTable(doc, 'nope', 1),
    ])
  })
})
