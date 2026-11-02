/**
 * V-FN-DRAFT-PUBLISH-VERSION (functional): publishing a NEW Function from a DRAFT
 * (never-saved) canvas with a custom version stores THAT version in the library
 * and pins the node to it.
 *
 * REQ-3.1.2.2, REQ-3.1.2.3.
 *
 * The draft path (createFunction) keeps the typed version, so the library and the node
 * agree. This asserts the library version, the node pin, and no MISSING badge.
 *
 * Phase: functional-workflow. Self-seeds (draft canvas + POST /functions via UI).
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad, dragSourceToCanvas, expandPalette } from '../../helpers/canvas'
import { BACKEND_PORT } from '../../helpers/config'
import { configSheet } from '../../helpers/workbench'
import { randomUUID } from 'node:crypto'

const BASE = `http://localhost:${BACKEND_PORT}`
const CUSTOM_VERSION = '1.4.3-beta.1'

async function openDraftWorkbench(page: Page): Promise<void> {
  await page.request.delete(`${BASE}/workbench/session`).catch(() => {})
  await page.goto(`/workbench`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench`)
  await waitForCanvasLoad(page)
}

async function dragLocalFnIntoCanvas(page: Page): Promise<string> {
  await expandPalette(page)
  const newFnBtn = page.locator('[data-testid="palette-new-block-button"]')
  await expect(newFnBtn).toBeVisible()
  const canvas = page.locator('[data-testid="workflow-canvas"]')
  const box = await canvas.boundingBox()
  expect(box).toBeTruthy()
  await dragSourceToCanvas(page, newFnBtn, { x: box!.width * 0.4, y: box!.height * 0.4 })
  const newFn = page.locator('[data-testid^="workflow-node-"][data-nodetype="function"]').first()
  const testId = await newFn.getAttribute('data-testid')
  return testId!.replace(/^workflow-node-/, '')
}

test.describe('V-FN-DRAFT-PUBLISH-VERSION (functional): draft publish honors the typed version', () => {
  test('publishing from a draft canvas with a custom version pins the node and library to it', async ({ page }) => {
    await openDraftWorkbench(page)
    const nodeId = await dragLocalFnIntoCanvas(page)

    // Open the publish dialog and set a CUSTOM version.
    const node = page.locator(`[data-testid="workflow-node-${nodeId}"]`)
    await node.locator('button').first().dispatchEvent('click')
    await node.locator('[data-testid="node-kebab"]').click()
    const menu = page.locator('[role="menu"]')
    await expect(menu).toBeVisible()
    await menu.getByRole('menuitem', { name: 'Publish to Library' }).click()
    const dialog = page.locator('[role="dialog"]', { hasText: 'Publish Function' })
    await expect(dialog).toBeVisible({ timeout: 10_000 })

    const uniqueName = `DraftVer ${randomUUID().slice(0, 8)}`
    await dialog.locator('[data-testid="publish-name-input"]').fill(uniqueName)
    await dialog.locator('[data-testid="publish-version-input"]').fill(CUSTOM_VERSION)
    await dialog.getByRole('button', { name: 'Publish' }).click()
    await expect(dialog).toBeHidden({ timeout: 10_000 })

    // The library entry stores the TYPED version (not the 1.0.0 default).
    const listResp = await page.request.get(`${BASE}/functions?q=${encodeURIComponent(uniqueName)}`)
    const list = await listResp.json()
    const found = list.data.find((f: { name: string; id: string }) => f.name === uniqueName)
    expect(found, `library entry "${uniqueName}" must exist`).toBeTruthy()
    const versResp = await page.request.get(`${BASE}/functions/${found.id}/versions`)
    const versions = (await versResp.json()).data.versions.map((v: { version: string }) => v.version)
    expect(versions, `library stored the typed version; got ${JSON.stringify(versions)}`).toContain(CUSTOM_VERSION)
    expect(versions, 'the 1.0.0 default was NOT stored').not.toContain('1.0.0')

    // The node became a Shared reference...
    await expect(node.locator('[data-testid="node-function-lifecycle-badge"]')).toHaveAttribute('data-state', 'shared')

    // ...and its pin matches the library version: the config modal shows the
    // custom version on the dropdown trigger and NO missing-version banner.
    await node.locator('button').first().dblclick()
    const config = configSheet(page)
    await expect(config).toBeVisible({ timeout: 10_000 })
    await expect(config.locator('[data-testid="missing-version-banner"]')).toHaveCount(0)
    await expect(config.locator('[data-testid="version-dropdown-trigger"]')).toContainText(CUSTOM_VERSION)
  })
})
