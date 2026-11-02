/**
 * V-TEXT-ENCODING-FUNCTIONAL: text outside ASCII keeps its characters through a run, a run log, an export and an SSH session
 * Wireframe: none
 * Design Decisions: EXEC-25, EXEC-26
 * REQ: REQ-4.6.9, REQ-3.4.1.3, REQ-5.2.4.9, REQ-6.1.4
 *
 * `fixture.json` is a Test named `Grüße 測試`: a Log block named `Grüße 測試` that writes
 * `Grüße 測試`, a Python block that prints it, and an SSH Session Exec on the stack's sshd that runs
 * `printf 'ok\377'` (one byte that is not UTF-8). `fixture-unencodable.json` holds an SSH Session
 * Exec and three SSH Session Script blocks whose Command, Script, Interpreter and Working Directory
 * each carry a character UTF-8 cannot write, each block in its own Try/Catch. Every one of those
 * texts would leave a file in a per-run marker folder on the remote host if it were sent with the
 * character replaced.
 *
 * Pass Criteria:
 * 1. TEXT-1: the fixture imports through POST /tests with no repairs and validates with zero errors;
 *    run from the Workbench it passes. The canvas block shows the Name `Grüße 測試`; the console
 *    holds the start line with the Test's name, and the Log block's line `Grüße 測試` under the
 *    source `Log : Grüße 測試`.
 * 2. TEXT-1: the Python block's Stdout is `Grüße 測試` and a newline, exit code 0.
 * 3. TEXT-1: the SSH Session Exec succeeds with exit code 0, empty Stderr, and Stdout `ok` followed
 *    by the replacement character U+FFFD; a Log line shows the same text.
 * 4. TEXT-2: run from the Tests list, the same Test passes; its run log, downloaded on its own
 *    from the Logs section of the Artifacts page, is valid UTF-8 and holds the start line with the
 *    Test's name, `Grüße 測試`, `python stdout=Grüße 測試 code=0` and `ssh stdout=ok` with the
 *    replacement character. The download answers 200 with the header
 *    `attachment; filename="{plain fallback}"; filename*=UTF-8''{the whole name, percent-encoded}`,
 *    and the file the browser saves is named `{Test name}.log`, the whole name.
 * 5. TEXT-3: the same run's Download all hands the browser a zip whose member
 *    `logs/{Test name}.log` keeps the name and holds the same UTF-8 lines. The archive itself is
 *    saved as `{stamp}-Grüße-測試-{rest of the name}.zip`: the letters of the Test's name are kept,
 *    and the header carries that name in the `filename*=UTF-8''` form.
 * 6. TEXT-4: a Test holding the block named `Grüße 測試` is exported from the Tests list as YAML,
 *    deleted and imported back from that file, then the same through JSON: each time the imported
 *    Test holds the block's Name, the Log message and the Python script unchanged, and the canvas
 *    shows the Name. The Test's name is plain, so each export answers with the header
 *    `attachment; filename="{file name}"` and the browser saves the file under that name.
 * 7. TEXT-5: the same round trip when the Test itself is named `Grüße 測試`: each export answers
 *    with the `filename*=UTF-8''` header form carrying the whole file name, and the browser saves
 *    the file as `Grüße-測試-{rest of the name}.{format}`.
 * 8. TEXT-6: with the character produced when the block runs (an expression), each block fails
 *    before anything is sent, its Try/Catch catching exactly
 *    `{Row} has a character at line 1, column 7 that cannot be encoded as UTF-8, so nothing was
 *    sent to the remote host: remove or replace it` for Command, Script, Interpreter and Working
 *    Directory. The engine names each block by its Name. The marker folder holds only the folder
 *    made before the four blocks, the session still runs commands after them, and the run passes.
 * 9. TEXT-7: with the character saved in a block's own text the save is refused: POST /tests
 *    answers 422 with error code `VALIDATION_ERROR`, the request id in the body and in both
 *    headers, and exactly `The request has a character at {where} that cannot be encoded as
 *    UTF-8, so it was refused: remove or replace it`, `{where}` being the path of that text in
 *    the request (`workflow.nodes[{n}].data.config.values.{row}`), for each of the four rows on
 *    its own; with all four saved, the first in document order is named. The same save sent as
 *    `text/plain`, under an upload's content type or with no content type at all gets the same
 *    answer. Nothing is stored: the
 *    Tests list holds no Test of this run and as many Tests as before, and no Test answers under
 *    an id a refused request carried (404).
 * 10. TEXT-8: a Test named `हिंदी परीक्षण` keeps every mark of its script in the names it is
 *     handed out under. Its YAML export is saved as `हिंदी-परीक्षण-{rest of the name}.yaml`; a
 *     Test Data folder named `हिंदी परीक्षण`, downloaded from the Test Data sheet, is saved as
 *     `testdata-हिंदी-परीक्षण.zip` and holds the folder's file; the archive of the Test's whole
 *     Test Data answers under `testdata-हिंदी-परीक्षण-{rest of the name}.zip`. Each answer carries
 *     its name in the `filename*=UTF-8''` header form.
 */

