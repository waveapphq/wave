/**
 * V-PLUGIN-SQL-PROCEDURE-FUNCTIONAL: Call procedure against the real databases
 * Design Decisions: SQL-1, SQL-4, SQL-5, SQL-6, SQL-9
 * REQ: REQ-3.4.1.6
 *
 * One workflow calls, on PostgreSQL, MariaDB, Oracle and SQL Server, the stack's seed procedure
 * (in a and b, out total and label), then a procedure the run makes with an in-out argument
 * whose input is the seed call's Out value, then a routine that returns rows. The routines the
 * run makes carry a per-run token and the Finally path drops them. A second test proves SQLite
 * is refused.
 *
 * Pass Criteria:
 * 1. The fixture imports through POST /tests, validates with zero errors and the run passes.
 * 2. The seed call on each database fills Out values with ONE row and a column per out argument
 *    in the Out arguments order, typed by the database: total integer 5, label text `sum`; Rows
 *    stays empty and Row count 0. Its console lines are the Connected line, then
 *    `Called {seed procedure}: 0 rows, 2 out values, {ms} ms`.
 * 3. The in-out call takes Arguments in the list's order - on MariaDB the call is positional and
 *    the list is not alphabetical, so any reordering would bind the in-out slot to a value - and
 *    its acc input is an expression over the seed call's Out values, so Out values reads 107
 *    (100 + 10 - 3) on every database. Oracle and SQL Server take the schema-qualified name.
 * 4. A routine that returns rows fills Rows and Row count - a PostgreSQL function returning a
 *    table, an Oracle procedure handing back an implicit result, a MariaDB and a SQL Server
 *    procedure ending in a SELECT - and leaves Out values empty.
 * 5. Every Out value reaches a downstream Log, and the Finally path leaves no routine behind.
 * 6. SQLite: the config sheet does not offer Call procedure - a stored one shows
 *    `Operation 'Call procedure' is not available on SQLite` under the Operation row and Save is
 *    disabled - and the Block refuses it with the same message when the run reaches it, before
 *    it opens the file.
 * 7. A PostgreSQL function with OUT parameters, called with those names under Out arguments,
 *    fills Out values like a procedure does: one typed row with a column per out argument, and
 *    Rows empty.
 * 8. Every finished call writes one INFO line after its Connected line,
 *    `Called {procedure}: {rows} rows, {n} out values, {ms} ms`: the procedure as typed in the
 *    Procedure row (`wave.` and `dbo.` included), the rows kept, the number of Out arguments. A
 *    result cut by Max rows 2 says `Called ...: 2 rows, ...` and then `Stopped after 2 rows (Max
 *    rows)` at WARN, and keeps the first two rows.
 * 9. A PostgreSQL call of the seed procedure with no Arguments, under Record and continue, records
 *    Reason DatabaseError and exactly `42883: procedure {seed procedure}() does not exist` - the
 *    database's code and text with no second line - paints the warning state and writes no
 *    `Called` line.
 */

import fs from 'fs'
import path from 'path'
import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import {
  BACKEND_URL,
  MARIADB_PORT,
  MSSQL_PORT,
  ORACLE_PORT,
  POSTGRES_PORT,
  SQL_SEED_PROCEDURE,
  SQL_TARGET_HOST,
} from '../../helpers/config'
import {
  getActiveSessionId,
  getSessionVariables,
  importExpectingErrors,
  importValidateAndNavigate,
  sessionTable,
  sessionValue,
  type SessionVariables,
  type WaveTable,
} from '../../helpers/fixture-import'
import { validateTest } from '../../helpers/fn-seed'
import {
  openOptions,
  rowError,
  saveButton,
  settingsNote,
} from '../../helpers/config-sheet'
import { expectNodeStatus, finishRun, startRun } from '../../helpers/k8s-run'
import {
  escapeRegExp,
  formatEntries,
  getLogCopyTexts,
  type LogEntry,
} from '../../helpers/log-reader'
import { withSqlStack } from '../../helpers/sql-stack'
import { closeConfig, openConfig } from '../file-picker/picker'
import { blockSource, consoleEntriesFromCopy, newToken, withToken } from '../shell-blocks/shell-helpers'

