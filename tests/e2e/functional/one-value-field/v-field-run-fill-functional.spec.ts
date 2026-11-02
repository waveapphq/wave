/**
 * V-FIELD-RUN-FILL-FUNCTIONAL: the run fills every field a Block leaves out from its default
 * Wireframe: none (functional)
 * Design Decisions: FIELD-2, FIELD-8
 * REQ: REQ-3.1.1.5, REQ-3.4.2.3, REQ-5.2.7.3
 *
 * Real stack: `http-echo`, `kwok` (direct, per-run namespace from `seedRun(..., 'minimal')` holding
 * one Deployment per test). Each test builds HTTP Request, File I/O (reading Test Data), Excel
 * Parser (reading Test Data) and K8s Rollout Blocks with the field under test left out, three ways:
 * stored as a REST client stores them (no Method, operation or kind at all), compiled from a recipe
 * over the live MCP endpoint, and built through the palette and the Block window. A choice list
 * holds its default from the moment a recipe or the palette creates the Block (FIELD-8); every
 * free-entry field the author leaves out is stored as nothing and filled at run.
 *
 * Pass Criteria:
 * 1. Stored without Method, operation and kind: the Test validates with zero errors, and a
 *    workbench run and a tracked run both pass. HTTP Request sends GET (http-echo echoes `GET`,
 *    the console reads `HTTP GET <url> (timeout: 30s)`), File I/O reads the note's exact text,
 *    Excel Parser reads the sheet's rows, and K8s Rollout restarts the Deployment
 *    (`Rollout restart on deployment.apps/<name>`, Summary `restarted`, the pod template stamped).
 *    GET /tests/{id} after both runs still holds no `method`, `operation` or `kind`.
 * 2. Recipe-built: `create_test_from_recipe` stores each choice list's default (Method `GET`,
 *    operation `read` twice, kind `Deployment`, operation `restart`) and none of the free-entry
 *    fields the steps leave out (timeout, retries, redirects, sheet, range, namespace); the
 *    workbench run passes with the same results.
 * 3. Recipe-built HTTP Request with `timeout: null`: the stored value is null and the run uses
 *    the default, `(timeout: 30s)` (a literal null on an optional setting with a default).
 * 4. Window-built: Blocks dropped from the palette and given only their required free-entry
 *    fields store the choice defaults written at creation and nothing for the fields left out;
 *    the run passes with the same results.
 */

import { test, expect, type APIRequestContext, type Locator, type Page } from '../../helpers/playwright-fixtures'
import {
  BACKEND_PORT,
  BACKEND_URL,
  ensureEnvironment,
  HTTP_HEALTH_PORT,
  HTTP_MAIN_PORT,
  HTTP_TARGET_HOST,
  K8S_ADMIN_TOKEN,
  K8S_API_HOST,
  K8S_API_PORT,
  K8S_CA_PEM,
} from '../../helpers/config'
import { leaveExpressionEditor } from '../../helpers/code-editor'
import { exprToggle, paramRow } from '../../helpers/config-sheet'
import { deleteTest, getTest, readFixture, runToken, substitute } from '../../helpers/element-types'
import {
  getActiveSessionId,
  getSessionVariables,
  importFixtureTest,
  sessionTable,
  sessionValue,
  type SessionVariables,
} from '../../helpers/fixture-import'
import { openTest } from '../../helpers/fn-seed'
import { finishRun, runTrackedTest, startRun } from '../../helpers/k8s-run'
import { seedRun, type SeededRun } from '../../helpers/k8s-seed'
import { getLogCopyTexts, type LogEntry } from '../../helpers/log-reader'
import { callTool, enableMcpUntilRestart, resetMcpSettings } from '../../helpers/mcp'
import { resetOwnership } from '../../helpers/ownership'
import {
  createDeployment,
  deploymentRestartLine,
  expectLeftOut,
  httpSendLine,
  restartStamp,
  RUN_FILL_BOOK,
  RUN_FILL_NOTE,
  RUN_FILL_NOTE_TEXT,
  storedBlock,
  uploadRunFillData,
} from '../../helpers/run-fill'
import { runToEnd, saveTest, selectEnvironment } from '../../helpers/workbench'
import { dropUnderLane } from '../canvas-lanes/lanes-helpers'
import { consoleEntriesFromCopy } from '../shell-blocks/shell-helpers'

