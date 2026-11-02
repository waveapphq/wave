/**
 * Delay Control End-to-End Execution Test
 *
 * Imports a pre-built workflow fixture with 11 nodes:
 *   - 4 Delay controls (basic, expression-based, 2 sequential, minimal)
 *   - 1 Variable Setter (sets dynamic_duration for expression delay)
 *   - 6 Log plugins (verify output bindings and timing)
 *
 * Tests:
 *   - Basic delay execution: 200ms literal duration, non-blocking async sleep
 *   - Output bindings: planned_duration_ms and actual_duration_ms captured as variables
 *   - Actual duration verification: actual_duration_ms >= planned_duration_ms
 *   - Expression-based duration: duration resolved from a variable reference
 *   - Sequential delays: two 100ms delays execute independently in sequence
 *   - Cumulative timing: sequential delay totals verified via log
 *   - Minimal duration: 1ms delay (boundary case, smallest positive integer)
 *   - Delay log messages: "Delay: waiting X ms" and "Wait complete" in console
 *
 * REQ: REQ-3.5.4.1 Configurable delay blocks
 *
 * Run: ./scripts/e2e-targeted-local.sh functional/delay-control/v-control-delay-execution.spec.ts
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
  | 'DELAY_BASIC'
  | 'LOG_BASIC_PLANNED'
  | 'LOG_BASIC_ACTUAL'
  | 'VARSET_DURATION'
  | 'DELAY_EXPRESSION'
  | 'LOG_EXPR_PLANNED'
  | 'DELAY_SEQ_A'
  | 'DELAY_SEQ_B'
  | 'LOG_SEQ_PROOF'
  | 'DELAY_MINIMAL'
  | 'LOG_MIN_PLANNED'

const DESCRIPTION_TO_NODE: Record<string, NodeName> = {
  'Basic Delay 200ms': 'DELAY_BASIC',
  'Log Basic Planned': 'LOG_BASIC_PLANNED',
  'Log Basic Actual': 'LOG_BASIC_ACTUAL',
  'Set Duration Variable': 'VARSET_DURATION',
  'Delay From Expression': 'DELAY_EXPRESSION',
  'Log Expr Planned': 'LOG_EXPR_PLANNED',
  'Sequential Delay A': 'DELAY_SEQ_A',
  'Sequential Delay B': 'DELAY_SEQ_B',
  'Log Sequential Proof': 'LOG_SEQ_PROOF',
  'Minimal Delay 1ms': 'DELAY_MINIMAL',
  'Log Minimal Planned': 'LOG_MIN_PLANNED',
}

const ALL_NODE_NAMES: NodeName[] = [
  'DELAY_BASIC',
  'LOG_BASIC_PLANNED',
  'LOG_BASIC_ACTUAL',
  'VARSET_DURATION',
  'DELAY_EXPRESSION',
  'LOG_EXPR_PLANNED',
  'DELAY_SEQ_A',
  'DELAY_SEQ_B',
  'LOG_SEQ_PROOF',
  'DELAY_MINIMAL',
  'LOG_MIN_PLANNED',
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

test.describe('Delay Control E2E Execution', () => {
  test('Import fixture, run workflow, verify delay execution, output bindings, and timing', async ({
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

      // Wait for workflow to finish - delays add up (~650ms total)
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
    // STEP 3: Verify basic delay output bindings
    // ================================================================
    await test.step('Verify basic delay output bindings (planned and actual)', async () => {
      const logTexts = await getLogTexts(page)
      const allLogText = logTexts.join('\n')

      // --- planned_duration_ms = 200 ---
      expect(
        logTexts.some((t) => t === 'planned=200'),
        `Expected "planned=200" in logs (basic delay planned). Got:\n${allLogText}`
      ).toBeTruthy()

      // --- actual_duration_ms >= 190 (allow timing jitter from OS scheduling) ---
      const actualMatch = logTexts.find((t) => t.startsWith('actual='))
      expect(
        actualMatch,
        `Expected "actual=<number>" in logs (basic delay actual). Got:\n${allLogText}`
      ).toBeTruthy()

      const actualMs = parseInt(actualMatch!.replace('actual=', ''), 10)
      expect(
        actualMs >= 190,
        `Expected actual_duration_ms >= 190, got ${actualMs}`
      ).toBeTruthy()
    })

    // ================================================================
    // STEP 4: Verify expression-based delay
    // ================================================================
    await test.step('Verify expression-based delay (duration from variable)', async () => {
      const logTexts = await getLogTexts(page)
      const allLogText = logTexts.join('\n')

      // dynamic_duration was set to 150, so planned should be 150
      expect(
        logTexts.some((t) => t === 'expr_planned=150'),
        `Expected "expr_planned=150" in logs (expression delay). Got:\n${allLogText}`
      ).toBeTruthy()
    })

    // ================================================================
    // STEP 5: Verify sequential delays
    // ================================================================
    await test.step('Verify sequential delays cumulative timing', async () => {
      const logTexts = await getLogTexts(page)
      const allLogText = logTexts.join('\n')

      // Two 100ms delays - seq_total should be >= 190 (allow timing jitter from OS scheduling)
      const seqMatch = logTexts.find((t) => t.startsWith('seq_total='))
      expect(
        seqMatch,
        `Expected "seq_total=<number>" in logs (sequential proof). Got:\n${allLogText}`
      ).toBeTruthy()

      const seqTotal = parseInt(seqMatch!.replace('seq_total=', ''), 10)
      expect(
        seqTotal >= 190,
        `Expected cumulative sequential delay >= 190ms, got ${seqTotal}ms`
      ).toBeTruthy()
    })

    // ================================================================
    // STEP 6: Verify minimal delay (1ms boundary)
    // ================================================================
    await test.step('Verify minimal 1ms delay executes', async () => {
      const logTexts = await getLogTexts(page)
      const allLogText = logTexts.join('\n')

      // planned_duration_ms should be 1
      expect(
        logTexts.some((t) => t === 'min_planned=1'),
        `Expected "min_planned=1" in logs (minimal delay). Got:\n${allLogText}`
      ).toBeTruthy()
    })

    // ================================================================
    // STEP 7: Verify delay system log messages
    // ================================================================
    await test.step('Verify delay system log messages in console', async () => {
      const logTexts = await getLogTexts(page)
      const allLogText = logTexts.join('\n')

      // Delay control logs "Delay: waiting X ms" for each delay node
      expect(
        logTexts.some((t) => t === 'Delay: waiting 200 ms'),
        `Expected "Delay: waiting 200 ms" in logs. Got:\n${allLogText}`
      ).toBeTruthy()

      expect(
        logTexts.some((t) => t === 'Delay: waiting 150 ms'),
        `Expected "Delay: waiting 150 ms" in logs (expression delay). Got:\n${allLogText}`
      ).toBeTruthy()

      // Two "Delay: waiting 100 ms" for sequential delays
      const waiting100 = logTexts.filter((t) => t === 'Delay: waiting 100 ms')
      expect(
        waiting100.length >= 2,
        `Expected at least 2 "Delay: waiting 100 ms" entries (sequential delays). Got ${waiting100.length}:\n${allLogText}`
      ).toBeTruthy()

      expect(
        logTexts.some((t) => t === 'Delay: waiting 1 ms'),
        `Expected "Delay: waiting 1 ms" in logs (minimal delay). Got:\n${allLogText}`
      ).toBeTruthy()

      // "Wait complete" messages should exist for each delay
      const waitComplete = logTexts.filter((t) => t.startsWith('Wait complete'))
      expect(
        waitComplete.length >= 4,
        `Expected at least 4 "Wait complete" entries (4 delay nodes). Got ${waitComplete.length}:\n${allLogText}`
      ).toBeTruthy()
    })

    // ================================================================
    // STEP 8: Verify all node statuses
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
