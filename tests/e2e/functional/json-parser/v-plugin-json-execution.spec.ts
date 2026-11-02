/**
 * JSON Parser End-to-End Execution Test
 *
 * Imports a pre-built workflow fixture with 17 nodes:
 *   - 4 JSON Parser plugins (combined, individual, error handling, nested)
 *   - 13 Log plugins (verify each result value)
 *
 * Tests:
 *   - Combined mode: results map with type metadata, multi-match array
 *   - Individual mode: typed variables (float, integer, boolean coercion)
 *   - Error handling: bad JSONPath produces errors array, good queries still succeed
 *   - Nested queries: deep object access and array indexing
 *   - Success flag: true when all queries pass, false when errors present
 *
 * REQ: REQ-3.4.1.16 JSON Parser Control
 *
 * Run: ./scripts/e2e-targeted-local.sh functional/json-parser/v-plugin-json-execution.spec.ts
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { getLogTexts, getLogLines } from '../../helpers/log-reader'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'
import fs from 'fs'
import path from 'path'

// ---------------------------------------------------------------------------
// Fixture loading
// ---------------------------------------------------------------------------

function loadFixture(): Record<string, unknown> {
  const raw = fs.readFileSync(
    path.resolve(__dirname, 'fixture.json'),
    'utf-8'
  )
  return JSON.parse(raw)
}

// ---------------------------------------------------------------------------
// Node mapping
// ---------------------------------------------------------------------------

type NodeName =
  | 'JSON_COMBINED'
  | 'LOG_COMBINED_NAME'
  | 'LOG_COMBINED_FIRST_TITLE'
  | 'LOG_COMBINED_COUNT'
  | 'LOG_COMBINED_ALL_TITLES'
  | 'LOG_COMBINED_SUCCESS'
  | 'JSON_INDIVIDUAL'
  | 'LOG_INDIVIDUAL_PRICE'
  | 'LOG_INDIVIDUAL_QTY'
  | 'LOG_INDIVIDUAL_ACTIVE'
  | 'JSON_ERROR_HANDLING'
  | 'LOG_ERROR_SUCCESS'
  | 'LOG_ERROR_GOOD_QUERY'
  | 'LOG_ERROR_COUNT'
  | 'JSON_NESTED'
  | 'LOG_NESTED_DEEP'
  | 'LOG_NESTED_TAG'

const DESCRIPTION_TO_NODE: Record<string, NodeName> = {
  'JSON Combined Mode': 'JSON_COMBINED',
  'Log Combined Store Name': 'LOG_COMBINED_NAME',
  'Log Combined First Title': 'LOG_COMBINED_FIRST_TITLE',
  'Log Combined Count': 'LOG_COMBINED_COUNT',
  'Log Combined All Titles': 'LOG_COMBINED_ALL_TITLES',
  'Log Combined Success': 'LOG_COMBINED_SUCCESS',
  'JSON Individual Mode': 'JSON_INDIVIDUAL',
  'Log Individual Price': 'LOG_INDIVIDUAL_PRICE',
  'Log Individual Qty': 'LOG_INDIVIDUAL_QTY',
  'Log Individual Active': 'LOG_INDIVIDUAL_ACTIVE',
  'JSON Error Handling': 'JSON_ERROR_HANDLING',
  'Log Error Success Flag': 'LOG_ERROR_SUCCESS',
  'Log Error Good Query': 'LOG_ERROR_GOOD_QUERY',
  'Log Error Count': 'LOG_ERROR_COUNT',
  'JSON Nested Query': 'JSON_NESTED',
  'Log Nested Deep Value': 'LOG_NESTED_DEEP',
  'Log Nested Second Tag': 'LOG_NESTED_TAG',
}

const ALL_NODE_NAMES: NodeName[] = [
  'JSON_COMBINED',
  'LOG_COMBINED_NAME',
  'LOG_COMBINED_FIRST_TITLE',
  'LOG_COMBINED_COUNT',
  'LOG_COMBINED_ALL_TITLES',
  'LOG_COMBINED_SUCCESS',
  'JSON_INDIVIDUAL',
  'LOG_INDIVIDUAL_PRICE',
  'LOG_INDIVIDUAL_QTY',
  'LOG_INDIVIDUAL_ACTIVE',
  'JSON_ERROR_HANDLING',
  'LOG_ERROR_SUCCESS',
  'LOG_ERROR_GOOD_QUERY',
  'LOG_ERROR_COUNT',
  'JSON_NESTED',
  'LOG_NESTED_DEEP',
  'LOG_NESTED_TAG',
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function selectEnvironment(page: Page, envName: string) {
  const envSelector = page.locator('[data-testid="environment-selector"]')
  await envSelector.click()
  const envPopover = page.locator('[data-testid="environment-popover"]')
  await expect(envPopover).toBeVisible()
  await envPopover.locator(`button:has-text("${envName}")`).first().click()
  await expect(envPopover).not.toBeVisible()
}

function buildNodeIds(
  fixture: Record<string, unknown>
): Map<NodeName, string> {
  const nodeIds = new Map<NodeName, string>()
  const workflow = fixture.workflow as { nodes: Array<Record<string, unknown>> }
  for (const node of workflow.nodes) {
    const data = node.data as Record<string, unknown> | undefined
    const displayName = data?.description as string | undefined
    const nodeName = displayName ? DESCRIPTION_TO_NODE[displayName] : undefined
    if (nodeName) {
      nodeIds.set(nodeName, `workflow-node-${node.id}`)
    }
  }
  return nodeIds
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

test.describe('JSON Parser E2E Execution', () => {
  test('Import fixture, run workflow, verify combined/individual/error/nested results', async ({
    page,
  }) => {
    const fixture = loadFixture()
    const nodeIds = buildNodeIds(fixture)

    // Verify all nodes mapped correctly
    for (const name of ALL_NODE_NAMES) {
      expect(
        nodeIds.has(name),
        `Node "${name}" not found in fixture`
      ).toBeTruthy()
    }

    // ================================================================
    // STEP 1: Import test via API
    // ================================================================
    await test.step('Import test via API', async () => {
      // Clear any existing session
      await page.request
        .delete(`http://localhost:${BACKEND_PORT}/workbench/session/`)
        .catch(() => {})

      // Ensure shared environment exists
      await ensureEnvironment(page.request)

      const createResponse = await page.request.post(
        `http://localhost:${BACKEND_PORT}/tests`,
        { data: fixture }
      )
      expect(
        createResponse.ok(),
        `POST /tests failed: ${createResponse.status()}`
      ).toBeTruthy()

      const created = (await createResponse.json()) as Record<string, unknown>
      const testData = created.data as Record<string, unknown> | undefined
      const testId = testData?.id || created.id

      await page.goto(`/workbench?editTest=${testId}`)
      await page.evaluate(() => localStorage.clear())
      await page.goto(`/workbench?editTest=${testId}`)
      await waitForCanvasLoad(page)
    })

    // ================================================================
    // STEP 2: Run workflow
    // ================================================================
    await test.step('Run workflow and wait for completion', async () => {
      await selectEnvironment(page, E2E_ENV_NAME)

      const runButton = page.locator('[data-testid="run-button"]')
      await runButton.click()

      const statusIndicator = page.locator('[data-testid="workflow-status"]')

      // Wait for execution to actually start
      await expect(statusIndicator).not.toHaveAttribute('data-status', 'idle', { timeout: 5_000 })

      // Wait for workflow to finish
      await expect(statusIndicator).not.toHaveAttribute(
        'data-status',
        'running',
        { timeout: 10_000 }
      )

      // Diagnostic: if not passed, dump node statuses
      const status = await statusIndicator.getAttribute('data-status')
      if (status !== 'passed') {
        const nodeStatuses = await page.evaluate(() => {
          const nodes = document.querySelectorAll(
            '[data-testid^="workflow-node-"]'
          )
          return Array.from(nodes).map((n) => ({
            testId: n.getAttribute('data-testid'),
            status: n.getAttribute('data-execution-status'),
            name:
              n.querySelector('[class*="description"], [class*="name"]')
                ?.textContent || n.textContent?.substring(0, 80),
          }))
        })
        const failedNodes = nodeStatuses.filter(
          (n) => n.status === 'failed'
        )
        const logEntries: string[] = await getLogLines(page)
        const errorLogs = logEntries.filter(
          (e) => e.startsWith('[ERROR]') || e.startsWith('[WARN]')
        )
        test.info().annotations.push({ type: 'workflow-status', description: String(status) })
        test.info().annotations.push({ type: 'failed-nodes', description: JSON.stringify(failedNodes) })
        test.info().annotations.push({ type: 'error-logs', description: JSON.stringify(errorLogs) })
      }

      expect(status).toBe('passed')
    })

    // ================================================================
    // STEP 3: Verify combined mode results
    // ================================================================
    await test.step('Verify combined mode values in console', async () => {
      const logTexts: string[] = await getLogTexts(page)
      const allLogText = logTexts.join('\n')

      // Combined mode store_name: "BookShop"
      expect(
        logTexts.some((t) => t === 'BookShop'),
        `Expected "BookShop" in logs (store_name). Got:\n${allLogText}`
      ).toBeTruthy()

      // Combined mode first_title: "Alpha"
      expect(
        logTexts.some((t) => t === 'Alpha'),
        `Expected "Alpha" in logs (first_title). Got:\n${allLogText}`
      ).toBeTruthy()

      // Combined mode book_count: 2
      expect(
        logTexts.some((t) => t === '2'),
        `Expected "2" in logs (book_count). Got:\n${allLogText}`
      ).toBeTruthy()

      // Combined mode all_titles: array joined as "Alpha,Beta"
      expect(
        logTexts.some((t) => t === 'Alpha,Beta'),
        `Expected "Alpha,Beta" in logs (all_titles joined). Got:\n${allLogText}`
      ).toBeTruthy()

      // Combined mode success: True
      expect(
        logTexts.some((t) => t === 'True'),
        `Expected "True" in logs (json_combined_success). Got:\n${allLogText}`
      ).toBeTruthy()
    })

    // ================================================================
    // STEP 4: Verify individual mode with type coercion
    // ================================================================
    await test.step('Verify individual mode typed values in console', async () => {
      const logTexts: string[] = await getLogTexts(page)
      const allLogText = logTexts.join('\n')

      // Individual mode price_val (float): 19.99
      expect(
        logTexts.some((t) => t === '19.99'),
        `Expected "19.99" in logs (price_val float). Got:\n${allLogText}`
      ).toBeTruthy()

      // Individual mode qty_val (integer): 5
      expect(
        logTexts.some((t) => t === '5'),
        `Expected "5" in logs (qty_val integer). Got:\n${allLogText}`
      ).toBeTruthy()

      // Individual mode is_active (boolean): True
      // Already checked "True" above for combined success; verify at least 2
      const trueCount = logTexts.filter((t) => t === 'True').length
      expect(
        trueCount >= 2,
        `Expected at least 2 "True" entries (combined_success + is_active). Got ${trueCount}:\n${allLogText}`
      ).toBeTruthy()
    })

    // ================================================================
    // STEP 5: Verify error handling
    // ================================================================
    await test.step('Verify error handling - bad JSONPath collected, good query succeeds', async () => {
      const logTexts: string[] = await getLogTexts(page)
      const allLogText = logTexts.join('\n')

      // Error handling success flag: False (because bad_query failed)
      expect(
        logTexts.some((t) => t === 'False'),
        `Expected "False" in logs (json_error_success). Got:\n${allLogText}`
      ).toBeTruthy()

      // Good query still succeeded: "Good"
      expect(
        logTexts.some((t) => t === 'Good'),
        `Expected "Good" in logs (good_query value). Got:\n${allLogText}`
      ).toBeTruthy()

      // Errors array length: 1
      expect(
        logTexts.some((t) => t === '1'),
        `Expected "1" in logs (error count). Got:\n${allLogText}`
      ).toBeTruthy()
    })

    // ================================================================
    // STEP 6: Verify nested query results
    // ================================================================
    await test.step('Verify nested object and array index queries', async () => {
      const logTexts: string[] = await getLogTexts(page)
      const allLogText = logTexts.join('\n')

      // Deep nested value: "NestedOk"
      expect(
        logTexts.some((t) => t === 'NestedOk'),
        `Expected "NestedOk" in logs (deep_val). Got:\n${allLogText}`
      ).toBeTruthy()

      // Array index [1]: "beta"
      expect(
        logTexts.some((t) => t === 'beta'),
        `Expected "beta" in logs (second_tag). Got:\n${allLogText}`
      ).toBeTruthy()
    })

    // ================================================================
    // STEP 7: Verify all node statuses
    // ================================================================
    await test.step('Verify all nodes show success status', async () => {
      for (const name of ALL_NODE_NAMES) {
        const testId = nodeIds.get(name)!
        const node = page.locator(`[data-testid="${testId}"]`)
        await expect(node).toHaveAttribute(
          'data-execution-status',
          'success'
        )
      }
    })
  })
})