import fs from 'fs'
import path from 'path'
import { randomBytes, randomUUID } from 'node:crypto'
import { test, expect, type APIRequestContext, type Page } from '../../helpers/playwright-fixtures'
import {
  BACKEND_URL,
  SSH_MAIN_PORT,
  SSH_STACK_PASSWORD,
  SSH_STACK_USER,
} from '../../helpers/config'
import { getTest } from '../../helpers/element-types'
import {
  getActiveSessionId,
  getSessionVariables,
  importedTestId,
  importFixtureTest,
  importThroughListPage,
  importValidateAndNavigate,
  sessionValue,
  type SessionVariables,
} from '../../helpers/fixture-import'
import { openTest, validateTest } from '../../helpers/fn-seed'
import { expectNodeStatus, finishRun, resolveEnvironmentId, startRun } from '../../helpers/k8s-run'
import {
  escapeRegExp,
  formatEntries,
  getLogCopyTexts,
  type LogEntry,
} from '../../helpers/log-reader'
import { createTestDataFolder, uploadTestData } from '../../helpers/testdata'
import { readZipEntry, zipEntryNames } from '../../helpers/zip-reader'
import { deleteTest } from '../file-picker/picker'
import { blockSource, consoleEntriesFromCopy } from '../shell-blocks/shell-helpers'
import { folderRowOf, openSheet } from '../testdata-sheet/helpers'

type Json = Record<string, any>

/** A browser saves a file under a name outside ASCII only when its own locale is UTF-8. */
const UTF8_BROWSER_ENV = Object.fromEntries(
  Object.entries({ ...process.env, LC_ALL: 'C.UTF-8' }).filter(
    (entry): entry is [string, string] => entry[1] !== undefined,
  ),
)
test.use({ launchOptions: { env: UTF8_BROWSER_ENV } })

const TEXT = 'Grüße 測試'
/** A name whose script joins marks to its letters. */
const MARKED_TEXT = 'हिंदी परीक्षण'
/** U+FFFD, what a byte that is not UTF-8 is read as. */
const REPLACEMENT = String.fromCharCode(0xfffd)
const SYSTEM = 'SYSTEM'
const BOOKEND = 'text-encoding-done'
const UNENCODABLE_BOOKEND = 'ssh-unencodable-done'

/** The escape as the fixture's expressions spell it, and the character it stands for. */
const ESCAPE = String.raw`\udce9`
const UNENCODABLE = String.fromCharCode(0xdce9)

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

interface Leg {
  key: string
  /** The block's Name on the canvas. */
  block: string
  elementType: string
  field: string
  /** The row's label, as the refusal starts. */
  row: string
}

const LEGS: Leg[] = [
  { key: 'command', block: 'Exec bad Command', elementType: 'ssh-session-exec', field: 'command', row: 'Command' },
  { key: 'script', block: 'Script bad Script', elementType: 'ssh-session-script', field: 'script', row: 'Script' },
  {
    key: 'interpreter',
    block: 'Script bad Interpreter',
    elementType: 'ssh-session-script',
    field: 'interpreter',
    row: 'Interpreter',
  },
  {
    key: 'working_dir',
    block: 'Script bad Working Directory',
    elementType: 'ssh-session-script',
    field: 'working_dir',
    row: 'Working Directory',
  },
]

function refusal(row: string): string {
  return `${row} has a character at line 1, column 7 that cannot be encoded as UTF-8, so nothing was sent to the remote host: remove or replace it`
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Load a fixture beside the spec with the stack's SSH login and this run's tokens filled in. */
function loadFixture(file: string, tokens: Record<string, string> = {}): Json {
  const whole: Record<string, unknown> = {
    __SSH_PORT__: Number(SSH_MAIN_PORT),
    __SSH_USER__: SSH_STACK_USER,
    __SSH_PASSWORD__: SSH_STACK_PASSWORD,
  }
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk)
    if (node && typeof node === 'object') {
      return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, walk(value)]))
    }
    if (typeof node !== 'string') return node
    if (Object.hasOwn(whole, node)) return whole[node]
    return Object.entries(tokens).reduce((text, [token, value]) => text.replaceAll(token, value), node)
  }
  return walk(JSON.parse(fs.readFileSync(path.resolve(__dirname, file), 'utf-8'))) as Json
}

function nodeByName(fixture: Json, name: string): Json {
  const found = (fixture.workflow.nodes as Json[]).filter((node) => node.data.label === name)
  expect(found, `the fixture holds one block named "${name}"`).toHaveLength(1)
  return found[0]
}

