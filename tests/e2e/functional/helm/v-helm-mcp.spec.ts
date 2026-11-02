/**
 * V-HELM-MCP: the Helm Blocks authored through the live MCP endpoint.
 *
 * Phase: functional-workflow (parallel) - the test creates its Test through
 * the MCP listener on its own stack's port, installs into the run's own
 * namespace under a release name of its own, and tears the namespace down.
 * REQ: REQ-5.2.7.3, REQ-5.2.7.4, REQ-3.5.3.1, REQ-3.5.3.4
 * Design Decisions: HELM-1, HELM-2
 *
 * A recipe holding a K8s Connect, a Helm Install and a Helm Status is compiled
 * by the real `create_test_from_recipe` tool over the live endpoint. The same
 * three Blocks are hand-built from the shared node factories and imported the
 * ordinary way, and the two persisted workflows are read back and compared
 * Block for Block: the same element types, the same settings, the same
 * expression rows and the same captures, wired in the same order, over the
 * same declared variables. Then the recipe-authored Test is RUN, because an
 * artifact that matches on paper but cannot install a chart has not been
 * authored - it has been drawn.
 *
 * Pass Criteria:
 *   HL-11  the dry run reports the recipe valid with no finding (the secret
 *          feeds K8s Connect's secret token setting, which masks what it
 *          resolves to) and persists nothing; the create reports created with
 *          no warning, and the persisted Test passes platform validation
 *          with zero errors; the readback equals the hand-built equivalent on
 *          Blocks, settings (each choice-list and true / false value is
 *          written when the Block is created), captures, wiring and
 *          variables, both sides
 *          declaring every capture target with no value (REQ-3.1.3.20) and the
 *          K8s session capture secret (SECUI-4, K8SCON-4); and
 *          running the recipe-authored Test installs wave-demo 0.1.0 and reads
 *          the same release back, both reporting deployed.
 */

import { execFileSync } from 'child_process'
import path from 'path'
import { test, expect } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import {
  getActiveSessionId,
  getSessionVariables,
  importFixtureTest,
} from '../../helpers/fixture-import'
import { enableMcpUntilRestart, resetMcpSettings } from '../../helpers/mcp'
import { finishRun, startRun } from '../../helpers/k8s-run'
import { seedRun, type SeededRun } from '../../helpers/k8s-seed'
import {
  helmInstallNode,
  helmStatusNode,
  k8sConnectNode,
  markerNode,
  stackNodes,
  type WorkflowNode,
} from '../../helpers/k8s-nodes'
import {
  BACKEND_PORT,
  BACKEND_URL,
  ensureEnvironment,
  K8S_ADMIN_TOKEN,
  K8S_API_HOST,
  K8S_API_PORT,
} from '../../helpers/config'
import {
  CHART,
  CHART_REPO_URL,
  expectLine,
  expectReleaseRow,
  installedLine,
  readReleaseLine,
  releaseName,
  statusOf,
  uninstallQuietly,
  type SessionVariables,
} from './cases-helm'

/** One MCP port per stack, so host-mode parallel workers never collide. */
const MCP_PORT = Number(BACKEND_PORT) + 765

/** The shared one-shot MCP client, run through the backend poetry env. */
const MCP_CLIENT = path.resolve(__dirname, '../recipe-authoring/mcp_recipe_client.py')
const BACKEND_DIR = path.resolve(__dirname, '../../../../backend')

/** The bookend both the recipe and the hand-built equivalent close on. */
const MCP_MARKER = 'helm-mcp-done'

const BASE_NAME = 'Helm Recipe Round Trip'

/** The cluster as both artifacts state it: the mode-correct host, written in
 *  full, so no fixture rewrite can make the two documents differ. */
const API_URL = `https://${K8S_API_HOST}:${K8S_API_PORT}`

const V_0_1 = '0.1.0'
const CHART_0_1 = `${CHART.demo}-${V_0_1}`
const APP_1 = '1.0.0'
const DEPLOYED = 'deployed'

const SESSION_VAR = 'k8s_session'
const TOKEN_VAR = 'k8s_token'

/** Every variable a Block writes through a capture, by declared type. */
const CAPTURE_TARGETS: Record<string, string> = {
  [SESSION_VAR]: 'string',
  install_result: 'table',
  install_status: 'string',
  read_result: 'table',
  read_status: 'string',
}

/** Captures of an output the block declares secret: declared secret, as the Secret box it opens with (SECUI-4, K8SCON-4). */
const SECRET_CAPTURES = new Set([SESSION_VAR])

/** How a capture target is declared before its Block writes it: its type, secret when its output is. */
function captureDeclaration(name: string, type: string): Record<string, unknown> {
  return SECRET_CAPTURES.has(name) ? { type, secret: true } : { type }
}