interface FixtureNode {
  id: string
  data: { label: string; elementType: string; description: string }
}

interface Fixture extends Record<string, unknown> {
  workflow: { nodes: FixtureNode[] }
}


const SEED_PLACEHOLDER = '__SEED_PROCEDURE__'
const BOOKEND = 'sql-procedure-done'
const LABEL = 'SQL'
const NOT_ON_SQLITE = "Operation 'Call procedure' is not available on SQLite"
/** The generic note under a config sheet's Save (FIELDERR-1). */
const SETTINGS_NOTE = 'Save is disabled: the settings have errors'
const EMPTY_TABLE: WaveTable = { columns: [], rows: [] }
const CAPPED_CALL = 'PostgreSQL capped rows call'
const NO_ARGUMENTS_CALL = 'PostgreSQL no arguments call'

/** `schema` is what the fixture types before the name of a routine the run makes. */
const DATABASES = [
  { key: 'pg', label: 'PostgreSQL', driver: 'PostgreSQL', port: POSTGRES_PORT, schema: '' },
  { key: 'my', label: 'MariaDB', driver: 'MySQL', port: MARIADB_PORT, schema: '' },
  { key: 'or', label: 'Oracle', driver: 'Oracle', port: ORACLE_PORT, schema: 'wave.' },
  { key: 'ms', label: 'SQL Server', driver: 'SQL Server', port: MSSQL_PORT, schema: 'dbo.' },
] as const

type Line = string | RegExp

const createdTests: string[] = []

function loadFixture(file: string, token: string): Fixture {
  const text = fs
    .readFileSync(path.resolve(__dirname, file), 'utf-8')
    .split(SEED_PLACEHOLDER)
    .join(SQL_SEED_PROCEDURE)
  return withSqlStack(withToken(JSON.parse(text) as Fixture, token))
}


/** The INFO, WARN and ERROR lines of the SQL Block of that Name, in the order of the entries. */
function blockLines(entries: readonly LogEntry[], name: string): string[] {
  const source = blockSource(LABEL, name)
  return entries
    .filter((entry) => entry.source === source && entry.level !== 'DEBUG')
    .map((entry) => `${entry.level} ${entry.message}`)
}

/** The console's entries in console order: each row carries its position in the whole list. */
async function consoleEntriesInOrder(page: Page): Promise<LogEntry[]> {
  const container = page.locator('[role="log"]').first()
  await container.evaluate((element) => {
    element.scrollTop = 0
  })
  const texts = new Map<number, string>()
  let size = 0
  for (let pass = 0; pass < 400; pass++) {
    await page.waitForTimeout(30)
    const rows = await container.locator('[data-copy-text][aria-posinset]').evaluateAll((elements) =>
      elements.map((element) => ({
        position: Number(element.getAttribute('aria-posinset')),
        size: Number(element.getAttribute('aria-setsize')),
        text: element.getAttribute('data-copy-text') ?? '',
      })),
    )
    for (const row of rows) {
      texts.set(row.position, row.text)
      size = row.size
    }
    const moved = await container.evaluate((element) => {
      const before = element.scrollTop
      element.scrollTop = before + Math.max(1, Math.floor(element.clientHeight * 0.8))
      return element.scrollTop > before
    })
    if (!moved) break
  }
  expect(texts.size, 'the harvest read every console row').toBe(size)
  const ordered = [...texts.entries()].sort((a, b) => a[0] - b[0]).map(([, text]) => text)
  return consoleEntriesFromCopy(ordered)
}

function connectedTo(database: (typeof DATABASES)[number]): RegExp {
  return new RegExp(
    `^INFO Connected to ${database.driver} \\S+ at ${escapeRegExp(SQL_TARGET_HOST)}:${database.port}$`,
  )
}

/** The line a finished call writes: the procedure as typed, the rows kept, the Out arguments (SQL-6). */
function called(procedure: string, rows: number, outs: number): RegExp {
  return new RegExp(
    `^INFO Called ${escapeRegExp(procedure)}: ${rows} rows, ${outs} out values, \\d+ ms$`,
  )
}