function nodeByDescription(fixture: Json, description: string): Json {
  const found = (fixture.workflow.nodes as Json[]).filter((node) => node.data.description === description)
  expect(found, `the fixture holds one block described "${description}"`).toHaveLength(1)
  return found[0]
}

/** A folder name of five characters, so the Working Directory's character sits at column 7. */
function markerFolder(): string {
  return `w${randomBytes(4).readUInt32BE(0).toString(36).padStart(7, '0').slice(-4)}`
}

/** The same blocks with the text of the given rows saved as typed: the character itself, no expression. */
function withSavedText(fixture: Json, legs: readonly Leg[]): Json {
  const copy = structuredClone(fixture)
  for (const leg of legs) {
    const data = nodeByName(copy, leg.block).data
    const expression = data.config.values[leg.field] as string
    data.config.values[leg.field] = expression.slice(1, -1).replace(ESCAPE, UNENCODABLE)
    data.expressionFields = (data.expressionFields as string[]).filter((field) => field !== leg.field)
  }
  return copy
}

// ---------------------------------------------------------------------------
// Console and run log
// ---------------------------------------------------------------------------

function expectLine(entries: readonly LogEntry[], level: string, source: string, message: string): void {
  expect(
    entries.filter((entry) => entry.level === level && entry.source === source && entry.message === message),
    `the console carries one [${level}] ${source}: "${message}".\n${formatEntries(entries)}`,
  ).toHaveLength(1)
}

async function consoleEntries(page: Page): Promise<LogEntry[]> {
  return consoleEntriesFromCopy(await getLogCopyTexts(page))
}

/** One line of a run log file: its timestamp, the level, then the message. */
function runLogLine(level: string, message: string): RegExp {
  return new RegExp(`^\\S+ ${level} ${escapeRegExp(message)}$`, 'm')
}

// ---------------------------------------------------------------------------
// Download names
// ---------------------------------------------------------------------------

/** Printable ASCII without the double quote and the backslash: what a quoted header name can hold. */
const PLAIN = String.raw`[ !#-\[\]-~]`

/** The name as a download header carries it whole: its UTF-8 bytes, percent-encoded. */
function encodedName(name: string): string {
  return encodeURIComponent(name).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  )
}

/** A plain name goes out quoted; any other name goes out whole in the encoded form after a plain fallback. */
function expectDownloadHeader(header: string | undefined, name: string): void {
  if (new RegExp(`^${PLAIN}*$`).test(name)) {
    expect(header, `the header of ${name}`).toBe(`attachment; filename="${name}"`)
    return
  }
  expect(header, `the header of ${name}`).toMatch(
    new RegExp(`^attachment; filename="${PLAIN}+"; filename\\*=UTF-8''${escapeRegExp(encodedName(name))}$`),
  )
}

/** An export's file name: letters, marks and digits of any language kept, punctuation dropped, spaces as hyphens. */
function exportFileName(name: string, format: string): string {
  const stem = name.replace(/[^\p{L}\p{M}\p{N}_\s-]/gu, '').trim().replace(/\s+/g, '-')
  return `${stem}.${format}`
}

/** A name inside an archive's file name: every run of other characters becomes one hyphen. */
function archiveNamePart(name: string): string {
  return name.replace(/[^\p{L}\p{M}\p{N}_.-]+/gu, '-').replace(/^-+|-+$/g, '')
}

/** The drill section card whose bold header reads `title`. */
function sectionOf(page: Page, title: string) {
  return page.locator('section', {
    has: page.locator('span.text-sm.font-bold', { hasText: title }),
  })
}

// ---------------------------------------------------------------------------
// Tests list: run, export, import
// ---------------------------------------------------------------------------

async function openTestsList(page: Page, name: string): Promise<void> {
  await page.goto('/tests')
  await expect(page.locator('[data-testid="tests-page"]')).toBeVisible({ timeout: 15_000 })
  await page.locator('[data-testid="search-input"] input').fill(name)
}

async function findExecutionId(request: APIRequestContext, testId: string): Promise<string> {
  let executionId = ''
  await expect
    .poll(
      async () => {
        const response = await request.get(`${BACKEND_URL}/executions?entity_id=${testId}`)
        const rows = ((await response.json().catch(() => null))?.data ?? []) as Array<{ id: string }>
        executionId = rows[0]?.id ?? ''
        return executionId
      },
      { timeout: 15_000, message: `no execution appeared for Test ${testId}` },
    )
    .toBeTruthy()
  return executionId
}

async function executionVerdict(request: APIRequestContext, executionId: string): Promise<string> {
  let verdict = ''
  await expect
    .poll(
      async () => {
        const response = await request.get(`${BACKEND_URL}/executions/${executionId}`)
        verdict = (((await response.json().catch(() => null))?.data ?? {}) as { status?: string }).status ?? ''
        return ['passed', 'failed', 'stopped', 'skipped'].includes(verdict)
      },
      { timeout: 120_000, intervals: [200, 500, 1_000], message: `execution ${executionId} did not end` },
    )
    .toBe(true)
  return verdict
}

