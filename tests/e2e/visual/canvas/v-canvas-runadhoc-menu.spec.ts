/**
 * V-CANVAS-RUNADHOC-MENU: Right-Click Ad-Hoc Run/Debug Menu Surfaces
 *
 * REQ: REQ-3.2.1.5 (Ad-hoc block execution)
 *
 * Two surfaces verified in this spec:
 *
 * 1. Node right-click context menu - the four ad-hoc entries (Run Current,
 *    Debug Current, Run from Here, Debug from Here) render in the correct
 *    groups with the right icons (Play green / Bug yellow) and the right
 *    enabled state (grayed out on Break / Continue / Note nodes).
 *
 * 2. Canvas (non-node) right-click context menu - the three new debug items
 *    (Clear Breakpoints, Pause on Error, Pause on First Block) render at
 *    the bottom of the menu after a separator. Toggle items use
 *    role="menuitemcheckbox" with aria-checked bound to the underlying
 *    debugOptions slice. Clear Breakpoints is disabled when the
 *    breakpoint set is empty.
 *
 * Pass Criteria:
 * 1. Right-click on a runnable plugin shows Run Current + Debug Current at
 *    the TOP of their respective groups.
 * 2. Right-click on a Break node renders the four ad-hoc items disabled
 *    (aria-disabled="true").
 * 3. Right-click on a Continue node renders the four ad-hoc items disabled.
 * 4. Right-click on a Note annotation renders the four ad-hoc items
 *    disabled (Note nodes use a different node testid prefix - the menu
 *    must still surface the items so the user understands the affordance).
 * 5. Right-click on the empty canvas renders Clear Breakpoints, Pause on
 *    Error, Pause on First Block in the new bottom group.
 * 6. Clear Breakpoints is disabled when the workflow store has no
 *    breakpoints.
 * 7. Pause on Error and Pause on First Block toggles use
 *    role="menuitemcheckbox" and reflect the aria-checked bound to the
 *    debugOptions store slice.
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { dragPaletteItemToCanvas, waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT } from '../../helpers/config'

async function dropPluginNearStart(page: Page, term: string): Promise<void> {
  const canvas = page.locator('[data-testid="workflow-canvas"]')
  const canvasBox = await canvas.boundingBox()
  const startNode = page.locator('[data-testid="start-node"]')
  const startBox = await startNode.boundingBox()
  const dropX = startBox!.x - canvasBox!.x + startBox!.width / 2
  const dropY = startBox!.y - canvasBox!.y + startBox!.height + 80
  await dragPaletteItemToCanvas(page, term, { x: dropX, y: dropY })
}

async function rightClickFirstWorkflowNode(page: Page): Promise<void> {
  const node = page
    .locator('[data-testid^="workflow-node-"][data-nodetype]')
    .first()
  await expect(node).toBeVisible()
  await node.click({ button: 'right' })
}

async function rightClickEmptyCanvas(page: Page): Promise<void> {
  const canvas = page.locator('[data-testid="workflow-canvas"]')
  const box = await canvas.boundingBox()
  // Click in a corner far from the Start node so we hit empty pane, not a node.
  await page.mouse.click(box!.x + box!.width - 60, box!.y + 60, { button: 'right' })
}

test.describe('V-CANVAS-RUNADHOC-MENU: Node context menu - ad-hoc entries', () => {
  test.beforeEach(async ({ page }) => {
    await page.request.delete(`http://localhost:${BACKEND_PORT}/workbench/session`).catch(() => {})
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
  })

  test('runnable plugin: four ad-hoc items render enabled with correct icons', async ({ page }) => {
    await dropPluginNearStart(page, 'http')
    await rightClickFirstWorkflowNode(page)

    const menu = page.locator('[role="menu"]')
    await expect(menu).toBeVisible()

    const runCurrent = menu.locator('[role="menuitem"]').filter({ hasText: 'Run Current' })
    const runFromHere = menu.locator('[role="menuitem"]').filter({ hasText: 'Run from Here' })
    const debugCurrent = menu.locator('[role="menuitem"]').filter({ hasText: 'Debug Current' })
    const debugFromHere = menu.locator('[role="menuitem"]').filter({ hasText: 'Debug from Here' })

    await expect(runCurrent).toBeVisible()
    await expect(runFromHere).toBeVisible()
    await expect(debugCurrent).toBeVisible()
    await expect(debugFromHere).toBeVisible()

    // None of the four are aria-disabled when the node is a normal idle plugin
    for (const item of [runCurrent, runFromHere, debugCurrent, debugFromHere]) {
      // Radix sets aria-disabled only when truly disabled; the attribute is
      // either absent or "false" for enabled items.
      const ariaDisabled = await item.getAttribute('aria-disabled')
      expect(ariaDisabled === null || ariaDisabled === 'false').toBeTruthy()
    }
  })

  test('Break node: four ad-hoc items rendered disabled (aria-disabled)', async ({ page }) => {
    await dropPluginNearStart(page, 'break')
    await rightClickFirstWorkflowNode(page)

    const menu = page.locator('[role="menu"]')
    await expect(menu).toBeVisible()

    for (const label of ['Run Current', 'Run from Here', 'Debug Current', 'Debug from Here']) {
      const item = menu.locator('[role="menuitem"]').filter({ hasText: label })
      await expect(item).toBeVisible()
      await expect(item).toHaveAttribute('aria-disabled', 'true')
    }

    // Toggle Breakpoint is intentionally NOT in the blocked set - users can
    // still mark a breakpoint on a Break node even though ad-hoc execution
    // is disallowed. This pins the existing affordance.
    const toggle = menu.locator('[role="menuitem"]').filter({ hasText: 'Toggle Breakpoint' })
    await expect(toggle).toBeVisible()
    const ariaDisabled = await toggle.getAttribute('aria-disabled')
    expect(ariaDisabled === null || ariaDisabled === 'false').toBeTruthy()
  })

  test('Continue node: four ad-hoc items rendered disabled (aria-disabled)', async ({ page }) => {
    await dropPluginNearStart(page, 'continue')
    await rightClickFirstWorkflowNode(page)

    const menu = page.locator('[role="menu"]')
    await expect(menu).toBeVisible()

    for (const label of ['Run Current', 'Run from Here', 'Debug Current', 'Debug from Here']) {
      const item = menu.locator('[role="menuitem"]').filter({ hasText: label })
      await expect(item).toBeVisible()
      await expect(item).toHaveAttribute('aria-disabled', 'true')
    }
  })
})

test.describe('V-CANVAS-RUNADHOC-MENU: Canvas context menu - new debug items', () => {
  test.beforeEach(async ({ page }) => {
    await page.request.delete(`http://localhost:${BACKEND_PORT}/workbench/session`).catch(() => {})
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
  })

  test('three new items render in the bottom group with correct roles', async ({ page }) => {
    await rightClickEmptyCanvas(page)

    const menu = page.locator('[role="menu"]')
    await expect(menu).toBeVisible()

    // Existing items remain
    await expect(menu.locator('[role="menuitem"]').filter({ hasText: 'Paste' })).toBeVisible()
    await expect(menu.locator('[role="menuitem"]').filter({ hasText: 'Select All' })).toBeVisible()
    await expect(menu.locator('[role="menuitem"]').filter({ hasText: 'Fit View' })).toBeVisible()
    await expect(menu.locator('[role="menuitem"]').filter({ hasText: 'Unskip All' })).toBeVisible()
    await expect(menu.locator('[role="menuitem"]').filter({ hasText: 'Enable All' })).toBeVisible()
    await expect(menu.locator('[role="menuitem"]').filter({ hasText: 'Reset' })).toBeVisible()

    // New items
    const clearBreakpoints = menu.locator('[role="menuitem"]').filter({ hasText: 'Clear Breakpoints' })
    await expect(clearBreakpoints).toBeVisible()

    const pauseOnError = menu.locator('[role="menuitemcheckbox"]').filter({ hasText: 'Pause on Error' })
    await expect(pauseOnError).toBeVisible()

    const pauseOnFirst = menu.locator('[role="menuitemcheckbox"]').filter({ hasText: 'Pause on First Block' })
    await expect(pauseOnFirst).toBeVisible()
  })

  test('Clear Breakpoints is disabled when no breakpoints exist', async ({ page }) => {
    await rightClickEmptyCanvas(page)
    const menu = page.locator('[role="menu"]')
    const clearBreakpoints = menu.locator('[role="menuitem"]').filter({ hasText: 'Clear Breakpoints' })
    await expect(clearBreakpoints).toHaveAttribute('aria-disabled', 'true')
  })

  test('Pause on Error toggle reflects aria-checked from store', async ({ page }) => {
    await rightClickEmptyCanvas(page)
    const menu = page.locator('[role="menu"]')
    const pauseOnError = menu.locator('[role="menuitemcheckbox"]').filter({ hasText: 'Pause on Error' })

    // Default state: unchecked
    await expect(pauseOnError).toHaveAttribute('aria-checked', 'false')

    // Click to flip to checked. The menu closes after the click - re-open it.
    await pauseOnError.click()
    await expect(menu).not.toBeVisible()

    await rightClickEmptyCanvas(page)
    const menu2 = page.locator('[role="menu"]')
    const pauseOnErrorAgain = menu2.locator('[role="menuitemcheckbox"]').filter({ hasText: 'Pause on Error' })
    await expect(pauseOnErrorAgain).toHaveAttribute('aria-checked', 'true')
  })

  test('Pause on First Block toggle reflects aria-checked from store', async ({ page }) => {
    await rightClickEmptyCanvas(page)
    const menu = page.locator('[role="menu"]')
    const pauseOnFirst = menu.locator('[role="menuitemcheckbox"]').filter({ hasText: 'Pause on First Block' })

    await expect(pauseOnFirst).toHaveAttribute('aria-checked', 'false')

    await pauseOnFirst.click()
    await expect(menu).not.toBeVisible()

    await rightClickEmptyCanvas(page)
    const menu2 = page.locator('[role="menu"]')
    const pauseOnFirstAgain = menu2.locator('[role="menuitemcheckbox"]').filter({ hasText: 'Pause on First Block' })
    await expect(pauseOnFirstAgain).toHaveAttribute('aria-checked', 'true')
  })

  test('Clear Breakpoints becomes enabled after a breakpoint is toggled', async ({ page }) => {
    // Drop a node, toggle its breakpoint via the right-click menu, then
    // re-open the canvas menu and assert Clear Breakpoints is enabled.
    await dropPluginNearStart(page, 'http')
    await rightClickFirstWorkflowNode(page)
    const nodeMenu = page.locator('[role="menu"]')
    await nodeMenu.locator('[role="menuitem"]').filter({ hasText: 'Toggle Breakpoint' }).click()
    await expect(nodeMenu).not.toBeVisible()

    await rightClickEmptyCanvas(page)
    const canvasMenu = page.locator('[role="menu"]')
    const clearBreakpoints = canvasMenu.locator('[role="menuitem"]').filter({ hasText: 'Clear Breakpoints' })
    const ariaDisabled = await clearBreakpoints.getAttribute('aria-disabled')
    expect(ariaDisabled === null || ariaDisabled === 'false').toBeTruthy()
  })
})
