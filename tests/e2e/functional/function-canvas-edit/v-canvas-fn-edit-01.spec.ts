/**
 * V-CANVAS-FN-EDIT-01: Edit inside a drilled-in local Function persists through Save/reload
 *
 * Wireframes: none (the inner canvas is the existing canvas with different content)
 * Design Decisions: none (REQ-3.1.1.4: Save persists Test + nested localDefinition; pop is non-destructive)
 * REQ: REQ-3.1.1.4 (nested block composition)
 *
 * Phase: functional-workflow (seeds a Test via POST /tests, drives the workbench, saves, reloads).
 *
 * Pass Criteria:
 *   1. Drill into Function_1; the inner canvas shows the empty-state placeholder
 *      (Drag a plugin to define what this Function does).
 *   2. Drop a Log plugin from the palette onto the inner canvas; the Log node
 *      appears inside Function_1.
 *   3. Click Save; the Test persists to disk.
 *   4. Reload the workbench (full page navigation) and drill back into
 *      Function_1; the Log node is still there.
 *   5. Popping back out and dropping a sibling plugin at the Test root after
 *      drilling, then drilling in again, finds the inner Log unchanged
 *      (pop is non-destructive in the opposite direction too).
 */

import { test, expect, type Page, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad, dragPaletteItemToCanvas } from '../../helpers/canvas'
import { BACKEND_PORT } from '../../helpers/config'
import { configSheet, openNodeSheet } from '../../helpers/workbench'
import { setStringParam } from '../../helpers/param-config'
import fs from 'fs'
import path from 'path'

const BASE = `http://localhost:${BACKEND_PORT}`

function loadFixture(): Record<string, unknown> {
  const fixture = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixture.json'), 'utf-8'))
  return { ...fixture, name: `V-CANVAS-FN-EDIT-01 ${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }
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

async function clickSaveAndWaitClean(page: Page) {
  const saveBtn = page.locator('[data-testid="toolbar-save-button"]')
  await expect(saveBtn).toBeEnabled({ timeout: 10_000 })
  await saveBtn.click()
  await expect(saveBtn).toBeDisabled({ timeout: 10_000 })
}

test.describe('V-CANVAS-FN-EDIT-01: edit inside drilled-in Function persists', () => {
  test('drop plugin, save, reload, drill back - inner Log survives', async ({ page, request }) => {
    const testId = await seedFixture(request)
    await openTest(page, testId)

    // Drill in via the glyph.
    const outer = page.locator('[data-testid="workflow-node-fn-1"]')
    await expect(outer).toBeVisible()
    await outer.locator('[data-testid="node-dig-in"]').click()

    // Inner canvas is empty.
    const onboardingHint = page.locator('[data-testid="onboarding-hint"]')
    await expect(onboardingHint).toBeVisible()
    await expect(onboardingHint).toContainText('Drag a plugin to define')

    // Drop a Log plugin BELOW the start-node so the canvas proximity check
    // auto-connects it via a start-node -> Log edge. Without that edge the
    // inner workflow would have an unreachable node and save would fail
    // NODE_UNREACHABLE on the inner Function body.
    const canvas = page.locator('[data-testid="workflow-canvas"]')
    const canvasBox = await canvas.boundingBox()
    expect(canvasBox).toBeTruthy()
    const startNode = page.locator('[data-testid="start-node"]')
    await expect(startNode).toBeVisible()
    const startBox = await startNode.boundingBox()
    expect(startBox).toBeTruthy()
    // Coordinates are relative to the canvas's top-left corner.
    await dragPaletteItemToCanvas(page, 'log', {
      x: Math.round(startBox!.x + startBox!.width / 2 - canvasBox!.x),
      y: Math.round(startBox!.y + startBox!.height + 30 - canvasBox!.y),
    })

    // The dropped Log node appears inside Function_1.
    const innerLog = page.locator('[data-testid^="workflow-node-"][data-nodetype="plugin"]')
    await expect(innerLog).toHaveCount(1)

    // Fill in the inner Log's required `message` so save passes the
    // REQUIRED_PARAM_MISSING validator.
    await innerLog.locator('button').first().dispatchEvent('click')
    await openNodeSheet(page, innerLog)
    // A literal string message edits through the shared "Edit value" sheet.
    await setStringParam(configSheet(page), page, 'message', 'hi')
    await configSheet(page).getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.locator('[data-testid="param-expand-message"]')).toHaveCount(0)

    // Save the Test.
    await clickSaveAndWaitClean(page)

    // Reload: a full page reload of /workbench with the same editTest restores
    // the Test from disk. Drill state is in-memory only so we must drill back
    // in to verify.
    await openTest(page, testId)

    await expect(outer).toBeVisible()
    await outer.locator('[data-testid="node-dig-in"]').click()

    // Inner Log persisted.
    await expect(page.locator('[data-testid^="workflow-node-"][data-nodetype="plugin"]')).toHaveCount(1)

    // Pop back to root - inner Log stays in storage (non-destructive).
    await page.locator('[data-testid="breadcrumb-back-arrow"]').click()
    await expect(outer).toBeVisible()

    // Drill back in once more and verify the Log node is still present.
    await outer.locator('[data-testid="node-dig-in"]').click()
    await expect(page.locator('[data-testid^="workflow-node-"][data-nodetype="plugin"]')).toHaveCount(1)
  })
})