type Finding = { code?: string; severity?: string; step?: string }

/** Findings shorn of their prose, so the assertion names the rule rather than
 *  the sentence the rule happens to word it with. */
function advisories(findings: unknown): Array<Record<string, unknown>> {
  return (findings as Finding[]).map((entry) => ({
    code: entry.code,
    severity: entry.severity,
    step: entry.step,
  }))
}

let run: SeededRun
let release: string

interface McpToolResult {
  isError: boolean
  payload: Record<string, any>
}

function callMcpTool(tool: string, recipe: string): McpToolResult {
  const stdout = execFileSync(
    'poetry',
    ['run', 'python', MCP_CLIENT, `http://127.0.0.1:${MCP_PORT}/mcp`, tool],
    { cwd: BACKEND_DIR, input: recipe, timeout: 90_000, encoding: 'utf-8' },
  )
  const lastLine = stdout.trim().split('\n').pop() ?? ''
  return JSON.parse(lastLine) as McpToolResult
}

/** The recipe under test. No `label` rows: the compiler falls back to each
 *  block's catalog name, which is exactly what the palette factories write, so
 *  the Block names are part of the comparison rather than exempt from it. */
function recipeYaml(name: string): string {
  return [
    'test:',
    `  name: ${name}`,
    '  description: Helm blocks authored through the recipe surface',
    '  tags: [e2e, helm]',
    'variables:',
    `  ${TOKEN_VAR}: {type: string, secret: true, value: "${K8S_ADMIN_TOKEN}"}`,
    'flow:',
    '  - block: k8s-connect',
    '    settings:',
    `      api_url: "${API_URL}"`,
    `      namespace: "${run.namespace}"`,
    '      timeout: 30',
    '      verify_ssl: false',
    `      token: {expr: "${TOKEN_VAR}"}`,
    '    capture:',
    `      session: ${SESSION_VAR}`,
    '  - block: helm-install',
    '    settings:',
    `      session: {expr: "${SESSION_VAR}"}`,
    `      release: "${release}"`,
    `      chart: "${CHART.demo}"`,
    `      version: "${V_0_1}"`,
    `      repo: "${CHART_REPO_URL}"`,
    '    capture:',
    '      result: install_result',
    '      status: install_status',
    '  - block: helm-status',
    '    settings:',
    `      session: {expr: "${SESSION_VAR}"}`,
    `      release: "${release}"`,
    '    capture:',
    '      result: read_result',
    '      status: read_status',
    '  - block: log',
    '    settings:',
    `      message: {expr: "'${MCP_MARKER}'"}`,
    '      level: INFO',
    '',
  ].join('\n')
}

/** The choice-list and true / false values a Block holds from the moment it is created (FIELD-8). */
const CREATED_WITH = {
  'k8s-connect': { acquire_run_token: false, tls_min_version: '1.2', tls_max_version: '1.3' },
  'helm-install': {
    atomic: false,
    create_namespace: false,
    on_error: 'fail',
    output_format: 'table',
    repo_verify_ssl: true,
  },
  'helm-status': { on_error: 'fail', output_format: 'table' },
} as const

/** The same four Blocks, hand-built from the shared node factories as the palette creates them. */
function handBuiltFixture(): Record<string, unknown> {
  const nodes: WorkflowNode[] = stackNodes([
    k8sConnectNode({
      id: 'connect-k8s',
      expressionFields: ['token'],
      values: {
        ...CREATED_WITH['k8s-connect'],
        api_url: API_URL,
        namespace: run.namespace,
        timeout: 30,
        verify_ssl: false,
        token: TOKEN_VAR,
      },
      outputBindings: { session: SESSION_VAR },
    }),
    helmInstallNode({
      id: 'helm-install',
      expressionFields: ['session'],
      values: {
        ...CREATED_WITH['helm-install'],
        session: SESSION_VAR,
        release,
        chart: CHART.demo,
        version: V_0_1,
        repo: CHART_REPO_URL,
      },
      outputBindings: { result: 'install_result', status: 'install_status' },
    }),
    helmStatusNode({
      id: 'helm-status',
      expressionFields: ['session'],
      values: { ...CREATED_WITH['helm-status'], session: SESSION_VAR, release },
      outputBindings: { result: 'read_result', status: 'read_status' },
    }),
    markerNode({ id: 'log-done', description: '', text: MCP_MARKER }),
  ])
  return {
    name: `${BASE_NAME} Hand Built`,
    version: '1.0.0',
    description: 'Helm blocks authored through the recipe surface',
    workflow: {
      nodes,
      edges: [
        { id: 'edge-start-connect-k8s', source: 'start-node', target: 'connect-k8s' },
        { id: 'edge-connect-k8s-helm-install', source: 'connect-k8s', target: 'helm-install' },
        { id: 'edge-helm-install-helm-status', source: 'helm-install', target: 'helm-status' },
        { id: 'edge-helm-status-log-done', source: 'helm-status', target: 'log-done' },
      ],
    },
    variables: {
      [TOKEN_VAR]: { value: K8S_ADMIN_TOKEN, type: 'string', scope: 'test', secret: true },
      // A capture target is declared by its type alone: it holds null until its Block writes it.
      ...Object.fromEntries(
        Object.entries(CAPTURE_TARGETS).map(([name, type]) => [
          name,
          { ...captureDeclaration(name, type), scope: 'test' },
        ]),
      ),
    },
    metadata: { tags: ['e2e', 'helm'], suite_id: null, parent_suite: null },
  }
}

