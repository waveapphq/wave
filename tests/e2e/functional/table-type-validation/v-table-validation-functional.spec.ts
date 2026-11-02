/**
 * V-TABLE-VALIDATION: design-time table type validation (functional).
 * Design Decisions: VMGR-69, VMGR-70, VMGR-71, VMGR-106, VMGR-110
 * REQ: REQ-3.1.3.11, REQ-3.5.5.1
 *
 * The row pencil opens the Edit window; its Open editor opens the "Edit value" window, where one
 * shared table-schema validator gates Save the same way in the Visual and the Code view:
 *  - Visual: an invalid cell and duplicate column names flag in place and hold Save.
 *  - Code: cell-type, unexpected / missing column and structure errors hold Save; a valid fix is
 *    written back into the window, saved, and stored with its column types.
 *  - A multi-problem strip expands into the full issue list.
 *  - Invalid JSON locks the Visual switch with an inline alert and disables Format.
 *  - A cell-type error keeps Visual reachable and flagged; only a structure error (or invalid JSON)
 *    locks the switch.
 *  - The watcher's Compare mode pill is an active slate neutral.
 *
 * Phase: functional-workflow (imports its own fixture via POST /tests).
 */

import { test, expect, type Page, type Locator } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_URL } from '../../helpers/config'
import {
  closeValueEditor,
  expandVariableManager,
  openEditWindow,
  openValueEditor,
  replaceValueEditorCode,
  saveValueEditor,
  saveWindow,
  setValueEditorView,
  valueField,
} from '../../helpers/variable-create'
import { saveTest } from '../../helpers/workbench'
import fs from 'fs'
import path from 'path'

const FIXTURE_PATH = path.resolve(__dirname, 'fixture.json')

