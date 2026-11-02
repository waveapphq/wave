/**
 * V-VMGR-04: Variable Inspect Modal - Complex Bodies, Views, States
 *
 * Design Decisions: VMGR-23 .. VMGR-34 (complex expand enabled, a11y labels)
 * REQ: REQ-3.1.3.11 (variable watching UI panel), REQ-3.2.2.18 (live
 * variable values display - idle/definition rendering side)
 *
 * Pass Criteria:
 * 1.  Complex rows' expand is ENABLED with the "Inspect <name>" tooltip and
 *     opens the typed-body watcher (VMGR-23). Array and map watchers open
 *     at 400px; table watchers at 480px.
 * 2.  Array Visual body: one row per element with a muted right-aligned
 *     0-based index column, hairline separators, full untruncated values
 *     (VMGR-24); per-element tint by the value's OWN type - string sky
 *     (quoted), integer violet, boolean orange, nested map as compact
 *     one-line emerald JSON, null muted (VMGR-27).
 * 3.  Map Visual body: key in plain mono (max ~45% width) + tinted value
 *     per row, hairline separators (VMGR-25).
 * 4.  Table Visual body: semantic mini-grid with a sticky uppercase muted
 *     header; the FIRST column is a dedicated muted 0-based row-index `#`
 *     column (aria-label "Row index"); data columns follow; per-cell tints;
 *     horizontal-scroll wrapper (VMGR-26, VMGR-27).
 * 5.  Complex metrics in the footer: `5 items` / `4 keys` /
 *     `3 rows x 4 cols` with the U+00D7 multiplication sign (VMGR-30).
 * 6.  View dropdown sits right of Mode: text trigger `Visual` / `Code` +
 *     chevron, aria-label "Inspect view"; the menu opens UPWARD with
 *     exactly the two text items and a check on the selected entry; the
 *     view resets to Visual on every open (VMGR-28). Expression-typed
 *     complex watchers open in the Visual view with the "Not evaluated
 *     yet." empty state and carry the three-item view family (menu
 *     exactness pinned in V-VMGR-05).
 * 7.  Code view: read-only CodeMirror JSON surface with line numbers,
 *     2-space pretty-print; {columns, rows} dict tables serialize as
 *     array-of-row-objects; the metric is identical to the Visual view
 *     (VMGR-29, VMGR-30).
 * 8.  Empty complex values render the centered muted italic line
 *     `no items` / `no entries` / `no rows` with the zero-count metric; a
 *     table declared with three columns and no rows keeps its `#` + three
 *     column header above `no rows` (VMGR-31).
 * 9.  Initial mode dims + italicizes the whole Visual body; the Code body
 *     dims WITHOUT italics (VMGR-32).
 * 10. Large-value guard: the Visual body renders the first 500 items
 *     followed by the muted `+ N more - switch to Code view` line; the
 *     Code view has no cap line; the metric keeps the full count (VMGR-34).
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

const BIG_LIST = Array.from({ length: 512 }, (_, i) => i)

function loadFixture(nameSuffix: string): Record<string, unknown> {
  const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf-8'))
  fixture.name = `V-VMGR-04 ${nameSuffix} ${Date.now()}`
  // 512-integer array kept out of the JSON for readability (see README).
  fixture.variables.big_list.value = BIG_LIST
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

async function switchView(
  page: Page,
  name: string,
  label: 'Visual' | 'Code',
): Promise<void> {
  const trigger = modalFor(page, name).locator('[data-testid="view-dropdown"]')
  await trigger.click()
  await page.getByRole('option', { name: label, exact: true }).click()
  await expect(trigger).toContainText(label)
}

async function styleWidthOf(modal: Locator): Promise<string> {
  return await modal.evaluate((el: HTMLElement) => el.style.width)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('V-VMGR-04: complex bodies, views, states', () => {
  test('array body: enabled expand, index column, per-element tints, nested one-line JSON (VMGR-23, 24, 27, 30)', async ({
    page,
  }) => {
    await importAndOpen(page, 'array-body')

    // The expand affordance on a complex row is ENABLED with the standard
    // tooltip.
    const expand = expandButtonFor(page, 'items')
    await expect(expand).not.toHaveAttribute('aria-disabled', 'true')
    await page.mouse.move(0, 0)
    await expand.hover()
    await expect(
      page.getByRole('tooltip', { name: 'Inspect items', exact: true }),
    ).toBeVisible({ timeout: 2000 })

    const modal = await openInspector(page, 'items')
    expect(await styleWidthOf(modal)).toBe('400px')

    // Five element rows with the muted right-aligned 0-based index column
    // and hairline separators.
    const body = modal.locator('[data-testid="array-body"]')
    await expect(body).toBeVisible()
    const rows = body.locator('[data-testid="array-row"]')
    await expect(rows).toHaveCount(5)
    const indexes = body.locator('[data-testid="array-index"]')
    await expect(indexes).toHaveText(['0', '1', '2', '3', '4'])
    const indexClass = (await indexes.first().getAttribute('class')) ?? ''
    expect(indexClass).toMatch(/text-right/)
    expect(indexClass).toMatch(/muted/)
    expect((await rows.first().getAttribute('class')) ?? '').toMatch(/border-b/)

    // Per-element tint by the value's OWN type (VMGR-27): string sky and
    // quoted, integer violet, boolean orange, nested map compact one-line
    // emerald JSON, null muted.
    const valueAt = (i: number) => rows.nth(i).locator('span').nth(1)
    await expect(valueAt(0)).toHaveText('"alpha"')
    expect(await valueAt(0).getAttribute('class')).toMatch(/sky/)
    await expect(valueAt(1)).toHaveText('42')
    expect(await valueAt(1).getAttribute('class')).toMatch(/violet/)
    await expect(valueAt(2)).toHaveText('true')
    expect(await valueAt(2).getAttribute('class')).toMatch(/orange/)
    await expect(valueAt(3)).toHaveText('{"retries":3,"host":"srv-a"}')
    expect(await valueAt(3).getAttribute('class')).toMatch(/emerald/)
    await expect(valueAt(4)).toHaveText('null')
    expect(await valueAt(4).getAttribute('class')).toMatch(/muted/)

    // Footer: complex metric + the View trigger right of Mode (VMGR-30).
    await expect(modal.locator('[data-testid="inspect-metric"]')).toHaveText('5 items')
    await expect(modal.locator('[data-testid="view-dropdown"]')).toContainText('Visual')
  })

  test('map body: Key | Value grid, quoted + tinted keys, tinted values (VMGR-25, 27, 30)', async ({
    page,
  }) => {
    await importAndOpen(page, 'map-body')
    const modal = await openInspector(page, 'headers')
    expect(await styleWidthOf(modal)).toBe('400px')

    const body = modal.locator('[data-testid="map-body"]')
    await expect(body).toBeVisible()
    const rows = body.locator('[data-testid="map-row"]')
    await expect(rows).toHaveCount(4)
    const keys = body.locator('[data-testid="map-key"]')
    // Keys go through the same quote + type-tint as values (string -> sky).
    await expect(keys).toHaveText(['"Content-Type"', '"retries"', '"secure"', '"timeout"'])
    expect((await keys.first().getAttribute('class')) ?? '').toMatch(/sky/)
    expect((await rows.first().getAttribute('class')) ?? '').toMatch(/border-b/)

    // Values are the second cell, tinted by their OWN type.
    const valueAt = (i: number) => rows.nth(i).locator('td').nth(1)
    await expect(valueAt(0)).toHaveText('"application/json"')
    expect(await valueAt(0).getAttribute('class')).toMatch(/sky/)
    await expect(valueAt(1)).toHaveText('3')
    expect(await valueAt(1).getAttribute('class')).toMatch(/violet/)
    await expect(valueAt(2)).toHaveText('true')
    expect(await valueAt(2).getAttribute('class')).toMatch(/orange/)
    await expect(valueAt(3)).toHaveText('1.5')
    expect(await valueAt(3).getAttribute('class')).toMatch(/pink/)

    await expect(modal.locator('[data-testid="inspect-metric"]')).toHaveText('4 keys')
  })

  test('table body: sticky uppercase header, # index column, per-cell tints, 520px (VMGR-23, 26, 27, 30)', async ({
    page,
  }) => {
    await importAndOpen(page, 'table-body')
    const modal = await openInspector(page, 'results')
    expect(await styleWidthOf(modal)).toBe('520px')

    const body = modal.locator('[data-testid="table-body"]')
    await expect(body).toBeVisible()

    // Header: `#` index column first (aria-label "Row index"), then the
    // data columns, all sticky + uppercase + muted.
    const headers = body.locator('thead th')
    await expect(headers).toHaveCount(5)
    await expect(headers.nth(0)).toHaveText('#')
    await expect(headers.nth(0)).toHaveAttribute('aria-label', 'Row index')
    await expect(headers.nth(1)).toHaveText('id')
    await expect(headers.nth(2)).toHaveText('name')
    await expect(headers.nth(3)).toHaveText('retries')
    await expect(headers.nth(4)).toHaveText('ok')
    const headerClass = (await headers.nth(1).getAttribute('class')) ?? ''
    expect(headerClass).toMatch(/sticky/)
    expect(headerClass).toMatch(/uppercase/)
    expect(headerClass).toMatch(/muted/)
    expect((await headers.nth(0).getAttribute('class')) ?? '').toMatch(/text-right/)

    // Three data rows; the index cells count 0-based; data cells tinted by
    // the cell value's own type.
    const bodyRows = body.locator('tbody tr')
    await expect(bodyRows).toHaveCount(3)
    await expect(body.locator('[data-testid="table-row-index"]')).toHaveText([
      '0',
      '1',
      '2',
    ])
    const firstRowCells = bodyRows.nth(0).locator('td')
    await expect(firstRowCells.nth(1)).toHaveText('1')
    expect(await firstRowCells.nth(1).getAttribute('class')).toMatch(/violet/)
    await expect(firstRowCells.nth(2)).toHaveText('"alpha"')
    expect(await firstRowCells.nth(2).getAttribute('class')).toMatch(/sky/)
    await expect(firstRowCells.nth(4)).toHaveText('true')
    expect(await firstRowCells.nth(4).getAttribute('class')).toMatch(/orange/)
    expect(
      await firstRowCells.nth(0).getAttribute('class'),
      'index cell is muted',
    ).toMatch(/muted/)

    // The grid scrolls inside its own both-axis wrapper (VMGR-26).
    expect(
      await body
        .locator('div.overflow-x-auto')
        .first()
        .getAttribute('class'),
    ).toMatch(/overflow-y-auto/)

    // Metric uses the U+00D7 multiplication sign between rows and cols.
    await expect(modal.locator('[data-testid="inspect-metric"]')).toHaveText(
      '3 rows × 4 cols',
    )
  })

  test('view dropdown + code view: upward menu, check, line numbers, row-objects serialization, reset (VMGR-28, 29, 30)', async ({
    page,
  }) => {
    await importAndOpen(page, 'code-view')
    const modal = await openInspector(page, 'items')

    // Trigger: text label + chevron right of Mode, aria-label "Inspect view".
    const trigger = modal.locator('[data-testid="view-dropdown"]')
    await expect(trigger).toContainText('Visual')
    await expect(trigger).toHaveAttribute('aria-label', 'Inspect view')
    const modeBox = (await modal.locator('[data-testid="mode-dropdown"]').boundingBox())!
    const viewBox = (await trigger.boundingBox())!
    expect(viewBox.x).toBeGreaterThan(modeBox.x + modeBox.width - 1)

    // Menu: exactly Visual / Code, opens UPWARD, check on the selected entry.
    await trigger.click()
    const options = page.getByRole('option')
    await expect(options).toHaveCount(2)
    await expect(options.nth(0)).toHaveText('Visual')
    await expect(options.nth(1)).toHaveText('Code')
    const listbox = page.getByRole('listbox')
    const menuBox = (await listbox.boundingBox())!
    const triggerBox = (await trigger.boundingBox())!
    expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(triggerBox.y + 1)
    const checked = page.locator('[role="option"][data-state="checked"]')
    await expect(checked).toHaveCount(1)
    await expect(checked).toHaveText('Visual')
    await expect(checked.locator('svg')).toHaveCount(1)

    // Code view: CodeMirror JSON surface with line numbers; the metric is
    // identical to the Visual view (VMGR-29, VMGR-30).
    await page.getByRole('option', { name: 'Code', exact: true }).click()
    const codeBody = modal.locator('[data-testid="code-body"]')
    await expect(codeBody).toBeVisible()
    await expect(modal.locator('[data-testid="array-body"]')).toHaveCount(0)
    await expect(codeBody.locator('.cm-lineNumbers')).toBeVisible()
    await expect(codeBody.locator('.cm-content')).toContainText('"alpha"')
    await expect(codeBody.locator('.cm-content')).toContainText('"retries": 3')
    await expect(modal.locator('[data-testid="inspect-metric"]')).toHaveText('5 items')

    // View resets to Visual on every open - never persisted (VMGR-28).
    await closeInspector(page, 'items')
    const reopened = await openInspector(page, 'items')
    await expect(reopened.locator('[data-testid="view-dropdown"]')).toContainText(
      'Visual',
    )
    await expect(reopened.locator('[data-testid="array-body"]')).toBeVisible()
    await closeInspector(page, 'items')

    // {columns, rows} dict tables serialize as array-of-row-objects.
    await openInspector(page, 'results')
    await switchView(page, 'results', 'Code')
    const tableCode = modalFor(page, 'results').locator('[data-testid="code-body"]')
    await expect(tableCode.locator('.cm-content')).toContainText('"id": 1')
    await expect(tableCode.locator('.cm-content')).toContainText('"name": "alpha"')
    await closeInspector(page, 'results')

    // Expression-typed complex watcher: Visual default with the empty
    // state and a View dropdown; the cyan source moved to the Expression
    // view (the exact three-item menu is pinned in V-VMGR-05).
    const exprModal = await openInspector(page, 'computed_items')
    await expect(exprModal.locator('[data-testid="inspect-expr-badge"]')).toHaveText(
      '{x}',
    )
    await expect(exprModal.locator('[data-testid="view-dropdown"]')).toContainText(
      'Visual',
    )
    await expect(exprModal.locator('text="Not evaluated yet."')).toBeVisible()
    // An empty state carries no metric.
    await expect(exprModal.locator('[data-testid="inspect-metric"]')).toHaveCount(0)
    await exprModal.locator('[data-testid="view-dropdown"]').click()
    await page.getByRole('option', { name: 'Expression', exact: true }).click()
    const exprBody = exprModal.locator('[data-testid="scalar-body"]')
    await expect(exprBody).toHaveText("items + ['omega']")
    expect((await exprBody.getAttribute('class')) ?? '').toMatch(/cyan/)
    // An expression source view carries no metric.
    await expect(exprModal.locator('[data-testid="inspect-metric"]')).toHaveCount(0)
  })

  test('empty values + initial mode: centered italic lines, zero metrics, dim+italic Visual, dim-only Code (VMGR-31, 32)', async ({
    page,
  }) => {
    await importAndOpen(page, 'states')

    // Empty array / map / 0-row table render the centered muted italic
    // line with the zero-count metric (VMGR-31).
    const cases: Array<{ name: string; line: string; metric: string }> = [
      { name: 'empty_list', line: 'no items', metric: '0 items' },
      { name: 'empty_map', line: 'no entries', metric: '0 keys' },
      { name: 'schema_only', line: 'no rows', metric: '0 rows × 3 cols' },
    ]
    for (const { name, line, metric } of cases) {
      const modal = await openInspector(page, name)
      const emptyLine = modal.locator(`text="${line}"`)
      await expect(emptyLine).toBeVisible()
      expect(
        (await emptyLine.getAttribute('class')) ?? '',
        `${name} empty line styling`,
      ).toMatch(/italic/)
      await expect(modal.locator('[data-testid="inspect-metric"]')).toHaveText(metric)
      if (name === 'schema_only') {
        // A table with columns and no rows keeps its column header above `no rows` (VMGR-31).
        const body = modal.locator('[data-testid="table-body"]')
        await expect(body.locator('thead th')).toHaveText(['#', 'id', 'name', 'ok'])
        await expect(body.locator('tbody tr')).toHaveCount(0)
        const header = await body.locator('thead').boundingBox()
        const lineBox = await emptyLine.boundingBox()
        expect(header, 'the header row is laid out').not.toBeNull()
        expect(lineBox, 'the no rows line is laid out').not.toBeNull()
        expect(lineBox!.y, '`no rows` sits below the header').toBeGreaterThanOrEqual(
          header!.y + header!.height,
        )
      }
      await closeInspector(page, name)
    }

    // Initial mode dims + italicizes the entire Visual body (VMGR-32)
    // while the content stays identical to Current.
    const modal = await openInspector(page, 'headers')
    const mapBody = modal.locator('[data-testid="map-body"]')
    expect((await mapBody.getAttribute('class')) ?? '').not.toMatch(/italic/)
    await switchMode(page, 'headers', 'Initial')
    const initialClass = (await mapBody.getAttribute('class')) ?? ''
    expect(initialClass).toMatch(/italic/)
    expect(initialClass).toMatch(/opacity-70/)
    await expect(mapBody.locator('[data-testid="map-row"]')).toHaveCount(4)
    await expect(modal.locator('[data-testid="inspect-metric"]')).toHaveText('4 keys')

    // The Code body in Initial dims WITHOUT italics (italic code renders
    // broken).
    await switchView(page, 'headers', 'Code')
    const codeBody = modal.locator('[data-testid="code-body"]')
    await expect(codeBody).toBeVisible()
    const codeClass = (await codeBody.getAttribute('class')) ?? ''
    expect(codeClass).toMatch(/opacity-70/)
    expect(codeClass).not.toMatch(/italic/)
  })

  test('500-cap guard: first 500 items + overflow line in Visual, no cap in Code (VMGR-34)', async ({
    page,
  }) => {
    await importAndOpen(page, 'large-value')
    const modal = await openInspector(page, 'big_list')

    // Visual renders exactly the first 500 rows plus the muted overflow
    // line with the exact copy; the metric keeps the full count.
    const body = modal.locator('[data-testid="array-body"]')
    await expect(body.locator('[data-testid="array-row"]')).toHaveCount(500)
    const overflow = modal.locator('[data-testid="body-overflow-line"]')
    await expect(overflow).toHaveText('+ 12 more - switch to Code view')
    expect((await overflow.getAttribute('class')) ?? '').toMatch(/muted/)
    await expect(modal.locator('[data-testid="inspect-metric"]')).toHaveText(
      '512 items',
    )

    // Code view has no cap line and keeps the same metric.
    await switchView(page, 'big_list', 'Code')
    await expect(modal.locator('[data-testid="code-body"]')).toBeVisible()
    await expect(modal.locator('[data-testid="body-overflow-line"]')).toHaveCount(0)
    await expect(modal.locator('[data-testid="inspect-metric"]')).toHaveText(
      '512 items',
    )
  })
})
