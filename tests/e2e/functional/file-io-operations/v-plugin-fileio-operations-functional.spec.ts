/**
 * V-PLUGIN-FILEIO-OPERATIONS-FUNCTIONAL: the eight File I/O operations end to end
 * Design Decisions: FIO-1 (eight operations), FIO-3 (If the file exists, folder
 *   merge, a file destination that is a folder), FIO-4 (UTF-8 text, BOM honored),
 *   FIO-5 (Delete, Ignore missing), FIO-6 (Stats never fails, three output
 *   formats), FIO-7 (List: pattern, depth, size), FIO-8 (Create folder is
 *   idempotent), TDATA-1 (per-test Test Data), TDATA-2 (test data is read-only)
 * REQ: REQ-3.4.1.10, REQ-3.4.3.1, REQ-3.4.3.2, REQ-5.2.4.12
 *
 * One passing workflow chains every operation over the test's own uploaded Test
 * Data and the workbench session's artifacts; three abort workflows each end on
 * one shipped refusal, because a refused Block terminates the run.
 *
 * Pass Criteria:
 *  1. Every fixture imports through POST /tests and validates with zero errors
 *  2. Read returns an uploaded file's exact text, and drops a leading BOM
 *  3. Write creates, Append grows the file, Overwrite replaces it
 *  4. Copy puts a test data file on an artifact path, and merges a test data
 *     folder onto an existing artifact folder without losing what was there
 *  5. Move leaves nothing behind and the target holds the content
 *  6. Delete succeeds on a missing path with Ignore missing, and removes an
 *     existing path
 *  7. Stats reports the real values on a present and on a missing path, in
 *     individual, map and table form, with a checksum that matches the bytes
 *  8. List answers the table envelope and the count for a regular expression,
 *     for subfolders off and on, and with the size column
 *  9. Create folder makes the folder and succeeds again on the second call
 * 10. Write with Fail, a write onto a folder, and a write at a testdata:// path
 *     each fail the Block with the shipped message, stop the run, and leave the
 *     bytes on disk untouched
 *
 * Run: ./scripts/e2e-targeted-local.sh functional/file-io-operations/v-plugin-fileio-operations-functional.spec.ts
 */

import { createHash } from 'crypto'
import fs from 'fs'
import path from 'path'

import { test, expect, type APIRequestContext, type Page } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_URL } from '../../helpers/config'
import { validateTest } from '../../helpers/fn-seed'
import {
  getActiveSessionId,
  getSessionVariables,
  importFixtureTest,
} from '../../helpers/fixture-import'
import { finishRun, finishRunAnyVerdict, getNodeStatuses, startRun } from '../../helpers/k8s-run'
import { getLogLines } from '../../helpers/log-reader'
import {
  createTestDataFolder,
  readTestDataContent,
  readTestDataListing,
  uploadTestData,
} from '../../helpers/testdata'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

interface FixtureNode {
  id: string
  data: { description: string; config: { values: Record<string, unknown> } }
}

function loadFixture(file: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, file), 'utf-8')) as Record<
    string,
    unknown
  >
}

function fixtureNodes(fixture: Record<string, unknown>): FixtureNode[] {
  return (fixture.workflow as { nodes: FixtureNode[] }).nodes
}

/** A parameter value straight out of the fixture, so content and assertion
 *  can never drift apart. */
function configValue(fixture: Record<string, unknown>, nodeId: string, key: string): string {
  const node = fixtureNodes(fixture).find((n) => n.id === nodeId)
  expect(node, `fixture node "${nodeId}" is missing`).toBeTruthy()
  const value = (node as FixtureNode).data.config.values[key]
  expect(typeof value, `${nodeId}.${key} must be a string in the fixture`).toBe('string')
  return value as string
}

// ---------------------------------------------------------------------------
// Test data this suite uploads for itself
// ---------------------------------------------------------------------------

const CUSTOMERS_CSV = 'id,name\n1,Ada\n2,Grace\n'
const BOM_TEXT = 'bom-honored'
const BOM_BYTES = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(BOM_TEXT, 'utf8')])
const ORDERS_JSON = '{"orders": 2}'
const DEEP_TEXT = 'deep-payload'

const BOOKEND = 'fileio-ops-complete'

/** _file_ops._modified: datetime.isoformat() in UTC, so a +00:00 offset. */
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?\+00:00$/

