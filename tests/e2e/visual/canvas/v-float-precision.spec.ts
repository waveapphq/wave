/**
 * V-FLOAT-PRECISION: number-field guards of the variable's Edit window for the
 * float Decimal pipeline (REQ-3.1.3.14), plus width-resizable scalar watchers.
 * Design Decisions: VMGR-106 (the pencil opens the one window), VMGR-110 (one
 * same-height value field per type).
 * Pure UI interaction (no execution): the float significant-digit input cap (#1/#2),
 * the numeric counter (#3), the Name cap (#4), and width-resizable scalar
 * watchers with a fixed boolean toggle and a growing name field (#5).
 *
 * Self-imports the v-scalar-edit fixture via POST /tests. Visual / interaction
 * assertions only - the end-to-end value behavior is V-FLOAT-PRECISION
 * (functional).
 *
 * Pass Criteria:
 *  1. (#1) Typing a 29th SIGNIFICANT digit into the Edit window's float field is
 *     blocked at the input; the value stays valid, no strip message shows and Save
 *     stays enabled. A dot-less 29-digit value caps at 28 significant digits.
 *  2. (#2) A `-0.` + 28-digit float can be fully entered (significant digits,
 *     not characters, are the gate).
 *  3. (#3) The numeric counter appears inline-right from ~80% of the cap, muted
 *     then destructive at the cap: float shows N/28, integer shows N/19; it is
 *     hidden for low-precision values and never shown for a boolean or a string
 *     (a String Literal is a one-line text field).
 *  4. (#4) The Edit window's Name field stops at 64 characters (cannot over-type
 *     the cap) and its counter reads 64/64 in the destructive color.
 *  5. (#5) boolean / integer / float watchers expose the resize affordance and
 *     widen; a long name truncated at the default width shows fully after
 *     widening; the Edit window's boolean true|false toggle stays a fixed compact
 *     width when the window is widened.
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT } from '../../helpers/config'
import {
  cancelWindow,
  openEditWindow,
  valueField,
  windowSaveButton,
} from '../../helpers/variable-create'
import fs from 'fs'
import path from 'path'

const FIXTURE_PATH = path.resolve(__dirname, '../../fixtures/canvas/v-scalar-edit/fixture.json')

function loadFixture(nameSuffix: string): Record<string, unknown> {
  const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf-8'))
  fixture.name = `V-FLOAT ${nameSuffix} ${Date.now()}`
  return fixture
}

async function importAndOpen(page: Page, nameSuffix: string): Promise<void> {
  await page.request.delete(`http://localhost:${BACKEND_PORT}/workbench/session/`).catch(() => {})
  const createResp = await page.request.post(`http://localhost:${BACKEND_PORT}/tests`, {
    data: loadFixture(nameSuffix),
  })
  const body = await createResp.json().catch(() => null)
  expect(
    createResp.ok(),
    `POST /tests failed: ${createResp.status()} - ${JSON.stringify(body)}`,
  ).toBeTruthy()
  const testId = (body.data?.id ?? body.id) as string

  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)

  const panel = page.locator('[data-testid="variable-manager"]')
  if ((await panel.getAttribute('data-state')) === 'collapsed') {
    await panel.locator('button[aria-label="Expand Variable Manager"]').click()
    await expect(panel).toHaveAttribute('data-state', 'expanded')
  }
}

const rowFor = (page: Page, name: string): Locator =>
  page.locator('[data-testid="variable-manager-content"]').locator(`[aria-label="Variable ${name}"]`)
const modalFor = (page: Page, name: string): Locator =>
  page.locator(`section[aria-label="Inspect variable ${name}"]`)

// Eye -> read watcher (Current mode).
async function openRead(page: Page, name: string): Promise<Locator> {
  await rowFor(page, name).hover()
  await rowFor(page, name).locator('[data-testid^="expand-button-"]').click()
  const modal = modalFor(page, name)
  await expect(modal).toBeVisible()
  return modal
}

// Drag the width-only edge handle to widen the sheet by `dx` px.
async function widenSheet(page: Page, modal: Locator, dx: number): Promise<void> {
  const edge = modal.locator('[data-testid="dialog-resize-handle"]')
  const box = (await edge.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2, { steps: 6 })
  await page.mouse.up()
}

test.describe('V-FLOAT-PRECISION: float significant-digit input cap', () => {
  test('#1: a 29th significant digit is blocked at the input with no error', async ({ page }) => {
    await importAndOpen(page, 'sigcap')
    const modal = await openEditWindow(page, 'ratio')
    const input = modal.locator('[data-testid="scalar-edit-input"]')
    await input.fill('')
    // Type 29 nines (dot-less): the 29th significant digit never enters.
    await input.pressSequentially('9'.repeat(29))
    await expect(input).toHaveValue('9'.repeat(28)) // #1: capped at 28 sig digits
    // The cap is enforced at the input, NOT as a validation error.
    await expect(modal.locator('[data-testid="create-validation"]')).toHaveCount(0)
    const save = windowSaveButton(modal)
    await expect(save).toBeEnabled()
    await expect(save).not.toHaveAttribute('aria-disabled', 'true')
  })

  test('#2: a -0. + 28-digit float is not char-trapped (significant digits gate, not chars)', async ({
    page,
  }) => {
    await importAndOpen(page, 'dotzero')
    const modal = await openEditWindow(page, 'ratio')
    const input = modal.locator('[data-testid="scalar-edit-input"]')
    const value = `-0.${'9'.repeat(28)}`
    await input.fill(value)
    // The whole value entered; still valid.
    await expect(input).toHaveValue(value) // #2: leading-zero fraction not trapped
    await expect(modal.locator('[data-testid="create-validation"]')).toHaveCount(0)
    await expect(windowSaveButton(modal)).toBeEnabled()
  })
})

test.describe('V-FLOAT-PRECISION: numeric edit counter', () => {
  test('#3: float counts significant digits (/28), muted then destructive at the cap', async ({
    page,
  }) => {
    await importAndOpen(page, 'floatcounter')
    const modal = await openEditWindow(page, 'ratio')
    const input = modal.locator('[data-testid="scalar-edit-input"]')
    const counter = modal.locator('[data-testid="scalar-edit-counter"]')

    // Below 80% (22 of 28): hidden.
    await input.fill('9'.repeat(22))
    await expect(counter).toHaveCount(0)
    // From 80% (23 of 28): muted.
    await input.fill('9'.repeat(23))
    await expect(counter).toBeVisible()
    await expect(counter).toHaveText('23/28')
    expect((await counter.getAttribute('class')) ?? '').not.toMatch(/text-destructive/)
    // At the cap (28 of 28): destructive.
    await input.fill('9'.repeat(28))
    await expect(counter).toHaveText('28/28')
    expect((await counter.getAttribute('class')) ?? '').toMatch(/text-destructive/)
  })

  test('#3: integer counts digits (/19); boolean and string never show the counter', async ({
    page,
  }) => {
    await importAndOpen(page, 'othercounters')

    const intModal = await openEditWindow(page, 'attempt')
    const intInput = intModal.locator('[data-testid="scalar-edit-input"]')
    const intCounter = intModal.locator('[data-testid="scalar-edit-counter"]')
    await intInput.fill('1'.repeat(15))
    await expect(intCounter).toHaveCount(0)
    await intInput.fill('1'.repeat(16))
    await expect(intCounter).toHaveText('16/19')
    await intInput.fill('1'.repeat(19))
    await expect(intCounter).toHaveText('19/19')
    expect((await intCounter.getAttribute('class')) ?? '').toMatch(/text-destructive/)
    await cancelWindow(page, intModal, 'Close')

    // Boolean (true | false control): no numeric counter.
    const boolModal = await openEditWindow(page, 'debug_log')
    await expect(boolModal.locator('[data-testid="scalar-edit-bool-true"]')).toHaveAttribute('aria-pressed', 'true')
    await expect(boolModal.locator('[data-testid="scalar-edit-counter"]')).toHaveCount(0)
    await cancelWindow(page, boolModal)

    // String Literal (one-line text field): no numeric counter.
    const strModal = await openEditWindow(page, 'note')
    await expect(valueField(strModal).locator('input[type="text"]')).toHaveValue('bob')
    await expect(strModal.locator('[data-testid="scalar-edit-counter"]')).toHaveCount(0)
  })
})

test.describe('V-FLOAT-PRECISION: rename cap & resizable scalars', () => {
  test('#4: the Edit window Name field stops at 64 characters', async ({ page }) => {
    await importAndOpen(page, 'namecap')
    const modal = await openEditWindow(page, 'ratio')
    const rename = modal.locator('[data-testid="create-variable-name"]')
    // Over-typing past the cap is clamped to 64 (cannot exceed the counter).
    await rename.fill('a'.repeat(70))
    await expect(rename).toHaveValue('a'.repeat(64)) // #4: hard 64-char cap
    const counter = modal.locator('[data-testid="create-variable-name-counter"]')
    await expect(counter).toHaveText('64/64')
    expect((await counter.getAttribute('class')) ?? '').toMatch(/text-destructive/)
  })

  test('#5: boolean / integer / float watchers are width-resizable', async ({ page }) => {
    await importAndOpen(page, 'resize')
    for (const name of ['debug_log', 'attempt', 'ratio']) {
      const modal = await openRead(page, name)
      // Scalar watchers expose the width resize affordance.
      await expect(modal.locator('[data-testid="dialog-resize-handle"]')).toHaveCount(1)
      await modal.locator(`[aria-label="Close inspector for ${name}"]`).click()
      await expect(modal).toHaveCount(0)
    }

    // A float watcher widens on an edge drag.
    const floatModal = await openRead(page, 'ratio')
    const before = (await floatModal.boundingBox())!
    await expect(async () => {
      await widenSheet(page, floatModal, 120)
      const after = (await floatModal.boundingBox())!
      expect(after.width).toBeGreaterThan(before.width + 40)
    }).toPass({ timeout: 15_000 })
  })

  test('#5: the boolean toggle stays a fixed compact width when the Edit window is widened', async ({
    page,
  }) => {
    await importAndOpen(page, 'booltoggle')
    const modal = await openEditWindow(page, 'debug_log')
    const toggle = modal.locator('[data-testid="scalar-edit-body"] fieldset')
    const before = (await toggle.boundingBox())!
    const windowBefore = (await modal.boundingBox())!
    await expect(async () => {
      await widenSheet(page, modal, 160)
      expect((await modal.boundingBox())!.width).toBeGreaterThan(windowBefore.width + 40)
    }).toPass({ timeout: 15_000 })
    // The window grew, but the true|false toggle did NOT stretch with it.
    const after = (await toggle.boundingBox())!
    expect(Math.abs(after.width - before.width)).toBeLessThan(8)
  })

  test('#5: a long name truncated at the default width shows fully after widening', async ({
    page,
  }) => {
    await importAndOpen(page, 'longname')
    const modal = await openRead(page, 'ratio_with_a_long_descriptive_name')
    const name = modal.locator('[data-testid="inspect-variable-name"]')
    // Truncated at the compact float default width.
    expect(await name.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
    // Widening the watcher grows the name field so the full name shows.
    await expect(async () => {
      await widenSheet(page, modal, 260)
      expect(await name.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
    }).toPass({ timeout: 15_000 })
  })
})
