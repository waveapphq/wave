/**
 * V-NULL-SQL-FUNCTIONAL: SQL empty text against NULL on PostgreSQL and MariaDB
 * Wireframe: N/A
 * Design Decisions: SQL-2, SQL-6, SQL-9
 * REQ: REQ-3.4.1.6, REQ-3.1.3.22, REQ-3.1.3.23
 *
 * One workflow runs the same blocks on PostgreSQL and MariaDB inside a Try/Catch: a script that makes
 * a per-run table and procedure and inserts one row whose `:empty_note` is the literal empty text and
 * one whose `:null_note` is the expression `None`, then reads both back; two Call procedure blocks
 * whose argument `v` is `None` and empty text; a Log per database. The Finally path drops what the run
 * made and checks it is gone.
 *
 * Pass Criteria:
 * 1. The fixture imports through POST /tests with no repairs and validates with zero errors; each
 *    script gives `:empty_note` the literal empty text and `:null_note` the expression `None`.
 * 2. On both databases the script inserts both rows (`Statement 2` and `Statement 3`: 1 rows changed
 *    each) and Rows reads back `[1, '', IS NULL false]` and `[2, null, IS NULL true]`: empty text binds
 *    empty text and None binds NULL. Rows changed is 2.
 * 3. The script block's `Inputs:` line shows what WAVE bound, in the print form:
 *    `"parameters":{"empty_note":"","null_note":null}`.
 * 4. Call procedure with the argument given None binds NULL (Out values `is-null`); given empty text
 *    it binds empty text (Out values `is-empty`), on both databases (SQL-6).
 * 5. A downstream Log prints the read-back in the print form: `empty=[] null=[null]`, the IS NULL
 *    column `false/true` on PostgreSQL and `0/1` on MariaDB, and the call results.
 * 6. The Finally path drops the per-run table and procedure on both databases and finds them gone;
 *    nothing was caught, no console line carries the password, and the run passes.
 */

import fs from 'fs'
import path from 'path'
import { test, expect } from '../../helpers/playwright-fixtures'
import {
  BACKEND_URL,
  MARIADB_PORT,
  POSTGRES_PORT,
  SQL_STACK_PASSWORD,
  SQL_TARGET_HOST,
} from '../../helpers/config'
import {
  getActiveSessionId,
  getSessionVariables,
  importValidateAndNavigate,
  sessionTable,
  sessionValue,
  type SessionVariables,
} from '../../helpers/fixture-import'
import { validateTest } from '../../helpers/fn-seed'
import { expectNodeStatus, finishRun, startRun } from '../../helpers/k8s-run'
import {
  expectConsoleLine,
  formatEntries,
  getLogCopyTexts,
  setConsoleMinimumLevel,
  type LogEntry,
} from '../../helpers/log-reader'
import { withSqlStack } from '../../helpers/sql-stack'
import { blockSource, consoleEntriesFromCopy, newToken, withToken } from '../shell-blocks/shell-helpers'
import { deleteTest } from '../file-picker/picker'

interface FixtureNode {
  id: string
  data: {
    label: string
    elementType: string
    description: string
    expressionFields: string[]
    config: { values: Record<string, unknown>; outputBindings: Record<string, string> }
  }
}

interface Fixture extends Record<string, unknown> {
  workflow: { nodes: FixtureNode[] }
}

const FIXTURE_FILE = 'fixture-sql.json'
const BOOKEND = 'nv-sql-done'

const DATABASES = [
  {
    key: 'pg',
    label: 'PG',
    driver: 'PostgreSQL',
    port: POSTGRES_PORT,
    isNull: [false, true],
    isNullType: 'boolean',
  },
  {
    key: 'my',
    label: 'MariaDB',
    driver: 'MySQL',
    port: MARIADB_PORT,
    // MariaDB has no boolean type: IS NULL answers 0 / 1.
    isNull: [0, 1],
    isNullType: 'integer',
  },
] as const

const createdTests: string[] = []

