/**
 * V-CTRL-IFELSE-FUNCTIONAL: If/Else Control End-to-End Execution Test
 *
 * Single workflow with five chained If/Else blocks covering all branch types:
 *   3-branch (IF / ELSE IF / ELSE):
 *     C1: transport="TCP"  -> IF branch taken
 *     C2: transport="UDP"  -> ELSE IF branch taken
 *     C3: transport="SCTP" -> ELSE branch taken
 *   2-branch (IF / ELSE only):
 *     C4: transport="TCP"  -> IF branch taken
 *     C5: transport="SCTP" -> ELSE branch taken
 *
 * Each active branch chains to the next VarSetter; inactive branches are dead ends.
 * Imported once, run once, all markers verified in one pass.
 *
 * REQ: REQ-3.5.1 (If/Else control)
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { getLogTexts, getLogLines } from '../../helpers/log-reader'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'
import fs from 'fs'
import path from 'path'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadFixture(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixture.json'), 'utf-8'))
}

async function selectEnvironment(page: Page, envName: string) {
  await page.locator('[data-testid="environment-selector"]').click()
  const popover = page.locator('[data-testid="environment-popover"]')
  await expect(popover).toBeVisible()
  await popover.locator(`button:has-text("${envName}")`).first().click()
  await expect(popover).not.toBeVisible()
}



async function getNodeStatuses(page: Page) {
  return page.evaluate(() => {
    const nodes = document.querySelectorAll('[data-testid^="workflow-node-"]')
    return Array.from(nodes).map((n) => ({
      testId: n.getAttribute('data-testid'),
      status: n.getAttribute('data-execution-status'),
      name: n.textContent?.substring(0, 80) || null,
    }))
  })
}

function dumpDiagnostics(
  status: string | null,
  nodeStatuses: Array<{ testId: string | null; status: string | null; name: string | null }>,
  logEntries: string[]
) {
  test.info().annotations.push({ type: 'workflow-status', description: status ?? 'null' })
  test.info().annotations.push({ type: 'node-statuses', description: JSON.stringify(nodeStatuses) })
  test.info().annotations.push({
    type: 'error-logs',
    description: JSON.stringify(logEntries.filter((e) => e.startsWith('[ERROR]') || e.startsWith('[WARN]'))),
  })
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

test.describe('If/Else Control E2E Execution', () => {

  test('All branch types: 3-branch IF/ELIF/ELSE + 2-branch IF/ELSE (C1-C5)', async ({ page }) => {
    const fixture = loadFixture()

    // Ensure shared environment exists
    await page.request.delete(`http://localhost:${BACKEND_PORT}/workbench/session/`).catch(() => {})
    await ensureEnvironment(page.request)

    const createResp = await page.request.post(`http://localhost:${BACKEND_PORT}/tests`, { data: fixture })
    const createBody = await createResp.json().catch(() => null)
    expect(createResp.ok(), `POST /tests failed: ${createResp.status()} - ${JSON.stringify(createBody)}`).toBeTruthy()
    const testId = createBody.data?.id || createBody.id

    // Navigate
    await page.goto(`/workbench?editTest=${testId}`)
    await page.evaluate(() => localStorage.clear())
    await page.goto(`/workbench?editTest=${testId}`)
    await waitForCanvasLoad(page)

    // Run
    await selectEnvironment(page, E2E_ENV_NAME)
    await page.locator('[data-testid="run-button"]').click()
    const status = page.locator('[data-testid="workflow-status"]')
    await expect(status).not.toHaveAttribute('data-status', 'idle', { timeout: 5_000 })
    await expect(status).not.toHaveAttribute('data-status', 'running', { timeout: 15_000 })

    const statusVal = await status.getAttribute('data-status')
    if (statusVal !== 'passed') dumpDiagnostics(statusVal, await getNodeStatuses(page), await getLogLines(page))
    expect(statusVal).toBe('passed')

    // Collect logs once
    const logs = await getLogTexts(page)
    const all = logs.join('\n')

    const assertPresent = (marker: string) =>
      expect(logs.some((t) => t.includes(marker)), `Expected "${marker}" in logs.\n${all}`).toBeTruthy()
    const assertAbsent = (marker: string) =>
      expect(logs.some((t) => t.includes(marker)), `"${marker}" should NOT be in logs`).toBeFalsy()

    // Bookends
    assertPresent('before-all')
    assertPresent('after-all')

    // C1: transport="TCP" -> IF branch taken
    await test.step('C1: IF branch taken (transport=TCP)', () => {
      assertPresent('c1-tcp')
      assertAbsent('c1-udp')
      assertAbsent('c1-other')
    })

    // C2: transport="UDP" -> ELSE IF branch taken
    await test.step('C2: ELSE IF branch taken (transport=UDP)', () => {
      assertPresent('c2-udp')
      assertAbsent('c2-tcp')
      assertAbsent('c2-other')
    })

    // C3: transport="SCTP" -> ELSE branch taken
    await test.step('C3: ELSE branch taken (transport=SCTP)', () => {
      assertPresent('c3-other')
      assertAbsent('c3-tcp')
      assertAbsent('c3-udp')
    })

    // C4: 2-branch IF/ELSE, transport="TCP" -> IF branch taken
    await test.step('C4: 2-branch IF taken (transport=TCP)', () => {
      assertPresent('c4-if')
      assertAbsent('c4-else')
    })

    // C5: 2-branch IF/ELSE, transport="SCTP" -> ELSE branch taken
    await test.step('C5: 2-branch ELSE taken (transport=SCTP)', () => {
      assertPresent('c5-else')
      assertAbsent('c5-if')
    })
  })
})
