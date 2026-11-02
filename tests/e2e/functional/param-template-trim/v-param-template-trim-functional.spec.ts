/**
 * V-PARAM-TEMPLATE-TRIM-FUNCTIONAL: single-line string param kinds + strict trim.
 *
 * REQ-3.4.2.2, REQ-3.1.1.5. One imported workflow runs an HTTP node four ways
 * so the run output proves every behavior end-to-end:
 *
 *   1. Template kind   url `{{base_url}}/health` -> renders at execution
 *      (a single-line string param has a template control).
 *   2. Expression kind url `base_url + '/health'` -> evaluates.
 *   3. Literal url with a trailing newline -> trimmed before the request
 *      (strict single-line trim; an untrimmed newline would break the request).
 *   4. POST with a multiline Template body `Greeting: {{ greeting }}\nDone`
 *      -> renders at execution.
 *
 * Each request's final_url / echoed body is bound to a variable and a downstream
 * Log reads it back, so assertions anchor on the resolved execution result, never
 * on element existence.
 *
 * Pass Criteria:
 * 1. Fixture imports and validates with zero errors.
 * 2. Workflow runs to `passed`.
 * 3. tmpl url rendered (`tmpl=...//health`, no `{{`), expr url evaluated,
 *    literal url trimmed (`trim=[...//health]` - no trailing whitespace),
 *    body template rendered (`Greeting: Ada`).
 * 4. Every node shows execution status `success`.
 *
 * Run: ./scripts/e2e-targeted-local.sh functional/param-template-trim/v-param-template-trim-functional.spec.ts
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { getLogTexts, getLogLines } from '../../helpers/log-reader'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { injectHttpHost } from '../../helpers/fixture-import'
import {
  BACKEND_PORT,
  BACKEND_URL,
  E2E_ENV_NAME,
  ensureEnvironment,
} from '../../helpers/config'
import fs from 'fs'
import path from 'path'

function loadFixture(): Record<string, unknown> {
  const fixture = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixture.json'), 'utf-8'))
  // Per-worker runtime values: the backend base URL and the literal trim-node
  // url (a real reachable URL plus a trailing newline that the strict-param
  // trim must strip before the request is made).
  fixture.variables.base_url.value = `http://localhost:${BACKEND_PORT}`
  const trimNode = (fixture.workflow.nodes as Array<Record<string, any>>).find(
    (n) => n.id === 'http-trim',
  )!
  trimNode.data.config.values.url = `http://localhost:${BACKEND_PORT}/health\n`
  // injectHttp: the /echo node targets the published http-echo service (9449)
  return injectHttpHost(fixture)
}

const NODE_DESCRIPTIONS = [
  'GET Template URL',
  'Log Template URL',
  'GET Expression URL',
  'Log Expression URL',
  'GET Trimmed URL',
  'Log Trimmed URL',
  'POST Template Body',
  'Log Echo Body',
] as const

function buildNodeIds(fixture: Record<string, unknown>): Map<string, string> {
  const ids = new Map<string, string>()
  const workflow = fixture.workflow as { nodes: Array<Record<string, unknown>> }
  for (const node of workflow.nodes) {
    const data = node.data as Record<string, unknown> | undefined
    const description = data?.description as string | undefined
    if (description) ids.set(description, `workflow-node-${node.id}`)
  }
  return ids
}

async function selectEnvironment(page: Page, envName: string) {
  const envSelector = page.locator('[data-testid="environment-selector"]')
  await envSelector.click()
  const envPopover = page.locator('[data-testid="environment-popover"]')
  await expect(envPopover).toBeVisible()
  await envPopover.locator(`button:has-text("${envName}")`).first().click()
  await expect(envPopover).not.toBeVisible()
}

test.describe('Param Template + Trim E2E', () => {
  test('single-line url resolves through Template / Expression / Literal+trim, body template renders', async ({
    page,
  }) => {
    const fixture = loadFixture()
    const nodeIds = buildNodeIds(fixture)
    for (const desc of NODE_DESCRIPTIONS) {
      expect(nodeIds.has(desc), `Node "${desc}" missing from fixture`).toBeTruthy()
    }

    // ================================================================
    // STEP 1: Import + validate (zero errors)
    // ================================================================
    let testId: string | undefined
    await test.step('Import test via API and validate with zero errors', async () => {
      await page.request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => {})
      await ensureEnvironment(page.request)

      const createResponse = await page.request.post(`${BACKEND_URL}/tests`, { data: fixture })
      const createBody = (await createResponse.json().catch(() => null)) as Record<
        string,
        unknown
      > | null
      expect(
        createResponse.ok(),
        `POST /tests failed: ${createResponse.status()} - ${JSON.stringify(createBody)}`,
      ).toBeTruthy()
      const created = createBody as Record<string, unknown>
      const testData = created.data as Record<string, unknown> | undefined
      testId = (testData?.id || created.id) as string

      const validateResp = await page.request.post(`${BACKEND_URL}/tests/${testId}/validate`)
      const validateBody = await validateResp.json().catch(() => null)
      expect(
        validateResp.ok(),
        `POST /tests/${testId}/validate failed: ${validateResp.status()}`,
      ).toBeTruthy()
      const errors =
        validateBody?.data?.errors ??
        validateBody?.error?.details?.[0]?.errors ??
        validateBody?.errors ??
        []
      expect(errors.length, `Fixture failed validation: ${JSON.stringify(errors)}`).toBe(0)

      await page.goto(`/workbench?editTest=${testId}`)
      await page.evaluate(() => localStorage.clear())
      await page.goto(`/workbench?editTest=${testId}`)
      await waitForCanvasLoad(page)
    })

    // ================================================================
    // STEP 2: Run the workflow to completion
    // ================================================================
    await test.step('Run workflow and wait for passed', async () => {
      await selectEnvironment(page, E2E_ENV_NAME)
      await page.locator('[data-testid="run-button"]').click()

      const status = page.locator('[data-testid="workflow-status"]')
      await expect(status).not.toHaveAttribute('data-status', 'idle', { timeout: 5_000 })
      await expect(status).not.toHaveAttribute('data-status', 'running', { timeout: 30_000 })

      const statusVal = await status.getAttribute('data-status')
      if (statusVal !== 'passed') {
        const lines = await getLogLines(page)
        console.log('=== WORKFLOW NOT PASSED ===')
        console.log(
          JSON.stringify(
            lines.filter((l) => l.startsWith('[ERROR]') || l.startsWith('[WARN]')),
            null,
            2,
          ),
        )
      }
      expect(statusVal).toBe('passed')
    })

    // ================================================================
    // STEP 3: Each kind resolved to the expected execution result
    // ================================================================
    await test.step('Verify template / expression / trim / body all resolved', async () => {
      const logTexts = await getLogTexts(page)
      const all = logTexts.join('\n')

      // 1. Template-kind url rendered: `{{base_url}}` substituted (no `{{` left).
      expect(
        logTexts.some((t) => t.startsWith('tmpl=') && t.includes('/health') && !t.includes('{{')),
        `Template url did not render. Logs:\n${all}`,
      ).toBeTruthy()

      // 2. Expression-kind url evaluated to the same reachable URL.
      expect(
        logTexts.some((t) => t.startsWith('expr=') && t.includes('/health')),
        `Expression url did not evaluate. Logs:\n${all}`,
      ).toBeTruthy()

      // 3. Literal url trimmed: the closing bracket sits flush against `/health`
      //    (a surviving trailing newline/space would push it onto the next line
      //    or insert whitespace before `]`).
      expect(
        logTexts.some((t) => t.startsWith('trim=[') && t.endsWith('/health]')),
        `Literal url was not trimmed. Logs:\n${all}`,
      ).toBeTruthy()

      // 4. Multiline body template rendered at execution (echoed back by /echo).
      expect(
        logTexts.some((t) => t.includes('Greeting: Ada')),
        `Body template did not render. Logs:\n${all}`,
      ).toBeTruthy()
    })

    // ================================================================
    // STEP 4: Every node succeeded
    // ================================================================
    await test.step('Verify all nodes show success status', async () => {
      for (const desc of NODE_DESCRIPTIONS) {
        const node = page.locator(`[data-testid="${nodeIds.get(desc)!}"]`)
        await expect(node).toHaveAttribute('data-execution-status', 'success')
      }
    })
  })
})
