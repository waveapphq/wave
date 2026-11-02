/**
 * V-CONSOLE-LOG-LEVEL-FUNCTIONAL: console log-level accumulation
 *
 * The console log-level dropdown is a CLIENT-SIDE filter over accumulated
 * entries: changing the level never wipes an entry. This accumulates logs across
 * three ad-hoc runs (INFO, WARN, INFO), then flips the level:
 *
 *   default INFO -> all three markers visible
 *   WARN         -> only the WARN marker visible; the two INFO markers filtered
 *                   out but NOT wiped
 *   back to INFO -> all three markers reappear (including the FIRST run's, whose
 *                   session is not re-subscribed - proving entries were kept, not
 *                   re-fetched)
 *
 * REQ: REQ-3.2.2 (console)
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { getLogTexts } from '../../helpers/log-reader'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'
import { randomUUID } from 'node:crypto'
import fs from 'fs'
import path from 'path'

const A = 'H-A-info marker'
const B = 'H-B-warn marker'
const C = 'H-C-info marker'

function loadFixture(): Record<string, any> {
  const fixture = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixture.json'), 'utf-8'))
  fixture.name = `${fixture.name} ${randomUUID().slice(0, 8)}`
  return fixture
}

async function selectEnvironment(page: Page) {
  await page.locator('[data-testid="environment-selector"]').click()
  const popover = page.locator('[data-testid="environment-popover"]')
  await expect(popover).toBeVisible()
  await popover.locator(`button:has-text("${E2E_ENV_NAME}")`).first().click()
  await expect(popover).not.toBeVisible()
}

async function runCurrent(page: Page, nodeId: string) {
  const node = page.locator(`[data-testid="workflow-node-${nodeId}"]`)
  await expect(node).toBeVisible()
  await node.click({ button: 'right' })
  const menu = page.locator('[role="menu"]')
  await expect(menu).toBeVisible()
  await menu.locator('[role="menuitem"]').filter({ hasText: 'Run Current' }).click()
  await expect(menu).not.toBeVisible()
  await expect(page.locator('[data-testid="workflow-status"]')).toHaveAttribute('data-status', 'passed', { timeout: 20_000 })
}

async function setLogLevel(page: Page, level: 'INFO' | 'WARN') {
  await page.locator('[aria-label="Minimum log level"]').click()
  await page.getByRole('option', { name: level, exact: true }).click()
}

test.describe('Console log-level accumulation (H)', () => {
  test('changing the log level filters, never wipes, accumulated entries', async ({ page }) => {
    const fixture = loadFixture()

    await page.request.delete(`http://localhost:${BACKEND_PORT}/workbench/session/`).catch(() => {})
    await ensureEnvironment(page.request)
    const createResp = await page.request.post(`http://localhost:${BACKEND_PORT}/tests`, { data: fixture })
    const createBody = await createResp.json().catch(() => null)
    expect(createResp.ok(), `POST /tests failed: ${createResp.status()} - ${JSON.stringify(createBody)}`).toBeTruthy()
    const testId = createBody.data?.id || createBody.id

    await page.goto(`/workbench?editTest=${testId}`)
    await page.evaluate(() => localStorage.clear())
    await page.goto(`/workbench?editTest=${testId}`)
    await waitForCanvasLoad(page)
    await selectEnvironment(page)

    // Three separate ad-hoc runs accumulate in the console (distinct sessions).
    await runCurrent(page, 'log-a')
    await runCurrent(page, 'log-b')
    await runCurrent(page, 'log-c')

    await test.step('default INFO: all three runs visible', async () => {
      const logs = await getLogTexts(page)
      const all = logs.join('\n')
      expect(logs.some((t) => t.includes(A)), `run A missing.\n${all}`).toBeTruthy()
      expect(logs.some((t) => t.includes(B)), `run B missing.\n${all}`).toBeTruthy()
      expect(logs.some((t) => t.includes(C)), `run C missing.\n${all}`).toBeTruthy()
    })

    await test.step('WARN: only the WARN marker shows, INFO markers filtered out (not wiped)', async () => {
      await setLogLevel(page, 'WARN')
      await expect
        .poll(async () => (await getLogTexts(page)).some((t) => t.includes(A)), { timeout: 5_000 })
        .toBe(false)
      const logs = await getLogTexts(page)
      const all = logs.join('\n')
      expect(logs.some((t) => t.includes(B)), `the WARN marker must remain.\n${all}`).toBeTruthy()
      expect(logs.some((t) => t.includes(C)), `the INFO markers must be filtered out.\n${all}`).toBeFalsy()
    })

    await test.step('back to INFO: every earlier run reappears (entries were kept)', async () => {
      await setLogLevel(page, 'INFO')
      await expect
        .poll(async () => (await getLogTexts(page)).some((t) => t.includes(A)), { timeout: 5_000 })
        .toBe(true)
      const logs = await getLogTexts(page)
      const all = logs.join('\n')
      expect(logs.some((t) => t.includes(A)), `run A must reappear (kept, not wiped).\n${all}`).toBeTruthy()
      expect(logs.some((t) => t.includes(B)), `run B must reappear.\n${all}`).toBeTruthy()
      expect(logs.some((t) => t.includes(C)), `run C must reappear.\n${all}`).toBeTruthy()
    })
  })
})
