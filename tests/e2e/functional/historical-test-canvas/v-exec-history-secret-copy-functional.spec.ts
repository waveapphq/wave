/**
 * V-EXEC-HISTORY-SECRET-COPY: a finished run keeps an unflagged copy of a secret table, map or list
 * masked whole, in the stored run and on the run page
 * REQ: REQ-3.1.3.5 (Secret variable masking) / REQ-3.1.3.23 (WAVE's print form, which a secret
 *      container registers whole) / REQ-5.2.1.40 (Execution history screen) /
 *      REQ-3.1.3.11 (Variable watching UI panel)
 * Design: copying a secret does not make the copy secret, but a byte-identical copy is still masked by
 *         value; a secret list, map or table registers the forms of the whole container, and in a
 *         variable-shaped payload (variable displays, execution snapshots) an unflagged entry whose
 *         value matches a registered secret collapses to the bare placeholder: no keys, no columns,
 *         no cells, no counts.
 *
 * Phase: functional-workflow. API seed (POST /tests), no fixture file: a secret table, a secret map and
 * a secret list whose cells are shorter than the 6 character scan floor, and one Variable Setter whose
 * Expression rows copy each into an unflagged variable of the same type; the same Setter copies a plain
 * table into a plain variable. Validated with zero errors and run once as a tracked execution
 * (POST /executions).
 *
 * Pass Criteria:
 * 1. The stored run variables (`GET /executions/<id>/variables`) hold each secret source and each copy
 *    as exactly `********`, and the plain copy as its columns and rows.
 * 2. The run page payload (`GET /executions/history/<id>`) holds the same values, and no column name,
 *    map key or cell of the secrets appears anywhere in it.
 * 3. On the run page the Variable Manager shows each copy as `********`, like the secret it copies,
 *    and the plain copy as `1×2 table`; no column name, map key or cell of the secrets is on the page.
 */

import { test, expect, type APIRequestContext, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import { cleanUp } from '../../helpers/fn-block'
import { openRunHistory, runTrackedTest } from '../../helpers/k8s-run'
import { expectNoSecret, SECRET_MASK } from '../../helpers/secret-canary'
import { expandVariableManager, variableRow } from '../../helpers/variable-create'
import { COPIES, createSecretCopyTest, PLAIN_COPY, SECRET_TEXTS } from './secret-copy'

/** The plain copy in the column-schema shape a stored run keeps a table in. */
const PLAIN_TABLE = {
  columns: [
    { name: 'region', type: 'string' },
    { name: 'tier', type: 'string' },
  ],
  rows: [['eu-west', 'gold']],
}

let testIds: string[] = []
let executionIds: string[] = []

async function seedAndRun(request: APIRequestContext): Promise<string> {
  await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
  const testId = await createSecretCopyTest(request, testIds)

  const run = await runTrackedTest(request, testId)
  executionIds.push(run.executionId)
  expect(run.verdict, `tracked run ${run.executionId} passed`).toBe('passed')
  return run.executionId
}

async function readJson(request: APIRequestContext, path: string): Promise<Record<string, unknown>> {
  const resp = await request.get(`${BACKEND_URL}${path}`)
  expect(resp.ok(), `GET ${path} failed: ${resp.status()}`).toBeTruthy()
  const body = (await resp.json()) as Record<string, unknown>
  return (body.data ?? body) as Record<string, unknown>
}

/** The stored values of the secret sources and their copies, by name. */
function maskedEntries(variables: Record<string, unknown>): Record<string, unknown> {
  const entries: Record<string, unknown> = {}
  for (const { source, copy } of COPIES) {
    entries[source] = variables[source]
    entries[copy] = variables[copy]
  }
  return entries
}

const ALL_MASKED: Record<string, unknown> = Object.fromEntries(
  COPIES.flatMap(({ source, copy }) => [
    [source, SECRET_MASK],
    [copy, SECRET_MASK],
  ]),
)

function rowValue(page: Page, name: string): Locator {
  return variableRow(page, name).getByTestId(`variable-value-${name}`)
}

test.describe('V-EXEC-HISTORY-SECRET-COPY: a finished run masks an unflagged copy of a secret container whole', () => {
  test.afterEach(async ({ request }) => {
    for (const id of executionIds.splice(0)) {
      await request.delete(`${BACKEND_URL}/executions/${id}`).catch(() => undefined)
    }
    await cleanUp(request, testIds)
    testIds = []
  })

  test('the stored run and the run page payload hold each copy of a secret table, map and list masked whole', async ({
    request,
  }) => {
    test.setTimeout(180_000)
    const executionId = await seedAndRun(request)

    await test.step('the stored run variables', async () => {
      const variables = await readJson(request, `/executions/${executionId}/variables`)
      expect(
        maskedEntries(variables),
        'each secret and each unflagged copy of it is stored as the bare mask, with no columns, keys or cells',
      ).toEqual(ALL_MASKED)
      expect(variables[PLAIN_COPY], 'a copy of a plain table keeps its columns and rows').toEqual(PLAIN_TABLE)
      expectNoSecret(JSON.stringify(variables), 'the stored run variables', SECRET_TEXTS)
    })

    await test.step('the run page payload', async () => {
      const history = await readJson(request, `/executions/history/${executionId}`)
      const variables = (history.variables ?? {}) as Record<string, unknown>
      expect(
        maskedEntries(variables),
        'the run page payload carries each secret and each copy of it as the bare mask',
      ).toEqual(ALL_MASKED)
      expect(variables[PLAIN_COPY], 'the run page payload keeps the plain copy as columns and rows').toEqual(
        PLAIN_TABLE,
      )
      expectNoSecret(JSON.stringify(history), 'the run page payload', SECRET_TEXTS)
    })
  })

  test('the run page Variable Manager shows each copy of a secret table, map and list masked', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)
    const executionId = await seedAndRun(request)
    await openRunHistory(page, executionId)
    await expandVariableManager(page)

    await test.step('each secret source reads as the mask', async () => {
      for (const { source } of COPIES) {
        await expect(rowValue(page, source), `${source} is a secret`).toHaveText(SECRET_MASK)
      }
    })

    await test.step('the plain copy shows the table the run wrote', async () => {
      await expect(rowValue(page, PLAIN_COPY), 'the run copied one row of two columns').toHaveText('1×2 table')
    })

    await test.step('each unflagged copy of a secret reads as the mask, with no size or count', async () => {
      for (const { source, copy } of COPIES) {
        await expect
          .soft(rowValue(page, copy), `${copy} holds the run's copy of ${source}, so it shows masked`)
          .toHaveText(SECRET_MASK)
      }
    })

    await test.step('the run page shows no column name, key or cell of the secrets', async () => {
      expectNoSecret(await page.content(), 'the run page', SECRET_TEXTS)
    })
  })
})
