/**
 * V-PROFILE-METADATA-STACK: Profile name/description stacked full-width
 *
 * Phase: no-data (parallel) - opens the profile create dialog directly.
 * metadata-fields.tsx stacks the fields vertically at full width, not in a
 * `grid grid-cols-2` side-by-side: the 64/64 destructive counter visually
 * cramped a half-width column.
 *
 * Pass Criteria:
 *  1. Profile name and description fields are full-width (each spans the dialog
 *     content, not 50% in a 2-column grid).
 *  2. Description sits BELOW name (description top > name bottom).
 *  3. Typing 64 chars into name shows the destructive 64/64 counter without
 *     truncation overlap (counter sits below the field on its own line, not
 *     squeezed into a half-column).
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { ensureEnvironment } from '../../helpers/config'
import { openProfileCreateDialog } from '../../helpers/profiles'

test.describe('V-PROFILE-METADATA-STACK: name + description stacked full-width', () => {
  test.beforeEach(async ({ page }) => {
    // The Profile create dialog is gated on "at least one environment exists"
    // (use-profiles-actions.ts handleNewProfile). Without an env the click
    // shows a warning toast instead of opening the modal. Seed the shared
    // E2E env so the gate passes.
    await ensureEnvironment(page.request)
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
  })

  test('S1: name and description fields are full-width (not side-by-side 2-col grid)', async ({
    page,
  }) => {
    const dialog = await openProfileCreateDialog(page)
    const name = dialog.locator('textarea#name')
    const desc = dialog.locator('textarea#description')

    // Both fields render the TextField primitive's `w-full` wrapper. Their
    // bounding boxes should each span (close to) the modal's content width;
    // critical assertion is that they share the same column alignment (not
    // sit side-by-side at half-width). Use a loose tolerance: the textareas
    // sit inside `min-w-0` div wrappers whose padding/margin produces a few
    // pixels of x offset that does NOT correspond to a 2-column layout.
    const nameBox = await name.boundingBox()
    const descBox = await desc.boundingBox()
    expect(nameBox).toBeTruthy()
    expect(descBox).toBeTruthy()
    expect(Math.abs(nameBox!.x - descBox!.x)).toBeLessThanOrEqual(15)

    // Width parity: both fields measure within ~15px of each other (same column).
    // A 2-column grid would put each field at ~50% of the modal width -
    // a difference of >150px. The tolerance here only catches that case.
    expect(Math.abs(nameBox!.width - descBox!.width)).toBeLessThanOrEqual(15)
  })

  test('S2: description sits BELOW name (vertical stack, not horizontal)', async ({
    page,
  }) => {
    const dialog = await openProfileCreateDialog(page)
    const nameBox = await dialog.locator('textarea#name').boundingBox()
    const descBox = await dialog.locator('textarea#description').boundingBox()
    expect(nameBox).toBeTruthy()
    expect(descBox).toBeTruthy()
    // Description top must be below the name's bottom (stacked layout).
    expect(descBox!.y).toBeGreaterThan(nameBox!.y + nameBox!.height)
  })

  test('S3: 64-char destructive counter renders below the name field on its own line', async ({
    page,
  }) => {
    const dialog = await openProfileCreateDialog(page)
    const name = dialog.locator('textarea#name')
    await name.fill('a'.repeat(64))

    const counter = dialog.locator('span[aria-live="polite"]').first()
    await expect(counter).toBeVisible()
    await expect(counter).toHaveAttribute('data-state', 'destructive')

    const nameBox = await name.boundingBox()
    const counterBox = await counter.boundingBox()
    expect(nameBox).toBeTruthy()
    expect(counterBox).toBeTruthy()

    // Counter sits below the field (next-line stacking, not inline overlap).
    expect(counterBox!.y).toBeGreaterThanOrEqual(nameBox!.y + nameBox!.height - 1)

    // Counter does not extend past the field's right edge (no squeeze). The
    // counter sits inside the field's `min-w-0` wrapper so a few pixels of
    // padding is normal; the case to catch is the
    // counter being CRAMMED into a 50%-wide column with the field, not a
    // sub-pixel offset.
    expect(counterBox!.x + counterBox!.width).toBeLessThanOrEqual(
      nameBox!.x + nameBox!.width + 10,
    )
  })
})
