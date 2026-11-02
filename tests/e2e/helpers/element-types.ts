/**
 * Declared element types of map and list values (REQ-3.1.3.19): author typed
 * rows in the shared map / list editors, read them back, and read a run's probe
 * lines. One canonical row set is shared by every surface so each spec proves
 * the same contract: numbers keep their exact text and read back as numbers,
 * numeric-looking text stays text, nested leaves keep their JSON types.
 */

import fs from 'fs'
import path from 'path'
import { expect, type APIRequestContext, type Locator, type Page } from './playwright-fixtures'
import { BACKEND_URL, ensureEnvironment } from './config'
import { validateTest } from './fn-seed'
import { getLogTexts } from './log-reader'

export type ElementType = 'string' | 'integer' | 'float' | 'boolean' | 'array' | 'map'

export interface MapRow {
  key: string
  text: string
  type: ElementType
}

export interface ListRow {
  text: string
  type: ElementType
}

/** A 19-digit integer, the editor's cap, well past a double's exact range. */
export const BIG_INT = '1234567890123456789'
export const BIG_INT_PLUS_ONE = '1234567890123456790'
/** Twenty-eight significant digits, the exact float precision. */
export const PRECISE_FLOAT = '0.1000000000000000000000000001'

/** Every element type once, plus the numeric-looking text that must stay text. */
export const MAP_ROWS: readonly MapRow[] = [
  { key: 'n', text: '16', type: 'integer' },
  { key: 'big', text: BIG_INT, type: 'integer' },
  { key: 'f', text: '1.0', type: 'float' },
  { key: 'hp', text: PRECISE_FLOAT, type: 'float' },
  { key: 'b', text: 'false', type: 'boolean' },
  { key: 'zip', text: '02134', type: 'string' },
  { key: 'ver', text: '1.10', type: 'string' },
  { key: 'txt', text: '[1, 2]', type: 'string' },
  { key: 'nested', text: '{"k": 5, "s": "07"}', type: 'map' },
  { key: 'lst', text: '[1.5, 2]', type: 'array' },
]

export const LIST_ROWS: readonly ListRow[] = [
  { text: '16', type: 'integer' },
  { text: '1.0', type: 'float' },
  { text: '02134', type: 'string' },
  { text: 'true', type: 'boolean' },
  { text: '[3, "4"]', type: 'array' },
]

/** The stored form of one row: a boolean is a real boolean, everything else its exact text. */
function storedText(row: { text: string; type: ElementType }): unknown {
  return row.type === 'boolean' ? row.text === 'true' : row.text
}

/** The value a saved map of `rows` is stored as. */
export function storedMap(rows: readonly MapRow[] = MAP_ROWS): Record<string, unknown> {
  return Object.fromEntries(rows.map((row) => [row.key, storedText(row)]))
}

/** The element types a saved map of `rows` carries. */
export function mapElementTypes(rows: readonly MapRow[] = MAP_ROWS): Record<string, ElementType> {
  return Object.fromEntries(rows.map((row) => [row.key, row.type]))
}

export function storedList(rows: readonly ListRow[] = LIST_ROWS): unknown[] {
  return rows.map(storedText)
}

export function listElementTypes(rows: readonly ListRow[] = LIST_ROWS): ElementType[] {
  return rows.map((row) => row.type)
}

/** Probe over the map `name`: every entry used the way only its declared type allows. */
export function mapProbe(tag: string, name: string): string {
  const m = name
  return (
    `f"${tag} n={${m}['n'] + 1} big={${m}['big'] + 1} f={${m}['f'] * 2} hp={${m}['hp'] + 0} ` +
    `b={not ${m}['b']} zip={${m}['zip'] + '-x'} ver={${m}['ver'] == '1.10'} ` +
    `txt={type(${m}['txt']) == str} nk={${m}['nested']['k'] + 1} ns={${m}['nested']['s'] + 'x'} ` +
    `l0={${m}['lst'][0] + 1}"`
  )
}

export function mapProbeLine(tag: string): string {
  return (
    `${tag} n=17 big=${BIG_INT_PLUS_ONE} f=2.0 hp=${PRECISE_FLOAT} b=True zip=02134-x ver=True ` +
    'txt=True nk=6 ns=07x l0=2.5'
  )
}

