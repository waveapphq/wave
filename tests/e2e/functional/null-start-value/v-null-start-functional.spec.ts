/**
 * V-NULL-START-FUNCTIONAL: a declared variable with no value holds null
 * Design Decisions: VMGR-93
 * REQ: REQ-3.1.3.20, REQ-3.1.3.23, REQ-3.1.3.11, REQ-3.1.3.17
 *
 * Phase: functional-workflow. Each test seeds its own Test through POST /tests.
 *
 * Pass Criteria:
 * 1. POST /tests accepts a declaration with no value of every type plus a secret, the Test
 *    validates with zero errors, and PUT keeps the declarations: no NO_VALUE_VARIABLE refusal.
 * 2. GET /tests/{id} returns each declaration with no `value` key and carries no
 *    `variable_warnings` field at all.
 * 3. Every row in the Variable Manager reads `null` in the null look, not dimmed, and keeps
 *    its declared type - the secret row included, so the mask does not claim a hidden value.
 * 4. A run starts every declared variable on null: the session holds null for each of the
 *    seven types and for the secret; the first Log, which adds text to a null string, fails
 *    with `A value is null: can only concatenate str (not "null") to str`; the run fails and
 *    no block after it runs; the rows still read null under their declared types.
 * 5. The null secret reads null whether or not the system reveals test variables, while a
 *    FILLED secret still masks and still reveals.
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, ensureEnvironment } from '../../helpers/config'
import { getActiveSessionId, getSessionVariables, sessionValue } from '../../helpers/fixture-import'
import { logNode, openTest, startEdge, validateTest } from '../../helpers/fn-seed'
import { expectConsoleLine, formatEntries, getLogEntries } from '../../helpers/log-reader'
import { expectNullLook } from '../../helpers/null-look'
import { SECRET_MASK } from '../../helpers/secret-canary'
import { expandVariableManager, variableRow } from '../../helpers/variable-create'
import { selectEnvironment } from '../../helpers/workbench'

/** The seven declared types, each declared with no value. */
const DECLARED_TYPES: ReadonlyArray<readonly [string, string]> = [
  ['z_string', 'string'],
  ['z_integer', 'integer'],
  ['z_float', 'float'],
  ['z_boolean', 'boolean'],
  ['z_array', 'array'],
  ['z_map', 'map'],
  ['z_table', 'table'],
]

const FILLED_SECRET_VALUE = 'filled-secret-9f2a'

const SCALARS_EXPR =
  "'START scalars s=[' + z_string + '] i=' + str(z_integer) + ' f=' + str(z_float) + ' b=' + str(z_boolean)"
const CONTAINERS_EXPR =
  "'START containers a=' + str(z_array) + ' m=' + str(z_map) + ' t=' + str(z_table)"
const SECRET_EXPR = "'START secret=[' + z_secret + ']'"
const NULL_ASSERTION =
  'z_string is None and z_integer is None and z_float is None and z_boolean is None ' +
  'and z_array is None and z_map is None and z_table is None and z_secret is None'

const NULL_MESSAGE = 'A value is null: can only concatenate str (not "null") to str'
const FAILED_LINE = `Block 'Log Scalars' failed: ${NULL_MESSAGE}`

/** The blocks after the failing Log, none of which may run. */
const LATER_BLOCKS = ['log-containers', 'log-secret', 'assert-null'] as const

function assertNullNode(): Record<string, unknown> {
  return {
    id: 'assert-null',
    type: 'workflowNode',
    position: { x: 800, y: 100 },
    data: {
      label: 'Assert Null',
      elementType: 'assert',
      nodeType: 'control',
      category: 'flow',
      version: '1.0.0',
      expressionFields: [],
      templateFields: [],
      variableExpressionKeys: [],
      config: {
        values: {
          assertions: [{ type: 'expression', expression: NULL_ASSERTION, id: 'a-null' }],
          mode: 'single',
        },
        outputBindings: {},
        profileBindings: [],
      },
    },
    measured: { width: 120, height: 62 },
  }
}

function declaredVariables(): Record<string, unknown> {
  const variables: Record<string, unknown> = {}
  for (const [name, type] of DECLARED_TYPES) variables[name] = { type }
  variables.z_secret = { type: 'string', secret: true }
  variables.f_secret = { type: 'string', secret: true, value: FILLED_SECRET_VALUE }
  return variables
}

