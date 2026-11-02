/**
 * V-SHEET-03 (functional): config sheet lifecycle on an interactive canvas.
 *
 * Design Decisions: CANVAS-230
 * REQ: REQ-3.1.1.5
 *
 * Pass Criteria:
 * 1. Deleting a node whose sheet has unsaved edits asks for confirmation
 *    first; cancel keeps node + sheet; confirm deletes both.
 * 2. Deleting a node with a CLEAN open sheet closes it silently (no dialog).
 * 3. A dirty sheet gates the test-close flow even when the canvas itself is
 *    clean (Unsaved Changes prompt on Close).
 * 4. Drilling while a sheet has unsaved edits asks for confirmation (a
 *    scope change resets sheet form state); cancel stays with the
 *    edits intact. After confirming, the sheet survives the drill read-only
 *    (READ-ONLY pill, frozen fields, footer Close, no Save) with its form
 *    reset to saved values, and re-enables on return to its scope.
 * 5. Breadcrumb pops are guarded the same way (drill OUT also changes scope).
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { popToBreadcrumbSegment } from '../../helpers/workbench'
import {
  createValidTest,
  localFunctionNode,
  logNode,
  openTest,
  startEdge,
} from '../../helpers/fn-seed'

const SHEET = '[data-testid="element-config-sheet"]'

async function openSheetForNode(page: Page, nodeId: string) {
  const node = page.locator(`[data-testid="workflow-node-${nodeId}"]`)
  await node.locator('button').first().dispatchEvent('click')
  await expect(node).toHaveAttribute('data-selected', 'true')
  await node.locator('[data-testid="node-configure"]').dispatchEvent('click')
  await expect(page.locator(SHEET)).toBeVisible({ timeout: 10_000 })
}

/** Dirty the open sheet by renaming the node (title live-follows). */
async function dirtySheet(page: Page, name: string) {
  const sheet = page.locator(SHEET)
  await sheet.locator('[data-testid="element-name-input"]').fill(name)
  await expect(sheet.getByRole('heading', { name: `${name} - Edit Config` })).toBeVisible()
}

async function pressDelete(page: Page, nodeId: string) {
  const node = page.locator(`[data-testid="workflow-node-${nodeId}"]`)
  await node.locator('button').first().dispatchEvent('click')
  await expect(node).toHaveAttribute('data-selected', 'true')
  await page.locator('[data-testid="workflow-canvas"]').press('Delete')
}

