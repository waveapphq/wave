/**
 * V-MCP-TESTDATA-FUNCTIONAL: the MCP test data tools against a test's own files.
 * Wireframes: none (tool surface; the sheet it writes into is V-TESTDATA-01)
 * Design Decisions: TDATA-12 (the five tools on the same service with the same
 *   messages and the same running-test refusal; exactly one of text or
 *   base64; one testdata:// root per test)
 * REQ: REQ-5.2.7.8, REQ-5.2.7.9, REQ-3.4.3.2
 *
 * Pass Criteria:
 * 1. list_testdata lists a file uploaded through the HTTP API, with the bytes
 *    the upload reported.
 * 2. write_testdata stores text as UTF-8 and base64 as raw bytes; both come
 *    back byte-identical through GET /tests/{id}/testdata/content/{rel}.
 * 3. write_testdata onto an existing name refuses as a finding and leaves the
 *    stored bytes untouched; with replace true it succeeds and the bytes change.
 * 4. write_testdata given both text and base64, or neither, raises the exact
 *    shipped message instead of answering a finding.
 * 5. create_testdata_folder, rename_testdata and delete_testdata each round
 *    trip and the change is visible in the next list_testdata.
 * 6. Everything the tools wrote is what the Test Data sheet renders.
 * 7. While a tracked execution of the test is running, all four write tools
 *    answer their boolean false plus the running-test finding, and the same
 *    call succeeds once the run is terminal.
 * 8. An unknown test reference raises the way get_test does, never a finding.
 * 9. TESTDATA_NOT_FOUND is a warning: it never sets valid false, it names the
 *    literal reference, and it stops once the file exists.
 * 10. The packaged 08-files-testdata example is created from the recipe, warns
 *     for its literal, and runs green once write_testdata supplies the file.
 */

