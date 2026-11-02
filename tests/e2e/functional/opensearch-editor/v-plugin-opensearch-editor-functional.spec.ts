/**
 * V-PLUGIN-OPENSEARCH-EDITOR-FUNCTIONAL: the OpenSearch Query editor against the real cluster
 * Design Decisions: OS-11, OS-12, OS-13
 * REQ: REQ-3.3.2.5, REQ-3.3.2.6, REQ-5.1.2
 *
 * Pass Criteria:
 * 1. GET-FIELDS: the editor chip's Get fields starts a real pull (answered 202) and the chip goes
 *    Getting fields..., Got N fields, Fields · N, N being the field count `_field_caps` gives for
 *    the index; no toast.
 * 2. REFRESH: after `region` (keyword) is added to the mapping with one document holding it, the
 *    Fields popover does not list it until Refresh fields re-pulls (refresh true, answered 202) and
 *    the chip settles on Fields · N+1; the popover then lists `region`, typing `reg` offers it, and
 *    no toast is raised.
 * 3. FAILED: from the Group by field list of an Aggregate block whose Cluster URL is
 *    `https://127.0.0.1:9479` (nothing listens), Get fields raises exactly one error toast titled
 *    `Could not get fields` whose message is the pull's reason, `Could not connect to OpenSearch at
 *    127.0.0.1:9479: [Errno 111] Connection refused`, and the list footer reads `Could not get
 *    fields. Try again`.
 * 4. The Query editor opened over that sheet shows the chip Could not get fields with the reason as
 *    its tooltip; clicking it tries again and raises exactly one new toast.
 * 5. Once the Cluster URL reaches the cluster, a click on Get fields settles on the index's field
 *    count, with no toast.
 * 6. CHECKS: with the fields loaded, `log.invalid: ERROR` gets an amber wavy underline on `log.invalid`
 *    and the advisory strip `Line 1: Unknown field log.invalid in wave-e2e-<token>-app-logs`; Save and
 *    Run stay enabled.
 * 7. RUN: the text edited to `log.level: "WARN"` and not saved runs from the editor as this block
 *    alone: the INFO line reports 1 result, Total results is 1 and Results holds the one WARN
 *    document; the config row and the saved Test still hold `log.level: "ERROR"` until Save, after
 *    which the saved Test holds the WARN query.
 * 8. STOP: a Query DSL search that takes 3 to 5 s runs from the editor; once it runs on the cluster,
 *    the editor's Stop ends the run and the block stopped, the cluster task is canceled or gone
 *    within 5 s, and no INFO summary line is written.
 * 9. With `wave` and a blank Index pattern, Get indexes raises one toast titled `Could not get
 *    indexes` with `These credentials may not list every index. Type an index pattern they can read,
 *    such as logs-*`, and the footer reads `Could not get indexes. Try again`.
 * 10. With the pattern still blank, the Group by field list shows only the muted line `Fill in Index
 *    pattern to get fields` and starts no pull; the Query editor chip shows Get fields disabled with
 *    that line as its tooltip, and a click on it starts no pull.
 * 11. With `wave` and `wave-e2e-<token>-*`, Get indexes lists exactly the run's indexes.
 * 12. With `wave-limited` and `wave-e2e-*`, Get indexes raises one toast titled `Could not get
 *    indexes` with `These credentials may not read wave-e2e-*. OpenSearch said: <text>`, the text
 *    being what OpenSearch answers that user for the same index listing.
 * 13. NULL CREDENTIAL: on a block whose API Key holds null, Get fields is answered 422 and raises
 *    one toast titled `Could not get fields` with `Cannot resolve API Key: 'api_key' is null`; a
 *    run of the same block fails with `Block 'App logs' failed: 'api_key' is null` and searches
 *    nothing (REQ-3.1.3.21).
 *
 * Needs the stack's `opensearch` service. Every index carries a per-run token and is deleted in
 * afterAll.
 */

import { leaveExpressionEditor } from '../../helpers/code-editor'
import fs from 'fs'
import https from 'node:https'
import path from 'path'

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import {
  getActiveSessionId,
  getSessionVariables,
  importValidateAndNavigate,
  sessionTable,
  sessionValue,
} from '../../helpers/fixture-import'
import { validateTest } from '../../helpers/fn-seed'
import { clearSettledWorkbenchSession } from '../../helpers/k8s-run'
import { selectEnvironment } from '../../helpers/workbench'
import { getNode } from '../../helpers/element-types'
import { setStringParam } from '../../helpers/param-config'
import {
  editPreview,
  clickSuggestFooter,
  dismissSuggestions,
  openSuggestions,
  suggestInput,
  suggestList,
  typeSuggestText,
} from '../../helpers/config-sheet'
import { escapeRegExp, formatEntries, getLogCopyTexts, getLogTexts, type LogEntry } from '../../helpers/log-reader'
import {
  BACKEND_URL,
  CA_CERT_PEM,
  OPENSEARCH_LIMITED_PASSWORD,
  OPENSEARCH_LIMITED_USER,
  OPENSEARCH_PASSWORD,
  OPENSEARCH_PORT,
  OPENSEARCH_TARGET_HOST,
  OPENSEARCH_USER,
} from '../../helpers/config'
import {
  calibrateSlowQuery,
  createOpenSearchIndex,
  deleteOpenSearchIndexes,
  F_LOGS,
  FIXED_FROM_ISO,
  FIXED_TO_ISO,
  MAP_LOGS,
  MAP_SLOW,
  openSearchFieldCount,
  openSearchIndexName,
  openSearchRequest,
  seedOpenSearch,
  slowDocs,
  slowQuery,
  waitForSearchTaskGone,
  waitForSearchTaskRunning,
} from '../../helpers/opensearch-stack'
import { deleteTest, openConfig, saveConfig, saveWorkbench } from '../file-picker/picker'
import { blockSource, consoleEntriesFromCopy, newToken, withToken } from '../shell-blocks/shell-helpers'
import {
  closeConfigSheet,
  closeScriptSheet,
  openScriptSheet,
  runButton,
  saveButton,
  stopButton,
  tablesChip,
  tablesChipStatus,
  tablesPopover,
  workflowStatus,
} from '../python-block/editor-helpers'

