/**
 * Shared plumbing for the Test Data sheet suite: the suite's own test entity
 * and the row locators the sheet renders. The Test Data API itself lives in
 * helpers/testdata.ts.
 */

import fs from 'fs'
import path from 'path'
import {
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
} from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { clearPointerLock } from '../../helpers/workbench'
import { importFixtureTest } from '../../helpers/fixture-import'

export interface OwnTest {
  id: string
  /** The unique name POST /tests settled on; the running refusal quotes it. */
  name: string
}

export function loadFixture(file = 'fixture.json'): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, file), 'utf-8'))
}

/** A short suffix that makes an uploaded body unique to this run. */
export function marker(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

// ---------------------------------------------------------------------------
// The suite's own test entity (shared-stack isolation)
// ---------------------------------------------------------------------------

/** Import the fixture under a unique name and read the name back. */
export async function createOwnTest(
  page: Page,
  fixture: Record<string, unknown>,
): Promise<OwnTest> {
  const id = await importFixtureTest(page, fixture)
  const response = await page.request.get(`${BACKEND_URL}/tests/${id}`)
  const body = (await response.json()) as { data?: { name?: string }; name?: string }
  expect(response.ok(), `GET /tests/${id} failed: ${response.status()}`).toBeTruthy()
  const name = body.data?.name ?? body.name
  expect(name, `GET /tests/${id} carried no name`).toBeTruthy()
  return { id, name: name as string }
}

/** Teardown: the delete cascades and takes the test's data folder with it (TDATA-1). */
export async function deleteOwnTest(
  request: APIRequestContext,
  testId: string | null,
): Promise<void> {
  if (!testId) return
  const response = await request.delete(`${BACKEND_URL}/tests/${testId}`)
  expect(
    [200, 204, 404].includes(response.status()),
    `DELETE /tests/${testId} answered ${response.status()}`,
  ).toBeTruthy()
}

/** Open the test on the live canvas; the double navigation clears the draft session. */
export async function openWorkbench(page: Page, testId: string): Promise<void> {
  await page.request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => {})
  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)
}

// ---------------------------------------------------------------------------
// Sheet locators
// ---------------------------------------------------------------------------

export const SHEET = '[data-testid="testdata-sheet"]'

/** Open the sheet from the breadcrumb chip (TDATA-3) and return it. */
export async function openSheet(page: Page): Promise<Locator> {
  const chip = page.getByTestId('breadcrumb-testdata-chip')
  await expect(chip).toBeVisible()
  await chip.click()
  const sheet = page.locator(SHEET)
  await expect(sheet).toBeVisible()
  return sheet
}

/** The wrapper row; it carries data-path, data-entry-type and data-selected. */
export function rowOf(page: Page, relativePath: string): Locator {
  return page.locator(`[data-testid="testdata-row"][data-path="${relativePath}"]`)
}

export function folderRowOf(page: Page, relativePath: string): Locator {
  return page.locator(
    `[data-testid="testdata-row"][data-path="${relativePath}"] > [data-testid="folder-row"]`,
  )
}

export function fileRowOf(page: Page, relativePath: string): Locator {
  return page.locator(
    `[data-testid="testdata-row"][data-path="${relativePath}"] > [data-testid="file-row"]`,
  )
}

/**
 * Click the row's name band. A fixed offset keeps the click off the chevron on
 * the left and off Copy path / Download / kebab on the right.
 */
export async function clickRowBody(row: Locator): Promise<void> {
  await row.click({ position: { x: 120, y: 12 } })
}

/** Open a row's kebab and pick one of its two items. */
export async function clickRowMenuItem(
  page: Page,
  row: Locator,
  name: string,
  item: 'Rename' | 'Delete',
): Promise<void> {
  await row.getByRole('button', { name: `More actions for ${name}`, exact: true }).click()
  await page.getByRole('menuitem', { name: item, exact: true }).click()
}

/** Fill the shared Name field and save. */
export async function saveNameDialog(page: Page, name: string): Promise<void> {
  const dialog = page.getByTestId('testdata-name-dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByTestId('testdata-name-input').fill(name)
  await dialog.getByTestId('edit-dialog-save').click()
  await expect(dialog).toBeHidden()
  // A Radix dialog can leave the pointer-events lock on <body> after a fast close.
  await clearPointerLock(page)
}

/** The title of the open Name dialog, which names where the folder lands. */
export function nameDialogTitle(page: Page): Locator {
  return page.getByTestId('testdata-name-dialog').getByRole('heading')
}
