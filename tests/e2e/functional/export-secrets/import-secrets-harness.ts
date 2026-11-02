/** Legs shared by V-IMPORT-FOREIGN-SECRETS and V-IMPORT-MASKED-SECRETS: one per place a secret lives. */

import { randomUUID } from 'node:crypto'
import {
  test,
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
} from '../../helpers/playwright-fixtures'
import { apiPathMatcher } from '../../helpers/api-route'
import {
  BACKEND_URL,
  E2E_ENV_NAME,
  HTTP_MAIN_PORT,
  HTTP_TARGET_HOST,
} from '../../helpers/config'
import {
  expectNothingSentInRun,
  importSystemVariables,
  importThroughListPage,
  type ImportFile,
  type ImportListRoute,
  type ImportReview,
} from '../../helpers/fixture-import'
import { publishLibraryFunction, sharedNode } from '../../helpers/fn-seed'
import { clearSettledWorkbenchSession, resolveEnvironmentId } from '../../helpers/k8s-run'
import { callTool, enableMcpUntilRestart, resetMcpSettings } from '../../helpers/mcp'
import { expectNullLook } from '../../helpers/null-look'
import { FOREIGN_ENVELOPE, SECRET_MASK } from '../../helpers/secret-canary'
import { listZipEntries, readZipEntry } from '../../helpers/zip-reader'
import { buildZip, type ZipMember } from '../../helpers/zip-writer'

type Json = Record<string, any>

/** How the secret reached the file: sealed by another WAVE, or left as a masked export's placeholder. */
export type SecretKind = 'foreign' | 'masked'

// ---------------------------------------------------------------------------
// Pinned texts (blueprint-backend.md 2.4)
// ---------------------------------------------------------------------------

/** What the Try catches when a header reads a secret that holds null. */
// A null header entry is sent as empty text (REQ-3.1.3.21), so the secret is read into the Basic password, which refuses null.
export const NULL_PASSWORD = "'auth_password' is null"
/** A credential setting holding null. */
export const nullSetting = (setting: string): string => `'${setting}' is null`
/** An owed secret variable. */
export const owedVariable = (name: string): string => `Secret variable '${name}' holds no value`
/** An owed profile field. */
export const owedField = (field: string): string => `Secret field '${field}' holds no value`
/** The import validate warning for a secret another WAVE sealed. */
export const foreignWarning = (name: string): string =>
  `Secret '${name}' is encrypted by another WAVE instance and cannot be decrypted here; re-enter it after import`
/** The import validate warning for a masked variable. */
export const maskedWarning = (name: string): string => `Variable '${name}' contains a masked value`
export const OWED_FIX = 'A person must fill it in before dependent definitions can run'

const ENVELOPE = /wave:enc:v1:[A-Za-z0-9+/=_-]+/
const EVERY_ENVELOPE = new RegExp(ENVELOPE.source, 'g')
const TERMINAL = new Set(['passed', 'failed', 'stopped', 'skipped', 'error'])
const VALIDATE_ROUTE = apiPathMatcher('/api/backup/validate')
const RESTORE_ROUTE = apiPathMatcher('/api/backup/restore')
const PROBE = { status: 'probe_status', body: 'probe_body' }
const ECHO = `https://${HTTP_TARGET_HOST}:${HTTP_MAIN_PORT}`
const NODE_SIZE = { width: 120, height: 62 }

// ---------------------------------------------------------------------------
// Context and cleanup
// ---------------------------------------------------------------------------

interface LegContext {
  page: Page
  request: APIRequestContext
  kind: SecretKind
  mcpPort: number
  /** Unique per test: every name, key and secret carries it. */
  tag: string
  runKey: string
  cleanup: Array<() => Promise<unknown>>
}

/** One place a secret lives, run end to end for one kind. */
export interface ImportLeg {
  title: string
  timeoutMs: number
  run: (ctx: LegContext) => Promise<void>
}

const realSecret = (ctx: LegContext, what: string): string => `real-${what}-${ctx.tag}`
const entityName = (ctx: LegContext, what: string): string => `zz-import-${ctx.kind}-${what} ${ctx.tag}`
/** A library Function name stays within the 32-character limit. */
const functionName = (ctx: LegContext, what: string): string => `zz-${ctx.kind}-${what}-${ctx.tag}`
const exportMode = (kind: SecretKind): string => (kind === 'masked' ? 'mask' : 'encrypted')

/** Run one leg; everything it made is deleted afterwards, newest first. */
export async function runImportLeg(
  page: Page,
  leg: ImportLeg,
  kind: SecretKind,
  mcpPort: number,
): Promise<void> {
  const tag = randomUUID().slice(0, 8)
  const ctx: LegContext = {
    page,
    request: page.request,
    kind,
    mcpPort,
    tag,
    runKey: `zz-import-${kind}-${tag}-${randomUUID()}`,
    cleanup: [],
  }
  await page.request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
  try {
    await leg.run(ctx)
  } finally {
    for (const undo of ctx.cleanup.reverse()) await undo().catch(() => undefined)
    await page.request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
  }
}

// ---------------------------------------------------------------------------
// API reads and writes
// ---------------------------------------------------------------------------

async function apiData(request: APIRequestContext, path: string): Promise<Json> {
  const resp = await request.get(`${BACKEND_URL}${path}`)
  const text = await resp.text()
  expect(resp.ok(), `GET ${path}: ${resp.status()} ${text}`).toBe(true)
  const body = JSON.parse(text) as Json
  return (body.data ?? body) as Json
}

async function create(ctx: LegContext, path: string, data: Json, undo: (id: string) => string): Promise<string> {
  const resp = await ctx.request.post(`${BACKEND_URL}${path}`, { data })
  const text = await resp.text()
  expect(resp.ok(), `POST ${path}: ${resp.status()} ${text}`).toBe(true)
  const body = JSON.parse(text) as Json
  const id = String((body.data ?? body).id)
  ctx.cleanup.push(() => ctx.request.delete(`${BACKEND_URL}${undo(id)}`))
  return id
}

async function remove(ctx: LegContext, path: string): Promise<void> {
  const resp = await ctx.request.delete(`${BACKEND_URL}${path}`)
  expect(resp.ok(), `DELETE ${path}: ${resp.status()} ${await resp.text()}`).toBe(true)
}

/** The file an export hands over, as text. */
async function exportText(ctx: LegContext, path: string, secrets: string): Promise<string> {
  const resp = await ctx.request.get(`${BACKEND_URL}${path}?format=json&secrets=${secrets}`)
  const text = await resp.text()
  expect(resp.ok(), `GET ${path} (${secrets}): ${resp.status()} ${text}`).toBe(true)
  return text
}