// One MCP port per stack so host-mode parallel workers never collide.
const MCP_PORT = Number(BACKEND_PORT) + 765

const ECHO_URL = `https://${HTTP_TARGET_HOST}:${HTTP_MAIN_PORT}/echo`
const NULL_TIMEOUT_URL = `${ECHO_URL}?leg=timeout-null`
const HEALTH_URL = `http://${HTTP_TARGET_HOST}:${HTTP_HEALTH_PORT}/health`
const K8S_URL = `https://${K8S_API_HOST}:${K8S_API_PORT}`
const DEFAULT_TIMEOUT = 30

const STORED_IDS = {
  connect: '8e295337-b6c6-4037-89f9-5296988fda82',
  http: 'ab889b98-54a6-4449-9cdc-0fb9181384b5',
  file: 'da65e788-32b6-4709-bf55-1d29e6c84c90',
  excel: '4535a31d-3479-40bf-b8e0-5fd3a53d55f0',
  rollout: '92ddf103-4946-41eb-b1dc-921c84432da2',
} as const
const WINDOW_CONNECT_ID = 'fad7eb61-6ad7-48c7-ba46-bdcd9e0bb6a0'

const PALETTE = {
  rollout: { term: 'rollout', testId: 'palette-item-k8s-rollout' },
  http: { term: 'HTTP', testId: 'palette-item-http-client' },
  file: { term: 'File', testId: 'palette-item-file-io' },
  excel: { term: 'excel', testId: 'palette-item-excel-parser' },
} as const

/** Free-entry fields with a default that no build path below sets. */
const LEFT_OUT = {
  http: ['timeout', 'retry_count', 'retry_delay', 'retry_backoff_factor', 'max_redirects'],
  file: ['max_size_mib', 'content'],
  excel: ['sheet', 'range', 'header_row'],
  rollout: ['timeout', 'namespace', 'to_revision'],
} as const

type Workloads = { stored: string; recipe: string; window: string }
type Echo = { method?: string }
type HistoryLog = { level?: string; source?: string; message?: string }

let run: SeededRun
let workloads: Workloads

function fixtureFor(file: string, workload: string): Record<string, any> {
  const fixture = substitute(readFixture(__dirname, file), {
    __NAMESPACE__: run.namespace,
    __WORKLOAD__: workload,
  })
  fixture.variables.k8s_ca.value = K8S_CA_PEM
  fixture.variables.k8s_admin_token.value = K8S_ADMIN_TOKEN
  return fixture
}

/** Import a fixture, give it its Test Data, and open it on the canvas. */
async function importWithData(page: Page, fixture: Record<string, unknown>): Promise<string> {
  const testId = await importFixtureTest(page, fixture, { injectHttp: true })
  await uploadRunFillData(page.request, testId)
  await openTest(page, testId)
  return testId
}

async function consoleEntries(page: Page): Promise<LogEntry[]> {
  return consoleEntriesFromCopy(await getLogCopyTexts(page))
}

function expectMessage(entries: readonly LogEntry[], message: string): void {
  expect(
    entries.some((entry) => entry.message === message),
    `the console reads "${message}".\n${entries.map((e) => `${e.level} ${e.source}: ${e.message}`).join('\n')}`,
  ).toBeTruthy()
}