/** `null` sends the request with no Content-Type header at all. */
type ContentType =
  | 'application/json'
  | 'text/plain'
  | 'application/octet-stream'
  | 'multipart/form-data; boundary=x'
  | null

interface Sent {
  status: number
  answer: Json
  requestId: string | undefined
  correlationId: string | undefined
}

/** POST a Test's JSON to /tests under the given content type. */
async function postTest(request: APIRequestContext, body: Json, contentType: ContentType): Promise<Sent> {
  if (contentType === 'application/json') {
    const response = await request.post(`${BACKEND_URL}/tests`, { data: body })
    return {
      status: response.status(),
      answer: (await response.json()) as Json,
      requestId: response.headers()['x-request-id'],
      correlationId: response.headers()['x-correlation-id'],
    }
  }
  // Playwright names a content type for every body it sends, so the others go out through fetch.
  const response = await fetch(`${BACKEND_URL.replace('localhost', '127.0.0.1')}/tests`, {
    method: 'POST',
    headers: contentType === null ? {} : { 'content-type': contentType },
    body: new Uint8Array(Buffer.from(JSON.stringify(body), 'utf-8')),
  })
  return {
    status: response.status,
    answer: (await response.json()) as Json,
    requestId: response.headers.get('x-request-id') ?? undefined,
    correlationId: response.headers.get('x-correlation-id') ?? undefined,
  }
}

/** How many Tests the Tests list holds. */
async function testCount(request: APIRequestContext): Promise<number> {
  const response = await request.get(`${BACKEND_URL}/tests?per_page=1`)
  expect(response.status(), 'GET /tests answered').toBe(200)
  return (await response.json()).pagination.total as number
}

interface TrackedRun {
  testId: string
  name: string
  executionId: string
}

/** Import the fixture, run it from its row in the Tests list and wait for it to pass. */
async function runFromTestsList(page: Page, request: APIRequestContext, fixture: Json): Promise<TrackedRun> {
  await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
  const testId = await importFixtureTest(page, fixture, { injectSsh: true, rejectRepairs: true })
  created.push(testId)
  const name = (await getTest(request, testId)).name as string
  expect(name.startsWith(`${TEXT} `), `the stored Test is named with the text: ${name}`).toBe(true)
  const environmentId = await resolveEnvironmentId(request)

  await openTestsList(page, name)
  await page.getByRole('button', { name: `Run ${name}`, exact: true }).click()
  const dialog = page.locator('[data-testid="run-dialog-content"]')
  await expect(dialog).toBeVisible()
  await dialog.locator(`[data-testid="all-environments"] [data-env-id="${environmentId}"]`).click()
  await dialog.locator('[data-testid="run-dialog-run"]').click()
  await page.waitForURL(/\/workbench/)

  const executionId = await findExecutionId(request, testId)
  expect(await executionVerdict(request, executionId), `the run of "${name}"`).toBe('passed')
  return { testId, name, executionId }
}

/** The run log is UTF-8 and holds the text of every block. */
function expectRunLog(bytes: Buffer, fixture: Json, name: string): void {
  expect(bytes.includes(Buffer.from(TEXT, 'utf-8')), 'the bytes of the text as UTF-8').toBe(true)
  expect(bytes.includes(Buffer.from([0x6f, 0x6b, 0xef, 0xbf, 0xbd])), 'ok and U+FFFD as UTF-8').toBe(true)
  // A fatal decoder throws on the first byte that is not UTF-8.
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  const blocks = (fixture.workflow.nodes as Json[]).length
  expect(text).toMatch(runLogLine('INFO', `Test '${name}' execution started (${blocks} blocks)`))
  expect(text).toMatch(runLogLine('INFO', TEXT))
  expect(text).toMatch(runLogLine('INFO', `python stdout=${TEXT} code=0`))
  expect(text).toMatch(runLogLine('INFO', `ssh stdout=ok${REPLACEMENT} code=0`))
  expect(text).toMatch(runLogLine('INFO', `Test '${name}' completed successfully`))
}

interface Exported {
  /** The name the browser saves the file under. */
  filename: string
  /** The `Content-Disposition` header of the export's answer. */
  header: string | undefined
  bytes: Buffer
}

