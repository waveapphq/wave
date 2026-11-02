/**
 * Shared base of the SFTP functional suite: per-spec folder names, fixture load, import with
 * the Test's own Test Data, the run and its harvest, output and console readers, the headless
 * cleanup run, and the scan of the WAVE storage for downloaded and partial files.
 */

import fs from 'fs'
import path from 'path'
import { randomUUID } from 'node:crypto'
import {
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
} from '../../helpers/playwright-fixtures'
import { BACKEND_URL, STORAGE_BASE_PATH } from '../../helpers/config'
import {
  getActiveSessionId,
  getSessionVariables,
  importFixtureTest,
  injectServiceHost,
  sessionValue,
  type SessionVariables,
  type WaveTable,
} from '../../helpers/fixture-import'
import { validateTest } from '../../helpers/fn-seed'
import {
  clearSettledWorkbenchSession,
  getNodeStatuses,
  runTrackedTest,
  startRun,
} from '../../helpers/k8s-run'
import {
  escapeRegExp,
  formatEntries,
  getLogCopyTexts,
  waitForLogText,
  type LogEntry,
} from '../../helpers/log-reader'
import { saveAndCloseSheet, valueSheet } from '../../helpers/element-types'
import { paramRow } from '../../helpers/config-sheet'
import { expandButton, fieldInput } from '../../helpers/value-field'
import { createTestDataFolder, uploadTestData } from '../../helpers/testdata'
import { openTestOnCanvas, type SeedFile } from '../file-picker/picker'
import { readArtifact } from '../k8s-exec/cases-exec'
import { blockSource, consoleEntriesFromCopy } from '../shell-blocks/shell-helpers'

// ---------------------------------------------------------------------------
// Per-spec names
// ---------------------------------------------------------------------------

/** One spec's run: its uuid and its server folder `e2e-<spec>-<uuid>`. */
export interface SftpRun {
  uuid: string
  folder: string
}

/** A fresh run for a spec named like `sftp-flow` or `profile-ssh-passphrase`. */
export function newSftpRun(spec: string): SftpRun {
  const uuid = randomUUID()
  return { uuid, folder: `e2e-${spec}-${uuid}` }
}

