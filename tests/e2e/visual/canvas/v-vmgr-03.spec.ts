/**
 * V-VMGR-03: Variable Inspect Modal - Shell, Modes, Sizing, Stacking, Persistence
 *
 * Design Decisions: VMGR-11 (secret rows cannot expand), VMGR-15 .. VMGR-22 (shell,
 * both-axis resize, focus-existing, modes with Current default, source-row indicator,
 * live view, deleting closes, metrics), VMGR-23 (complex rows, 320x124 minimum),
 * VMGR-40 (Not evaluated yet), VMGR-43 (Compare is the third mode entry), VMGR-106
 * (the watcher only shows values: no Edit)
 * REQ: REQ-3.1.3.11 (variable watching UI panel), REQ-3.2.2.18 (live values display)
 *
 * Pass Criteria:
 * 1.  Expanding a scalar row opens the modal: header (grip, mono name, type
 *     badge in the row palette, close X), full untruncated body in the type
 *     color, footer (text-label Mode trigger + chevron, centered mono
 *     metric) with no Edit. Default mode is Current.
 * 2.  Initial mode renders the identical idle content dim + italic; the
 *     trigger reads "Initial".
 * 3.  The mode menu opens UPWARD with the text items Initial / Current /
 *     Compare and a check on the selected entry.
 * 4.  The source row carries the indigo inset edge + tint + indigo expand
 *     icon while its modal is open, clearing on close (VMGR-20).
 * 5.  Expression watcher: {x} cyan badge next to the type badge; idle opens
 *     in the Last Evaluated view with the "Not evaluated yet." empty state and
 *     no metric; the Expression view shows the cyan source (dim + italic in
 *     Initial) with no metric (VMGR-22, VMGR-40).
 * 6.  Integer watcher: empty metric center zone; string metric counts RAW
 *     chars (quotes excluded) (VMGR-21).
 * 7.  Complex (array / map / table) rows have the expand ENABLED with the
 *     "Inspect <name>" tooltip and open their typed-body watchers (VMGR-23;
 *     deep body coverage lives in V-VMGR-04). Secret rows stay visually
 *     disabled (aria-disabled + opacity-50 + cursor-not-allowed) with the
 *     EXACT tooltip (VMGR-11).
 * 8.  Re-expanding an open variable focuses the existing modal - no
 *     duplicates (VMGR-15). ESC closes the front-most watcher only.
 * 9.  String / expression watchers open at 400px; integer / float / boolean
 *     literals at 320px with content-tight height. The corner grip grows
 *     BOTH axes, clamps at the one-line minimum 320x124, caps width at
 *     1200; the width-only edge handle still resizes (VMGR-15, VMGR-23).
 * 10. Consumer sheets keep their own minimums: Functions Library 520x360,
 *     element-config and function-config sheets 520x400.
 * 11. A huge multiline watcher caps at EXACTLY the viewport height, footer
 *     reachable, body scrolling; it follows viewport resizes (max-h-screen).
 * 12. Watchers stack with 24px cascade offsets; pointerdown raises a buried
 *     watcher BEFORE the drag; row re-expand raises a buried open watcher;
 *     watcher and element-config sheet share one z-order both directions.
 * 13. Watchers stay VISIBLE (size + position intact) across Function drills
 *     and pop-back; a Function-local watcher survives the round trip from a
 *     snapshot; deleting a variable in its own scope closes its watcher.
 * 14. Watchers persist (names + geometry) across reload and navigation of
 *     the SAME test; mode resets to Current; closed watchers stay closed;
 *     another test inherits nothing; close-then-reopen starts clean.
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad, expandPalette } from '../../helpers/canvas'
import { BACKEND_PORT } from '../../helpers/config'
import fs from 'fs'
import path from 'path'

const FIXTURE_PATH = path.resolve(
  __dirname,
  '../../fixtures/canvas/v-vmgr-inspect/fixture.json',
)

const HUGE_LOG = Array.from(
  { length: 300 },
  (_, i) => `line ${i + 1}: lorem ipsum dolor sit amet consectetur`,
).join('\n')

function loadFixture(nameSuffix: string): Record<string, unknown> {
  const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf-8'))
  fixture.name = `V-VMGR-03 ${nameSuffix} ${Date.now()}`
  // 300-line value kept out of the JSON for readability (see fixture README).
  fixture.variables.huge_log.value = HUGE_LOG
  return fixture
}

async function postFixture(
  page: Page,
  fixture: Record<string, unknown>,
): Promise<string> {
  const createResp = await page.request.post(
    `http://localhost:${BACKEND_PORT}/tests`,
    { data: fixture },
  )
  const body = await createResp.json().catch(() => null)
  expect(
    createResp.ok(),
    `POST /tests failed: ${createResp.status()} - ${JSON.stringify(body)}`,
  ).toBeTruthy()
  return (body.data?.id ?? body.id) as string
}

async function expandVariablePanel(page: Page): Promise<void> {
  const panel = page.locator('[data-testid="variable-manager"]')
  const state = await panel.getAttribute('data-state')
  if (state === 'collapsed') {
    await panel.locator('button[aria-label="Expand Variable Manager"]').click()
    await expect(panel).toHaveAttribute('data-state', 'expanded')
  }
}

async function importAndOpen(page: Page, nameSuffix: string): Promise<string> {
  await page.request
    .delete(`http://localhost:${BACKEND_PORT}/workbench/session/`)
    .catch(() => {})
  const testId = await postFixture(page, loadFixture(nameSuffix))

  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)
  await expandVariablePanel(page)
  return testId
}

// ---------------------------------------------------------------------------
// Locator helpers
// ---------------------------------------------------------------------------

const content = (page: Page): Locator =>
  page.locator('[data-testid="variable-manager-content"]')

const rowFor = (page: Page, name: string): Locator =>
  content(page).locator(`[aria-label="Variable ${name}"]`)

const expandButtonFor = (page: Page, name: string): Locator =>
  rowFor(page, name).locator('[data-testid^="expand-button-"]')

const modalFor = (page: Page, name: string): Locator =>
  page.locator(`section[aria-label="Inspect variable ${name}"]`)

const allModals = (page: Page): Locator =>
  page.locator('section[data-testid^="variable-inspect-modal-"]')

async function openInspector(page: Page, name: string): Promise<Locator> {
  await expandButtonFor(page, name).click()
  const modal = modalFor(page, name)
  await expect(modal).toBeVisible()
  return modal
}

async function closeInspector(page: Page, name: string): Promise<void> {
  await page.locator(`button[aria-label="Close inspector for ${name}"]`).click()
  await expect(modalFor(page, name)).toHaveCount(0)
}

async function switchMode(
  page: Page,
  name: string,
  label: 'Initial' | 'Current',
): Promise<void> {
  const trigger = modalFor(page, name).locator('[data-testid="mode-dropdown"]')
  await trigger.click()
  await page.getByRole('option', { name: label, exact: true }).click()
  await expect(trigger).toContainText(label)
}

interface ModalGeometry {
  transform: string
  width: string
  height: string
  zIndex: number
}

async function geometryOf(modal: Locator): Promise<ModalGeometry> {
  return await modal.evaluate((el: HTMLElement) => ({
    transform: el.style.transform,
    width: el.style.width,
    height: el.style.height,
    zIndex: Number(el.style.zIndex),
  }))
}

/** Grab the leftmost header strip (uncovered by the +24px cascade) and drag. */
async function dragModalBy(
  page: Page,
  name: string,
  dx: number,
  dy: number,
): Promise<void> {
  const handle = modalFor(page, name).locator('[data-testid$="-drag-handle"]')
  const box = (await handle.boundingBox())!
  await page.mouse.move(box.x + 10, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + 10 + dx, box.y + box.height / 2 + dy, { steps: 5 })
  await page.mouse.up()
}

