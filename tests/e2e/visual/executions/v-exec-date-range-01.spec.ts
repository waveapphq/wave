/**
 * V-EXEC-DATE-RANGE-01: Executions list date range filter
 *
 * Verifies the Date filter pill on the Executions list.
 *
 * Pass Criteria:
 * 1. Filter pill labeled "Date" is rendered on the filters row.
 * 2. Clicking the pill opens a popover listing preset options:
 *    All time, Today, Last 7 days, Last 30 days, Last 90 days, Custom range.
 * 3. Picking "Last 7 days" closes the popover and updates the trigger label.
 * 4. Re-opening and picking "Custom range" reveals the calendar view
 *    with Apply / Cancel controls and a Presets back button.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { exec } from '../../helpers/exec'

test.describe('V-EXEC-DATE-RANGE-01: Executions list date range filter', () => {
  // Reuse the v-exec-01 seed so the Executions list has at least one row -
  // with an empty list the page renders in empty-state which disables the
  // filter pill.
  test.beforeAll(() => {
    exec('./tests/e2e/fixtures/executions/v-exec-01/01-seed.sh')
  })

  test('pill -> preset selection -> custom calendar flow', async ({ page }) => {
    await page.goto('/executions')

    const trigger = page.getByTestId('filter-date')
    await expect(trigger, 'Date filter pill rendered').toBeVisible()
    await expect(trigger, 'defaults to "Date" label').toContainText(/^Date$/)

    await trigger.click()

    // Preset list visible with the documented set of options.
    await expect(page.getByRole('dialog')).toBeVisible()
    for (const label of [
      'All time',
      'Today',
      'Last 7 days',
      'Last 30 days',
      'Last 90 days',
      'Custom range',
    ]) {
      await expect(
        page.getByRole('dialog').getByText(label, { exact: true }),
        `preset "${label}" rendered`,
      ).toBeVisible()
    }

    // Picking a preset closes the popover and updates the trigger label.
    await page.getByRole('dialog').getByText('Last 7 days', { exact: true }).click()
    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(trigger).toContainText('Last 7 days')

    // Custom range reveals the calendar + Apply/Cancel controls.
    await trigger.click()
    await page.getByRole('dialog').getByText('Custom range', { exact: true }).click()
    await expect(page.getByRole('dialog').getByRole('button', { name: /apply/i })).toBeVisible()
    await expect(page.getByRole('dialog').getByRole('button', { name: /cancel/i })).toBeVisible()
    await expect(page.getByRole('dialog').getByRole('button', { name: /presets/i })).toBeVisible()
  })
})
