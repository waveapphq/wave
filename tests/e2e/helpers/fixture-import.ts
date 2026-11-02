/**
 * Fixture import helpers shared by functional workflow specs.
 *
 * Centralizes the standard "import fixture -> validate -> open in
 * workbench" flow: unique-name
 * suffixing (POST /tests treats duplicate names as an error), the
 * mandatory zero-error /tests/{id}/validate gate, and the
 * localStorage-clean double navigation to /workbench?editTest=<id>.
 */

import { expect, type Locator, type Page } from './playwright-fixtures'
import { waitForCanvasLoad } from './canvas'
import {
  dismissLoadDialogIfPresent,
  openTest,
  rawPersistTest,
  validateTest,
  type ValidateResult,
} from './fn-seed'
import {
  BACKEND_URL,
  ensureEnvironment,
  SSH_TARGET_HOST,
  SSH_FIXTURE_HOST_SENTINEL,
  HTTP_TARGET_HOST,
  HTTP_FIXTURE_HOST_SENTINEL,
} from './config'

/** Options controlling how a fixture is prepared before POST /tests. */
export interface ImportFixtureOptions {
  /** Rewrite connection `host` params (127.0.0.1 -> SSH_TARGET_HOST) with
   *  injectServiceHost so the fixture reaches the compose stack in container-shard
   *  mode. No-op in host mode. */
  injectSsh?: boolean
  /** Rewrite ://127.0.0.1:<stack-port> URLs (ports 9449-9461, 9477-9478, 9480-9481 only) to
   *  HTTP_TARGET_HOST so the fixture reaches the published HTTP/TLS/proxy/kwok,
   *  OpenSearch and tls-lab chain services in container-shard mode. No-op in host mode. */
  injectHttp?: boolean
  /** Fail when POST /tests reports repairs (blocks or connections removed at save). */
  rejectRepairs?: boolean
}

/** Published HTTP-side stack ports (9449-9461), OpenSearch (9477 node, 9478 gateway) and the tls-lab chain (9480, 9481); :8000 and 9479 never match. */
const HTTP_STACK_URL_RE = /:\/\/127\.0\.0\.1:(9449|945\d|946[01]|947[78]|948[01])\b/g

/** Rewrite every `host` key equal to the fixture sentinel (127.0.0.1) to the
 *  stack host (SSH_TARGET_HOST unless given, e.g. SQL_TARGET_HOST). Deep,
 *  immutable. A no-op when the target IS the sentinel (host mode), so host-mode
 *  fixtures stay byte-identical. */
export function injectServiceHost(
  fixture: Record<string, unknown>,
  targetHost: string = SSH_TARGET_HOST,
): Record<string, unknown> {
  if (targetHost === SSH_FIXTURE_HOST_SENTINEL) return fixture
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk)
    if (node && typeof node === 'object') {
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        out[k] = k === 'host' && v === SSH_FIXTURE_HOST_SENTINEL ? targetHost : walk(v)
      }
      return out
    }
    return node
  }
  return walk(fixture) as Record<string, unknown>
}

/** Rewrite every string value's ://127.0.0.1:<port> to HTTP_TARGET_HOST for the
 *  stack-published ports 9449-9461, 9477-9478 and 9480-9481 ONLY. Deep, immutable. A no-op when the
 *  target IS the sentinel (host mode), so host-mode fixtures stay byte-identical. */
export function injectHttpHost(
  fixture: Record<string, unknown>,
  targetHost: string = HTTP_TARGET_HOST,
): Record<string, unknown> {
  if (targetHost === HTTP_FIXTURE_HOST_SENTINEL) return fixture
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk)
    if (node && typeof node === 'object') {
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        out[k] = walk(v)
      }
      return out
    }
    if (typeof node === 'string') {
      return node.replace(HTTP_STACK_URL_RE, `://${targetHost}:$1`)
    }
    return node
  }
  return walk(fixture) as Record<string, unknown>
}

/** Import a fixture via POST /tests under a unique name and return its id.
 *  Fails the test if the import or the zero-error validation gate fails. */
