/**
 * V-MCP-RECIPE-CHOICE-WORDS-FUNCTIONAL: a recipe may write a choice word that YAML reads
 * as true or false without quotes
 * Wireframes: none (tool-surface behavior; the Proxy row is the HTTP block's own)
 * Design Decisions: HTTP-13
 * REQ: REQ-5.2.7.3, REQ-5.2.7.6, REQ-3.4.3.9
 *
 * Pass Criteria:
 * 1. create_test_from_recipe refuses an HTTP block whose `proxy_mode` is a bare `on` with
 *    `Setting 'proxy_mode' of block 'http-client' expects string, got boolean`, and no Test
 *    of that name is stored.
 * 2. The same recipe with a bare `off` is created, and the stored block holds the word `off`.
 * 3. get_test_recipe reads the Test back as a recipe that says `proxy_mode: 'off'`.
 * 4. In the Workbench the block's Proxy row reads "Off".
 *
 * Run: ./scripts/e2e-targeted-local.sh functional/recipe-authoring/v-mcp-recipe-choice-words-functional.spec.ts
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import {
  BACKEND_PORT,
  BACKEND_URL,
  HTTP_MAIN_PORT,
  HTTP_TARGET_HOST,
  ensureEnvironment,
} from '../../helpers/config'
import { deleteTest, getTest, runToken } from '../../helpers/element-types'
import { openTest } from '../../helpers/fn-seed'
import { callTool, enableMcpUntilRestart, resetMcpSettings } from '../../helpers/mcp'
import { resetOwnership } from '../../helpers/ownership'
import { openConfig } from '../canvas-lanes/lanes-helpers'

// One MCP port per stack so host-mode parallel workers never collide.
const MCP_PORT = Number(BACKEND_PORT) + 765
const TARGET_URL = `https://${HTTP_TARGET_HOST}:${HTTP_MAIN_PORT}/health`

const TYPE_MESSAGE = "Setting 'proxy_mode' of block 'http-client' expects string, got boolean"

interface Finding {
  step: string
  code: string
  problem: string
  fix: string
}

/** One HTTP block whose Proxy choice is written exactly as `proxyMode`, with no quotes added. */
function recipeFor(name: string, proxyMode: string): string {
  return `test:
  name: ${name}
  description: A choice word written without quotes
flow:
  - block: http-client
    label: Proxy choice
    settings:
      url: ${TARGET_URL}
      method: GET
      proxy_mode: ${proxyMode}
`
}

test.describe('V-MCP-RECIPE-CHOICE-WORDS-FUNCTIONAL: choice words YAML reads as true or false', () => {
  let testId = ''

  test.beforeEach(async ({ request }) => {
    await resetOwnership(request)
  })

  test.afterEach(async ({ page, request }) => {
    if (testId) await deleteTest(request, testId)
    testId = ''
    await resetOwnership(request)
    await resetMcpSettings(page)
  })

  test('a bare off is the choice Off; a bare on is refused with the type message', async ({ page, request }) => {
    test.setTimeout(240_000)
    await ensureEnvironment(request)
    await enableMcpUntilRestart(page, MCP_PORT)
    const token = runToken()

    await test.step('a bare on is refused and stores nothing', async () => {
      const name = `Recipe Choice Word On ${token}`
      const recipe = recipeFor(name, 'on')
      expect(recipe).toContain('      proxy_mode: on\n')

      const refused = callTool(MCP_PORT, 'create_test_from_recipe', { recipe })
      expect(refused.payload.created, JSON.stringify(refused.payload)).toBe(false)
      const findings = refused.payload.findings as Finding[]
      expect(
        findings.map((item) => [item.step, item.code, item.problem, item.fix]),
        JSON.stringify(findings),
      ).toEqual([
        ['flow[0].settings.proxy_mode', 'INVALID_SETTING_TYPE', TYPE_MESSAGE, 'Provide a string value'],
      ])

      const list = await request.get(`${BACKEND_URL}/tests?search=${encodeURIComponent(name)}`)
      expect(list.ok(), `GET /tests?search= failed: ${list.status()}`).toBeTruthy()
      expect((await list.json()).data ?? [], 'no Test of the refused recipe is stored').toHaveLength(0)
    })

    let nodeId = ''

    await test.step('a bare off is created and stored as the word off', async () => {
      const recipe = recipeFor(`Recipe Choice Word Off ${token}`, 'off')
      expect(recipe).toContain('      proxy_mode: off\n')

      const created = callTool(MCP_PORT, 'create_test_from_recipe', { recipe })
      expect(created.payload.created, JSON.stringify(created.payload)).toBe(true)
      testId = created.payload.test_id as string

      const nodes = (await getTest(request, testId)).workflow.nodes as Array<Record<string, any>>
      const http = nodes.find((node) => node.data.elementType === 'http-client')
      expect(http, 'the HTTP block is stored').toBeTruthy()
      expect(http?.data.config.values.proxy_mode).toBe('off')
      nodeId = http?.id as string
    })

    await test.step("the recipe read back says 'off'", async () => {
      const readback = callTool(MCP_PORT, 'get_test_recipe', { test_ref: testId })
      expect(readback.payload.expressible, JSON.stringify(readback.payload)).toBe(true)
      expect(readback.payload.recipe as string).toMatch(/^\s+proxy_mode: 'off'$/m)
    })

    await test.step('the Proxy row in the Workbench reads Off', async () => {
      await openTest(page, testId)
      const sheet = await openConfig(page, nodeId)
      const header = sheet.locator('[data-testid="group-header-Connection"]')
      await header.click()
      await expect(header).toHaveAttribute('aria-expanded', 'true')
      const proxy = sheet.locator('[data-testid="param-row-proxy_mode"]').getByRole('combobox')
      await expect(proxy).toBeEnabled()
      await expect(proxy).toHaveText('Off')
    })
  })
})
