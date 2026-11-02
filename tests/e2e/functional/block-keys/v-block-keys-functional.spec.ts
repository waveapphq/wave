/**
 * V-BLOCK-KEYS (functional): the selected-block keys, and the canvas keyboard
 * surviving a sheet close.
 *
 * Design Decisions: CANVAS-238..240
 * REQ: REQ-4.2.5
 *
 * Pass Criteria:
 * 1. Enter opens the config sheet of the ONE selected block - the sheet that
 *    opens names that block.
 * 2. Ctrl+Enter on a Shared Function instance lands INSIDE its body: the
 *    breadcrumb gains a Function segment and the body's own block is on the
 *    canvas.
 * 3. Ctrl+Enter drills a Local Function the same way.
 * 4. Both keys are no-ops with two blocks selected, and on the Start block.
 * 5. After closing a sheet with Esc, with the X control, or after closing
 *    Quick Insert, Enter still reaches the canvas and reopens the sheet.
 * 6. Opening a block's config from its cog selects that block, even when a
 *    different block was selected.
 */

import { test, expect, type APIRequestContext, type Page } from '../../helpers/playwright-fixtures'
import { configSheet, popToBreadcrumbSegment } from '../../helpers/workbench'
import {
  createValidTest,
  localFunctionNode,
  logNode,
  openTest,
  publishLibraryFunction,
  sharedNode,
  startEdge,
} from '../../helpers/fn-seed'
import { randomUUID } from 'node:crypto'

const SHEET_NAME = '[data-testid="element-name-input"]'
// A Function block opens the Function sheet, whose name field is its own.
const FN_SHEET_NAME = '[data-testid="function-name-input"]'

