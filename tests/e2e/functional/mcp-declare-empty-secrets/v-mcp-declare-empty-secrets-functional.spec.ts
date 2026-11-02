/**
 * V-MCP-DECLARE-EMPTY-SECRETS-FUNCTIONAL: declare-empty is a valid authoring case.
 * REQ: REQ-5.2.7.12, REQ-5.2.7.11
 *
 * create_test_from_recipe accepts a declare-empty secret, as the served recipe guide
 * documents, and the failure report's pending_action_items shows a credential that still
 * owes its value.
 *
 * Pass Criteria:
 * 1. create_test_from_recipe with a declare-empty secret succeeds and returns
 *    an action_items entry naming the variable (NO_VALUE_VARIABLE, warning).
 * 2. The test executes as an ordinary tracked run; when it fails, the failure
 *    report's pending_action_items names the unfilled secret with the test's
 *    identity attached.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { BACKEND_PORT, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'
import { callTool, enableMcpUntilRestart, resetMcpSettings } from '../../helpers/mcp'

const MCP_PORT = Number(BACKEND_PORT) + 765

function uniqueName(base: string): string {
  return `${base} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function declareEmptyRecipe(name: string): string {
  return [
    'test:',
    `  name: ${name}`,
    '  description: Declare-empty secret journey',
    'variables:',
    '  token: {type: string, secret: true}',
    'flow:',
    '  - block: log',
    '    settings: {message: about to gate}',
    '  - assert:',
    '      that:',
    '        - "1 == 2"',
    '      fail_current_scope: true',
    '',
  ].join('\n')
}

test.describe('V-MCP-DECLARE-EMPTY-SECRETS: valid authoring case, announced everywhere', () => {
  test.afterEach(async ({ page }) => {
    await resetMcpSettings(page)
  })

  test('declare-empty secret authors, runs, and surfaces pending action items', async ({
    page,
    request,
  }) => {
    await ensureEnvironment(request)
    await enableMcpUntilRestart(page, MCP_PORT)

    const name = uniqueName('Declare Empty Journey')
    const created = callTool(MCP_PORT, 'create_test_from_recipe', { recipe: declareEmptyRecipe(name) })
    expect(created.isError).toBe(false)
    expect(created.payload.created, 'declare-empty is a valid authoring case').toBe(true)
    const items = created.payload.action_items as Array<Record<string, unknown>>
    expect(items, 'the authoring result announces the unfilled secret').toBeTruthy()
    expect(items).toHaveLength(1)
    expect(items[0].code).toBe('NO_VALUE_VARIABLE')
    expect(items[0].step).toBe('variables.token')

    const started = callTool(MCP_PORT, 'start_execution', {
      entity_type: 'test',
      ref: String(created.payload.test_id),
      environment: E2E_ENV_NAME,
    })
    expect(started.isError).toBe(false)
    const executionId = String(started.payload.execution_id)

    await expect
      .poll(
        () => {
          const detail = callTool(MCP_PORT, 'get_execution', { execution_id: executionId })
          return detail.payload.status
        },
        { timeout: 60_000 },
      )
      .toBe('failed')

    const report = callTool(MCP_PORT, 'get_failure_report', { execution_id: executionId })
    expect(report.isError).toBe(false)
    const pending = report.payload.pending_action_items as Array<Record<string, unknown>>
    expect(pending, 'the failure report lists the pending manual action item').toHaveLength(1)
    expect(pending[0].step).toBe('variables.token')
    expect(pending[0].code).toBe('NO_VALUE_VARIABLE')
    expect(pending[0].test_name).toBe(name)
  })
})
