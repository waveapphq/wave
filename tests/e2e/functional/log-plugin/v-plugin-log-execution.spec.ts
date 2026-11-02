/**
 * Log Plugin End-to-End Execution Test
 *
 * Imports a pre-built workflow fixture with 14 nodes:
 *   - 1 Variable Setter (sets test variables for expression testing)
 *   - 5 Log plugins with explicit levels (DEBUG, INFO, WARN, ERROR, FATAL)
 *   - 1 Log plugin with default level (no level specified - defaults to INFO)
 *   - 4 Log plugins with expression messages (string, integer, float, boolean)
 *   - 1 Log plugin with computed expression (concatenation + arithmetic)
 *   - 1 Log plugin with arithmetic expression (record_count * 2)
 *   - 1 Log plugin with all-vars proof (concatenation of all variable types)
 *
 * Tests:
 *   - Literal messages: static strings logged at all 5 severity levels (DEBUG filtered server-side)
 *   - Default level: omitted level defaults to INFO
 *   - Level metadata: each log entry has correct level attribute (DEBUG/INFO/WARN/ERROR/FATAL)
 *   - Expression messages: variable references resolved to actual values
 *   - Type coercion: integer, float, boolean values coerced to string for display
 *   - Computed expressions: string concatenation with variable interpolation
 *   - Arithmetic expressions: mathematical operations in message expressions
 *   - Variable propagation: all upstream variables accessible in downstream log expressions
 *   - All-vars proof: single log concatenating all 4 variable types
 *
 * REQ: REQ-3.4.1.17 Log plugin
 *
 * Run: ./scripts/e2e-targeted-local.sh functional/log-plugin/v-plugin-log-execution.spec.ts
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { getLogTexts, getLogEntries, getLogLines } from '../../helpers/log-reader'
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
  | 'VARSET_DATA'
  | 'LOG_INFO'
  | 'LOG_DEBUG'
  | 'LOG_WARN'
  | 'LOG_ERROR'
  | 'LOG_FATAL'
  | 'LOG_DEFAULT'
  | 'LOG_EXPR_STRING'
  | 'LOG_EXPR_INT'
  | 'LOG_EXPR_FLOAT'
  | 'LOG_EXPR_BOOL'
  | 'LOG_EXPR_COMPUTED'
  | 'LOG_EXPR_ARITHMETIC'
  | 'LOG_ALL_VARS_PROOF'

const DESCRIPTION_TO_NODE: Record<string, NodeName> = {
  'Set Test Variables': 'VARSET_DATA',
  'Log Literal INFO': 'LOG_INFO',
  'Log Literal DEBUG': 'LOG_DEBUG',
  'Log Literal WARN': 'LOG_WARN',
  'Log Literal ERROR': 'LOG_ERROR',
  'Log Literal FATAL': 'LOG_FATAL',
  'Log Default Level': 'LOG_DEFAULT',
  'Log Expr String': 'LOG_EXPR_STRING',
  'Log Expr Integer': 'LOG_EXPR_INT',
  'Log Expr Float': 'LOG_EXPR_FLOAT',
  'Log Expr Boolean': 'LOG_EXPR_BOOL',
  'Log Expr Computed': 'LOG_EXPR_COMPUTED',
  'Log Expr Arithmetic': 'LOG_EXPR_ARITHMETIC',
  'Log All Vars Proof': 'LOG_ALL_VARS_PROOF',
}

const ALL_NODE_NAMES: NodeName[] = [
  'VARSET_DATA',
  'LOG_INFO',
  'LOG_DEBUG',
  'LOG_WARN',
  'LOG_ERROR',
  'LOG_FATAL',
  'LOG_DEFAULT',
  'LOG_EXPR_STRING',
  'LOG_EXPR_INT',
  'LOG_EXPR_FLOAT',
  'LOG_EXPR_BOOL',
  'LOG_EXPR_COMPUTED',
  'LOG_EXPR_ARITHMETIC',
  'LOG_ALL_VARS_PROOF',
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

test.describe('Log Plugin E2E Execution', () => {
  test('Import fixture, run workflow, verify all log levels, expressions, and type coercion', async ({
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

      // Wait for execution to actually start (async validation + API call before status changes)
      await expect(statusIndicator).not.toHaveAttribute('data-status', 'idle', { timeout: 5_000 })

      // Wait for workflow to finish
      await expect(statusIndicator).not.toHaveAttribute(
        'data-status',
        'running',
        { timeout: 10_000 }
      )

      // Diagnostic: if not passed, dump node statuses and console errors
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
        const errorNodes = nodeStatuses.filter(
          (n) => n.status === 'error'
        )
        const logEntries: string[] = await getLogLines(page)
        const errorLogs = logEntries.filter(
          (e) => e.startsWith('[ERROR]') || e.startsWith('[WARN]')
        )
        console.log('=== WORKFLOW FAILED ===')
        console.log('Failed nodes:', JSON.stringify(failedNodes, null, 2))
        console.log('Error nodes:', JSON.stringify(errorNodes, null, 2))
        console.log('Error/warn logs:', JSON.stringify(errorLogs, null, 2))
      }

      expect(status).toBe('passed')
    })

    // ================================================================
    // STEP 3: Verify literal log messages at visible levels
    // ================================================================
    await test.step('Verify literal log messages at INFO and above', async () => {
      const logTexts = await getLogTexts(page)
      const allLogText = logTexts.join('\n')

      // --- INFO level ---
      expect(
        logTexts.some((t) => t === 'Workflow started successfully'),
        `Expected "Workflow started successfully" in logs (INFO). Got:\n${allLogText}`
      ).toBeTruthy()

      // --- DEBUG level: filtered server-side (default subscription is INFO) ---
      // Node execution is verified in STEP 11 (all nodes succeed).
      // DEBUG entries are stored server-side but not delivered to the client
      // at the default minLevel=INFO WebSocket subscription.

      // --- WARN level ---
      expect(
        logTexts.some((t) => t === 'Resource usage approaching threshold'),
        `Expected "Resource usage approaching threshold" in logs (WARN). Got:\n${allLogText}`
      ).toBeTruthy()

      // --- ERROR level ---
      expect(
        logTexts.some((t) => t === 'Connection pool exhausted'),
        `Expected "Connection pool exhausted" in logs (ERROR). Got:\n${allLogText}`
      ).toBeTruthy()

      // --- FATAL level ---
      expect(
        logTexts.some((t) => t === 'Critical system failure detected'),
        `Expected "Critical system failure detected" in logs (FATAL). Got:\n${allLogText}`
      ).toBeTruthy()
    })

    // ================================================================
    // STEP 4: Verify default level (no level specified)
    // ================================================================
    await test.step('Verify default level defaults to INFO', async () => {
      const entries = await getLogEntries(page)

      // Find the entry with "Message with default level"
      const defaultEntry = entries.find(
        (e) => e.message === 'Message with default level'
      )
      expect(
        defaultEntry,
        `Expected "Message with default level" in log entries`
      ).toBeTruthy()

      // Default level should be INFO
      expect(
        defaultEntry!.level,
        `Expected default level to be "INFO", got "${defaultEntry!.level}"`
      ).toBe('INFO')
    })

    // ================================================================
    // STEP 5: Verify log level metadata on all entries
    // ================================================================
    await test.step('Verify log level metadata on each entry', async () => {
      const entries = await getLogEntries(page)

      // Map of expected message -> expected level
      // Note: DEBUG entries are filtered server-side at default minLevel=INFO,
      // so we only verify levels for entries that reach the client store.
      const expectedLevels: Record<string, string> = {
        'Workflow started successfully': 'INFO',
        'Resource usage approaching threshold': 'WARN',
        'Connection pool exhausted': 'ERROR',
        'Critical system failure detected': 'FATAL',
        'Message with default level': 'INFO',
      }

      for (const [message, expectedLevel] of Object.entries(expectedLevels)) {
        const entry = entries.find((e) => e.message === message)
        expect(
          entry,
          `Expected log entry "${message}" not found`
        ).toBeTruthy()
        expect(
          entry!.level,
          `Expected level "${expectedLevel}" for "${message}", got "${entry!.level}"`
        ).toBe(expectedLevel)
      }
    })

    // ================================================================
    // STEP 6: Verify expression-based messages
    // ================================================================
    await test.step('Verify expression messages with variable references', async () => {
      const logTexts = await getLogTexts(page)
      const allLogText = logTexts.join('\n')

      // --- String variable in expression: "Hello, Alice!" ---
      expect(
        logTexts.some((t) => t === 'Hello, Alice!'),
        `Expected "Hello, Alice!" in logs (string expression). Got:\n${allLogText}`
      ).toBeTruthy()

      // --- Integer variable as message: 42 (coerced to "42") ---
      expect(
        logTexts.some((t) => t === '42'),
        `Expected "42" in logs (integer expression). Got:\n${allLogText}`
      ).toBeTruthy()

      // --- Float variable as message: 99.5 (coerced to "99.5") ---
      expect(
        logTexts.some((t) => t === '99.5'),
        `Expected "99.5" in logs (float expression). Got:\n${allLogText}`
      ).toBeTruthy()

      // --- Boolean variable as message: True (coerced to "True") ---
      expect(
        logTexts.some((t) => t === 'True'),
        `Expected "True" in logs (boolean expression). Got:\n${allLogText}`
      ).toBeTruthy()
    })

    // ================================================================
    // STEP 7: Verify computed expressions
    // ================================================================
    await test.step('Verify computed expression with concatenation', async () => {
      const logTexts = await getLogTexts(page)
      const allLogText = logTexts.join('\n')

      // "Records: 42, Rate: 99.5%"
      expect(
        logTexts.some((t) => t === 'Records: 42, Rate: 99.5%'),
        `Expected "Records: 42, Rate: 99.5%" in logs (computed expression). Got:\n${allLogText}`
      ).toBeTruthy()
    })

    // ================================================================
    // STEP 8: Verify arithmetic expression
    // ================================================================
    await test.step('Verify arithmetic expression in message', async () => {
      const logTexts = await getLogTexts(page)
      const allLogText = logTexts.join('\n')

      // record_count * 2 = 84
      expect(
        logTexts.some((t) => t === '84'),
        `Expected "84" in logs (arithmetic: 42 * 2). Got:\n${allLogText}`
      ).toBeTruthy()
    })

    // ================================================================
    // STEP 9: Verify all-vars proof (all types concatenated)
    // ================================================================
    await test.step('Verify all-vars proof concatenating all types', async () => {
      const logTexts = await getLogTexts(page)
      const allLogText = logTexts.join('\n')

      // "Alice|42|99.5|True"
      expect(
        logTexts.some((t) => t === 'Alice|42|99.5|True'),
        `Expected "Alice|42|99.5|True" all-vars proof in logs. Got:\n${allLogText}`
      ).toBeTruthy()
    })

    // ================================================================
    // STEP 10: Verify expression-level entries have correct levels
    // ================================================================
    await test.step('Verify expression entries have correct log levels', async () => {
      const entries = await getLogEntries(page)

      // Expression nodes with specific levels
      const exprLevels: Record<string, string> = {
        'Hello, Alice!': 'INFO',     // LOG_EXPR_STRING: level=INFO
        '42': 'INFO',               // LOG_EXPR_INT: level=INFO
        '99.5': 'INFO',             // LOG_EXPR_FLOAT: level=INFO
        'True': 'INFO',             // LOG_EXPR_BOOL: level=INFO
        'Records: 42, Rate: 99.5%': 'WARN', // LOG_EXPR_COMPUTED: level=WARN
        '84': 'INFO',               // LOG_EXPR_ARITHMETIC: level=INFO
      }

      for (const [message, expectedLevel] of Object.entries(exprLevels)) {
        const entry = entries.find((e) => e.message === message)
        expect(
          entry,
          `Expected log entry "${message}" not found in entries`
        ).toBeTruthy()
        expect(
          entry!.level,
          `Expected level "${expectedLevel}" for "${message}", got "${entry!.level}"`
        ).toBe(expectedLevel)
      }
    })

    // ================================================================
    // STEP 11: Verify all node statuses
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
