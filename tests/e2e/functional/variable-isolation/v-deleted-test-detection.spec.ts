/**
 * Deleted Test Detection E2E Test
 *
 * The test open in the workbench is gone from the server. Every surface that
 * meets that answer - a resumed load, Run, Debug, Run Scope, Debug Scope,
 * right-click Run Current, and Save - opens the "Test not found" dialog
 * instead of a generic toast, and dismissing it leaves an empty canvas that is
 * usable straight away. Every OTHER failure still goes to the generic toast.
 *
 * The dialog has two variants, and picking the wrong one loses the user's
 * work: a clean canvas offers Close, a dirty canvas offers Keep on canvas
 * beside a destructive Discard changes, and Escape takes the keep. Both the
 * label, the variant class and the body text are asserted here, and they
 * mirror the unit test at
 * frontend/tests/features/workbench/live/workbench-dialogs.test.tsx.
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { dragPaletteItemToCanvas, waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_URL } from '../../helpers/config'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import { failApiRoute } from '../../helpers/api-route'
import { testValidateRoute } from '../../helpers/page-block'
import { clickNodeContextMenuItem, saveBtn, selectEnvironment } from '../../helpers/workbench'
import fs from 'fs'
import path from 'path'

/** Clean-canvas body, minus the leading test name the dialog interpolates. */
const CLEAN_BODY = 'is no longer on the server. Close clears the canvas and starts a new draft.'

/** Dirty-canvas body, minus the leading test name. */
const DIRTY_BODY =
  'is no longer on the server, so your changes cannot be saved to it. ' +
  'Discarding them clears the canvas and starts a new draft; they cannot be recovered.'

/** The generic pre-run toast every NON-404 failure must still show. */
const PRERUN_TOAST = 'Failed to validate test before running.'

function loadFixture(): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.resolve(__dirname, 'deleted-test.fixture.json'), 'utf-8'),
  ) as Record<string, unknown>
}

function deletedModal(page: Page) {
  return page.locator('[data-testid="deleted-test-modal"]')
}

function workflowNodes(page: Page) {
  return page.locator('[data-testid^="workflow-node-"][data-nodetype]')
}

function loadingOverlay(page: Page) {
  return page.locator('[data-testid="canvas-loading-overlay"]')
}

async function createTest(
  request: { post: (url: string, options: any) => Promise<any> },
  name: string,
): Promise<string> {
  const resp = await request.post(`${BACKEND_URL}/tests`, {
    data: { name, description: `Deleted test detection: ${name}` },
  })
  expect(resp.ok(), `Failed to create test "${name}": ${resp.status()}`).toBeTruthy()
  const body = await resp.json()
  return body.data?.id || body.id
}

async function deleteTest(
  request: { delete: (url: string) => Promise<any> },
  testId: string,
): Promise<void> {
  const resp = await request.delete(`${BACKEND_URL}/tests/${testId}`)
  expect(resp.ok(), `Failed to delete test: ${resp.status()}`).toBeTruthy()
}

/** Open the one-block fixture, pick the run environment, then delete the test
 *  from storage behind the workbench's back. Nothing polls the test, so the
 *  dialog cannot appear until the user presses something. */
async function openFixtureThenDeleteIt(page: Page): Promise<string> {
  const testId = await importValidateAndNavigate(page, loadFixture())
  await selectEnvironment(page)
  await expect(workflowNodes(page)).toHaveCount(1)
  await expect(deletedModal(page)).toHaveCount(0)
  await deleteTest(page.request, testId)
  return testId
}

async function expectCleanVariant(page: Page): Promise<void> {
  const dialog = deletedModal(page)
  await expect(dialog).toBeVisible({ timeout: 15000 })
  await expect(dialog.getByRole('heading', { name: 'Test not found' })).toBeVisible()
  await expect(dialog).toContainText(CLEAN_BODY)
  // The copy must not claim the user was away: the user is the one pressing the button.
  await expect(dialog).not.toContainText(/while you were away/i)
  const action = dialog.getByRole('button')
  await expect(action).toHaveCount(1)
  await expect(action).toHaveText('Close')
  await expect(action).toHaveClass(/btn-primary/)
  await expect(action).not.toHaveClass(/btn-danger/)
}

async function expectNoPreRunToast(page: Page): Promise<void> {
  await expect(page.locator('[data-toast]', { hasText: PRERUN_TOAST })).toHaveCount(0)
}

/** Dismiss the dialog and prove the workbench is immediately usable: an empty
 *  unnamed canvas, with no "Preparing workbench" overlay left over it. */
async function dismissAndExpectFreshCanvas(page: Page, label: string): Promise<void> {
  await deletedModal(page).getByRole('button', { name: label }).click()
  await expect(deletedModal(page)).toHaveCount(0)
  await expect(page.locator('[data-testid="canvas-page"]')).toBeVisible()
  await expect(page.locator('[data-testid="canvas-breadcrumb"]')).toContainText('Draft Workflow')
  await expect(workflowNodes(page)).toHaveCount(0)
  await expect(loadingOverlay(page)).toHaveClass(/opacity-0/)
  await expect(loadingOverlay(page)).toHaveClass(/pointer-events-none/)
}