const LIST_COLUMNS = [
  { name: 'name', type: 'string' },
  { name: 'path', type: 'string' },
  { name: 'type', type: 'string' },
  { name: 'modified', type: 'string' },
]
const LIST_COLUMNS_WITH_SIZE = [...LIST_COLUMNS, { name: 'size', type: 'integer' }]
const STAT_COLUMNS = [
  { name: 'exists', type: 'boolean' },
  { name: 'type', type: 'string' },
  { name: 'modified', type: 'string' },
  { name: 'size', type: 'integer' },
  { name: 'checksum', type: 'string' },
]

type SessionVariables = Record<string, { value: unknown; type: string }>
type WaveTable = { columns: Array<{ name: string; type: string }>; rows: unknown[][] }

/** The files the operations workflow reads: two at the root, two under a
 *  two-level folder so the folder copy has something to merge. */
async function seedOperationsTestData(
  request: APIRequestContext,
  testId: string,
): Promise<void> {
  const customers = Buffer.from(CUSTOMERS_CSV, 'utf8')
  const orders = Buffer.from(ORDERS_JSON, 'utf8')
  const deep = Buffer.from(DEEP_TEXT, 'utf8')

  expect(
    await uploadTestData(request, testId, '', 'customers.csv', customers),
    'the upload of customers.csv is reported at its full path',
  ).toEqual({ path: 'customers.csv', size_bytes: customers.length, replaced: false })
  expect(
    await uploadTestData(request, testId, '', 'bom.txt', BOM_BYTES),
    'the upload of bom.txt is reported at its full path',
  ).toEqual({ path: 'bom.txt', size_bytes: BOM_BYTES.length, replaced: false })
  expect(
    await createTestDataFolder(request, testId, 'fixtures'),
    'the folder route echoes the path it created',
  ).toEqual({ path: 'fixtures' })
  expect(
    await uploadTestData(request, testId, 'fixtures', 'orders.json', orders),
    'the upload of orders.json is reported at its full path',
  ).toEqual({ path: 'fixtures/orders.json', size_bytes: orders.length, replaced: false })
  expect(
    await createTestDataFolder(request, testId, 'fixtures/nested'),
    'the folder route echoes the path it created',
  ).toEqual({ path: 'fixtures/nested' })
  expect(
    await uploadTestData(request, testId, 'fixtures/nested', 'deep.txt', deep),
    'the upload of deep.txt is reported at its full path',
  ).toEqual({ path: 'fixtures/nested/deep.txt', size_bytes: deep.length, replaced: false })
}

async function seedCustomersOnly(request: APIRequestContext, testId: string): Promise<void> {
  const customers = Buffer.from(CUSTOMERS_CSV, 'utf8')
  expect(
    await uploadTestData(request, testId, '', 'customers.csv', customers),
    'the upload of customers.csv is reported at its full path',
  ).toEqual({ path: 'customers.csv', size_bytes: customers.length, replaced: false })
}

async function seedNothing(): Promise<void> {
  /* the abort fixtures that never touch Test Data need no files */
}

// ---------------------------------------------------------------------------
// Import, seed, validate, open
// ---------------------------------------------------------------------------

const createdTestIds: string[] = []

async function importSeedAndOpen(
  page: Page,
  fixture: Record<string, unknown>,
  seed: (request: APIRequestContext, testId: string) => Promise<void>,
): Promise<string> {
  await page.request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => {})
  const testId = await importFixtureTest(page, fixture)
  createdTestIds.push(testId)
  await seed(page.request, testId)

  const validation = await validateTest(page.request, testId, 'run')
  expect(validation.status, 'the fixture must validate before it is run').toBe(200)
  expect(
    validation.errors,
    `a malformed fixture is a bug in the fixture. Got: ${JSON.stringify(validation.errors)}`,
  ).toHaveLength(0)

  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)
  return testId
}

// ---------------------------------------------------------------------------
// Reading the run back
// ---------------------------------------------------------------------------

function requireLine(logs: string[], match: (line: string) => boolean, what: string): string {
  const line = logs.find(match)
  expect(line, `${what} never reached the console.\n${logs.join('\n')}`).toBeTruthy()
  return line as string
}

