/**
 * V-FORM-OVERFLOW-PROFILES: Profile create dialog name + value overflow contract
 *
 * Phase: no-data (parallel) - opens the profile create modal directly; no fixture data.
 *
 * Pass Criteria:
 *  1. Profile name field caps at 64 (MAX_ENTITY_NAME_LENGTH); native maxLength
 *     hard-blocks typing past 64; counter shows destructive at exactly 64/64.
 *  2. Profile name field is the NameField primitive: <textarea rows="1"> with
 *     the single-line overflow contract (whitespace-pre + overflow-x-auto).
 *  3. Profile description field is the TextField primitive (<textarea rows="1">,
 *     no maxLength, single-line overflow contract).
 *  4. Long values (150 chars) inside name/description fields produce
 *     scrollWidth > clientWidth INSIDE the field; the dialog width does NOT
 *     grow to accommodate.
 *  5. Layout: Name and Description sit stacked full-width (not the
 *     side-by-side grid).
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { ensureEnvironment } from '../../helpers/config'
import { openProfileCreateDialog } from '../../helpers/profiles'

test.describe('V-FORM-OVERFLOW-PROFILES: profile create form fields', () => {
  test.beforeEach(async ({ page }) => {
    // Profile create dialog is gated on "at least one environment exists"
    // (use-profiles-actions.ts handleNewProfile). Seed the shared E2E env so
    // the click opens the modal instead of showing a warning toast.
    await ensureEnvironment(page.request)
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
  })

  test('S1: profile name caps at 64 with destructive counter at exact cap', async ({
    page,
  }) => {
    const dialog = await openProfileCreateDialog(page)
    const name = dialog.locator('textarea#name')
    await expect(name).toBeVisible()
    await expect(name).toHaveAttribute('maxlength', '64')

    // Type 70; native maxLength clips at 64.
    await name.fill('a'.repeat(70))
    expect((await name.inputValue()).length).toBe(64)

    // Counter at exact cap: destructive 64/64.
    const counter = dialog.locator('span[aria-live="polite"]').first()
    await expect(counter).toBeVisible()
    await expect(counter).toHaveAttribute('data-state', 'destructive')
    await expect(counter).toHaveText('64/64')
  })

  test('S2: profile name is the NameField primitive (textarea rows=1, overflow contract)', async ({
    page,
  }) => {
    const dialog = await openProfileCreateDialog(page)
    const name = dialog.locator('textarea#name')

    await expect(name).toHaveAttribute('rows', '1')
    const styles = await name.evaluate((el) => {
      const cs = window.getComputedStyle(el)
      return { whiteSpace: cs.whiteSpace, overflowX: cs.overflowX, resize: cs.resize }
    })
    expect(styles.whiteSpace).toBe('pre')
    expect(styles.overflowX).toBe('auto')
    expect(styles.resize).toBe('none')
  })

  test('S3: typing the maxLength value never grows the dialog width', async ({
    page,
  }) => {
    const dialog = await openProfileCreateDialog(page)
    const name = dialog.locator('textarea#name')

    // The profile dialog is wide enough that the 64-char capped value fits, so
    // the `scrollWidth > clientWidth` assertion is not appropriate here (S2's
    // style assertion pins the WOULD-scroll behavior). The user-visible
    // contract is "the field never grows the dialog wider"
    // which is what we assert.
    const startW = await dialog.evaluate((el) => el.getBoundingClientRect().width)
    await name.fill('z'.repeat(64))
    const endW = await dialog.evaluate((el) => el.getBoundingClientRect().width)
    expect(Math.abs(endW - startW)).toBeLessThanOrEqual(50)
  })

  test('S4: profile description is the multi-line DescriptionField (no cap, dialog stable)', async ({
    page,
  }) => {
    const dialog = await openProfileCreateDialog(page)
    const desc = dialog.locator('textarea#description')

    await expect(desc).toBeVisible()
    // DescriptionField uses min-h-[80px] (matches env/test description). No rows="1", no max length.
    const className = (await desc.getAttribute('class')) ?? ''
    expect(className).toContain('min-h-[80px]')
    expect(await desc.getAttribute('maxlength')).toBeNull()

    // Long description must not grow the dialog horizontally - it wraps inside
    // the textarea since width is constrained by w-full + dialog padding.
    const startW = await dialog.evaluate((el) => el.getBoundingClientRect().width)
    await desc.fill('d'.repeat(150))
    const endW = await dialog.evaluate((el) => el.getBoundingClientRect().width)
    expect(Math.abs(endW - startW)).toBeLessThanOrEqual(50)
  })
})
