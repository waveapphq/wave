/**
 * V-EXEC-HISTORY-SECRET-TUPLE: a finished run keeps a one-item tuple copy of a secret list masked whole,
 * in the stored run and on the run page
 * REQ: REQ-3.1.3.5 (Secret variable masking) / REQ-3.1.3.23 (WAVE's print form, which a secret
 *      container registers whole) / REQ-5.2.1.40 (Execution history screen) /
 *      REQ-3.1.3.11 (Variable watching UI panel)
 * Design: a value is a copy of a secret list, map or table when its print form or its fill form matches
 *         the container's; a one-item tuple fills as the one-item list it was made from, so it is a copy
 *         and collapses to the bare placeholder like a list copy does.
 *
 * Phase: functional-workflow. API seed (POST /tests), no fixture file: a secret one-item list whose cell
 * is shorter than the 6 character scan floor, and one Variable Setter whose Expression rows make a
 * one-item tuple of it with `(*vault_list,)`. A Setter refuses a bare tuple for a variable of any type,
 * so the rows store the tuple as the one item of an unflagged list and as the one entry of an unflagged
 * map; beside each, the same rows store a one-item list copy (`[*vault_list]`) the same way. Validated
 * with zero errors and run once as a tracked execution (POST /executions).
 *
 * Pass Criteria:
 * 1. The stored run variables (`GET /executions/<id>/variables`) hold the secret list as `********`, each
 *    tuple copy masked whole (`["********"]`, `{"held": "********"}`) exactly like the list copy beside
 *    it, and no cell of the secret anywhere.
 * 2. The run page payload (`GET /executions/history/<id>`) holds the same values and no cell of the
 *    secret anywhere.
 * 3. On the run page the Variable Manager reads the list copies as `[1 item]` and the map copies as
 *    `{1 key}`; the watcher of each copy shows `********`, and no cell of the secret is on the page.
 */