/** Export one Test from its row in the Tests list and return the file the browser was handed. */
async function exportFromTestsList(
  page: Page,
  testId: string,
  name: string,
  format: 'yaml' | 'json',
): Promise<Exported> {
  await openTestsList(page, name)
  const row = page.locator('[data-testid="test-row"]').filter({ hasText: name })
  await expect(row, `the Tests list shows "${name}"`).toHaveCount(1)
  await row.locator('[data-testid="action-menu-trigger"]').click()
  await page.locator('[data-testid="action-export"]').click()
  const dialog = page.locator('[data-testid="export-dialog"]')
  await expect(dialog).toBeVisible()
  await dialog.locator(`[data-testid="format-${format}"]`).click()

  const answered = page.waitForResponse((response) => response.url().includes(`/tests/${testId}/export`))
  const handed = page.waitForEvent('download', { timeout: 20_000 }).catch(() => null)
  await dialog.locator('[data-testid="export-button"]').click()
  const response = await answered
  expect(response.status(), `the ${format} export of "${name}" answered`).toBe(200)
  const download = await handed
  expect(download, `the browser was handed the ${format} export of "${name}"`).not.toBeNull()
  await expect(dialog).toBeHidden()
  return {
    filename: download!.suggestedFilename(),
    header: response.headers()['content-disposition'],
    bytes: fs.readFileSync(await download!.path()),
  }
}