// --- reading a persisted Test back, shorn of what identity alone decides ----

type PersistedNode = { id: string; data: Record<string, any> }
type PersistedEdge = {
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
}
type PersistedTest = {
  workflow: { nodes: PersistedNode[]; edges: PersistedEdge[] }
  variables: Record<string, { type: string; value?: unknown; secret?: boolean }>
}

async function readTest(
  request: { get: (url: string) => Promise<any> },
  testId: string,
): Promise<PersistedTest> {
  const resp = await request.get(`${BACKEND_URL}/tests/${testId}`)
  const body = await resp.json().catch(() => null)
  expect(resp.ok(), `GET /tests/${testId} failed: ${resp.status()}`).toBeTruthy()
  return (body.data ?? body) as PersistedTest
}

/** What a Block IS, with everything a node id or a canvas position decides
 *  left out: geometry, per-instance description and recipe bookkeeping. */
function blocksOf(persisted: PersistedTest): Array<Record<string, unknown>> {
  return persisted.workflow.nodes.map((node) => ({
    label: node.data.label,
    elementType: node.data.elementType,
    nodeType: node.data.nodeType,
    version: node.data.version,
    values: node.data.config?.values ?? {},
    captures: node.data.config?.outputBindings ?? {},
    profiles: node.data.config?.profileBindings ?? [],
    expressionFields: [...(node.data.expressionFields ?? [])].sort(),
    templateFields: [...(node.data.templateFields ?? [])].sort(),
  }))
}

/** The wiring as positions in the Block list, so two documents that name their
 *  nodes differently are still comparable. */
function wiringOf(persisted: PersistedTest): string[] {
  const index = new Map(persisted.workflow.nodes.map((node, at) => [node.id, String(at)]))
  return persisted.workflow.edges
    .map((edge) =>
      [
        index.get(edge.source) ?? edge.source,
        edge.sourceHandle ?? '-',
        index.get(edge.target) ?? edge.target,
        edge.targetHandle ?? '-',
      ].join('>'),
    )
    .sort()
}

/** Declared variables, minus the storage scope and minus every secret's value
 *  (a sealed credential is not readable, and is not what this compares). */
function variablesOf(persisted: PersistedTest): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(persisted.variables).map(([name, entry]) => [
      name,
      entry.secret
        ? { type: entry.type, secret: true }
        : { type: entry.type, value: entry.value ?? null },
    ]),
  )
}

