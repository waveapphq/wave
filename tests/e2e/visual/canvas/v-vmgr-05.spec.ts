/**
 * V-VMGR-05: Variable Inspect Modal - Expression Views (idle states)
 *
 * Design Decisions: VMGR-35 .. VMGR-41 (per-kind view families, plain text +
 * check menus, evaluated-view default never persisted, "Not evaluated yet."
 * single line, Initial lock + Current restore)
 * REQ: REQ-3.1.3.11 (variable watching UI panel), REQ-3.1.3.13 (computed
 * variables with expressions and runtime evaluation - watcher display side)
 *
 * Pass Criteria:
 * 1. A literal scalar watcher renders NO View dropdown - the footer has the
 *    Mode dropdown only (VMGR-35).
 * 2. An expression scalar watcher opens in the Last Evaluated view showing the
 *    single centered muted italic "Not evaluated yet." line with the
 *    `no value yet` metric (VMGR-38, VMGR-40).
 * 3. The scalar View menu lists exactly Last Evaluated / Expression as plain text
 *    items with a check on the selected entry, opening upward (VMGR-36).
 * 4. The Expression view shows the cyan raw source (no quotes) with the
 *    `expression` metric (VMGR-37).
 * 5. Initial mode disables the View dropdown forced to "Expression"
 *    (disabled + visible opacity-50 / cursor-not-allowed treatment) and
 *    dims + italicizes the cyan source; returning to Current restores the
 *    view selected before Initial - from Expression AND from Last Evaluated
 *    (VMGR-41).
 * 6. An expression complex watcher's View menu lists exactly Visual / Code /
 *    Expression and its Visual view shows the same empty state (VMGR-35).
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT } from '../../helpers/config'
import fs from 'fs'
import path from 'path'

const FIXTURE_PATH = path.resolve(
  __dirname,
  '../../fixtures/canvas/v-vmgr-inspect/fixture-expression-views.json',
)

const API_URL_SOURCE = "'https://api.wave.test/v1/services/' + service_name"

function loadFixture(nameSuffix: string): Record<string, unknown> {
  const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf-8'))
  fixture.name = `V-VMGR-05 ${nameSuffix} ${Date.now()}`
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

async function openInspector(page: Page, name: string): Promise<Locator> {
  await expandButtonFor(page, name).click()
  const modal = modalFor(page, name)
  await expect(modal).toBeVisible()
  return modal
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

async function switchView(
  page: Page,
  name: string,
  label: 'Last Evaluated' | 'Expression',
): Promise<void> {
  const trigger = modalFor(page, name).locator('[data-testid="view-dropdown"]')
  await trigger.click()
  await page.getByRole('option', { name: label, exact: true }).click()
  await expect(trigger).toContainText(label)
}

async function expectEmptyState(modal: Locator): Promise<void> {
  const emptyLine = modal.locator('text="Not evaluated yet."')
  await expect(emptyLine).toBeVisible()
  const lineClass = (await emptyLine.getAttribute('class')) ?? ''
  expect(lineClass).toMatch(/italic/)
  expect(lineClass).toMatch(/muted/)
  // An empty state carries no metric.
  await expect(modal.locator('[data-testid="inspect-metric"]')).toHaveCount(0)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('V-VMGR-05: expression views, idle states', () => {
  test('literal scalar watcher renders Mode only - no View dropdown (VMGR-35)', async ({
    page,
  }) => {
    await importAndOpen(page, 'ls-footer')
    const modal = await openInspector(page, 'service_name')

    await expect(modal.locator('[data-testid="mode-dropdown"]')).toBeVisible()
    await expect(modal.locator('[data-testid="view-dropdown"]')).toHaveCount(0)
    // The literal string definition renders raw through the line-numbered
    // editor (no quotes, no cyan source styling).
    const body = modal.locator('[data-testid="scalar-body"]')
    await expect(body.locator('.cm-content')).toHaveText('discovery')
  })

  test('ES watcher: Last Evaluated default with empty state, exact upward two-item menu, Expression view (VMGR-36..40)', async ({
    page,
  }) => {
    await importAndOpen(page, 'es-views')
    const modal = await openInspector(page, 'api_url')

    // Default view on open is the evaluated (Last Evaluated) view; with no runtime
    // value the body is the single centered muted italic empty line and the
    // metric reads `no value yet` (VMGR-38, VMGR-40).
    const trigger = modal.locator('[data-testid="view-dropdown"]')
    await expect(trigger).toContainText('Last Evaluated')
    await expect(trigger).toHaveAttribute('aria-label', 'Inspect view')
    await expectEmptyState(modal)
    await expect(modal.locator('[data-testid="scalar-body"]')).toHaveCount(0)

    // The View trigger sits right of Mode in the footer.
    const modeBox = (await modal.locator('[data-testid="mode-dropdown"]').boundingBox())!
    const viewBox = (await trigger.boundingBox())!
    expect(viewBox.x).toBeGreaterThan(modeBox.x + modeBox.width - 1)

    // Menu: exactly Last Evaluated / Expression, plain text + check on the selected
    // entry, opens UPWARD (VMGR-36).
    await trigger.click()
    const options = page.getByRole('option')
    await expect(options).toHaveCount(2)
    await expect(options.nth(0)).toHaveText('Last Evaluated')
    await expect(options.nth(1)).toHaveText('Expression')
    const listbox = page.getByRole('listbox')
    const menuBox = (await listbox.boundingBox())!
    const triggerBox = (await trigger.boundingBox())!
    expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(triggerBox.y + 1)
    const checked = page.locator('[role="option"][data-state="checked"]')
    await expect(checked).toHaveCount(1)
    await expect(checked).toHaveText('Last Evaluated')
    await expect(checked.locator('svg')).toHaveCount(1)

    // Expression view: cyan raw source, no quotes, NO metric (a source is
    // not a value); cyan is reserved for the source.
    await page.getByRole('option', { name: 'Expression', exact: true }).click()
    const sourceBody = modal.locator('[data-testid="scalar-body"]')
    await expect(sourceBody).toHaveText(API_URL_SOURCE)
    expect((await sourceBody.getAttribute('class')) ?? '').toMatch(/cyan/)
    await expect(modal.locator('[data-testid="inspect-metric"]')).toHaveCount(0)
    await expect(modal.locator('text="Not evaluated yet."')).toHaveCount(0)
  })

  test('Initial locks the View dropdown at Expression; Current restores the prior view (VMGR-41)', async ({
    page,
  }) => {
    await importAndOpen(page, 'initial-lock')
    const modal = await openInspector(page, 'api_url')
    const trigger = modal.locator('[data-testid="view-dropdown"]')

    // Flip to Expression view FIRST, then enter Initial: the trigger is
    // disabled, forced to "Expression", with the visible disabled treatment
    // (opacity + not-allowed cursor), and the body is the dim italic cyan
    // source with the `expression` metric (VMGR-41).
    await switchView(page, 'api_url', 'Expression')
    await switchMode(page, 'api_url', 'Initial')
    await expect(trigger).toBeDisabled()
    await expect(trigger).toContainText('Expression')
    await expect(trigger).toHaveCSS('opacity', '0.5')
    await expect(trigger).toHaveCSS('cursor', 'not-allowed')
    const initialBody = modal.locator('[data-testid="scalar-body"]')
    await expect(initialBody).toHaveText(API_URL_SOURCE)
    const initialClass = (await initialBody.getAttribute('class')) ?? ''
    expect(initialClass).toMatch(/cyan/)
    expect(initialClass).toMatch(/italic/)
    expect(initialClass).toMatch(/opacity-70/)
    // An expression source view carries no metric.
    await expect(modal.locator('[data-testid="inspect-metric"]')).toHaveCount(0)

    // Returning to Current restores the pre-Initial view: Expression.
    await switchMode(page, 'api_url', 'Current')
    await expect(trigger).toBeEnabled()
    await expect(trigger).toContainText('Expression')

    // Repeat from Last Evaluated: enter Initial (locked at Expression), return -
    // the trigger must read "Last Evaluated" again.
    await switchView(page, 'api_url', 'Last Evaluated')
    await switchMode(page, 'api_url', 'Initial')
    await expect(trigger).toBeDisabled()
    await expect(trigger).toContainText('Expression')
    await switchMode(page, 'api_url', 'Current')
    await expect(trigger).toBeEnabled()
    await expect(trigger).toContainText('Last Evaluated')
    await expectEmptyState(modal)
  })

  test('EC watcher: exact three-item menu and the same empty state (VMGR-35)', async ({
    page,
  }) => {
    await importAndOpen(page, 'ec-views')
    const modal = await openInspector(page, 'service_matrix')

    // Visual default with the identical "Not evaluated yet." empty state.
    const trigger = modal.locator('[data-testid="view-dropdown"]')
    await expect(trigger).toContainText('Visual')
    await expectEmptyState(modal)

    // Menu: exactly Visual / Code / Expression (VMGR-35).
    await trigger.click()
    const options = page.getByRole('option')
    await expect(options).toHaveCount(3)
    await expect(options.nth(0)).toHaveText('Visual')
    await expect(options.nth(1)).toHaveText('Code')
    await expect(options.nth(2)).toHaveText('Expression')
    const checked = page.locator('[role="option"][data-state="checked"]')
    await expect(checked).toHaveCount(1)
    await expect(checked).toHaveText('Visual')

    // Expression view shows the cyan array source.
    await page.getByRole('option', { name: 'Expression', exact: true }).click()
    const sourceBody = modal.locator('[data-testid="scalar-body"]')
    await expect(sourceBody).toHaveText(
      "[service_name, service_name.upper(), service_name + '-2']",
    )
    expect((await sourceBody.getAttribute('class')) ?? '').toMatch(/cyan/)
    // An expression source view carries no metric.
    await expect(modal.locator('[data-testid="inspect-metric"]')).toHaveCount(0)
  })
})