/** Import one exported file through the Tests list's Import dialog; returns the new Test's id. */
async function importFromTestsList(page: Page, file: Exported, name: string): Promise<string> {
  await openTestsList(page, name)
  await expect(page.locator('[data-testid="test-row"]'), `"${name}" is gone before the import`).toHaveCount(0)
  const review = await importThroughListPage(page, '/tests', {
    name: file.filename,
    mimeType: file.filename.endsWith('.json') ? 'application/json' : 'application/x-yaml',
    buffer: file.bytes,
  })
  expect(review.summary).toBe('1 importable, 0 blocked')
  expect(Object.keys(review.items), 'the review names the Test').toEqual([name])
  return importedTestId(page, name)
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

const created: string[] = []
const runTokens: string[] = []

test.describe('V-TEXT-ENCODING-FUNCTIONAL: text outside ASCII keeps its characters', () => {
  test.afterEach(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    for (const testId of created.splice(0)) await deleteTest(request, testId)
    // A save that answers an error can still have stored its Test.
    for (const token of runTokens.splice(0)) {
      const response = await request.get(`${BACKEND_URL}/tests?search=${token}&per_page=100`)
      const rows = ((await response.json().catch(() => null))?.data ?? []) as Array<{ id: string }>
      for (const row of rows) await deleteTest(request, row.id)
    }
  })

  test('TEXT-1: a Test named with the text runs, and the Log, Python and SSH blocks keep every character', async ({
    page,
  }) => {
    test.setTimeout(240_000)
    const fixture = loadFixture('fixture.json')
    const logId = nodeByName(fixture, TEXT).id as string
    const testId = await importValidateAndNavigate(page, fixture, { injectSsh: true, rejectRepairs: true })
    created.push(testId)

    const validation = await validateTest(page.request, testId, 'run')
    expect(validation.status, `validate answered ${validation.status}`).toBe(200)
    expect(validation.errors, JSON.stringify(validation.errors)).toEqual([])
    const name = (await getTest(page.request, testId)).name as string
    expect(name.startsWith(`${TEXT} `), `the stored Test is named with the text: ${name}`).toBe(true)

    await expect(page.getByTestId(`workflow-node-body-${logId}`), 'the canvas block shows its Name').toContainText(TEXT)

    const status = await startRun(page)
    await finishRun(page, status, BOOKEND)
    const entries = await consoleEntries(page)
    const variables: SessionVariables = await getSessionVariables(page, await getActiveSessionId(page))

    await test.step('the console names the Test and holds the Log line under the block Name', () => {
      const blocks = (fixture.workflow.nodes as Json[]).length
      expectLine(entries, 'INFO', SYSTEM, `Test '${name}' execution started (${blocks} blocks)`)
      expectLine(entries, 'INFO', blockSource('Log', TEXT), TEXT)
      expectLine(entries, 'INFO', SYSTEM, `Test '${name}' completed successfully`)
    })

    await test.step('the Python block prints the text into Stdout', () => {
      expect(sessionValue(variables, 'py_stdout')).toBe(`${TEXT}\n`)
      expect(sessionValue(variables, 'py_code')).toBe(0)
      expectLine(entries, 'INFO', 'Log', `python stdout=${TEXT} code=0`)
    })

    await test.step('a byte that is not UTF-8 arrives from the SSH session as the replacement character', () => {
      expect(sessionValue(variables, 'ssh_stdout')).toBe(`ok${REPLACEMENT}`)
      expect(sessionValue(variables, 'ssh_stderr')).toBe('')
      expect(sessionValue(variables, 'ssh_code')).toBe(0)
      expectLine(entries, 'INFO', 'Log', `ssh stdout=ok${REPLACEMENT} code=0`)
    })

    for (const node of fixture.workflow.nodes as Json[]) {
      await expectNodeStatus(page, node.id as string, 'success')
    }
  })

  test('TEXT-2: the run log of a Test named with the text downloads as UTF-8', async ({ page, request }) => {
    test.setTimeout(240_000)
    const fixture = loadFixture('fixture.json')
    const run = await runFromTestsList(page, request, fixture)
    const logName = `${run.name}.log`

    await page.goto(`/artifacts/${run.executionId}`)
    await expect(page.getByTestId('artifact-drill-page')).toBeVisible({ timeout: 15_000 })
    const row = sectionOf(page, 'Logs').locator('[data-testid="file-row"]').filter({ hasText: logName })
    await expect(row, `the Logs section lists ${logName}`).toHaveCount(1)

    const answered = page.waitForResponse((response) => response.url().includes('/artifacts/content/'))
    const handed = page.waitForEvent('download', { timeout: 20_000 }).catch(() => null)
    await row.getByRole('button', { name: `Download ${logName}`, exact: true }).click()
    const response = await answered
    expect(response.status(), `the download of ${logName} answered`).toBe(200)
    expectDownloadHeader(response.headers()['content-disposition'], logName)
    const download = await handed
    expect(download, `the browser was handed ${logName}`).not.toBeNull()

    expectRunLog(fs.readFileSync(await download!.path()), fixture, run.name)
    expect(download!.suggestedFilename(), 'the saved file carries the whole name').toBe(logName)
  })

  test('TEXT-3: Download all holds the run log under the name of the Test, as UTF-8', async ({ page, request }) => {
    test.setTimeout(240_000)
    const fixture = loadFixture('fixture.json')
    const run = await runFromTestsList(page, request, fixture)
    const member = `logs/${run.name}.log`

    await page.goto(`/artifacts/${run.executionId}`)
    await expect(page.getByTestId('artifact-drill-page')).toBeVisible({ timeout: 15_000 })
    const answered = page.waitForResponse((response) => response.url().includes('/artifacts/zip'))
    const handed = page.waitForEvent('download', { timeout: 20_000 })
    await page.getByTestId('artifact-download-all').click()
    const response = await answered
    expect(response.status(), 'Download all answered').toBe(200)
    const download = await handed
    expect(download.suggestedFilename()).toMatch(/\.zip$/)
    const archive = fs.readFileSync(await download.path())

    expect(zipEntryNames(archive), 'the archive names the log after the Test').toContain(member)
    expectRunLog(readZipEntry(archive, member), fixture, run.name)

    const namePart = archiveNamePart(run.name)
    expect(namePart.startsWith('Grüße-測試-'), `the archive name keeps the letters: ${namePart}`).toBe(true)
    const saved = download.suggestedFilename()
    expect(saved, 'the saved archive is named after the run').toMatch(
      new RegExp(`^\\d{8}-\\d{6}-${escapeRegExp(namePart)}\\.zip$`),
    )
    expectDownloadHeader(response.headers()['content-disposition'], saved)
  })

  for (const scenario of [
    { id: 'TEXT-4', title: 'a block named with the text keeps its Name through export and import', named: false },
    { id: 'TEXT-5', title: 'a Test named with the text is exported and imported back', named: true },
  ]) {
    test(`${scenario.id}: ${scenario.title}`, async ({ page, request }) => {
      test.setTimeout(240_000)
      const fixture = loadFixture('fixture.json')
      if (!scenario.named) fixture.name = 'Text round trip'
      const logId = nodeByName(fixture, TEXT).id as string
      const pythonId = nodeByDescription(fixture, 'Print the text').id as string
      const script = nodeByDescription(fixture, 'Print the text').data.config.values.script as string
      expect(script).toContain(TEXT)

      await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
      let testId = await importFixtureTest(page, fixture, { injectSsh: true, rejectRepairs: true })
      created.push(testId)
      const name = (await getTest(request, testId)).name as string

      for (const format of ['yaml', 'json'] as const) {
        await test.step(`${format}: exported from the Tests list, deleted, imported back`, async () => {
          const file = await exportFromTestsList(page, testId, name, format)
          const fileName = exportFileName(name, format)
          expect(fileName.startsWith(scenario.named ? 'Grüße-測試-' : 'Text-round-trip-'), fileName).toBe(true)
          expectDownloadHeader(file.header, fileName)
          expect(file.filename.endsWith(`.${format}`), `the export is a ${format} file: ${file.filename}`).toBe(true)
          // A fatal decoder throws on the first byte that is not UTF-8.
          const text = new TextDecoder('utf-8', { fatal: true }).decode(file.bytes)
          if (format === 'json') {
            const exported = JSON.parse(text) as Json
            expect(nodeByName(exported, TEXT).id).toBe(logId)
          }

          await deleteTest(request, testId)
          testId = await importFromTestsList(page, file, name)
          created.push(testId)

          const stored = await getTest(request, testId)
          expect(stored.name).toBe(name)
          const nodes = stored.workflow.nodes as Json[]
          const log = nodes.find((node) => node.id === logId)
          expect(log?.data.label, 'the Log block keeps its Name').toBe(TEXT)
          expect(log?.data.config.values.message, 'the Log block keeps its Message').toBe(TEXT)
          const python = nodes.find((node) => node.id === pythonId)
          expect(python?.data.config.values.script, 'the Python block keeps its script').toBe(script)

          await openTest(page, testId)
          await expect(
            page.getByTestId(`workflow-node-body-${logId}`),
            'the canvas block shows its Name',
          ).toContainText(TEXT)
          expect(file.filename, 'the saved file carries the whole name').toBe(fileName)
        })
      }
    })
  }

  test('TEXT-6: SSH text UTF-8 cannot write fails its block before anything is sent', async ({ page }) => {
    test.setTimeout(240_000)
    const folder = markerFolder()
    const token = randomBytes(6).toString('hex')
    runTokens.push(token)
    const fixture = loadFixture('fixture-unencodable.json', { __DIR__: folder, __RUN__: token })

    for (const leg of LEGS) {
      const expression = nodeByName(fixture, leg.block).data.config.values[leg.field] as string
      expect(expression.slice(1).indexOf(ESCAPE) + 1, `${leg.row}: the character sits at column 7`).toBe(7)
    }
    const legs = LEGS.map((leg) => ({
      ...leg,
      blockId: nodeByName(fixture, leg.block).id as string,
      caughtId: nodeByDescription(fixture, `Caught ${leg.block}`).id as string,
    }))

    const testId = await importValidateAndNavigate(page, fixture, { injectSsh: true, rejectRepairs: true })
    created.push(testId)
    const validation = await validateTest(page.request, testId, 'run')
    expect(validation.status, `validate answered ${validation.status}`).toBe(200)
    expect(validation.errors, JSON.stringify(validation.errors)).toEqual([])

    const status = await startRun(page)
    await finishRun(page, status, UNENCODABLE_BOOKEND)
    const entries = await consoleEntries(page)
    const variables: SessionVariables = await getSessionVariables(page, await getActiveSessionId(page))

    for (const leg of legs) {
      await test.step(`${leg.row}: the block fails with the exact sentence`, async () => {
        const message = refusal(leg.row)
        expect(sessionValue(variables, `${leg.key}_caught`), `${leg.key} was caught`).toBe(true)
        const error = sessionValue(variables, `${leg.key}_error`) as Record<string, unknown>
        expect(error.message).toBe(message)
        expect(error.node, 'the error names the block by its Name').toBe(leg.block)
        expect(error.node_id).toBe(leg.blockId)
        expect(error.element_type).toBe(leg.elementType)
        expectLine(entries, 'ERROR', SYSTEM, `Block '${leg.block}' failed: ${message}`)
        expectLine(entries, 'WARN', 'Log', `unencodable caught ${leg.key}`)
        await expectNodeStatus(page, leg.blockId, 'failed')
        await expectNodeStatus(page, leg.caughtId, 'success')
      })
    }

    await test.step('nothing reached the remote host and the session still runs commands', async () => {
      expect(sessionValue(variables, 'make_code'), 'the marker folder was made').toBe(0)
      expect(sessionValue(variables, 'list_code')).toBe(0)
      expect(sessionValue(variables, 'listing'), 'only the folder made before the four blocks').toBe('?\n')
      expect(sessionValue(variables, 'remove_code')).toBe(0)
      await expectNodeStatus(page, nodeByName(fixture, 'List marker folder').id as string, 'success')
    })
  })

  test('TEXT-7: a block text that holds a character UTF-8 cannot write is refused at save and nothing is stored', async ({
    request,
  }) => {
    const token = randomBytes(6).toString('hex')
    runTokens.push(token)
    const fixture = loadFixture('fixture-unencodable.json', { __DIR__: markerFolder(), __RUN__: token })
    const nodes = fixture.workflow.nodes as Json[]
    /** Where a row's text sits in the request, as the refusal names it. */
    const where = (leg: Leg): string =>
      `workflow.nodes[${nodes.indexOf(nodeByName(fixture, leg.block))}].data.config.values.${leg.field}`
    const testsBefore = await testCount(request)
    const sentIds: string[] = []

    async function expectRefused(
      label: string,
      saved: readonly Leg[],
      named: Leg,
      contentType: ContentType = 'application/json',
    ): Promise<void> {
      const id = randomUUID()
      sentIds.push(id)
      const body = { ...withSavedText(fixture, saved), id, name: `${fixture.name as string} ${label}` }
      for (const leg of saved) {
        expect(nodeByName(body, leg.block).data.config.values[leg.field], `${leg.row} holds the character`).toContain(
          UNENCODABLE,
        )
      }

      const sent = await postTest(request, body, contentType)
      expect(sent.status, `${label}: the save is refused`).toBe(422)
      const answer = sent.answer
      expect(answer.success).toBe(false)
      expect(answer.error.code).toBe('VALIDATION_ERROR')
      expect(answer.error.message).toBe(
        `The request has a character at ${where(named)} that cannot be encoded as UTF-8, so it was refused: remove or replace it`,
      )
      expect(answer.meta.request_id, 'the answer carries the request id').toMatch(UUID)
      expect(sent.requestId).toBe(answer.meta.request_id)
      expect(sent.correlationId).toBe(answer.meta.request_id)
    }

    for (const leg of LEGS) {
      await test.step(`${leg.row}: the save is refused and the answer names the row`, async () => {
        await expectRefused(leg.key, [leg], leg)
      })
    }

    await test.step('all four rows: the answer names the first in document order', async () => {
      const first = LEGS.reduce((earliest, leg) =>
        nodes.indexOf(nodeByName(fixture, leg.block)) < nodes.indexOf(nodeByName(fixture, earliest.block))
          ? leg
          : earliest,
      )
      expect(first.row).toBe('Command')
      await expectRefused('all', LEGS, first)
    })

    const otherTypes = ['text/plain', 'application/octet-stream', 'multipart/form-data; boundary=x', null] as const
    for (const contentType of otherTypes) {
      await test.step(`sent ${contentType === null ? 'with no content type' : `as ${contentType}`}: the same answer`, async () => {
        await expectRefused(contentType?.replace(/[^a-z]+/g, '-') ?? 'untyped', [LEGS[0]], LEGS[0], contentType)
      })
    }

    await test.step('nothing was stored', async () => {
      const listed = await request.get(`${BACKEND_URL}/tests?search=${token}&per_page=100`)
      expect(listed.status()).toBe(200)
      expect((await listed.json()).data, 'the Tests list holds no Test of this run').toEqual([])
      expect(await testCount(request), 'the Tests list holds as many Tests as before').toBe(testsBefore)
      for (const id of sentIds) {
        const read = await request.get(`${BACKEND_URL}/tests/${id}`)
        expect(read.status(), `no Test answers under the id ${id}`).toBe(404)
      }
    })
  })

  test('TEXT-8: a Test named in a script with marks keeps every mark in its export and archive names', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000)
    const fixture = loadFixture('fixture.json')
    fixture.name = MARKED_TEXT
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    const testId = await importFixtureTest(page, fixture, { injectSsh: true, rejectRepairs: true })
    created.push(testId)
    const name = (await getTest(request, testId)).name as string
    expect(name.startsWith(`${MARKED_TEXT} `), `the stored Test is named with the text: ${name}`).toBe(true)

    await test.step('the YAML export is saved under the whole name', async () => {
      const file = await exportFromTestsList(page, testId, name, 'yaml')
      const fileName = exportFileName(name, 'yaml')
      expect(fileName.startsWith('हिंदी-परीक्षण-'), fileName).toBe(true)
      expectDownloadHeader(file.header, fileName)
      expect(file.filename, 'the saved file carries every mark').toBe(fileName)
    })

    const note = 'kept in the archive'
    await createTestDataFolder(request, testId, MARKED_TEXT)
    await uploadTestData(request, testId, MARKED_TEXT, 'note.txt', note)

    await test.step('a Test Data folder downloaded from the sheet is saved under the whole name', async () => {
      const archiveName = `testdata-${archiveNamePart(MARKED_TEXT)}.zip`
      expect(archiveName).toBe('testdata-हिंदी-परीक्षण.zip')
      await openTest(page, testId)
      await openSheet(page)

      const answered = page.waitForResponse((response) => response.url().includes(`/tests/${testId}/testdata/zip`))
      const handed = page.waitForEvent('download', { timeout: 20_000 }).catch(() => null)
      await folderRowOf(page, MARKED_TEXT)
        .getByRole('button', { name: `Download ${MARKED_TEXT}`, exact: true })
        .click()
      const response = await answered
      expect(response.status(), `the download of ${archiveName} answered`).toBe(200)
      expectDownloadHeader(response.headers()['content-disposition'], archiveName)
      const download = await handed
      expect(download, `the browser was handed ${archiveName}`).not.toBeNull()

      const archive = fs.readFileSync(await download!.path())
      expect(readZipEntry(archive, `${MARKED_TEXT}/note.txt`).toString('utf-8')).toBe(note)
      expect(download!.suggestedFilename(), 'the saved archive carries every mark').toBe(archiveName)
    })

    await test.step("the archive of the Test's whole Test Data answers under the whole name", async () => {
      const archiveName = `testdata-${archiveNamePart(name)}.zip`
      expect(archiveName.startsWith('testdata-हिंदी-परीक्षण-'), archiveName).toBe(true)
      const response = await request.get(`${BACKEND_URL}/tests/${testId}/testdata/zip`)
      expect(response.status()).toBe(200)
      expectDownloadHeader(response.headers()['content-disposition'], archiveName)
      expect(readZipEntry(await response.body(), `${MARKED_TEXT}/note.txt`).toString('utf-8')).toBe(note)
    })
  })
})