function loadFixture(): Record<string, unknown> {
  const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf-8'))
  fixture.name = `Table Type Validation ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  return fixture
}

async function importValidateAndOpen(page: Page): Promise<string> {
  await page.request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => {})
  const create = await page.request.post(`${BACKEND_URL}/tests`, { data: loadFixture() })
  const body = await create.json().catch(() => null)
  expect(
    create.ok(),
    `POST /tests failed: ${create.status()} - ${JSON.stringify(body)}`,
  ).toBeTruthy()
  const testId = (body.data?.id ?? body.id) as string

  // The fixture must validate with zero errors.
  const validate = await page.request.post(`${BACKEND_URL}/tests/${testId}/validate`)
  const validateBody = await validate.json().catch(() => null)
  expect(
    validate.ok(),
    `validate failed: ${validate.status()} - ${JSON.stringify(validateBody)}`,
  ).toBeTruthy()
  const errors =
    validateBody?.data?.errors ?? validateBody?.error?.details?.[0]?.errors ?? []
  expect(errors, 'fixture must validate with zero errors').toHaveLength(0)

  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)
  await expandVariableManager(page)
  return testId
}

const content = (page: Page): Locator =>
  page.locator('[data-testid="variable-manager-content"]')
const rowFor = (page: Page, name: string): Locator =>
  content(page).locator(`[aria-label="Variable ${name}"]`)
const modalFor = (page: Page, name: string): Locator =>
  page.locator(`section[aria-label="Inspect variable ${name}"]`)
const strip = (sheet: Locator): Locator => sheet.locator('[data-testid="value-editor-validation"]')
const saveButton = (sheet: Locator): Locator =>
  sheet.locator('[data-testid="value-editor-save-button"]')

// The row pencil opens the Edit window; Open editor shows the table in the "Edit value" Visual view.
async function openTableEditor(page: Page, name: string): Promise<{ win: Locator; sheet: Locator }> {
  const win = await openEditWindow(page, name)
  const sheet = await openValueEditor(page, win)
  await expect(sheet.locator('[data-testid="table-edit-body"]')).toBeVisible()
  return { win, sheet }
}

// The expand affordance opens the watcher in read mode (Current view), where the
// Mode pill is interactive.
async function openInspector(page: Page, name: string): Promise<Locator> {
  const row = rowFor(page, name)
  await expect(row).toBeVisible()
  await row.hover()
  await row.locator('[data-testid^="expand-button-"]').click()
  const modal = modalFor(page, name)
  await expect(modal).toBeVisible()
  return modal
}

async function expectSaveDisabled(sheet: Locator): Promise<void> {
  await expect(saveButton(sheet)).toBeDisabled()
}
async function expectSaveEnabled(sheet: Locator): Promise<void> {
  await expect(saveButton(sheet)).toBeEnabled()
}

test.describe('V-TABLE-VALIDATION: table type validation', () => {
  test('Visual view gates Save on an invalid cell and duplicate column names', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    await importValidateAndOpen(page)
    const { sheet } = await openTableEditor(page, 'results')

    // VMGR-70: an incomplete integer in the integer `id` column flags the cell red
    // (aria-invalid) and holds Save with the specific cell message. (A lone "-":
    // the numeric guard hard-stops non-numeric chars like "abc" outright.)
    await sheet.locator('[data-testid="table-cell-0-0"]').fill('-')
    await expect(sheet.locator('[data-testid="table-cell-0-0"]')).toHaveAttribute(
      'aria-invalid',
      'true',
    )
    await expect(strip(sheet)).toContainText('Row 0 "id": expected integer')
    await expectSaveDisabled(sheet)

    // VMGR-69: renaming `name` to a duplicate `id` flags BOTH headers and the
    // duplicate-name message leads the strip (column problems before cells). The
    // count is every problem - 2 duplicate columns + 1 bad cell -> "(+2 more)".
    await sheet.locator('[data-testid="table-header-1"]').fill('id')
    await expect(sheet.locator('[data-testid="table-header-0"]')).toHaveAttribute(
      'aria-invalid',
      'true',
    )
    await expect(sheet.locator('[data-testid="table-header-1"]')).toHaveAttribute(
      'aria-invalid',
      'true',
    )
    await expect(strip(sheet)).toContainText('Duplicate column name "id"')
    await expect(sheet.locator('[data-testid="value-editor-validation-more"]')).toContainText(
      '(+2 more)',
    )
    await expectSaveDisabled(sheet)

    // Fixing both clears every mark; a changed valid value re-enables Save.
    await sheet.locator('[data-testid="table-header-1"]').fill('name')
    await sheet.locator('[data-testid="table-cell-0-0"]').fill('5')
    await expect(strip(sheet)).toHaveCount(0)
    await expectSaveEnabled(sheet)
  })

  test('Code view gates Save on cell-type and column-shape errors, and a valid fix persists', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    const testId = await importValidateAndOpen(page)
    const { win, sheet } = await openTableEditor(page, 'results')
    await setValueEditorView(page, sheet, 'Code')
    await expect(sheet.locator('[data-testid="code-body"]')).toBeVisible()

    // VMGR-71: a non-integer in the integer `id` cell holds Save with the same cell
    // message as the Visual view (schema-checked on change).
    await replaceValueEditorCode(page, sheet, '[{"id":"abc","name":"alpha"},{"id":2,"name":"beta"}]')
    await expect(strip(sheet)).toContainText('Row 0 "id": expected integer')
    await expectSaveDisabled(sheet)

    // VMGR-71: a stray key the schema does not know is an unexpected-column error
    // that routes the user to the Visual view.
    await replaceValueEditorCode(page, sheet, '[{"id":1,"name":"alpha","extra":9},{"id":2,"name":"beta"}]')
    await expect(strip(sheet)).toContainText(
      'Unexpected column "extra" - change columns in the Visual view',
    )
    await expectSaveDisabled(sheet)

    // VMGR-71: a schema column missing from the data is a missing-column error.
    await replaceValueEditorCode(page, sheet, '[{"id":1},{"id":2}]')
    await expect(strip(sheet)).toContainText(
      'Missing column "name" - change columns in the Visual view',
    )
    await expectSaveDisabled(sheet)

    // A valid fix re-enables Save; Save writes it into the window, and the window
    // Save and the Test save store it with its column types (REQ-3.5.5.4).
    await replaceValueEditorCode(page, sheet, '[{"id":7,"name":"zeta"},{"id":2,"name":"beta"}]')
    await expect(strip(sheet)).toHaveCount(0)
    await expectSaveEnabled(sheet)
    await saveValueEditor(sheet)
    await expect(valueField(win).locator('input')).toHaveValue(
      '[{"id": 7, "name": "zeta"}, {"id": 2, "name": "beta"}]',
    )
    await closeValueEditor(page, sheet)
    await saveWindow(page, win)
    await saveTest(page)
    const stored = await page.request.get(`${BACKEND_URL}/tests/${testId}`)
    expect(stored.ok(), `GET /tests/${testId}: ${stored.status()}`).toBeTruthy()
    const table = (await stored.json()).data.variables.results.value
    expect(table.columns).toEqual([
      { name: 'id', type: 'integer' },
      { name: 'name', type: 'string' },
    ])
    expect(table.rows.map((row: unknown[]) => row.map(String))).toEqual([
      ['7', 'zeta'],
      ['2', 'beta'],
    ])
  })

  test('a multi-problem table strip lists every issue in the (+N more) popover', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    await importValidateAndOpen(page)
    const { sheet } = await openTableEditor(page, 'results')
    await setValueEditorView(page, sheet, 'Code')
    await expect(sheet.locator('[data-testid="code-body"]')).toBeVisible()

    // VMGR-70: a multi-problem state (an unexpected key + a bad integer cell) shows
    // the first message plus a clickable "(+N more)" that opens the full issue list;
    // the list carries one row per problem (count == list length).
    await replaceValueEditorCode(page, sheet, '[{"id":"x","name":"alpha","extra":1}]')
    await expect(strip(sheet)).toContainText(
      'Unexpected column "extra" - change columns in the Visual view',
    )
    const more = sheet.locator('[data-testid="value-editor-validation-more"]')
    await expect(more).toContainText('(+1 more)')
    await more.click()
    // The popover is portaled - query via the page, not within the sheet.
    const list = page.locator('[data-testid="value-editor-validation-more-list"]')
    await expect(list).toBeVisible()
    await expect(list).toContainText('Unexpected column "extra" - change columns in the Visual view')
    await expect(list).toContainText('Row 0 "id": expected integer')
  })

  test('invalid Code JSON locks the Visual switch with an inline alert', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    await importValidateAndOpen(page)
    const { sheet } = await openTableEditor(page, 'results')
    await setValueEditorView(page, sheet, 'Code')
    await expect(sheet.locator('[data-testid="code-body"]')).toBeVisible()

    // Invalid JSON disables Save and Format and, on opening the View menu, the Visual
    // option is disabled with an inline alert icon + the reason tooltip.
    await replaceValueEditorCode(page, sheet, '[ this is not json')
    // The strip shows the parser's own precise JSON error.
    await expect(strip(sheet)).toContainText(/valid JSON/)
    await expectSaveDisabled(sheet)
    await expect(sheet.locator('[data-testid="value-editor-format-button"]')).toBeDisabled()
    await sheet.locator('[data-testid="view-dropdown"]').click()
    const lockedVisual = page.getByRole('option', { name: 'Visual', exact: true })
    await expect(lockedVisual).toHaveAttribute('aria-disabled', 'true')
    // SHELL-7a: the reason comes from the shared tooltip, not a browser popup (its
    // copy is pinned by the view-dropdown unit spec; hovering a Select option here
    // would move the highlighted item).
    await expect(lockedVisual).not.toHaveAttribute('title', /.*/)
    await expect(page.locator('[data-testid="view-locked-alert"]')).toBeVisible()
    await page.keyboard.press('Escape')

    // Re-typing valid JSON (matching the carried id + name schema) clears the strip
    // and unlocks Visual.
    await replaceValueEditorCode(page, sheet, '[{"id":1,"name":"alpha"}]')
    await expect(strip(sheet)).toHaveCount(0)
    await sheet.locator('[data-testid="view-dropdown"]').click()
    await expect(
      page.getByRole('option', { name: 'Visual', exact: true }),
    ).not.toHaveAttribute('aria-disabled', 'true')
    await expect(page.locator('[data-testid="view-locked-alert"]')).toHaveCount(0)
    await page.keyboard.press('Escape')
  })

  test('a cell-type error keeps Visual reachable + flagged; a structure error locks it', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    await importValidateAndOpen(page)
    const { sheet } = await openTableEditor(page, 'results')
    await setValueEditorView(page, sheet, 'Code')
    await expect(sheet.locator('[data-testid="code-body"]')).toBeVisible()

    // VMGR-71: a non-string (boolean) in the string `name` column is "expected string"
    // and holds Save, but does NOT lock the Visual switch (only invalid JSON or a
    // structure error does). (A JSON number is kept as exact text and matches a
    // string column, so a boolean is the clear mismatch.)
    await replaceValueEditorCode(page, sheet, '[{"id":1,"name":true},{"id":2,"name":"beta"}]')
    await expect(strip(sheet)).toContainText('Row 0 "name": expected string')
    await expectSaveDisabled(sheet)
    await sheet.locator('[data-testid="view-dropdown"]').click()
    await expect(
      page.getByRole('option', { name: 'Visual', exact: true }),
    ).not.toHaveAttribute('aria-disabled', 'true')
    await page.getByRole('option', { name: 'Visual', exact: true }).click()

    // The error is preserved across the switch (not silently coerced) - the strip
    // stays and Save stays disabled; editing the grid cell clears it.
    await expect(sheet.locator('[data-testid="table-edit-body"]')).toBeVisible()
    await expect(strip(sheet)).toContainText('Row 0 "name": expected string')
    await expectSaveDisabled(sheet)
    await sheet.locator('[data-testid="table-cell-0-1"]').fill('gamma')
    await expect(strip(sheet)).toHaveCount(0)
    await expectSaveEnabled(sheet)

    // A non-list structure error LOCKS the Visual switch with the table-structure tooltip.
    await setValueEditorView(page, sheet, 'Code')
    await expect(sheet.locator('[data-testid="code-body"]')).toBeVisible()
    await replaceValueEditorCode(page, sheet, '{"id":1}')
    await expect(strip(sheet)).toContainText('Table must be a list of rows')
    await sheet.locator('[data-testid="view-dropdown"]').click()
    const lockedVisual = page.getByRole('option', { name: 'Visual', exact: true })
    await expect(lockedVisual).toHaveAttribute('aria-disabled', 'true')
    // SHELL-7a: the reason comes from the shared tooltip, not a browser popup.
    await expect(lockedVisual).not.toHaveAttribute('title', /.*/)
    await expect(page.locator('[data-testid="view-locked-alert"]')).toBeVisible()
    await page.keyboard.press('Escape')

    // Column-shape drift (an unexpected key) keeps Visual ENABLED - it routes the
    // user there to fix the columns.
    await replaceValueEditorCode(page, sheet, '[{"id":1,"name":"alpha","extra":9},{"id":2,"name":"beta"}]')
    await expect(strip(sheet)).toContainText('Unexpected column "extra"')
    await sheet.locator('[data-testid="view-dropdown"]').click()
    await expect(
      page.getByRole('option', { name: 'Visual', exact: true }),
    ).not.toHaveAttribute('aria-disabled', 'true')
    await page.keyboard.press('Escape')
  })

  test('the Compare mode pill renders as an active slate neutral, not a disabled gray', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    await importValidateAndOpen(page)
    const modal = await openInspector(page, 'results')

    // Switching the watcher's Mode to Compare paints the pill an active slate neutral -
    // it must NOT wear the muted/disabled palette (which read as disabled).
    await modal.locator('[data-testid="mode-dropdown"]').click()
    await page.getByRole('option', { name: 'Compare', exact: true }).click()
    const pill = modal.locator('[data-testid="mode-dropdown"]')
    await expect(pill).toContainText('Compare')
    await expect(pill).toHaveClass(/slate/)
    await expect(pill).not.toHaveClass(/text-muted-foreground/)
  })
})
