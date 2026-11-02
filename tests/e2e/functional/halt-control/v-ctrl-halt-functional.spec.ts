/**
 * V-CTRL-HALT-01: Halt Control End-to-End Execution Test
 *
 * Imports a pre-built workflow fixture with 3 nodes (1 Log + 1 Halt + 1 Log),
 * then runs it to verify halt terminates execution and skips downstream nodes.
 *
 * Workflow structure:
 *   Start -> Log Before Halt -> Halt (Stop Execution) -> Log After Halt
 *
 * The Halt node terminates execution. The "Log After Halt" node must NOT execute.
 *
 * Coverage:
 *   - Halt with status=failed: session fails, halt node=failed
 *   - Halt with status=passed: session passes, halt node=success
 *   - Halt with status=skipped: session=skipped, halt node=warning
 *   - Halt with status=skipped: the amber Block badges SKIP, never WARN
 *   - Log output: pre-halt log present, post-halt log absent
 *   - Halt message appears in execution log at correct severity
 *   - Halt without message: graceful handling
 *
 * REQ: REQ-3.5.1.4 (Halt block), REQ-3.5.1.14 (Halt scope configuration)
 * Design Decisions: Decision 1 (no output handle), Decision 6 (post-halt nodes), Decision 8 (halt signal)
 *
 * Run manually with: ./scripts/e2e-targeted-local.sh functional/halt-control/v-ctrl-halt-functional.spec.ts
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

function loadFixture(overrides?: {
  status?: string
  message?: string | null
  name?: string
}): Record<string, any> {
  const raw = fs.readFileSync(
    path.resolve(__dirname, 'fixture.json'),
    'utf-8'
  )
  const fixture = JSON.parse(raw)

  if (overrides?.name) {
    fixture.name = overrides.name
  }

  if (overrides?.status !== undefined || overrides?.message !== undefined) {
    const haltNode = fixture.workflow.nodes.find(
      (n: any) => n.id === 'halt-stop'
    )
    if (overrides.status !== undefined) {
      haltNode.data.config.values.status = overrides.status
    }
    if (overrides.message !== undefined) {
      if (overrides.message === null) {
        delete haltNode.data.config.values.message
      } else {
        haltNode.data.config.values.message = overrides.message
      }
    }
  }

  return fixture
}

// ---------------------------------------------------------------------------
// Node name mapping
// ---------------------------------------------------------------------------

type NodeName = 'LOG_BEFORE' | 'HALT_STOP' | 'LOG_AFTER'

const DESCRIPTION_TO_NODE: Record<string, NodeName> = {
  'Log Before Halt': 'LOG_BEFORE',
  'Stop Execution': 'HALT_STOP',
  'Log After Halt': 'LOG_AFTER',
}

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

function buildNodeIds(fixture: Record<string, any>): Map<NodeName, string> {
  const nodeIds = new Map<NodeName, string>()
  for (const node of fixture.workflow.nodes) {
    const displayName = node.data?.description
    const nodeName = DESCRIPTION_TO_NODE[displayName]
    if (nodeName) {
      nodeIds.set(nodeName, `workflow-node-${node.id}`)
    }
  }
  return nodeIds
}

async function importAndNavigate(
  page: Page,
  fixture: Record<string, any>,
) {
  // Clear any existing session
  await page.request
    .delete(`http://localhost:${BACKEND_PORT}/workbench/session/`)
    .catch(() => {})

  // Ensure shared environment exists
  await ensureEnvironment(page.request)

  // Import test fixture
  const createResponse = await page.request.post(
    `http://localhost:${BACKEND_PORT}/tests`,
    { data: fixture }
  )
  expect(
    createResponse.ok(),
    `POST /tests failed: ${createResponse.status()}`
  ).toBeTruthy()

  const created = await createResponse.json()
  const testId = created.data?.id || created.id

  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)

  return testId
}

async function runWorkflow(page: Page) {
  await selectEnvironment(page, E2E_ENV_NAME)

  const runButton = page.locator('[data-testid="run-button"]')
  await runButton.click()

  const statusIndicator = page.locator('[data-testid="workflow-status"]')

  // Wait for execution to start
  await expect(statusIndicator).not.toHaveAttribute('data-status', 'idle', { timeout: 5_000 })

  // Wait for execution to finish (not running anymore)
  await expect(statusIndicator).not.toHaveAttribute('data-status', 'running', {
    timeout: 10_000,
  })

  return statusIndicator
}

function dumpDiagnostics(
  status: string | null,
  nodeStatuses: Array<{ testId: string | null; status: string | null; name: string | null }>,
  logEntries: string[]
) {
  const failedNodes = nodeStatuses.filter((n) => n.status === 'failed')
  const errorLogs = logEntries.filter((e) => e.startsWith('[ERROR]') || e.startsWith('[WARN]'))
  test.info().annotations.push({ type: 'workflow-status', description: status ?? 'null' })
  test.info().annotations.push({ type: 'failed-nodes', description: JSON.stringify(failedNodes) })
  test.info().annotations.push({ type: 'error-logs', description: JSON.stringify(errorLogs) })
}

async function getNodeStatuses(page: Page) {
  return page.evaluate(() => {
    const nodes = document.querySelectorAll('[data-testid^="workflow-node-"]')
    return Array.from(nodes).map((n) => ({
      testId: n.getAttribute('data-testid'),
      status: n.getAttribute('data-execution-status'),
      name: n.querySelector('[class*="description"], [class*="name"]')?.textContent
        || n.textContent?.substring(0, 80) || null,
    }))
  })
}



// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Halt Control E2E Execution', () => {
  // ================================================================
  // Test 1: Halt with status=failed
  // ================================================================

  test('halt status=failed - stops execution, fails session, skips downstream', async ({ page }) => {
    const fixture = loadFixture({
      status: 'failed',
      message: 'stopping execution',
      name: 'Halt E2E - status=failed',
    })
    const nodeIds = buildNodeIds(fixture)


    // Verify all nodes mapped correctly
    for (const name of ['LOG_BEFORE', 'HALT_STOP', 'LOG_AFTER'] as NodeName[]) {
      expect(nodeIds.has(name), `Node "${name}" not found in fixture`).toBeTruthy()
    }

    // STEP 1: Import and navigate
    await test.step('Import test via API', async () => {
      await importAndNavigate(page, fixture)
    })

    // STEP 2: Run workflow
    await test.step('Run workflow', async () => {
      const statusIndicator = await runWorkflow(page)
      const status = await statusIndicator.getAttribute('data-status')

      // Diagnostic dump if unexpected status
      if (status !== 'failed') {
        const nodeStatuses = await getNodeStatuses(page)
        const logEntries = await getLogLines(page)
        dumpDiagnostics(status, nodeStatuses, logEntries)
      }

      // Workflow should fail (halt with status=failed)
      expect(status).toBe('failed')
    })

    // STEP 3: Verify console output
    await test.step('Verify console log messages', async () => {
      const logTexts = await getLogTexts(page)
      const allLogText = logTexts.join('\n')

      // Pre-halt log should have executed
      expect(
        logTexts.some((t) => t.includes('before-halt-executed')),
        `Expected "before-halt-executed" in logs (proves pre-halt block ran). Got:\n${allLogText}`
      ).toBeTruthy()

      // Post-halt log should NOT have executed
      expect(
        logTexts.some((t) => t.includes('should-not-run')),
        'Post-halt Log should NOT have executed (halt terminates execution)'
      ).toBeFalsy()

      // Halt message should appear in logs
      expect(
        logTexts.some((t) => t.includes('stopping execution')),
        `Expected halt message "stopping execution" in logs. Got:\n${allLogText}`
      ).toBeTruthy()
    })

    // STEP 4: Verify node execution statuses
    await test.step('Verify node execution statuses', async () => {
      // Log Before Halt should have succeeded
      const logBefore = page.locator(`[data-testid="${nodeIds.get('LOG_BEFORE')}"]`)
      await expect(
        logBefore,
        'Log Before Halt should have execution status "success"'
      ).toHaveAttribute('data-execution-status', 'success')

      // Halt node should show "failed" status
      const haltNode = page.locator(`[data-testid="${nodeIds.get('HALT_STOP')}"]`)
      await expect(
        haltNode,
        'Halt node should have execution status "failed"'
      ).toHaveAttribute('data-execution-status', 'failed')

      // Log After Halt should NOT have "success" status (should be skipped or no status)
      const logAfter = page.locator(`[data-testid="${nodeIds.get('LOG_AFTER')}"]`)
      const logAfterStatus = await logAfter.getAttribute('data-execution-status')
      expect(
        logAfterStatus,
        `Log After Halt should NOT have been executed (got status "${logAfterStatus}")`
      ).not.toBe('success')
    })
  })

  // ================================================================
  // Test 2: Halt with status=passed
  // ================================================================

  test('halt status=passed - stops execution, passes session', async ({ page }) => {
    const fixture = loadFixture({
      status: 'passed',
      message: 'intentional stop',
      name: 'Halt E2E - status=passed',
    })
    const nodeIds = buildNodeIds(fixture)


    await test.step('Import test via API', async () => {
      await importAndNavigate(page, fixture)
    })

    await test.step('Run workflow', async () => {
      const statusIndicator = await runWorkflow(page)
      const status = await statusIndicator.getAttribute('data-status')

      if (status !== 'passed') {
        const nodeStatuses = await getNodeStatuses(page)
        const logEntries = await getLogLines(page)
        dumpDiagnostics(status, nodeStatuses, logEntries)
      }

      // Workflow should pass (halt with status=passed)
      expect(status).toBe('passed')
    })

    await test.step('Verify node execution statuses', async () => {
      // Log Before Halt should have succeeded
      const logBefore = page.locator(`[data-testid="${nodeIds.get('LOG_BEFORE')}"]`)
      await expect(logBefore).toHaveAttribute('data-execution-status', 'success')

      // Halt node should show "success" (status=passed maps to success)
      const haltNode = page.locator(`[data-testid="${nodeIds.get('HALT_STOP')}"]`)
      await expect(haltNode).toHaveAttribute('data-execution-status', 'success')

      // Log After Halt should NOT have executed
      const logAfter = page.locator(`[data-testid="${nodeIds.get('LOG_AFTER')}"]`)
      const logAfterStatus = await logAfter.getAttribute('data-execution-status')
      expect(logAfterStatus).not.toBe('success')
    })

    await test.step('Verify downstream log did not execute', async () => {
      const logTexts = await getLogTexts(page)

      expect(
        logTexts.some((t) => t.includes('before-halt-executed')),
        'Pre-halt log should have executed'
      ).toBeTruthy()

      expect(
        logTexts.some((t) => t.includes('should-not-run')),
        'Post-halt log should NOT have executed'
      ).toBeFalsy()
    })
  })

  // ================================================================
  // Test 3: Halt with status=skipped
  // ================================================================

  test('halt status=skipped - stops execution with warning', async ({ page }) => {
    const fixture = loadFixture({
      status: 'skipped',
      message: 'conditional bypass',
      name: 'Halt E2E - status=skipped',
    })
    const nodeIds = buildNodeIds(fixture)


    await test.step('Import test via API', async () => {
      await importAndNavigate(page, fixture)
    })

    await test.step('Run workflow', async () => {
      const statusIndicator = await runWorkflow(page)
      const status = await statusIndicator.getAttribute('data-status')

      if (status !== 'skipped') {
        const nodeStatuses = await getNodeStatuses(page)
        const logEntries = await getLogLines(page)
        dumpDiagnostics(status, nodeStatuses, logEntries)
      }

      // Workflow should show skipped status (halt with status=skipped)
      expect(status).toBe('skipped')
    })

    await test.step('Verify node execution statuses', async () => {
      // Log Before Halt should have succeeded
      const logBefore = page.locator(`[data-testid="${nodeIds.get('LOG_BEFORE')}"]`)
      await expect(logBefore).toHaveAttribute('data-execution-status', 'success')

      // Halt node should show "warning" (status=skipped maps to warning)
      const haltNode = page.locator(`[data-testid="${nodeIds.get('HALT_STOP')}"]`)
      await expect(haltNode).toHaveAttribute('data-execution-status', 'warning')

      // Log After Halt should NOT have executed
      const logAfter = page.locator(`[data-testid="${nodeIds.get('LOG_AFTER')}"]`)
      const logAfterStatus = await logAfter.getAttribute('data-execution-status')
      expect(logAfterStatus).not.toBe('success')
    })

    await test.step('Verify downstream log did not execute', async () => {
      const logTexts = await getLogTexts(page)

      expect(
        logTexts.some((t) => t.includes('should-not-run')),
        'Post-halt log should NOT have executed'
      ).toBeFalsy()
    })
  })

  // ================================================================
  // Test 3b: Halt keeps the SKIP badge on its amber status
  // ================================================================

  test('halt status=skipped - amber Block reads SKIP, never WARN', async ({ page }) => {
    const fixture = loadFixture({
      status: 'skipped',
      message: 'conditional bypass',
      name: 'Halt E2E - skipped badge',
    })
    const nodeIds = buildNodeIds(fixture)

    await test.step('Import test via API', async () => {
      await importAndNavigate(page, fixture)
    })

    await test.step('Run workflow', async () => {
      const statusIndicator = await runWorkflow(page)
      expect(await statusIndicator.getAttribute('data-status')).toBe('skipped')
    })

    await test.step('The amber Halt Block carries SKIP, not the WARN badge', async () => {
      const haltNode = page.locator(`[data-testid="${nodeIds.get('HALT_STOP')}"]`)
      await expect(haltNode).toHaveAttribute('data-execution-status', 'warning')

      // Halt is the one amber Block that reads SKIP (REQ-3.5.1.14).
      const badge = haltNode.locator('[data-testid="node-run-state-badge"]')
      await expect(badge).toHaveAttribute('data-state', 'skip')
      await expect(badge).toHaveText('SKIP')
    })
  })

  // ================================================================
  // Test 4: Halt without message
  // ================================================================

  test('halt without message - executes cleanly', async ({ page }) => {
    const fixture = loadFixture({
      status: 'failed',
      message: null, // No message
      name: 'Halt E2E - no message',
    })
    const nodeIds = buildNodeIds(fixture)


    await test.step('Import test via API', async () => {
      await importAndNavigate(page, fixture)
    })

    await test.step('Run workflow and verify completion', async () => {
      const statusIndicator = await runWorkflow(page)
      const status = await statusIndicator.getAttribute('data-status')

      // Should complete (failed because status=failed, but no crash)
      expect(status).toBe('failed')
    })

    await test.step('Verify halt node executed without error', async () => {
      // Halt node should have a definite execution status (not stuck in running)
      const haltNode = page.locator(`[data-testid="${nodeIds.get('HALT_STOP')}"]`)
      await expect(haltNode).toHaveAttribute('data-execution-status', 'failed')
    })

    await test.step('Verify downstream is not executed', async () => {
      const logTexts = await getLogTexts(page)

      expect(
        logTexts.some((t) => t.includes('before-halt-executed')),
        'Pre-halt log should have executed'
      ).toBeTruthy()

      expect(
        logTexts.some((t) => t.includes('should-not-run')),
        'Post-halt log should NOT have executed'
      ).toBeFalsy()
    })
  })
})
