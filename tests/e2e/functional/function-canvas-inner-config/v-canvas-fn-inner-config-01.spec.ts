/**
 * V-CANVAS-FN-INNER-CONFIG-01: Inner-Function plugin config modal opens, edits, persists
 *
 * Wireframes: none (existing config modal surface).
 * Design Decisions: none (REQ-3.1.1.4: canvas swap; save persists nested content)
 * REQ: REQ-3.1.1.4 (nested block composition)
 *
 * `use-config-modal` lookup and save paths walk the active subtree, so the gear opens
 * the inner config, and inner nodes do not render as isUnreachable.
 *
 * Phase: functional-workflow.
 *
 * Pass Criteria:
 *   1. Drilling into Function_1 reveals the inner Log node with its label.
 *   2. Opening the inner Log node's config (via the gear button) shows the
 *      ElementConfigModal populated with the seeded `message` expression value
 *      (not empty, not pointing at a different node).
 *   3. Editing the message and clicking Save closes the modal.
 *   4. After saving the Test and reloading, drilling back in shows the new
 *      message value in the same modal.
 */

import { test, expect, type Page, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT } from '../../helpers/config'
import { configSheet, openBlockSheet } from '../../helpers/workbench'
import fs from 'fs'
import path from 'path'

const BASE = `http://localhost:${BACKEND_PORT}`

function loadFixture(): Record<string, unknown> {
  const fixture = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixture.json'), 'utf-8'))
  return { ...fixture, name: `V-CANVAS-FN-INNER-CONFIG-01 ${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }
}

async function seedFixture(request: APIRequestContext): Promise<string> {
  const resp = await request.post(`${BASE}/tests`, { data: loadFixture() })
  const body = await resp.json().catch(() => null)
  expect(body?.success === true, `POST /tests failed: ${resp.status()} - ${JSON.stringify(body)}`).toBeTruthy()
  return body.data.id
}

async function openTest(page: Page, testId: string) {
  await page.request.delete(`${BASE}/workbench/session`).catch(() => {})
  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)
}

async function drillIn(page: Page) {
  await page.locator('[data-testid="workflow-node-fn-1"] [data-testid="node-dig-in"]').click()
  await expect(page.locator('[data-testid="workflow-node-inner-log"]')).toBeVisible()
}

async function openInnerLogConfig(page: Page) {
  const innerLog = page.locator('[data-testid="workflow-node-inner-log"]')
  // Select the node so the action cluster is interactive.
  await innerLog.locator('button').first().dispatchEvent('click')
  await openBlockSheet(page, 'inner-log')
}

test.describe('V-CANVAS-FN-INNER-CONFIG-01: inner-Function plugin config modal', () => {
  test('config modal opens with the inner Log values and persists edits', async ({ page, request }) => {
    const testId = await seedFixture(request)
    await openTest(page, testId)

    await drillIn(page)
    // Inner Block config opens: the gear click below must not no-op.
    await openInnerLogConfig(page)

    // ElementConfigModal is open with the inner Log's pre-seeded message.
    // The message field is an expression-mode CodeMirror editor; its value
    // surfaces as the editor's text content rather than an HTMLInputElement
    // value property, so we assert via the .cm-content node.
    const messageField = page.locator('[data-testid="param-input-message"]')
    await expect(messageField).toBeVisible()
    const messageEditor = messageField.locator('.cm-content').first()
    await expect(messageEditor).toContainText("'hello before'")

    // Edit + save.
    await messageEditor.click()
    await page.keyboard.press('Control+a')
    await page.keyboard.type("'hello after'")
    await configSheet(page).getByRole('button', { name: 'Save', exact: true }).click()

    // Save the Test.
    const saveBtn = page.locator('[data-testid="toolbar-save-button"]')
    await expect(saveBtn).toBeEnabled()
    await saveBtn.click()
    await expect(saveBtn).toBeDisabled({ timeout: 10_000 })

    // Reload from scratch and drill back in.
    await openTest(page, testId)
    await drillIn(page)
    await openInnerLogConfig(page)

    const reopenedField = page.locator('[data-testid="param-input-message"]')
    await expect(reopenedField).toBeVisible()
    await expect(reopenedField.locator('.cm-content').first()).toContainText("'hello after'")
  })
})