import { randomUUID } from 'node:crypto'
import { test, expect, type APIRequestContext, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import { cleanUp, createTest, setterBlock } from '../../helpers/fn-block'
import { validateTest } from '../../helpers/fn-seed'
import { openRunHistory, runTrackedTest } from '../../helpers/k8s-run'
import { expectNoSecret, SECRET_MASK } from '../../helpers/secret-canary'
import { expandVariableManager, variableRow } from '../../helpers/variable-create'

/** Under the scan floor, so only the whole-container forms can catch a copy. */
const CELL = 'kq4z'
const SECRET_TEXTS = [CELL]
const SOURCE = 'vault_list'

/** Each unflagged copy: its type, the Setter's expression and how a run stores it masked. */
const COPIES = [
  { name: 'tuple_in_list', type: 'array', expression: `[(*${SOURCE},)]`, stored: [SECRET_MASK], row: '[1 item]' },
  { name: 'list_in_list', type: 'array', expression: `[[*${SOURCE}]]`, stored: [SECRET_MASK], row: '[1 item]' },
  {
    name: 'tuple_in_map',
    type: 'map',
    expression: `{'held': (*${SOURCE},)}`,
    stored: { held: SECRET_MASK },
    row: '{1 key}',
  },
  {
    name: 'list_in_map',
    type: 'map',
    expression: `{'held': [*${SOURCE}]}`,
    stored: { held: SECRET_MASK },
    row: '{1 key}',
  },
] as const

const SETTER_ID = 'secret-tuple-setter'

const ALL_MASKED: Record<string, unknown> = {
  [SOURCE]: SECRET_MASK,
  ...Object.fromEntries(COPIES.map(({ name, stored }) => [name, stored])),
}

let testIds: string[] = []
let executionIds: string[] = []

async function seedAndRun(request: APIRequestContext): Promise<string> {
  await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
  const rows = Object.fromEntries(COPIES.map(({ name, expression }) => [name, expression]))
  const testId = await createTest(request, {
    name: `zz-secret-tuple-${randomUUID().slice(0, 8)}`,
    nodes: [
      setterBlock(SETTER_ID, 'Copy as tuples', rows, {
        expressionFields: COPIES.map(({ name }) => `variables.${name}`),
        position: { x: 200, y: 160 },
      }),
    ],
    variables: {
      [SOURCE]: { type: 'array', scope: 'test', secret: true, value: [CELL] },
      ...Object.fromEntries(
        COPIES.map(({ name, type }) => [name, { type, scope: 'test', value: type === 'map' ? {} : [] }]),
      ),
    },
  })
  testIds.push(testId)
  const validation = await validateTest(request, testId, 'run')
  expect(validation.errors, JSON.stringify(validation.errors)).toHaveLength(0)

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

/** The stored values of the secret and its copies, by name. */
function maskedEntries(variables: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.keys(ALL_MASKED).map((name) => [name, variables[name]]))
}

function rowValue(page: Page, name: string): Locator {
  return variableRow(page, name).getByTestId(`variable-value-${name}`)
}

function watcher(page: Page, name: string): Locator {
  return page.getByRole('dialog', { name: name, exact: true, includeHidden: true })
}

test.describe('V-EXEC-HISTORY-SECRET-TUPLE: a finished run masks a one-item tuple copy of a secret list whole', () => {
  test.afterEach(async ({ request }) => {
    for (const id of executionIds.splice(0)) {
      await request.delete(`${BACKEND_URL}/executions/${id}`).catch(() => undefined)
    }
    await cleanUp(request, testIds)
    testIds = []
  })

  test('the stored run and the run page payload hold each tuple copy masked whole, like a list copy', async ({
    request,
  }) => {
    test.setTimeout(180_000)
    const executionId = await seedAndRun(request)

    await test.step('the stored run variables', async () => {
      const variables = await readJson(request, `/executions/${executionId}/variables`)
      expect(
        maskedEntries(variables),
        'the secret is the bare mask, and each tuple copy is masked whole like the list copy beside it',
      ).toEqual(ALL_MASKED)
      expectNoSecret(JSON.stringify(variables), 'the stored run variables', SECRET_TEXTS)
    })

    await test.step('the run page payload', async () => {
      const history = await readJson(request, `/executions/history/${executionId}`)
      const variables = (history.variables ?? {}) as Record<string, unknown>
      expect(
        maskedEntries(variables),
        'the run page payload carries each tuple copy masked whole, like the list copy beside it',
      ).toEqual(ALL_MASKED)
      expectNoSecret(JSON.stringify(history), 'the run page payload', SECRET_TEXTS)
    })
  })

  test('the run page Variable Manager shows each tuple copy masked whole in its watcher', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)
    const executionId = await seedAndRun(request)
    await openRunHistory(page, executionId)
    await expandVariableManager(page)

    await test.step('the secret reads as the mask', async () => {
      await expect(rowValue(page, SOURCE), `${SOURCE} is a secret`).toHaveText(SECRET_MASK)
    })

    await test.step("each copy's row reads its size", async () => {
      for (const { name, row } of COPIES) {
        await expect(rowValue(page, name), `${name} holds one masked copy`).toHaveText(row)
      }
    })

    await test.step("each copy's watcher shows the copy masked whole", async () => {
      for (const { name } of COPIES) {
        const variable = variableRow(page, name)
        await variable.hover()
        await variable.getByTestId(`expand-button-${name}`).click()
        const sheet = watcher(page, name)
        await expect(sheet).toBeVisible()
        await expect.soft(sheet, `the watcher of ${name} shows the copy of ${SOURCE} masked`).toContainText(SECRET_MASK)
        expectNoSecret(await sheet.innerHTML(), `the watcher of ${name}`, SECRET_TEXTS)
        await sheet.getByRole('button', { name: `Close inspector for ${name}`, exact: true }).click()
        await expect(sheet).toHaveCount(0)
      }
    })

    await test.step('the run page shows no cell of the secret', async () => {
      expectNoSecret(await page.content(), 'the run page', SECRET_TEXTS)
    })
  })
})