async function seed(page: Page, request: APIRequestContext) {
  const fn = await publishLibraryFunction(request, {
    name: `blockkeys_${randomUUID().slice(0, 6)}`,
    workflow: {
      nodes: [logNode('inner-shared', 'Inner Shared', "'shared body'")],
      edges: [startEdge('inner-shared')],
    },
  })
  const testId = await createValidTest(request, {
    name: `V-BLOCK-KEYS ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    nodes: [
      logNode('plug', 'Plug', "'plug'", { x: 260, y: 120 }),
      sharedNode('fn-shared', {
        functionId: fn.functionId,
        functionVersion: fn.version,
        label: 'SharedFn',
        originalLibraryName: fn.name,
        position: { x: 260, y: 260 },
      }),
      localFunctionNode(
        'fn-local',
        'LocalFn',
        {
          nodes: [logNode('inner-local', 'Inner Local', "'local body'")],
          edges: [startEdge('inner-local')],
        },
        { x: 260, y: 400 },
      ),
    ],
    edges: [startEdge('plug'), { id: 'e-plug-shared', source: 'plug', target: 'fn-shared' }],
  })
  await openTest(page, testId)
  return fn
}

/** Click a block's body so it is selected AND the canvas holds keyboard focus. */
async function selectBlock(page: Page, nodeId: string) {
  const node = page.locator(`[data-testid="workflow-node-${nodeId}"]`)
  await node.locator('button').first().click()
  await expect(node).toHaveAttribute('data-selected', 'true')
}

async function addToSelection(page: Page, nodeId: string) {
  const node = page.locator(`[data-testid="workflow-node-${nodeId}"]`)
  await node.locator('button').first().click({ modifiers: ['ControlOrMeta'] })
  await expect(node).toHaveAttribute('data-selected', 'true')
}

test.describe('V-BLOCK-KEYS: Enter configures, Ctrl+Enter opens a Function', () => {
  test('Enter opens the selected block config; Ctrl+Enter drills Shared and Local Functions', async ({
    page,
    request,
  }) => {
    await seed(page, request)

    // Enter opens the config sheet of the selected block - and the sheet
    // that opens is THAT block's, not merely "a sheet".
    await selectBlock(page, 'plug')
    await page.keyboard.press('Enter')
    const sheet = configSheet(page)
    await expect(sheet).toBeVisible({ timeout: 10_000 })
    await expect(sheet.locator(SHEET_NAME)).toHaveValue('Plug')
    await page.keyboard.press('Escape')
    await expect(sheet).toHaveCount(0)

    // Ctrl+Enter on a Shared instance lands inside its body - the
    // breadcrumb gains a Function segment and the body's block is on canvas.
    const crumbs = page.locator('[data-testid="canvas-breadcrumb"] li')
    await expect(crumbs).toHaveCount(1)
    await selectBlock(page, 'fn-shared')
    await page.keyboard.press('Control+Enter')
    await expect(
      page.locator('[data-testid="workflow-node-inner-shared"]'),
      'the Shared body is on the canvas',
    ).toBeVisible({ timeout: 15_000 })
    await expect(crumbs.filter({ hasText: 'SharedFn' })).toHaveCount(1)

    // Back at the root, the same key drills a Local Function.
    await popToBreadcrumbSegment(page, /V-BLOCK-KEYS/)
    await expect(page.locator('[data-testid="workflow-node-inner-shared"]')).toHaveCount(0)
    await selectBlock(page, 'fn-local')
    await page.keyboard.press('Control+Enter')
    await expect(
      page.locator('[data-testid="workflow-node-inner-local"]'),
      'the Local body is on the canvas',
    ).toBeVisible({ timeout: 15_000 })
    await expect(crumbs.filter({ hasText: 'LocalFn' })).toHaveCount(1)
  })

  test('both keys are no-ops on a multi-selection', async ({ page, request }) => {
    await seed(page, request)

    await selectBlock(page, 'plug')
    await addToSelection(page, 'fn-shared')
    await expect(
      page.locator('[data-testid^="workflow-node-"][data-nodetype][data-selected="true"]'),
    ).toHaveCount(2)

    // Keys go to the canvas, not to the node button that still holds focus:
    // Enter on a focused button activates it, which would collapse the
    // selection to one and make the next key legitimate.
    await page.locator('[data-testid="workflow-canvas"]').focus()

    await page.keyboard.press('Enter')
    await expect(configSheet(page), 'no sheet opens for two selected blocks').toHaveCount(0)
    await page.keyboard.press('Control+Enter')
    // Anchor on the drill actually not happening: no Function body on the
    // canvas, and the breadcrumb still shows only the Test itself.
    await expect(page.locator('[data-testid="workflow-node-inner-shared"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="workflow-node-plug"]')).toBeVisible()
    await expect(
      page.locator('[data-testid="canvas-breadcrumb"] li'),
      'no drill for two selected blocks',
    ).toHaveCount(1)
  })

  test('the canvas keyboard survives closing a sheet with Esc, with X, and after Quick Insert', async ({
    page,
    request,
  }) => {
    await seed(page, request)
    const sheet = configSheet(page)

    await selectBlock(page, 'plug')
    await page.keyboard.press('Enter')
    await expect(sheet).toBeVisible({ timeout: 10_000 })

    // Esc closes; Enter must reopen it (the canvas only hears keys while it
    // holds focus, so a closing sheet must not drop focus to the page body).
    await page.keyboard.press('Escape')
    await expect(sheet).toHaveCount(0)
    await page.keyboard.press('Enter')
    await expect(sheet, 'Enter reopens after an Esc close').toBeVisible({ timeout: 10_000 })
    await expect(sheet.locator(SHEET_NAME)).toHaveValue('Plug')

    // The X control closes; Enter must reopen it.
    await sheet.getByRole('button', { name: 'Close' }).first().click()
    await expect(sheet).toHaveCount(0)
    await page.keyboard.press('Enter')
    await expect(sheet, 'Enter reopens after an X close').toBeVisible({ timeout: 10_000 })
    await page.keyboard.press('Escape')
    await expect(sheet).toHaveCount(0)

    // Quick Insert is the same shared sheet: closing it must not leave the
    // canvas keyboard dead either.
    await page.keyboard.press('Control+Space')
    const quickInsert = page.locator('[data-testid="quick-add-popover"]')
    await expect(quickInsert).toBeVisible({ timeout: 5_000 })
    await page.keyboard.press('Escape')
    await expect(quickInsert).toHaveCount(0)
    await page.keyboard.press('Enter')
    await expect(sheet, 'Enter reopens after Quick Insert closes').toBeVisible({ timeout: 10_000 })
    await expect(sheet.locator(SHEET_NAME)).toHaveValue('Plug')
  })

  test('opening a config from the cog selects that block', async ({ page, request }) => {
    await seed(page, request)

    // A different block holds the selection.
    await selectBlock(page, 'plug')

    // The action cluster stops its click reaching the canvas, and configuring
    // must keep the keyboard and the open sheet on the same block.
    await page
      .locator('[data-testid="workflow-node-fn-local"] [data-testid="node-configure"]')
      .click()
    const sheet = configSheet(page)
    await expect(sheet).toBeVisible({ timeout: 10_000 })
    await expect(sheet.locator(FN_SHEET_NAME)).toHaveValue('LocalFn')

    await expect(page.locator('[data-testid="workflow-node-fn-local"]')).toHaveAttribute(
      'data-selected',
      'true',
    )
    await expect(page.locator('[data-testid="workflow-node-plug"]')).not.toHaveAttribute(
      'data-selected',
      'true',
    )
  })
})