/** What a plaintext export of the stored entity reads. */
async function plaintext(ctx: LegContext, path: string): Promise<Json> {
  return JSON.parse(await exportText(ctx, path, 'plaintext')) as Json
}

type Collection = 'tests' | 'suites' | 'regressions' | 'profiles' | 'functions'

/** The id of the one `collection` entry named `name`, once it is listed. */
async function idByName(ctx: LegContext, collection: Collection, name: string): Promise<string> {
  let id = ''
  await expect
    .poll(
      async () => {
        const resp = await ctx.request.get(
          `${BACKEND_URL}/${collection}?search=${encodeURIComponent(name)}&per_page=100`,
        )
        const body = (await resp.json().catch(() => null)) as Json | null
        const rows = (Array.isArray(body) ? body : Array.isArray(body?.data) ? body?.data : []) as Json[]
        id = String(rows.find((row) => row.name === name)?.id ?? '')
        return id
      },
      { timeout: 15_000, message: `the imported ${collection} entry "${name}" is listed` },
    )
    .toBeTruthy()
  return id
}

// ---------------------------------------------------------------------------
// The import file of each kind
// ---------------------------------------------------------------------------

/** The kind's file from an export of the real secrets: masked as exported, or every envelope swapped for a foreign one. */
function kindFile(kind: SecretKind, exported: string, reals: string[]): string {
  for (const real of reals) expect(exported, 'the export never holds the real secret').not.toContain(real)
  if (kind === 'masked') {
    expect(exported, 'the masked export holds the placeholder').toContain(SECRET_MASK)
    return exported
  }
  expect(exported, 'the encrypted export holds sealed values').toMatch(ENVELOPE)
  return exported.replace(EVERY_ENVELOPE, FOREIGN_ENVELOPE)
}

function jsonFile(name: string, text: string): ImportFile {
  return { name: `${name}.json`, mimeType: 'application/json', buffer: Buffer.from(text, 'utf-8') }
}

/** Import through the page and check what the review step said. */
async function importFile(
  ctx: LegContext,
  route: ImportListRoute | '/settings/variables',
  file: ImportFile,
  warning: string | null,
): Promise<ImportReview> {
  const review =
    route === '/settings/variables'
      ? await importSystemVariables(ctx.page, file)
      : await importThroughListPage(ctx.page, route, file)
  expect(review.summary).toBe('1 importable, 0 blocked')
  if (warning) expect(review.warnings).toContain(warning)
  return review
}

/** The validate warning a Suite or Regression variable of this kind carries. */
const variableWarning = (kind: SecretKind, name: string): string =>
  kind === 'masked' ? maskedWarning(name) : foreignWarning(name)

/** The validate warning of a foreign secret; a masked one names no warning here. */
const foreignOnly = (kind: SecretKind, name: string): string | null =>
  kind === 'foreign' ? foreignWarning(name) : null

// ---------------------------------------------------------------------------
// Workflow shapes
// ---------------------------------------------------------------------------

const retryUrl = (runKey: string): string => `${ECHO}/retry?key=${runKey}&fail_count=1&fail_status=502`

function blockNode(id: string, label: string, data: Json, x: number, y: number): Json {
  return {
    id,
    type: 'workflowNode',
    position: { x, y },
    data: {
      label,
      description: label,
      version: '1.0.0',
      hasNewerVersion: false,
      expressionFields: [],
      templateFields: [],
      variableExpressionKeys: [],
      ...data,
    },
    measured: { ...NODE_SIZE },
  }
}

/** An http-client Block calling the run key's retry counter with `values` on top. */
function httpNode(id: string, label: string, runKey: string, extra: Json = {}): Json {
  const { values = {}, expressionFields = [], profileBindings = [], outputBindings = {} } = extra
  return blockNode(
    id,
    label,
    {
      elementType: 'http-client',
      nodeType: 'plugin',
      category: 'network',
      expressionFields,
      config: {
        values: {
          method: 'GET',
          url: retryUrl(runKey),
          timeout: 10,
          retry_count: 0,
          retry_delay: 1,
          retry_backoff_factor: 2,
          retryable_status_codes: ['502', '503', '504'],
          verify_ssl: false,
          allow_redirects: true,
          max_redirects: 10,
          ...values,
        },
        outputBindings,
        profileBindings,
      },
    },
    600,
    200,
  )
}

/** The HTTP Block that logs in with Basic auth, the password read from `expression`. */
const passwordNode = (runKey: string, expression: string): Json =>
  httpNode('http-secret', 'Send the secret password', runKey, {
    values: { auth_enabled: true, auth_mode: 'basic', auth_username: 'wave', auth_password: expression },
    expressionFields: ['auth_password'],
  })

/** The HTTP Block that logs in with Basic auth, the password typed in as a literal. */
const basicAuthNode = (id: string, runKey: string, password: string): Json =>
  httpNode(id, 'Send the basic password', runKey, {
    values: { auth_enabled: true, auth_mode: 'basic', auth_username: 'wave', auth_password: password },
  })

/** A Variable Setter whose one row writes a secret literal into `name`. */
function setterNode(name: string, literal: string): Json {
  return blockNode(
    'set-secret',
    'Set the secret',
    {
      elementType: 'variable-setter',
      nodeType: 'control',
      category: 'flow',
      variableTypes: { [name]: 'string' },
      config: {
        values: { variables: { [name]: literal } },
        variableSecretKeys: [name],
        outputBindings: {},
        profileBindings: [],
      },
    },
    450,
    200,
  )
}

