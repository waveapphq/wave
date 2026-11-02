/**
 * V-FIELD-ENTRY-NULLS-FUNCTIONAL: a blank {x} entry blocks Save; each Block decides a null entry
 * Wireframe: none (functional)
 * Design Decisions: FIELD-13
 * REQ: REQ-3.1.3.21, REQ-3.1.3.20, REQ-3.1.1.5
 *
 * Real stack: `http-echo`, `postgres`, `kwok` (direct, per-run namespace from
 * `seedRun(..., 'minimal')`). One fixture: an HTTP Request whose `X-Id` header the window switches
 * to an empty expression, a SQL run on PostgreSQL whose `parameters` hold a literal null, a None
 * expression and empty text, and a K8s Apply (ConfigMap form) whose `data` entry `k` is null,
 * inside a Try/Catch so the one run passes.
 *
 * Pass Criteria:
 * 1. The fixture imports through POST /tests and validates with zero errors; the stored Test keeps
 *    the literal null `parameters` and `data` entries as null.
 * 2. In the HTTP Request window, switching the `X-Id` header entry to an expression and leaving it
 *    blank shows `'X-Id' in 'headers' is required` under Headers and keeps Save off.
 * 3. A Test save holding that blank expression entry is refused `REQUIRED_PARAM_EMPTY`
 *    `'X-Id' in 'headers' is required` naming the HTTP Request Block, and stores nothing.
 * 4. The run passes. On PostgreSQL the literal null and the None parameter bind NULL
 *    (`IS NULL` true) and empty text binds empty text (`IS NULL` false, value ``).
 * 5. K8s Apply refuses its null data entry with exactly `'k' in 'data' is null`: the Try/Catch
 *    binds that message for the Apply Block, the catch path runs, the Block is failed and no
 *    ConfigMap was created.
 */

import { test, expect, type APIRequestContext, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, K8S_ADMIN_TOKEN, K8S_API_HOST, K8S_API_PORT, K8S_CA_PEM } from '../../helpers/config'
import { exprToggle, paramRow, rowError, saveButton } from '../../helpers/config-sheet'
import { deleteTest, getTest, readFixture, saveAndCloseSheet, substitute, valueSheet } from '../../helpers/element-types'
import {
  getActiveSessionId,
  getSessionVariables,
  importValidateAndNavigate,
  sessionTable,
  sessionValue,
} from '../../helpers/fixture-import'
import { expectNodeStatus, finishRun, startRun } from '../../helpers/k8s-run'
import { seedRun, type SeededRun } from '../../helpers/k8s-seed'
import { expectConsoleLine, getLogCopyTexts } from '../../helpers/log-reader'
import { withSqlStack } from '../../helpers/sql-stack'
import { openBlockSheet } from '../../helpers/workbench'
import { consoleEntriesFromCopy } from '../shell-blocks/shell-helpers'
import { findingRows, refusedBlockSave, type StoredNode } from './null-entry-helpers'

const FIXTURE = 'fixture-entry-nulls.json'
const DONE_MARKER = 'entry-nulls-done'
const CAUGHT_MARKER = 'apply-null-caught'
const BLANK_ENTRY = "'X-Id' in 'headers' is required"
const DATA_NULL = "'k' in 'data' is null"
const CONFIG_MAP = 'zz-11541-s3-null-data'

const IDS = {
  http: '9d762599-c92a-49b2-b349-2fe6a927c03f',
  sql: 'c06bf978-05db-4dd7-985d-25bb7d568f67',
  connect: '3c3f70e6-8b5e-4514-aa57-304430f4065b',
  guard: 'a22fc18c-e4d9-4a82-a029-b425589d280f',
  apply: '5395b4bc-4840-43b0-b679-944d452445a6',
  caught: '15d965c9-864e-4021-82de-4a93bb5e1ae8',
  bookend: '91ce0243-8012-4e00-ae98-2b871d53932a',
} as const

type CaughtError = { message?: string; node_id?: string }

let run: SeededRun

function loadFixture(): Record<string, any> {
  const fixture = withSqlStack(substitute(readFixture(__dirname, FIXTURE), { __NAMESPACE__: run.namespace }))
  fixture.variables.k8s_ca.value = K8S_CA_PEM
  fixture.variables.k8s_admin_token.value = K8S_ADMIN_TOKEN
  return fixture
}

/** Switch map entry `index` of the open editor to an expression and leave it blank. */
async function switchEntryToBlankExpression(page: Page, index: number): Promise<void> {
  const sheet = valueSheet(page)
  await expect(sheet).toBeVisible()
  const toggle = sheet.locator(`[data-testid="map-expr-toggle-${index}"]`)
  await toggle.click()
  await expect(toggle).toHaveAttribute('data-state', 'on')
  await expect(sheet.locator(`[data-testid="map-expr-value-${index}"]`)).toBeVisible()
}

