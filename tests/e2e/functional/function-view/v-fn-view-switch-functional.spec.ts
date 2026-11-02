/**
 * V-FN-VIEW-SWITCH (functional): unsaved-changes protection covers Tests AND
 * Functions across all four open combinations and both dialog entry points.
 *
 * Opening a Function never silently discards a dirty Test: use-function-view confirms
 * (dirty -> shared dialog), the dialog takes entityKind + names the CURRENTLY-OPEN entity,
 * and the action line names the target generically ("a different workflow").
 *
 * Entry points exercised (BOTH required):
 *   - tests-list dialog (use-test-dialogs): opening a Test from the list.
 *   - workbench dialog (use-function-view / ?viewFunction guard): opening a
 *     Function from its detail page.
 *
 * REQ: REQ-3.2.1.1
 *
 * Pass Criteria (the currently-open entity drives the wording):
 *   1. test -> test : "The test"   + Save & Open New + "a different workflow".
 *   2. test -> func : "The test"   + Save & Open New (NOT a silent discard).
 *   3. func -> func : "The function" + no Save + Keep Editing.
 *   4. func -> test : "The function" + no Save.
 *
 * Phase: functional-workflow. Self-seeds Functions + Tests via REST.
 */

import { test, expect, type Page, type APIRequestContext } from '../../helpers/playwright-fixtures'
import {
  publishLibraryFunction,
  openFunctionView,
  openTest,
  createValidTest,
  logNode,
  startEdge,
  type SeededLibraryFunction,
} from '../../helpers/fn-seed'
import { randomUUID } from 'node:crypto'

function seedFunction(request: APIRequestContext, label: string): Promise<SeededLibraryFunction> {
  return publishLibraryFunction(request, {
    name: `View-Switch-${label}-${randomUUID().slice(0, 6)}`,
    workflow: { nodes: [logNode('body-log', 'Body', "'hi'")], edges: [startEdge('body-log')] },
  })
}

interface SeededTest {
  id: string
  name: string
}

async function seedTestEntity(request: APIRequestContext, label: string): Promise<SeededTest> {
  const name = `View-Switch-${label}-${randomUUID().slice(0, 6)}`
  const id = await createValidTest(request, {
    name,
    nodes: [logNode('t-log', 'TestLog', "'hi'")],
    edges: [startEdge('t-log')],
  })
  return { id, name }
}

/** Drag a node to dirty the in-memory workbench, retrying the whole drag until it
 *  registers. A synthetic drag can move the node visually without committing the
 *  position (canvas stays clean, Save disabled) under parallel-shard load, so an
 *  optional confirmTestId keeps re-dragging until that control becomes enabled. */
async function dragNode(page: Page, nodeId: string, confirmTestId?: string): Promise<void> {
  const dx = 70
  const dy = 50
  const node = page.locator(`[data-testid="workflow-node-${nodeId}"]`)
  await expect(async () => {
    const box = await node.boundingBox()
    if (!box) throw new Error(`node ${nodeId} not found for drag`)
    const sx = box.x + box.width / 2
    const sy = box.y + box.height / 2
    await page.mouse.move(sx, sy)
    await page.mouse.down()
    for (let i = 1; i <= 8; i++) await page.mouse.move(sx + (dx * i) / 8, sy + (dy * i) / 8)
    await page.mouse.up()
    const moved = await node.boundingBox()
    if (!moved || Math.abs(moved.x - box.x) < 5) throw new Error('drag did not register; retrying')
    if (confirmTestId) {
      await expect(page.locator(`[data-testid="${confirmTestId}"]`)).toBeEnabled({ timeout: 1500 })
    }
  }).toPass({ timeout: 15_000 })
  await page.waitForTimeout(200)
}

async function openDirtyTest(page: Page, testId: string): Promise<void> {
  await openTest(page, testId)
  await dragNode(page, 't-log', 'toolbar-save-button')
  await expect(page.locator('[data-testid="toolbar-save-button"]')).toBeEnabled()
}

