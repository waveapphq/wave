/**
 * V-VMGR-07: Variable watcher chrome and the variable's one Edit window
 *
 * Design Decisions: VMGR-106 (one Edit
 *   window per variable; the watcher only shows values), VMGR-108 (Initial / Current pill),
 *   VMGR-110 (one value field per type; Visual / Code only in the "Edit value" sheet)
 * REQ: REQ-3.1.3.11 (Variable Manager UI), REQ-3.1.3.13 (expression editing)
 *
 * Visual/chrome assertions; the end-to-end edit/save behavior lives in the functional
 * variable-window specs.
 *
 * Pass Criteria:
 *  1. The watcher has no Edit in Initial, Current or Compare. The row pencil opens the
 *     window titled `Edit variable` holding the saved name and value, with Cancel / Save and
 *     a value pill offering exactly Initial and Current.
 *  2. Per-type value fields in the window: a true | false control with aria-pressed; an
 *     integer box that refuses invalid characters; an expression's source field under Kind
 *     Expression with no Open editor and no View control. A list, map or table opens the
 *     "Edit value" sheet whose Visual view has the inline editors (array / map add, reorder,
 *     delete; table headers, type selects, column menu, add row / column).
 *  3. In the sheet's Code view, Format shows; invalid JSON shows the strip message, disables
 *     the sheet's Save and the Visual option.
 *  4. The window's Name counter appears from 52/64 and turns destructive at 64/64; an empty
 *     name shows `Name is required` and an invalid one the variable-name rule, Save disabled.
 *  5. Shared sheet behaviors: active-watcher outline and clearer border; the pencil of a
 *     variable whose Edit window is open brings that window to the front with its draft
 *     kept, and no second window opens.
 *  6. Geometry: every watcher carries the resize corner; a compact watcher stacks in Compare
 *     while complex types keep side-by-side panes.
 *  7. Read rules: scalar strings render raw via the line-numbered editor; map keys are
 *     quoted + tinted; the table carries a non-resizable Row-index column; a watcher on the
 *     Code view is read-only with no Edit.
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT } from '../../helpers/config'
import { valueEditorSheet } from '../../helpers/param-config'
import {
  EDIT_WINDOW,
  cancelWindow,
  closeValueEditor,
  editPencil,
  openEditWindow,
  openValueEditor,
  setValueEditorView,
  setWindowValue,
  valueEditor,
  valueSwitch,
  variableRow,
  windowCancelButton,
  windowSaveButton,
} from '../../helpers/variable-create'
import fs from 'fs'
import path from 'path'

const FIXTURE_PATH = path.resolve(
  __dirname,
  '../../fixtures/canvas/v-vmgr-inspect/fixture.json',
)

function loadFixture(nameSuffix: string): Record<string, unknown> {
  const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf-8'))
  fixture.name = `V-VMGR-07 ${nameSuffix} ${Date.now()}`
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

const content = (page: Page): Locator =>
  page.locator('[data-testid="variable-manager-content"]')
const rowFor = (page: Page, name: string): Locator =>
  content(page).locator(`[aria-label="Variable ${name}"]`)
const modalFor = (page: Page, name: string): Locator =>
  page.locator(`section[aria-label="Inspect variable ${name}"]`)

// Eye (expand) -> read-mode watcher in the default Current mode.
async function openRead(page: Page, name: string): Promise<Locator> {
  await rowFor(page, name).locator('[data-testid^="expand-button-"]').click()
  const modal = modalFor(page, name)
  await expect(modal).toBeVisible()
  return modal
}

const zIndexOf = async (sheet: Locator): Promise<number> =>
  Number(await sheet.evaluate((el) => getComputedStyle(el).zIndex))

async function switchMode(
  modal: Locator,
  page: Page,
  mode: 'Initial' | 'Current' | 'Compare',
): Promise<void> {
  await modal.locator('[data-testid="mode-dropdown"]').click()
  await page.getByRole('option', { name: mode, exact: true }).click()
  await expect(modal.locator('[data-testid="mode-dropdown"]')).toContainText(mode)
}

async function switchView(
  modal: Locator,
  page: Page,
  view: 'Visual' | 'Code',
): Promise<void> {
  await modal.locator('[data-testid="view-dropdown"]').click()
  await page.getByRole('option', { name: view, exact: true }).click()
  await expect(modal.locator('[data-testid="view-dropdown"]')).toContainText(view)
}

test.describe('V-VMGR-07: watcher without Edit & the Edit window chrome', () => {
  test('the watcher has no Edit in any mode; the pencil opens the Edit window with Cancel / Save and the Initial / Current pill', async ({
    page,
  }) => {
    await importAndOpen(page, 'affordance')
    // VMGR-106: the watcher only shows values, in every mode.
    const modal = await openRead(page, 'attempt')
    const edit = modal.getByRole('button', { name: 'Edit', exact: true })
    await expect(edit).toHaveCount(0)
    await switchMode(modal, page, 'Initial')
    await expect(edit).toHaveCount(0)
    await switchMode(modal, page, 'Compare')
    await expect(edit).toHaveCount(0)

    // The pencil opens the variable's Edit window on its saved name and value.
    const win = await openEditWindow(page, 'ratio')
    await expect(win).toHaveAttribute('aria-label', 'Edit variable')
    await expect(win.getByTestId('create-variable-name')).toHaveValue('ratio')
    await expect(win.getByTestId('scalar-edit-input')).toHaveValue('0.5')
    await expect(windowCancelButton(win)).toHaveText('Cancel')
    await expect(windowSaveButton(win)).toHaveText('Save')
    // VMGR-108: the value pill offers exactly Initial and Current.
    const pill = valueSwitch(win)
    await expect(pill).toHaveText('Initial')
    await pill.click()
    await expect(page.getByRole('option')).toHaveText(['Initial', 'Current'])
    await page.getByRole('option', { name: 'Initial', exact: true }).click()
    await expect(pill).toHaveText('Initial')
    await cancelWindow(page, win)
  })

  test('the Name counter appears near the cap; an empty or invalid name shows its message and disables Save', async ({
    page,
  }) => {
    await importAndOpen(page, 'name')
    const win = await openEditWindow(page, 'user_name')
    const rename = win.getByTestId('create-variable-name')
    const counter = win.getByTestId('create-variable-name-counter')

    // Below the threshold: no counter.
    await expect(counter).toHaveCount(0)

    // >= 52/64 shows the counter; at the cap it turns destructive.
    await rename.fill('a'.repeat(52))
    await expect(counter).toHaveText('52/64')
    await rename.fill('a'.repeat(64))
    await expect(counter).toHaveText('64/64')
    expect((await counter.getAttribute('class')) ?? '').toMatch(/text-destructive/)

    // Clearing the name shows "Name is required" and disables Save.
    await rename.fill('')
    const error = win.getByTestId('create-name-error')
    await expect(error).toHaveText('Name is required')
    const save = windowSaveButton(win)
    await expect(save).toBeDisabled()

    // An invalid pattern shows the variable-name rule.
    await rename.fill('1bad')
    await expect(error).toHaveText(
      'Variable name must start with letter/underscore, contain only letters, numbers, underscores',
    )
    await expect(save).toBeDisabled()
    await cancelWindow(page, win, 'Close')
  })
})

test.describe('V-VMGR-07: per-type value fields', () => {
  test('a boolean is a true | false control with aria-pressed', async ({ page }) => {
    await importAndOpen(page, 'bool')
    const win = await openEditWindow(page, 'debug_log')
    const onTrue = win.locator('[data-testid="scalar-edit-bool-true"]')
    const onFalse = win.locator('[data-testid="scalar-edit-bool-false"]')
    // debug_log starts true.
    await expect(onTrue).toHaveAttribute('aria-pressed', 'true')
    await expect(onFalse).toHaveAttribute('aria-pressed', 'false')
    await onFalse.click()
    await expect(onFalse).toHaveAttribute('aria-pressed', 'true')
    await expect(onTrue).toHaveAttribute('aria-pressed', 'false')
    await cancelWindow(page, win, 'Close')
  })

  test('an integer box rejects invalid characters at input', async ({ page }) => {
    await importAndOpen(page, 'int')
    const win = await openEditWindow(page, 'attempt')
    const input = win.locator('[data-testid="scalar-edit-input"]')
    await expect(input).toHaveValue('1')
    // A decimal point / a letter never enters an integer field (only the
    // invalid char is rejected; a following valid digit would still be typed).
    await input.fill('12')
    await input.pressSequentially('.')
    await expect(input).toHaveValue('12')
    await input.pressSequentially('x')
    await expect(input).toHaveValue('12')
    await cancelWindow(page, win, 'Close')
  })

  test('a list and a map open the "Edit value" sheet with inline inputs and add / reorder / delete', async ({
    page,
  }) => {
    await importAndOpen(page, 'complex')
    const arrayWin = await openEditWindow(page, 'items')
    const arraySheet = await openValueEditor(page, arrayWin)
    await expect(arraySheet.locator('[data-testid="array-edit-body"]')).toBeVisible()
    await expect(arraySheet.locator('[data-testid="array-edit-input-0"]')).toHaveValue('alpha')
    await expect(arraySheet.locator('[data-testid="array-add-item"]')).toBeVisible()
    await expect(arraySheet.locator('[data-testid="array-remove-0"]')).toBeVisible()
    // The first row cannot move up (boundary disabled).
    await expect(arraySheet.locator('[data-testid="array-move-up-0"]')).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    await closeValueEditor(page, arraySheet)
    await cancelWindow(page, arrayWin)

    const mapWin = await openEditWindow(page, 'headers')
    const mapSheet = await openValueEditor(page, mapWin)
    await expect(mapSheet.locator('[data-testid="map-edit-body"]')).toBeVisible()
    await expect(mapSheet.locator('[data-testid="map-edit-key-0"]')).toHaveValue('Content-Type')
    await expect(mapSheet.locator('[data-testid="map-edit-value-0"]')).toHaveValue('application/json')
    await expect(mapSheet.locator('[data-testid="map-add-entry"]')).toBeVisible()
    await closeValueEditor(page, mapSheet)
    await cancelWindow(page, mapWin)
  })

  test('a table opens the "Edit value" sheet with header inputs, type selects, the column menu and add controls', async ({
    page,
  }) => {
    await importAndOpen(page, 'table')
    const win = await openEditWindow(page, 'results')
    const sheet = await openValueEditor(page, win)
    await expect(sheet.locator('[data-testid="table-edit-body"]')).toBeVisible()
    await expect(sheet.locator('[data-testid="table-header-0"]')).toHaveValue('id')
    await expect(sheet.locator('[data-testid="table-type-0"]')).toBeVisible()
    await expect(sheet.locator('[data-testid="table-add-row"]')).toBeVisible()
    await expect(sheet.locator('[data-testid="table-add-column"]')).toBeVisible()
    // The per-column kebab opens move / delete menu items.
    await sheet.locator('[data-testid="table-col-menu-0"]').click()
    await expect(page.getByRole('menuitem', { name: 'Delete column' })).toBeVisible()
  })

  test('the sheet Code view shows Format; invalid JSON locks Visual and Save', async ({ page }) => {
    await importAndOpen(page, 'code')
    const win = await openEditWindow(page, 'items')
    // VMGR-110: the window has no View control; Visual / Code lives in the sheet.
    await expect(win.locator('[data-testid="view-dropdown"]')).toHaveCount(0)
    const sheet = await openValueEditor(page, win)
    await setValueEditorView(page, sheet, 'Code')
    await expect(sheet.locator('[data-testid="code-body"]')).toBeVisible()
    await expect(sheet.locator('[data-testid="value-editor-format-button"]')).toBeVisible()

    // Break the JSON: the strip shows, Save disables, and the Visual switch is
    // a disabled menu item.
    const cm = sheet.locator('[data-testid="code-body"] .cm-content').first()
    await cm.click()
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.press('Delete')
    await cm.pressSequentially('[ broken')
    // The strip shows the parser's own JSON error.
    await expect(sheet.locator('[data-testid="value-editor-validation"]')).toContainText(/valid JSON/)
    await expect(sheet.locator('[data-testid="value-editor-save-button"]')).toBeDisabled()
    await sheet.locator('[data-testid="view-dropdown"]').click()
    await expect(page.getByRole('option', { name: 'Visual', exact: true })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    await page.getByRole('option', { name: 'Code', exact: true }).click()
    await closeValueEditor(page, sheet, 'Close')
    await expect(valueEditorSheet(page)).toHaveCount(0)
    await cancelWindow(page, win)
  })

  test('an expression edits its source under Kind Expression, with no Open editor and no View control', async ({
    page,
  }) => {
    await importAndOpen(page, 'expr')
    const win = await openEditWindow(page, 'api_url')
    await expect(win.getByTestId('create-kind-select')).toHaveText('Expression')
    await expect(valueEditor(page, win)).toHaveText(
      "'https://api.wave.test/v1/services/discovery/' + user_name",
    )
    await expect(win.getByTestId('open-value-editor-button')).toHaveCount(0)
    await expect(win.locator('[data-testid="view-dropdown"]')).toHaveCount(0)
    await cancelWindow(page, win)
  })
})

test.describe('V-VMGR-07: shared sheet behaviors', () => {
  test('the front-most watcher carries the active outline; every sheet has the clearer border', async ({
    page,
  }) => {
    await importAndOpen(page, 'sheets')
    const first = await openRead(page, 'attempt')
    const second = await openRead(page, 'ratio')
    // Last opened is front-most / active.
    await expect(second).toHaveAttribute('data-active', 'true')
    await expect(first).not.toHaveAttribute('data-active', 'true')
    // Clicking the other sheet migrates the active outline.
    await first.click({ position: { x: 6, y: 6 } })
    await expect(first).toHaveAttribute('data-active', 'true')
    await expect(second).not.toHaveAttribute('data-active', 'true')
    // Clearer border on every sheet.
    expect((await first.getAttribute('class')) ?? '').toMatch(/border-muted-foreground\/40/)
  })

  test('the pencil of a variable whose Edit window is open brings that window to the front; no second window (VMGR-106)', async ({
    page,
  }) => {
    await importAndOpen(page, 'reentry')
    const attemptWin = await openEditWindow(page, 'attempt')
    await setWindowValue(page, attemptWin, 7)
    const ratioWin = await openEditWindow(page, 'ratio')
    const editWindows = page.locator(EDIT_WINDOW)
    await expect(editWindows).toHaveCount(2)
    await expect(ratioWin).toHaveAttribute('data-active', 'true')
    await expect(attemptWin).not.toHaveAttribute('data-active', 'true')

    // The pencil of `attempt` again: its open window comes to the front, draft kept.
    await variableRow(page, 'attempt').hover()
    await editPencil(page, 'attempt').click()
    await expect(attemptWin).toHaveAttribute('data-active', 'true')
    await expect(ratioWin).not.toHaveAttribute('data-active', 'true')
    await expect.poll(async () => (await zIndexOf(attemptWin)) > (await zIndexOf(ratioWin))).toBe(true)
    await expect(attemptWin.locator('[data-testid="scalar-edit-input"]')).toHaveValue('7')
    // No second window for `attempt`.
    await expect(editWindows).toHaveCount(2)

    await cancelWindow(page, attemptWin, 'Close')
    await cancelWindow(page, ratioWin)
    await expect(editWindows).toHaveCount(0)
  })

  test('compact scalars are width-resizable and stack in Compare; complex types keep side-by-side panes', async ({
    page,
  }) => {
    await importAndOpen(page, 'geometry')
    // A compact integer watcher is width-resizable, so it carries the resize corner.
    const compact = await openRead(page, 'attempt')
    await expect(compact.locator('[data-testid="dialog-resize-corner"]')).toHaveCount(1)
    // Resizable string + array carry the corner too.
    const str = await openRead(page, 'user_name')
    await expect(str.locator('[data-testid="dialog-resize-corner"]')).toHaveCount(1)

    // A compact scalar stacks in Compare (no two-column grid); a complex
    // type keeps the side-by-side panes. Raise the compact watcher first so its
    // footer is not covered by the later-opened string watcher.
    await compact.click({ position: { x: 6, y: 6 } })
    await switchMode(compact, page, 'Compare')
    expect(
      (await compact.locator('[data-testid="compare-body"]').getAttribute('class')) ?? '',
    ).not.toMatch(/grid-cols-2/)
    const arr = await openRead(page, 'items')
    await switchMode(arr, page, 'Compare')
    expect(
      (await arr.locator('[data-testid="compare-body"]').getAttribute('class')) ?? '',
    ).toMatch(/grid-cols-2/)
  })
})

test.describe('V-VMGR-07: read-mode regressions', () => {
  test('a scalar string renders raw through the line-numbered editor (no quotes)', async ({
    page,
  }) => {
    await importAndOpen(page, 'rawstring')
    const modal = await openRead(page, 'user_name')
    const body = modal.locator('[data-testid="scalar-body"]')
    // The value renders through a real CodeMirror, raw (no wrapping quotes).
    await expect(body.locator('.cm-content')).toContainText('bob')
    await expect(body.locator('.cm-content')).not.toContainText('"bob"')
    // The string watcher stays resizable (editor fills + scrolls).
    await expect(modal.locator('[data-testid="dialog-resize-corner"]')).toHaveCount(1)
  })

  test('map keys are quoted + tinted and the grid has resizable columns; the table has a Row-index column', async ({
    page,
  }) => {
    await importAndOpen(page, 'grid')
    const mapModal = await openRead(page, 'headers')
    const mapKey = mapModal.locator('[data-testid="map-key"]').first()
    await expect(mapKey).toContainText('"')
    expect((await mapKey.getAttribute('class')) ?? '').toMatch(/sky/)
    // Resizable column handles exist on the map grid.
    await expect(mapModal.locator('[data-testid="map-body-col-resize-0"]')).toHaveCount(1)

    const tableModal = await openRead(page, 'results')
    // The non-resizable Row-index header is labeled and carries no handle.
    const indexHeader = tableModal.locator('th[aria-label="Row index"]')
    await expect(indexHeader).toHaveCount(1)
    await expect(
      tableModal.locator('[data-testid="table-body-col-resize-0"]'),
    ).toHaveCount(0)
  })

  test('a watcher on the Code view is read-only with no Edit (VMGR-106)', async ({ page }) => {
    await importAndOpen(page, 'code-read')
    const modal = await openRead(page, 'items')
    await switchMode(modal, page, 'Initial')
    await switchView(modal, page, 'Code')
    const code = modal.locator('[data-testid="code-body"] .cm-content').first()
    await expect(code).toBeVisible()
    const shown = (await code.textContent()) ?? ''
    expect(shown).toContain('alpha')
    // Typing into the read view changes nothing.
    await code.click()
    await page.keyboard.press('ControlOrMeta+End')
    await page.keyboard.type('zz')
    await expect(code).toHaveText(shown)
    await expect(modal.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0)
    await expect(modal.locator('[data-testid="array-edit-body"]')).toHaveCount(0)
  })
})
