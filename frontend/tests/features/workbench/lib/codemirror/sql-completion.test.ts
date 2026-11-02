/**
 * The SQL body's suggestion source: each kind of suggestion only in its place.
 *
 * REQ-3.4.1.6; SQL-11, SQL-12
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { waitFor } from '@testing-library/react'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import {
  CompletionContext,
  autocompletion,
  startCompletion,
  type Completion,
  type CompletionResult,
  type CompletionSection,
} from '@codemirror/autocomplete'
import { MySQL, PostgreSQL, keywordCompletionSource, type SQLDialect } from '@codemirror/lang-sql'

import {
  createSqlCompletionSource,
  type SqlCompletionOptions,
} from '@/features/workbench/lib/codemirror/sql-completion'
import {
  SQL_GET_TABLES_TYPE,
  SQL_PARAMETER_TYPE,
  buildSqlModeExtensions,
} from '@/features/workbench/lib/codemirror/sql-mode'
import {
  createTemplateCompletionSource,
  type AvailableVariable,
} from '@/features/workbench/lib/codemirror/expression-completion'
import type { SqlDatabaseType } from '@/lib/codemirror/format-editor'
import type { SqlTable } from '@/features/workbench/api/sql-tools'

import { ACTIVE_CUSTOMERS, ORDERS, SAMPLE_TABLES } from '../../sql-fixtures'

// ============================================
// Test Helpers
// ============================================

const GET_TABLES = 'Get tables from the database'
const TABLE_NAMES = ['orders', 'order_items', 'customers', 'active_customers']
const PARAMETER_NAMES = ['customer', 'status', 'limit']
const VARIABLES: AvailableVariable[] = [{ name: 'usr', type: 'str', source: 'Test' }]

// A second schema beside the fixtures' public one.
const AUDIT_LOG: SqlTable = {
  schema: 'audit',
  name: 'log',
  kind: 'table',
  columns: [
    { name: 'id', type: 'integer' },
    { name: 'action', type: 'text' },
  ],
}
const AUDIT_EVENTS: SqlTable = {
  schema: 'audit',
  name: 'events',
  kind: 'view',
  columns: [{ name: 'at', type: 'timestamp' }],
}
const TWO_SCHEMAS: readonly SqlTable[] = [ORDERS, AUDIT_LOG, ...SAMPLE_TABLES.slice(1), AUDIT_EVENTS]

const views: EditorView[] = []

afterEach(() => {
  for (const view of views) {
    view.destroy()
  }
  views.length = 0
})

function optionsWith(overrides: Partial<SqlCompletionOptions> = {}): SqlCompletionOptions {
  return {
    databaseType: 'postgresql',
    parameterNames: null,
    tables: null,
    variables: VARIABLES,
    template: false,
    onGetTables: vi.fn(),
    ...overrides,
  }
}

function stateFor(doc: string, databaseType: SqlDatabaseType = 'postgresql'): EditorState {
  return EditorState.create({ doc, extensions: buildSqlModeExtensions({ databaseType, issues: [] }) })
}

/** Asks the source at `pos` (the end of the doc by default). */
function complete(
  doc: string,
  overrides: Partial<SqlCompletionOptions> = {},
  { explicit = false, pos = doc.length }: { explicit?: boolean; pos?: number } = {},
): CompletionResult | null {
  const options = optionsWith(overrides)
  const context = new CompletionContext(stateFor(doc, options.databaseType), pos, explicit)
  return createSqlCompletionSource(options)(context)
}

function keywordAnswer(
  doc: string,
  dialect: SQLDialect,
  databaseType: SqlDatabaseType,
  explicit = false,
): CompletionResult | null {
  const context = new CompletionContext(stateFor(doc, databaseType), doc.length, explicit)
  return keywordCompletionSource(dialect, true)(context) as CompletionResult | null
}

function sectionOf(option: Completion): CompletionSection | string | undefined {
  return option.section
}

function sectionName(option: Completion): string | undefined {
  const section = sectionOf(option)
  return typeof section === 'string' ? section : section?.name
}

function labelsOf(result: CompletionResult | null): string[] {
  return (result?.options ?? []).map((option) => option.label)
}

function sectionsOf(result: CompletionResult | null): (string | undefined)[] {
  return [...new Set((result?.options ?? []).map(sectionName))]
}