/** Cancel the Block window, discarding what it holds. */
async function discardWindow(page: Page, sheet: Locator): Promise<void> {
  await sheet.getByRole('button', { name: 'Cancel', exact: true }).click()
  const unsaved = page.getByRole('dialog', { name: 'Unsaved changes' })
  await expect(unsaved).toBeVisible()
  await unsaved.getByTestId('unsaved-close').click()
  await expect(sheet).toBeHidden()
}

async function configMapStatus(request: APIRequestContext): Promise<number> {
  const path = `/api/v1/namespaces/${run.namespace}/configmaps/${CONFIG_MAP}`
  const resp = await request.get(`https://${K8S_API_HOST}:${K8S_API_PORT}${path}`, {
    headers: { Authorization: `Bearer ${K8S_ADMIN_TOKEN}` },
  })
  return resp.status()
}

test.describe('V-FIELD-ENTRY-NULLS-FUNCTIONAL: blank and null entries', () => {
  let testId = ''

  test.beforeAll(async ({ request }) => {
    test.setTimeout(180_000)
    run = await seedRun(request, 'minimal')
  })

  test.afterAll(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    if (testId) await deleteTest(request, testId)
    await run?.teardown()
  })

  test('a blank expression entry blocks Save; SQL binds a null parameter, K8s Apply refuses null data', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000)
    testId = await importValidateAndNavigate(page, loadFixture(), { injectHttp: true })

    await test.step('the stored Test keeps the literal null entries', async () => {
      const nodes = (await getTest(request, testId)).workflow.nodes as StoredNode[]
      const values = (id: string) => nodes.find((node) => node.id === id)?.data.config.values ?? {}
      expect(values(IDS.sql).parameters).toEqual({ lit_null: null, expr_null: 'None', empty_text: '' })
      expect(values(IDS.apply).data).toEqual({ k: null, j: 'kept' })
    })

    await test.step("the window: a blank expression header entry shows the error and keeps Save off", async () => {
      const sheet = await openBlockSheet(page, IDS.http)
      await expect(exprToggle(sheet, 'headers')).toHaveAttribute('data-state', 'off')
      await paramRow(sheet, 'headers').getByRole('button', { name: 'Open editor for Headers', exact: true }).click()
      await switchEntryToBlankExpression(page, 0)
      await saveAndCloseSheet(page)
      await expect(rowError(sheet, 'headers')).toHaveText(new RegExp(`^${BLANK_ENTRY}$`))
      await expect(saveButton(sheet)).toBeDisabled()
      await discardWindow(page, sheet)
    })

    await test.step('a Test save holding the blank expression entry is refused naming the entry', async () => {
      const findings = await refusedBlockSave(request, testId, IDS.http, (data) => {
        data.expressionFields = ['headers.X-Id']
        data.config.values.headers = { 'X-Id': '' }
      })
      expect(findingRows(findings)).toEqual([['REQUIRED_PARAM_EMPTY', BLANK_ENTRY, IDS.http]])
    })

    const status = await startRun(page)
    const logs = await finishRun(page, status, DONE_MARKER)
    const all = logs.join('\n')
    const entries = consoleEntriesFromCopy(await getLogCopyTexts(page))
    const vars = await getSessionVariables(page, await getActiveSessionId(page))

    await test.step('PostgreSQL: a literal null and a None parameter bind NULL, empty text binds empty text', async () => {
      await expectNodeStatus(page, IDS.sql, 'success')
      const rows = sessionTable(vars, 'pg_rows')
      expect(rows.columns.map((column) => column.name)).toEqual([
        'lit_is_null',
        'expr_is_null',
        'empty_is_null',
        'empty_value',
      ])
      expect(rows.rows, `the bound parameters read back.\n${all}`).toEqual([[true, true, false, '']])
    })

    await test.step("K8s Apply: a null data entry fails with 'k' in 'data' is null", async () => {
      const error = sessionValue(vars, 'apply_err') as CaughtError
      expect(error.message, `the Try/Catch binds the exact refusal.\n${all}`).toBe(DATA_NULL)
      expect(error.node_id, 'the refused Block is the Apply').toBe(IDS.apply)
      expectConsoleLine(entries, 'WARN', `Try-path error caught: ${DATA_NULL}`)
      expect(logs.includes(CAUGHT_MARKER), `the catch path ran.\n${all}`).toBeTruthy()
      await expectNodeStatus(page, IDS.apply, 'failed')
      expect(await configMapStatus(request), 'the refused Apply created no ConfigMap').toBe(404)
    })

    await test.step('every other Block succeeded', async () => {
      for (const id of [IDS.http, IDS.connect, IDS.guard, IDS.caught, IDS.bookend]) {
        await expectNodeStatus(page, id, 'success')
      }
      expect(sessionValue(vars, 'id_status')).toBe(200)
    })
  })
})