const NODE_FIELDS = '5956f724-f92c-402c-9a68-70714798ccd7'
const NODE_APP = '1fb1820b-81f5-4b0e-83df-cd112604bf8e'
const NODE_SLOW = 'e814060d-f346-443d-ad2c-fde6fc161d6a'
const NODE_UNREACHABLE = '5dcb4bff-f793-465f-b0ce-61ebaf5d34ec'
const NODE_INDEXES = '79d64cff-cce6-4baa-9fe0-7dcf8a334c00'
const NODE_LIMITED = '3b96f22d-8e43-4b8e-997d-652a3f885fa1'
const ALL_NODES = [NODE_FIELDS, NODE_APP, NODE_SLOW, NODE_UNREACHABLE, NODE_INDEXES, NODE_LIMITED]

const TOKEN = newToken()
const FIELDS_INDEX = openSearchIndexName(TOKEN, 'fields')
const APP_INDEX = openSearchIndexName(TOKEN, 'app-logs')
const SLOW_INDEX = openSearchIndexName(TOKEN, 'slow')
const RUN_INDEXES = [APP_INDEX, FIELDS_INDEX, SLOW_INDEX].sort()
const RUN_PATTERN = openSearchIndexName(TOKEN, '*')
const LIMITED_PATTERN = 'wave-e2e-*'

const CLUSTER_URL = `https://${OPENSEARCH_TARGET_HOST}:${OPENSEARCH_PORT}`
/** Nothing listens on 9479, inside a shard container as on the host. */
const UNREACHABLE_REASON =
  'Could not connect to OpenSearch at 127.0.0.1:9479: [Errno 111] Connection refused'
const FIELDS_FAILED = 'Could not get fields'
/** Get fields on a block whose API Key holds null, as a run refuses it (REQ-3.1.3.21). */
const NULL_API_KEY_REASON = "Cannot resolve API Key: 'api_key' is null"
const FIELDS_RETRY = 'Could not get fields. Try again'
const INDEXES_FAILED = 'Could not get indexes'
const INDEXES_RETRY = 'Could not get indexes. Try again'
const FILL_IN = 'Fill in Index pattern to get fields'
const EVERY_INDEX_REFUSED =
  'These credentials may not list every index. Type an index pattern they can read, such as logs-*'

const ERROR_QUERY = 'log.level: "ERROR"'
const WARN_QUERY = 'log.level: "WARN"'
const UNKNOWN_QUERY = 'log.invalid: ERROR'
const UNKNOWN_FINDING = `Unknown field log.invalid in ${APP_INDEX}`
const SLOW_PLACEHOLDER = '__SLOW_QUERY__'
const NEW_FIELD = 'region'
const AMBER = 'rgb(245, 158, 11)'

const SOURCE_APP = blockSource('OpenSearch', 'App logs')
const SOURCE_SLOW = blockSource('OpenSearch', 'Slow')
const SECRET_ROWS = ['password', 'api_key', 'bearer_token', 'ca_cert', 'client_cert', 'client_key']
const LOGINS: Record<string, string> = {
  [OPENSEARCH_USER]: OPENSEARCH_PASSWORD,
  [OPENSEARCH_LIMITED_USER]: OPENSEARCH_LIMITED_PASSWORD,
}

/** The one WARN document of F-LOGS, as the Results cells hold it. */
const WARN_ROWS = F_LOGS.filter((doc) => (doc.log as { level: string }).level === 'WARN').map((doc) => [
  doc['@timestamp'],
  'WARN',
  doc.message,
])

/** Only STOP runs the Slow block, so the other tests leave it at one loop pass. */
const IDLE_SLOW_N = 1
const createdTests: string[] = []

interface FixtureNode {
  id: string
  data: { description: string; config: { values: Record<string, unknown> } }
}

interface Fixture {
  name: string
  workflow: { nodes: FixtureNode[]; edges: Array<Record<string, unknown>> }
  [key: string]: unknown
}

/** The fixture with this run's token, the logins and CA from config.ts, and the slow query at `slowN` loop passes. */
function editorFixture(slowN: number): Fixture {
  const raw = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixture.json'), 'utf-8')) as Fixture
  const fixture = withToken(raw, TOKEN)
  expect(fixture.workflow.nodes.map((node) => node.id).sort()).toEqual([...ALL_NODES].sort())
  for (const node of fixture.workflow.nodes) {
    const values = node.data.config.values
    const what = `"${node.data.description}"`
    for (const row of SECRET_ROWS) expect(values[row], `${what} stores no ${row}`).toBe('')
    const username = String(values.username)
    expect(Object.keys(LOGINS), `${what} logs in as a stack user`).toContain(username)
    values.password = LOGINS[username]
    values.ca_cert = CA_CERT_PEM
  }
  const slow = fixture.workflow.nodes.find((node) => node.id === NODE_SLOW)!.data.config.values
  expect(slow.query, 'the slow block carries the placeholder the spec fills').toBe(SLOW_PLACEHOLDER)
  slow.query = JSON.stringify(slowQuery(slowN))
  return fixture
}