/** Try { body } catch { log } then probe: the Try binds what it caught to `e_http`. */
function guardedWorkflow(body: Json[], runKey: string): Json {
  const tryNode = blockNode(
    'try-send',
    'Try the secret request',
    {
      elementType: 'try-catch-finally',
      nodeType: 'control',
      category: 'flow',
      config: {
        values: { enable_catch: true, enable_finally: false },
        outputBindings: { error: 'e_http' },
        profileBindings: [],
      },
    },
    300,
    120,
  )
  const catchLog = blockNode(
    'catch-log',
    'Caught the refused request',
    {
      elementType: 'log',
      nodeType: 'plugin',
      category: 'system',
      expressionFields: ['message'],
      config: {
        values: { message: "'caught: ' + e_http['message']", level: 'WARN' },
        outputBindings: {},
        profileBindings: [],
      },
    },
    900,
    200,
  )
  const probe = httpNode('probe', 'Probe the run key', runKey, {
    outputBindings: { status_code: PROBE.status, body: PROBE.body },
  })
  probe.position = { x: 300, y: 320 }
  const chain = body.slice(1).map((node, index) => ({
    id: `e-body-${index}`,
    source: body[index].id,
    target: node.id,
    type: 'default',
  }))
  return {
    nodes: [tryNode, ...body, catchLog, probe],
    edges: [
      { id: 'e-start-try', source: 'start-node', target: 'try-send', type: 'default' },
      { id: 'e-try-body', source: 'try-send', target: body[0].id, type: 'default', sourceHandle: 'try' },
      ...chain,
      { id: 'e-catch-log', source: 'try-send', target: 'catch-log', type: 'default', sourceHandle: 'catch' },
      { id: 'e-then-probe', source: 'try-send', target: 'probe', type: 'default', sourceHandle: 'then' },
    ],
  }
}

const RUN_VARIABLES: Json = {
  e_http: { type: 'map', value: null, scope: 'test' },
  [PROBE.status]: { type: 'integer', value: null, scope: 'test' },
  [PROBE.body]: { type: 'string', value: null, scope: 'test' },
}

/** Seed a Test through POST /tests; it is deleted after the leg. */
async function seedTest(ctx: LegContext, name: string, workflow: Json, variables: Json = {}): Promise<string> {
  return create(
    ctx,
    '/tests',
    { name, version: '1.0.0', description: 'import secrets seed', workflow, variables: { ...RUN_VARIABLES, ...variables } },
    (id) => `/tests/${id}`,
  )
}

const secretVariable = (value: unknown): Json => ({ type: 'string', value, scope: 'test', secret: true })

