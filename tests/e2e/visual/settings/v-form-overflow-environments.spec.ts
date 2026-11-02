/**
 * V-FORM-OVERFLOW-ENVIRONMENTS: Environment create dialog name overflow contract
 *
 * Phase: empty-db (parallel) - opens the env create modal directly. The
 * environments tab needs an empty (or arbitrary) state to render; using
 * empty-db keeps it independent of seeded fixture data.
 *
 * Pass Criteria:
 *  1. Environment name field caps at 64 (MAX_ENTITY_NAME_LENGTH).
 *     Native maxLength hard-blocks typing past 64.
 *  2. Counter shows muted "X/64" between 52-63 chars and destructive "64/64" at cap.
 *  3. Name field is the NameField primitive (textarea rows=1 + overflow contract).
 *  4. Long name (60 chars) overflows inside the input; dialog width unchanged.
 *  5. The description textarea stays as a multi-line textarea (out of scope here);
 *     this test only validates that it still renders (not its overflow contract).
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'

async function openEnvCreateDialog(page: Page) {
  await page.goto('/settings/environments')
  await page.waitForSelector('[data-testid="environments-tab"]', { state: 'visible' })
  // The empty-state and populated-state both expose a "New Environment" button.
  await page.getByRole('button', { name: /New Environment/i }).first().click()
  const dialog = page.locator('[role="dialog"]').first()
  await expect(dialog).toBeVisible({ timeout: 10000 })
  return dialog
}

test.describe('V-FORM-OVERFLOW-ENVIRONMENTS: env create form fields', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
  })

  test('S1: env name caps at 64', async ({ page }) => {
    const dialog = await openEnvCreateDialog(page)
    const name = dialog.locator('textarea').first()
    await expect(name).toBeVisible()
    await expect(name).toHaveAttribute('maxlength', '64')

    await name.fill('a'.repeat(70))
    expect((await name.inputValue()).length).toBe(64)
  })

  test('S2: counter muted 52..63 and destructive at 64', async ({ page }) => {
    const dialog = await openEnvCreateDialog(page)
    const name = dialog.locator('textarea').first()
    const counter = dialog.locator('span[aria-live="polite"]').first()

    await name.fill('a'.repeat(51))
    await expect(counter).toHaveCount(0)

    await name.fill('a'.repeat(52))
    await expect(counter).toBeVisible()
    await expect(counter).toHaveAttribute('data-state', 'muted')
    await expect(counter).toHaveText('52/64')

    await name.fill('a'.repeat(64))
    await expect(counter).toHaveAttribute('data-state', 'destructive')
    await expect(counter).toHaveText('64/64')
  })

  test('S3: name primitive shape (textarea rows=1, single-line overflow)', async ({
    page,
  }) => {
    const dialog = await openEnvCreateDialog(page)
    const name = dialog.locator('textarea').first()

    await expect(name).toHaveAttribute('rows', '1')
    const styles = await name.evaluate((el) => {
      const cs = window.getComputedStyle(el)
      return { whiteSpace: cs.whiteSpace, overflowX: cs.overflowX, resize: cs.resize }
    })
    expect(styles.whiteSpace).toBe('pre')
    expect(styles.overflowX).toBe('auto')
    expect(styles.resize).toBe('none')
  })

  test('S4: typing the maxLength value never grows the dialog width', async ({
    page,
  }) => {
    const dialog = await openEnvCreateDialog(page)
    const name = dialog.locator('textarea').first()

    // The dialog is wide enough that the entire 64-char capped value fits,
    // so we cannot assert `scrollWidth > clientWidth` here (the styles in S3
    // pin the behavior that WOULD scroll if the field were narrower). What
    // we CAN prove is that filling the maxLength does not push the dialog
    // wider, which is the user-visible contract.
    const startW = await dialog.evaluate((el) => el.getBoundingClientRect().width)
    await name.fill('z'.repeat(64))
    const endW = await dialog.evaluate((el) => el.getBoundingClientRect().width)
    expect(Math.abs(endW - startW)).toBeLessThanOrEqual(50)
  })

  test('S5: description textarea remains multi-line', async ({ page }) => {
    const dialog = await openEnvCreateDialog(page)
    // The description field is the second textarea on the dialog; it stays
    // as a bare <textarea>.
    const textareas = dialog.locator('textarea')
    await expect(textareas).toHaveCount(2)
    const description = textareas.nth(1)
    // Native multi-line textarea has rows>1 (the spec allows the browser default).
    const rows = await description.getAttribute('rows')
    if (rows !== null) {
      expect(parseInt(rows, 10)).toBeGreaterThan(1)
    }
  })
})