function seedName(tag: string): string {
  return `V-SHEET-03-${tag} ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}

test.describe('V-SHEET-03: config sheet lifecycle', () => {
  test('S1: dirty-sheet delete asks confirmation; cancel keeps, confirm deletes', async ({
    page,
    request,
  }) => {
    const testId = await createValidTest(request, {
      name: seedName('delete'),
      nodes: [logNode('log-1', 'Log A', "'x'", { x: 160, y: 140 })],
      edges: [startEdge('log-1')],
    })
    await openTest(page, testId)

    await openSheetForNode(page, 'log-1')
    await dirtySheet(page, 'Dirty Log')

    await pressDelete(page, 'log-1')
    const confirm = page.getByRole('alertdialog', { name: 'Delete with unsaved changes?' })
    await expect(confirm).toBeVisible({ timeout: 5_000 })

    // Keep Editing: node and sheet both survive.
    await confirm.getByRole('button', { name: 'Keep Editing' }).click()
    await expect(confirm).toBeHidden()
    await expect(page.locator('[data-testid="workflow-node-log-1"]')).toBeVisible()
    await expect(page.locator(SHEET)).toBeVisible()

    // Close: node deleted, sheet closes with it.
    await pressDelete(page, 'log-1')
    await expect(confirm).toBeVisible({ timeout: 5_000 })
    await confirm.getByRole('button', { name: 'Close' }).click()
    await expect(page.locator('[data-testid="workflow-node-log-1"]')).toHaveCount(0)
    await expect(page.locator(SHEET)).toHaveCount(0)
  })

  test('S2: clean-sheet delete closes silently', async ({ page, request }) => {
    const testId = await createValidTest(request, {
      name: seedName('clean'),
      nodes: [logNode('log-1', 'Log A', "'x'", { x: 160, y: 140 })],
      edges: [startEdge('log-1')],
    })
    await openTest(page, testId)

    await openSheetForNode(page, 'log-1')
    await pressDelete(page, 'log-1')

    await expect(page.locator('[data-testid="workflow-node-log-1"]')).toHaveCount(0)
    await expect(page.locator(SHEET)).toHaveCount(0)
    await expect(
      page.getByRole('alertdialog', { name: 'Delete with unsaved changes?' }),
    ).toHaveCount(0)
  })

  test('S3: a dirty sheet gates test close even when the canvas is clean', async ({
    page,
    request,
  }) => {
    const testId = await createValidTest(request, {
      name: seedName('close'),
      nodes: [logNode('log-1', 'Log A', "'x'", { x: 160, y: 140 })],
      edges: [startEdge('log-1')],
    })
    await openTest(page, testId)

    await openSheetForNode(page, 'log-1')
    await dirtySheet(page, 'Dirty Log')

    await page.locator('[data-testid="toolbar-close-button"]').click()
    const closeDialog = page.getByRole('dialog').filter({ hasText: 'Unsaved Changes' })
    await expect(closeDialog).toBeVisible({ timeout: 5_000 })

    // Stay: dismiss the prompt; the sheet and its edits survive.
    await closeDialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(closeDialog).toBeHidden()
    await expect(page.locator(SHEET)).toBeVisible()
    await expect(
      page.locator(SHEET).locator('[data-testid="element-name-input"]'),
    ).toHaveValue('Dirty Log')
  })

  test('S4: dirty drill asks confirmation; confirmed drill resets the form and renders read-only', async ({
    page,
    request,
  }) => {
    const testName = seedName('drill')
    const testId = await createValidTest(request, {
      name: testName,
      nodes: [
        logNode('log-top', 'Top Log', "'x'", { x: 160, y: 140 }),
        localFunctionNode(
          'fn-1',
          'Inner Fn',
          {
            nodes: [logNode('inner-log', 'Inner Log', "'y'", { x: 200, y: 200 })],
            edges: [startEdge('inner-log')],
          },
          { x: 420, y: 140 },
        ),
      ],
      edges: [startEdge('log-top')],
    })
    await openTest(page, testId)

    await openSheetForNode(page, 'log-top')
    await dirtySheet(page, 'Edited Top Log')

    // Dirty drill is intercepted (accidental dig-in must not lose edits).
    // The centered sheet can cover the node, so dispatch the dig-in click
    // hit-test-free.
    const digIn = page.locator('[data-testid="workflow-node-fn-1"] [data-testid="node-dig-in"]')
    await digIn.dispatchEvent('click')
    const drillConfirm = page.getByRole('alertdialog', { name: 'Navigate with unsaved changes?' })
    await expect(drillConfirm).toBeVisible({ timeout: 5_000 })

    // Cancel: still at the test root, edits intact.
    await drillConfirm.getByRole('button', { name: 'Cancel' }).click()
    await expect(drillConfirm).toBeHidden()
    await expect(page.locator('[data-testid="workflow-node-inner-log"]')).toHaveCount(0)
    const sheet = page.locator(SHEET)
    await expect(sheet.locator('[data-testid="element-name-input"]')).toHaveValue(
      'Edited Top Log',
    )

    // Confirm: the drill proceeds; the sheet survives out of scope as
    // read-only with its form reset to the saved values.
    await digIn.dispatchEvent('click')
    await expect(drillConfirm).toBeVisible({ timeout: 5_000 })
    await drillConfirm.getByRole('button', { name: 'Discard and Continue' }).click()
    await expect(
      page.locator('[data-testid="workflow-node-inner-log"]'),
    ).toBeVisible({ timeout: 10_000 })

    await expect(sheet).toBeVisible()
    await expect(
      sheet.locator('[data-testid="element-config-read-only-pill"]'),
    ).toBeVisible()
    const nameInput = sheet.locator('[data-testid="element-name-input"]')
    await expect(nameInput).toBeDisabled()
    await expect(nameInput).toHaveValue('Top Log')
    await expect(sheet.getByRole('button', { name: 'Save' })).toHaveCount(0)
    await expect(sheet.getByRole('button', { name: 'Close', exact: true })).toHaveCount(2)

    // Pop back to the test root: the (now clean) sheet re-enables silently.
    await popToBreadcrumbSegment(page, testName)
    await expect(
      page.locator('[data-testid="workflow-node-log-top"]'),
    ).toBeVisible({ timeout: 10_000 })
    await expect(sheet.locator('[data-testid="element-config-read-only-pill"]')).toHaveCount(0)
    await expect(nameInput).toBeEnabled()
    await expect(nameInput).toHaveValue('Top Log')
    await expect(sheet.getByRole('button', { name: 'Save' })).toBeVisible()
  })

  test('S5: dirty breadcrumb pop is guarded the same way', async ({
    page,
    request,
  }) => {
    const testName = seedName('pop')
    const testId = await createValidTest(request, {
      name: testName,
      nodes: [
        localFunctionNode(
          'fn-1',
          'Inner Fn',
          {
            nodes: [logNode('inner-log', 'Inner Log', "'y'", { x: 200, y: 200 })],
            edges: [startEdge('inner-log')],
          },
          { x: 320, y: 160 },
        ),
      ],
      edges: [startEdge('fn-1')],
    })
    await openTest(page, testId)

    // Clean drill: no prompt.
    await page
      .locator('[data-testid="workflow-node-fn-1"] [data-testid="node-dig-in"]')
      .click()
    await expect(
      page.locator('[data-testid="workflow-node-inner-log"]'),
    ).toBeVisible({ timeout: 10_000 })

    await openSheetForNode(page, 'inner-log')
    await dirtySheet(page, 'Edited Inner')

    // Popping out with a dirty sheet prompts; cancel keeps scope + edits.
    await popToBreadcrumbSegment(page, testName)
    const drillConfirm = page.getByRole('alertdialog', { name: 'Navigate with unsaved changes?' })
    await expect(drillConfirm).toBeVisible({ timeout: 5_000 })
    await drillConfirm.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.locator('[data-testid="workflow-node-inner-log"]')).toBeVisible()
    const sheet = page.locator(SHEET)
    await expect(sheet.locator('[data-testid="element-name-input"]')).toHaveValue('Edited Inner')

    // Confirm: back at the root; the inner node is out of scope, so its
    // sheet persists read-only with the form reset.
    await popToBreadcrumbSegment(page, testName)
    await expect(drillConfirm).toBeVisible({ timeout: 5_000 })
    await drillConfirm.getByRole('button', { name: 'Discard and Continue' }).click()
    await expect(
      page.locator('[data-testid="workflow-node-fn-1"]'),
    ).toBeVisible({ timeout: 10_000 })
    await expect(
      sheet.locator('[data-testid="element-config-read-only-pill"]'),
    ).toBeVisible()
    await expect(sheet.locator('[data-testid="element-name-input"]')).toHaveValue('Inner Log')
  })
})