async function importEditorTest(page: Page, slowN = IDLE_SLOW_N): Promise<string> {
  const testId = await importValidateAndNavigate(page, editorFixture(slowN) as unknown as Record<string, unknown>, {
    injectHttp: true,
    rejectRepairs: true,
  })
  createdTests.push(testId)
  const validation = await validateTest(page.request, testId, 'run')
  expect(validation.errors, JSON.stringify(validation.errors)).toEqual([])
  expect(validation.warnings, JSON.stringify(validation.warnings)).toEqual([])
  // Expand the console before a sheet can sit over its header.
  await getLogTexts(page)
  await selectEnvironment(page)
  return testId
}

async function openQueryEditor(page: Page, nodeId: string): Promise<{ dialog: Locator; sheet: Locator }> {
  const dialog = await openConfig(page, nodeId)
  const sheet = await openScriptSheet(page, dialog, 'query')
  return { dialog, sheet }
}

function editorContent(sheet: Locator): Locator {
  return sheet.locator('.cm-content').first()
}

function node(page: Page, nodeId: string): Locator {
  return page.getByTestId(`workflow-node-${nodeId}`)
}

/** The loaded chip, which opens the Fields popover. */
function fieldsButton(sheet: Locator): Locator {
  return tablesChip(sheet).getByRole('button', { name: /^(Got \d+ fields?|Fields · \d+)$/ })
}

/** Replace the editor text without the auto-closing brackets and quotes typing would add. */
async function setEditorText(page: Page, sheet: Locator, text: string): Promise<void> {
  await editorContent(sheet).click()
  await page.keyboard.press('Control+a')
  await page.keyboard.press('Delete')
  if (text) await page.keyboard.insertText(text)
  await expect(editorContent(sheet)).toHaveText(text)
  await leaveExpressionEditor(sheet)
  // Back in the editor, caret kept, for the caller's next keys.
  await editorContent(sheet).focus()
}

/** Open the suggestion list at the cursor, asking for it when typing did not. */
async function expectSuggestions(page: Page): Promise<Locator> {
  const list = page.locator('.cm-tooltip-autocomplete')
  if (!(await list.isVisible())) {
    await expect(list)
      .toBeVisible({ timeout: 3_000 })
      .catch(() => page.keyboard.press('Control+Space'))
  }
  await expect(list).toBeVisible({ timeout: 10_000 })
  return list
}

/** Hover a control and read its tooltip, then move the pointer onto the editor, which has none. */
async function expectTooltip(page: Page, trigger: Locator, parking: Locator, text: string): Promise<void> {
  await trigger.hover()
  await expect(page.getByRole('tooltip')).toHaveText(text)
  await parking.hover()
  await expect(page.getByRole('tooltip')).toHaveCount(0)
}

/** Record every state the editor chip passes through, with the label it showed. */
async function recordChip(page: Page): Promise<void> {
  await page.evaluate(() => {
    const element = document.querySelector(
      '[data-testid="value-editor-sheet"] [data-testid="get-tables-chip"]',
    ) as HTMLElement
    const store = window as unknown as {
      __chipLog: Array<{ state: string; label: string }>
      __chipObserver?: MutationObserver
    }
    store.__chipObserver?.disconnect()
    store.__chipLog = []
    const observer = new MutationObserver(() => {
      const state = element.dataset.state ?? ''
      const label = element.querySelector('[data-testid="get-tables-status"]')?.textContent ?? ''
      const last = store.__chipLog[store.__chipLog.length - 1]
      if (last?.state !== state || last?.label !== label) store.__chipLog.push({ state, label })
    })
    observer.observe(element, {
      attributes: true,
      attributeFilter: ['data-state'],
      subtree: true,
      childList: true,
      characterData: true,
    })
    store.__chipObserver = observer
  })
}

async function chipLog(page: Page): Promise<Array<{ state: string; label: string }>> {
  return page.evaluate(
    () => (window as unknown as { __chipLog: Array<{ state: string; label: string }> }).__chipLog,
  )
}

/** The chip went Getting fields..., Got N fields, Fields · N and nothing else. */
async function expectChipPath(page: Page, count: number): Promise<void> {
  const log = await chipLog(page)
  expect(log, JSON.stringify(log)).toEqual([
    { state: 'reading', label: 'Getting fields...' },
    { state: 'done', label: `Got ${count} fields` },
    { state: 'settled', label: `Fields · ${count}` },
  ])
}

interface ToastRecord {
  error: boolean
  title: string
  message: string
}

/** Record every toast raised from now on, with its title and message, even once it has faded. */
async function recordToasts(page: Page): Promise<void> {
  await page.evaluate(() => {
    const store = window as unknown as {
      __toastLog: Array<{ error: boolean; title: string; message: string }>
      __toastObserver?: MutationObserver
    }
    store.__toastObserver?.disconnect()
    store.__toastLog = []
    const seen = new WeakSet<Element>(Array.from(document.querySelectorAll('[data-toast]')))
    const observer = new MutationObserver(() => {
      for (const toast of Array.from(document.querySelectorAll('[data-toast]'))) {
        if (seen.has(toast)) continue
        seen.add(toast)
        store.__toastLog.push({
          error: toast.classList.contains('toast-error'),
          title: toast.querySelector('.font-semibold')?.textContent ?? '',
          message: toast.querySelector('.text-sm.text-muted')?.textContent ?? '',
        })
      }
    })
    observer.observe(document.body, { childList: true, subtree: true })
    store.__toastObserver = observer
  })
}

