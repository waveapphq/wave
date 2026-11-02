/**
 * Shared helpers for the file-picker suite: the per-test seeding a spec needs
 * before it can pick anything, the config-sheet round trip, and the picker's
 * own rows and footer controls. The Test Data API itself lives in
 * helpers/testdata.ts.
 */

import { expect, type APIRequestContext, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { configSheet } from '../../helpers/workbench'
import { importFixtureTest, type ImportFixtureOptions } from '../../helpers/fixture-import'
import { BACKEND_URL } from '../../helpers/config'
import { fieldInput } from '../../helpers/value-field'
import { createTestDataFolder, uploadTestData } from '../../helpers/testdata'

/** One file the spec puts into the test's own data folder before it opens the canvas. */
export interface SeedFile {
  /** Target folder relative to the test root; '' is the root. */
  folder: string
  name: string
  body: Buffer
}

/** The localStorage-clean double navigation that opens a saved test on the canvas. */
export async function openTestOnCanvas(page: Page, testId: string): Promise<void> {
  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)
}

/** Import the fixture, seed the test's own files, and open it on the canvas. */
export async function importWithTestData(
  page: Page,
  fixture: Record<string, unknown>,
  files: readonly SeedFile[],
  options: ImportFixtureOptions = {},
): Promise<string> {
  await page.request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
  const testId = await importFixtureTest(page, fixture, options)
  const folders = [...new Set(files.map((file) => file.folder).filter((folder) => folder !== ''))]
  for (const folder of folders) await createTestDataFolder(page.request, testId, folder)
  for (const file of files)
    await uploadTestData(page.request, testId, file.folder, file.name, file.body)
  await openTestOnCanvas(page, testId)
  return testId
}

/** Remove the test the spec created; the delete cascades to its data folder. */
export async function deleteTest(request: APIRequestContext, testId: string): Promise<void> {
  const response = await request.delete(`${BACKEND_URL}/tests/${testId}`)
  expect(
    [204, 404],
    `teardown DELETE /tests/${testId} answered ${response.status()}`,
  ).toContain(response.status())
}

/** The persisted document: node id -> its stored config values. */
export async function persistedValues(
  request: APIRequestContext,
  testId: string,
): Promise<Record<string, Record<string, unknown>>> {
  const response = await request.get(`${BACKEND_URL}/tests/${testId}/workflow`)
  expect(response.ok(), `GET /tests/${testId}/workflow answered ${response.status()}`).toBeTruthy()
  const body = await response.json()
  const nodes = (body.data ?? body).nodes as Array<Record<string, any>>
  return Object.fromEntries(nodes.map((node) => [node.id as string, node.data.config.values]))
}

/** The whole persisted node, for the fields that live beside `config.values`. */
export async function persistedNodes(
  request: APIRequestContext,
  testId: string,
): Promise<Record<string, Record<string, any>>> {
  const response = await request.get(`${BACKEND_URL}/tests/${testId}/workflow`)
  expect(response.ok(), `GET /tests/${testId}/workflow answered ${response.status()}`).toBeTruthy()
  const body = await response.json()
  const nodes = (body.data ?? body).nodes as Array<Record<string, any>>
  return Object.fromEntries(nodes.map((node) => [node.id as string, node.data]))
}

// ---------------------------------------------------------------------------
// Config sheet
// ---------------------------------------------------------------------------

/** Open one Block's config sheet. */
export async function openConfig(page: Page, nodeId: string): Promise<Locator> {
  await page.locator(`[data-testid="workflow-node-${nodeId}"]`).locator('button').first().dblclick()
  const dialog = configSheet(page)
  await expect(dialog, `config sheet for ${nodeId}`).toBeVisible({ timeout: 15_000 })
  return dialog
}

/** Apply the config sheet. */
export async function saveConfig(dialog: Locator): Promise<void> {
  const save = dialog.getByRole('button', { name: /^Save$/ }).last()
  await expect(save, 'the config sheet must accept what the picker wrote').toBeEnabled()
  await save.click()
  await expect(dialog).toBeHidden({ timeout: 15_000 })
}

/** Close the config sheet without changing anything. */
export async function closeConfig(dialog: Locator): Promise<void> {
  await dialog.getByRole('button', { name: /^Cancel$/ }).last().click()
  await expect(dialog).toBeHidden({ timeout: 15_000 })
}

/** Persist the workbench draft. */
export async function saveWorkbench(page: Page): Promise<void> {
  const save = page.locator('[data-testid="toolbar-save-button"]')
  await expect(save).toBeEnabled({ timeout: 15_000 })
  await save.click()
  await expect(save).toBeDisabled({ timeout: 20_000 })
}

