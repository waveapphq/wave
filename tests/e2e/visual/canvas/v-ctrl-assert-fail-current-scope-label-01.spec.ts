/**
 * V-CTRL-ASSERT-FAIL-CURRENT-SCOPE-LABEL-01: Assert config modal label
 *
 * The Assert config modal's failure-toggle row reads "Fail Current Scope".
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad, dragPaletteItemToCanvas } from '../../helpers/canvas'
import { openSelectedBlockSheet } from '../../helpers/workbench'

test.describe('V-CTRL-ASSERT-FAIL-CURRENT-SCOPE-LABEL-01: rename', () => {
  async function dropAssertAndOpenModal(page: Page) {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    const canvas = page.locator('[data-testid="workflow-canvas"]')
    const canvasBox = await canvas.boundingBox()
    await dragPaletteItemToCanvas(page, 'assert', {
      x: canvasBox!.width / 2,
      y: canvasBox!.height / 2,
    })

    // Open the config modal via the gear / configure affordance.
    const workflowNodes = page.locator('[data-testid^="workflow-node-"][data-nodetype]')
    const assertNode = workflowNodes.first()
    await assertNode.locator('button').first().dispatchEvent('click')
    await expect(assertNode).toHaveAttribute('data-selected', 'true')
    await openSelectedBlockSheet(page)
  }

  test('Assert config modal renders "Fail Current Scope" label (not "Fail Test")', async ({
    page,
  }) => {
    await dropAssertAndOpenModal(page)
    // The new label.
    await expect(
      page.getByRole('checkbox', { name: 'Fail Current Scope' }),
    ).toBeVisible()
    // No "Fail Test" label.
    await expect(
      page.getByRole('checkbox', { name: 'Fail Test' }),
    ).toHaveCount(0)
  })
})
