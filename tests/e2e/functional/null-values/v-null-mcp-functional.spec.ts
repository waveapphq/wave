/**
 * V-NULL-MCP-FUNCTIONAL: owed secrets and start_execution overrides over the live MCP endpoint.
 * Wireframe: none (tool surface)
 * Design Decisions: N/A
 * REQ: REQ-5.2.7.10 (start_execution overrides: a bare map is the map's value; null and a typed
 *   form with no value set null; an undeclared name is refused), REQ-5.2.7.11, REQ-5.2.7.12 (no
 *   NO_VALUE_VARIABLE for a secret a capture fills), REQ-3.1.3.20
 *
 * Pass Criteria:
 * 1. create_test_from_recipe with three declare-empty secrets, two of them filled by a capture
 *    (one at the top level, one inside a Try body), announces exactly one NO_VALUE_VARIABLE
 *    action item: the uncaptured secret.
 * 2. The run writes both captures (the assert reading them passes) and fails only on the
 *    uncaptured secret; the run's variables hold the two captured secrets and null for the owed one.
 * 3. get_failure_report lists exactly one pending action item, the uncaptured secret, with the
 *    test's identity; the captured secrets owe nothing.
 * 4. start_execution(variables={"nope": 1}) raises exactly
 *    `Variable 'nope' is not declared by this test` and leaves no execution of the test running.
 * 5. start_execution with `{name: null}`, `{name: {type}}`, a bare map, a map shaped like a typed
 *    form of another type and a typed map form runs: the Log prints `null` for the two nulls and
 *    each map as its value, the assert on the values passes, the run's variables hold the same
 *    values, and the test's stored variables do not change.
 */