test.describe('Deleted Test Detection', () => {

  test('shows modal when returning to workbench after test was deleted, Close goes to Draft', async ({ page, request }) => {
    const testId = await createTest(request, 'Delete Detection Test')

    // A finished run left in the server session gates ?editTest behind the switch dialog.
    await page.request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => {})
    await page.goto(`/workbench?editTest=${testId}`)
    await page.evaluate(() => localStorage.clear())
    await page.goto(`/workbench?editTest=${testId}`)
    await waitForCanvasLoad(page)

    await expect(page.getByText('Delete Detection Test')).toBeVisible()

    // Delete the test via API (simulates deletion from another tab)
    await deleteTest(request, testId)

    const modal = page.locator('[data-testid="deleted-test-modal"]')

    // Either (a) detection fires immediately after delete and the modal is
    // already visible, or (b) detection fires on the next /workbench re-entry
    // via the sidebar round-trip. Both are valid user flows. Give the
    // immediate-detection path a short window to open the modal before
    // attempting the sidebar round-trip.
    await page.waitForTimeout(500)
    if (!(await modal.isVisible().catch(() => false))) {
      // Navigate away via sidebar (SPA navigation). Use force to sidestep
      // the brief Radix dialog overlay if detection races with our click.
      await page.locator('[data-testid="sidebar"] a[href="/suites"]').click({ force: true })
      await expect(page.locator('h1')).toBeVisible()

      // Return to workbench via sidebar
      await page.locator('[data-testid="sidebar"] a[href="/workbench"]').click({ force: true })
    }

    // Modal should appear
    await expect(modal).toBeVisible({ timeout: 10000 })
    await expect(modal).toContainText(CLEAN_BODY)
    await expect(modal).not.toContainText(/while you were away/i)

    // Click Close - should go to Draft Workflow
    await page.getByRole('button', { name: 'Close' }).click()
    await expect(modal).not.toBeVisible()

    // Should show Draft Workflow (empty workbench, no test loaded)
    await expect(page.locator('[data-testid="canvas-page"]')).toBeVisible()

    // The canvas is usable, not stuck behind the preparing-workbench overlay:
    // the dismiss asks for a fit view, which is what fades the overlay out.
    await expect(page.locator('[data-testid="canvas-loading-overlay"]')).toHaveClass(
      /opacity-0/,
    )
  })

  test('Run on a deleted test opens the dialog, and Close leaves an empty canvas a reload keeps', async ({ page }) => {
    await openFixtureThenDeleteIt(page)

    await page.locator('[data-testid="run-button"]').click()

    await expectCleanVariant(page)
    await expectNoPreRunToast(page)
    await dismissAndExpectFreshCanvas(page, 'Close')

    await page.reload()
    await waitForCanvasLoad(page)
    await expect(deletedModal(page)).toHaveCount(0)
    await expect(page.locator('[data-testid="canvas-breadcrumb"]')).toContainText('Draft Workflow')
    await expect(workflowNodes(page)).toHaveCount(0)
  })

  test('Debug on a deleted test opens the dialog, not the toast', async ({ page }) => {
    await openFixtureThenDeleteIt(page)

    await page.locator('[data-testid="debug-button"]').click()

    await expectCleanVariant(page)
    await expectNoPreRunToast(page)
    await dismissAndExpectFreshCanvas(page, 'Close')
  })

  test('Run Scope on a deleted test opens the dialog, not the toast', async ({ page }) => {
    await openFixtureThenDeleteIt(page)

    await page.locator('[data-testid="run-button-dropdown"]').click()
    const option = page.locator('[data-testid="run-current-option"]')
    await expect(option).toBeVisible()
    await option.click()

    await expectCleanVariant(page)
    await expectNoPreRunToast(page)
    await dismissAndExpectFreshCanvas(page, 'Close')
  })

  test('Debug Scope on a deleted test opens the dialog, not the toast', async ({ page }) => {
    await openFixtureThenDeleteIt(page)

    await page.locator('[data-testid="debug-button-dropdown"]').click()
    const option = page.locator('[data-testid="debug-current-option"]')
    await expect(option).toBeVisible()
    await option.click()

    await expectCleanVariant(page)
    await expectNoPreRunToast(page)
    await dismissAndExpectFreshCanvas(page, 'Close')
  })

  test('right-click Run Current on a deleted test opens the dialog, not the toast', async ({ page }) => {
    await openFixtureThenDeleteIt(page)

    await clickNodeContextMenuItem(page, 'delay-only', 'Run Current')

    await expectCleanVariant(page)
    await expectNoPreRunToast(page)
    await dismissAndExpectFreshCanvas(page, 'Close')
  })

  test('a non-404 pre-run failure still shows the generic toast and no dialog', async ({ page }) => {
    const testId = await importValidateAndNavigate(page, loadFixture())
    await selectEnvironment(page)
    await failApiRoute(
      page,
      testValidateRoute(testId),
      { status: 503, detail: 'Validation is unavailable' },
      'POST',
    )

    await page.locator('[data-testid="run-button"]').click()

    await expect(page.locator('[data-toast]', { hasText: PRERUN_TOAST })).toBeVisible({
      timeout: 15000,
    })
    await expect(deletedModal(page)).toHaveCount(0)
  })

  test('a dropped connection on the pre-run check still shows the generic toast and no dialog', async ({ page }) => {
    const testId = await importValidateAndNavigate(page, loadFixture())
    await selectEnvironment(page)
    // No shared helper aborts a route; failApiRoute only fulfills a status.
    await page.route(testValidateRoute(testId), (route) => route.abort('failed'))

    await page.locator('[data-testid="run-button"]').click()

    await expect(page.locator('[data-toast]', { hasText: PRERUN_TOAST })).toBeVisible({
      timeout: 15000,
    })
    await expect(deletedModal(page)).toHaveCount(0)
  })

  test('Save on a dirty canvas offers a destructive Discard changes and keeps the work on screen', async ({ page }) => {
    await openFixtureThenDeleteIt(page)

    const box = await page.locator('[data-testid="workflow-canvas"]').boundingBox()
    await dragPaletteItemToCanvas(page, 'delay', { x: box!.width * 0.5, y: box!.height * 0.6 })
    await expect(workflowNodes(page)).toHaveCount(2)
    await expect(saveBtn(page)).toBeEnabled()

    await saveBtn(page).click()

    const dialog = deletedModal(page)
    await expect(dialog).toBeVisible({ timeout: 15000 })
    await expect(dialog.getByRole('heading', { name: 'Test not found' })).toBeVisible()
    await expect(dialog).toContainText(DIRTY_BODY)
    await expect(dialog).not.toContainText(CLEAN_BODY)
    await expect(dialog).not.toContainText(/while you were away/i)

    const actions = dialog.getByRole('button')
    await expect(actions).toHaveCount(2)
    await expect(actions.nth(0)).toHaveText('Keep on canvas')
    await expect(actions.nth(0)).toHaveClass(/btn-secondary/)
    await expect(actions.nth(0)).not.toHaveClass(/btn-danger/)
    await expect(actions.nth(1)).toHaveText('Discard changes')
    await expect(actions.nth(1)).toHaveClass(/btn-danger/)

    // The work is still on the canvas while the dialog is up - nothing is
    // dropped until the user chooses to discard it.
    await expect(workflowNodes(page)).toHaveCount(2)

    await dismissAndExpectFreshCanvas(page, 'Discard changes')
  })

  test('Keep on canvas leaves the work in place, ready to save as a new test', async ({ page }) => {
    await openFixtureThenDeleteIt(page)

    const box = await page.locator('[data-testid="workflow-canvas"]').boundingBox()
    await dragPaletteItemToCanvas(page, 'delay', { x: box!.width * 0.5, y: box!.height * 0.6 })
    await expect(workflowNodes(page)).toHaveCount(2)

    await saveBtn(page).click()

    const dialog = deletedModal(page)
    await expect(dialog).toBeVisible({ timeout: 15000 })
    await dialog.getByRole('button', { name: 'Keep on canvas' }).click()

    await expect(deletedModal(page)).toHaveCount(0)
    await expect(workflowNodes(page)).toHaveCount(2)
    await expect(page.locator('[data-testid="canvas-breadcrumb"]')).toContainText('Draft Workflow')

    // The canvas is no longer bound to the deleted test, so Save asks for a new one.
    await expect(saveBtn(page)).toBeEnabled()
    await saveBtn(page).click()
    await expect(page.locator('[role="dialog"]').locator('h2')).toHaveText('New Test')
  })

  test('Escape on the dirty dialog keeps the work, and never discards it', async ({ page }) => {
    await openFixtureThenDeleteIt(page)

    const box = await page.locator('[data-testid="workflow-canvas"]').boundingBox()
    await dragPaletteItemToCanvas(page, 'delay', { x: box!.width * 0.5, y: box!.height * 0.6 })
    await expect(workflowNodes(page)).toHaveCount(2)

    await saveBtn(page).click()
    await expect(deletedModal(page)).toBeVisible({ timeout: 15000 })

    await page.keyboard.press('Escape')

    await expect(deletedModal(page)).toHaveCount(0)
    await expect(workflowNodes(page)).toHaveCount(2)
    await expect(page.locator('[data-testid="canvas-breadcrumb"]')).toContainText('Draft Workflow')
  })

  test('Save on a clean canvas offers a non-destructive Close', async ({ page }) => {
    await openFixtureThenDeleteIt(page)

    // Clean canvas: the toolbar Save is disabled, so the shortcut is the way in.
    await expect(saveBtn(page)).toBeDisabled()
    await page.keyboard.press('Control+s')

    await expectCleanVariant(page)
    await expect(page.locator('[data-toast]', { hasText: 'Save Failed' })).toHaveCount(0)
    await dismissAndExpectFreshCanvas(page, 'Close')
  })
})
