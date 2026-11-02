/**
 * V-FN-VAL-PATHS-01: path-aware validation rows + drill-to-issue navigation.
 * REQ: REQ-3.1.2.4.
 * Design Decisions: CANVAS-215..218
 *
 * A 2-deep nested Local body whose leaf leaves a required param empty surfaces a
 * single path-aware row "Outer_Fn / Inner_Fn / Log_1 - Required parameter
 * 'message' is empty" (the one Block field check, at every depth). Clicking a path segment drills into that Function;
 * clicking the row drills to + focuses the failing leaf; either dismisses the
 * dialog. The same row renders in the save modal.
 *
 * The broken Test is raw-persisted (POST /tests rejects a nested unresolved
 * body with 422). A nested empty required param is an error at load too, so opening
 * the Test surfaces the non-fatal "Test Issues Found" dialog over the loaded
 * canvas - drilling from a row operates on that canvas.
 *
 * Pass Criteria:
 *   1. The dialog renders the root-to-leaf path row (segments + leaf + message).
 *   2. Clicking the "Inner_Fn" segment drills into Inner_Fn and dismisses.
 *   3. Clicking the row drills to + selects the failing leaf and dismisses.
 *   4. The save modal ("Cannot Save Test") surfaces the same path row.
 */

import { test, expect, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { dragPaletteItemToCanvas } from '../../helpers/canvas'
import {
  rawPersistTest,
  logNode,
  localFunctionNode,
  startEdge,
  openTest,
  dismissLoadDialogIfPresent,
  VALIDATION,
} from '../../helpers/fn-seed'

const PATH_MESSAGE = "Required parameter 'message' is empty"
const BREADCRUMB = '[data-testid="breadcrumb-path"]'

/** Outer_Fn > Inner_Fn > Log_1 (Log_1 has an empty - required - message). */
async function seedNested(request: APIRequestContext): Promise<string> {
  const leaf = logNode('log-1', 'Log_1', '')
  const inner = localFunctionNode('inner-fn', 'Inner_Fn', {
    nodes: [leaf],
    edges: [startEdge('log-1')],
  })
  const outer = localFunctionNode('outer-fn', 'Outer_Fn', {
    nodes: [inner],
    edges: [startEdge('inner-fn')],
  })
  return rawPersistTest(request, {
    name: `V-FN-VAL-PATHS-01 ${Date.now()}`,
    nodes: [outer],
    edges: [startEdge('outer-fn')],
  })
}

test.describe('V-FN-VAL-PATHS-01: path-aware rows + drill navigation', () => {
  test('the validation dialog renders the root-to-leaf path row', async ({ page, request }) => {
    const testId = await seedNested(request)
    await openTest(page, testId)

    const dialog = page.locator(VALIDATION.dialog)
    await expect(dialog).toBeVisible({ timeout: 15_000 })

    const row = dialog.locator('tr', { hasText: PATH_MESSAGE })
    await expect(row).toBeVisible()
    await expect(row.getByRole('button', { name: 'Outer_Fn', exact: true })).toBeVisible()
    await expect(row.getByRole('button', { name: 'Inner_Fn', exact: true })).toBeVisible()
    await expect(row.getByRole('button', { name: 'Log_1', exact: true })).toBeVisible()
    await expect(row).toContainText(PATH_MESSAGE)
    // Order: Outer_Fn / Inner_Fn / Log_1 - <message> (separators may render
    // without surrounding whitespace, so allow optional spacing).
    const normalized = (await row.innerText()).replace(/\s+/g, ' ').trim()
    expect(normalized).toMatch(
      /Outer_Fn\s*\/\s*Inner_Fn\s*\/\s*Log_1\s*-\s*Required parameter 'message' is empty/,
    )
  })

  test('clicking the Inner_Fn segment drills into that Function and dismisses', async ({
    page,
    request,
  }) => {
    const testId = await seedNested(request)
    await openTest(page, testId)

    const dialog = page.locator(VALIDATION.dialog)
    await expect(dialog).toBeVisible({ timeout: 15_000 })
    const row = dialog.locator('tr', { hasText: PATH_MESSAGE })
    await row.getByRole('button', { name: 'Inner_Fn', exact: true }).click()

    await expect(dialog).toBeHidden({ timeout: 10_000 })
    // Drilled into Inner_Fn: breadcrumb names it and its body (Log_1) is shown.
    await expect(page.locator(BREADCRUMB)).toContainText('Inner_Fn')
    await expect(page.locator('[data-testid="workflow-node-log-1"]')).toBeVisible({ timeout: 10_000 })
  })

  test('clicking the row drills to + focuses the failing leaf and dismisses', async ({
    page,
    request,
  }) => {
    const testId = await seedNested(request)
    await openTest(page, testId)

    const dialog = page.locator(VALIDATION.dialog)
    await expect(dialog).toBeVisible({ timeout: 15_000 })
    const row = dialog.locator('tr', { hasText: PATH_MESSAGE })
    await row.getByRole('button', { name: 'Log_1', exact: true }).click()

    await expect(dialog).toBeHidden({ timeout: 10_000 })
    await expect(page.locator(BREADCRUMB)).toContainText('Inner_Fn')
    const leaf = page.locator('[data-testid="workflow-node-log-1"]')
    await expect(leaf).toBeVisible({ timeout: 10_000 })
    await expect(leaf).toHaveAttribute('data-selected', 'true')
  })

  test('the save modal surfaces the same path row', async ({ page, request }) => {
    const testId = await seedNested(request)
    await openTest(page, testId)
    await dismissLoadDialogIfPresent(page)

    // Dirty the canvas so Save is enabled, then trigger a save - the nested
    // missing-param blocks the save with the same path row (save-context parity).
    const canvas = page.locator('[data-testid="workflow-canvas"]')
    const box = await canvas.boundingBox()
    expect(box).toBeTruthy()
    await dragPaletteItemToCanvas(page, 'delay', { x: box!.width * 0.5, y: box!.height * 0.6 })

    const saveBtn = page.locator('[data-testid="toolbar-save-button"]')
    await expect(saveBtn).toBeEnabled({ timeout: 10_000 })
    await saveBtn.click()

    const dialog = page.locator(VALIDATION.dialog)
    await expect(dialog).toBeVisible({ timeout: 10_000 })
    await expect(dialog).toContainText('Cannot Save Test')
    const row = dialog.locator('tr', { hasText: PATH_MESSAGE })
    await expect(row.getByRole('button', { name: 'Inner_Fn', exact: true })).toBeVisible()
    await expect(row).toContainText(PATH_MESSAGE)
  })
})