/** Drag a corner grip by (dx, dy) - amplification and clamping are asserted
 *  by callers on the resulting geometry. */
async function dragCornerBy(
  page: Page,
  surface: Locator,
  dx: number,
  dy: number,
): Promise<void> {
  const grip = surface.locator('[data-testid="dialog-resize-corner"]')
  const box = (await grip.boundingBox())!
  const startX = box.x + box.width / 2
  const startY = box.y + box.height / 2
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(Math.max(2, startX + dx), Math.max(2, startY + dy), {
    steps: 5,
  })
  await page.mouse.up()
}

/** Corner-drag far up-left; the surface must clamp at its minimum size. */
async function expectCornerClampsAtMinimum(
  page: Page,
  surface: Locator,
  minWidth: number,
  minHeight: number,
): Promise<void> {
  await expect(async () => {
    await dragCornerBy(page, surface, -3000, -3000)
    const box = (await surface.boundingBox())!
    expect(Math.round(box.width)).toBe(minWidth)
    expect(Math.round(box.height)).toBe(minHeight)
  }).toPass({ timeout: 15_000 })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('V-VMGR-03: Variable inspect modal', () => {
  test('anatomy: header / body / footer, Current default, Initial dim + italic parity (VMGR-15..19)', async ({
    page,
  }) => {
    await importAndOpen(page, 'anatomy')
    const modal = await openInspector(page, 'user_name')

    // Header: mono name, type badge in the row palette (sky for string),
    // close X. The whole header bar is the drag handle.
    const name = modal.locator('[data-testid="inspect-variable-name"]')
    await expect(name).toHaveText('user_name')
    expect(await name.getAttribute('class')).toMatch(/font-mono/)
    const typeBadge = modal.locator('[data-testid="inspect-type-badge"]')
    await expect(typeBadge).toHaveText('string')
    expect(await typeBadge.getAttribute('class')).toMatch(/sky/)
    await expect(modal.locator('[data-testid$="-drag-handle"]')).toBeVisible()
    await expect(
      modal.locator('button[aria-label="Close inspector for user_name"]'),
    ).toBeVisible()
    // Literal (non-expression) watcher renders no {x} badge.
    await expect(modal.locator('[data-testid="inspect-expr-badge"]')).toHaveCount(0)

    // Body: a string renders raw (no quotes) through the line-numbered editor;
    // Current is not dimmed.
    const body = modal.locator('[data-testid="scalar-body"]')
    await expect(body.locator('.cm-content')).toContainText('bob')
    await expect(body.locator('.cm-content')).not.toContainText('"bob"')
    const currentClass = (await body.getAttribute('class')) ?? ''
    expect(currentClass).not.toMatch(/opacity-70/)

    // Footer: Mode trigger (text label, Current default), centered mono
    // metric "3 chars" (raw value, quotes excluded). VMGR-106: no Edit.
    const trigger = modal.locator('[data-testid="mode-dropdown"]')
    await expect(trigger).toContainText('Current')
    const metric = modal.locator('[data-testid="inspect-metric"]')
    await expect(metric).toHaveText('3 chars')
    expect(await metric.getAttribute('class')).toMatch(/font-mono/)
    const edit = modal.getByRole('button', { name: 'Edit', exact: true })
    await expect(edit).toHaveCount(0)

    // Initial mode: identical idle content, dimmed via opacity
    // (strings dim without italics - they render broken in the editor). Still no Edit.
    await switchMode(page, 'user_name', 'Initial')
    await expect(body.locator('.cm-content')).toContainText('bob')
    const initialClass = (await body.getAttribute('class')) ?? ''
    expect(initialClass).toMatch(/opacity-70/)
    await expect(metric).toHaveText('3 chars')
    await expect(edit).toHaveCount(0)

    // Back to Current: styling returns to normal with the same content.
    await switchMode(page, 'user_name', 'Current')
    await expect(body.locator('.cm-content')).toContainText('bob')
    expect((await body.getAttribute('class')) ?? '').not.toMatch(/opacity-70/)

    // Close X removes the modal.
    await closeInspector(page, 'user_name')
  })

  test('mode menu opens upward with Initial / Current / Compare and a check on the selected (VMGR-43)', async ({
    page,
  }) => {
    await importAndOpen(page, 'mode-menu')
    const modal = await openInspector(page, 'user_name')

    const trigger = modal.locator('[data-testid="mode-dropdown"]')
    await trigger.click()

    // Exactly three text options - Compare is the third entry (VMGR-43).
    const options = page.getByRole('option')
    await expect(options).toHaveCount(3)
    await expect(options.nth(0)).toHaveText('Initial')
    await expect(options.nth(1)).toHaveText('Current')
    await expect(options.nth(2)).toHaveText('Compare')

    // Opens upward: the menu sits fully above the trigger.
    const listbox = page.getByRole('listbox')
    const menuBox = (await listbox.boundingBox())!
    const triggerBox = (await trigger.boundingBox())!
    expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(triggerBox.y + 1)

    // Check indicator on the selected entry only (Current is the default).
    const checked = page.locator('[role="option"][data-state="checked"]')
    await expect(checked).toHaveCount(1)
    await expect(checked).toHaveText('Current')
    await expect(checked.locator('svg')).toHaveCount(1)
    await expect(
      page
        .locator('[role="option"][data-state="unchecked"]')
        .locator('svg'),
    ).toHaveCount(0)

    await page.keyboard.press('Escape')
    await expect(listbox).toHaveCount(0)
    // The select consumed that ESC - the watcher must still be open.
    await expect(modal).toBeVisible()
  })

  test('source-row indicator: indigo edge + tint + indigo expand icon while open, cleared on close (VMGR-20)', async ({
    page,
  }) => {
    await importAndOpen(page, 'indicator')

    const row = rowFor(page, 'user_name')
    const expand = expandButtonFor(page, 'user_name')
    expect((await row.getAttribute('class')) ?? '').not.toMatch(/indigo/)

    await openInspector(page, 'user_name')
    expect((await row.getAttribute('class')) ?? '').toMatch(/indigo/)
    expect((await expand.getAttribute('class')) ?? '').toMatch(/text-indigo/)

    await closeInspector(page, 'user_name')
    expect((await row.getAttribute('class')) ?? '').not.toMatch(/indigo/)
    expect((await expand.getAttribute('class')) ?? '').not.toMatch(/text-indigo/)
  })

  // Deep view-matrix coverage is in V-VMGR-05; this keeps the badge, source and Initial pins.
  test('expression watcher: {x} badge, empty Literal idle, cyan source in Expression view (VMGR-22, VMGR-40)', async ({
    page,
  }) => {
    await importAndOpen(page, 'expression')
    const modal = await openInspector(page, 'api_url')

    // {x} flag badge renders next to the type badge.
    const exprBadge = modal.locator('[data-testid="inspect-expr-badge"]')
    await expect(exprBadge).toHaveText('{x}')
    expect(await exprBadge.getAttribute('class')).toMatch(/cyan/)
    await expect(modal.locator('[data-testid="inspect-type-badge"]')).toHaveText(
      'string',
    )

    // Idle Current: the evaluated "Last Evaluated" view default with the empty
    // state - the expression has no runtime value yet (VMGR-40).
    await expect(modal.locator('[data-testid="view-dropdown"]')).toContainText(
      'Last Evaluated',
    )
    await expect(modal.locator('text="Not evaluated yet."')).toBeVisible()
    // An empty state carries no metric.
    await expect(modal.locator('[data-testid="inspect-metric"]')).toHaveCount(0)

    // Expression view: the source renders RAW (no quoting) in cyan, normal
    // styling, with NO metric (a source is not a value).
    await modal.locator('[data-testid="view-dropdown"]').click()
    await page.getByRole('option', { name: 'Expression', exact: true }).click()
    const body = modal.locator('[data-testid="scalar-body"]')
    const source = "'https://api.wave.test/v1/services/discovery/' + user_name"
    await expect(body).toHaveText(source)
    const currentClass = (await body.getAttribute('class')) ?? ''
    expect(currentClass).toMatch(/cyan/)
    expect(currentClass).not.toMatch(/italic/)
    await expect(modal.locator('[data-testid="inspect-metric"]')).toHaveCount(0)

    // Initial: same source, dim + italic, still NO metric.
    await switchMode(page, 'api_url', 'Initial')
    await expect(body).toHaveText(source)
    const initialClass = (await body.getAttribute('class')) ?? ''
    expect(initialClass).toMatch(/cyan/)
    expect(initialClass).toMatch(/italic/)
    await expect(modal.locator('[data-testid="inspect-metric"]')).toHaveCount(0)
  })

  test('numeric / boolean literal watchers open compact per-type (integer/boolean 220px, float 310px) with an empty metric zone (VMGR-21)', async ({
    page,
  }) => {
    await importAndOpen(page, 'compact')

    // Integer: violet value, NO metric element, 220px wide (per-type compact size).
    const intModal = await openInspector(page, 'attempt')
    const intBody = intModal.locator('[data-testid="scalar-body"]')
    await expect(intBody).toHaveText('1')
    expect(await intBody.getAttribute('class')).toMatch(/violet/)
    await expect(intModal.locator('[data-testid="inspect-metric"]')).toHaveCount(0)
    expect((await geometryOf(intModal)).width).toBe('220px')
    await closeInspector(page, 'attempt')

    // Boolean is compact at 220px; the float group is widened to 310px so a long
    // exact value shows on one line.
    const boolModal = await openInspector(page, 'debug_log')
    await expect(boolModal.locator('[data-testid="scalar-body"]')).toHaveText('true')
    await expect(boolModal.locator('[data-testid="inspect-metric"]')).toHaveCount(0)
    expect((await geometryOf(boolModal)).width).toBe('220px')
    await closeInspector(page, 'debug_log')

    const floatModal = await openInspector(page, 'ratio')
    await expect(floatModal.locator('[data-testid="inspect-metric"]')).toHaveCount(0)
    expect((await geometryOf(floatModal)).width).toBe('310px')
    await closeInspector(page, 'ratio')

    // String opens at its 400px default; an expression at its 420px default.
    const strModal = await openInspector(page, 'user_name')
    expect((await geometryOf(strModal)).width).toBe('400px')
    await closeInspector(page, 'user_name')
    const exprModal = await openInspector(page, 'api_url')
    expect((await geometryOf(exprModal)).width).toBe('420px')
    await closeInspector(page, 'api_url')
  })

  test('complex rows open watchers; secret rows stay visually disabled with the exact tooltip (VMGR-11, VMGR-23)', async ({
    page,
  }) => {
    await importAndOpen(page, 'gating')

    // All three complex kinds expand like scalars; typed-body anatomy is V-VMGR-04's scope.
    for (const name of ['items', 'headers', 'results']) {
      const expand = expandButtonFor(page, name)
      await expect(expand).not.toHaveAttribute('aria-disabled', 'true')
      const cls = (await expand.getAttribute('class')) ?? ''
      expect(cls, `${name} expand opacity`).not.toMatch(/opacity-50/)
      expect(cls, `${name} expand cursor`).not.toMatch(/cursor-not-allowed/)
      await page.mouse.move(0, 0)
      await expand.hover()
      await expect(
        page.getByRole('tooltip', { name: `Inspect ${name}`, exact: true }),
      ).toBeVisible({ timeout: 2000 })
      await expand.click()
      await expect(modalFor(page, name)).toBeVisible()
      await closeInspector(page, name)
    }
    await expect(allModals(page)).toHaveCount(0)

    // Secret row keeps its own exact copy.
    const secretExpand = expandButtonFor(page, 'password')
    await expect(secretExpand).toHaveAttribute('aria-disabled', 'true')
    const secretClass = (await secretExpand.getAttribute('class')) ?? ''
    expect(secretClass).toMatch(/opacity-50/)
    expect(secretClass).toMatch(/cursor-not-allowed/)
    await page.mouse.move(0, 0)
    await secretExpand.hover()
    await expect(
      page.getByRole('tooltip', {
        name: 'Secret values cannot be expanded',
        exact: true,
      }),
    ).toBeVisible({ timeout: 2000 })
    await secretExpand.click({ force: true })
    await expect(allModals(page)).toHaveCount(0)

    // Enabled scalar row: "Inspect <name>" tooltip.
    const scalarExpand = expandButtonFor(page, 'user_name')
    await expect(scalarExpand).not.toHaveAttribute('aria-disabled', 'true')
    await page.mouse.move(0, 0)
    await scalarExpand.hover()
    await expect(
      page.getByRole('tooltip', { name: 'Inspect user_name', exact: true }),
    ).toBeVisible({ timeout: 2000 })
  })

  test('re-expand focuses the existing watcher (no duplicate) and ESC closes the front-most only (VMGR-15)', async ({
    page,
  }) => {
    await importAndOpen(page, 'focus-esc')

    await openInspector(page, 'user_name')
    await openInspector(page, 'attempt')
    await openInspector(page, 'debug_log')
    await expect(allModals(page)).toHaveCount(3)

    // Re-expanding an open variable focuses the existing modal - no duplicate.
    await expandButtonFor(page, 'user_name').click()
    await expect(allModals(page)).toHaveCount(3)
    await expect(modalFor(page, 'user_name')).toHaveCount(1)

    // ...and raises it above the other watchers (focus-existing raise).
    const zUser = (await geometryOf(modalFor(page, 'user_name'))).zIndex
    const zAttempt = (await geometryOf(modalFor(page, 'attempt'))).zIndex
    const zDebug = (await geometryOf(modalFor(page, 'debug_log'))).zIndex
    expect(zUser).toBeGreaterThan(zAttempt)
    expect(zUser).toBeGreaterThan(zDebug)

    // ESC closes the front-most watcher only, one per press.
    await page.keyboard.press('Escape')
    await expect(modalFor(page, 'user_name')).toHaveCount(0)
    await expect(allModals(page)).toHaveCount(2)

    await page.keyboard.press('Escape')
    await expect(modalFor(page, 'debug_log')).toHaveCount(0)
    await expect(allModals(page)).toHaveCount(1)

    await page.keyboard.press('Escape')
    await expect(allModals(page)).toHaveCount(0)
  })

  test('corner grip resizes both axes: 320x124 minimum, 1200 width cap, edge handle width-only (VMGR-15, VMGR-23)', async ({
    page,
  }) => {
    test.setTimeout(60_000)
    // 90vw caps the rendered width below 1200 on the default 1280 viewport;
    // widen so the 1200 style cap is the binding constraint.
    await page.setViewportSize({ width: 1600, height: 1000 })
    await importAndOpen(page, 'resize')
    const modal = await openInspector(page, 'user_name')

    // The corner grip is pointer-only (aria-hidden), bottom-right.
    const grip = modal.locator('[data-testid="dialog-resize-corner"]')
    await expect(grip).toHaveAttribute('aria-hidden', 'true')

    // Both axes grow on a down-right corner drag.
    const before = (await modal.boundingBox())!
    await expect(async () => {
      await dragCornerBy(page, modal, 60, 50)
      const after = (await modal.boundingBox())!
      expect(after.width).toBeGreaterThan(before.width + 10)
      expect(after.height).toBeGreaterThan(before.height + 10)
    }).toPass({ timeout: 15_000 })

    // Far up-left drag clamps at the string watcher minimum 320x138 with
    // header, body, and footer all visible (no clipping). The 138 floor is the
    // string-editor minimum (STRING.single.minHeight).
    await expectCornerClampsAtMinimum(page, modal, 320, 138)
    await expect(modal.locator('[data-testid="inspect-variable-name"]')).toBeVisible()
    await expect(modal.locator('[data-testid="scalar-body"]')).toBeVisible()
    // The footer is not clipped: its Mode pill stays visible.
    await expect(modal.locator('[data-testid="mode-dropdown"]')).toBeVisible()

    // Far down-right drag caps the width at 1200.
    await expect(async () => {
      await dragCornerBy(page, modal, 1400, 100)
      expect((await geometryOf(modal)).width).toBe('1200px')
    }).toPass({ timeout: 15_000 })

    // The width-only edge handle still resizes width and leaves height alone.
    const beforeEdge = (await modal.boundingBox())!
    const edge = modal.locator('[data-testid="dialog-resize-handle"]')
    await expect(async () => {
      const eb = (await edge.boundingBox())!
      await page.mouse.move(eb.x + eb.width / 2, eb.y + eb.height / 2)
      await page.mouse.down()
      await page.mouse.move(eb.x + eb.width / 2 - 150, eb.y + eb.height / 2, {
        steps: 5,
      })
      await page.mouse.up()
      const after = (await modal.boundingBox())!
      expect(after.width).toBeLessThan(beforeEdge.width - 10)
      expect(Math.round(after.height)).toBe(Math.round(beforeEdge.height))
    }).toPass({ timeout: 15_000 })
  })

  test('consumer sheets clamp at their own per-modal minimums', async ({
    page,
  }) => {
    test.setTimeout(90_000)
    await importAndOpen(page, 'consumer-min')

    // Element-config sheet: 520x400.
    await page
      .locator('[data-testid="workflow-node-body-log-1"]')
      .dblclick()
    const configSheet = page.locator('[data-testid="element-config-sheet"]')
    await expect(configSheet).toBeVisible()
    await expectCornerClampsAtMinimum(page, configSheet, 520, 400)
    await page.keyboard.press('Escape')
    await expect(configSheet).toHaveCount(0)

    // Function Block window: 520x400.
    await page
      .locator('[data-testid="workflow-node-body-fn-1"]')
      .dblclick()
    const fnSheet = page.locator('[data-testid="element-config-sheet"]')
    await expect(fnSheet).toBeVisible()
    await expectCornerClampsAtMinimum(page, fnSheet, 520, 400)
    await page.keyboard.press('Escape')
    await expect(fnSheet).toHaveCount(0)

    // Functions Library sheet: 520x360.
    await expandPalette(page)
    await page.locator('[data-testid="palette-blocks-library-button"]').click()
    const library = page.locator('section[aria-label="Functions Library"]')
    await expect(library).toBeVisible()
    await expectCornerClampsAtMinimum(page, library, 520, 360)
    await page.keyboard.press('Escape')
    await expect(library).toHaveCount(0)
  })

  test('huge multiline string watcher opens auto-fit (not viewport-filling) and scrolls inside the editor', async ({
    page,
  }) => {
    test.setTimeout(60_000)
    await importAndOpen(page, 'viewport-cap')
    const modal = await openInspector(page, 'huge_log')

    // A string watcher OPENS auto-fit to its content (capped ~5 lines),
    // NOT at the viewport height; the ~300-line value scrolls INSIDE the
    // editor, which fills the watcher.
    await expect(async () => {
      const box = (await modal.boundingBox())!
      expect(box.height).toBeLessThan(400)
    }).toPass({ timeout: 10_000 })

    // The footer stays visible and the Mode trigger is clickable (not clipped).
    await expect(modal.locator('[data-testid="mode-dropdown"]')).toBeVisible()
    await modal.locator('[data-testid="mode-dropdown"]').click()
    await expect(page.getByRole('listbox')).toBeVisible()
    await page.keyboard.press('Escape')

    // The CodeMirror scroller holds the overflow (300 lines > the open height).
    const scrolls = await modal
      .locator('.cm-scroller')
      .first()
      .evaluate((el) => el.scrollHeight > el.clientHeight + 1)
    expect(scrolls, 'the editor should scroll past the auto-fit height').toBe(true)

    // The string watcher stays resizable (the corner grip is present).
    await expect(modal.locator('[data-testid="dialog-resize-corner"]')).toHaveCount(1)
  })

  test('stacking: cascade offsets, raise-before-drag, row re-expand raise, cross-surface z-order', async ({
    page,
  }) => {
    test.setTimeout(90_000)
    await page.setViewportSize({ width: 1600, height: 1000 })
    await importAndOpen(page, 'stacking')

    await openInspector(page, 'user_name')
    await openInspector(page, 'attempt')
    await openInspector(page, 'debug_log')

    // 24px cascade offsets in open order.
    expect((await geometryOf(modalFor(page, 'user_name'))).transform).toBe(
      'translate(calc(-50% + 0px), calc(-50% + 0px))',
    )
    expect((await geometryOf(modalFor(page, 'attempt'))).transform).toBe(
      'translate(calc(-50% + 24px), calc(-50% + 24px))',
    )
    expect((await geometryOf(modalFor(page, 'debug_log'))).transform).toBe(
      'translate(calc(-50% + 48px), calc(-50% + 48px))',
    )

    // The buried (bottom-most) watcher raises to front on pointerdown BEFORE
    // the drag starts and stays on top while dragging.
    const buried = modalFor(page, 'user_name')
    const handle = buried.locator('[data-testid$="-drag-handle"]')
    const hb = (await handle.boundingBox())!
    await page.mouse.move(hb.x + 10, hb.y + hb.height / 2)
    await page.mouse.down()
    await page.mouse.move(hb.x + 80, hb.y + 80, { steps: 4 })
    // Mid-drag: hit-test at the watcher's center must resolve inside it.
    const onTopMidDrag = await page.evaluate(() => {
      const target = document.querySelector(
        'section[aria-label="Inspect variable user_name"]',
      )!
      const rect = target.getBoundingClientRect()
      const hit = document.elementFromPoint(
        rect.x + rect.width / 2,
        rect.y + rect.height / 2,
      )
      return target.contains(hit)
    })
    await page.mouse.up()
    expect(onTopMidDrag, 'dragged watcher must be on top mid-drag').toBe(true)
    const zAfterDrag = await Promise.all(
      ['user_name', 'attempt', 'debug_log'].map(async (n) =>
        (await geometryOf(modalFor(page, n))).zIndex,
      ),
    )
    expect(zAfterDrag[0]).toBeGreaterThan(zAfterDrag[1])
    expect(zAfterDrag[0]).toBeGreaterThan(zAfterDrag[2])

    // Re-clicking the row expand of a buried open watcher raises its modal.
    await expandButtonFor(page, 'attempt').click()
    await expect(allModals(page)).toHaveCount(3)
    const zAfterReexpand = await Promise.all(
      ['user_name', 'attempt', 'debug_log'].map(async (n) =>
        (await geometryOf(modalFor(page, n))).zIndex,
      ),
    )
    expect(zAfterReexpand[1]).toBeGreaterThan(zAfterReexpand[0])
    expect(zAfterReexpand[1]).toBeGreaterThan(zAfterReexpand[2])

    // Clear the stack front-to-back via ESC.
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('Escape')
    }
    await expect(allModals(page)).toHaveCount(0)

    // Cross-surface: watcher vs element-config sheet share one z-order.
    await page.locator('[data-testid="workflow-node-body-log-1"]').dblclick()
    const sheet = page.locator('[data-testid="element-config-sheet"]')
    await expect(sheet).toBeVisible()

    const watcher = await openInspector(page, 'user_name')
    const watcherZ = async () => (await geometryOf(watcher)).zIndex
    const sheetZ = async () =>
      await sheet.evaluate((el: HTMLElement) => Number(el.style.zIndex))
    expect(await watcherZ()).toBeGreaterThan(await sheetZ())

    // Move the watcher clear of the 672px sheet so both stay clickable.
    await dragModalBy(page, 'user_name', -450, -200)

    // Raise the sheet: click its right side (clear of the moved watcher).
    const sheetBox = (await sheet.boundingBox())!
    await page.mouse.click(sheetBox.x + sheetBox.width - 60, sheetBox.y + 100)
    expect(await sheetZ()).toBeGreaterThan(await watcherZ())

    // Raise the watcher again via pointerdown on its header.
    const watcherHandle = watcher.locator('[data-testid$="-drag-handle"]')
    const whb = (await watcherHandle.boundingBox())!
    await page.mouse.move(whb.x + 10, whb.y + whb.height / 2)
    await page.mouse.down()
    await page.mouse.up()
    expect(await watcherZ()).toBeGreaterThan(await sheetZ())
  })

  test('watchers stay visible with their geometry across Function drills; same-scope deletion closes (VMGR-20)', async ({
    page,
  }) => {
    test.setTimeout(90_000)
    await importAndOpen(page, 'scope-drill')

    await openInspector(page, 'user_name')
    await openInspector(page, 'attempt')

    // Customize user_name's geometry so the round trip provably keeps it.
    await dragModalBy(page, 'user_name', -300, 120)
    await expect(async () => {
      await dragCornerBy(page, modalFor(page, 'user_name'), 60, 40)
      expect((await geometryOf(modalFor(page, 'user_name'))).height).not.toBe('')
    }).toPass({ timeout: 15_000 })
    const customized = await geometryOf(modalFor(page, 'user_name'))

    // Drill into the local Function via the node's dig-in glyph.
    await page
      .locator('[data-testid="workflow-node-fn-1"] [data-testid="node-dig-in"]')
      .click()
    await expect(
      page.locator('[data-testid="var-group-parameters"]'),
    ).toBeVisible()

    // Both test-level watchers REMAIN VISIBLE while drilled, geometry intact.
    await expect(modalFor(page, 'user_name')).toBeVisible()
    await expect(modalFor(page, 'attempt')).toBeVisible()
    const drilled = await geometryOf(modalFor(page, 'user_name'))
    expect(drilled.transform).toBe(customized.transform)
    expect(drilled.width).toBe(customized.width)
    expect(drilled.height).toBe(customized.height)

    // Open a watcher on a Function-local row while drilled.
    await openInspector(page, 'fn_tmp')
    await expect(allModals(page)).toHaveCount(3)

    // Pop back: all watchers still visible, none lost or moved.
    await page.locator('[data-testid="breadcrumb-back-arrow"]').click()
    await expect(page.locator('[data-testid="var-group-parameters"]')).toHaveCount(0)
    await expect(modalFor(page, 'user_name')).toBeVisible()
    await expect(modalFor(page, 'attempt')).toBeVisible()
    await expect(modalFor(page, 'fn_tmp')).toBeVisible()
    const popped = await geometryOf(modalFor(page, 'user_name'))
    expect(popped.transform).toBe(customized.transform)
    expect(popped.width).toBe(customized.width)
    expect(popped.height).toBe(customized.height)

    // Deleting a variable in ITS OWN scope closes its watcher (VMGR-20). The
    // out-of-scope fn_tmp watcher must survive the deletion of `attempt`.
    const attemptRow = rowFor(page, 'attempt')
    await attemptRow.hover()
    await attemptRow.locator('[data-testid^="delete-button-"]').click()
    const confirmDialog = page.getByRole('alertdialog').filter({ hasText: /Delete/ })
    await expect(confirmDialog).toBeVisible()
    await confirmDialog.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(modalFor(page, 'attempt')).toHaveCount(0)
    await expect(modalFor(page, 'user_name')).toBeVisible()
    await expect(modalFor(page, 'fn_tmp')).toBeVisible()
  })

  test('watchers persist across reload and navigation of the same test; nothing bleeds across tests', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    const testId = await importAndOpen(page, 'persistence')

    await openInspector(page, 'user_name')
    await openInspector(page, 'attempt')

    // Customized geometry + a non-default mode on user_name.
    await dragModalBy(page, 'user_name', -250, 100)
    await expect(async () => {
      await dragCornerBy(page, modalFor(page, 'user_name'), 50, 30)
      expect((await geometryOf(modalFor(page, 'user_name'))).height).not.toBe('')
    }).toPass({ timeout: 15_000 })
    await switchMode(page, 'user_name', 'Initial')
    const customized = await geometryOf(modalFor(page, 'user_name'))

    // Explicitly closed watchers stay closed after a reload.
    await closeInspector(page, 'attempt')

    // Reload: the open watcher restores by NAME with its geometry; mode
    // resets to the Current default (mode is not persisted).
    await page.reload()
    await waitForCanvasLoad(page)
    await expandVariablePanel(page)
    await expect(modalFor(page, 'user_name')).toBeVisible()
    await expect(modalFor(page, 'attempt')).toHaveCount(0)
    const restored = await geometryOf(modalFor(page, 'user_name'))
    expect(restored.transform).toBe(customized.transform)
    expect(restored.width).toBe(customized.width)
    expect(restored.height).toBe(customized.height)
    await expect(
      modalFor(page, 'user_name').locator('[data-testid="mode-dropdown"]'),
    ).toContainText('Current')

    // Navigate out of the workbench and back into the SAME test: restores.
    // Same-test ?editTest re-entry after a full page load
    // must re-hydrate the canvas, never hang on "Preparing workbench…".
    await page.goto('/tests')
    await expect(page).toHaveURL(/\/tests/)
    await page.goto(`/workbench?editTest=${testId}`)
    await waitForCanvasLoad(page)
    await expandVariablePanel(page)
    await expect(modalFor(page, 'user_name')).toBeVisible()
    const renavigated = await geometryOf(modalFor(page, 'user_name'))
    expect(renavigated.transform).toBe(customized.transform)
    expect(renavigated.width).toBe(customized.width)

    // Switching to ANOTHER test (with identically named variables) inherits
    // NO watchers.
    const otherId = await postFixture(page, loadFixture('persistence-other'))
    await page.goto(`/workbench?editTest=${otherId}`)
    await waitForCanvasLoad(page)
    await expandVariablePanel(page)
    await expect(rowFor(page, 'user_name')).toBeVisible()
    await expect(allModals(page)).toHaveCount(0)

    // Closing the open test drops the stored watchers entirely: a later
    // reopen of the original test starts clean.
    const closeButton = page.locator('[data-testid="toolbar-close-button"]')
    await closeButton.click()
    // The close finalizes back to a clean draft (no editing test) - the
    // button disables, which also guarantees the storage cleanup effect ran.
    await expect(closeButton).toBeDisabled()
    await page.goto(`/workbench?editTest=${testId}`)
    await waitForCanvasLoad(page)
    await expandVariablePanel(page)
    await expect(rowFor(page, 'user_name')).toBeVisible()
    await expect(allModals(page)).toHaveCount(0)
  })
})