function mount(doc: string): EditorView {
  const view = new EditorView({
    state: EditorState.create({
      doc,
      selection: EditorSelection.cursor(doc.length),
      extensions: buildSqlModeExtensions({ databaseType: 'postgresql', issues: [] }),
    }),
    parent: document.body,
  })
  views.push(view)
  return view
}

// ============================================
// Table position, nothing loaded (SQL-12)
// ============================================

describe('createSqlCompletionSource - table position with nothing loaded', () => {
  it.each([
    'SELECT * FROM ',
    'SELECT * FROM orders o JOIN ',
    'INSERT INTO ',
    'UPDATE ',
    'select * from ',
    'select * from o left join ',
    'SELECT *\nFROM\n  ',
    'SELECT * FROM ord',
    'Update cust',
  ])('offers only the Get tables row after %j', (doc) => {
    const result = complete(doc)

    expect(labelsOf(result)).toEqual([GET_TABLES])
    expect(sectionsOf(result)).toEqual(['Tables'])
    expect(result?.from).toBe(doc.length)
  })

  it('offers the same row after table. while nothing is loaded', () => {
    const result = complete('SELECT orders.')

    expect(labelsOf(result)).toEqual([GET_TABLES])
    expect(sectionsOf(result)).toEqual(['Tables'])
  })

  it('starts the catalog pull once and leaves the script unchanged when the row is picked', () => {
    const onGetTables = vi.fn()
    const doc = 'SELECT * FROM '
    const view = mount(doc)
    const result = complete(doc, { onGetTables })
    const option = result?.options[0]

    expect(typeof option?.apply).toBe('function')
    const apply = option?.apply as (
      view: EditorView,
      completion: Completion,
      from: number,
      to: number,
    ) => void
    apply(view, option as Completion, result?.from ?? doc.length, doc.length)

    expect(onGetTables).toHaveBeenCalledTimes(1)
    expect(view.state.doc.toString()).toBe(doc)
  })

  it('starts nothing while the list is only offered', () => {
    const onGetTables = vi.fn()

    complete('SELECT * FROM ', { onGetTables })

    expect(onGetTables).not.toHaveBeenCalled()
  })

  it('draws the Tables header with the shared section header', () => {
    const option = complete('SELECT * FROM ')?.options[0] as Completion
    const section = sectionOf(option) as CompletionSection

    expect(typeof section.header).toBe('function')
    const header = section.header?.(section) as HTMLElement
    expect(header.className).toBe('cm-completionSection')
    expect(header.textContent).toBe('Tables')
  })
})

// ============================================
// Loaded tables and columns (SQL-11)
// ============================================

describe('createSqlCompletionSource - loaded tables', () => {
  it.each(['SELECT * FROM ', 'SELECT * FROM orders o JOIN ', 'INSERT INTO ', 'UPDATE '])(
    'offers every loaded table in catalog order after %j',
    (doc) => {
      const result = complete(doc, { tables: SAMPLE_TABLES })

      expect(labelsOf(result)).toEqual(TABLE_NAMES)
      expect(sectionsOf(result)).toEqual(['Tables'])
      expect(result?.from).toBe(doc.length)
    },
  )

  it('replaces the partial name typed after FROM', () => {
    const result = complete('SELECT * FROM ord', { tables: SAMPLE_TABLES })

    expect(labelsOf(result)).toEqual(TABLE_NAMES)
    expect(result?.from).toBe('SELECT * FROM '.length)
  })

  it('offers no Get tables row once tables are loaded', () => {
    expect(labelsOf(complete('SELECT * FROM ', { tables: SAMPLE_TABLES }))).not.toContain(GET_TABLES)
  })

  it('offers the columns of a table after its name and a dot, in catalog order', () => {
    const result = complete('SELECT orders.', { tables: SAMPLE_TABLES })

    expect(labelsOf(result)).toEqual(ORDERS.columns.map((column) => column.name))
    expect(sectionsOf(result)).toEqual(['Tables'])
    expect(result?.from).toBe('SELECT orders.'.length)
  })

  it('replaces the partial column typed after the dot', () => {
    const result = complete('SELECT orders.cu', { tables: SAMPLE_TABLES })

    expect(labelsOf(result)).toEqual(ORDERS.columns.map((column) => column.name))
    expect(result?.from).toBe('SELECT orders.'.length)
  })

  it('matches the table name before the dot in any case', () => {
    const result = complete('SELECT ORDERS.', { tables: SAMPLE_TABLES })

    expect(labelsOf(result)).toEqual(ORDERS.columns.map((column) => column.name))
  })

  it('offers the columns of a view like those of a table', () => {
    const result = complete('SELECT active_customers.', { tables: SAMPLE_TABLES })

    expect(labelsOf(result)).toEqual(ACTIVE_CUSTOMERS.columns.map((column) => column.name))
  })

  it('offers nothing after a name that is no loaded table', () => {
    expect(complete('SELECT o.', { tables: SAMPLE_TABLES })).toBeNull()
  })

  it('offers no Get tables row for a loaded empty catalog', () => {
    const result = complete('SELECT * FROM ', { tables: [] })

    expect(labelsOf(result)).toEqual([])
  })
})