/** Test Data `orders.csv`: a header and two `pending` rows, each carrying `marker`. */
export function ordersCsv(marker: string): string {
  return `id,item,status,note\n1,widget,pending,${marker}\n2,gadget,pending,${marker}\n`
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

export interface SftpFixture {
  name: string
  workflow: {
    nodes: Array<Record<string, any>>
    edges: Array<Record<string, any>>
  }
  variables?: Record<string, { value: unknown; type: string; scope?: string }>
  [key: string]: unknown
}

const NEW_ID = /__NEW_ID_([A-Z0-9_]+)__/g
const LEFTOVER = /__[A-Z][A-Z0-9_]*__/

/** Load a fixture beside the spec: `__RUN_UUID__`, `__FOLDER__` and `extra` replaced, each
 *  `__NEW_ID_<KEY>__` given one fresh v4 id per key, SSH hosts pointed at the stack. */
export function loadSftpFixture(
  dir: string,
  file: string,
  run: SftpRun,
  extra: Readonly<Record<string, string>> = {},
): SftpFixture {
  const ids = new Map<string, string>()
  const placeholders: Record<string, string> = {
    __RUN_UUID__: run.uuid,
    __FOLDER__: run.folder,
    ...extra,
  }
  let text = fs.readFileSync(path.resolve(dir, file), 'utf-8')
  for (const [key, value] of Object.entries(placeholders)) {
    text = text.split(key).join(value.replace(/[\\"]/g, '\\$&'))
  }
  text = text.replace(NEW_ID, (_, key: string) => {
    if (!ids.has(key)) ids.set(key, randomUUID())
    return ids.get(key) as string
  })
  const leftover = LEFTOVER.exec(text)
  expect(leftover, `${file} keeps an unreplaced placeholder ${leftover?.[0]}`).toBeNull()
  return injectServiceHost(JSON.parse(text) as Record<string, unknown>) as SftpFixture
}

/** Set a declared variable's starting value in a loaded fixture. */
export function setVariable(fixture: SftpFixture, name: string, value: unknown): void {
  const declared = fixture.variables?.[name]
  expect(declared, `${fixture.name} declares no variable "${name}"`).toBeTruthy()
  if (declared) declared.value = value
}

// ---------------------------------------------------------------------------
// Import, validation and the run
// ---------------------------------------------------------------------------

/** What the spec puts in the Test's own Test Data: files, and folders (empty ones too). */
export interface TestDataSeed {
  files?: readonly SeedFile[]
  folders?: readonly string[]
}

function foldersToCreate(seed: TestDataSeed): string[] {
  const wanted = [...(seed.folders ?? []), ...(seed.files ?? []).map((file) => file.folder)]
  const all = new Set<string>()
  for (const folder of wanted) {
    const parts = folder.split('/').filter((part) => part !== '')
    parts.forEach((_, i) => all.add(parts.slice(0, i + 1).join('/')))
  }
  return [...all].sort((a, b) => a.split('/').length - b.split('/').length)
}

/** Clear the draft, import the fixture (zero load errors, no repairs), seed its Test Data
 *  parents first, and open it on the canvas. Returns the Test id. */
export async function importSftpTest(
  page: Page,
  fixture: SftpFixture,
  seed: TestDataSeed = {},
): Promise<string> {
  await page.request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
  const testId = await importFixtureTest(page, fixture, { rejectRepairs: true })
  for (const folder of foldersToCreate(seed)) {
    await createTestDataFolder(page.request, testId, folder)
  }
  for (const file of seed.files ?? []) {
    await uploadTestData(page.request, testId, file.folder, file.name, file.body)
  }
  await openTestOnCanvas(page, testId)
  return testId
}

/** `POST /tests/{id}/validate?context=run` reports zero errors (warnings allowed). */
export async function expectRunValid(request: APIRequestContext, testId: string): Promise<void> {
  const result = await validateTest(request, testId, 'run')
  expect(result.errors, `run validation of ${testId}: ${JSON.stringify(result.errors)}`).toEqual([])
}

/** Validate for a run, pick the shared environment and press Run. */
export async function startSftpRun(page: Page, testId: string): Promise<Locator> {
  await expectRunValid(page.request, testId)
  return startRun(page)
}

/** What a finished workbench run left: its verdict, every console entry, its variables. */
export interface SftpHarvest {
  verdict: string
  entries: LogEntry[]
  vars: SessionVariables
}

/** Wait for the terminal state and the bookend line (none for a stopped run), then harvest. */
export async function finishSftpRun(
  page: Page,
  status: Locator,
  bookend: string | null,
  verdict = 'passed',
  timeoutMs = 120_000,
): Promise<SftpHarvest> {
  await expect(status).not.toHaveAttribute('data-status', 'running', { timeout: timeoutMs })
  if (bookend !== null) await waitForLogText(page, bookend, 30_000)
  const entries = consoleEntriesFromCopy(inClockOrder(await getLogCopyTexts(page)))
  const actual = (await status.getAttribute('data-status')) ?? ''
  if (actual !== verdict) {
    console.log('node statuses:', JSON.stringify(await getNodeStatuses(page), null, 2))
    console.log(formatEntries(entries))
  }
  expect(actual, `the run must end ${verdict}`).toBe(verdict)
  const vars = await getSessionVariables(page, await getActiveSessionId(page))
  return { verdict: actual, entries, vars }
}

const CLOCK_PREFIX = /^\d{2}:\d{2}:\d{2}\.\d{3}/

// The scroll harvest can collect a late-measured row out of place; the stable sort keeps same-ms order.
function inClockOrder(copyTexts: readonly string[]): string[] {
  const clock = (text: string): string => CLOCK_PREFIX.exec(text)?.[0] ?? ''
  return [...copyTexts].sort((a, b) => clock(a).localeCompare(clock(b)))
}

/** Validate, run and harvest a Test that is open on the canvas. */
export async function runSftpTest(
  page: Page,
  testId: string,
  bookend: string,
  verdict = 'passed',
): Promise<SftpHarvest> {
  const status = await startSftpRun(page, testId)
  return finishSftpRun(page, status, bookend, verdict)
}

// ---------------------------------------------------------------------------
// Sheet rows
// ---------------------------------------------------------------------------

async function typeIntoValueSheet(page: Page, text: string): Promise<void> {
  const sheet = valueSheet(page)
  await expect(sheet).toBeVisible()
  await sheet.locator('.cm-content').first().click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Delete')
  // insertText, not type: auto-closing brackets and quotes leave it alone.
  if (text) await page.keyboard.insertText(text)
  await saveAndCloseSheet(page)
}

/** Replace a literal string row's text through its Edit value sheet (the row's expand, FIELD-1). */
export async function fillTextRow(page: Page, sheet: Locator, name: string, text: string): Promise<void> {
  await expandButton(sheet, name).click()
  await typeIntoValueSheet(page, text)
}

/** Replace a stored secret row: Edit protected value, Delete & Edit, then the new text. */
export async function replaceSecretRow(
  page: Page,
  sheet: Locator,
  name: string,
  text: string,
): Promise<void> {
  await paramRow(sheet, name).locator('button[aria-label="Edit protected value"]').click()
  const confirm = page.getByRole('dialog').filter({ hasText: 'Edit Protected Value?' })
  await expect(confirm).toBeVisible()
  await confirm.getByRole('button', { name: 'Delete & Edit' }).click()
  // Delete & Edit leaves the row an empty text box with the keyboard in it.
  const box = fieldInput(sheet, name)
  await expect(box).toBeFocused()
  await box.fill(text)
  await expect(box).toHaveValue(text)
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

/** One Summary row: Upload `[WAVE source, server target, size]`, Download the reverse. */
export interface SummaryRow {
  source: string
  destination: string
  size: number
}

/** One List entry. */
export interface EntryRow {
  name: string
  path: string
  type: string
  modified: string
  size: number
}

function typedTable(vars: SessionVariables, name: string, columns: ReadonlyArray<readonly [string, string]>): WaveTable {
  expect(vars[name]?.type, `"${name}" holds a table`).toBe('table')
  const table = vars[name].value as WaveTable
  expect(
    table.columns.map((column) => [column.name, column.type]),
    `"${name}" columns`,
  ).toEqual(columns.map((column) => [...column]))
  return table
}

/** The Summary table bound to `name`, its declared columns checked. */
export function summaryRows(vars: SessionVariables, name: string): SummaryRow[] {
  const table = typedTable(vars, name, [
    ['source', 'string'],
    ['destination', 'string'],
    ['size', 'integer'],
  ])
  return table.rows.map((row) => {
    const [source, destination, size] = row as [string, string, number]
    return { source, destination, size }
  })
}

/** The Entries table bound to `name`, its declared columns checked. */
export function entryRows(vars: SessionVariables, name: string): EntryRow[] {
  const table = typedTable(vars, name, [
    ['name', 'string'],
    ['path', 'string'],
    ['type', 'string'],
    ['modified', 'string'],
    ['size', 'integer'],
  ])
  return table.rows.map((row) => {
    const [entryName, entryPath, type, modified, size] = row as [string, string, string, string, number]
    return { name: entryName, path: entryPath, type, modified, size }
  })
}

/** A bound output's value; fails when the run never bound it. */
export const out = (vars: SessionVariables, name: string): unknown => sessionValue(vars, name)

// ---------------------------------------------------------------------------
// Console
// ---------------------------------------------------------------------------

/** The label an SFTP block's recorded failure names in its WARN failure line. */
export type SftpOperation = 'Upload' | 'Download' | 'List' | 'Stats' | 'Delete' | 'Move' | 'Create folder'

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

/** The SFTP console lines (SFTP-9). */
export const sftpLine = {
  uploaded: (n: number, bytes: number, source: string, destination: string): string =>
    `Uploaded ${plural(n, 'file', 'files')}, ${bytes} bytes, from ${source} to ${destination}`,
  downloaded: (n: number, bytes: number, source: string, destination: string): string =>
    `Downloaded ${plural(n, 'file', 'files')}, ${bytes} bytes, from ${source} to ${destination}`,
  saved: (relative: string, absolute: string, size: number): string =>
    `Saved artifact://${relative} at ${absolute}, ${size} bytes`,
  listed: (count: number, where: string): string => `Listed ${plural(count, 'entry', 'entries')} in ${where}`,
  stats: (where: string): string => `Reported stats for ${where}`,
  deleted: (where: string): string => `Deleted ${where}`,
  deletedMatches: (n: number, where: string): string => `Deleted ${plural(n, 'match', 'matches')} of ${where}`,
  nothingToDelete: (where: string): string => `Nothing to delete: ${where}`,
  moved: (source: string, target: string): string => `Moved ${source} to ${target}`,
  createdFolder: (where: string): string => `Created folder ${where}`,
  folderExists: (where: string): string => `Folder already exists: ${where}`,
  skippedLink: (where: string): string => `Skipped symbolic link ${where}`,
  failed: (operation: SftpOperation, reason: string, message: string): string =>
    `${operation} failed (${reason}): ${message}`,
}

/** The SFTP block's palette name, which heads its console source (EXEC-25). */
export const SFTP_SOURCE = 'SFTP'

/** The messages the SFTP block named `name` wrote at `level`, in console order. */
export function sftpLines(entries: readonly LogEntry[], name: string, level = 'INFO'): string[] {
  const source = blockSource(SFTP_SOURCE, name)
  return entries
    .filter((entry) => entry.source === source && entry.level === level)
    .map((entry) => entry.message)
}

/** A recorded failure of the SFTP block named `name`, bound under `<key>_success|_error|_reason`. */
export interface RecordedFailure {
  key: string
  name: string
  operation: SftpOperation
  reason: string
  message: string
}

/** Success false, Error = the message, Reason = the code, exactly one WARN failure line from the block. */
export function expectRecorded(
  vars: SessionVariables,
  entries: readonly LogEntry[],
  failure: RecordedFailure,
): void {
  const { key, name, operation, reason, message } = failure
  expect(out(vars, `${key}_success`), `${key} Success`).toBe(false)
  expect(out(vars, `${key}_error`), `${key} Error`).toBe(message)
  expect(out(vars, `${key}_reason`), `${key} Reason`).toBe(reason)
  expect(sftpLines(entries, name, 'WARN'), `${key} WARN lines\n${formatEntries(entries)}`).toEqual([
    sftpLine.failed(operation, reason, message),
  ])
}

// ---------------------------------------------------------------------------
// WAVE-side files
// ---------------------------------------------------------------------------

/** The run's artifact at `relative` reads back exactly as `expected`. */
export async function expectArtifactText(page: Page, relative: string, expected: string): Promise<void> {
  expect(await readArtifact(page, relative), `artifact://${relative}`).toBe(expected)
}

/** Every file under `STORAGE_BASE_PATH` named `name`, and every `.<name>.<8 hex>.part` partial. */
export function storageMatches(name: string): { targets: string[]; partials: string[] } {
  const partial = new RegExp(`^\\.${escapeRegExp(name)}\\.[0-9a-f]{8}\\.part$`)
  const targets: string[] = []
  const partials: string[] = []
  const walk = (dir: string): void => {
    let items: fs.Dirent[]
    try {
      items = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return // a folder removed while the scan walks it
    }
    for (const item of items) {
      const full = path.join(dir, item.name)
      if (item.isDirectory()) walk(full)
      else if (item.name === name) targets.push(full)
      else if (partial.test(item.name)) partials.push(full)
    }
  }
  walk(STORAGE_BASE_PATH)
  return { targets, partials }
}

// ---------------------------------------------------------------------------
// The cleanup run
// ---------------------------------------------------------------------------

export type SftpAccount = 'wave' | 'dropzone'

export interface CleanupOptions {
  account: SftpAccount
  /** The spec's folders; each must hold its `e2e-<spec>-<uuid>` segment. */
  paths: readonly string[]
  /** As `wave` only: a path to Stats before removal; the first path when absent. */
  probe?: string
}

export interface CleanupResult {
  verdict: string
  /** The Stats taken before removal (as `wave`); null as `dropzone`. */
  probe: { exists: boolean; type: string; size: number } | null
}

const SPEC_PATH = /^[A-Za-z0-9._/-]*e2e-[a-z0-9-]+-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}([A-Za-z0-9._/-]*)$/

function checkedPath(value: string): string {
  expect(SPEC_PATH.test(value), `cleanup refuses "${value}": not a spec folder`).toBe(true)
  return value
}

async function trackedVariables(request: APIRequestContext, executionId: string): Promise<Record<string, unknown>> {
  const response = await request.get(`${BACKEND_URL}/executions/${executionId}/variables`)
  expect(response.ok(), `GET /executions/${executionId}/variables: ${response.status()}`).toBeTruthy()
  const body = (await response.json()) as { data?: Record<string, unknown> }
  const stored = (body.data ?? body) as Record<string, unknown>
  return Object.fromEntries(
    Object.entries(stored).map(([name, held]) => [
      name,
      held !== null && typeof held === 'object' && 'value' in held ? (held as { value: unknown }).value : held,
    ]),
  )
}

/** Remove the spec's server folders in a headless tracked run (`fixture-cleanup.json` as `wave`,
 *  `fixture-cleanup-dropzone.json` as `dropzone`), delete that Test, clear the settled session. */
export async function runCleanup(request: APIRequestContext, options: CleanupOptions): Promise<CleanupResult> {
  const paths = options.paths.map(checkedPath)
  expect(paths.length, 'cleanup needs at least one path').toBeGreaterThan(0)
  const run = newSftpRun('sftp-cleanup')
  const fixture =
    options.account === 'wave'
      ? loadSftpFixture(__dirname, 'fixture-cleanup.json', run, {
          __PROBE_PATH__: checkedPath(options.probe ?? paths[0]),
          __REMOVE_PATHS__: paths.map((item) => `'${item}'`).join(' '),
        })
      : loadSftpFixture(__dirname, 'fixture-cleanup-dropzone.json', run)
  if (options.account === 'dropzone') setVariable(fixture, 'cleanup_paths', paths)

  const created = await request.post(`${BACKEND_URL}/tests`, { data: fixture })
  const body = await created.json().catch(() => null)
  expect(created.ok(), `POST /tests (cleanup): ${created.status()} ${JSON.stringify(body)}`).toBeTruthy()
  const testId = (body?.data?.id ?? body?.id) as string
  try {
    await expectRunValid(request, testId)
    const { executionId, verdict } = await runTrackedTest(request, testId)
    const held = await trackedVariables(request, executionId)
    expect(verdict, `the ${options.account} cleanup run must pass: ${JSON.stringify(held)}`).toBe('passed')
    if (options.account === 'dropzone') return { verdict, probe: null }
    expect(held.remove_exit, `rm -rf must exit 0: ${String(held.remove_stderr)}`).toBe(0)
    return {
      verdict,
      probe: {
        exists: held.probe_exists as boolean,
        type: held.probe_type as string,
        size: held.probe_size as number,
      },
    }
  } finally {
    await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
    await clearSettledWorkbenchSession(request)
  }
}