test.describe('Helm Blocks authored through the MCP recipe surface', () => {
  test.beforeAll(async ({ request }) => {
    test.setTimeout(180_000)
    run = await seedRun(request, 'minimal')
    release = releaseName('hl11', run.suffix)
  })

  test.afterAll(async ({ request }) => {
    if (run) await uninstallQuietly(request, { namespace: run.namespace, release })
    await run?.teardown()
  })

  test.beforeEach(async ({ page }) => {
    await resetMcpSettings(page)
  })

  test.afterEach(async ({ page }) => {
    // The spec must leave the listener disabled even if an assertion failed.
    await resetMcpSettings(page)
  })

  test('a Helm recipe compiles into the hand-built Test, and it runs (HL-11)', async ({
    page,
  }) => {
    test.setTimeout(300_000)
    const name = `${BASE_NAME} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const recipe = recipeYaml(name)
    let recipeTestId = ''

    await test.step('the MCP listener comes up on this stack', async () => {
      expect(await enableMcpUntilRestart(page, MCP_PORT)).toBe(
        `http://127.0.0.1:${MCP_PORT}/mcp`,
      )
    })

    await test.step('HL-11: the dry run reports the recipe valid and persists nothing', async () => {
      const result = callMcpTool('validate_recipe', recipe)
      expect(result.isError).toBe(false)
      expect(
        result.payload.valid,
        `validate_recipe findings: ${JSON.stringify(result.payload.findings)}`,
      ).toBe(true)
      // The secret reaches K8s Connect's secret `token` setting, which masks what it resolves to: no advisory.
      expect(
        advisories(result.payload.findings),
        `validate_recipe findings: ${JSON.stringify(result.payload.findings)}`,
      ).toEqual([])
      expect(result.payload.test_name).toBe(name)

      const list = await page.request.get(
        `${BACKEND_URL}/tests?search=${encodeURIComponent(name)}`,
      )
      expect((await list.json()).data ?? []).toHaveLength(0)
    })

    await test.step('HL-11: the create persists a Test that passes platform validation', async () => {
      const result = callMcpTool('create_test_from_recipe', recipe)
      expect(result.isError).toBe(false)
      expect(
        result.payload.created,
        `create findings: ${JSON.stringify(result.payload.findings)}`,
      ).toBe(true)
      expect(result.payload.name).toBe(name)
      expect(
        advisories(result.payload.warnings),
        `create warnings: ${JSON.stringify(result.payload.warnings)}`,
      ).toEqual([])
      recipeTestId = result.payload.test_id
      expect(recipeTestId).toBeTruthy()

      const validateResp = await page.request.post(`${BACKEND_URL}/tests/${recipeTestId}/validate`)
      const validateBody = await validateResp.json().catch(() => null)
      expect(validateResp.ok()).toBeTruthy()
      const errors =
        validateBody?.data?.errors ??
        validateBody?.error?.details?.[0]?.errors ??
        validateBody?.errors ??
        []
      expect(errors, `validation errors: ${JSON.stringify(errors)}`).toHaveLength(0)
    })

    await test.step('the MCP listener goes back down before the UI phase', async () => {
      await resetMcpSettings(page)
      const status = await (await page.request.get(`${BACKEND_URL}/mcp/status`)).json()
      expect(status.running).toBe(false)
      expect(status.urls).toEqual([])
    })

    await test.step('HL-11: the readback is the hand-built Test, Block for Block', async () => {
      const handBuiltId = await importFixtureTest(page, handBuiltFixture())
      const authored = await readTest(page.request, recipeTestId)
      const handBuilt = await readTest(page.request, handBuiltId)

      expect(blocksOf(authored), 'the recipe must compile the same Blocks').toEqual(
        blocksOf(handBuilt),
      )
      expect(wiringOf(authored), 'the recipe must wire them the same way').toEqual(
        wiringOf(handBuilt),
      )
      expect(variablesOf(authored), 'the recipe must declare the same variables').toEqual(
        variablesOf(handBuilt),
      )
      const noValue = Object.fromEntries(
        Object.entries(CAPTURE_TARGETS).map(([name, type]) => [
          name,
          SECRET_CAPTURES.has(name) ? { type, secret: true } : { type, value: null },
        ]),
      )
      for (const [side, persisted] of [
        ['recipe', authored],
        ['hand-built', handBuilt],
      ] as const) {
        const declared = variablesOf(persisted)
        expect(
          Object.fromEntries(Object.keys(CAPTURE_TARGETS).map((name) => [name, declared[name]])),
          `the ${side} Test declares every capture target by its type, with no value`,
        ).toEqual(noValue)
      }
    })

    await test.step('the recipe-authored Test opens on the canvas', async () => {
      await page.request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => {})
      await ensureEnvironment(page.request)
      await page.goto(`/workbench?editTest=${recipeTestId}`)
      await page.evaluate(() => localStorage.clear())
      await page.goto(`/workbench?editTest=${recipeTestId}`)
      await waitForCanvasLoad(page)
    })

    await test.step('HL-11: running it installs the chart and reads the release back', async () => {
      const status = await startRun(page)
      const logs = await finishRun(page, status, MCP_MARKER, 240_000)
      const all = logs.join('\n')
      const sessionId = await getActiveSessionId(page)
      const vars = (await getSessionVariables(page, sessionId)) as SessionVariables
      const row = {
        name: release,
        namespace: run.namespace,
        revision: 1,
        status: DEPLOYED,
        chart: CHART_0_1,
        appVersion: APP_1,
      }

      expectReleaseRow(vars, 'install', row)
      expect(statusOf(vars, 'install'), `the install Status scalar.\n${all}`).toBe(DEPLOYED)
      expectLine(logs, installedLine(release, 1))

      expectReleaseRow(vars, 'read', row)
      expect(statusOf(vars, 'read'), `the read-back Status scalar.\n${all}`).toBe(DEPLOYED)
      expectLine(logs, readReleaseLine(release, 1))
    })
  })
})