import fs from 'fs'
import path from 'path'
import { test, expect, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { BACKEND_PORT, BACKEND_URL, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'
import { callTool, enableMcpUntilRestart, type McpToolResult, resetMcpSettings } from '../../helpers/mcp'
import { resetOwnership } from '../../helpers/ownership'

// One MCP port per stack so host-mode parallel workers never collide.
const MCP_PORT = Number(BACKEND_PORT) + 765

const OWED_RECIPE = 'recipe-mcp-owed-secret-variables.yaml'
const OWED_BASE_NAME = 'Null MCP Owed Secrets'
const OVERRIDES_RECIPE = 'recipe-mcp-run-overrides.yaml'
const OVERRIDES_BASE_NAME = 'Null MCP Run Overrides'

const OWED_PROBLEM = "Secret variable 'owed_token' holds no value"
const OWED_FIX = 'A person must fill it in before dependent definitions can run'
const UNDECLARED_MESSAGE = "Variable 'nope' is not declared by this test"
const MASK = '********'

const OVERRIDES = {
  target: null,
  typed_null: { type: 'integer' },
  config: { region: 'eu', tier: 2 },
  shaped: { type: 'integer', value: 5 },
  typed_config: { type: 'map', value: { k: 'v' } },
}
const OVERRIDE_LOG =
  'overrides target=null typed_null=null config={"region":"eu","tier":2} ' +
  'shaped={"type":"integer","value":5} typed_config={"k":"v"}'

const TERMINAL = ['passed', 'failed', 'stopped', 'skipped']
const LIVE = ['running', 'paused']

interface RunHistory {
  variables: Record<string, unknown>
  logs: Array<{ message?: string }>
}

interface ExecutionRow {
  id: string
  status: string
}

function uniqueName(base: string): string {
  return `${base} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function loadRecipe(file: string, baseName: string, name: string): string {
  const recipe = fs.readFileSync(path.resolve(__dirname, file), 'utf-8')
  expect(recipe, `${file} names its test ${baseName}`).toContain(`  name: ${baseName}\n`)
  return recipe.replace(`  name: ${baseName}\n`, `  name: ${name}\n`)
}

function createFromRecipe(recipe: string): McpToolResult {
  const created = callTool(MCP_PORT, 'create_test_from_recipe', { recipe })
  expect(created.isError, JSON.stringify(created.payload)).toBe(false)
  expect(created.payload.created, JSON.stringify(created.payload)).toBe(true)
  return created
}

function startRun(testId: string, variables?: Record<string, unknown>): McpToolResult {
  const args: Record<string, unknown> = {
    entity_type: 'test',
    ref: testId,
    environment: E2E_ENV_NAME,
  }
  if (variables !== undefined) args.variables = variables
  return callTool(MCP_PORT, 'start_execution', args)
}

async function waitForTerminal(request: APIRequestContext, executionId: string): Promise<string> {
  let status = ''
  await expect
    .poll(
      async () => {
        const resp = await request.get(`${BACKEND_URL}/executions/${executionId}`)
        status = ((await resp.json())?.data?.status ?? '') as string
        return TERMINAL.includes(status)
      },
      { timeout: 90_000, message: `execution ${executionId} should reach a terminal status` },
    )
    .toBe(true)
  return status
}

async function runHistory(request: APIRequestContext, executionId: string): Promise<RunHistory> {
  const resp = await request.get(`${BACKEND_URL}/executions/history/${executionId}`)
  expect(resp.ok(), `GET /executions/history/${executionId} failed: ${resp.status()}`).toBe(true)
  return (await resp.json()).data as RunHistory
}

async function executionsOf(request: APIRequestContext, testId: string): Promise<ExecutionRow[]> {
  const resp = await request.get(`${BACKEND_URL}/executions?entity_id=${testId}&per_page=100`)
  expect(resp.ok(), `GET /executions?entity_id=${testId} failed: ${resp.status()}`).toBe(true)
  const rows = ((await resp.json()).data ?? []) as ExecutionRow[]
  return rows.map((row) => ({ id: row.id, status: row.status }))
}

async function storedVariables(
  request: APIRequestContext,
  testId: string,
): Promise<Record<string, unknown>> {
  const resp = await request.get(`${BACKEND_URL}/tests/${testId}`)
  expect(resp.ok(), `GET /tests/${testId} failed: ${resp.status()}`).toBe(true)
  return (await resp.json()).data.variables as Record<string, unknown>
}

/** Stop any execution of the test still live, so the test itself can be deleted. */
async function deleteTest(request: APIRequestContext, testId: string): Promise<void> {
  for (const row of await executionsOf(request, testId)) {
    if (LIVE.includes(row.status)) {
      await request.put(`${BACKEND_URL}/executions/${row.id}/stop`)
    }
  }
  const resp = await request.delete(`${BACKEND_URL}/tests/${testId}`)
  expect(resp.ok(), `DELETE /tests/${testId} failed: ${resp.status()} ${await resp.text()}`).toBe(true)
}

test.describe('V-NULL-MCP-FUNCTIONAL: owed secrets and run overrides over MCP', () => {
  const created: string[] = []

  test.beforeEach(async ({ page, request }) => {
    created.length = 0
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => {})
    await resetOwnership(request)
    await ensureEnvironment(request)
    await enableMcpUntilRestart(page, MCP_PORT)
  })

  test.afterEach(async ({ page, request }) => {
    for (const testId of created) {
      await deleteTest(request, testId)
    }
    await resetOwnership(request)
    await resetMcpSettings(page)
  })

  test('a secret a capture fills is not owed; an uncaptured one is owed at authoring and after a failed run', async ({
    request,
  }) => {
    test.setTimeout(240_000)
    const name = uniqueName(OWED_BASE_NAME)
    let testId = ''
    let executionId = ''

    await test.step('authoring announces only the uncaptured secret', async () => {
      const result = createFromRecipe(loadRecipe(OWED_RECIPE, OWED_BASE_NAME, name))
      testId = String(result.payload.test_id)
      created.push(testId)
      const items = (result.payload.action_items ?? []) as Array<Record<string, unknown>>
      expect(
        items.map((item) => item.step),
        `only the uncaptured secret is owed: ${JSON.stringify(items)}`,
      ).toEqual(['variables.owed_token'])
      expect(items[0].code).toBe('NO_VALUE_VARIABLE')
      expect(items[0].severity).toBe('warning')
      expect(items[0].problem).toBe(OWED_PROBLEM)
      expect(items[0].fix).toBe(OWED_FIX)
    })

    await test.step('the run writes both captures and fails only on the owed secret', async () => {
      const started = startRun(testId)
      expect(started.isError, JSON.stringify(started.payload)).toBe(false)
      executionId = String(started.payload.execution_id)
      expect(await waitForTerminal(request, executionId)).toBe('failed')

      const history = await runHistory(request, executionId)
      const { owed_token, captured_token, try_token } = history.variables
      expect(owed_token, 'the uncaptured secret still holds null').toBeNull()
      expect(captured_token, 'the top-level capture wrote its secret, masked').toBe(MASK)
      expect(try_token, 'the capture inside the Try body wrote its secret, masked').toBe(MASK)
    })

    await test.step('the failure report owes only the uncaptured secret', async () => {
      const report = callTool(MCP_PORT, 'get_failure_report', { execution_id: executionId })
      expect(report.isError, JSON.stringify(report.payload)).toBe(false)
      expect(report.payload.outcome).toBe('failed')

      const failedTests = report.payload.failed_tests as Array<Record<string, any>>
      expect(failedTests).toHaveLength(1)
      const failedLabels = (failedTests[0].failed_blocks as Array<Record<string, unknown>>).map(
        (block) => block.label,
      )
      expect(failedLabels, 'the assert reading the captures passed').toEqual(['Owed token given'])

      expect(report.payload.pending_action_items).toEqual([
        {
          test_id: testId,
          test_name: name,
          step: 'variables.owed_token',
          code: 'NO_VALUE_VARIABLE',
          problem: OWED_PROBLEM,
          fix: OWED_FIX,
        },
      ])
    })
  })

  test('start_execution refuses an override for an undeclared name and starts nothing', async ({
    request,
  }) => {
    test.setTimeout(180_000)
    const result = createFromRecipe(
      loadRecipe(OVERRIDES_RECIPE, OVERRIDES_BASE_NAME, uniqueName(OVERRIDES_BASE_NAME)),
    )
    const testId = String(result.payload.test_id)
    created.push(testId)

    await test.step('REQ-5.2.7.10: the refusal names the undeclared variable', async () => {
      const refused = startRun(testId, { nope: 1 })
      expect(refused.isError, `start_execution must raise: ${JSON.stringify(refused.payload)}`).toBe(true)
      expect(String(refused.payload.text ?? JSON.stringify(refused.payload))).toBe(
        `Error executing tool start_execution: ${UNDECLARED_MESSAGE}`,
      )
    })

    await test.step('REQ-5.2.7.10: the refused start leaves no execution of the test running', async () => {
      await expect
        .poll(
          async () => (await executionsOf(request, testId)).filter((row) => LIVE.includes(row.status)),
          { timeout: 10_000, message: 'a refused start must not leave a running execution behind' },
        )
        .toEqual([])
    })
  })

  test('start_execution overrides set null and take a bare map as the map value', async ({
    request,
  }) => {
    test.setTimeout(180_000)
    const result = createFromRecipe(
      loadRecipe(OVERRIDES_RECIPE, OVERRIDES_BASE_NAME, uniqueName(OVERRIDES_BASE_NAME)),
    )
    const testId = String(result.payload.test_id)
    created.push(testId)
    const declared = await storedVariables(request, testId)

    await test.step('REQ-5.2.7.10: null, a type-only form and maps run as the per-run values', async () => {
      const started = startRun(testId, OVERRIDES)
      expect(started.isError, JSON.stringify(started.payload)).toBe(false)
      const executionId = String(started.payload.execution_id)
      expect(await waitForTerminal(request, executionId), 'the assert on the overridden values passes').toBe(
        'passed',
      )

      const history = await runHistory(request, executionId)
      const messages = history.logs.map((entry) => entry.message ?? '')
      expect(messages, `the Log prints each override: ${JSON.stringify(messages)}`).toContain(OVERRIDE_LOG)
      expect(history.variables.target).toBeNull()
      expect(history.variables.typed_null).toBeNull()
      expect(history.variables.config).toEqual({ region: 'eu', tier: 2 })
      expect(history.variables.shaped).toEqual({ type: 'integer', value: 5 })
      expect(history.variables.typed_config).toEqual({ k: 'v' })
    })

    await test.step('REQ-5.2.7.10: overrides are per run; the stored test keeps its variables', async () => {
      expect((declared.target as { value: unknown }).value).toBe('declared-target')
      expect(await storedVariables(request, testId)).toEqual(declared)
    })
  })
})