async function openDirtyFunctionView(page: Page, fn: SeededLibraryFunction): Promise<void> {
  await openFunctionView(page, fn.functionId, fn.version)
  await page.locator('[data-testid="action-bar-edit-function-button"]').click()
  await expect(page.locator('[data-testid="action-bar-publish-button"]')).toBeVisible({ timeout: 15_000 })
  await dragNode(page, 'body-log')
}

/** Open a Function from the list CLIENT-SIDE (preserving the dirty store) so the
 *  ?viewFunction workbench guard fires. */
async function openFunctionFromList(page: Page, fnName: string): Promise<void> {
  await page.locator('a[href="/functions"]').first().click()
  await expect(page.locator('[data-testid="functions-page"]')).toBeVisible()
  await page.locator('[data-testid="search-input"] input').fill(fnName)
  const cell = page.locator('[data-testid="function-name"]').filter({ hasText: fnName })
  await expect(cell).toBeVisible()
  await cell.click()
  await expect(page.locator('[data-testid="function-detail-page"]')).toBeVisible()
  await page.locator('[data-testid="view-workflow"]').click()
}

/** Open a Test from the list CLIENT-SIDE so the tests-list switch guard fires. */
async function openTestFromList(page: Page, target: SeededTest): Promise<void> {
  await page.locator('a[href="/tests"]').first().click()
  await expect(page.locator('[data-testid="tests-page"]')).toBeVisible()
  await page.locator('[data-testid="search-input"] input').fill(target.name)
  const cell = page.locator(`[data-testid="test-row"][data-row-id="${target.id}"] [data-testid="test-name"]`)
  await expect(cell).toBeVisible()
  await cell.click()
}

async function expectSwitchDialog(page: Page, entity: 'test' | 'function'): Promise<void> {
  const dialog = page.locator('[data-testid="switch-test-dialog"]')
  await expect(dialog).toBeVisible({ timeout: 10_000 })
  if (entity === 'test') {
    await expect(dialog).toContainText('The test')
    await expect(dialog).not.toContainText('The function')
    await expect(dialog.getByRole('button', { name: 'Save & Open New' })).toBeVisible()
    // The action line names the target generically (NOT "a different test").
    await expect(dialog).toContainText('To open a different workflow')
    await expect(dialog).not.toContainText('a different test')
  } else {
    await expect(dialog).toContainText('The function')
    await expect(dialog).not.toContainText('The test')
    // A dirty Function offers Discard or Keep Editing only - no quick-save.
    await expect(dialog.getByRole('button', { name: 'Save & Open New' })).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: 'Keep Editing' })).toBeVisible()
    await expect(dialog).toContainText('Publish the function')
  }
}

test.describe('V-FN-VIEW-SWITCH (functional): dirty-switch protection across Tests + Functions', () => {
  test('test -> test: tests-list dialog, Test wording + Save', async ({ page, request }) => {
    const testA = await seedTestEntity(request, 'A')
    const testB = await seedTestEntity(request, 'B')
    await openDirtyTest(page, testA.id)
    await openTestFromList(page, testB)
    await expectSwitchDialog(page, 'test')
  })

  test('test -> func: workbench dialog, Test wording + Save (no silent discard)', async ({ page, request }) => {
    const testA = await seedTestEntity(request, 'C')
    const fn = await seedFunction(request, 'D')
    await openDirtyTest(page, testA.id)
    await openFunctionFromList(page, fn.name)
    await expectSwitchDialog(page, 'test')
  })

  test('func -> func: workbench dialog, Function wording, no Save', async ({ page, request }) => {
    const fn1 = await seedFunction(request, 'E')
    const fn2 = await seedFunction(request, 'F')
    await openDirtyFunctionView(page, fn1)
    await openFunctionFromList(page, fn2.name)
    await expectSwitchDialog(page, 'function')
  })

  test('func -> test: tests-list dialog, Function wording, no Save', async ({ page, request }) => {
    const fn = await seedFunction(request, 'G')
    const testA = await seedTestEntity(request, 'H')
    await openDirtyFunctionView(page, fn)
    await openTestFromList(page, testA)
    await expectSwitchDialog(page, 'function')
  })
})
