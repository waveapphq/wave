/**
 * V-VMGR-06: Variable Inspect Modal - Compare Mode (static states)
 *
 * Design Decisions: VMGR-43 .. VMGR-48 (two plain side-by-side panes, no diff
 * highlighting; delta metric family, always-arrow; View drives both panes;
 * idle Current degrades to definition)
 * REQ: REQ-3.1.3.11 (variable watching UI panel), REQ-3.1.3.13 (computed
 * variables with expressions and runtime evaluation), REQ-3.2.2.18 (live
 * variable values display - the idle / definition rendering side)
 *
 * Pass Criteria:
 * 1. The Mode menu offers Compare as the third entry (Initial / Current /
 *    Compare), opens upward, with a check on the selected entry (VMGR-44).
 * 2. Compare splits the body into two side-by-side panes: Initial (left) and
 *    Current (right, hairline divider); the Initial pane value is dim + italic
 *    while the Current pane value is normal (VMGR-43).
 * 3. String delta metric renders with the always-shown ASCII arrow and the
 *    unit once at the end - idle equal counts still show the arrow
 *    (`3 -> 3 chars`).
 * 4. Array compare renders rows in both panes with the `5 -> 5 items` metric;
 *    the View dropdown (Visual / Code) drives both panes (VMGR-45).
 * 5. Table compare renders a per-pane mini-grid in each pane with the
 *    rows-only `3 -> 3 rows` metric (VMGR-46).
 * 6. An expression scalar in Compare labels the panes `Initial - source` /
 *    `Current - source` and shows the SOURCE in both (comparing a formula to an
 *    evaluated value is meaningless), collapses the View dropdown to a
 *    disabled `Expression`, and carries NO metric (source-vs-source Compare
 *    has no metric; VMGR-47, VMGR-48).
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT } from '../../helpers/config'
import fs from 'fs'
import path from 'path'

const FIXTURE_PATH = path.resolve(
  __dirname,
  '../../fixtures/canvas/v-vmgr-inspect/fixture.json',
)

const API_URL_SOURCE =
  "'https://api.wave.test/v1/services/discovery/' + user_name"

function loadFixture(nameSuffix: string): Record<string, unknown> {
  const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf-8'))
  fixture.name = `V-VMGR-06 ${nameSuffix} ${Date.now()}`
  return fixture
}

async function importAndOpen(page: Page, nameSuffix: string): Promise<void> {
  await page.request
    .delete(`http://localhost:${BACKEND_PORT}/workbench/session/`)
    .catch(() => {})
  const createResp = await page.request.post(
    `http://localhost:${BACKEND_PORT}/tests`,
    { data: loadFixture(nameSuffix) },
  )
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
  const state = await panel.getAttribute('data-state')
  if (state === 'collapsed') {
    await panel.locator('button[aria-label="Expand Variable Manager"]').click()
    await expect(panel).toHaveAttribute('data-state', 'expanded')
  }
}

// ---------------------------------------------------------------------------
// Locator helpers
// ---------------------------------------------------------------------------

const content = (page: Page): Locator =>
  page.locator('[data-testid="variable-manager-content"]')

const expandButtonFor = (page: Page, name: string): Locator =>
  content(page)
    .locator(`[aria-label="Variable ${name}"]`)
    .locator('[data-testid^="expand-button-"]')

const modalFor = (page: Page, name: string): Locator =>
  page.locator(`section[aria-label="Inspect variable ${name}"]`)

const initialPane = (modal: Locator): Locator =>
  modal.locator('[data-testid="compare-pane-initial"]')

const currentPane = (modal: Locator): Locator =>
  modal.locator('[data-testid="compare-pane-current"]')

// The pane label is the first child div, rendered before the value body.
const paneLabel = (pane: Locator): Locator => pane.locator('div').first()

async function openInspector(page: Page, name: string): Promise<Locator> {
  await expandButtonFor(page, name).click()
  const modal = modalFor(page, name)
  await expect(modal).toBeVisible()
  return modal
}

async function switchToCompare(modal: Locator, page: Page): Promise<void> {
  const trigger = modal.locator('[data-testid="mode-dropdown"]')
  await trigger.click()
  await page.getByRole('option', { name: 'Compare', exact: true }).click()
  await expect(trigger).toContainText('Compare')
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('V-VMGR-06: Compare mode, static states', () => {
  test('Mode menu offers Compare as the third entry, opens upward, check on selected (VMGR-44)', async ({
    page,
  }) => {
    await importAndOpen(page, 'mode-menu')
    const modal = await openInspector(page, 'user_name')

    const trigger = modal.locator('[data-testid="mode-dropdown"]')
    await trigger.click()

    const options = page.getByRole('option')
    await expect(options).toHaveCount(3)
    await expect(options.nth(0)).toHaveText('Initial')
    await expect(options.nth(1)).toHaveText('Current')
    await expect(options.nth(2)).toHaveText('Compare')

    // Menu opens upward (above the footer trigger).
    const listbox = page.getByRole('listbox')
    const menuBox = (await listbox.boundingBox())!
    const triggerBox = (await trigger.boundingBox())!
    expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(triggerBox.y + 1)

    // Current is the open default, so it carries the check.
    const checked = page.locator('[role="option"][data-state="checked"]')
    await expect(checked).toHaveCount(1)
    await expect(checked).toHaveText('Current')

    await page.getByRole('option', { name: 'Compare', exact: true }).click()
    await expect(trigger).toContainText('Compare')
  })

  test('string compare: two panes, dim+italic Initial vs normal Current, always-arrow delta (VMGR-43)', async ({
    page,
  }) => {
    await importAndOpen(page, 'string')
    const modal = await openInspector(page, 'user_name')
    await switchToCompare(modal, page)

    const compareBody = modal.locator('[data-testid="compare-body"]')
    await expect(compareBody).toBeVisible()

    // Two panes; labels Initial / Current; the Current pane carries the
    // hairline divider (border-l).
    await expect(paneLabel(initialPane(modal))).toHaveText('Initial')
    await expect(paneLabel(currentPane(modal))).toHaveText('Current')
    expect(
      (await currentPane(modal).getAttribute('class')) ?? '',
      'Current pane hairline divider',
    ).toMatch(/border-l/)
    expect((await initialPane(modal).getAttribute('class')) ?? '').not.toMatch(
      /border-l/,
    )

    // A string renders raw (no quotes) through the line-numbered editor; the
    // Initial pane dims via opacity (strings dim without italics).
    const initialValue = initialPane(modal).locator('[data-testid="scalar-body"]')
    const currentValue = currentPane(modal).locator('[data-testid="scalar-body"]')
    await expect(initialValue.locator('.cm-content')).toHaveText('bob')
    await expect(currentValue.locator('.cm-content')).toHaveText('bob')
    const initialClass = (await initialValue.getAttribute('class')) ?? ''
    expect(initialClass).toMatch(/opacity-70/)
    expect((await currentValue.getAttribute('class')) ?? '').not.toMatch(/opacity-70/)

    // Idle equal counts STILL render the arrow with the unit once at the end.
    await expect(modal.locator('[data-testid="inspect-metric"]')).toHaveText(
      '3 -> 3 chars',
    )
  })

  test('array compare: rows in both panes, items delta, View drives both panes (VMGR-45)', async ({
    page,
  }) => {
    await importAndOpen(page, 'array')
    const modal = await openInspector(page, 'items')
    await switchToCompare(modal, page)

    await expect(
      initialPane(modal).locator('[data-testid="array-row"]'),
    ).toHaveCount(5)
    await expect(
      currentPane(modal).locator('[data-testid="array-row"]'),
    ).toHaveCount(5)
    await expect(modal.locator('[data-testid="inspect-metric"]')).toHaveText(
      '5 -> 5 items',
    )

    // The single View dropdown (Visual / Code) drives BOTH panes: switching to
    // Code replaces both pane bodies with the read-only Code surface.
    const viewTrigger = modal.locator('[data-testid="view-dropdown"]')
    await expect(viewTrigger).toContainText('Visual')
    await viewTrigger.click()
    await page.getByRole('option', { name: 'Code', exact: true }).click()
    await expect(viewTrigger).toContainText('Code')
    await expect(
      initialPane(modal).locator('[data-testid="code-body"]'),
    ).toBeVisible()
    await expect(
      currentPane(modal).locator('[data-testid="code-body"]'),
    ).toBeVisible()
    await expect(modal.locator('[data-testid="array-row"]')).toHaveCount(0)
    // Metric is unchanged across views.
    await expect(modal.locator('[data-testid="inspect-metric"]')).toHaveText(
      '5 -> 5 items',
    )
  })

  test('table compare: per-pane mini-grids, rows-only delta (VMGR-46)', async ({
    page,
  }) => {
    await importAndOpen(page, 'table')
    const modal = await openInspector(page, 'results')
    await switchToCompare(modal, page)

    // Each pane renders its OWN table mini-grid (not a single full-bleed grid),
    // each with its 3 data rows and a horizontal-scroll wrapper.
    const initialGrid = initialPane(modal).locator('[data-testid="table-body"]')
    const currentGrid = currentPane(modal).locator('[data-testid="table-body"]')
    await expect(initialGrid).toBeVisible()
    await expect(currentGrid).toBeVisible()
    await expect(initialGrid.locator('tbody tr')).toHaveCount(3)
    await expect(currentGrid.locator('tbody tr')).toHaveCount(3)
    await expect(
      initialPane(modal).locator('div.overflow-x-auto').first(),
    ).toBeVisible()
    await expect(
      currentPane(modal).locator('div.overflow-x-auto').first(),
    ).toBeVisible()

    // Rows-only delta (cols omitted).
    await expect(modal.locator('[data-testid="inspect-metric"]')).toHaveText(
      '3 -> 3 rows',
    )
  })

  test('expression scalar compare: source vs source, disabled Expression View, no metric (VMGR-47, 48)', async ({
    page,
  }) => {
    await importAndOpen(page, 'expression')
    const modal = await openInspector(page, 'api_url')
    await switchToCompare(modal, page)

    // A scalar expression compares its two SOURCES (comparing a formula
    // to an evaluated value is meaningless), so both panes are labeled source.
    await expect(paneLabel(initialPane(modal))).toHaveText('Initial - source')
    await expect(paneLabel(currentPane(modal))).toHaveText('Current - source')

    // Both panes show the source string; Initial is dim+italic cyan, Current is
    // the (idle) definition source until an override re-arms it - NOT an empty
    // "Not evaluated yet." line.
    const initialSource = initialPane(modal).locator('[data-testid="scalar-body"]')
    await expect(initialSource).toHaveText(API_URL_SOURCE)
    const sourceClass = (await initialSource.getAttribute('class')) ?? ''
    expect(sourceClass).toMatch(/cyan/)
    expect(sourceClass).toMatch(/italic/)
    const currentSource = currentPane(modal).locator('[data-testid="scalar-body"]')
    await expect(currentSource).toHaveText(API_URL_SOURCE)
    await expect(
      currentPane(modal).locator('text="Not evaluated yet."'),
    ).toHaveCount(0)

    // The View dropdown pins to a single disabled `Expression` (the source view).
    const viewTrigger = modal.locator('[data-testid="view-dropdown"]')
    await expect(viewTrigger).toContainText('Expression')
    await expect(viewTrigger).toBeDisabled()

    // Source-vs-source Compare carries no metric.
    await expect(modal.locator('[data-testid="inspect-metric"]')).toHaveCount(0)
  })
})