async function toastLog(page: Page): Promise<ToastRecord[]> {
  return page.evaluate(() => (window as unknown as { __toastLog: ToastRecord[] }).__toastLog)
}

interface PulledLists {
  fields: string[]
  indexes: string[]
}

interface FieldsCalls {
  /** Every Get fields start the page sent: the Index pattern it carried and whether it refreshes. */
  starts: Array<{ index: unknown; refresh: boolean }>
  /** The reason of every pull answered failed. */
  failures: string[]
  /** The lists of every pull answered done or cached. */
  loaded: PulledLists[]
}

function isFieldsStart(url: string, method: string): boolean {
  return method === 'POST' && new URL(url).pathname.endsWith('/opensearch-tools/fields')
}

function listsOf(data: { fields?: Array<{ name: string }>; indexes?: Array<{ name: string }> }): PulledLists {
  return {
    fields: (data.fields ?? []).map((field) => field.name),
    indexes: (data.indexes ?? []).map((index) => index.name),
  }
}

/** Every Get fields request the page sends and how each pull ends. */
function watchFields(page: Page): FieldsCalls {
  const calls: FieldsCalls = { starts: [], failures: [], loaded: [] }
  page.on('request', (request) => {
    if (!isFieldsStart(request.url(), request.method())) return
    const body = request.postDataJSON() as { refresh?: boolean; connection?: { index?: unknown } } | null
    calls.starts.push({ index: body?.connection?.index, refresh: body?.refresh === true })
  })
  page.on('response', async (response) => {
    if (!new URL(response.url()).pathname.includes('/opensearch-tools/fields')) return
    const method = response.request().method()
    const body = (await response.json().catch(() => null)) as {
      data?: {
        status?: string
        cached?: boolean
        error?: string
        fields?: Array<{ name: string }>
        indexes?: Array<{ name: string }>
      }
    } | null
    const data = body?.data
    if (!data) return
    if (method === 'POST' && data.cached) calls.loaded.push(listsOf(data))
    if (method === 'GET' && data.status === 'done') calls.loaded.push(listsOf(data))
    if (method === 'GET' && data.status === 'failed') calls.failures.push(data.error ?? '')
  })
  return calls
}

/** The console lines one block wrote, read from each row's full copy text. */
async function blockLines(page: Page, source: string): Promise<LogEntry[]> {
  return consoleEntriesFromCopy(await getLogCopyTexts(page)).filter((entry) => entry.source === source)
}

/** What OpenSearch answers `wave-limited` for the index listing Get indexes asks for, as `type: reason`. */
function limitedRefusal(): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        host: OPENSEARCH_TARGET_HOST,
        port: Number(OPENSEARCH_PORT),
        method: 'GET',
        path: `/_resolve/index/${encodeURIComponent(LIMITED_PATTERN)}`,
        ca: CA_CERT_PEM,
        rejectUnauthorized: true,
        auth: `${OPENSEARCH_LIMITED_USER}:${OPENSEARCH_LIMITED_PASSWORD}`,
        agent: false,
        timeout: 30_000,
      },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf-8')
          let error: { type?: string; reason?: string } | undefined
          try {
            error = (JSON.parse(body) as { error?: { type?: string; reason?: string } }).error
          } catch {
            error = undefined
          }
          resolve({
            status: response.statusCode ?? 0,
            text: error ? `${error.type}: ${error.reason}` : body,
          })
        })
        response.on('error', reject)
      },
    )
    request.on('timeout', () => request.destroy(new Error('the index listing as wave-limited got no answer')))
    request.on('error', reject)
    request.end()
  })
}

