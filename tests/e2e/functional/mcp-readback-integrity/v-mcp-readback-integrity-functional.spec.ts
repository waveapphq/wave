/**
 * V-MCP-READBACK-INTEGRITY-FUNCTIONAL: recipe readback is faithful or says it is not.
 * REQ: REQ-5.2.7.6
 *
 * get_test_recipe on a hand-built test whose if-else uses custom branch handle ids keeps
 * the branch children and the asserts' fail_current_scope flag, or reports expressible:
 * false, so amend_test_from_recipe cannot silently delete those blocks.
 *
 * Pass Criteria:
 * 1. A hand-built if-else with custom branch ids reads back as an `if`
 *    construct containing its branch children, with expressible: true.
 * 2. A leaf assert's fail_current_scope flag survives the readback.
 * 3. A hand-built lane the walk genuinely cannot express (a switch wired from a
 *    handle that is neither a declared branch id nor `then`) reads back
 *    expressible: false with the dropped block named, while the switch's own
 *    `then` continuation still reads back, and amend_test_from_recipe refuses
 *    with TARGET_NOT_RECIPE_EXPRESSIBLE.
 */

import fs from 'fs'
import path from 'path'
import type { APIRequestContext } from '@playwright/test'
import { test, expect } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, BACKEND_PORT, ensureEnvironment } from '../../helpers/config'
import { callTool, enableMcpUntilRestart, resetMcpSettings } from '../../helpers/mcp'

const MCP_PORT = Number(BACKEND_PORT) + 765

function loadFixture(file: string): Record<string, unknown> {
  const fixture = JSON.parse(fs.readFileSync(path.resolve(__dirname, file), 'utf-8'))
  fixture.name = `${fixture.name} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  return fixture
}

async function importFixture(
  request: APIRequestContext,
  fixture: Record<string, unknown>,
): Promise<string> {
  await ensureEnvironment(request)
  const createResp = await request.post(`${BACKEND_URL}/tests`, { data: fixture })
  const body = await createResp.json().catch(() => null)
  expect(createResp.ok(), `POST /tests failed: ${JSON.stringify(body)}`).toBe(true)
  const testId = body?.data?.id as string
  const validateResp = await request.post(`${BACKEND_URL}/tests/${testId}/validate`)
  const validation = await validateResp.json()
  expect(validation?.data?.errors ?? [], 'fixture must import with zero errors').toEqual([])
  return testId
}

test.describe('V-MCP-READBACK-INTEGRITY: faithful readback or honest refusal', () => {
  test.afterEach(async ({ page }) => {
    await resetMcpSettings(page)
  })

  test('custom-branch-id if-else reads back with children and fail-scope intact', async ({
    page,
    request,
  }) => {
    const testId = await importFixture(request, loadFixture('fixture.json'))
    await enableMcpUntilRestart(page, MCP_PORT)

    const readback = callTool(MCP_PORT, 'get_test_recipe', { test_ref: testId })
    expect(readback.isError).toBe(false)
    expect(readback.payload.expressible, 'a clean if-else tree is expressible').toBe(true)
    expect(readback.payload.inexpressible).toEqual([])

    const recipe = String(readback.payload.recipe)
    expect(recipe, 'if-else must read back as a construct, not a leaf block').toContain('- if:')
    expect(recipe, 'the then-branch child must survive readback').toContain('blocked-child-line')
    expect(recipe, 'the rejoin block must survive readback').toContain('closing-line')
    expect(recipe, 'leaf assert keeps its fail-scope flag').toContain('fail_current_scope: true')
    expect(recipe).not.toContain('- block: if-else')
  })

  test('a walk-inexpressible switch lane is flagged and amend is refused', async ({
    page,
    request,
  }) => {
    const testId = await importFixture(request, loadFixture('fixture-switch.json'))
    await enableMcpUntilRestart(page, MCP_PORT)

    const readback = callTool(MCP_PORT, 'get_test_recipe', { test_ref: testId })
    expect(readback.isError).toBe(false)
    expect(
      readback.payload.expressible,
      'a readback that drops blocks must not claim expressibility',
    ).toBe(false)
    const items = readback.payload.inexpressible as Array<Record<string, string>>
    expect(items.some((item) => item.where === 'sw-child')).toBe(true)

    const recipe = String(readback.payload.recipe)
    expect(recipe, 'the switch reads back as a construct').toContain('- switch:')
    expect(recipe, 'the switch then-continuation survives readback').toContain('switch-then-line')
    expect(recipe, 'the undeclared lane child is not expressed').not.toContain('stray-lane-line')

    const amend = callTool(MCP_PORT, 'amend_test_from_recipe', { test_ref: testId, recipe })
    expect(amend.isError).toBe(false)
    expect(amend.payload.amended, 'amend must refuse an incomplete readback').toBe(false)
    const findings = amend.payload.findings as Array<Record<string, unknown>>
    expect(findings.some((f) => f.code === 'TARGET_NOT_RECIPE_EXPRESSIBLE')).toBe(true)
  })
})