/** Expand a collapsed parameter group card. */
export async function expandGroup(dialog: Locator, name: string): Promise<void> {
  const header = dialog.locator(`[data-testid="group-header-${name}"]`)
  await expect(header, `group "${name}"`).toBeVisible()
  if ((await header.getAttribute('aria-expanded')) === 'false') await header.click()
  await expect(header).toHaveAttribute('aria-expanded', 'true')
}

/** Choose a File I/O operation through its select. */
export async function setOperation(page: Page, dialog: Locator, label: string): Promise<void> {
  await dialog.getByRole('combobox', { name: 'Operation' }).click()
  await page.getByRole('option', { name: label, exact: true }).click()
  await expect(dialog.getByRole('combobox', { name: 'Operation' })).toContainText(label)
}

/** Assert a literal string row's one value field holds `value`. */
export async function expectRowValue(dialog: Locator, name: string, value: string): Promise<void> {
  await expect(fieldInput(dialog, name), `the ${name} row must show what the picker wrote`).toHaveValue(value)
}

// ---------------------------------------------------------------------------
// The picker
// ---------------------------------------------------------------------------

export interface Picker {
  sheet: Locator
  body: Locator
  /** The fixed scheme segment of the Reference line: the scheme of the tab in front. */
  scheme: Locator
  /** The Reference line's path box: only the path under the scheme. */
  reference: Locator
  name: Locator
  select: Locator
  cancel: Locator
  testDataTab: Locator
  artifactsTab: Locator
  artifactsEmpty: Locator
  /** A Test Data file row, by its path relative to the test's folder. */
  file: (path: string) => Locator
  /** A Test Data folder row, by its path relative to the test's folder. */
  folder: (path: string) => Locator
  /** An Artifacts tab folder row, by its path relative to the session's artifacts folder. */
  artifactFolder: (path: string) => Locator
}

/** Locators for the one open picker. The Reference line and the two footer
 *  buttons are siblings of the picker body, so everything is scoped to the sheet. */
export function pickerParts(page: Page): Picker {
  const sheet = page.getByTestId('file-reference-picker-sheet')
  const row = (path: string, kind: string) =>
    sheet.locator(`[data-testid="testdata-row"][data-path="${path}"] > [data-testid="${kind}"]`)
  return {
    sheet,
    body: sheet.getByTestId('file-reference-picker'),
    scheme: sheet.getByTestId('picker-reference-scheme'),
    reference: sheet.getByTestId('picker-reference-input'),
    name: sheet.getByTestId('picker-name-input'),
    select: sheet.getByTestId('picker-use-button'),
    cancel: sheet.getByTestId('picker-cancel-button'),
    testDataTab: sheet.getByTestId('picker-tab-testdata'),
    artifactsTab: sheet.getByTestId('picker-tab-artifacts'),
    artifactsEmpty: sheet.getByTestId('picker-artifacts-empty'),
    file: (path: string) => row(path, 'file-row'),
    folder: (path: string) => row(path, 'folder-row'),
    artifactFolder: (path: string) =>
      sheet.locator(`[data-testid="picker-artifact-row"][data-path="${path}"] > [data-testid="folder-row"]`),
  }
}

/** The picker mode and the title each mode carries (TDATA-9). */
export const PICKER_TITLES = {
  file: 'Choose a file',
  'file-or-folder': 'Choose a file or folder',
  folder: 'Choose a folder',
  'save-as': 'Save as',
} as const

export type PickerMode = keyof typeof PICKER_TITLES

/** Press a row's Browse button and assert the picker opened in the mode the
 *  descriptor declares, under the title that mode carries. */
export async function openPicker(
  page: Page,
  dialog: Locator,
  param: string,
  mode: PickerMode,
): Promise<Picker> {
  await dialog.getByTestId(`param-browse-${param}`).click()
  const picker = pickerParts(page)
  await expect(picker.sheet, `the picker for ${param}`).toBeVisible({ timeout: 10_000 })
  await expect(picker.body).toHaveAttribute('data-picker-mode', mode)
  await expect(picker.sheet).toHaveAttribute('aria-label', PICKER_TITLES[mode])
  // The primary button never changes its wording; only its disabled state moves.
  await expect(picker.select).toHaveText('Select')
  return picker
}

/** The two schemes a Reference line can carry. */
export type ReferenceScheme = 'testdata://' | 'artifact://'

/** Assert the Reference line in its split form: the fixed scheme, then the path under it (TDATA-9). */
export async function expectReference(
  picker: Picker,
  scheme: ReferenceScheme,
  path: string,
  message?: string,
): Promise<void> {
  await expect(picker.scheme, message).toHaveText(scheme)
  await expect(picker.reference, message).toHaveValue(path)
}

/** Confirm the picker and wait for it to go. */
export async function confirmPicker(picker: Picker): Promise<void> {
  await expect(picker.select, 'Select must be live once the Reference holds a value').toBeEnabled()
  await picker.select.click()
  await expect(picker.sheet).toBeHidden({ timeout: 10_000 })
}