// ============================================
// Schema-qualified names (SQL-11)
// ============================================

describe('createSqlCompletionSource - schema-qualified names', () => {
  it.each([
    ['SELECT * FROM public.', TABLE_NAMES],
    ['SELECT * FROM audit.', ['log', 'events']],
    ['SELECT * FROM orders o JOIN audit.', ['log', 'events']],
    ['INSERT INTO audit.', ['log', 'events']],
    ['UPDATE public.', TABLE_NAMES],
  ])('offers the tables of the schema, in catalog order, after %j', (doc, expected) => {
    const result = complete(doc, { tables: TWO_SCHEMAS })

    expect(labelsOf(result)).toEqual(expected)
    expect(sectionsOf(result)).toEqual(['Tables'])
    expect(result?.from).toBe(doc.length)
  })

  it('replaces the partial table name typed after the schema and its dot', () => {
    const result = complete('SELECT * FROM audit.lo', { tables: TWO_SCHEMAS })

    expect(labelsOf(result)).toEqual(['log', 'events'])
    expect(result?.from).toBe('SELECT * FROM audit.'.length)
  })

  it('offers the columns after schema.table and a dot', () => {
    const result = complete('SELECT audit.log.', { tables: TWO_SCHEMAS })

    expect(labelsOf(result)).toEqual(AUDIT_LOG.columns.map((column: { name: string }) => column.name))
    expect(sectionsOf(result)).toEqual(['Tables'])
    expect(result?.from).toBe('SELECT audit.log.'.length)
  })

  it('offers the Get tables row after schema. while nothing is loaded', () => {
    const result = complete('SELECT * FROM audit.')

    expect(labelsOf(result)).toEqual([GET_TABLES])
    expect(sectionsOf(result)).toEqual(['Tables'])
  })

  it('offers nothing after a name that is neither a loaded table nor a schema', () => {
    expect(complete('SELECT * FROM billing.', { tables: TWO_SCHEMAS })).toBeNull()
  })
})

// ============================================
// Parameters after ':' (SQL-2, SQL-11)
// ============================================

describe('createSqlCompletionSource - parameters', () => {
  it('offers the Parameters entries in row order right after a colon', () => {
    const doc = 'SELECT * FROM orders WHERE customer_id = :'
    const result = complete(doc, { parameterNames: PARAMETER_NAMES })

    expect(labelsOf(result)).toEqual(PARAMETER_NAMES)
    expect(sectionsOf(result)).toEqual(['Parameters'])
    expect(result?.from).toBe(doc.length)
  })

  it('replaces the partial name typed after the colon', () => {
    const doc = 'SELECT * FROM orders WHERE customer_id = :cu'
    const result = complete(doc, { parameterNames: PARAMETER_NAMES })

    expect(labelsOf(result)).toEqual(PARAMETER_NAMES)
    expect(result?.from).toBe(doc.length - 2)
  })

  it('offers the Parameters entries even with tables loaded', () => {
    const result = complete('UPDATE orders SET status = :', {
      parameterNames: PARAMETER_NAMES,
      tables: SAMPLE_TABLES,
    })

    expect(labelsOf(result)).toEqual(PARAMETER_NAMES)
    expect(sectionsOf(result)).toEqual(['Parameters'])
  })

  it('offers nothing while Parameters is an expression', () => {
    expect(complete('WHERE id = :', { parameterNames: null })).toBeNull()
  })

  it('offers nothing when Parameters has no entry', () => {
    expect(complete('WHERE id = :', { parameterNames: [] })).toBeNull()
  })

  it.each([
    ['a cast', 'SELECT x::'],
    ['a cast with a type typed', 'SELECT x::in'],
    ['an open string', "WHERE name = ':cu"],
    ['a quoted identifier', 'SELECT ":cu'],
    ['a line comment', 'SELECT 1 -- :cu'],
    ['a block comment', 'SELECT 1 /* :cu'],
  ])('offers no Parameters entry after %s', (_label, doc) => {
    const result = complete(doc, { parameterNames: PARAMETER_NAMES })

    expect(sectionsOf(result)).not.toContain('Parameters')
    expect(labelsOf(result)).not.toContain('customer')
  })

  it('offers no Parameters entry after a # comment on MySQL', () => {
    const result = complete('SELECT 1 # :cu', { databaseType: 'mysql', parameterNames: PARAMETER_NAMES })

    expect(sectionsOf(result)).not.toContain('Parameters')
  })

  it('offers the Parameters entries after # on PostgreSQL, where it is an operator', () => {
    const result = complete('SELECT 1 # :cu', { parameterNames: PARAMETER_NAMES })

    expect(labelsOf(result)).toEqual(PARAMETER_NAMES)
  })

  it('offers no Parameters entry inside a closed string', () => {
    const doc = "WHERE name = ':cu' AND id = 1"
    const result = complete(doc, { parameterNames: PARAMETER_NAMES }, { pos: doc.indexOf("'", 14) })

    expect(sectionsOf(result)).not.toContain('Parameters')
  })
})