/** One console line of the form "<prefix><absolute path>", asserted on both
 *  ends: the resolved path is machine-specific, its tail is not. */
function requireResolvedLine(
  logs: string[],
  prefix: string,
  suffix: string,
  what: string,
): string {
  const line = requireLine(
    logs,
    (t) => t.startsWith(prefix) && t.endsWith(suffix),
    `"${prefix}...${suffix}" (${what})`,
  )
  expect(line.slice(prefix.length), `${what} must resolve to an absolute path`).toMatch(/^\//)
  return line
}

async function sessionVariables(page: Page): Promise<SessionVariables> {
  return (await getSessionVariables(page, await getActiveSessionId(page))) as SessionVariables
}

function boundValue(vars: SessionVariables, name: string): unknown {
  const entry = vars[name]
  expect(entry, `variable "${name}" was never bound by the run`).toBeTruthy()
  return entry.value
}

function boundTable(vars: SessionVariables, name: string): WaveTable {
  const entry = vars[name]
  expect(entry, `variable "${name}" was never bound by the run`).toBeTruthy()
  expect(entry.type, `"${name}" must land as a table`).toBe('table')
  return entry.value as WaveTable
}

/** The rows with the ISO-8601 modified cell validated and replaced, so the rest
 *  of the row can be asserted verbatim. */
function rowsWithCheckedTimestamp(table: WaveTable, column = 'modified'): unknown[][] {
  const idx = table.columns.findIndex((c) => c.name === column)
  expect(idx, `the ${column} column is missing from the table`).toBeGreaterThanOrEqual(0)
  return table.rows.map((row) => {
    expect(String(row[idx]), `${column} must be ISO-8601 UTC, got "${String(row[idx])}"`).toMatch(
      ISO_UTC,
    )
    return row.map((cell, i) => (i === idx ? '<iso>' : cell))
  })
}

async function dumpOnFailure(page: Page, verdict: string | null, logs: string[]): Promise<void> {
  if (verdict === 'failed') return
  test.info().annotations.push({ type: 'workflow-status', description: verdict ?? 'null' })
  test.info().annotations.push({
    type: 'node-statuses',
    description: JSON.stringify(await getNodeStatuses(page)),
  })
  test.info().annotations.push({ type: 'logs', description: logs.join('\n') })
}

/** A Block the failure cut off never ran: it paints skipped and its marker Log line is absent. */
async function expectNeverRan(page: Page, nodeId: string, logs: readonly string[], marker: string): Promise<void> {
  await expect(
    page.locator(`[data-testid="workflow-node-${nodeId}"]`),
    `"${nodeId}" must not have run`,
  ).toHaveAttribute('data-execution-status', 'skipped')
  expect(logs, `"${nodeId}" printed nothing`).not.toContain(marker)
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe('File I/O operations over Test Data and session artifacts', () => {
  test.afterEach(async ({ request }) => {
    // Deleting the Test cascades to its test data folder (TDATA-1).
    for (const testId of createdTestIds.splice(0)) {
      await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
    }
  })

  test('all eight operations run against uploaded Test Data and the session artifacts', async ({
    page,
  }) => {
    const fixture = loadFixture('operations.fixture.json')
    const journalCreated = configValue(fixture, 'write-journal-create', 'content')
    const journalAppended = configValue(fixture, 'write-journal-append', 'content')
    const journalFinal = configValue(fixture, 'write-journal-replace', 'content')
    const keepText = configValue(fixture, 'write-merge-keep', 'content')
    const movedText = configValue(fixture, 'write-move-source', 'content')

    const movedBytes = Buffer.byteLength(movedText, 'utf8')
    const sha256 = createHash('sha256').update(movedText, 'utf8').digest('hex')
    const md5 = createHash('md5').update(movedText, 'utf8').digest('hex')
    const sha1 = createHash('sha1').update(movedText, 'utf8').digest('hex')

    const keepBytes = Buffer.byteLength(keepText, 'utf8')
    const ordersBytes = Buffer.byteLength(ORDERS_JSON, 'utf8')
    const deepBytes = Buffer.byteLength(DEEP_TEXT, 'utf8')

    const testId = await importSeedAndOpen(page, fixture, seedOperationsTestData)

    await test.step('the Test Data API stored exactly what was uploaded', async () => {
      const body = await readTestDataListing(page.request, testId)
      expect(
        body.entries.map((e) => `${e.kind}:${e.path}`),
        'the flat listing carries both files and folders, sorted by path',
      ).toEqual([
        'file:bom.txt',
        'file:customers.csv',
        'dir:fixtures',
        'dir:fixtures/nested',
        'file:fixtures/nested/deep.txt',
        'file:fixtures/orders.json',
      ])
      expect(body.total_files, 'four files were uploaded').toBe(4)
      expect(body.total_bytes, 'the aggregate counts the uploaded bytes only').toBe(
        Buffer.byteLength(CUSTOMERS_CSV, 'utf8') + BOM_BYTES.length + ordersBytes + deepBytes,
      )
    })

    const status = await startRun(page)
    const logs = await finishRun(page, status, BOOKEND, 180_000)
    const vars = await sessionVariables(page)

    await test.step('every Block ended successful', async () => {
      for (const node of fixtureNodes(fixture)) {
        await expect(
          page.locator(`[data-testid="workflow-node-${node.id}"]`),
          `"${node.data.description}" must end successful`,
        ).toHaveAttribute('data-execution-status', 'success')
      }
    })

    await test.step('Read returns the uploaded text, and drops a leading BOM (FIO-4)', () => {
      expect(
        boundValue(vars, 'csv_content'),
        'Read must hand back the uploaded bytes as text, unchanged',
      ).toBe(CUSTOMERS_CSV)
      expect(
        boundValue(vars, 'bom_content'),
        'the byte-order mark is honored, so it is not part of the content',
      ).toBe(BOM_TEXT)
      // The resolved tail is the test's OWN test data folder: testdata:// is
      // relative to this test and nothing else (TDATA-1).
      requireResolvedLine(
        logs,
        `Read ${CUSTOMERS_CSV.length} characters from `,
        `/${testId}/customers.csv`,
        'the Read of the uploaded CSV',
      )
      requireResolvedLine(
        logs,
        `Read ${BOM_TEXT.length} characters from `,
        `/${testId}/bom.txt`,
        'the Read of the BOM file, counted without the mark',
      )
    })

    await test.step('Write creates, Append grows the file, Overwrite replaces it (FIO-3)', () => {
      expect(
        boundValue(vars, 'journal_appended'),
        'Append to it must keep what was there and add to the end',
      ).toBe(journalCreated + journalAppended)
      expect(
        boundValue(vars, 'journal_replaced'),
        'Replace it must leave nothing of the old content',
      ).toBe(journalFinal)
      requireResolvedLine(
        logs,
        `Wrote ${journalFinal.length} characters to `,
        '/ops/journal.txt',
        'the overwriting Write',
      )
    })

    await test.step('Copy puts a test data file on an artifact path', () => {
      expect(
        boundValue(vars, 'copied_content'),
        'the artifact copy reads back as the test data source',
      ).toBe(CUSTOMERS_CSV)
      requireLine(
        logs,
        (t) =>
          t.startsWith('Copied ') &&
          t.includes(`/${testId}/customers.csv to `) &&
          t.endsWith('/copies/customers.csv'),
        'the file Copy, from this test data folder to the run artifacts',
      )
      requireResolvedLine(
        logs,
        `Read ${CUSTOMERS_CSV.length} characters from `,
        '/copies/customers.csv',
        'the Read of the copy',
      )
    })

    await test.step('Create folder is idempotent (FIO-8)', () => {
      requireResolvedLine(logs, 'Created folder ', '/merge', 'the first Create folder')
      requireResolvedLine(
        logs,
        'Folder already exists: ',
        '/merge',
        'the second Create folder, which is not an error',
      )
    })

    await test.step('Copy merges a test data folder onto an existing folder (FIO-3)', () => {
      requireLine(
        logs,
        (t) =>
          t.startsWith('Copied ') &&
          t.includes(`/${testId}/fixtures to `) &&
          t.endsWith('/merge'),
        'the folder Copy onto the folder that already had an entry',
      )
      const deep = boundTable(vars, 'deep_entries')
      expect(deep.columns, 'the size column is appended when Size is on').toEqual(
        LIST_COLUMNS_WITH_SIZE,
      )
      expect(
        rowsWithCheckedTimestamp(deep),
        'the pre-existing entry and both copied entries all survive the merge',
      ).toEqual([
        ['keep.txt', 'keep.txt', 'file', '<iso>', keepBytes],
        ['nested', 'nested', 'folder', '<iso>', deepBytes],
        ['deep.txt', 'nested/deep.txt', 'file', '<iso>', deepBytes],
        ['orders.json', 'orders.json', 'file', '<iso>', ordersBytes],
      ])
      expect(boundValue(vars, 'deep_count'), 'Count is the number of rows').toBe(4)
    })

    await test.step('List answers the pattern, the depth and the size column (FIO-7)', () => {
      const byPattern = boundTable(vars, 'pattern_entries')
      expect(byPattern.columns, 'no size column when Size is off').toEqual(LIST_COLUMNS)
      expect(
        rowsWithCheckedTimestamp(byPattern),
        'the regular expression matches the entry name only',
      ).toEqual([['orders.json', 'orders.json', 'file', '<iso>']])
      expect(boundValue(vars, 'pattern_count')).toBe(1)

      const flat = boundTable(vars, 'flat_entries')
      expect(flat.columns).toEqual(LIST_COLUMNS)
      expect(
        rowsWithCheckedTimestamp(flat),
        'with Include subfolders off the nested file is not listed',
      ).toEqual([
        ['keep.txt', 'keep.txt', 'file', '<iso>'],
        ['nested', 'nested', 'folder', '<iso>'],
        ['orders.json', 'orders.json', 'file', '<iso>'],
      ])
      expect(boundValue(vars, 'flat_count')).toBe(3)

      requireResolvedLine(logs, 'Listed 1 entries in ', '/merge', 'the pattern List')
      requireResolvedLine(logs, 'Listed 3 entries in ', '/merge', 'the one-level List')
      requireResolvedLine(logs, 'Listed 4 entries in ', '/merge', 'the recursive List')
    })

    await test.step('Move leaves nothing behind and the target holds the content', () => {
      expect(boundValue(vars, 'moved_content'), 'the target reads back as the source did').toBe(
        movedText,
      )
      requireLine(
        logs,
        (t) => t.startsWith('Moved ') && t.endsWith('/move/target.txt'),
        'the Move',
      )
      expect(boundValue(vars, 'missing_exists'), 'the path the file left is gone').toBe(false)
    })

    await test.step('Stats reports the real values, individually (FIO-6)', () => {
      expect(boundValue(vars, 'present_exists')).toBe(true)
      expect(boundValue(vars, 'present_type')).toBe('file')
      expect(String(boundValue(vars, 'present_modified'))).toMatch(ISO_UTC)
      expect(boundValue(vars, 'present_size'), "Size is the file's own bytes").toBe(movedBytes)
      expect(
        boundValue(vars, 'present_checksum'),
        'the checksum is the digest of the bytes on disk',
      ).toBe(sha256)

      expect(boundValue(vars, 'missing_exists')).toBe(false)
      expect(boundValue(vars, 'missing_type'), 'Type is empty when the path is missing').toBe('')
      expect(boundValue(vars, 'missing_modified')).toBe('')
      expect(boundValue(vars, 'missing_size')).toBe(0)
      expect(boundValue(vars, 'missing_checksum')).toBe('')
      requireResolvedLine(
        logs,
        'Reported stats for ',
        '/move/source.txt',
        'Stats on the missing path',
      )
    })

    await test.step('Stats answers one map when Output format is Map (FIO-6)', () => {
      const present = boundValue(vars, 'present_map') as Record<string, unknown>
      expect(Object.keys(present), 'the map carries the chosen keys in order').toEqual([
        'exists',
        'type',
        'modified',
        'size',
        'checksum',
      ])
      expect(present.exists).toBe(true)
      expect(present.type).toBe('file')
      expect(String(present.modified)).toMatch(ISO_UTC)
      expect(present.size).toBe(movedBytes)
      expect(present.checksum).toBe(md5)

      expect(
        boundValue(vars, 'missing_map'),
        'a missing path is not an error: the map reports it as absent',
      ).toEqual({ exists: false, type: '', modified: '', size: 0, checksum: '' })
    })

    await test.step('Stats answers a one-row table when Output format is Table (FIO-6)', () => {
      const present = boundTable(vars, 'present_table')
      expect(present.columns, 'each value gets its own typed column').toEqual(STAT_COLUMNS)
      expect(rowsWithCheckedTimestamp(present)).toEqual([
        [true, 'file', '<iso>', movedBytes, sha1],
      ])

      const missing = boundTable(vars, 'missing_table')
      expect(missing.columns).toEqual(STAT_COLUMNS)
      expect(missing.rows, 'the missing path still answers one row').toEqual([
        [false, '', '', 0, ''],
      ])
    })

    await test.step('Delete succeeds on a missing path and removes an existing one (FIO-5)', () => {
      requireResolvedLine(
        logs,
        'Nothing to delete: ',
        '/never-here.txt',
        'Delete with Ignore missing on',
      )
      requireResolvedLine(
        logs,
        'Deleted ',
        '/copies/customers.csv',
        'the Delete of an existing file',
      )
    })

    await test.step('the session artifacts show what the run left behind and what it removed', async () => {
      const resp = await page.request.get(`${BACKEND_URL}/workbench/session/artifacts`)
      expect(resp.ok(), `GET session artifacts failed: ${resp.status()}`).toBeTruthy()
      const items = ((await resp.json()) as { items: Array<{ path: string; size_bytes: number }> })
        .items
      const byPath = new Map(items.map((i) => [i.path, i.size_bytes]))
      const listed = JSON.stringify([...byPath.keys()])

      expect(byPath.get('ops/journal.txt'), `journal size. Listed: ${listed}`).toBe(
        Buffer.byteLength(journalFinal, 'utf8'),
      )
      expect(byPath.get('merge/keep.txt'), `merged keep.txt. Listed: ${listed}`).toBe(keepBytes)
      expect(byPath.get('merge/orders.json'), `merged orders.json. Listed: ${listed}`).toBe(
        ordersBytes,
      )
      expect(byPath.get('merge/nested/deep.txt'), `merged deep.txt. Listed: ${listed}`).toBe(
        deepBytes,
      )
      expect(byPath.get('move/target.txt'), `the move target. Listed: ${listed}`).toBe(movedBytes)

      expect(byPath.has('move/source.txt'), `the move source must be gone. Listed: ${listed}`).toBe(
        false,
      )
      expect(
        byPath.has('copies/customers.csv'),
        `the deleted copy must be gone. Listed: ${listed}`,
      ).toBe(false)
      expect(byPath.has('never-here.txt'), `nothing was created by Delete. Listed: ${listed}`).toBe(
        false,
      )
    })

    await test.step('the merged artifact serves the test data source bytes', async () => {
      const resp = await page.request.get(
        `${BACKEND_URL}/workbench/session/artifacts/content/merge/orders.json`,
      )
      expect(resp.ok(), `GET merged artifact content failed: ${resp.status()}`).toBeTruthy()
      expect(await resp.text(), 'the merged file carries the test data source bytes').toBe(
        ORDERS_JSON,
      )
    })
  })

  test('Write with Fail the block refuses to replace an existing file', async ({ page }) => {
    const fixture = loadFixture('abort-write-fail.fixture.json')
    const guarded = configValue(fixture, 'write-seed', 'content')
    const refused = configValue(fixture, 'write-refused', 'content')
    const blockName = 'Write refusing to replace'
    const failurePrefix = `Block '${blockName}' failed: `

    await importSeedAndOpen(page, fixture, seedNothing)
    const status = await startRun(page)
    const { verdict, logs } = await finishRunAnyVerdict(page, status, failurePrefix, 60_000)
    await dumpOnFailure(page, verdict, logs)

    await test.step('the run reached the Block and then stopped there', async () => {
      expect(logs, 'the run must reach the guarded Write').toContain('abort-write-fail-reached')
      expect(verdict, `the run must fail.\n${logs.join('\n')}`).toBe('failed')
      expect(logs, 'nothing after the refused Block may run').not.toContain(
        'abort-write-fail-continued',
      )
      await expect(
        page.locator('[data-testid="workflow-node-write-seed"]'),
        'the Write that created the file succeeded',
      ).toHaveAttribute('data-execution-status', 'success')
      await expect(
        page.locator('[data-testid="workflow-node-write-refused"]'),
        'the refused Write reads as failed',
      ).toHaveAttribute('data-execution-status', 'failed')
      await expectNeverRan(page, 'log-after', logs, 'abort-write-fail-continued')
    })

    await test.step('the refusal is the shipped message, at ERROR level', async () => {
      const line = requireResolvedLine(
        logs,
        `${failurePrefix}File exists and if_exists=fail: `,
        '/guard/target.txt',
        'the write-fail refusal',
      )
      expect(
        (await getLogLines(page)).some((l) => l.startsWith('[ERROR]') && l.includes(line)),
        'a Block refusal is reported at ERROR level',
      ).toBeTruthy()
    })

    await test.step('the file on disk still holds what the first Write put there', async () => {
      const resp = await page.request.get(
        `${BACKEND_URL}/workbench/session/artifacts/content/guard/target.txt`,
      )
      expect(resp.ok(), `GET guarded artifact failed: ${resp.status()}`).toBeTruthy()
      const text = await resp.text()
      expect(text, 'Fail the block must not touch the file').toBe(guarded)
      expect(text, 'the refused content must not be on disk').not.toContain(refused)
    })
  })

  test('a Write whose destination is an existing folder is refused', async ({ page }) => {
    const fixture = loadFixture('abort-destination-folder.fixture.json')
    const blockName = 'Write onto a folder'
    const failurePrefix = `Block '${blockName}' failed: `

    await importSeedAndOpen(page, fixture, seedNothing)
    const status = await startRun(page)
    const { verdict, logs } = await finishRunAnyVerdict(page, status, failurePrefix, 60_000)
    await dumpOnFailure(page, verdict, logs)

    await test.step('the run stopped at the Write', async () => {
      expect(logs).toContain('abort-destination-folder-reached')
      expect(verdict, `the run must fail.\n${logs.join('\n')}`).toBe('failed')
      expect(logs).not.toContain('abort-destination-folder-continued')
      await expect(
        page.locator('[data-testid="workflow-node-create-blocking-folder"]'),
        'the folder was created first',
      ).toHaveAttribute('data-execution-status', 'success')
      await expect(
        page.locator('[data-testid="workflow-node-write-onto-folder"]'),
      ).toHaveAttribute('data-execution-status', 'failed')
      await expectNeverRan(page, 'log-after', logs, 'abort-destination-folder-continued')
    })

    await test.step('the refusal is the shipped message (FIO-3)', () => {
      requireResolvedLine(
        logs,
        `${failurePrefix}Destination is a folder: `,
        '/blocked',
        'the destination-is-a-folder refusal',
      )
    })

    await test.step('the folder is still a folder', async () => {
      const resp = await page.request.get(
        `${BACKEND_URL}/workbench/session/artifacts/content/blocked`,
      )
      expect(
        resp.status(),
        'a folder is not servable as a file, so the refused Write created nothing',
      ).toBe(404)
    })
  })

  test('a Write targeting a testdata:// path is refused as read-only', async ({ page }) => {
    const fixture = loadFixture('abort-testdata-write.fixture.json')
    const blockName = 'Write onto test data'
    const readOnly =
      'testdata:// paths are read-only. Cannot write, move, or delete testdata files.'
    const failurePrefix = `Block '${blockName}' failed: `

    const testId = await importSeedAndOpen(page, fixture, seedCustomersOnly)
    const status = await startRun(page)
    const { verdict, logs } = await finishRunAnyVerdict(page, status, failurePrefix, 60_000)
    await dumpOnFailure(page, verdict, logs)

    await test.step('the run stopped at the Write', async () => {
      expect(logs).toContain('abort-testdata-write-reached')
      expect(verdict, `the run must fail.\n${logs.join('\n')}`).toBe('failed')
      expect(logs).not.toContain('abort-testdata-write-continued')
      await expect(
        page.locator('[data-testid="workflow-node-write-testdata"]'),
      ).toHaveAttribute('data-execution-status', 'failed')
      await expectNeverRan(page, 'log-after', logs, 'abort-testdata-write-continued')
    })

    await test.step('the refusal is the shipped read-only sentence, verbatim (TDATA-2)', () => {
      requireLine(logs, (t) => t === `${failurePrefix}${readOnly}`, 'the read-only refusal')
    })

    await test.step('the uploaded file is untouched', async () => {
      expect(
        await readTestDataContent(page.request, testId, 'customers.csv'),
        'no Block may change a test data file',
      ).toBe(CUSTOMERS_CSV)
    })
  })
})