import fs from 'fs'
import path from 'path'
import { test, expect, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, BACKEND_PORT, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { callTool, enableMcpUntilRestart, type McpToolResult, resetMcpSettings } from '../../helpers/mcp'
import { resetOwnership } from '../../helpers/ownership'
import { importFixtureTest } from '../../helpers/fixture-import'
import { readTestDataBytes, uploadTestData } from '../../helpers/testdata'

// One MCP port per stack so host-mode parallel workers never collide.
const MCP_PORT = Number(BACKEND_PORT) + 765

interface Finding {
  step: string
  code: string
  severity: string
  problem: string
  fix: string | null
}

interface Entry {
  path: string
  kind: string
  size_bytes: number
}

function uniqueName(base: string): string {
  return `${base} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function loadFixture(file = 'fixture.json'): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, file), 'utf-8'))
}

async function expectStoredBytes(
  request: APIRequestContext,
  testId: string,
  rel: string,
  expected: Buffer,
): Promise<void> {
  const actual = await readTestDataBytes(request, testId, rel)
  expect(
    actual.equals(expected),
    `${rel} must read back byte-identical. Expected base64 ${expected.toString('base64')}, got ${actual.toString('base64')}`,
  ).toBe(true)
}

// --- MCP result shapes -----------------------------------------------------

function entriesOf(result: McpToolResult): Entry[] {
  expect(result.isError, JSON.stringify(result.payload)).toBe(false)
  return (result.payload.entries ?? []) as Entry[]
}

function pathsOf(entries: Entry[]): string[] {
  return entries.map((entry) => entry.path)
}

/** A refused write tool: the boolean is false and the service message is the finding. */
function expectRefusal(result: McpToolResult, key: string, problem: string): void {
  expect(result.isError, `a refusal is a result, never a raised error: ${JSON.stringify(result.payload)}`).toBe(false)
  expect(result.payload[key], `${key} must be false on a refusal: ${JSON.stringify(result.payload)}`).toBe(false)
  const findings = (result.payload.findings ?? []) as Finding[]
  expect(findings, `one finding carries the refusal: ${JSON.stringify(result.payload)}`).toHaveLength(1)
  expect(findings[0]).toEqual({
    step: 'input',
    code: 'VALIDATION',
    severity: 'error',
    problem,
    fix: null,
  })
}

/** An argument error or an unknown reference: raised, with no result envelope. */
function expectRaised(result: McpToolResult, tool: string, message: string, key?: string): void {
  expect(result.isError, `${tool} must raise, not answer: ${JSON.stringify(result.payload)}`).toBe(true)
  // The transport prefixes the raised text with the tool it was calling.
  const text = String(result.payload.text ?? JSON.stringify(result.payload))
  expect(text, `${tool} must raise "${message}". Got: ${text}`).toContain(tool)
  expect(text.endsWith(`: ${message}`), `${tool} must raise "${message}". Got: ${text}`).toBe(true)
  if (key !== undefined) {
    expect(key in result.payload, `a raise carries no ${key} envelope`).toBe(false)
  }
}

async function pollExecution(
  request: APIRequestContext,
  executionId: string,
  wanted: readonly string[],
  timeout: number,
): Promise<string> {
  let status = ''
  await expect
    .poll(
      async () => {
        const resp = await request.get(`${BACKEND_URL}/executions/${executionId}`)
        status = ((((await resp.json()).data ?? {}) as { status?: string }).status ?? '') as string
        return wanted.includes(status)
      },
      { timeout, message: `execution ${executionId} should reach ${wanted.join(' or ')}` },
    )
    .toBe(true)
  return status
}

async function executionMessages(
  request: APIRequestContext,
  executionId: string,
): Promise<string[]> {
  const resp = await request.get(`${BACKEND_URL}/executions/history/${executionId}`)
  expect(resp.ok(), `GET /executions/history/${executionId} failed: ${resp.status()}`).toBeTruthy()
  const logs = (((await resp.json()).data ?? {}) as { logs?: Array<{ message?: string }> }).logs ?? []
  return logs.map((entry) => entry.message ?? '')
}

// --- fixture payloads ------------------------------------------------------

const UPLOADED = Buffer.from('id,name\n1,Ada\n', 'utf-8')
const TEXT_FIRST = 'greeting,value\nhello,café\n'
const TEXT_REPLACED = 'greeting,value\nbonjour,café au lait\n'
const SCRATCH = 'delete me\n'
// Deliberately not valid UTF-8, so only the base64 path can carry it intact.
const RAW_BYTES = Buffer.from([0x00, 0xff, 0xfe, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const CUSTOMERS_CSV =
  'id,name,email\n1,Ada,ada@example.com\n2,Grace,grace@example.com\n3,Alan,alan@example.com\n'

test.describe('V-MCP-TESTDATA-FUNCTIONAL: the MCP test data tools', () => {
  const created: string[] = []

  test.beforeEach(async ({ request }) => {
    created.length = 0
    await ensureEnvironment(request)
    await resetOwnership(request)
  })

  test.afterEach(async ({ page, request }) => {
    for (const testId of created) {
      await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => {})
    }
    await resetOwnership(request)
    await resetMcpSettings(page)
  })

  test('the five tools round trip against the test that owns the files, and the sheet shows the result', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000)

    const testId = await importFixtureTest(page, loadFixture())
    created.push(testId)
    await enableMcpUntilRestart(page, MCP_PORT)

    await test.step('list_testdata lists a file uploaded through the HTTP API', async () => {
      const uploaded = await uploadTestData(request, testId, '', 'customers.csv', UPLOADED, {
        mimeType: 'text/csv',
      })
      expect(uploaded).toEqual({
        path: 'customers.csv',
        size_bytes: UPLOADED.length,
        replaced: false,
      })

      const listed = callTool(MCP_PORT, 'list_testdata', { test_ref: testId })
      expect(listed.payload.test_id).toBe(testId)
      const entries = entriesOf(listed)
      expect(pathsOf(entries)).toEqual(['customers.csv'])
      expect(entries[0].kind).toBe('file')
      expect(entries[0].size_bytes).toBe(UPLOADED.length)
    })

    await test.step('create_testdata_folder makes the folder the writes need', () => {
      const folder = callTool(MCP_PORT, 'create_testdata_folder', { test_ref: testId, path: 'examples' })
      expect(folder.isError, JSON.stringify(folder.payload)).toBe(false)
      expect(folder.payload).toEqual({ created: true })
    })

    await test.step('write_testdata stores text as UTF-8 and base64 as raw bytes', async () => {
      const asText = callTool(MCP_PORT, 'write_testdata', {
        test_ref: testId,
        path: 'examples/notes.txt',
        content: TEXT_FIRST,
      })
      expect(asText.isError, JSON.stringify(asText.payload)).toBe(false)
      expect(asText.payload).toEqual({
        written: true,
        path: 'examples/notes.txt',
        size_bytes: Buffer.byteLength(TEXT_FIRST, 'utf-8'),
      })
      await expectStoredBytes(request, testId, 'examples/notes.txt', Buffer.from(TEXT_FIRST, 'utf-8'))

      const asBase64 = callTool(MCP_PORT, 'write_testdata', {
        test_ref: testId,
        path: 'examples/bytes.bin',
        content_base64: RAW_BYTES.toString('base64'),
      })
      expect(asBase64.isError, JSON.stringify(asBase64.payload)).toBe(false)
      expect(asBase64.payload).toEqual({
        written: true,
        path: 'examples/bytes.bin',
        size_bytes: RAW_BYTES.length,
      })
      await expectStoredBytes(request, testId, 'examples/bytes.bin', RAW_BYTES)

      // A third file so the delete leg does not consume one of the two above.
      const scratch = callTool(MCP_PORT, 'write_testdata', {
        test_ref: testId,
        path: 'examples/scratch.txt',
        content: SCRATCH,
      })
      expect(scratch.isError, JSON.stringify(scratch.payload)).toBe(false)
      expect(scratch.payload.written).toBe(true)
    })

    await test.step('an existing name is refused without replace and overwritten with it', async () => {
      const refused = callTool(MCP_PORT, 'write_testdata', {
        test_ref: testId,
        path: 'examples/notes.txt',
        content: TEXT_REPLACED,
      })
      expectRefusal(refused, 'written', 'File already exists: examples/notes.txt')
      await expectStoredBytes(
        request,
        testId,
        'examples/notes.txt',
        Buffer.from(TEXT_FIRST, 'utf-8'),
      )

      const replaced = callTool(MCP_PORT, 'write_testdata', {
        test_ref: testId,
        path: 'examples/notes.txt',
        content: TEXT_REPLACED,
        replace: true,
      })
      expect(replaced.isError, JSON.stringify(replaced.payload)).toBe(false)
      expect(replaced.payload.written).toBe(true)
      expect(replaced.payload.size_bytes).toBe(Buffer.byteLength(TEXT_REPLACED, 'utf-8'))
      await expectStoredBytes(
        request,
        testId,
        'examples/notes.txt',
        Buffer.from(TEXT_REPLACED, 'utf-8'),
      )
    })

    await test.step('both content forms, or neither, raise the argument error', () => {
      expectRaised(
        callTool(MCP_PORT, 'write_testdata', {
          test_ref: testId,
          path: 'examples/both.txt',
          content: 'a',
          content_base64: Buffer.from('a').toString('base64'),
        }),
        'write_testdata',
        'Provide exactly one of content or content_base64',
        'written',
      )
      expectRaised(
        callTool(MCP_PORT, 'write_testdata', { test_ref: testId, path: 'examples/neither.txt' }),
        'write_testdata',
        'Provide exactly one of content or content_base64',
        'written',
      )
    })

    await test.step('the folder and every write are what list_testdata reports', () => {
      const entries = entriesOf(callTool(MCP_PORT, 'list_testdata', { test_ref: testId }))
      expect(pathsOf(entries)).toEqual([
        'customers.csv',
        'examples',
        'examples/bytes.bin',
        'examples/notes.txt',
        'examples/scratch.txt',
      ])
      expect(entries.find((entry) => entry.path === 'examples')?.kind).toBe('dir')
      expect(
        entries.some((entry) => entry.path.endsWith('both.txt') || entry.path.endsWith('neither.txt')),
        'a raised argument error stores nothing',
      ).toBe(false)
    })

    await test.step('rename_testdata moves the entry and the listing follows', () => {
      const renamed = callTool(MCP_PORT, 'rename_testdata', {
        test_ref: testId,
        path: 'examples/notes.txt',
        new_path: 'examples/renamed.txt',
      })
      expect(renamed.isError, JSON.stringify(renamed.payload)).toBe(false)
      expect(renamed.payload).toEqual({ renamed: true, path: 'examples/renamed.txt' })

      const paths = pathsOf(entriesOf(callTool(MCP_PORT, 'list_testdata', { test_ref: testId })))
      expect(paths).toContain('examples/renamed.txt')
      expect(paths).not.toContain('examples/notes.txt')
    })

    await test.step('delete_testdata removes the entry and the listing follows', () => {
      const deleted = callTool(MCP_PORT, 'delete_testdata', { test_ref: testId, path: 'examples/scratch.txt' })
      expect(deleted.isError, JSON.stringify(deleted.payload)).toBe(false)
      expect(deleted.payload).toEqual({ deleted: true })

      const paths = pathsOf(entriesOf(callTool(MCP_PORT, 'list_testdata', { test_ref: testId })))
      expect(paths).toEqual([
        'customers.csv',
        'examples',
        'examples/bytes.bin',
        'examples/renamed.txt',
      ])
    })

    await test.step('an unknown test reference raises the way get_test does', () => {
      const missing = `no-such-test-${Math.random().toString(36).slice(2, 10)}`
      expectRaised(
        callTool(MCP_PORT, 'get_test', { test_ref: missing }),
        'get_test',
        `Test '${missing}' not found`,
      )
      expectRaised(
        callTool(MCP_PORT, 'write_testdata', { test_ref: missing, path: 'x.txt', content: 'x' }),
        'write_testdata',
        `Test '${missing}' not found`,
        'written',
      )
      expectRaised(
        callTool(MCP_PORT, 'list_testdata', { test_ref: missing }),
        'list_testdata',
        `Test '${missing}' not found`,
        'entries',
      )
    })

    await test.step('the Test Data sheet renders exactly what the tools left behind', async () => {
      await page.request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => {})
      await page.goto(`/workbench?editTest=${testId}`)
      await page.evaluate(() => localStorage.clear())
      await page.goto(`/workbench?editTest=${testId}`)
      await waitForCanvasLoad(page)

      await page.getByTestId('breadcrumb-testdata-chip').click()
      const sheet = page.getByTestId('testdata-sheet')
      await expect(sheet).toBeVisible()

      const row = (entryPath: string) =>
        sheet.locator(`[data-testid="testdata-row"][data-path="${entryPath}"]`)
      await expect(row('customers.csv')).toHaveAttribute('data-entry-type', 'file')
      await expect(row('examples')).toHaveAttribute('data-entry-type', 'dir')
      await expect(
        row('examples/renamed.txt'),
        'the text write, after its replace and its rename',
      ).toHaveAttribute('data-entry-type', 'file')
      await expect(row('examples/bytes.bin'), 'the base64 write').toHaveAttribute(
        'data-entry-type',
        'file',
      )
      await expect(row('examples/notes.txt'), 'the renamed-away name is gone').toHaveCount(0)
      await expect(row('examples/scratch.txt'), 'the deleted file is gone').toHaveCount(0)
    })
  })

  test('a run in progress refuses every write tool as a finding, and the retry succeeds once it ends', async ({
    page,
    request,
  }) => {
    test.setTimeout(280_000)

    await enableMcpUntilRestart(page, MCP_PORT)

    // A loop of short delays: long enough to hold the test, and it notices a
    // stop between iterations instead of running to the end of one long sleep.
    const name = uniqueName('MCP Test Data Running Guard')
    const recipe = `test:
  name: ${name}
  description: Holds the test in a running state while the write tools are called
  tags: [e2e, testdata]
variables:
  ticks: {type: integer, value: 0}
flow:
  - while:
      label: hold
      conditions: "ticks < 90"
      body:
        - delay: 1000
        - set: {ticks: {expr: "ticks + 1"}}
`
    const createdTest = callTool(MCP_PORT, 'create_test_from_recipe', { recipe })
    expect(createdTest.isError, JSON.stringify(createdTest.payload)).toBe(false)
    expect(createdTest.payload.created, JSON.stringify(createdTest.payload)).toBe(true)
    const testId = String(createdTest.payload.test_id)
    created.push(testId)

    const started = callTool(MCP_PORT, 'start_execution', {
      entity_type: 'test',
      ref: testId,
      environment: E2E_ENV_NAME,
    })
    expect(started.isError, JSON.stringify(started.payload)).toBe(false)
    const executionId = String(started.payload.execution_id)
    await pollExecution(request, executionId, ['running', 'paused'], 60_000)

    const refusal = `Test '${name}' is running; test data cannot be changed until it finishes`

    await test.step('all four write tools answer their boolean false plus the refusal', () => {
      expectRefusal(
        callTool(MCP_PORT, 'write_testdata', { test_ref: testId, path: 'blocked.txt', content: 'nope' }),
        'written',
        refusal,
      )
      expectRefusal(
        callTool(MCP_PORT, 'create_testdata_folder', { test_ref: testId, path: 'blocked' }),
        'created',
        refusal,
      )
      expectRefusal(
        callTool(MCP_PORT, 'rename_testdata', {
          test_ref: testId,
          path: 'blocked.txt',
          new_path: 'moved.txt',
        }),
        'renamed',
        refusal,
      )
      expectRefusal(
        callTool(MCP_PORT, 'delete_testdata', { test_ref: testId, path: 'blocked.txt' }),
        'deleted',
        refusal,
      )
    })

    await test.step('nothing was written while the run held the test', () => {
      expect(pathsOf(entriesOf(callTool(MCP_PORT, 'list_testdata', { test_ref: testId })))).toEqual([])
    })

    await test.step('the same write succeeds once the run reaches a terminal state', async () => {
      // Best effort: the loop also ends on its own, so a stop that lands after
      // the last iteration is not a failure of what is under test here.
      await request.put(`${BACKEND_URL}/executions/${executionId}/stop`).catch(() => {})
      await pollExecution(request, executionId, ['passed', 'failed', 'stopped', 'skipped'], 150_000)

      const written = callTool(MCP_PORT, 'write_testdata', {
        test_ref: testId,
        path: 'blocked.txt',
        content: 'nope',
      })
      expect(written.isError, JSON.stringify(written.payload)).toBe(false)
      expect(written.payload.written, JSON.stringify(written.payload)).toBe(true)
      expect(pathsOf(entriesOf(callTool(MCP_PORT, 'list_testdata', { test_ref: testId })))).toEqual([
        'blocked.txt',
      ])
    })
  })

  test('a missing testdata reference only warns, and the packaged files example runs green once the file is there', async ({
    page,
    request,
  }) => {
    test.setTimeout(280_000)

    await enableMcpUntilRestart(page, MCP_PORT)

    const guide = callTool(MCP_PORT, 'get_recipe_guide', {})
    expect(guide.isError, JSON.stringify(guide.payload)).toBe(false)
    const examples = (guide.payload.examples ?? []) as Array<{ name: string; recipe: string }>
    const packaged = examples.find((example) => example.name === '08-files-testdata')
    expect(
      packaged,
      `08-files-testdata is packaged. Got: ${examples.map((e) => e.name).join(', ')}`,
    ).toBeTruthy()

    const name = uniqueName('Recipe Example - Files and Test Data')
    const recipe = (packaged as { recipe: string }).recipe.replace(/^ {2}name: .*$/m, `  name: ${name}`)
    expect(recipe, 'the example still reads its fixture through testdata://').toContain(
      'testdata://examples/customers.csv',
    )

    const missingReference: Finding = {
      step: 'flow[0].settings.path',
      code: 'TESTDATA_NOT_FOUND',
      severity: 'warning',
      problem: 'testdata file not found: testdata://examples/customers.csv',
      fix: "Upload the file to the test's Test Data or correct the reference",
    }
    const testdataFindings = (result: McpToolResult): Finding[] =>
      ((result.payload.findings ?? result.payload.warnings ?? []) as Finding[]).filter(
        (item) => item.code === 'TESTDATA_NOT_FOUND',
      )

    await test.step('a dry run with no target test warns for the literal without invalidating', () => {
      const verdict = callTool(MCP_PORT, 'validate_recipe', { recipe })
      expect(verdict.isError, JSON.stringify(verdict.payload)).toBe(false)
      expect(testdataFindings(verdict)).toEqual([missingReference])
      expect(
        verdict.payload.valid,
        `a warning never sets valid false: ${JSON.stringify(verdict.payload.findings)}`,
      ).toBe(true)
    })

    let testId = ''
    await test.step('create_test_from_recipe carries the same warning on a successful create', () => {
      const createdTest = callTool(MCP_PORT, 'create_test_from_recipe', { recipe })
      expect(createdTest.isError, JSON.stringify(createdTest.payload)).toBe(false)
      expect(createdTest.payload.created, JSON.stringify(createdTest.payload)).toBe(true)
      testId = String(createdTest.payload.test_id)
      created.push(testId)
      expect(testdataFindings(createdTest)).toEqual([missingReference])
    })

    await test.step('with the target test but no file yet, the warning still stands', () => {
      const verdict = callTool(MCP_PORT, 'validate_recipe', { recipe, test_ref: testId })
      expect(verdict.isError, JSON.stringify(verdict.payload)).toBe(false)
      expect(testdataFindings(verdict)).toEqual([missingReference])
      expect(verdict.payload.valid).toBe(true)
    })

    await test.step('write_testdata supplies the file the reference names', async () => {
      const folder = callTool(MCP_PORT, 'create_testdata_folder', { test_ref: testId, path: 'examples' })
      expect(folder.payload.created, JSON.stringify(folder.payload)).toBe(true)
      const written = callTool(MCP_PORT, 'write_testdata', {
        test_ref: testId,
        path: 'examples/customers.csv',
        content: CUSTOMERS_CSV,
      })
      expect(written.payload.written, JSON.stringify(written.payload)).toBe(true)
      await expectStoredBytes(
        request,
        testId,
        'examples/customers.csv',
        Buffer.from(CUSTOMERS_CSV, 'utf-8'),
      )
    })

    await test.step('the reference now resolves and nothing warns about it', () => {
      const verdict = callTool(MCP_PORT, 'validate_recipe', { recipe, test_ref: testId })
      expect(verdict.isError, JSON.stringify(verdict.payload)).toBe(false)
      expect(
        testdataFindings(verdict),
        `an existing file must not warn: ${JSON.stringify(verdict.payload.findings)}`,
      ).toEqual([])
      expect(verdict.payload.valid).toBe(true)
    })

    await test.step('the example runs end to end against the file the tool wrote', async () => {
      const started = callTool(MCP_PORT, 'start_execution', {
        entity_type: 'test',
        ref: testId,
        environment: E2E_ENV_NAME,
      })
      expect(started.isError, JSON.stringify(started.payload)).toBe(false)
      const executionId = String(started.payload.execution_id)
      const status = await pollExecution(
        request,
        executionId,
        ['passed', 'failed', 'stopped', 'skipped'],
        120_000,
      )
      const messages = await executionMessages(request, executionId)
      if (status !== 'passed') {
        test.info().annotations.push({ type: 'run-logs', description: messages.join('\n') })
      }
      expect(status, 'the packaged files example passes once its fixture is in place').toBe('passed')
      expect(
        messages,
        `the run read the CSV the tool wrote. Got:\n${messages.join('\n')}`,
      ).toContain(
        'Parsed 3 customers from testdata://examples/customers.csv into artifact://reports/customers.json',
      )
    })
  })
})