function loadFixture(token: string): Fixture {
  const raw = JSON.parse(fs.readFileSync(path.resolve(__dirname, FIXTURE_FILE), 'utf-8')) as Fixture
  return withSqlStack(withToken(raw, token))
}

function nodeOf(fixture: Fixture, description: string): FixtureNode {
  const found = fixture.workflow.nodes.filter((node) => node.data.description === description)
  expect(found, `the fixture must declare one block described "${description}"`).toHaveLength(1)
  return found[0]
}

/** A block's console lines at INFO and above, timings and the server version blanked, sorted. */
function blockLines(entries: readonly LogEntry[], name: string): string[] {
  const source = blockSource('SQL', name)
  return entries
    .filter((entry) => entry.source === source && entry.level !== 'DEBUG')
    .map((entry) =>
      `${entry.level} ${entry.message}`
        .replace(/, \d+ ms$/, ', {ms} ms')
        .replace(/^INFO Connected to (PostgreSQL|MySQL) \S+ at /, 'INFO Connected to $1 {version} at '),
    )
    .sort()
}

function expectBlockLines(entries: readonly LogEntry[], name: string, expected: string[]): void {
  expect(blockLines(entries, name), `the console lines of "${name}".\n${formatEntries(entries)}`).toEqual(
    [...expected].sort(),
  )
}

/** The DEBUG `Inputs:` lines one block wrote. */
function inputsLines(entries: readonly LogEntry[], name: string): string[] {
  const source = blockSource('SQL', name)
  return entries
    .filter(
      (entry) => entry.source === source && entry.level === 'DEBUG' && entry.message.startsWith('Inputs: '),
    )
    .map((entry) => entry.message)
}

