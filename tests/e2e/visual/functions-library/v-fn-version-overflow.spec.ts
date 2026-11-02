/**
 * V-FN-VERSION-OVERFLOW: the config-modal version dropdown does not clip - a long
 * version row truncates with an ellipsis and the pick menu stays INSIDE the dialog
 * (date + `latest` chip never clip), INCLUDING when the pinned version is SHORT
 * (narrow trigger near the dialog's right edge).
 *
 * REQ-3.1.2.2.
 *
 * Runs in the no-data light + dark projects (seeds via REST).
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { publishLibraryFunction, addLibraryVersion, sharedNode, startEdge } from '../../helpers/fn-seed'
import { BACKEND_URL } from '../../helpers/config'
import { configSheet } from '../../helpers/workbench'
import { randomUUID } from 'node:crypto'

const LONG = '1.0.0-rc.20260102.build54extra' // 30 chars
const SHORT = '1.0.1' // patch bump; becomes latest; the node pins here (narrow trigger)

async function seedTest(page: Page, nodeId: string, functionId: string, label: string): Promise<string> {
  const resp = await page.request.post(`${BACKEND_URL}/tests`, {
    data: {
      name: `V-FN-VERSION-OVERFLOW ${randomUUID().slice(0, 8)}`,
      version: '1.0.0',
      description: 'short-pinned shared instance whose library list also holds a long version',
      workflow: {
        nodes: [sharedNode(nodeId, { functionId, functionVersion: SHORT, label })],
        edges: [startEdge(nodeId)],
      },
      variables: {},
      metadata: {},
    },
  })
  const body = await resp.json().catch(() => null)
  expect(body?.success, `POST /tests: ${resp.status()}`).toBeTruthy()
  return body.data.id
}

test.describe('V-FN-VERSION-OVERFLOW: config-modal version dropdown stays inside the dialog', () => {
  test('long version row truncates; menu stays in-dialog with a short (narrow) pinned trigger', async ({ page }) => {
    const lib = await publishLibraryFunction(page.request, {
      name: `LongVer ${randomUUID().slice(0, 6)}`,
      version: LONG,
    })
    // Add the short patch version so the list holds BOTH; SHORT becomes latest.
    await addLibraryVersion(page.request, lib, { sourceVersion: LONG, targetVersion: SHORT })

    const nodeId = 'fn-overflow'
    const testId = await seedTest(page, nodeId, lib.functionId, lib.name)

    await page.request.delete(`${BACKEND_URL}/workbench/session`).catch(() => {})
    await page.goto(`/workbench?editTest=${testId}`)
    await page.evaluate(() => localStorage.clear())
    await page.goto(`/workbench?editTest=${testId}`)
    await waitForCanvasLoad(page)

    // Open the config modal + the (pick-mode) version dropdown.
    await page.locator(`[data-testid="workflow-node-body-${nodeId}"]`).dblclick()
    await expect(configSheet(page)).toBeVisible({ timeout: 10_000 })
    await page.locator('[data-testid="version-dropdown-trigger"]').click()
    await expect(page.locator('[data-testid="version-dropdown-menu"]')).toBeVisible()

    const metrics = await page.evaluate(() => {
      const dialog = document.querySelector('[data-testid="element-config-sheet"]')
      const menu = document.querySelector('[data-testid="version-dropdown-menu"]')
      const dRight = dialog?.getBoundingClientRect().right ?? 0
      const menuRight = menu?.getBoundingClientRect().right ?? 0
      const rows = [...(menu?.querySelectorAll('[role="menuitemradio"]') ?? [])].map((row) => {
        const vspan = row.querySelector('.font-mono')
        return {
          text: vspan?.textContent ?? '',
          truncated: vspan ? vspan.scrollWidth > vspan.clientWidth + 1 : false,
        }
      })
      return { menuOverflowsDialogPx: Math.round(menuRight - dRight), rows }
    })

    // The pick menu (right-0 in pick mode) does not extend past the dialog edge.
    expect(
      metrics.menuOverflowsDialogPx,
      `menu must stay inside the dialog; overflow=${metrics.menuOverflowsDialogPx}px`,
    ).toBeLessThanOrEqual(0)

    // The long version row truncates (it does not force the menu wider).
    const longRow = metrics.rows.find((r) => r.text.includes('rc.20260102'))
    expect(longRow, `long version row present; rows=${JSON.stringify(metrics.rows)}`).toBeTruthy()
    expect(longRow!.truncated, 'long version row truncates with an ellipsis').toBe(true)
  })
})
