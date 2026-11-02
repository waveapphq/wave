/**
 * V-ROOT-VAR-DELETE-CONFIRM: deleting a referenced root (Test) variable opens
 * the Delete-variable confirmation dialog.
 */

import { test, expect, type Page, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT } from '../../helpers/config'
import fs from 'fs'
import path from 'path'

const BASE = `http://localhost:${BACKEND_PORT}`

function loadFixture(): Record<string, unknown> {
  const fixture = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixture.json'), 'utf-8'))
  return { ...fixture, name: `V-ROOT-VAR-DELETE-CONFIRM ${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }
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

test.describe('Root variable delete confirmation', () => {
  test('deleting `mytest` (referenced by Log) opens the Delete-variable dialog', async ({ page, request }) => {
    const testId = await seedFixture(request)
    await openTest(page, testId)

    // Root variable row is rendered in the Variable Manager.
    const row = page.locator('[data-testid^="variable-row-"]').filter({ hasText: 'mytest' }).first()
    await expect(row).toBeVisible()

    // Hover the row to reveal the delete affordance, then click it.
    await row.hover()
    await row.locator('button[data-testid^="delete-button-"]').click()

    // Confirmation dialog opens with "The variable is used by 1 block".
    const dialog = page.getByRole('alertdialog').filter({ hasText: /^Delete\b/ })
    await expect(dialog).toBeVisible({ timeout: 5_000 })
    await expect(dialog).toContainText('variable is used by 1')
  })

  test('deleting an unreferenced root variable also opens the Delete-variable dialog (defensive UX)', async ({ page, request }) => {
    const testId = await seedFixture(request)
    await openTest(page, testId)

    // Create a second root variable via the + Add button, then immediately delete it.
    // "+ Add" opens the floating create modal (not the legacy scalar dialog).
    await page.locator('[data-testid="add-variable-button"]').click()
    const createDialog = page.locator('[data-testid="variable-create-modal"]')
    await expect(createDialog).toBeVisible()
    await createDialog.locator('[data-testid="create-variable-name"]').fill('unused_var')
    await createDialog.locator('[data-testid="create-submit-button"]').click()
    await expect(createDialog).toBeHidden({ timeout: 5_000 })

    const row = page.locator('[data-testid^="variable-row-"]').filter({ hasText: 'unused_var' }).first()
    await expect(row).toBeVisible()

    await row.hover()
    await row.locator('button[data-testid^="delete-button-"]').click()

    // The confirm modal opens even when no refs exist.
    const dialog = page.getByRole('alertdialog').filter({ hasText: /^Delete\b/ })
    await expect(dialog).toBeVisible({ timeout: 5_000 })
  })
})