/** The four Blocks did their job on the defaults the run filled in. */
async function expectFilledRun(
  request: APIRequestContext,
  vars: SessionVariables,
  messages: readonly LogEntry[],
  workload: string,
  sendUrl: string,
  stampBefore: string | undefined,
): Promise<void> {
  expectMessage(messages, httpSendLine('GET', sendUrl, DEFAULT_TIMEOUT))
  expectMessage(messages, deploymentRestartLine(workload))
  expect(sessionValue(vars, 'note_text'), 'File I/O read the note').toBe(RUN_FILL_NOTE_TEXT)
  const book = sessionTable(vars, 'book_rows')
  expect(book.columns.map((column) => column.name), 'Excel Parser read the header row').toEqual(['id', 'qty'])
  expect(book.rows, 'Excel Parser read the sheet rows').toEqual([
    ['a', 1],
    ['b', 2],
  ])
  const stamp = await restartStamp(request, run.namespace, workload)
  expect(stamp, 'K8s Rollout restarted the Deployment').toBeTruthy()
  expect(stamp, 'the restart is a new one').not.toBe(stampBefore)
}

/** Every non-DEBUG line and the variables of a tracked run. */
async function trackedHistory(
  request: APIRequestContext,
  executionId: string,
): Promise<{ logs: HistoryLog[]; variables: Record<string, unknown> }> {
  const resp = await request.get(`${BACKEND_URL}/executions/history/${executionId}`)
  expect(resp.ok(), `GET /executions/history/${executionId}: ${resp.status()}`).toBeTruthy()
  return (await resp.json()).data as { logs: HistoryLog[]; variables: Record<string, unknown> }
}

function recipeFor(name: string, workload: string): string {
  return [
    'test:',
    `  name: ${name}`,
    '  description: Blocks compiled from a recipe with the field under test left out',
    'variables:',
    `  k8s_token: {type: string, secret: true, value: "${K8S_ADMIN_TOKEN}"}`,
    'flow:',
    '  - block: k8s-connect',
    '    label: Connect Kwok',
    '    settings:',
    `      api_url: "${K8S_URL}"`,
    `      namespace: "${run.namespace}"`,
    '      verify_ssl: false',
    '      token: {expr: "k8s_token"}',
    '    capture:',
    '      session: k8s_session',
    '  - block: http-client',
    '    label: Echo Method Left Out',
    '    settings:',
    `      url: "${ECHO_URL}"`,
    '      verify_ssl: false',
    '    capture:',
    '      status_code: echo_status',
    '      body: echo_body',
    '  - block: http-client',
    '    label: Echo Timeout Null',
    '    settings:',
    `      url: "${NULL_TIMEOUT_URL}"`,
    '      verify_ssl: false',
    '      timeout: null',
    '    capture:',
    '      status_code: null_timeout_status',
    '  - block: file-io',
    '    label: Read Note',
    '    settings:',
    `      path: "testdata://${RUN_FILL_NOTE}"`,
    '    capture:',
    '      content: note_text',
    '  - block: excel-parser',
    '    label: Read Book',
    '    settings:',
    `      workbook: "testdata://${RUN_FILL_BOOK}"`,
    '    capture:',
    '      table: book_rows',
    '  - block: k8s-rollout',
    '    label: Roll Deployment',
    '    settings:',
    '      session: {expr: "k8s_session"}',
    `      name: "${workload}"`,
    '    capture:',
    '      summary: roll_summary',
    '  - block: log',
    '    label: Bookend',
    '    settings:',
    `      message: {expr: "'run-fill-recipe-done'"}`,
    '',
  ].join('\n')
}

// ---------------------------------------------------------------------------
// The Block window
// ---------------------------------------------------------------------------

/** Open the window of a Block on the canvas. */
async function openWindow(page: Page, id: string): Promise<Locator> {
  const sheet = page.locator('[data-testid="element-config-sheet"]')
  await expect(async () => {
    await page.locator(`[data-testid="workflow-node-${id}"] [data-testid="node-configure"]`).dispatchEvent('click')
    await expect(sheet).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 15_000 })
  return sheet
}

async function saveWindow(sheet: Locator): Promise<void> {
  const save = sheet.getByRole('button', { name: 'Save', exact: true })
  await expect(save).toBeEnabled()
  await save.click()
  await expect(sheet).toBeHidden({ timeout: 15_000 })
}

/** Open a collapsed group card of the window. */
async function openGroup(sheet: Locator, name: string): Promise<void> {
  const header = sheet.locator(`[data-testid="group-header-${name}"]`)
  if ((await header.count()) === 0) return
  if ((await header.getAttribute('aria-expanded')) === 'false') await header.click()
  await expect(header).toHaveAttribute('aria-expanded', 'true')
}

