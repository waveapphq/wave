/**
 * V-EXEC-HISTORY-RUN-VARS: a finished run's page shows how the run used its variables and the
 * table the run produced
 * REQ: REQ-5.2.1.40 (Execution history screen) / REQ-3.1.3.11 (Variable watching UI panel) /
 *      REQ-3.1.3.6 (Return values from plugins) / REQ-3.5.5.1 (Data table support) /
 *      REQ-3.1.3.5 (Secret variable masking)
 * Design: VMGR-105 (Unused only when no Block reads or writes the name), FN-VMGR-3 (OUT marks a
 *         variable bound to a Block output); the Historical Test Canvas Variable Manager is the same
 *         list as the live panel, and its snapshot holds full values, a table in the column-schema
 *         shape (named, typed columns plus row arrays).
 *
 * Phase: functional-workflow. API seed (POST /tests), no fixture file: a CSV Parser whose content
 * expression reads `region_label` and the secret `api_token` and whose table output is bound to
 * `parsed_rows`, then a Log of `log_note`; `spare_count` is read by nothing. Validated with zero
 * errors and run once as a tracked execution (POST /executions).
 *
 * Pass Criteria:
 * 1. On the run's page (`/executions/<run id>`), the variables a Block reads carry no Unused mark;
 *    the one variable nothing reads still does.
 * 2. The variable bound to the CSV table output shows OUT; a variable that is only read does not.
 * 3. The table variable shows the run's table size (`2×3 table`), not its empty start value.
 * 4. Opened, the table variable shows the run's columns and rows, the secret cell masked.
 * 5. The stored run variables (`GET /executions/<id>/variables`) and the run page payload
 *    (`GET /executions/history/<id>`) hold the table as columns and rows with the secret cell
 *    masked, and no plaintext secret anywhere.
 * 6. Once the source Test is deleted, the run page still reads the table variable as a table of
 *    the run's size.
 */

