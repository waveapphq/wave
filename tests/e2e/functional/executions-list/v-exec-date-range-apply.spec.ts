/**
 * Date-range filter actually filters the executions list.
 *
 * Preset "Last 7 days" hides executions older than 7 days.
 * Custom range apply updates the trigger label and persists via the
 *     URL query param, so reload keeps the filter active.
 *
 * The existing visual test `v-exec-date-range-01.spec.ts` covers the UI
 * surface (pill -> popover -> preset list -> custom calendar). This test
 * drives the filter end-to-end: picking a preset must actually shrink the
 * rendered rows, and picking a custom range must survive a reload.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { exec } from '../../helpers/exec'

const RECENT_ROW_NAME = 'Recent Run'
const OLD_ROW_NAME = 'Ancient Run'

test.describe('Date range filter applies to Executions list', () => {
  test.beforeAll(() => {
    exec('./tests/e2e/fixtures/executions/v-exec-date-range-apply/01-seed.sh')
  })

  test('"Last 7 days" preset hides the 120-day-old row', async ({ page }) => {
    await page.goto('/executions')

    // Default state is "all time" (filter trigger reads "Date"). Both
    // seeded rows must be visible before we touch the filter - if a
    // prior test leaked state, this assertion fails with a clear
    // message so the root cause is obvious, rather than the "Last 7
    // days" click becoming a no-op downstream.
    const recentRow = page
      .getByTestId('execution-name')
      .filter({ hasText: new RegExp(`^${RECENT_ROW_NAME}$`) })
    const oldRow = page
      .getByTestId('execution-name')
      .filter({ hasText: new RegExp(`^${OLD_ROW_NAME}$`) })
    await expect(recentRow.first(), 'recent row visible before filter').toBeVisible()
    await expect(oldRow.first(), 'ancient row visible before filter').toBeVisible()

    // Pick "Last 7 days" - assert the popover closes and the old row
    // disappears.
    const trigger = page.getByTestId('filter-date')
    await trigger.click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await dialog.getByText('Last 7 days', { exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(trigger).toContainText('Last 7 days')

    await expect(recentRow.first(), 'recent row still visible after filter').toBeVisible()
    await expect(oldRow, 'old row hidden by Last-7-days preset').toHaveCount(0)
    await expect(page).toHaveURL(/date=preset%3Alast-7|date=preset:last-7/)
  })

  test('Custom range apply updates label and persists through reload', async ({ page }) => {
    // Force all-time dateRange on the URL so filter state cannot
    // leak in from another test in the worker context. Container
    // reads the `date` query param (see container.tsx:92).
    await page.goto('/executions?date=')
    const trigger = page.getByTestId('filter-date')
    await trigger.click()

    const dialog = page.getByRole('dialog')
    await dialog.getByText('Custom range', { exact: true }).click()

    // Radix Calendar renders each day as `<button role="gridcell">` with
    // the full date as its accessible name (e.g. "Wednesday, April 22,
    // 2026"). Picking today by aria-label is more robust than matching
    // the numeric label text which also fires on neighboring-month
    // buttons.
    const today = new Date()
    const monthName = today.toLocaleString('en-US', { month: 'long' })
    const dayNum = today.getDate()
    const yearNum = today.getFullYear()
    const todayAriaRegex = new RegExp(`${monthName} ${dayNum}.*${yearNum}`, 'i')

    // Click today twice to produce a 1-day range (start + end on the
    // same day). The picker enables Apply once both ends are set.
    const todayCell = dialog.getByRole('button', { name: todayAriaRegex }).first()
    await todayCell.click()
    await todayCell.click()

    const apply = dialog.getByRole('button', { name: /^apply$/i })
    await expect(apply, 'Apply enabled once a range is selected').toBeEnabled()
    await apply.click()

    await expect(dialog).toBeHidden()
    // Trigger label: MMM d (current-year dates skip the year segment;
    // see formatRangeLabel in date-range-picker.tsx).
    await expect(trigger).toContainText(/\w{3}\s+\d{1,2}/)
    // URL query is `date=custom:<fromISO>~<toISO>` - the container
    // stores it under `date`, not `dateRange` (see container.tsx:250).
    await expect(page).toHaveURL(/date=custom/)

    // Reload - the query param drives state so the filter must persist.
    await page.reload()
    await expect(trigger).toContainText(/\w{3}\s+\d{1,2}/)
    await expect(page).toHaveURL(/date=custom/)
    // Recent row (today) stays visible; old row stays hidden.
    const recentRow = page
      .getByTestId('execution-name')
      .filter({ hasText: new RegExp(`^${RECENT_ROW_NAME}$`) })
    const oldRow = page
      .getByTestId('execution-name')
      .filter({ hasText: new RegExp(`^${OLD_ROW_NAME}$`) })
    await expect(recentRow.first()).toBeVisible()
    await expect(oldRow).toHaveCount(0)
  })
})