/** Type a plain value into a field that is not set and has no default. */
async function typeField(sheet: Locator, name: string, label: string, text: string): Promise<void> {
  const box = paramRow(sheet, name).getByRole('textbox', { name: label, exact: true })
  await box.fill(text)
  await expect(box).toHaveValue(text)
}

/** Switch a field to an expression and type it. */
async function typeExpression(sheet: Locator, name: string, expression: string): Promise<void> {
  const toggle = exprToggle(sheet, name)
  await toggle.click()
  await expect(toggle).toHaveAttribute('data-state', 'on')
  const editor = sheet.locator(`[data-testid="param-input-${name}"] .cm-content`)
  await editor.click()
  await sheet.page().keyboard.insertText(expression)
  await expect(editor).toHaveText(expression)
  await leaveExpressionEditor(editor)
}

/** Bind an output to a variable the save creates. */
async function bindOutput(sheet: Locator, outputLabel: string, name: string): Promise<void> {
  const assign = sheet.getByRole('combobox', { name: `Assign ${outputLabel} to`, exact: true })
  await assign.fill(name)
  await expect(sheet.page().getByTestId('output-new-var-hint').filter({ hasText: `“${name}”` })).toBeVisible()
  await assign.press('Escape')
  await expect(sheet).toBeVisible()
}

// ---------------------------------------------------------------------------