import { randomUUID } from 'node:crypto'
import { test, expect, type APIRequestContext, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { chainEdges, cleanUp, configOf, createTest, csvBlock, logBlock, storedBlock } from '../../helpers/fn-block'
import { validateTest } from '../../helpers/fn-seed'
import { runTrackedTest } from '../../helpers/k8s-run'
import { expectNoSecret, SECRET_MASK } from '../../helpers/secret-canary'
import { expandVariableManager, variableRow } from '../../helpers/variable-create'

const SECRET = 'SEKRET-run-vars-7c2e9d41ab'
const SECRET_FAMILY = 'SEKRET-'
const LABEL = 'eu-west-prod'

const CSV_ID = 'run-vars-csv'
const LOG_ID = 'run-vars-log'
/** Two rows: the first carries the label and the secret, composed at run time. */
const CSV_EXPRESSION =
  "'lbl,tok,prt\\n' + region_label + ',' + api_token + ',8080\\nsecond-row,plain-cell,9090'"

/** The names a Block reads: the CSV content expression and the Log message. */
const READ_NAMES = ['region_label', 'api_token', 'log_note']
const BOUND_NAME = 'parsed_rows'
const UNREAD_NAME = 'spare_count'

/** The run's table in the column-schema shape, the secret cell masked. */
const STORED_TABLE = {
  columns: [
    { name: 'lbl', type: 'string' },
    { name: 'tok', type: 'string' },
    { name: 'prt', type: 'integer' },
  ],
  rows: [
    [LABEL, SECRET_MASK, 8080],
    ['second-row', 'plain-cell', 9090],
  ],
}

let testIds: string[] = []
let executionIds: string[] = []

async function seedAndRun(request: APIRequestContext): Promise<{ testId: string; executionId: string }> {
  await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
  const testId = await createTest(request, {
    name: `zz-run-vars-${randomUUID().slice(0, 8)}`,
    nodes: [
      csvBlock(CSV_ID, 'Parse rows', {
        values: { csv_content: CSV_EXPRESSION },
        expressionFields: ['csv_content'],
        outputBindings: { table: BOUND_NAME },
        position: { x: 200, y: 160 },
      }),
      logBlock(LOG_ID, 'Log note', 'log_note', { position: { x: 200, y: 300 } }),
    ],
    edges: chainEdges([CSV_ID, LOG_ID]),
    variables: {
      region_label: { type: 'string', value: LABEL, scope: 'test' },
      api_token: { type: 'string', value: SECRET, secret: true, scope: 'test' },
      [BOUND_NAME]: { type: 'table', value: [], scope: 'test' },
      log_note: { type: 'string', value: 'rows parsed', scope: 'test' },
      [UNREAD_NAME]: { type: 'integer', value: 5, scope: 'test' },
    },
  })
  testIds.push(testId)

  // The read is a plain expression the panel can see, not a value sealed away from it.
  const csv = await storedBlock(request, testId, CSV_ID)
  expect((configOf(csv).values as Record<string, unknown>).csv_content, 'the CSV content is stored as sent').toBe(
    CSV_EXPRESSION,
  )

  const validation = await validateTest(request, testId, 'run')
  expect(validation.errors, JSON.stringify(validation.errors)).toHaveLength(0)

  const run = await runTrackedTest(request, testId)
  executionIds.push(run.executionId)
  expect(run.verdict, `tracked run ${run.executionId} passed`).toBe('passed')
  return { testId, executionId: run.executionId }
}

/** Open a finished run by its run page link; a Test run lands on its history canvas. */
async function openRunPage(page: Page, executionId: string): Promise<void> {
  await page.goto(`/executions/${executionId}`)
  await expect(page).toHaveURL(new RegExp(`/executions/history/${executionId}$`))
  const workbenchPage = page.getByTestId('workbench-page')
  await expect(workbenchPage, 'the run page did not boot').toBeVisible({ timeout: 20_000 })
  await expect(workbenchPage).toHaveAttribute('data-mode', 'history')
  await waitForCanvasLoad(page)
  await expandVariableManager(page)
}

function badge(page: Page, kind: 'unused' | 'out' | 'type' | 'value', name: string): Locator {
  const id = kind === 'value' ? `variable-value-${name}` : `${kind}-badge-${name}`
  return variableRow(page, name).getByTestId(id)
}

async function readJson(request: APIRequestContext, path: string): Promise<Record<string, unknown>> {
  const resp = await request.get(`${BACKEND_URL}${path}`)
  expect(resp.ok(), `GET ${path} failed: ${resp.status()}`).toBeTruthy()
  const body = (await resp.json()) as Record<string, unknown>
  return (body.data ?? body) as Record<string, unknown>
}

test.describe("V-EXEC-HISTORY-RUN-VARS: a finished run's page shows variable use and the run's table", () => {
  test.afterEach(async ({ request }) => {
    for (const id of executionIds.splice(0)) {
      await request.delete(`${BACKEND_URL}/executions/${id}`).catch(() => undefined)
    }
    await cleanUp(request, testIds)
    testIds = []
  })

  test("the run page marks only the unread variable Unused, shows OUT, and opens the run's table", async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)
    const { executionId } = await seedAndRun(request)
    await openRunPage(page, executionId)

    await test.step('a variable a Block reads carries no Unused mark', async () => {
      for (const name of READ_NAMES) {
        await expect(variableRow(page, name), `${name} is listed`).toHaveCount(1)
        await expect(
          badge(page, 'unused', name),
          `${name} is read by a Block of the run, so it is not Unused`,
        ).toHaveCount(0)
      }
    })

    await test.step('the variable nothing reads or writes is still Unused', async () => {
      await expect(badge(page, 'unused', UNREAD_NAME)).toHaveText('Unused')
    })

    await test.step('the variable bound to the CSV table output shows OUT', async () => {
      await expect(badge(page, 'out', BOUND_NAME), `${BOUND_NAME} is bound to the CSV table output`).toHaveText(
        'OUT',
      )
      await expect(badge(page, 'unused', BOUND_NAME), 'an output binding is a use').toHaveCount(0)
      await expect(badge(page, 'out', 'region_label'), 'a variable that is only read has no OUT').toHaveCount(0)
    })

    await test.step("the table variable shows the run's table size, not its empty start value", async () => {
      await expect(badge(page, 'type', BOUND_NAME)).toHaveText('table')
      await expect(
        badge(page, 'value', BOUND_NAME),
        'the run parsed 2 rows of 3 columns; 0×0 is the empty start value',
      ).toHaveText('2×3 table')
    })

    await test.step("opened, the table variable shows the run's rows with the secret cell masked", async () => {
      const row = variableRow(page, BOUND_NAME)
      await row.hover()
      await row.getByTestId(`expand-button-${BOUND_NAME}`).click()
      const watcher = page.getByRole('dialog', { name: BOUND_NAME, exact: true, includeHidden: true })
      await expect(watcher).toBeVisible()

      await expect(watcher.getByTestId('inspect-metric')).toHaveText('2 rows × 3 cols')
      const grid = watcher.getByTestId('table-body')
      await expect(grid.locator('thead th')).toHaveText(['#', 'lbl', 'tok', 'prt'])
      const rows = grid.locator('tbody tr')
      await expect(rows).toHaveCount(2)
      await expect(rows.nth(0).locator('td')).toHaveText(['0', `"${LABEL}"`, `"${SECRET_MASK}"`, '8080'])
      await expect(rows.nth(1).locator('td')).toHaveText(['1', '"second-row"', '"plain-cell"', '9090'])
    })

    await test.step('the run page shows the secret nowhere', async () => {
      expectNoSecret(await page.content(), 'the run page', [SECRET], SECRET_FAMILY)
    })
  })

  test('the stored run keeps the table as columns and rows with the secret cell masked', async ({ request }) => {
    test.setTimeout(180_000)
    const { executionId } = await seedAndRun(request)

    await test.step('the stored run variables', async () => {
      const variables = await readJson(request, `/executions/${executionId}/variables`)
      expect(
        variables[BOUND_NAME],
        `the stored run keeps the table as columns and rows. Got: ${JSON.stringify(variables[BOUND_NAME]).slice(0, 200)}`,
      ).toEqual(STORED_TABLE)
      expect(variables.api_token, 'the secret variable is stored masked').toBe(SECRET_MASK)
      expectNoSecret(JSON.stringify(variables), 'the stored run variables', [SECRET], SECRET_FAMILY)
    })

    await test.step('the run page payload', async () => {
      const history = await readJson(request, `/executions/history/${executionId}`)
      const variables = (history.variables ?? {}) as Record<string, unknown>
      expect(
        variables[BOUND_NAME],
        `the run page payload carries the table as columns and rows. Got: ${JSON.stringify(variables[BOUND_NAME]).slice(0, 200)}`,
      ).toEqual(STORED_TABLE)
      expectNoSecret(JSON.stringify(history), 'the run page payload', [SECRET], SECRET_FAMILY)
    })
  })

  test('with the source Test deleted, the run page still reads the table variable as a table', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)
    const { testId, executionId } = await seedAndRun(request)
    const deleted = await request.delete(`${BACKEND_URL}/tests/${testId}`)
    expect(deleted.ok(), `DELETE /tests/${testId} failed: ${deleted.status()}`).toBeTruthy()
    testIds = testIds.filter((id) => id !== testId)

    await openRunPage(page, executionId)
    await expect(variableRow(page, BOUND_NAME), `${BOUND_NAME} is listed from the run snapshot`).toHaveCount(1)
    await expect(badge(page, 'type', BOUND_NAME), "the run's table is read as a table").toHaveText('table')
    await expect(badge(page, 'value', BOUND_NAME)).toHaveText('2×3 table')
  })
})