/** The Block wrote exactly these lines, in this order. */
function expectLines(entries: readonly LogEntry[], name: string, expected: Line[]): void {
  const lines = blockLines(entries, name)
  const report = `the console lines of "${name}".\nGot:\n${lines.join('\n')}\n\nConsole:\n${formatEntries(entries)}`
  expect(lines, report).toHaveLength(expected.length)
  expected.forEach((line, index) => {
    if (typeof line === 'string') expect(lines[index], `line ${index + 1} of ${report}`).toBe(line)
    else expect(lines[index], `line ${index + 1} of ${report}`).toMatch(line)
  })
}

test.describe('V-PLUGIN-SQL-PROCEDURE-FUNCTIONAL: Call procedure on the real databases', () => {
  test.afterAll(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    for (const testId of createdTests.splice(0)) {
      await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
    }
  })

  test('the seed procedure, an in-out argument and rows on four databases', async ({ page }) => {
    test.setTimeout(240_000)

    const token = newToken()
    const fixture = loadFixture('fixture.json', token)
    const idOf = (name: string): string => {
      const found = fixture.workflow.nodes.filter((node) => node.data.label === name)
      expect(found, `the fixture must declare one block named "${name}"`).toHaveLength(1)
      return found[0].id
    }
    const idByDescription = (description: string): string => {
      const found = fixture.workflow.nodes.filter((node) => node.data.description === description)
      expect(found, `the fixture must declare one block described "${description}"`).toHaveLength(1)
      return found[0].id
    }

    const testId = await importValidateAndNavigate(page, fixture, { rejectRepairs: true })
    createdTests.push(testId)
    const validation = await validateTest(page.request, testId, 'run')
    expect(validation.status, `validate answered ${validation.status}`).toBe(200)
    expect(
      validation.errors,
      `the fixture must validate clean. Got: ${JSON.stringify(validation.errors)}`,
    ).toHaveLength(0)

    const status = await startRun(page)
    await finishRun(page, status, BOOKEND, 180_000)

    const variables = (await getSessionVariables(
      page,
      await getActiveSessionId(page),
    )) as SessionVariables
    const entries = await consoleEntriesInOrder(page)
    const messages = entries.map((entry) => entry.message)

    await test.step('every Block passes, and the recorded refusal paints the warning state', async () => {
      const recorded = idOf(NO_ARGUMENTS_CALL)
      for (const node of fixture.workflow.nodes) {
        if (node.data.elementType !== 'try-catch-finally') {
          await expectNodeStatus(page, node.id, node.id === recorded ? 'warning' : 'success')
        }
      }
    })

    await test.step('Out values is one typed row with a column per out argument (SQL-6, SQL-9)', () => {
      for (const database of DATABASES) {
        const prefix = `pr_${database.key}_seed`
        const what = `${database.label} seed call`
        expect(sessionValue(variables, `${prefix}_ok`), what).toBe(true)
        expect(sessionTable(variables, `${prefix}_out`), `${what}: Out values`).toEqual({
          columns: [
            { name: 'total', type: 'integer' },
            { name: 'label', type: 'string' },
          ],
          rows: [[5, 'sum']],
        })
        expect(sessionTable(variables, `${prefix}_rows`), `${what}: a procedure without rows`).toEqual(
          EMPTY_TABLE,
        )
        expect(sessionValue(variables, `${prefix}_count`), what).toBe(0)
        const lines = blockLines(entries, what)
        expect(lines, `${what}: the console lines.\n${formatEntries(entries)}`).toHaveLength(2)
        expect(lines[0]).toMatch(connectedTo(database))
        expect(lines[1], `${what}: the call's own line follows the Connected line`).toMatch(
          called(SQL_SEED_PROCEDURE, 0, 2),
        )
      }
    })

    await test.step('Arguments go in the list order and an in-out value reads a downstream Out value (SQL-6)', () => {
      for (const database of DATABASES) {
        const prefix = `pr_${database.key}_inout`
        const what = `${database.label} in-out call`
        expect(sessionValue(variables, `${prefix}_ok`), what).toBe(true)
        expect(sessionTable(variables, `${prefix}_out`), `${what}: acc = 5 * 20 + 10 - 3`).toEqual({
          columns: [{ name: 'acc', type: 'integer' }],
          rows: [[107]],
        })
        expect(sessionTable(variables, `${prefix}_rows`), what).toEqual(EMPTY_TABLE)
      }
    })

    await test.step('A routine that returns rows fills Rows and Row count (SQL-6, SQL-9)', () => {
      for (const database of DATABASES) {
        const prefix = `pr_${database.key}_rows`
        const what = `${database.label} rows call`
        expect(sessionValue(variables, `${prefix}_ok`), what).toBe(true)
        expect(sessionTable(variables, `${prefix}_rows`), `${what}: Rows`).toEqual({
          columns: [
            { name: 'k', type: 'integer' },
            { name: 'sq', type: 'integer' },
          ],
          rows: [
            [1, 1],
            [2, 4],
            [3, 9],
          ],
        })
        expect(sessionValue(variables, `${prefix}_count`), `${what}: Row count`).toBe(3)
        expect(sessionTable(variables, `${prefix}_out`), `${what}: no out arguments`).toEqual(EMPTY_TABLE)
      }
    })

    await test.step('A PostgreSQL function\'s OUT parameters fill Out values like a procedure\'s (SQL-6, SQL-9)', () => {
      const what = 'PostgreSQL function out call'
      expect(sessionValue(variables, 'pr_pg_fout_ok'), what).toBe(true)
      expect(sessionTable(variables, 'pr_pg_fout_out'), `${what}: Out values`).toEqual({
        columns: [
          { name: 'twice', type: 'integer' },
          { name: 'label', type: 'string' },
        ],
        rows: [[42, 'f21']],
      })
      expect(sessionTable(variables, 'pr_pg_fout_rows'), `${what}: Rows`).toEqual(EMPTY_TABLE)
      expect(sessionValue(variables, 'pr_pg_fout_count'), what).toBe(0)
    })

    await test.step('A finished call writes its own line after the Connected line (SQL-6)', () => {
      for (const database of DATABASES) {
        expectLines(entries, `${database.label} in-out call`, [
          connectedTo(database),
          called(`${database.schema}wave_diff_${token}`, 0, 1),
        ])
        expectLines(entries, `${database.label} rows call`, [
          connectedTo(database),
          called(`${database.schema}wave_rows_${token}`, 3, 0),
        ])
      }
      expectLines(entries, 'PostgreSQL function out call', [
        connectedTo(DATABASES[0]),
        called(`wave_fout_${token}`, 0, 2),
      ])
    })

    await test.step('A result cut by Max rows says so after the call line (SQL-4, SQL-6)', () => {
      expect(sessionValue(variables, 'pr_pg_cap_ok'), CAPPED_CALL).toBe(true)
      expect(sessionTable(variables, 'pr_pg_cap_rows'), `${CAPPED_CALL}: the first two rows`).toEqual({
        columns: [
          { name: 'k', type: 'integer' },
          { name: 'sq', type: 'integer' },
        ],
        rows: [
          [1, 1],
          [2, 4],
        ],
      })
      expect(sessionValue(variables, 'pr_pg_cap_count'), `${CAPPED_CALL}: Row count`).toBe(2)
      expect(sessionTable(variables, 'pr_pg_cap_out'), CAPPED_CALL).toEqual(EMPTY_TABLE)
      expectLines(entries, CAPPED_CALL, [
        connectedTo(DATABASES[0]),
        called(`wave_rows_${token}`, 2, 0),
        'WARN Stopped after 2 rows (Max rows)',
      ])
    })

    await test.step("A refused call records the database's code and text alone and writes no call line (SQL-5, SQL-6)", () => {
      const refusal = `42883: procedure ${SQL_SEED_PROCEDURE}() does not exist`
      expect(sessionValue(variables, 'pr_pg_bare_ok'), NO_ARGUMENTS_CALL).toBe(false)
      expect(sessionValue(variables, 'pr_pg_bare_reason'), NO_ARGUMENTS_CALL).toBe('DatabaseError')
      expect(
        sessionValue(variables, 'pr_pg_bare_error'),
        `${NO_ARGUMENTS_CALL}: the code and text, with no second line`,
      ).toBe(refusal)
      expect(sessionTable(variables, 'pr_pg_bare_out'), NO_ARGUMENTS_CALL).toEqual(EMPTY_TABLE)
      expectLines(entries, NO_ARGUMENTS_CALL, [
        connectedTo(DATABASES[0]),
        `WARN Call procedure failed (DatabaseError): ${refusal}`,
      ])
    })

    await test.step('every Out value reaches a downstream Log', () => {
      for (const line of [
        'pr-seed pg=5/sum my=5/sum or=5/sum ms=5/sum',
        'pr-inout pg=107 my=107 or=107 ms=107',
        'pr-rows pg=3/9 my=3/9 or=3/9 ms=3/9 fout=42/f21',
        'pr-more cap=2/4 bare=False/DatabaseError',
        BOOKEND,
      ]) {
        expect(messages, `the console must carry "${line}".\n${formatEntries(entries)}`).toContain(line)
      }
    })

    await test.step('the Finally path leaves no routine behind', async () => {
      for (const database of DATABASES) {
        const left = sessionTable(variables, `pr_${database.key}_left`)
        expect(left.rows, `${database.label}: no routine is left`).toEqual([[0]])
        await expectNodeStatus(page, idByDescription(`${database.label} cleanup`), 'success')
      }
    })
  })

  test('SQLite has no procedures: the sheet and the Block refuse Call procedure', async ({ page }) => {
    test.setTimeout(120_000)
    const fixture = loadFixture('fixture-sqlite.json', newToken())
    const idOf = (name: string): string => {
      const found = fixture.workflow.nodes.find((node) => node.data.label === name)
      expect(found, `the fixture declares a block named "${name}"`).toBeTruthy()
      return found!.id
    }

    const imported = await importExpectingErrors(page, fixture, { context: 'run' })
    createdTests.push(imported.testId)

    await test.step('the config sheet does not offer Call procedure on SQLite (SQL-6, FIELDERR-1)', async () => {
      const sheet = await openConfig(page, idOf('SQLite call'))
      await expect(rowError(sheet, 'operation')).toHaveText(NOT_ON_SQLITE)
      await expect(settingsNote(sheet)).toHaveText(SETTINGS_NOTE)
      await expect(saveButton(sheet)).toBeDisabled()
      const listbox = await openOptions(page, sheet, 'operation')
      await expect(listbox.getByRole('option'), 'SQLite offers only these').toHaveText([
        'Run SQL',
        'Load table',
      ])
      await page.keyboard.press('Escape')
      await expect(listbox).toHaveCount(0)
      await closeConfig(sheet)
    })

    const status = await startRun(page)
    await finishRun(page, status, 'sql-procedure-sqlite-done')
    const entries = consoleEntriesFromCopy(await getLogCopyTexts(page))

    await test.step('the Block refuses the operation before it opens the file (SQL-6)', async () => {
      await expectNodeStatus(page, idOf('SQLite call'), 'failed')
      const variables = (await getSessionVariables(
        page,
        await getActiveSessionId(page),
      )) as SessionVariables
      expect(sessionValue(variables, 'pr_lite_caught'), 'the Try/Catch caught the refusal').toBe(true)
      const error = sessionValue(variables, 'pr_lite_error') as Record<string, unknown>
      expect(error.message).toBe(NOT_ON_SQLITE)
      expect(error.node_id, 'the error points at the SQLite Block').toBe(idOf('SQLite call'))
      expect(
        entries.some(
          (entry) => entry.level === 'ERROR' && entry.message === `Block 'SQLite call' failed: ${NOT_ON_SQLITE}`,
        ),
        `the ERROR line names the Block and the refusal.\n${formatEntries(entries)}`,
      ).toBe(true)
      expect(
        entries.map((entry) => entry.message),
        'the catch path read the refusal',
      ).toContain(`pr-lite-caught ${NOT_ON_SQLITE}`)
      expect(blockLines(entries, 'SQLite call'), 'nothing was opened: no Connected line').toEqual([])
      expect(sessionTable(variables, 'pr_lite_out'), 'Out values stays empty').toEqual(EMPTY_TABLE)
    })
  })
})