test.describe('V-FIELD-RUN-FILL-FUNCTIONAL: the run fills what a Block leaves out', () => {
  const created: string[] = []

  test.beforeAll(async ({ request }) => {
    test.setTimeout(180_000)
    run = await seedRun(request, 'minimal')
    workloads = {
      stored: 'zz-11541-s3-fill-stored',
      recipe: 'zz-11541-s3-fill-recipe',
      window: 'zz-11541-s3-fill-window',
    }
    for (const name of Object.values(workloads)) await createDeployment(request, run.namespace, name)
  })

  test.afterEach(async ({ page, request }) => {
    await resetMcpSettings(page)
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    for (const id of created.splice(0)) await deleteTest(request, id)
  })

  test.afterAll(async () => {
    await run?.teardown()
  })

  test('Blocks stored without Method, operation and kind run on the defaults', async ({ page, request }) => {
    test.setTimeout(240_000)
    const testId = await importWithData(page, fixtureFor('fixture-run-fill.json', workloads.stored))
    created.push(testId)
    const stampBefore = await restartStamp(request, run.namespace, workloads.stored)

    await test.step('the stored Blocks hold no Method, operation or kind', async () => {
      const stored = await getTest(request, testId)
      expectLeftOut(storedBlock(stored, STORED_IDS.http), ['method', ...LEFT_OUT.http])
      expectLeftOut(storedBlock(stored, STORED_IDS.file), ['operation'])
      expectLeftOut(storedBlock(stored, STORED_IDS.excel), ['operation'])
      expectLeftOut(storedBlock(stored, STORED_IDS.rollout), ['kind', 'operation', ...LEFT_OUT.rollout])
    })

    await test.step('a workbench run passes on the defaults the run fills in', async () => {
      const status = await startRun(page)
      await finishRun(page, status, 'run-fill-stored-done')
      const vars = await getSessionVariables(page, await getActiveSessionId(page))
      expect(sessionValue(vars, 'echo_status')).toBe(200)
      expect((JSON.parse(String(sessionValue(vars, 'echo_body'))) as Echo).method, 'http-echo got GET').toBe('GET')
      await expectFilledRun(request, vars, await consoleEntries(page), workloads.stored, ECHO_URL, stampBefore)
    })

    await test.step('a tracked run of the stored Test passes the same way', async () => {
      const stampBeforeTracked = await restartStamp(request, run.namespace, workloads.stored)
      await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
      const tracked = await runTrackedTest(request, testId)
      const history = await trackedHistory(request, tracked.executionId)
      const lines = history.logs.map((line) => line.message ?? '')
      expect(tracked.verdict, `the tracked run passes.\n${lines.join('\n')}`).toBe('passed')
      expect(lines).toContain(httpSendLine('GET', ECHO_URL, DEFAULT_TIMEOUT))
      expect(lines).toContain(deploymentRestartLine(workloads.stored))
      expect((JSON.parse(String(history.variables.echo_body)) as Echo).method).toBe('GET')
      expect(history.variables.note_text).toBe(RUN_FILL_NOTE_TEXT)
      expect(await restartStamp(request, run.namespace, workloads.stored)).not.toBe(stampBeforeTracked)
    })

    await test.step('the runs wrote nothing back: the stored Test still holds no such key', async () => {
      const stored = await getTest(request, testId)
      expectLeftOut(storedBlock(stored, STORED_IDS.http), ['method', 'timeout'])
      expectLeftOut(storedBlock(stored, STORED_IDS.file), ['operation'])
      expectLeftOut(storedBlock(stored, STORED_IDS.excel), ['operation'])
      expectLeftOut(storedBlock(stored, STORED_IDS.rollout), ['kind', 'operation'])
    })
  })

  test('recipe-built Blocks store the choice defaults and nothing for the fields left out', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000)
    await resetOwnership(request)
    await ensureEnvironment(request)
    await enableMcpUntilRestart(page, MCP_PORT)
    const stampBefore = await restartStamp(request, run.namespace, workloads.recipe)

    let testId = ''
    await test.step('create_test_from_recipe creates the Test', async () => {
      const answer = callTool(MCP_PORT, 'create_test_from_recipe', {
        recipe: recipeFor(`zz-11541-s3-run-fill-recipe ${runToken()}`, workloads.recipe),
      })
      expect(answer.isError, JSON.stringify(answer.payload)).toBe(false)
      expect(answer.payload.created, JSON.stringify(answer.payload)).toBe(true)
      testId = String(answer.payload.test_id)
      created.push(testId)
    })
    await resetMcpSettings(page)

    await test.step('the stored Blocks hold each choice default and none of the fields left out', async () => {
      const stored = await getTest(request, testId)
      const http = storedBlock(stored, 'Echo Method Left Out')
      expect(http.data.config.values.method, 'Method holds its default from creation (FIELD-8)').toBe('GET')
      expectLeftOut(http, LEFT_OUT.http)
      const file = storedBlock(stored, 'Read Note')
      expect(file.data.config.values.operation).toBe('read')
      expectLeftOut(file, LEFT_OUT.file)
      const excel = storedBlock(stored, 'Read Book')
      expect(excel.data.config.values.operation).toBe('read')
      expectLeftOut(excel, LEFT_OUT.excel)
      const rollout = storedBlock(stored, 'Roll Deployment')
      expect(rollout.data.config.values.kind).toBe('Deployment')
      expect(rollout.data.config.values.operation).toBe('restart')
      expectLeftOut(rollout, LEFT_OUT.rollout)
      const nullTimeout = storedBlock(stored, 'Echo Timeout Null')
      expect(nullTimeout.data.config.values, 'the literal null is stored as given').toHaveProperty('timeout', null)
    })

    await uploadRunFillData(request, testId)
    await openTest(page, testId)
    const status = await startRun(page)
    await finishRun(page, status, 'run-fill-recipe-done')
    const vars = await getSessionVariables(page, await getActiveSessionId(page))
    const messages = await consoleEntries(page)

    await test.step('the run passes: GET with the default timeout, the note, the rows, the restart', async () => {
      expect(sessionValue(vars, 'echo_status')).toBe(200)
      expect((JSON.parse(String(sessionValue(vars, 'echo_body'))) as Echo).method).toBe('GET')
      await expectFilledRun(request, vars, messages, workloads.recipe, ECHO_URL, stampBefore)
    })

    await test.step('timeout: null runs on the default 30', () => {
      expect(sessionValue(vars, 'null_timeout_status')).toBe(200)
      expectMessage(messages, httpSendLine('GET', NULL_TIMEOUT_URL, DEFAULT_TIMEOUT))
    })
  })

  test('window-built Blocks store the creation values and nothing for the fields left out', async ({
    page,
    request,
  }) => {
    test.setTimeout(300_000)
    const testId = await importWithData(page, fixtureFor('fixture-run-fill-window.json', workloads.window))
    created.push(testId)
    const stampBefore = await restartStamp(request, run.namespace, workloads.window)
    const ids = { rollout: '', http: '', file: '', excel: '' }

    await test.step('K8s Rollout: the session and the workload name only', async () => {
      ids.rollout = await dropUnderLane(page, WINDOW_CONNECT_ID, null, PALETTE.rollout)
      const sheet = await openWindow(page, ids.rollout)
      await openGroup(sheet, 'Connection')
      await typeExpression(sheet, 'session', 'k8s_session')
      await typeField(sheet, 'name', 'Name', workloads.window)
      await saveWindow(sheet)
    })

    await test.step('HTTP Request: the URL only', async () => {
      ids.http = await dropUnderLane(page, ids.rollout, null, PALETTE.http)
      const sheet = await openWindow(page, ids.http)
      await typeField(sheet, 'url', 'URL', HEALTH_URL)
      await saveWindow(sheet)
    })

    await test.step('File I/O: the path only, its content bound', async () => {
      ids.file = await dropUnderLane(page, ids.http, null, PALETTE.file)
      const sheet = await openWindow(page, ids.file)
      await typeField(sheet, 'path', 'Path', `testdata://${RUN_FILL_NOTE}`)
      await bindOutput(sheet, 'Content', 'note_text')
      await saveWindow(sheet)
    })

    await test.step('Excel Parser: the workbook only, its table bound', async () => {
      ids.excel = await dropUnderLane(page, ids.file, null, PALETTE.excel)
      const sheet = await openWindow(page, ids.excel)
      await typeField(sheet, 'workbook', 'Workbook', `testdata://${RUN_FILL_BOOK}`)
      await bindOutput(sheet, 'Table', 'book_rows')
      await saveWindow(sheet)
    })

    await test.step('the saved Test holds the creation values and nothing for the fields left out', async () => {
      await saveTest(page)
      const stored = await getTest(request, testId)
      const rollout = storedBlock(stored, ids.rollout)
      expect(rollout.data.config.values).toMatchObject({ kind: 'Deployment', operation: 'restart', name: workloads.window })
      expectLeftOut(rollout, LEFT_OUT.rollout)
      const http = storedBlock(stored, ids.http)
      expect(http.data.config.values).toMatchObject({ method: 'GET', url: HEALTH_URL })
      expectLeftOut(http, LEFT_OUT.http)
      const file = storedBlock(stored, ids.file)
      expect(file.data.config.values).toMatchObject({ operation: 'read', path: `testdata://${RUN_FILL_NOTE}` })
      expectLeftOut(file, LEFT_OUT.file)
      const excel = storedBlock(stored, ids.excel)
      expect(excel.data.config.values).toMatchObject({ operation: 'read', workbook: `testdata://${RUN_FILL_BOOK}` })
      expectLeftOut(excel, LEFT_OUT.excel)
    })

    await test.step('the run passes on the defaults the run fills in', async () => {
      await selectEnvironment(page)
      const outcome = await runToEnd(page)
      const messages = await consoleEntries(page)
      expect(outcome.verdict, messages.map((e) => `${e.level} ${e.source}: ${e.message}`).join('\n')).toBe('passed')
      expect(messages.some((entry) => entry.message.startsWith('HTTP 200 OK (')), 'the health target answered 200').toBeTruthy()
      const vars = await getSessionVariables(page, await getActiveSessionId(page))
      await expectFilledRun(request, vars, messages, workloads.window, HEALTH_URL, stampBefore)
      for (const id of Object.values(ids)) {
        await expect(page.locator(`[data-testid="workflow-node-${id}"]`)).toHaveAttribute(
          'data-execution-status',
          'success',
        )
      }
    })
  })
})