// ============================================
// WAVE variables inside {{ }} (SQL-11)
// ============================================

describe('createSqlCompletionSource - template regions', () => {
  it('answers exactly as the template source inside {{ in Template kind', () => {
    const doc = 'SELECT * FROM orders WHERE id = {{ '
    const result = complete(doc, { template: true, parameterNames: PARAMETER_NAMES, tables: SAMPLE_TABLES })
    const expected = createTemplateCompletionSource(VARIABLES, true)(
      new CompletionContext(stateFor(doc), doc.length, false),
    )

    expect(labelsOf(result)).toEqual(labelsOf(expected))
    expect(result?.from).toBe(expected?.from)
    expect(labelsOf(result)).toContain('usr')
    expect(sectionsOf(result)).not.toContain('Tables')
    expect(sectionsOf(result)).not.toContain('Parameters')
  })

  it('offers the variables for a partial name inside {{', () => {
    const doc = 'SELECT {{ us'
    const result = complete(doc, { template: true })

    expect(labelsOf(result)).toContain('usr')
    expect(result?.from).toBe(doc.length - 2)
  })

  it('answers with the template source at a table position inside {{', () => {
    const result = complete('SELECT * FROM {{ ', { template: true })

    expect(labelsOf(result)).toContain('usr')
    expect(labelsOf(result)).not.toContain(GET_TABLES)
  })

  it('returns to the SQL suggestions once the {{ }} region is closed', () => {
    const result = complete('SELECT {{ usr }} FROM ', { template: true })

    expect(labelsOf(result)).toEqual([GET_TABLES])
  })

  it('offers no variable inside {{ in Literal kind', () => {
    const doc = 'SELECT {{ us'
    const result = complete(doc, { template: false })

    expect(labelsOf(result)).not.toContain('usr')
    expect(labelsOf(result)).toEqual(labelsOf(keywordAnswer(doc, PostgreSQL, 'postgresql')))
  })
})

// ============================================
// Keywords elsewhere (SQL-11)
// ============================================

describe('createSqlCompletionSource - keywords', () => {
  it('offers SELECT in upper case for sel', () => {
    const result = complete('sel')

    expect(labelsOf(result)).toContain('SELECT')
    expect(labelsOf(result)).not.toContain('select')
    expect(result?.from).toBe(0)
  })

  it('offers COUNT for SELECT coun', () => {
    const result = complete('SELECT coun')

    expect(labelsOf(result)).toContain('COUNT')
    expect(result?.from).toBe('SELECT '.length)
  })

  it('offers nothing with no word typed unless asked', () => {
    expect(complete('')).toBeNull()
    expect(complete('SELECT id ')).toBeNull()
  })

  it('offers the keywords with no word typed when asked', () => {
    expect(labelsOf(complete('', {}, { explicit: true }))).toContain('SELECT')
  })

  it('answers exactly as the dialect keyword source', () => {
    const doc = 'SELECT coun'

    expect(labelsOf(complete(doc))).toEqual(labelsOf(keywordAnswer(doc, PostgreSQL, 'postgresql')))
  })

  it('offers the keywords of the Database type', () => {
    const doc = 'CREATE TABLE t (id INT AUTO_'
    const mysql = complete(doc, { databaseType: 'mysql' })

    expect(labelsOf(mysql)).toEqual(labelsOf(keywordAnswer(doc, MySQL, 'mysql')))
    expect(labelsOf(mysql)).toContain('AUTO_INCREMENT')
    expect(labelsOf(complete(doc, { databaseType: 'postgresql' }))).not.toContain('AUTO_INCREMENT')
  })

  it('offers keywords, not tables, once a later keyword follows the table', () => {
    const doc = 'SELECT * FROM orders WHERE st'
    const result = complete(doc, { tables: SAMPLE_TABLES, parameterNames: PARAMETER_NAMES })

    expect(labelsOf(result)).toEqual(labelsOf(keywordAnswer(doc, PostgreSQL, 'postgresql')))
    expect(sectionsOf(result)).not.toContain('Tables')
    expect(sectionsOf(result)).not.toContain('Parameters')
  })

  it('offers no keyword at a table position', () => {
    expect(labelsOf(complete('SELECT * FROM sel'))).toEqual([GET_TABLES])
    expect(labelsOf(complete('SELECT * FROM sel', { tables: SAMPLE_TABLES }))).toEqual(TABLE_NAMES)
  })
})