/** Probe over the list `name` of LIST_ROWS. */
export function listProbe(tag: string, name: string): string {
  const a = name
  return (
    `f"${tag} a0={${a}[0] + 1} a1={${a}[1] * 2} a2={${a}[2] + '-x'} a3={not ${a}[3]} ` +
    `a4={${a}[4][0] + 1}{${a}[4][1]}"`
  )
}

export function listProbeLine(tag: string): string {
  return `${tag} a0=17 a1=2.0 a2=02134-x a3=False a4=44`
}

// ---------------------------------------------------------------------------
// Editor rows
// ---------------------------------------------------------------------------

/** Pick one of the six element types on a row's type pill. */
export async function pickElementType(page: Page, pill: Locator, type: ElementType): Promise<void> {
  await pill.click()
  await page.getByRole('option', { name: type, exact: true }).click()
  await expect(pill).toHaveText(type)
}

/** Give a new entry its declared type, then its text (a type change drops a held value). Picking the type a new
 *  row already reads changes nothing, so a text that reads as another type is retyped once that type is picked. */
async function setEntry(page: Page, pill: Locator, input: Locator, row: { text: string; type: ElementType }): Promise<void> {
  await pickElementType(page, pill, row.type)
  await input.fill(row.text)
  if (((await pill.textContent()) ?? '').trim() === row.type) return
  await pill.click()
  await page.getByRole('option', { name: row.type, exact: true }).click()
  // The row holds the text, so the type change asks first.
  await page.getByRole('button', { name: 'Change type', exact: true }).click()
  await expect(pill).toHaveText(row.type)
  await input.fill(row.text)
  await expect(pill).toHaveText(row.type)
}

/** Append `rows` to the map editor inside `scope`: each one's key, its type, then its text. */
export async function fillMapRows(
  page: Page,
  scope: Locator,
  rows: readonly MapRow[],
  startIndex = 0,
): Promise<void> {
  for (const [offset, row] of rows.entries()) {
    const index = startIndex + offset
    await scope.locator('[data-testid="map-add-entry"]').click()
    await scope.locator(`[data-testid="map-edit-key-${index}"]`).fill(row.key)
    await setEntry(
      page,
      scope.locator(`[data-testid="map-type-${index}"]`),
      scope.locator(`[data-testid="map-edit-value-${index}"]`),
      row,
    )
  }
}

/** Append `rows` to the list editor inside `scope`: each item's type, then its text. */
export async function fillListRows(
  page: Page,
  scope: Locator,
  rows: readonly ListRow[],
  startIndex = 0,
): Promise<void> {
  for (const [offset, row] of rows.entries()) {
    const index = startIndex + offset
    await scope.locator('[data-testid="array-add-item"]').click()
    await setEntry(
      page,
      scope.locator(`[data-testid="array-type-${index}"]`),
      scope.locator(`[data-testid="array-edit-input-${index}"]`),
      row,
    )
  }
}

/** The map editor inside `scope` shows exactly `rows`, each with its declared type. */
export async function expectMapRows(scope: Locator, rows: readonly MapRow[]): Promise<void> {
  await expect(scope.locator('[data-testid^="map-edit-key-"]')).toHaveCount(rows.length)
  for (const [index, row] of rows.entries()) {
    await expect(scope.locator(`[data-testid="map-edit-key-${index}"]`)).toHaveValue(row.key)
    await expect(scope.locator(`[data-testid="map-edit-value-${index}"]`)).toHaveValue(row.text)
    await expect(
      scope.locator(`[data-testid="map-type-${index}"]`),
      `entry "${row.key}" reads back as ${row.type}`,
    ).toHaveText(row.type)
  }
}

export async function expectListRows(scope: Locator, rows: readonly ListRow[]): Promise<void> {
  // Each row's null button shares the input's id stem.
  await expect(scope.locator('[data-testid^="array-edit-input-"]:not([data-testid$="-null"])')).toHaveCount(rows.length)
  for (const [index, row] of rows.entries()) {
    await expect(scope.locator(`[data-testid="array-edit-input-${index}"]`)).toHaveValue(row.text)
    await expect(
      scope.locator(`[data-testid="array-type-${index}"]`),
      `item ${index} reads back as ${row.type}`,
    ).toHaveText(row.type)
  }
}