function nodeById(workflow: Json, id: string): Json {
  const node = ((workflow?.nodes ?? []) as Json[]).find((entry) => entry.id === id)
  expect(node, `the workflow holds Block "${id}"`).toBeTruthy()
  return node as Json
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

interface RunOutcome {
  executionId: string
  /** The run's variables, as the run history holds them. */
  values: Json
}

/** Start a tracked run of a Test, Suite or Regression and read the variables of the run of `testId`. */
async function runTracked(
  ctx: LegContext,
  type: 'test' | 'suite' | 'regression',
  id: string,
  testId: string = id,
): Promise<RunOutcome> {
  await ctx.request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
  const environmentId = await resolveEnvironmentId(ctx.request)
  const started = await ctx.request.post(`${BACKEND_URL}/executions`, {
    data: { type, id, environment_id: environmentId },
  })
  const startedText = await started.text()
  expect(started.ok(), `POST /executions (${type}): ${started.status()} ${startedText}`).toBe(true)
  const executionId = String((JSON.parse(startedText).data ?? {}).id)
  let execution: Json = {}
  await expect
    .poll(
      async () => {
        execution = await apiData(ctx.request, `/executions/${executionId}`)
        return TERMINAL.has(String(execution.status))
      },
      { timeout: 120_000, intervals: [250, 500, 1_000], message: `the ${type} run ${executionId} ends` },
    )
    .toBe(true)
  // A Regression's runs sit under its Suites.
  const rows = [
    ...((execution.tests ?? []) as Json[]),
    ...((execution.suites ?? []) as Json[]).flatMap((suite) => (suite.tests ?? []) as Json[]),
  ]
  const runId = String(rows.find((row) => row.id === testId)?.run_id ?? executionId)
  const history = await apiData(ctx.request, `/executions/history/${runId}`)
  if (type === 'test') await clearSettledWorkbenchSession(ctx.request)
  return { executionId, values: (history.variables ?? {}) as Json }
}

/** The Block reading the secret failed before sending, and the probe proves nothing went out. */
async function expectRefusedAndNothingSent(run: RunOutcome, message: string, nodeId?: string): Promise<void> {
  await test.step('the block that reads the secret fails and names the null setting', () => {
    expect(run.values.e_http, 'the Try caught the failure').toMatchObject(
      nodeId ? { message, node_id: nodeId } : { message },
    )
  })
  await test.step('nothing was sent with the run key before the probe', () => {
    expectNothingSentInRun(run.values, PROBE)
  })
}

/** The failure report of the run lists what a person still owes. */
async function failureReportItems(ctx: LegContext, executionId: string): Promise<Json[]> {
  await enableMcpUntilRestart(ctx.page, ctx.mcpPort)
  try {
    const report = callTool(ctx.mcpPort, 'get_failure_report', { execution_id: executionId })
    expect(report.isError, JSON.stringify(report.payload)).toBe(false)
    return (report.payload.pending_action_items ?? []) as Json[]
  } finally {
    await resetMcpSettings(ctx.page)
  }
}

/** Owed: the failure report names the secret with its owed finding. */
async function expectOwed(ctx: LegContext, executionId: string, code: string, problem: string): Promise<void> {
  await test.step(`the secret is owed: ${problem}`, async () => {
    const items = await failureReportItems(ctx, executionId)
    expect(items, JSON.stringify(items)).toEqual(
      expect.arrayContaining([expect.objectContaining({ code, problem, fix: OWED_FIX })]),
    )
  })
}

/** Owed, the exact item a Test variable an import could not keep gives (the owed wording for an import). */
async function expectOwedTestVariable(
  ctx: LegContext,
  executionId: string,
  testId: string,
  testName: string,
  name: string,
): Promise<void> {
  await test.step(`the secret is owed: ${owedVariable(name)}`, async () => {
    expect(await failureReportItems(ctx, executionId)).toEqual([
      {
        test_id: testId,
        test_name: testName,
        step: `variables.${name}`,
        code: 'NO_VALUE_VARIABLE',
        problem: owedVariable(name),
        fix: OWED_FIX,
      },
    ])
  })
}

// ---------------------------------------------------------------------------
// The null look on the read-only variable lists
// ---------------------------------------------------------------------------

function readonlyRow(scope: Locator, name: string): Locator {
  return scope
    .locator('[data-testid="variable-readonly-table"] [data-testid="variable-row"]')
    .filter({ has: scope.page().getByText(name, { exact: true }) })
}

async function expectRowNull(scope: Locator, name: string, where: string): Promise<void> {
  const row = readonlyRow(scope, name)
  await expect(row, `${where} lists ${name}`).toHaveCount(1)
  await expectNullLook(row.locator('[data-testid="variable-value"]'), `${where}: ${name}`)
}

// ---------------------------------------------------------------------------
// Legs
// ---------------------------------------------------------------------------

/** Seed `name`, export it in the kind's mode, delete it: the file a person would import. */
async function testFile(ctx: LegContext, name: string, workflow: Json, variables: Json, reals: string[]): Promise<ImportFile> {
  const seeded = await seedTest(ctx, name, workflow, variables)
  const exported = await exportText(ctx, `/tests/${seeded}/export`, exportMode(ctx.kind))
  await remove(ctx, `/tests/${seeded}`)
  return jsonFile(name, kindFile(ctx.kind, exported, reals))
}

/** Import a Test file through the Tests page; the imported Test is deleted after the leg. */
async function importTest(ctx: LegContext, name: string, file: ImportFile, warning: string | null): Promise<string> {
  await importFile(ctx, '/tests', file, warning)
  const id = await idByName(ctx, 'tests', name)
  ctx.cleanup.push(() => ctx.request.delete(`${BACKEND_URL}/tests/${id}`))
  return id
}

const testVariableLeg: ImportLeg = {
  title: 'a Test variable',
  timeoutMs: 180_000,
  run: async (ctx) => {
    const name = entityName(ctx, 'test-variable')
    const real = realSecret(ctx, 'test-variable')
    const file = await testFile(ctx, name, guardedWorkflow([passwordNode(ctx.runKey, 'api_tok')], ctx.runKey), { api_tok: secretVariable(real) }, [real])
    const testId = await importTest(ctx, name, file, foreignOnly(ctx.kind, 'api_tok'))

    await test.step('stored null: a plaintext export reads null, still secret', async () => {
      const stored = await plaintext(ctx, `/tests/${testId}/export`)
      expect(stored.variables.api_tok).toMatchObject({ value: null, secret: true })
    })
    const run = await runTracked(ctx, 'test', testId)
    await expectRefusedAndNothingSent(run, NULL_PASSWORD, 'http-secret')
    await expectOwedTestVariable(ctx, run.executionId, testId, name, 'api_tok')
  },
}

const setterLeg: ImportLeg = {
  title: 'a Variable Setter secret literal',
  timeoutMs: 180_000,
  run: async (ctx) => {
    const name = entityName(ctx, 'setter')
    const real = realSecret(ctx, 'setter')
    const workflow = guardedWorkflow([setterNode('api_tok', real), passwordNode(ctx.runKey, 'api_tok')], ctx.runKey)
    const file = await testFile(ctx, name, workflow, { api_tok: secretVariable(null) }, [real])
    const testId = await importTest(ctx, name, file, foreignOnly(ctx.kind, 'api_tok'))

    await test.step('stored null: a plaintext export reads the setter row as null', async () => {
      const stored = await plaintext(ctx, `/tests/${testId}/export`)
      expect(nodeById(stored.workflow, 'set-secret').data.config.values.variables).toEqual({ api_tok: null })
    })
    const run = await runTracked(ctx, 'test', testId)
    await expectRefusedAndNothingSent(run, NULL_PASSWORD, 'http-secret')
    await expectOwed(ctx, run.executionId, 'NO_VALUE_VARIABLE', owedVariable('api_tok'))
  },
}

const credentialLeg: ImportLeg = {
  title: 'an HTTP basic password',
  timeoutMs: 180_000,
  run: async (ctx) => {
    const name = entityName(ctx, 'credential')
    const real = realSecret(ctx, 'credential')
    const workflow = guardedWorkflow([basicAuthNode('http-secret', ctx.runKey, real)], ctx.runKey)
    const file = await testFile(ctx, name, workflow, {}, [real])
    const testId = await importTest(ctx, name, file, foreignOnly(ctx.kind, 'auth_password'))

    await test.step('stored null: a plaintext export reads the password as null', async () => {
      const stored = await plaintext(ctx, `/tests/${testId}/export`)
      expect(nodeById(stored.workflow, 'http-secret').data.config.values.auth_password).toBeNull()
    })
    const run = await runTracked(ctx, 'test', testId)
    await expectRefusedAndNothingSent(run, nullSetting('auth_password'), 'http-secret')
    await expectOwed(ctx, run.executionId, 'NO_VALUE_SECRET', owedField('auth_password'))
  },
}

const suiteLeg: ImportLeg = {
  title: 'a Suite variable',
  timeoutMs: 180_000,
  run: async (ctx) => {
    const real = realSecret(ctx, 'suite')
    const testId = await seedTest(ctx, entityName(ctx, 'suite-reader'), guardedWorkflow([passwordNode(ctx.runKey, 'suite.suite_tok')], ctx.runKey))
    const name = entityName(ctx, 'suite')
    const seeded = await create(
      ctx,
      '/suites',
      { name, description: 'import secrets seed', tests: [testId], variables: { suite_tok: { type: 'string', value: real, secret: true } } },
      (id) => `/suites/${id}`,
    )
    const exported = await exportText(ctx, `/suites/${seeded}/export`, exportMode(ctx.kind))
    await remove(ctx, `/suites/${seeded}`)
    await importFile(ctx, '/suites', jsonFile(name, kindFile(ctx.kind, exported, [real])), variableWarning(ctx.kind, 'suite_tok'))
    const suiteId = await idByName(ctx, 'suites', name)
    ctx.cleanup.push(() => ctx.request.delete(`${BACKEND_URL}/suites/${suiteId}`))

    await test.step('stored null: the Suite sidebar reads null in the null look', async () => {
      await ctx.page.goto(`/suites/${suiteId}`)
      await expect(ctx.page.locator('[data-testid="suite-detail-page"]')).toBeVisible({ timeout: 15_000 })
      await expectRowNull(ctx.page.locator('[data-testid="suite-metadata-sidebar"]'), 'suite_tok', 'the Suite sidebar')
    })
    await test.step('stored null: a plaintext export reads null, still secret', async () => {
      const stored = await plaintext(ctx, `/suites/${suiteId}/export`)
      expect(stored.variables.suite_tok).toMatchObject({ value: null, secret: true })
    })
    const run = await runTracked(ctx, 'suite', suiteId, testId)
    await expectRefusedAndNothingSent(run, NULL_PASSWORD, 'http-secret')
    await expectOwed(ctx, run.executionId, 'NO_VALUE_VARIABLE', owedVariable('suite_tok'))
  },
}

const regressionLeg: ImportLeg = {
  title: 'a Regression variable',
  timeoutMs: 180_000,
  run: async (ctx) => {
    const real = realSecret(ctx, 'regression')
    const testId = await seedTest(ctx, entityName(ctx, 'regression-reader'), guardedWorkflow([passwordNode(ctx.runKey, 'regression.reg_tok')], ctx.runKey))
    const suiteId = await create(
      ctx,
      '/suites',
      { name: entityName(ctx, 'regression-suite'), description: 'import secrets seed', tests: [testId] },
      (id) => `/suites/${id}`,
    )
    const name = entityName(ctx, 'regression')
    const seeded = await create(
      ctx,
      '/regressions',
      { name, description: 'import secrets seed', suites: [suiteId], variables: { reg_tok: { type: 'string', value: real, secret: true } } },
      (id) => `/regressions/${id}`,
    )
    const exported = await exportText(ctx, `/regressions/${seeded}/export`, exportMode(ctx.kind))
    await remove(ctx, `/regressions/${seeded}`)
    await importFile(ctx, '/regressions', jsonFile(name, kindFile(ctx.kind, exported, [real])), variableWarning(ctx.kind, 'reg_tok'))
    const regressionId = await idByName(ctx, 'regressions', name)
    ctx.cleanup.push(() => ctx.request.delete(`${BACKEND_URL}/regressions/${regressionId}`))

    await test.step('stored null: the Regression sidebar reads null in the null look', async () => {
      await ctx.page.goto(`/regressions/${regressionId}`)
      await expect(ctx.page.locator('[data-testid="regression-detail-page"]')).toBeVisible({ timeout: 15_000 })
      await expectRowNull(ctx.page.locator('[data-testid="regression-metadata-sidebar"]'), 'reg_tok', 'the Regression sidebar')
    })
    await test.step('stored null: a plaintext export reads null, still secret', async () => {
      const stored = await plaintext(ctx, `/regressions/${regressionId}/export`)
      expect(stored.variables.reg_tok).toMatchObject({ value: null, secret: true })
    })
    const run = await runTracked(ctx, 'regression', regressionId, testId)
    await expectRefusedAndNothingSent(run, NULL_PASSWORD, 'http-secret')
    await expectOwed(ctx, run.executionId, 'NO_VALUE_VARIABLE', owedVariable('reg_tok'))
  },
}

/** A System Variables file holding one secret of this kind, as the matching export writes it. */
function systemVariablesFile(kind: SecretKind, name: string): ImportFile {
  const value = kind === 'masked' ? { value: SECRET_MASK, masked: true } : { value: FOREIGN_ENVELOPE }
  const variables = { [name]: { type: 'string', secret: true, ...value } }
  return jsonFile(name, JSON.stringify({ variables }))
}

const systemLeg: ImportLeg = {
  title: 'a System variable',
  timeoutMs: 180_000,
  run: async (ctx) => {
    const name = `zz_sys_${ctx.tag}`
    const testId = await seedTest(ctx, entityName(ctx, 'system-reader'), guardedWorkflow([passwordNode(ctx.runKey, `system.${name}`)], ctx.runKey))
    ctx.cleanup.push(() => ctx.request.delete(`${BACKEND_URL}/variables/system/${name}`))
    await importFile(ctx, '/settings/variables', systemVariablesFile(ctx.kind, name), foreignOnly(ctx.kind, name))

    await test.step('stored null: the System Variables table reads null in the null look', async () => {
      await expectRowNull(ctx.page.locator('[data-testid="system-variables-tab"]'), name, 'the System Variables table')
    })
    await test.step('stored null: a plaintext export reads null, still secret', async () => {
      const stored = await plaintext(ctx, '/variables/system/export')
      expect(stored.variables[name]).toMatchObject({ value: null, secret: true })
    })
    const run = await runTracked(ctx, 'test', testId)
    await expectRefusedAndNothingSent(run, NULL_PASSWORD, 'http-secret')
    await expectOwed(ctx, run.executionId, 'NO_VALUE_VARIABLE', owedVariable(name))
  },
}

/** An http profile whose Basic password is `password`, in its defaults and in the E2E environment. */
async function seedHttpProfile(ctx: LegContext, name: string, password: string): Promise<string> {
  const values = { auth_username: 'wave', auth_password: password }
  const environmentId = await resolveEnvironmentId(ctx.request)
  return create(
    ctx,
    '/profiles',
    {
      name,
      type: 'http',
      description: 'import secrets seed',
      config: { base_url: ECHO, ...values },
      environment_values: { [environmentId]: values },
      tags: [],
    },
    (id) => `/profiles/${id}`,
  )
}

/** The HTTP Block that logs in with the bound profile's Basic credentials. */
function profileAuthNode(runKey: string, profileId: string, profileName: string): Json {
  return httpNode('http-secret', 'Send the profile password', runKey, {
    values: {
      auth_enabled: true,
      auth_mode: 'basic',
      auth_username: 'httpp.auth_username',
      auth_password: 'httpp.auth_password',
    },
    expressionFields: ['auth_username', 'auth_password'],
    profileBindings: [{ profileId, alias: 'httpp', profileName, profileType: 'http' }],
  })
}

const profileLeg: ImportLeg = {
  title: 'an HTTP profile password',
  timeoutMs: 180_000,
  run: async (ctx) => {
    const real = realSecret(ctx, 'profile')
    const name = entityName(ctx, 'profile')
    const seeded = await seedHttpProfile(ctx, name, real)
    const exported = await exportText(ctx, `/profiles/${seeded}/export`, exportMode(ctx.kind))
    await remove(ctx, `/profiles/${seeded}`)
    await importFile(ctx, '/profiles', jsonFile(name, kindFile(ctx.kind, exported, [real])), foreignOnly(ctx.kind, 'auth_password'))
    const profileId = await idByName(ctx, 'profiles', name)
    ctx.cleanup.push(() => ctx.request.delete(`${BACKEND_URL}/profiles/${profileId}`))

    await test.step('stored null: a plaintext export reads the password as null, defaults and environment', async () => {
      const stored = await plaintext(ctx, `/profiles/${profileId}/export`)
      expect(stored.config.auth_password).toBeNull()
      expect(stored.environment_values[E2E_ENV_NAME].auth_password).toBeNull()
    })
    const testId = await seedTest(ctx, entityName(ctx, 'profile-reader'), guardedWorkflow([profileAuthNode(ctx.runKey, profileId, name)], ctx.runKey))
    const run = await runTracked(ctx, 'test', testId)
    await expectRefusedAndNothingSent(run, nullSetting('auth_password'), 'http-secret')
    await expectOwed(ctx, run.executionId, 'NO_VALUE_SECRET', owedField('auth_password'))
  },
}

/** Export a seeded library Function in the kind's form, delete it, import the file; the imported id. */
async function reimportFunction(
  ctx: LegContext,
  seededId: string,
  name: string,
  reals: string[],
  warning: string | null,
): Promise<string> {
  ctx.cleanup.push(() => ctx.request.delete(`${BACKEND_URL}/functions/${seededId}?cascade=true`))
  const exported = await exportText(ctx, `/functions/${seededId}/export`, exportMode(ctx.kind))
  await remove(ctx, `/functions/${seededId}?cascade=true`)
  await importFile(ctx, '/functions', jsonFile(name, kindFile(ctx.kind, exported, reals)), warning)
  const functionId = await idByName(ctx, 'functions', name)
  ctx.cleanup.push(() => ctx.request.delete(`${BACKEND_URL}/functions/${functionId}?cascade=true`))
  return functionId
}

/** Seed a library Function through POST /functions; it is deleted after the leg. */
function seedFunction(ctx: LegContext, name: string, parts: Json): Promise<string> {
  return create(
    ctx,
    '/functions',
    {
      name,
      description: 'import secrets seed',
      tags: [],
      inputs: [],
      outputs: [],
      variables: [],
      dependencies: { functions: [], plugins: [] },
      version: '1.0.0',
      changelog: 'Initial release',
      details: '',
      ...parts,
    },
    (id) => `/functions/${id}?cascade=true`,
  )
}

/** A Function body of one block, reached from the Function's entry. */
const entryWorkflow = (node: Json): Json => ({
  nodes: [node],
  edges: [{ id: `e-start-${node.id}`, source: 'start-node', target: node.id, type: 'default' }],
})

/** The Function body's HTTP Block that logs in with Basic auth, the password read from `expression`. */
const bodyPasswordNode = (runKey: string, expression: string): Json =>
  httpNode('fn-http', 'Send the secret password', runKey, {
    values: { auth_enabled: true, auth_mode: 'basic', auth_username: 'wave', auth_password: expression },
    expressionFields: ['auth_password'],
  })

/** The Test's Function Block of the library Function, with its fields and output bindings. */
function functionBlockNode(functionId: string, name: string, extra: Json = {}): Json {
  const block = sharedNode('call-fn', {
    functionId,
    functionVersion: '1.0.0',
    label: 'Run the imported Function',
    originalLibraryName: name,
    values: extra.values,
  }) as Json
  block.data.config.outputBindings = extra.outputBindings ?? {}
  return block
}

const functionLeg: ImportLeg = {
  title: 'a library Function workflow secret',
  timeoutMs: 180_000,
  run: async (ctx) => {
    const real = realSecret(ctx, 'function')
    const name = functionName(ctx, 'fn')
    const seeded = await seedFunction(ctx, name, { workflow: entryWorkflow(basicAuthNode('fn-http', ctx.runKey, real)) })
    const functionId = await reimportFunction(ctx, seeded, name, [real], foreignOnly(ctx.kind, 'auth_password'))

    await test.step('stored null: a plaintext export reads the password as null in every version', async () => {
      const stored = await plaintext(ctx, `/functions/${functionId}/export`)
      expect(nodeById(stored.workflow, 'fn-http').data.config.values.auth_password).toBeNull()
      for (const version of (stored.versions ?? []) as Json[]) {
        expect(nodeById(version.definition.workflow, 'fn-http').data.config.values.auth_password).toBeNull()
      }
    })
    const testId = await seedTest(ctx, entityName(ctx, 'function-caller'), guardedWorkflow([functionBlockNode(functionId, name)], ctx.runKey))
    const run = await runTracked(ctx, 'test', testId)
    await expectRefusedAndNothingSent(run, nullSetting('auth_password'))
    await expectOwed(ctx, run.executionId, 'NO_VALUE_SECRET', owedField('auth_password'))
  },
}

const functionLocalLeg: ImportLeg = {
  title: 'a library Function local secret',
  timeoutMs: 180_000,
  run: async (ctx) => {
    const real = realSecret(ctx, 'function-local')
    const name = functionName(ctx, 'flocal')
    const seeded = await seedFunction(ctx, name, {
      variables: [{ name: 'fn_tok', type: 'string', secret: true, value: real }],
      workflow: entryWorkflow(bodyPasswordNode(ctx.runKey, 'fn_tok')),
    })
    const functionId = await reimportFunction(ctx, seeded, name, [real], foreignOnly(ctx.kind, 'fn_tok'))

    await test.step('stored null: a plaintext export reads the local as null in every version', async () => {
      const stored = await plaintext(ctx, `/functions/${functionId}/export`)
      expect(stored.variables).toEqual([expect.objectContaining({ name: 'fn_tok', value: null, secret: true })])
      for (const version of (stored.versions ?? []) as Json[]) {
        expect(version.definition.variables).toEqual([expect.objectContaining({ name: 'fn_tok', value: null })])
      }
    })
    const testId = await seedTest(ctx, entityName(ctx, 'local-caller'), guardedWorkflow([functionBlockNode(functionId, name)], ctx.runKey))
    const run = await runTracked(ctx, 'test', testId)
    await expectRefusedAndNothingSent(run, NULL_PASSWORD)
    await expectOwed(ctx, run.executionId, 'NO_VALUE_VARIABLE', owedVariable('fn_tok'))
  },
}

const functionOutputLeg: ImportLeg = {
  title: 'a library Function secret output default',
  timeoutMs: 180_000,
  run: async (ctx) => {
    const real = realSecret(ctx, 'function-output')
    const name = functionName(ctx, 'fout')
    const body = blockNode('fn-log', 'Hand back the default', {
      elementType: 'log',
      nodeType: 'plugin',
      category: 'system',
      config: { values: { message: 'returning', level: 'INFO' }, outputBindings: {}, profileBindings: [] },
    }, 300, 120)
    const seeded = await seedFunction(ctx, name, {
      outputs: [{ name: 'out_tok', type: 'string', secret: true, default: real }],
      workflow: entryWorkflow(body),
    })
    const functionId = await reimportFunction(ctx, seeded, name, [real], foreignOnly(ctx.kind, 'out_tok'))

    await test.step('stored null: a plaintext export reads the default as null', async () => {
      const stored = await plaintext(ctx, `/functions/${functionId}/export`)
      expect(stored.outputs).toEqual([expect.objectContaining({ name: 'out_tok', default: null, secret: true })])
    })
    const block = functionBlockNode(functionId, name, { outputBindings: { out_tok: 'got_tok' } })
    const workflow = guardedWorkflow([block, passwordNode(ctx.runKey, 'got_tok')], ctx.runKey)
    const testId = await seedTest(ctx, entityName(ctx, 'output-caller'), workflow, { got_tok: secretVariable(null) })
    const run = await runTracked(ctx, 'test', testId)
    await expectRefusedAndNothingSent(run, NULL_PASSWORD, 'http-secret')
    await expectOwed(ctx, run.executionId, 'NO_VALUE_VARIABLE', owedVariable('out_tok'))
  },
}

const blockInputLeg: ImportLeg = {
  title: 'a secret input literal on the Function Block',
  timeoutMs: 180_000,
  run: async (ctx) => {
    const real = realSecret(ctx, 'call-input')
    const name = functionName(ctx, 'finput')
    const functionId = await seedFunction(ctx, name, {
      inputs: [{ name: 'tok', type: 'string', secret: true, required: false, default: null }],
      workflow: entryWorkflow(bodyPasswordNode(ctx.runKey, 'tok')),
    })
    const testName = entityName(ctx, 'input-holder')
    const block = functionBlockNode(functionId, name, { values: { tok: real } })
    const file = await testFile(ctx, testName, guardedWorkflow([block], ctx.runKey), {}, [real])
    const testId = await importTest(ctx, testName, file, foreignOnly(ctx.kind, 'tok'))

    await test.step('stored null: a plaintext export reads the Function Block literal as null', async () => {
      const stored = await plaintext(ctx, `/tests/${testId}/export`)
      expect(nodeById(stored.workflow, 'call-fn').data.config.values).toEqual({ tok: null })
    })
    const run = await runTracked(ctx, 'test', testId)
    // Per REQ-3.1.2.9: a secret input is a credential field, so the Function Block refuses the null before its body.
    await expectRefusedAndNothingSent(run, nullSetting('tok'))
    await expectOwed(ctx, run.executionId, 'NO_VALUE_SECRET', owedField('tok'))
  },
}

// ---------------------------------------------------------------------------
// Backup restore
// ---------------------------------------------------------------------------

const BACKUP_PARTS = ['tests', 'suites', 'regressions', 'system_variables', 'profiles', 'functions'] as const

/** What the restore legs seed: one entity per part, each holding a real secret. */
interface RestoreSeed {
  testId: string
  testName: string
  suiteId: string
  regressionId: string
  systemName: string
  profileId: string
  functionId: string
  reals: Record<'test' | 'suite' | 'regression' | 'system' | 'profile' | 'function', string>
}

async function seedSystemVariable(ctx: LegContext, name: string, value: string): Promise<void> {
  const resp = await ctx.request.post(`${BACKEND_URL}/variables/system/import`, {
    multipart: {
      file: jsonFile(name, JSON.stringify({ variables: { [name]: { type: 'string', value, secret: true } } })),
    },
  })
  expect(resp.ok(), `POST /variables/system/import: ${resp.status()} ${await resp.text()}`).toBe(true)
  ctx.cleanup.push(() => ctx.request.delete(`${BACKEND_URL}/variables/system/${name}`))
}

async function seedRestoreParts(ctx: LegContext): Promise<RestoreSeed> {
  const reals = {
    test: realSecret(ctx, 'restore-test'),
    suite: realSecret(ctx, 'restore-suite'),
    regression: realSecret(ctx, 'restore-regression'),
    system: realSecret(ctx, 'restore-system'),
    profile: realSecret(ctx, 'restore-profile'),
    function: realSecret(ctx, 'restore-function'),
  }
  const testName = entityName(ctx, 'restore-test')
  const testId = await seedTest(ctx, testName, guardedWorkflow([passwordNode(ctx.runKey, 'api_tok')], ctx.runKey), {
    api_tok: secretVariable(reals.test),
  })
  const suiteId = await create(
    ctx,
    '/suites',
    { name: entityName(ctx, 'restore-suite'), description: 'import secrets seed', tests: [testId], variables: { suite_tok: { type: 'string', value: reals.suite, secret: true } } },
    (id) => `/suites/${id}`,
  )
  const regressionId = await create(
    ctx,
    '/regressions',
    { name: entityName(ctx, 'restore-regression'), description: 'import secrets seed', suites: [suiteId], variables: { reg_tok: { type: 'string', value: reals.regression, secret: true } } },
    (id) => `/regressions/${id}`,
  )
  const systemName = `zz_sys_${ctx.tag}`
  await seedSystemVariable(ctx, systemName, reals.system)
  const profileId = await seedHttpProfile(ctx, entityName(ctx, 'restore-profile'), reals.profile)
  const fn = await publishLibraryFunction(ctx.request, {
    name: functionName(ctx, 'rfn'),
    description: 'import secrets seed',
    workflow: {
      nodes: [basicAuthNode('fn-http', ctx.runKey, reals.function)],
      edges: [{ id: 'e-start-fn-http', source: 'start-node', target: 'fn-http', type: 'default' }],
    },
  })
  ctx.cleanup.push(() => ctx.request.delete(`${BACKEND_URL}/functions/${fn.functionId}?cascade=true`))
  return { testId, testName, suiteId, regressionId, systemName, profileId, functionId: fn.functionId, reals }
}

/** A backup of the seeded entities only, in the kind's form, as the Backup page would be handed it. */
async function restoreArchive(ctx: LegContext, seed: RestoreSeed): Promise<Buffer> {
  const resp = await ctx.request.post(`${BACKEND_URL}/api/backup/create`, {
    data: {
      entity_types: [...BACKUP_PARTS],
      format: 'json',
      compression_method: 'deflate',
      compression_level: 6,
      secrets: exportMode(ctx.kind),
    },
  })
  expect(resp.ok(), `POST /api/backup/create: ${resp.status()}`).toBe(true)
  const original = await resp.body()
  const ids = new Set([seed.testId, seed.suiteId, seed.regressionId, seed.profileId, seed.functionId])
  const members: ZipMember[] = []
  for (const entry of listZipEntries(original)) {
    const text = readZipEntry(original, entry.name).toString('utf-8')
    if (entry.name === 'manifest.json') {
      members.push({ name: entry.name, data: Buffer.from(text, 'utf-8') })
      continue
    }
    const document = JSON.parse(text) as Json
    if (entry.name.startsWith('system_variables/')) {
      document.variables = { [seed.systemName]: document.variables[seed.systemName] }
    } else if (!ids.has(String(document.id)) && !String(document.name ?? '').includes(ctx.tag)) {
      continue
    }
    const kept = kindFile(ctx.kind, JSON.stringify(document, null, 2), Object.values(seed.reals))
    members.push({ name: entry.name, data: Buffer.from(kept, 'utf-8') })
  }
  expect(members.map((member) => member.name.split('/')[0]).sort(), 'one member per seeded part and the manifest').toEqual(
    [...BACKUP_PARTS, 'manifest.json'].sort(),
  )
  return buildZip(members)
}

/** Delete every seeded entity so the restore writes them anew. */
async function deleteRestoreParts(ctx: LegContext, seed: RestoreSeed): Promise<void> {
  await remove(ctx, `/regressions/${seed.regressionId}`)
  await remove(ctx, `/suites/${seed.suiteId}`)
  await remove(ctx, `/tests/${seed.testId}`)
  await remove(ctx, `/functions/${seed.functionId}?cascade=true`)
  await remove(ctx, `/profiles/${seed.profileId}`)
  await remove(ctx, `/variables/system/${seed.systemName}`)
}

/** Restore an archive on the Backup page, with Skip or with Overwrite confirmed; every seeded part is written. */
async function restoreThroughBackupPage(ctx: LegContext, archive: Buffer, overwrite: boolean): Promise<void> {
  const { page } = ctx
  await page.goto('/settings/backup')
  await expect(page.locator('[data-testid="settings-page"][aria-busy="false"]')).toBeVisible({ timeout: 20_000 })
  await page.getByTestId('upload-input').setInputFiles({
    name: `zz-import-secrets-${ctx.tag}.zip`,
    mimeType: 'application/zip',
    buffer: archive,
  })
  await expect(page.getByTestId('validation-preview')).toBeVisible({ timeout: 20_000 })
  if (overwrite) {
    await Promise.all([
      page.waitForResponse((response) => VALIDATE_ROUTE(new URL(response.url())), { timeout: 30_000 }),
      page.getByTestId('cr-overwrite').click(),
    ])
    await expect(page.getByTestId('cr-overwrite')).toBeChecked()
  }
  const button = page.getByTestId('restore-button')
  await expect(button).toBeEnabled({ timeout: 20_000 })
  const [answer] = await Promise.all([
    page.waitForResponse((response) => RESTORE_ROUTE(new URL(response.url())), { timeout: 60_000 }),
    (async () => {
      await button.click()
      if (overwrite) {
        await page
          .getByTestId('restore-overwrite-dialog')
          .getByRole('button', { name: 'Overwrite', exact: true })
          .click()
      }
    })(),
  ])
  expect(answer.status(), 'the restore answers a result').toBe(200)
  const written = ((await answer.json()) as Json).data as Json
  for (const part of BACKUP_PARTS) {
    expect(written[part], `${part}: the one seeded item is written`).toMatchObject({ imported: 1, skipped: 0, fatal: 0 })
  }
  const result = page.getByTestId('restore-result')
  await expect(result).toBeVisible({ timeout: 60_000 })
  await expect(result).toContainText('Restore Complete')
  await expect(page.getByTestId('restore-backup-error')).toHaveCount(0)
}

/** Each restored part's secret as a plaintext export reads it. */
async function restoredSecrets(ctx: LegContext, seed: RestoreSeed): Promise<Record<keyof RestoreSeed['reals'], unknown>> {
  const testDoc = await plaintext(ctx, `/tests/${seed.testId}/export`)
  const suiteDoc = await plaintext(ctx, `/suites/${seed.suiteId}/export`)
  const regressionDoc = await plaintext(ctx, `/regressions/${seed.regressionId}/export`)
  const systemDoc = await plaintext(ctx, '/variables/system/export')
  const profileDoc = await plaintext(ctx, `/profiles/${seed.profileId}/export`)
  const functionDoc = await plaintext(ctx, `/functions/${seed.functionId}/export`)
  expect(testDoc.variables.api_tok.secret, 'the Test variable stays secret').toBe(true)
  expect(profileDoc.environment_values[E2E_ENV_NAME].auth_password, 'the environment value matches the defaults').toBe(
    profileDoc.config.auth_password,
  )
  return {
    test: testDoc.variables.api_tok.value,
    suite: suiteDoc.variables.suite_tok.value,
    regression: regressionDoc.variables.reg_tok.value,
    system: systemDoc.variables[seed.systemName].value,
    profile: profileDoc.config.auth_password,
    function: nodeById(functionDoc.workflow, 'fn-http').data.config.values.auth_password,
  }
}

const restoreLeg: ImportLeg = {
  title: 'a backup restore of every part',
  timeoutMs: 300_000,
  run: async (ctx) => {
    const seed = await seedRestoreParts(ctx)
    const archive = await restoreArchive(ctx, seed)
    await deleteRestoreParts(ctx, seed)
    await restoreThroughBackupPage(ctx, archive, false)

    await test.step('stored null: every restored part reads null in a plaintext export', async () => {
      expect(await restoredSecrets(ctx, seed)).toEqual({
        test: null,
        suite: null,
        regression: null,
        system: null,
        profile: null,
        function: null,
      })
    })
    const run = await runTracked(ctx, 'test', seed.testId)
    await expectRefusedAndNothingSent(run, NULL_PASSWORD, 'http-secret')
    await expectOwedTestVariable(ctx, run.executionId, seed.testId, seed.testName, 'api_tok')
  },
}

/** Every leg, in the order of the location axis of matrix 6. */
export const IMPORT_LEGS: readonly ImportLeg[] = [
  testVariableLeg,
  setterLeg,
  credentialLeg,
  suiteLeg,
  regressionLeg,
  systemLeg,
  profileLeg,
  functionLeg,
  functionLocalLeg,
  functionOutputLeg,
  blockInputLeg,
  restoreLeg,
]

/** EXPORT-7: a masked archive restored with Overwrite over the stored secrets leaves every real secret in place. */
export const maskedOverwriteLeg: ImportLeg = {
  title: 'a masked backup restored over stored secrets',
  timeoutMs: 240_000,
  run: async (ctx) => {
    const seed = await seedRestoreParts(ctx)
    const archive = await restoreArchive(ctx, seed)
    await restoreThroughBackupPage(ctx, archive, true)

    await test.step('every part still holds its real secret: the mask never replaced one', async () => {
      expect(await restoredSecrets(ctx, seed)).toEqual(seed.reals)
    })
  },
}