// ============================================
// Spots that are no table position (SQL-11, SQL-12)
// ============================================

describe('createSqlCompletionSource - spots that are no table position', () => {
  it.each([
    'SELECT EXTRACT(YEAR FROM ',
    'SELECT SUBSTRING(email FROM ',
    "SELECT TRIM(BOTH ' ' FROM ",
    "SELECT OVERLAY(email PLACING 'x' FROM ",
    'INSERT INTO orders (id) VALUES (1) ON CONFLICT (id) DO UPDATE ',
    'INSERT INTO orders (id) VALUES (1) ON DUPLICATE KEY UPDATE ',
    'SELECT * FROM orders FOR UPDATE ',
    'SELECT * FROM orders FOR NO KEY UPDATE ',
    'SELECT * FROM orders JOIN LATERAL ',
    'SELECT * FROM LATERAL ',
  ])('offers the keywords, not the tables, after %j', (doc) => {
    const result = complete(doc, { tables: SAMPLE_TABLES }, { explicit: true })

    expect(labelsOf(result)).toEqual(labelsOf(keywordAnswer(doc, PostgreSQL, 'postgresql', true)))
    expect(sectionsOf(result)).not.toContain('Tables')
  })

  it('offers no Get tables row inside a call while nothing is loaded', () => {
    const result = complete('SELECT EXTRACT(YEAR FROM ', {}, { explicit: true })

    expect(labelsOf(result)).not.toContain(GET_TABLES)
    expect(sectionsOf(result)).not.toContain('Tables')
  })

  it.each([
    'SELECT * FROM ONLY ',
    'SELECT * FROM orders JOIN ONLY ',
    'SELECT * FROM orders WHERE id IN (SELECT id FROM ',
    'SELECT EXTRACT(YEAR FROM (SELECT max(created_at) FROM ',
    'WITH o AS (SELECT * FROM ',
    'SELECT * FROM orders FOR UPDATE;\nUPDATE ',
  ])('offers every loaded table after %j', (doc) => {
    const result = complete(doc, { tables: SAMPLE_TABLES })

    expect(labelsOf(result)).toEqual(TABLE_NAMES)
    expect(result?.from).toBe(doc.length)
  })

  it('replaces the partial name typed after FROM ONLY', () => {
    const result = complete('SELECT * FROM ONLY ord', { tables: SAMPLE_TABLES })

    expect(labelsOf(result)).toEqual(TABLE_NAMES)
    expect(result?.from).toBe('SELECT * FROM ONLY '.length)
  })

  it('offers the Get tables row after FROM ONLY while nothing is loaded', () => {
    expect(labelsOf(complete('SELECT * FROM ONLY '))).toEqual([GET_TABLES])
  })
})

// ============================================
// UPDATE that starts no statement, trigger tables and statement bodies (SQL-11, SQL-12)
// ============================================

