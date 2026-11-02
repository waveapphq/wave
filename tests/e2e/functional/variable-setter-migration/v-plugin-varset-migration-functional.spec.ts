/**
 * V-PLUGIN-VARSET-MIGRATION-FUNCTIONAL: Variable Setter migration end-to-end.
 *
 * REQ-3.4.1.14, REQ-3.1.3.15. One Variable Setter assigns
 * one value of EACH type through the migrated affordances, plus a per-key
 * expression row and a per-key template row, then downstream Log nodes read
 * every target back so the run output proves the resolved value:
 *
 *   - string literal  -> str_v   = "hello world"
 *   - integer (exact)  -> int_v   = "42"               (exact-text)
 *   - float (exact)    -> float_v = "2.718281828459045" (exact precision)
 *   - boolean          -> bool_v  = true
 *   - array            -> arr_v   = ["a","b","c"]
 *   - map              -> map_v   = {"k1":"v1","k2":"v2"}
 *   - table            -> tbl_v   = [{id,name} x2]
 *   - expression row   -> expr_v  = base_num + 1        (evaluates eagerly = 42)
 *   - template row     -> tmpl_v  = "Hi {{ first_name }}" (renders eagerly = "Hi Ada")
 *
 * Pass Criteria:
 * 1. Fixture imports and validates with zero errors.
 * 2. Workflow runs to `passed`.
 * 3. Each target variable's resolved value appears in the console (exact
 *    numbers preserved, template rendered, expression evaluated).
 * 4. Every node shows execution status `success`.
 *
 * Run: ./scripts/e2e-targeted-local.sh functional/variable-setter-migration/v-plugin-varset-migration-functional.spec.ts
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { getLogTexts, getLogLines } from '../../helpers/log-reader'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'
import fs from 'fs'
import path from 'path'

function loadFixture(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixture.json'), 'utf-8'))
}

// Node description -> stable id (the fixture uses the description as the label).
const NODE_DESCRIPTIONS = [
  'Set All Types',
  'Log String',
  'Log Integer',
  'Log Float',
  'Log Boolean',
  'Log Array',
  'Log Map',
  'Log Table',
  'Log Expression',
  'Log Template',
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

test.describe('Variable Setter Migration E2E', () => {
  test('All migrated value types + expression + template resolve through the setter', async ({
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
      await page.request
        .delete(`http://localhost:${BACKEND_PORT}/workbench/session/`)
        .catch(() => {})
      await ensureEnvironment(page.request)

      const createResponse = await page.request.post(
        `http://localhost:${BACKEND_PORT}/tests`,
        { data: fixture },
      )
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

      const validateResp = await page.request.post(
        `http://localhost:${BACKEND_PORT}/tests/${testId}/validate`,
      )
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
      expect(
        errors.length,
        `Fixture failed validation: ${JSON.stringify(errors)}`,
      ).toBe(0)

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
        console.log(JSON.stringify(lines.filter((l) => l.startsWith('[ERROR]') || l.startsWith('[WARN]')), null, 2))
      }
      expect(statusVal).toBe('passed')
    })

    // ================================================================
    // STEP 3: Each target's resolved value reaches the console
    // ================================================================
    await test.step('Verify every type resolved to the expected value', async () => {
      const logTexts = await getLogTexts(page)
      const all = logTexts.join('\n')
      const expectValue = (value: string) =>
        expect(logTexts.some((t) => t === value), `Expected log "${value}"\n${all}`).toBeTruthy()

      // Literals
      expectValue('str=hello world')
      // Exact-text numbers preserved: no parseInt/parseFloat rounding.
      expectValue('int=42')
      expectValue('float=2.718281828459045')
      expectValue('bool=True')
      // Complex types persisted + resolved through the migrated value sheet.
      expectValue('arr=a,b,c')
      expectValue('map=v1,v2')
      expectValue('tbl=1,alpha,beta')
      // Per-key expression evaluates eagerly.
      expectValue('expr=42')
      // Per-key template renders eagerly to the target.
      expectValue('tmpl=Hi Ada')
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