test.describe('V-PLUGIN-OPENSEARCH-EDITOR-FUNCTIONAL: the Query editor against a real OpenSearch (OS-12, OS-13)', () => {
  test.beforeAll(async () => {
    test.setTimeout(180_000)
    await createOpenSearchIndex(APP_INDEX, MAP_LOGS)
    await seedOpenSearch(APP_INDEX, F_LOGS)
    await createOpenSearchIndex(FIELDS_INDEX, MAP_LOGS)
    await seedOpenSearch(FIELDS_INDEX, F_LOGS)
    await createOpenSearchIndex(SLOW_INDEX, MAP_SLOW)
    await seedOpenSearch(SLOW_INDEX, slowDocs())
  })

  test.afterAll(async ({ request }) => {
    // A failed step can leave a run going.
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    while (createdTests.length > 0) {
      await deleteTest(request, createdTests.pop() as string)
    }
    await clearSettledWorkbenchSession(request)
    await deleteOpenSearchIndexes(TOKEN)
  })

  test('OS-12, OS-13 GET-FIELDS and REFRESH: the chip pulls the index field count, and Refresh fields picks up a new mapping field', async ({
    page,
  }) => {
    test.setTimeout(240_000)
    await importEditorTest(page)
    await recordToasts(page)
    const calls = watchFields(page)
    const { dialog, sheet } = await openQueryEditor(page, NODE_FIELDS)
    const chip = tablesChip(sheet)
    await expect(chip).toHaveAttribute('data-state', 'idle')
    await expect(tablesChipStatus(sheet)).toHaveText('Get fields')

    let count = 0
    await test.step('GET-FIELDS: Getting fields..., Got N fields, Fields · N, N from _field_caps', async () => {
      count = await openSearchFieldCount(FIELDS_INDEX)
      expect(count, 'MAP-LOGS maps fields').toBeGreaterThan(0)
      await recordChip(page)
      const started = page.waitForResponse((r) => isFieldsStart(r.url(), r.request().method()))
      await chip.getByRole('button', { name: 'Get fields', exact: true }).click()
      expect((await started).status(), 'a fresh connection starts a real pull').toBe(202)
      await expect(chip).toHaveAttribute('data-state', 'settled', { timeout: 60_000 })
      await expectChipPath(page, count)
      expect(calls.starts).toEqual([{ index: FIELDS_INDEX, refresh: false }])
      await expect.poll(() => calls.loaded.length, { message: 'the pull answered its lists' }).toBe(1)
      expect(calls.loaded[0].fields).toHaveLength(count)
      expect(calls.loaded[0].fields, 'the new field is not mapped yet').not.toContain(NEW_FIELD)
      expect(calls.loaded[0].indexes).toEqual([FIELDS_INDEX])
    })

    const popover = tablesPopover(page)
    const search = popover.getByRole('combobox', { name: 'Search fields' })
    await test.step('REFRESH: a field mapped after the pull is not listed before Refresh fields', async () => {
      await fieldsButton(sheet).click()
      await expect(popover).toBeVisible()
      await search.fill('reg')
      await expect(popover.getByText('No matching fields', { exact: true })).toBeVisible()
      await editorContent(sheet).click()
      await expect(popover).toBeHidden()

      const mapped = await openSearchRequest('PUT', `/${FIELDS_INDEX}/_mapping`, {
        properties: { [NEW_FIELD]: { type: 'keyword' } },
      })
      expect(mapped.status, mapped.text).toBe(200)
      await seedOpenSearch(FIELDS_INDEX, [
        {
          '@timestamp': '2026-09-25T10:03:00.000Z',
          log: { level: 'INFO' },
          message: 'Region set',
          [NEW_FIELD]: 'eu-west-1',
        },
      ])
    })

    await test.step('REFRESH: Refresh fields re-pulls and the count grows by one', async () => {
      const grown = await openSearchFieldCount(FIELDS_INDEX)
      expect(grown, 'the oracle sees the one new field').toBe(count + 1)
      await recordChip(page)
      const refreshed = page.waitForResponse((r) => isFieldsStart(r.url(), r.request().method()))
      await chip.getByRole('button', { name: 'Refresh fields', exact: true }).click()
      expect((await refreshed).status(), 'Refresh starts a new pull').toBe(202)
      expect(calls.starts.slice(1)).toEqual([{ index: FIELDS_INDEX, refresh: true }])
      await expect(chip).toHaveAttribute('data-state', 'settled', { timeout: 60_000 })
      await expectChipPath(page, grown)
      await expect.poll(() => calls.loaded.length, { message: 'the refresh answered its lists' }).toBe(2)
      expect(calls.loaded[1].fields).toHaveLength(grown)
      expect(calls.loaded[1].fields).toContain(NEW_FIELD)
    })

    await test.step('REFRESH: the popover lists region and typing reg offers it', async () => {
      await fieldsButton(sheet).click()
      await expect(popover).toBeVisible()
      await search.fill('reg')
      await expect(popover.getByTestId(`tables-popover-item-${NEW_FIELD}`)).toBeVisible()
      await editorContent(sheet).click()
      await expect(popover).toBeHidden()

      await setEditorText(page, sheet, '')
      await page.keyboard.type('reg')
      const list = await expectSuggestions(page)
      await expect(list.locator('.cm-completionSection')).toHaveText(['Fields'])
      await expect(list.locator('.cm-completionLabel')).toHaveText([NEW_FIELD])
      await leaveExpressionEditor(sheet)
    })

    expect(await toastLog(page), 'a pull that loads raises no toast').toEqual([])
    await closeScriptSheet(page, sheet)
    await closeConfigSheet(page, dialog)
  })

  test('OS-12, OS-13 FAILED: an unreachable cluster fails the pull with one toast per pull, from the Group by field list and the editor chip, and the fixed URL pulls', async ({
    page,
  }) => {
    test.setTimeout(240_000)
    await importEditorTest(page)
    await recordToasts(page)
    const calls = watchFields(page)
    const dialog = await openConfig(page, NODE_UNREACHABLE)
    const failure: ToastRecord = { error: true, title: FIELDS_FAILED, message: UNREACHABLE_REASON }

    await test.step('Get fields from the Group by field list raises one toast with the reason', async () => {
      const groupBy = suggestInput(dialog, 'group_by_field')
      await clickSuggestFooter(page, groupBy, 'Get fields')
      await expect(suggestList(page).getByRole('button', { name: FIELDS_RETRY, exact: true })).toBeVisible({
        timeout: 60_000,
      })
      await expect.poll(() => calls.failures, { message: 'the pull answered failed' }).toEqual([UNREACHABLE_REASON])
      await expect.poll(() => toastLog(page), { message: 'one error toast carries the reason' }).toEqual([failure])
      expect(calls.starts).toHaveLength(1)
      await dismissSuggestions(groupBy)
    })

    await test.step('the editor chip over the sheet shows the failure, and its retry raises exactly one new toast', async () => {
      const sheet = await openScriptSheet(page, dialog, 'query')
      const chip = tablesChip(sheet)
      await expect(chip).toHaveAttribute('data-state', 'failed')
      await expect(tablesChipStatus(sheet)).toHaveText(FIELDS_FAILED)
      const retry = chip.getByRole('button', { name: FIELDS_FAILED, exact: true })
      await expectTooltip(page, retry, editorContent(sheet), UNREACHABLE_REASON)

      await retry.click()
      await expect
        .poll(() => calls.failures, { message: 'the retry answered failed' })
        .toEqual([UNREACHABLE_REASON, UNREACHABLE_REASON])
      await expect(chip).toHaveAttribute('data-state', 'failed')
      await expect.poll(() => toastLog(page), { message: 'the retry raised one toast' }).toEqual([failure, failure])
      expect(calls.starts, 'one pull per click, shared by the sheet and the editor').toHaveLength(2)
      await expectTooltip(page, retry, editorContent(sheet), UNREACHABLE_REASON)
      await closeScriptSheet(page, sheet)
    })

    await test.step('with the Cluster URL fixed, a click on Get fields loads the fields', async () => {
      await setStringParam(dialog, page, 'url', CLUSTER_URL)
      const sheet = await openScriptSheet(page, dialog, 'query')
      const chip = tablesChip(sheet)
      await expect(chip).toHaveAttribute('data-state', 'idle')
      const count = await openSearchFieldCount(APP_INDEX)
      await chip.getByRole('button', { name: 'Get fields', exact: true }).click()
      await expect(chip).toHaveAttribute('data-state', 'settled', { timeout: 60_000 })
      await expect(tablesChipStatus(sheet)).toHaveText(`Fields · ${count}`)
      expect(calls.starts).toHaveLength(3)
      expect(calls.failures, 'the fixed pull did not fail').toHaveLength(2)
      expect(await toastLog(page), 'a pull that loads raises no toast').toEqual([failure, failure])
      await closeScriptSheet(page, sheet)
    })

    await closeConfigSheet(page, dialog)
  })

  test('OS-12 CHECKS and RUN: an unknown field is flagged amber without blocking Save or Run; Run runs the unsaved text and the saved Query changes only on Save', async ({
    page,
  }) => {
    test.setTimeout(300_000)
    const testId = await importEditorTest(page)
    const { dialog, sheet } = await openQueryEditor(page, NODE_APP)
    await expect(editorContent(sheet)).toHaveText(ERROR_QUERY)
    const strip = sheet.getByTestId('value-editor-validation')

    await test.step('the fields load, so the check knows the index fields', async () => {
      const count = await openSearchFieldCount(APP_INDEX)
      await tablesChip(sheet).getByRole('button', { name: 'Get fields', exact: true }).click()
      await expect(tablesChip(sheet)).toHaveAttribute('data-state', /^(done|settled)$/, { timeout: 60_000 })
      await expect(tablesChipStatus(sheet)).toHaveText(new RegExp(`^(Got ${count} fields|Fields · ${count})$`))
    })

    await test.step('CHECKS: log.invalid is underlined amber and named in the strip; Save and Run stay enabled', async () => {
      const checked = page.waitForResponse((r) => {
        if (r.request().method() !== 'POST' || !new URL(r.url()).pathname.endsWith('/opensearch-tools/check')) {
          return false
        }
        const body = r.request().postDataJSON() as { text: string; fields_job_id: string | null }
        return body.text === UNKNOWN_QUERY && body.fields_job_id !== null
      })
      await setEditorText(page, sheet, UNKNOWN_QUERY)
      const answer = (await (await checked).json()) as { data: { issues: Array<{ message: string }> } }
      expect(answer.data.issues.map((issue) => issue.message)).toEqual([UNKNOWN_FINDING])

      const underline = sheet.locator('.cm-content .cm-unknown-variable')
      await expect(underline).toHaveText(['log.invalid'])
      const decoration = await underline.evaluate((element) => {
        const style = getComputedStyle(element)
        return { line: style.textDecorationLine, style: style.textDecorationStyle, color: style.textDecorationColor }
      })
      expect(decoration).toEqual({ line: 'underline', style: 'wavy', color: AMBER })
      await expect(strip).toHaveText(`Line 1: ${UNKNOWN_FINDING}`)
      await expect(strip, 'an unknown field is a warning, not a blocking error').not.toHaveAttribute('role', 'alert')
      await expect(saveButton(sheet)).toBeEnabled()
      await expect(runButton(sheet)).toBeEnabled()
    })

    await test.step('RUN: the unsaved text runs as this block alone and finds the one WARN document', async () => {
      await setEditorText(page, sheet, WARN_QUERY)
      await expect(strip, 'a known field carries no finding').toHaveCount(0, { timeout: 10_000 })
      await runButton(sheet).click()
      await expect(workflowStatus(page)).toHaveAttribute('data-status', 'passed', { timeout: 90_000 })
      const info = new RegExp(
        `^Search ${escapeRegExp(APP_INDEX)} from ${escapeRegExp(FIXED_FROM_ISO)} to ${escapeRegExp(FIXED_TO_ISO)}: 1 result, 1 kept, \\d+\\.\\d{2} s$`,
      )
      let lines: LogEntry[] = []
      await expect
        .poll(
          async () => {
            lines = await blockLines(page, SOURCE_APP)
            return lines.filter((entry) => entry.level === 'INFO').length
          },
          { timeout: 30_000, message: 'the block wrote its INFO line' },
        )
        .toBe(1)
      expect(lines.map((entry) => `${entry.level} ${entry.message}`), formatEntries(lines)).toHaveLength(1)
      expect(lines[0].message, formatEntries(lines)).toMatch(info)

      const variables = await getSessionVariables(page, await getActiveSessionId(page))
      expect(sessionValue(variables, 'os_ok')).toBe(true)
      expect(sessionValue(variables, 'os_total')).toBe(1)
      const rows = sessionTable(variables, 'os_rows')
      expect(rows.columns.map((column) => column.name)).toEqual(['@timestamp', 'log.level', 'message'])
      expect(rows.rows).toEqual(WARN_ROWS)
      await expect(node(page, NODE_APP)).toHaveAttribute('data-execution-status', 'success')
      for (const other of ALL_NODES.filter((id) => id !== NODE_APP)) {
        const status = await node(page, other).getAttribute('data-execution-status')
        expect(status === 'success' || status === 'running', `${other} ran: ${status}`).toBe(false)
      }
    })

    await test.step('RUN: the config row and the saved Test keep the old Query until Save', async () => {
      await expect(editorContent(sheet), 'the editor keeps the unsaved text').toHaveText(WARN_QUERY)
      await expect(editPreview(dialog, 'query')).toHaveValue(ERROR_QUERY)
      const stored = await getNode(page.request, testId, NODE_APP)
      expect(stored.data.config.values.query, 'Run never writes the Query').toBe(ERROR_QUERY)

      await expect(saveButton(sheet)).toBeEnabled()
      await saveButton(sheet).click()
      await expect(saveButton(sheet)).toBeDisabled()
      await expect(editPreview(dialog, 'query')).toHaveValue(WARN_QUERY)
      await closeScriptSheet(page, sheet)
      await saveConfig(dialog)
      await saveWorkbench(page)
      const saved = await getNode(page.request, testId, NODE_APP)
      expect(saved.data.config.values.query, 'Save writes the Query').toBe(WARN_QUERY)
    })
  })

  test('OS-13 NULL CREDENTIAL: an API Key that holds null refuses Get fields by its label, as a run of the block fails on it (I6)', async ({
    page,
  }) => {
    test.setTimeout(180_000)
    const fixture = editorFixture(IDLE_SLOW_N)
    fixture.workflow.nodes.find((candidate) => candidate.id === NODE_APP)!.data.config.values.api_key = null
    const testId = await importValidateAndNavigate(page, fixture as unknown as Record<string, unknown>, {
      injectHttp: true,
    })
    createdTests.push(testId)
    const stored = await getNode(page.request, testId, NODE_APP)
    expect(stored.data.config.values.api_key, 'the saved block holds a null API Key').toBeNull()
    await getLogTexts(page)
    await selectEnvironment(page)
    await recordToasts(page)
    const { dialog, sheet } = await openQueryEditor(page, NODE_APP)

    await test.step('Get fields is refused by the API Key label before any pull starts', async () => {
      const started = page.waitForResponse((response) => isFieldsStart(response.url(), response.request().method()))
      await tablesChip(sheet).getByRole('button', { name: 'Get fields', exact: true }).click()
      const answer = await started
      expect(answer.status(), await answer.text()).toBe(422)
      await expect(tablesChip(sheet)).toHaveAttribute('data-state', 'failed', { timeout: 30_000 })
      await expect
        .poll(() => toastLog(page), { message: 'one error toast names the setting' })
        .toEqual([{ error: true, title: FIELDS_FAILED, message: NULL_API_KEY_REASON }])
    })

    await test.step('a run of the same block fails on the same setting before it sends anything', async () => {
      await runButton(sheet).click()
      await expect(workflowStatus(page)).toHaveAttribute('data-status', 'failed', { timeout: 90_000 })
      await expect(node(page, NODE_APP)).toHaveAttribute('data-execution-status', 'failed')
      const entries = consoleEntriesFromCopy(await getLogCopyTexts(page))
      expect(
        entries.map((entry) => `${entry.level} ${entry.message}`),
        formatEntries(entries),
      ).toContain("ERROR Block 'App logs' failed: 'api_key' is null")
      expect(
        entries.filter((entry) => entry.source === SOURCE_APP && entry.level === 'INFO'),
        'nothing was searched',
      ).toEqual([])
    })

    await closeScriptSheet(page, sheet)
    await closeConfigSheet(page, dialog)
  })

  test('OS-11, OS-12 STOP: Stop from the editor ends the run stopped and the search on the cluster', async ({
    page,
  }) => {
    test.setTimeout(240_000)
    const slowN = (await calibrateSlowQuery(SLOW_INDEX)).n
    await importEditorTest(page, slowN)
    const { dialog, sheet } = await openQueryEditor(page, NODE_SLOW)
    await expect(editorContent(sheet)).toHaveText(JSON.stringify(slowQuery(slowN)))

    await test.step('the slow search runs on the cluster', async () => {
      await runButton(sheet).click()
      await expect(stopButton(sheet)).toBeVisible({ timeout: 20_000 })
      await waitForSearchTaskRunning(SLOW_INDEX)
      await expect(workflowStatus(page)).toHaveAttribute('data-status', 'running')
    })

    await test.step('Stop ends the search on the cluster within 5 s and the run stopped', async () => {
      const clicked = Date.now()
      await stopButton(sheet).click()
      await waitForSearchTaskGone(SLOW_INDEX, 5_000)
      expect(Date.now() - clicked, 'the cluster ended the search within 5 s of Stop').toBeLessThan(5_000)
      await expect(workflowStatus(page)).toHaveAttribute('data-status', 'stopped', { timeout: 10_000 })
      await expect(node(page, NODE_SLOW)).toHaveAttribute('data-execution-status', 'stopped')
      await expect(runButton(sheet)).toBeEnabled({ timeout: 10_000 })
      await expect(stopButton(sheet)).toHaveCount(0)
      const lines = await blockLines(page, SOURCE_SLOW)
      expect(
        lines.filter((entry) => entry.message.startsWith(`Search ${SLOW_INDEX} from `)),
        `the stopped search wrote no summary line\n${formatEntries(lines)}`,
      ).toEqual([])
    })

    await closeScriptSheet(page, sheet)
    await closeConfigSheet(page, dialog)
  })

  test('OS-13 Get indexes: refusal texts for a blank pattern and a pattern the user may not read, the run indexes, and no field pull while the pattern is blank', async ({
    page,
  }) => {
    test.setTimeout(240_000)
    await importEditorTest(page)
    await recordToasts(page)
    const calls = watchFields(page)
    const dialog = await openConfig(page, NODE_INDEXES)
    const indexBox = suggestInput(dialog, 'index')
    const blankRefusal: ToastRecord = { error: true, title: INDEXES_FAILED, message: EVERY_INDEX_REFUSED }

    await test.step('wave with a blank Index pattern: one toast asking for a pattern', async () => {
      await typeSuggestText(indexBox, '')
      await clickSuggestFooter(page, indexBox, 'Get indexes')
      await expect(suggestList(page).getByRole('button', { name: INDEXES_RETRY, exact: true })).toBeVisible({
        timeout: 60_000,
      })
      await expect.poll(() => calls.failures, { message: 'the pull answered failed' }).toEqual([EVERY_INDEX_REFUSED])
      await expect.poll(() => toastLog(page)).toEqual([blankRefusal])
      // An emptied pattern is not set, so the pull carries no index of its own (REQ-3.1.1.5).
      expect(calls.starts).toEqual([{ index: undefined, refresh: false }])
      await dismissSuggestions(indexBox)
    })

    await test.step('Group by field with a blank pattern shows only the Fill in line and pulls nothing', async () => {
      const groupBy = suggestInput(dialog, 'group_by_field')
      const list = await openSuggestions(page, groupBy)
      const fillIn = list.getByText(FILL_IN, { exact: true })
      await expect(fillIn).toBeVisible()
      await expect(fillIn).toHaveClass(/text-muted-foreground/)
      await expect(list.getByRole('button')).toHaveCount(0)
      await expect(list.locator('[cmdk-item]')).toHaveCount(0)
      await fillIn.click()
      await dismissSuggestions(groupBy)
    })

    await test.step('the editor chip is Get fields, disabled, with the Fill in tooltip, and pulls nothing', async () => {
      const sheet = await openScriptSheet(page, dialog, 'query')
      const chip = tablesChip(sheet)
      await expect(chip, 'the failed index pull does not show through').toHaveAttribute('data-state', 'idle')
      const getFields = chip.getByRole('button', { name: 'Get fields', exact: true })
      await expect(getFields).toHaveAttribute('aria-disabled', 'true')
      await expectTooltip(page, getFields, editorContent(sheet), FILL_IN)
      // Playwright refuses to click an aria-disabled button; the click itself is the point.
      await getFields.click({ force: true })
      await expect(chip).toHaveAttribute('data-state', 'idle')
      await closeScriptSheet(page, sheet)
      expect(calls.starts, 'neither the Fill in line nor the disabled chip started a pull').toHaveLength(1)
    })

    await test.step('wave with wave-e2e-<token>-*: the list holds exactly the run indexes', async () => {
      await typeSuggestText(indexBox, RUN_PATTERN)
      await clickSuggestFooter(page, indexBox, 'Get indexes')
      const items = suggestList(page).locator('[cmdk-item]')
      await expect(items).toHaveText(
        RUN_INDEXES.map((name) => new RegExp(`^${escapeRegExp(name)}\\s*index$`)),
        { timeout: 60_000 },
      )
      expect(await items.evaluateAll((elements) => elements.map((element) => element.getAttribute('data-value')))).toEqual(
        RUN_INDEXES,
      )
      expect(calls.starts.slice(1)).toEqual([{ index: RUN_PATTERN, refresh: false }])
      expect(calls.loaded.at(-1)?.indexes).toEqual(RUN_INDEXES)
      expect(await toastLog(page), 'a pull that loads raises no toast').toEqual([blankRefusal])
      await dismissSuggestions(indexBox)
    })

    await closeConfigSheet(page, dialog)

    await test.step('wave-limited with wave-e2e-*: one toast naming the pattern and what OpenSearch said', async () => {
      const refusal = await limitedRefusal()
      expect(refusal.status, refusal.text).toBe(403)
      expect(refusal.text).toMatch(/^security_exception: /)
      const limited = await openConfig(page, NODE_LIMITED)
      const box = suggestInput(limited, 'index')
      await expect(box).toHaveValue(LIMITED_PATTERN)
      await clickSuggestFooter(page, box, 'Get indexes')
      await expect(suggestList(page).getByRole('button', { name: INDEXES_RETRY, exact: true })).toBeVisible({
        timeout: 60_000,
      })
      const message = `These credentials may not read ${LIMITED_PATTERN}. OpenSearch said: ${refusal.text}`
      await expect
        .poll(() => toastLog(page), { message: 'one more toast names the pattern' })
        .toEqual([blankRefusal, { error: true, title: INDEXES_FAILED, message }])
      expect(calls.failures).toEqual([EVERY_INDEX_REFUSED, message])
      await dismissSuggestions(box)
      await closeConfigSheet(page, limited)
    })
  })
})