describe('createSqlCompletionSource - positions beyond FROM, JOIN, INTO and UPDATE', () => {
  it.each([
    'GRANT SELECT, UPDATE ',
    'REVOKE UPDATE ON orders FROM ',
    'CREATE TRIGGER trg BEFORE UPDATE ',
    'CREATE TRIGGER trg AFTER INSERT OR UPDATE ',
    'CREATE TABLE lines (order_id int REFERENCES orders (id) ON UPDATE ',
    'CREATE TABLE audit (at TIMESTAMP ON UPDATE ',
  ])('offers the keywords, not the tables, after %j', (doc) => {
    const result = complete(doc, { tables: SAMPLE_TABLES }, { explicit: true })

    expect(labelsOf(result)).toEqual(labelsOf(keywordAnswer(doc, PostgreSQL, 'postgresql', true)))
    expect(sectionsOf(result)).not.toContain('Tables')
  })

  it.each([
    'CREATE TRIGGER trg BEFORE UPDATE ON ',
    'CREATE TRIGGER trg AFTER INSERT OR UPDATE OF status ON ',
    'UPDATE ONLY ',
    'WITH d AS (DELETE FROM ',
  ])('offers every loaded table after %j', (doc) => {
    const result = complete(doc, { tables: SAMPLE_TABLES })

    expect(labelsOf(result)).toEqual(TABLE_NAMES)
    expect(result?.from).toBe(doc.length)
  })

  it('offers the Get tables row after the ON of a trigger header while nothing is loaded', () => {
    expect(labelsOf(complete('CREATE TRIGGER trg BEFORE UPDATE ON '))).toEqual([GET_TABLES])
  })
})

// ============================================
// Row icons (SQL-11, SQL-12)
// ============================================

describe('createSqlCompletionSource - row icons', () => {
  /** The rendered suggestion list's icon classes, row by row, once the list opens at the end of `doc`. */
  async function iconClassesAt(doc: string, overrides: Partial<SqlCompletionOptions> = {}) {
    const view = new EditorView({
      state: EditorState.create({
        doc,
        selection: EditorSelection.cursor(doc.length),
        extensions: [
          buildSqlModeExtensions({ databaseType: 'postgresql', issues: [] }),
          autocompletion({ override: [createSqlCompletionSource(optionsWith(overrides))] }),
        ],
      }),
      parent: document.body,
    })
    views.push(view)
    startCompletion(view)
    await waitFor(() => {
      expect(view.dom.ownerDocument.querySelector('.cm-tooltip-autocomplete li')).not.toBeNull()
    })
    return [...document.querySelectorAll('.cm-tooltip-autocomplete li .cm-completionIcon')].map(
      (icon) => icon.className,
    )
  }

  /** The declarations of every mounted rule whose selector ends in `selector`. */
  function mountedRules(selector: string): string[] {
    const css = [...document.querySelectorAll('style')].map((style) => style.textContent ?? '').join('\n')
    return css
      .split('\n')
      .filter((line) => line.includes(` ${selector} {`))
      .map((line) => line.slice(line.indexOf('{')))
  }

  it('gives the Get tables row the database icon type', () => {
    const [row] = complete('SELECT * FROM ')?.options ?? []

    expect(row.type).toBe(SQL_GET_TABLES_TYPE)
  })

  it('gives every Parameters row the : icon type', () => {
    const rows = complete('SELECT :', { parameterNames: PARAMETER_NAMES })?.options ?? []

    expect(rows.map((row) => row.type)).toEqual(PARAMETER_NAMES.map(() => SQL_PARAMETER_TYPE))
  })

  it('renders the Get tables row with the database icon', async () => {
    expect(await iconClassesAt('SELECT * FROM ')).toEqual([
      `cm-completionIcon cm-completionIcon-${SQL_GET_TABLES_TYPE}`,
    ])
  })

  it('renders each Parameters row with the : icon', async () => {
    expect(await iconClassesAt('SELECT :', { parameterNames: ['customer', 'limit'] })).toEqual([
      `cm-completionIcon cm-completionIcon-${SQL_PARAMETER_TYPE}`,
      `cm-completionIcon cm-completionIcon-${SQL_PARAMETER_TYPE}`,
    ])
  })

  it('draws a : in the Parameters icon slot', () => {
    mount('SELECT 1')

    expect(mountedRules(`.cm-completionIcon-${SQL_PARAMETER_TYPE}::after`)).toContainEqual(
      expect.stringContaining('content: ":"'),
    )
  })

  it('draws the database icon in the Get tables icon slot, in the row color', () => {
    mount('SELECT 1')

    const [icon] = mountedRules(`.cm-completionIcon-${SQL_GET_TABLES_TYPE}::after`)
    expect(icon).toContain('background-color: currentColor')
    expect(icon).toMatch(/mask: url\("data:image\/svg\+xml,[^"]*ellipse[^"]*"\) center \/ contain no-repeat/)
  })
})