export async function importFixtureTest(
  page: Page,
  fixture: Record<string, unknown>,
  opts: ImportFixtureOptions = {},
): Promise<string> {
  await ensureEnvironment(page.request)

  let prepared = fixture
  if (opts.injectSsh) prepared = injectServiceHost(prepared)
  if (opts.injectHttp) prepared = injectHttpHost(prepared)
  const baseName = (prepared as { name?: string }).name ?? 'Functional Test'
  const uniqueFixture = {
    ...prepared,
    name: `${baseName} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  }

  const createResp = await page.request.post(`${BACKEND_URL}/tests`, {
    data: uniqueFixture,
  })
  const body = await createResp.json().catch(() => null)
  expect(
    createResp.ok(),
    `POST /tests failed: ${createResp.status()} - ${JSON.stringify(body)}`,
  ).toBeTruthy()
  const testId = (body.data?.id || body.id) as string
  if (opts.rejectRepairs) {
    expect(body.repairs ?? [], `POST /tests repaired the fixture: ${JSON.stringify(body.repairs)}`).toEqual([])
  }

  const validateResp = await page.request.post(`${BACKEND_URL}/tests/${testId}/validate`)
  const validateBody = await validateResp.json().catch(() => null)
  expect(
    validateResp.ok(),
    `POST /tests/${testId}/validate failed: ${validateResp.status()} - ${JSON.stringify(validateBody)}`,
  ).toBeTruthy()
  const errors =
    validateBody?.data?.errors ??
    validateBody?.error?.details?.[0]?.errors ??
    validateBody?.errors ??
    []
  expect(
    errors.length,
    `Fixture failed validation. Errors: ${JSON.stringify(errors)}`,
  ).toBe(0)

  return testId
}

/** Clear the draft session, import the fixture, validate it, and open it in
 *  the workbench (localStorage-clean double navigation). Returns the test id. */
export async function importValidateAndNavigate(
  page: Page,
  fixture: Record<string, unknown>,
  opts: ImportFixtureOptions = {},
): Promise<string> {
  await page.request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => {})
  const testId = await importFixtureTest(page, fixture, opts)

  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)
  return testId
}

export interface ImportExpectingErrorsOptions extends ImportFixtureOptions {
  /** Which validation context the returned findings come from. */
  context?: 'load' | 'run' | 'import'
  /** Open the Test on the canvas and dismiss the load-time issues dialog. */
  navigate?: boolean
}

export type ImportedWithErrors = ValidateResult & { testId: string }

/** Import a fixture that is MEANT to fail validation and return the findings.
 *  Persists through the admin bulk route, because POST /tests refuses an
 *  invalid workflow, and asserts nothing about the validate response - the
 *  caller asserts which Blocks and parameters were named. */
export async function importExpectingErrors(
  page: Page,
  fixture: Record<string, unknown>,
  opts: ImportExpectingErrorsOptions = {},
): Promise<ImportedWithErrors> {
  await ensureEnvironment(page.request)
  await page.request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => {})

  let prepared = fixture
  if (opts.injectSsh) prepared = injectServiceHost(prepared)
  if (opts.injectHttp) prepared = injectHttpHost(prepared)

  const source = prepared as {
    name?: string
    workflow?: {
      nodes?: Array<Record<string, unknown>>
      edges?: Array<Record<string, unknown>>
    }
    variables?: Record<string, unknown>
  }
  const baseName = source.name ?? 'Invalid Fixture'
  const testId = await rawPersistTest(page.request, {
    name: `${baseName} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    nodes: source.workflow?.nodes ?? [],
    edges: source.workflow?.edges ?? [],
    variables: source.variables ?? {},
  })

  const result = await validateTest(page.request, testId, opts.context ?? 'run')

  if (opts.navigate !== false) {
    await openTest(page, testId)
    await dismissLoadDialogIfPresent(page)
  }

  return { testId, ...result }
}

/** The active workbench session id (draft or run - same session).
 *  Polls briefly: under CI contention the run can report non-idle a beat before
 *  the backend registers the session, so a single GET can catch a transient null. */
export async function getActiveSessionId(page: Page): Promise<string> {
  let sessionId = ''
  await expect
    .poll(
      async () => {
        const resp = await page.request.get(`${BACKEND_URL}/workbench/session`)
        const body = (await resp.json().catch(() => null)) as
          | { data?: { session_id?: string }; session_id?: string }
          | null
        sessionId = body?.data?.session_id ?? body?.session_id ?? ''
        return sessionId
      },
      { timeout: 15_000, intervals: [100, 250, 500], message: 'expected an active session_id' },
    )
    .toBeTruthy()
  return sessionId
}

/** A session's variables by name, as GET /workbench/{sid}/variables answers them. */
export type SessionVariables = Record<string, { value: unknown; type: string }>

/** A table variable's value: typed columns and the rows under them. */
export type WaveTable = { columns: Array<{ name: string; type: string }>; rows: unknown[][] }

/** The value a session variable holds, asserting the run bound it. */
export function sessionValue(variables: SessionVariables, name: string): unknown {
  expect(variables[name], `variable "${name}" is missing from the session`).toBeTruthy()
  return variables[name].value
}

/** The table a session variable holds, asserting it is typed as a table. */
export function sessionTable(variables: SessionVariables, name: string): WaveTable {
  expect(variables[name]?.type, `"${name}" holds a table`).toBe('table')
  return variables[name].value as WaveTable
}

/** Masked session-variable reads for an active workbench session. */
export async function getSessionVariables(
  page: Page,
  sessionId: string,
): Promise<SessionVariables> {
  const resp = await page.request.get(`${BACKEND_URL}/workbench/${sessionId}/variables`)
  const body = await resp.json().catch(() => null)
  expect(
    resp.ok(),
    `GET /workbench/{sid}/variables failed: ${resp.status()} - ${JSON.stringify(body)}`,
  ).toBeTruthy()
  return body.data.variables
}

