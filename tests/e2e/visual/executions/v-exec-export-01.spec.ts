/**
 * V-EXEC-EXPORT-01: Executions export affordances (row, bulk, detail toolbar)
 *
 * REQ: REQ-5.2.4.9
 * Detail toolbar dialog, row/bulk list parity, shared ExportDialog with a
 * JSON default, and a no-secrets dialog.
 *
 * Pass Criteria:
 * 1. Each executions row exposes an Export icon action next to View.
 * 2. Row Export opens the shared ExportDialog: "Export execution" title,
 *    execution name as description, JSON preselected (YAML offered),
 *    NO Secret values picker, "Download" + Cancel buttons.
 * 3. The bulk-selection menu offers a text-labeled Export item; with one row
 *    selected it opens the same dialog.
 * 4. The detail toolbar Export opens the same dialog (terminal state).
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { exec } from '../../helpers/exec'

const EXECUTION_ID = 'd0000001-0000-0000-0000-000000000001'
const EXECUTION_NAME = 'Authentication Suite'

type Page = import('@playwright/test').Page

async function waitForExecutionsList(page: Page) {
  await page.goto('/executions')
  await expect(page.getByTestId('executions-page')).toBeVisible()
  await expect(
    page.locator('[data-testid="executions-table"] tbody tr').first(),
  ).toBeVisible()
}

async function expectSharedExportDialog(page: Page) {
  const dialog = page.locator('[data-testid="export-dialog"]')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('heading', { level: 2 }), 'single-execution title').toHaveText(
    'Export execution',
  )
  await expect(dialog.locator('p').first(), 'execution name as description').toHaveText(
    EXECUTION_NAME,
  )
  await expect(
    dialog.locator('[data-testid="format-json"]'),
    'JSON preselected (defaultFormat)',
  ).toHaveAttribute('data-state', 'checked')
  await expect(
    dialog.locator('[data-testid="format-yaml"]'),
    'YAML offered but unchecked',
  ).toHaveAttribute('data-state', 'unchecked')
  await expect(
    dialog.locator('[data-testid="secrets-mode-picker"]'),
    'no secret values picker for executions',
  ).toHaveCount(0)
  await expect(dialog.locator('[data-testid="export-button"]')).toHaveText('Download')
  await expect(dialog.getByRole('button', { name: /Cancel/i })).toBeVisible()
  return dialog
}

async function closeDialog(page: Page) {
  const dialog = page.locator('[data-testid="export-dialog"]')
  await dialog.getByRole('button', { name: /Cancel/i }).click()
  await expect(dialog).not.toBeVisible()
}

test.describe('V-EXEC-EXPORT-01: executions export affordances', () => {
  test.beforeAll(() => {
    exec('./tests/e2e/fixtures/executions/v-exec-01/01-seed.sh')
  })

  // Pass Criterion 1: row Export icon action next to View
  test('V-EXEC-EXPORT-01-S1: row exposes an Export action beside View', async ({ page }) => {
    await waitForExecutionsList(page)

    const row = page
      .locator('[data-testid="executions-table"] tbody tr')
      .filter({ hasText: EXECUTION_NAME })
      .first()
    const exportBtn = row.locator('[data-testid="row-action-export"]')
    await expect(exportBtn, 'row Export action visible').toBeVisible()
    await expect(exportBtn).toHaveAttribute('aria-label', `Export ${EXECUTION_NAME}`)

    // Export sits directly after View in the row actions cluster.
    const actionsCell = row.locator('[data-testid="row-action-view"]').locator('..')
    const buttons = actionsCell.locator('button')
    await expect(buttons.nth(0)).toHaveAttribute('data-testid', 'row-action-view')
    await expect(buttons.nth(1)).toHaveAttribute('data-testid', 'row-action-export')
  })

  // Pass Criterion 2: row Export opens the shared dialog
  test('V-EXEC-EXPORT-01-S2: row Export opens the shared dialog (JSON default, no secrets)', async ({
    page,
  }) => {
    await waitForExecutionsList(page)

    await page
      .locator('[data-testid="executions-table"] tbody tr')
      .filter({ hasText: EXECUTION_NAME })
      .first()
      .locator('[data-testid="row-action-export"]')
      .click()
    await expectSharedExportDialog(page)
    await closeDialog(page)
  })

  // Pass Criterion 3: bulk menu Export item
  test('V-EXEC-EXPORT-01-S3: bulk menu offers Export and opens the dialog', async ({ page }) => {
    await waitForExecutionsList(page)

    await page.getByRole('button', { name: /Mass Action/ }).click()
    await page
      .locator('[data-testid="executions-table"] tbody tr')
      .filter({ hasText: EXECUTION_NAME })
      .first()
      .locator('[data-testid="row-checkbox"]')
      .click()

    await page.locator('[data-testid="selection-counter"]').click()
    const bulkExport = page.locator('[data-testid="bulk-action-export"]')
    await expect(bulkExport, 'text-labeled Export item').toBeVisible()
    await expect(bulkExport).toContainText('Export')
    await bulkExport.click()

    await expectSharedExportDialog(page)
    await closeDialog(page)
  })

  // Pass Criterion 4: detail toolbar Export opens the same dialog
  test('V-EXEC-EXPORT-01-S4: detail toolbar Export opens the shared dialog', async ({ page }) => {
    await page.goto(`/executions/${EXECUTION_ID}`)
    await page.waitForSelector('[data-testid="execution-detail-page"]', { state: 'visible' })

    await page.getByRole('button', { name: 'Export', exact: true }).click()
    await expectSharedExportDialog(page)
    await closeDialog(page)
  })
})