function testPayload(name: string): Record<string, unknown> {
  return {
    name,
    version: '1.0.0',
    description: 'Every declared type left without a value, read by three Logs and one Assert',
    workflow: {
      nodes: [
        logNode('log-scalars', 'Log Scalars', SCALARS_EXPR, { x: 200, y: 100 }),
        logNode('log-containers', 'Log Containers', CONTAINERS_EXPR, { x: 400, y: 100 }),
        logNode('log-secret', 'Log Secret', SECRET_EXPR, { x: 600, y: 100 }),
        assertNullNode(),
      ],
      edges: [
        startEdge('log-scalars'),
        { id: 'e1', source: 'log-scalars', target: 'log-containers' },
        { id: 'e2', source: 'log-containers', target: 'log-secret' },
        { id: 'e3', source: 'log-secret', target: 'assert-null' },
      ],
    },
    variables: declaredVariables(),
    metadata: {},
  }
}

/** Create the test through the ordinary write path, assert it is accepted and validates. */
async function seedTest(page: Page): Promise<string> {
  await ensureEnvironment(page.request)
  const name = `V-NULL-START ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const resp = await page.request.post(`${BACKEND_URL}/tests`, { data: testPayload(name) })
  const raw = await resp.text()
  expect(
    resp.status(),
    `POST /tests must accept declarations with no value. Got ${resp.status()} - ${raw}`,
  ).toBe(201)
  expect(raw, 'the save must not be refused with the no-value code').not.toContain(
    'NO_VALUE_VARIABLE',
  )
  const testId = JSON.parse(raw).data.id as string
  const validation = await validateTest(page.request, testId)
  expect(
    validation.errors,
    `the Test must validate with zero errors: ${JSON.stringify(validation.errors)}`,
  ).toEqual([])
  return testId
}

function valueCell(page: Page, name: string) {
  return variableRow(page, name).locator('[data-testid^="variable-value-"]')
}

function typeBadge(page: Page, name: string) {
  return variableRow(page, name).locator('[data-testid^="type-badge-"]')
}

/** Every declared row reads null under its own declared type. */
async function expectRowsReadNull(page: Page): Promise<void> {
  for (const [name, type] of DECLARED_TYPES) {
    await expectNullLook(valueCell(page, name), `the ${name} row`)
    await expect(typeBadge(page, name), `${name} keeps its declared type`).toHaveText(type)
  }
}

async function setMaskingFlags(
  page: Page,
  flags: { run_output?: boolean; test_variables?: boolean; shared_variables?: boolean },
): Promise<void> {
  const resp = await page.request.put(`${BACKEND_URL}/admin/secret-masking`, { data: flags })
  expect(
    resp.ok(),
    `PUT /admin/secret-masking failed: ${resp.status()} - ${await resp.text()}`,
  ).toBeTruthy()
}

async function backendSession(
  page: Page,
): Promise<{ status: string; blockStates: Record<string, string> }> {
  const resp = await page.request.get(`${BACKEND_URL}/workbench/session`)
  expect(resp.ok(), `GET /workbench/session failed: ${resp.status()}`).toBeTruthy()
  const data = ((await resp.json()) as { data?: { status?: string; block_states?: Record<string, string> } })
    .data
  return { status: data?.status ?? '', blockStates: data?.block_states ?? {} }
}

test.describe('V-NULL-START-FUNCTIONAL: a declared variable with no value holds null', () => {
  test.afterEach(async ({ page }) => {
    await setMaskingFlags(page, {
      run_output: false,
      test_variables: false,
      shared_variables: false,
    })
  })

  test('the save is accepted, the read carries no value key and no variable warnings', async ({
    page,
  }) => {
    const testId = await seedTest(page)

    await test.step('NULL-START: the read carries no variable_warnings field at all', async () => {
      const resp = await page.request.get(`${BACKEND_URL}/tests/${testId}`)
      expect(resp.ok(), `GET /tests/${testId} failed: ${resp.status()}`).toBeTruthy()
      const payload = await resp.json()
      const data = payload.data ?? payload
      expect(
        Object.keys(data),
        'variable_warnings is gone from the test read',
      ).not.toContain('variable_warnings')
      expect(JSON.stringify(payload)).not.toContain('variable_warnings')
    })

    await test.step('NULL-START: every declaration reads back with no value key', async () => {
      const resp = await page.request.get(`${BACKEND_URL}/tests/${testId}`)
      const data = (await resp.json()).data
      for (const [name, type] of DECLARED_TYPES) {
        expect(data.variables[name], `${name} must read back as a bare declaration`).toEqual({
          type,
        })
      }
      expect(data.variables.z_secret, 'a secret with no value keeps its flag and no value').toEqual({
        type: 'string',
        secret: true,
      })
    })

    await test.step('NULL-START: updating the test keeps the declarations without a value', async () => {
      const current = await (await page.request.get(`${BACKEND_URL}/tests/${testId}`)).json()
      const update = { ...testPayload(current.data.name), description: 'Updated, still no value' }
      const resp = await page.request.put(`${BACKEND_URL}/tests/${testId}`, { data: update })
      const raw = await resp.text()
      expect(resp.ok(), `PUT /tests/${testId} failed: ${resp.status()} - ${raw}`).toBeTruthy()
      expect(raw).not.toContain('NO_VALUE_VARIABLE')
      const data = (await (await page.request.get(`${BACKEND_URL}/tests/${testId}`)).json()).data
      expect(data.variables.z_map).toEqual({ type: 'map' })
    })
  })

  test('the Variable Manager reads null in the null look, not dimmed, on every type and on a secret', async ({
    page,
  }) => {
    const testId = await seedTest(page)
    await openTest(page, testId)
    await expandVariableManager(page)

    await test.step('NULL-START: each declared type reads null and keeps its type', async () => {
      await expectRowsReadNull(page)
    })

    await test.step('NULL-START: a secret with no value reads null instead of claiming a hidden value', async () => {
      await expect(
        variableRow(page, 'z_secret').locator('[data-testid^="secret-badge-"]'),
        'the row is still marked secret',
      ).toBeVisible()
      await expectNullLook(valueCell(page, 'z_secret'), 'the z_secret row')
      await expect(valueCell(page, 'f_secret'), 'a FILLED secret still masks').toHaveText(
        SECRET_MASK,
      )
    })
  })

  test('a run starts each declared variable on null; the first Log adding text to one fails', async ({
    page,
  }) => {
    test.setTimeout(180_000)
    const testId = await seedTest(page)
    await openTest(page, testId)
    await expandVariableManager(page)
    await selectEnvironment(page)

    await test.step('NULL-START: the run fails', async () => {
      await page.locator('[data-testid="run-button"]').click()
      const status = page.locator('[data-testid="workflow-status"]')
      await expect(status).toHaveAttribute('data-status', 'failed', { timeout: 60_000 })
      await expect
        .poll(async () => (await backendSession(page)).status, {
          timeout: 15_000,
          message: 'the backend session ends failed',
        })
        .toBe('failed')
    })

    await test.step('NULL-START: the first Log fails on the null string with the null message', async () => {
      await expect(async () => {
        const entries = await getLogEntries(page)
        expectConsoleLine(entries, 'ERROR', FAILED_LINE)
        expect(
          entries.filter((entry) => entry.message.startsWith('START ')).map((e) => e.message),
          `no Log printed a line.\n${formatEntries(entries)}`,
        ).toEqual([])
      }).toPass({ timeout: 15_000 })
      await expect(page.locator('[data-testid="workflow-node-log-scalars"]')).toHaveAttribute(
        'data-execution-status',
        'failed',
      )
    })

    await test.step('NULL-START: no block after the failing Log runs', async () => {
      const { blockStates } = await backendSession(page)
      expect(blockStates['log-scalars'], 'the backend records the failed Log').toBe('failed')
      for (const id of LATER_BLOCKS) {
        expect(blockStates[id], `${id} never ran`).toBe('skipped')
        await expect(
          page.locator(`[data-testid="workflow-node-${id}"]`),
          `${id} paints skipped`,
        ).toHaveAttribute('data-execution-status', 'skipped')
      }
    })

    await test.step('NULL-START: the session holds null for every declared type and the secret', async () => {
      const variables = await getSessionVariables(page, await getActiveSessionId(page))
      for (const [name] of DECLARED_TYPES) {
        expect(sessionValue(variables, name), `${name} starts the run on null`).toBeNull()
      }
      expect(sessionValue(variables, 'z_secret'), 'a secret with no value starts on null').toBeNull()
    })

    await test.step('NULL-START: after the run the rows still read null under their declared types', async () => {
      await expectRowsReadNull(page)
      await expectNullLook(valueCell(page, 'z_secret'), 'the z_secret row after the run')
    })
  })

  test('a secret with no value reads null on both reveal paths', async ({ page }) => {
    test.setTimeout(120_000)
    const testId = await seedTest(page)

    await test.step('NULL-START: with the reveal OFF the secret with no value reads null, not masked', async () => {
      await setMaskingFlags(page, { test_variables: false })
      await openTest(page, testId)
      await expandVariableManager(page)
      await expectNullLook(valueCell(page, 'z_secret'), 'the z_secret row, reveal off')
      await expect(valueCell(page, 'f_secret')).toHaveText(SECRET_MASK)
    })

    await test.step('NULL-START: with the reveal ON the filled secret shows and the other still reads null', async () => {
      await setMaskingFlags(page, { test_variables: true })
      await openTest(page, testId)
      await expandVariableManager(page)
      await expect(
        valueCell(page, 'f_secret'),
        'the reveal path is genuinely on for this surface',
      ).toHaveText(FILLED_SECRET_VALUE)
      await expectNullLook(valueCell(page, 'z_secret'), 'the z_secret row, reveal on')
    })
  })
})