test.describe('V-NULL-SQL-FUNCTIONAL: empty text and NULL on PostgreSQL and MariaDB', () => {
  test.afterAll(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    for (const testId of createdTests.splice(0)) await deleteTest(request, testId)
  })

  test('empty text inserts empty text, None inserts NULL, rows read back empty and null, a null argument binds NULL', async ({
    page,
  }) => {
    test.setTimeout(240_000)
    const token = newToken()
    const fixture = loadFixture(token)

    await test.step('each script binds :empty_note to empty text and :null_note to None', () => {
      for (const db of DATABASES) {
        const script = nodeOf(fixture, `${db.label} script`)
        expect(script.data.config.values.parameters, `${db.label}: the two parameters`).toEqual({
          empty_note: '',
          null_note: 'None',
        })
        expect(script.data.expressionFields, `${db.label}: only :null_note is an expression`).toEqual([
          'parameters.null_note',
        ])
        expect(
          nodeOf(fixture, `${db.label} call with null`).data.expressionFields,
          `${db.label}: the argument v is the expression None`,
        ).toEqual(['arguments.v'])
        expect(nodeOf(fixture, `${db.label} call with empty text`).data.config.values.arguments).toEqual({
          v: '',
        })
      }
    })

    const testId = await importValidateAndNavigate(page, fixture, { rejectRepairs: true })
    createdTests.push(testId)
    const validation = await validateTest(page.request, testId, 'run')
    expect(validation.status, `validate answered ${validation.status}`).toBe(200)
    expect(validation.errors, `the fixture must validate clean. Got: ${JSON.stringify(validation.errors)}`).toHaveLength(0)

    await setConsoleMinimumLevel(page, 'DEBUG')
    const status = await startRun(page)
    await finishRun(page, status, BOOKEND, 180_000)

    const variables = (await getSessionVariables(page, await getActiveSessionId(page))) as SessionVariables
    const entries = consoleEntriesFromCopy(await getLogCopyTexts(page))

    await test.step('every block passes', async () => {
      for (const node of fixture.workflow.nodes) {
        if (node.data.elementType !== 'try-catch-finally') {
          await expectNodeStatus(page, node.id, 'success')
        }
      }
    })

    for (const db of DATABASES) {
      const connected = `INFO Connected to ${db.driver} {version} at ${SQL_TARGET_HOST}:${db.port}`

      await test.step(`${db.label}: empty text inserts empty text and None inserts NULL (SQL-2, SQL-9)`, () => {
        expectBlockLines(entries, `${db.label} script`, [
          connected,
          'INFO Statement 1: 0 rows changed, {ms} ms',
          'INFO Statement 2: 1 rows changed, {ms} ms',
          'INFO Statement 3: 1 rows changed, {ms} ms',
          'INFO Statement 4: 0 rows changed, {ms} ms',
          'INFO Statement 5: 2 rows, {ms} ms',
        ])
        expect(sessionValue(variables, `${db.key}_ok`), `${db.label}: Success`).toBe(true)
        expect(sessionValue(variables, `${db.key}_changed`), `${db.label}: both inserts landed`).toBe(2)
        expect(
          sessionTable(variables, `${db.key}_rows`),
          `${db.label}: row 1 holds empty text (IS NULL false), row 2 holds NULL read back as null`,
        ).toEqual({
          columns: [
            { name: 'id', type: 'integer' },
            { name: 'note', type: 'string' },
            { name: 'note_is_null', type: db.isNullType },
          ],
          rows: [
            [1, '', db.isNull[0]],
            [2, null, db.isNull[1]],
          ],
        })
      })

      await test.step(`${db.label}: the Inputs line shows empty text and null as bound (REQ-3.1.3.23)`, () => {
        const lines = inputsLines(entries, `${db.label} script`)
        expect(lines, `${db.label}: one Inputs line.\n${formatEntries(entries)}`).toHaveLength(1)
        expect(lines[0]).toContain('"parameters":{"empty_note":"","null_note":null}')
      })

      await test.step(`${db.label}: a procedure argument given None binds NULL, empty text binds empty text (REQ-3.4.1.6)`, () => {
        const procedure = `nv_${db.key}_kind_${token}`
        for (const [suffix, variable, kind] of [
          ['call with null', `${db.key}_kind_null`, 'is-null'],
          ['call with empty text', `${db.key}_kind_empty`, 'is-empty'],
        ] as const) {
          expect(sessionTable(variables, variable), `${db.label} ${suffix}: Out values`).toEqual({
            columns: [{ name: 'kind', type: 'string' }],
            rows: [[kind]],
          })
          expectBlockLines(entries, `${db.label} ${suffix}`, [
            connected,
            `INFO Called ${procedure}: 0 rows, 1 out values, {ms} ms`,
          ])
        }
      })
    }

    await test.step('a downstream Log prints the read-back in the print form (REQ-3.1.3.23)', () => {
      expectConsoleLine(
        entries,
        'INFO',
        'nv-sql-pg ok=true changed=2 empty=[] null=[null] is_null=false/true call=is-null/is-empty',
      )
      expectConsoleLine(
        entries,
        'INFO',
        'nv-sql-my ok=true changed=2 empty=[] null=[null] is_null=0/1 call=is-null/is-empty',
      )
    })

    await test.step('the Finally path drops the table and procedure on both databases; nothing leaks', () => {
      for (const db of DATABASES) {
        expect(sessionValue(variables, `${db.key}_drop_ok`), `${db.label}: the drop succeeded`).toBe(true)
        expect(sessionTable(variables, `${db.key}_gone`), `${db.label}: table and procedure are gone`).toEqual({
          columns: [{ name: 'n', type: 'integer' }],
          rows: [[0]],
        })
      }
      expectConsoleLine(entries, 'INFO', 'nv-sql-cleanup pg=true/0 my=true/0')
      expect(sessionValue(variables, 'nv_sql_caught'), 'no block in the Try path failed').toBe(false)
      expectConsoleLine(entries, 'INFO', `${BOOKEND} caught=false`)
      const leaked = entries.filter((entry) => entry.message.includes(SQL_STACK_PASSWORD))
      expect(leaked, 'no console line carries the password').toEqual([])
    })
  })
})