/** A list page whose header carries the shared Import dialog. */
export type ImportListRoute = '/tests' | '/suites' | '/regressions' | '/functions' | '/profiles'

/** One file handed to the Import dialog's file input. */
export interface ImportFile {
  name: string
  mimeType: string
  buffer: Buffer
}

/** What the Import dialog's review step said before Import was clicked. */
export interface ImportReview {
  summary: string
  warnings: string[]
  /** Each reviewed item's text, by the item name its row carries. */
  items: Record<string, string>
}

/** Open a list page's Import dialog and choose the file; returns the dialog, not yet validated. */
export async function openImportDialog(
  page: Page,
  route: ImportListRoute,
  file: ImportFile,
): Promise<Locator> {
  await page.goto(route)
  const opener = page.locator('[data-testid="import-button"]').first()
  await expect(opener).toBeEnabled({ timeout: 15_000 })
  await opener.click()
  return chooseImportFile(page, file)
}

/** Import one file through a list page's Import dialog: Import, choose the file, Validate, Import. */
export async function importThroughListPage(
  page: Page,
  route: ImportListRoute,
  file: ImportFile,
): Promise<ImportReview> {
  return reviewAndImport(await openImportDialog(page, route, file))
}

/** The id of the Test a list-page import stored under `name`, once the Tests list has it. */
export async function importedTestId(page: Page, name: string): Promise<string> {
  let testId = ''
  await expect
    .poll(
      async () => {
        const response = await page.request.get(
          `${BACKEND_URL}/tests?search=${encodeURIComponent(name)}&per_page=100`,
        )
        const rows = ((await response.json().catch(() => null))?.data ?? []) as Array<{
          id: string
          name: string
        }>
        testId = rows.find((entry) => entry.name === name)?.id ?? ''
        return testId
      },
      { timeout: 15_000, message: `the imported Test "${name}" is in the Tests list` },
    )
    .toBeTruthy()
  return testId
}

/** Session variables an http-echo `/retry` probe bound its status code and body to. */
export interface RetryProbe {
  status: string
  body: string
}

/** The probe was the first request with the run's key, so no block sent one before it. */
export function expectNothingSent(variables: SessionVariables, probe: RetryProbe): void {
  expectNothingSentInRun(
    { [probe.body]: sessionValue(variables, probe.body), [probe.status]: sessionValue(variables, probe.status) },
    probe,
  )
}

/** The same proof on a tracked run's variables, which the run history holds as plain values. */
export function expectNothingSentInRun(values: Record<string, unknown>, probe: RetryProbe): void {
  expect(values[probe.body], `the run bound the probe body to "${probe.body}"`).toEqual(expect.any(String))
  expect(
    JSON.parse(String(values[probe.body])),
    'the echo service counts per key: a request sent earlier with the key makes this attempt 2',
  ).toEqual({ attempt: 1, fail_count: 1, message: 'Simulated failure 1/1' })
  expect(values[probe.status], 'the first request with the key fails').toBe(502)
}

/** The open Import dialog with `file` chosen. */
async function chooseImportFile(page: Page, file: ImportFile): Promise<Locator> {
  const dialog = page.locator('[data-testid="import-dialog"]')
  await expect(dialog).toBeVisible()
  await dialog.locator('[data-testid="file-input"]').setInputFiles(file)
  return dialog
}

/** Validate the chosen file, keep what the review said, then Import. */
async function reviewAndImport(dialog: Locator): Promise<ImportReview> {
  await dialog.locator('[data-testid="validate-button"]').click()
  await expect(dialog.locator('[data-testid="review-step"]')).toBeVisible()
  const items: Record<string, string> = {}
  for (const row of await dialog.locator('[data-testid^="item-result-"]').all()) {
    const testId = (await row.getAttribute('data-testid')) ?? ''
    items[testId.slice('item-result-'.length)] = (await row.textContent()) ?? ''
  }
  const review: ImportReview = {
    summary: (await dialog.locator('[data-testid="import-summary"]').textContent())?.trim() ?? '',
    warnings: await dialog.locator('[data-testid="import-item-warning"]').allTextContents(),
    items,
  }
  await dialog.locator('[data-testid="import-button"]').click()
  await expect(dialog).toBeHidden({ timeout: 15_000 })
  return review
}

/** Import one file through the System Variables page's Import dialog. */
export async function importSystemVariables(page: Page, file: ImportFile): Promise<ImportReview> {
  await page.goto('/settings/variables')
  await expect(page.locator('[data-testid="settings-page"][aria-busy="false"]')).toBeVisible({
    timeout: 15_000,
  })
  const opener = page.locator('[data-testid="system-variables-import-btn"]')
  await expect(opener).toBeEnabled({ timeout: 15_000 })
  await opener.click()
  return reviewAndImport(await chooseImportFile(page, file))
}