/** The shared "Edit value" sheet. */
export const valueSheet = (page: Page): Locator => page.locator('[data-testid="value-editor-sheet"]')

/** Save the open value sheet and close it. */
export async function saveAndCloseSheet(page: Page): Promise<void> {
  const sheet = valueSheet(page)
  await sheet.locator('[data-testid="value-editor-save-button"]').click()
  await sheet.locator('[data-testid="value-editor-cancel-button"]').click()
  await expect(sheet).toBeHidden()
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Read a JSON fixture beside a spec. */
export function readFixture(dir: string, file: string): Record<string, any> {
  return JSON.parse(fs.readFileSync(path.resolve(dir, file), 'utf-8')) as Record<string, any>
}

/** A copy of `value` with every placeholder in every string replaced by its text. */
export function substitute<T>(value: T, placeholders: Record<string, string>): T {
  const walk = (node: unknown): unknown => {
    if (typeof node === 'string') {
      return Object.entries(placeholders).reduce((text, [key, to]) => text.replaceAll(key, to), node)
    }
    if (Array.isArray(node)) return node.map(walk)
    if (node !== null && typeof node === 'object') {
      return Object.fromEntries(Object.entries(node).map(([key, entry]) => [key, walk(entry)]))
    }
    return node
  }
  return walk(value) as T
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/** A token unique to this run, for entity names. */
export function runToken(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/** Create a Test through POST /tests under a per-run name and prove it validates clean. */
export async function importValidated(
  request: APIRequestContext,
  fixture: Record<string, unknown>,
): Promise<string> {
  await ensureEnvironment(request)
  const name = `${String(fixture.name ?? 'Element types')} ${runToken()}`
  const resp = await request.post(`${BACKEND_URL}/tests`, { data: { ...fixture, name } })
  const body = await resp.json().catch(() => null)
  expect(resp.ok(), `POST /tests failed: ${resp.status()} - ${JSON.stringify(body)}`).toBeTruthy()
  const testId = (body.data?.id ?? body.id) as string
  const validation = await validateTest(request, testId)
  expect(validation.errors, `fixture validates clean: ${JSON.stringify(validation.errors)}`).toEqual([])
  return testId
}

/** The stored Test, unmasked of nothing (these specs hold no secrets). */
export async function getTest(request: APIRequestContext, testId: string): Promise<Record<string, any>> {
  const resp = await request.get(`${BACKEND_URL}/tests/${testId}`)
  expect(resp.ok(), `GET /tests/${testId}: ${resp.status()}`).toBeTruthy()
  return (await resp.json()).data
}

/** One stored workflow node by id. */
export async function getNode(
  request: APIRequestContext,
  testId: string,
  nodeId: string,
): Promise<Record<string, any>> {
  const resp = await request.get(`${BACKEND_URL}/tests/${testId}/workflow`)
  expect(resp.ok(), `GET /tests/${testId}/workflow: ${resp.status()}`).toBeTruthy()
  const nodes = (await resp.json()).data.nodes as Array<Record<string, any>>
  const node = nodes.find((entry) => entry.id === nodeId)
  expect(node, `node ${nodeId} is stored`).toBeTruthy()
  return node as Record<string, any>
}

export async function deleteTest(request: APIRequestContext, testId: string): Promise<void> {
  await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
}

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

/** Wait for the run to leave running, then return the console lines and the verdict. */
export async function settleRun(page: Page, timeout = 120_000): Promise<{ verdict: string | null; logs: string[] }> {
  const status = page.locator('[data-testid="workflow-status"]')
  await expect(status).not.toHaveAttribute('data-status', 'idle', { timeout: 15_000 })
  await expect(status).not.toHaveAttribute('data-status', 'running', { timeout })
  const verdict = await status.getAttribute('data-status')
  const logs = await getLogTexts(page)
  return { verdict, logs }
}

/** Every expected probe line is in the console, and the run passed. */
export function expectProbeLines(
  run: { verdict: string | null; logs: string[] },
  lines: readonly string[],
): void {
  const all = run.logs.join('\n')
  for (const line of lines) {
    expect(run.logs.includes(line), `expected the console line\n  ${line}\nconsole:\n${all}`).toBeTruthy()
  }
  expect(run.verdict, `run verdict; console:\n${all}`).toBe('passed')
}
