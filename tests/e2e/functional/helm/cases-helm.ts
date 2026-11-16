/**
 * The Helm suite's leg model, its fixture builder and the assertions every
 * Helm spec shares.
 *
 * The table IS the checklist. Each leg names the `HL-` ids it proves (the id
 * matrix is in the suite README), the exact Block values, and how its outputs
 * are bound. A spec builds one chained workflow per proof from these legs with
 * the shared node factories, so a proof reads as a list of Blocks rather than
 * as JSON.
 *
 * Three exported groups: the endpoints and names the stack serves, the leg
 * model and its fixture builder, and the console-line and Result-table
 * assertions the specs read their results through.
 */

import { expect, type APIRequestContext, type Page } from '../../helpers/playwright-fixtures'
import { expectNodeStatus, finishRun, finishRunAnyVerdict, getNodeStatuses, startRun } from '../../helpers/k8s-run'
import {
  getActiveSessionId,
  getSessionVariables,
  importValidateAndNavigate,
} from '../../helpers/fixture-import'
import {
  edge,
  handleEdge,
  helmInstallNode,
  helmResultType,
  helmRollbackNode,
  helmStatusNode,
  helmTestNode,
  helmUninstallNode,
  helmUpgradeNode,
  k8sConnectNode,
  k8sReadNode,
  markerNode,
  stackNodes,
  tryCatchNode,
  type HelmInstallValues,
  type HelmRollbackValues,
  type HelmStatusValues,
  type HelmTestValues,
  type HelmUninstallValues,
  type HelmUpgradeValues,
  type WorkflowEdge,
  type WorkflowNode,
} from '../../helpers/k8s-nodes'
import {
  CHART_REPO_HOST,
  CHART_REPO_INTERNAL_SERVICE,
  CHART_REPO_PORT,
  CHART_REPO_TLS_PORT,
  HTTP_FIXTURE_HOST_SENTINEL,
  K8S_ADMIN_TOKEN,
  K8S_API_HOST,
  K8S_API_PORT,
  K8S_CA_PEM,
} from '../../helpers/config'

// ---------------------------------------------------------------------------
// Endpoints and names
// ---------------------------------------------------------------------------

/** The fixture-side API URL. `injectHttp` rewrites it in container-shard mode. */
export const K8S_API_URL = `https://${HTTP_FIXTURE_HOST_SENTINEL}:${K8S_API_PORT}`

/** The chart repository, plain HTTP and no auth. Port 9463 sits outside
 *  `injectHttp`'s rewrite range, so the URL is mode-correct as built. */
export const CHART_REPO_URL = `http://${CHART_REPO_HOST}:${CHART_REPO_PORT}`

/** The same repository over TLS, behind basic auth. */
export const CHART_REPO_TLS_URL = `https://${CHART_REPO_HOST}:${CHART_REPO_TLS_PORT}`

/** The repository as a host inside the compose network reaches it. */
export const CHART_REPO_INTERNAL_URL = `http://${CHART_REPO_INTERNAL_SERVICE}:${CHART_REPO_PORT}`

/** The sshd host's own name, as helm's not-found message reports it. */
export const SSH_REMOTE_HOSTNAME = 'wave-e2e-host'

/** The helm the E2E image installs, on PATH on both loci. */
export const HELM_ON_PATH = '/usr/local/bin/helm'

/** The fixture charts the repository serves. */
export const CHART = {
  demo: 'wave-demo',
  badTest: 'wave-demo-badtest',
  stuck: 'wave-demo-stuck',
} as const

/** `DESCRIPTION_TOO_LONG` fires above this, on save and on run alike. */
export const MAX_BLOCK_NAME = 64

/** The one session variable every Helm Block rides. */
export const SESSION_VARIABLE = 'k8s_session'

/** The columns a release-shaped Result declares under Output Format = Table. */
export const RELEASE_COLUMNS = [
  'Name',
  'Namespace',
  'Revision',
  'Updated',
  'Status',
  'Chart',
  'App Version',
] as const
export const RELEASE_TYPES = [
  'string',
  'string',
  'integer',
  'string',
  'string',
  'string',
  'string',
] as const

/** The columns Helm Test declares under Output Format = Table. */
export const TEST_COLUMNS = ['Name', 'Kind', 'Phase', 'Started', 'Completed'] as const
export const TEST_TYPES = ['string', 'string', 'string', 'string', 'string'] as const

/** A helm release name is capped at 53 characters, so the run suffix rides a
 *  short topic rather than the spec's own name. */
const MAX_RELEASE_NAME = 53

export function releaseName(topic: string, suffix: string): string {
  const name = `wave-${topic}-${suffix}`
  if (name.length > MAX_RELEASE_NAME) {
    throw new Error(`release "${name}" is ${name.length} chars, over helm's ${MAX_RELEASE_NAME}`)
  }
  return name
}

export const resultVar = (key: string): string => `${key}_result`
export const statusVar = (key: string): string => `${key}_status`
export const logsVar = (key: string): string => `${key}_logs`
export const okVar = (key: string): string => `${key}_ok`
export const errorVar = (key: string): string => `${key}_err`
export const reasonVar = (key: string): string => `${key}_reason`
/** The map a Try/Catch binds the caught error to. */
export const caughtVar = (key: string): string => `${key}_caught`
/** Bound by a K8s Get or Events leg only. */
export const countVar = (key: string): string => `${key}_count`
export const namesVar = (key: string): string => `${key}_names`

/** The variables the built-in Connect rides. */
const TOKEN_VARIABLE = 'k8s_admin_token'
const CA_VARIABLE = 'k8s_ca'

/** The implicit node every chain leaves from. */
const START_NODE_ID = 'start-node'

// ---------------------------------------------------------------------------
// Leg model
// ---------------------------------------------------------------------------

/** The `result` type a bound K8s read leg declares. */
export type ReadResultType = 'map' | 'array' | 'table' | 'string'

const EMPTY_BY_TYPE: Record<ReadResultType, unknown> = {
  map: {},
  array: [],
  table: [],
  string: '',
}

export type HelmLegBase = {
  /** Short key: the node is `<block>-<key>`, its variables are `<key>_*`. */
  key: string
  /** The `HL-` ids this leg proves. */
  ids: readonly string[]
  /** What the leg is, for the marker and the Block name. */
  what: string
  /** The Block records its failure instead of raising: it binds the output
   *  core and is expected to paint amber. */
  records?: boolean
  /** The Block is expected to RAISE: a Try/Catch wraps it, the catch branch
   *  stamps a marker and the caught message rides the then branch. */
  guarded?: boolean
  /** Overrides the marker expression. */
  marker?: string
  /** Off leaves Result unbound; on by default for every Block that offers it. */
  bindResult?: boolean
  /** Helm Test only: bind the Logs output too. */
  bindLogs?: boolean
}

export type HelmLeg =
  | (HelmLegBase & { block: 'install'; values: HelmInstallValues })
  | (HelmLegBase & { block: 'upgrade'; values: HelmUpgradeValues })
  | (HelmLegBase & { block: 'rollback'; values: HelmRollbackValues })
  | (HelmLegBase & { block: 'uninstall'; values: HelmUninstallValues })
  | (HelmLegBase & { block: 'test'; values: HelmTestValues })
  | (HelmLegBase & { block: 'status'; values: HelmStatusValues })
  | (HelmLegBase & {
      block: 'get'
      values: Record<string, unknown>
      resultType: ReadResultType
    })
  | (HelmLegBase & {
      block: 'events'
      values: Record<string, unknown>
      resultType: ReadResultType
    })

/** The node id the spec addresses a leg's Block by. */
export const nodeId = (leg: HelmLeg): string => `${leg.block}-${leg.key}`

/** The marker one leg writes, so a failure names the row it broke. */
export const legMarker = (leg: HelmLeg): string => `[${leg.ids.join('|')}]`

/** The unique head of one leg's console line: its ids and its key. */
export const markerLine = (leg: HelmLeg): string => `${legMarker(leg)} ${leg.key}`

/** The head of the line a guarded leg prints on its then branch. */
export const caughtPrefix = (leg: HelmLeg): string => `${markerLine(leg)} msg=`

/** A Block name is capped, so the ids ride the marker line and the Block
 *  carries the leg key. */
export function blockName(leg: HelmLeg): string {
  const name = `${leg.key}: ${leg.what}`
  if (name.length > MAX_BLOCK_NAME) {
    throw new Error(`leg "${leg.key}" needs a shorter what: ${name.length} > ${MAX_BLOCK_NAME}`)
  }
  return name
}

// ---------------------------------------------------------------------------
// Fixture builder
// ---------------------------------------------------------------------------

export type FixtureVariable = { value: unknown; type: string; scope: string; secret?: boolean }

export interface HelmMaterial {
  /** The Test name. */
  name: string
  /** The console marker `finishRun` gates on. */
  bookend: string
  /** The run namespace the Connect carries. */
  namespace: string
  adminToken?: string
  caCert?: string
  /** Extra fixture variables (secrets, canaries). */
  variables?: Record<string, FixtureVariable>
  /** Blocks placed before the first Helm leg (extra Connects, Log markers). */
  before?: readonly WorkflowNode[]
  /** Omit the built-in K8s Connect: the spec wires its own session head. */
  connect?: false
  /** The `api_url` the built-in Connect carries. */
  apiUrl?: string
  /** Extra `config.values` for the built-in Connect, impersonation included. */
  connectValues?: Record<string, unknown>
}

function connectNode(material: HelmMaterial): WorkflowNode {
  return k8sConnectNode({
    id: 'connect-k8s',
    description: `Session for ${SESSION_VARIABLE}`,
    expressionFields: ['token', 'ca_cert'],
    values: {
      api_url: material.apiUrl ?? K8S_API_URL,
      namespace: material.namespace,
      timeout: 30,
      verify_ssl: true,
      ca_cert: CA_VARIABLE,
      token: TOKEN_VARIABLE,
      ...(material.connectValues ?? {}),
    },
    outputBindings: { session: SESSION_VARIABLE },
  })
}

function blockNode(leg: HelmLeg, bindings: Record<string, string>): WorkflowNode {
  const shared = {
    id: nodeId(leg),
    description: blockName(leg),
    expressionFields: ['session'],
  }
  const session = SESSION_VARIABLE
  const values = { session, ...leg.values }
  if (leg.block === 'install') return helmInstallNode({ ...shared, values, outputBindings: bindings })
  if (leg.block === 'upgrade') return helmUpgradeNode({ ...shared, values, outputBindings: bindings })
  if (leg.block === 'rollback') {
    return helmRollbackNode({ ...shared, values, outputBindings: bindings })
  }
  if (leg.block === 'uninstall') {
    return helmUninstallNode({ ...shared, values, outputBindings: bindings })
  }
  if (leg.block === 'test') return helmTestNode({ ...shared, values, outputBindings: bindings })
  if (leg.block === 'status') return helmStatusNode({ ...shared, values, outputBindings: bindings })
  return k8sReadNode({
    ...shared,
    elementType: leg.block === 'get' ? 'k8s-get' : 'k8s-events',
    values,
    outputBindings: bindings,
  })
}

/** Which outputs a leg binds, and the variable each one declares. A guarded
 *  leg binds nothing: it raises, so the engine never reaches the bindings. */
function legBindings(
  leg: HelmLeg,
  variables: Record<string, FixtureVariable>,
): Record<string, string> {
  const bindings: Record<string, string> = {}
  const declare = (name: string, value: unknown, type: string): void => {
    variables[name] = { value, type, scope: 'test' }
  }
  if (leg.guarded) {
    declare(caughtVar(leg.key), {}, 'map')
    return bindings
  }
  if (leg.block === 'get' || leg.block === 'events') {
    bindings.result = resultVar(leg.key)
    declare(resultVar(leg.key), EMPTY_BY_TYPE[leg.resultType], leg.resultType)
    bindings.count = countVar(leg.key)
    declare(countVar(leg.key), 0, 'integer')
    if (leg.block === 'get') {
      bindings.names = namesVar(leg.key)
      declare(namesVar(leg.key), [], 'array')
    }
  } else if (leg.block !== 'uninstall') {
    if (leg.bindResult ?? true) {
      const type = helmResultType(leg.values.output_format)
      bindings.result = resultVar(leg.key)
      declare(resultVar(leg.key), EMPTY_BY_TYPE[type], type)
    }
    if (leg.block === 'test') {
      if (leg.bindLogs) {
        bindings.logs = logsVar(leg.key)
        declare(logsVar(leg.key), '', 'string')
      }
    } else {
      bindings.status = statusVar(leg.key)
      declare(statusVar(leg.key), '', 'string')
    }
  }
  if (leg.records) {
    bindings.success = okVar(leg.key)
    bindings.error = errorVar(leg.key)
    bindings.reason = reasonVar(leg.key)
    declare(okVar(leg.key), false, 'boolean')
    declare(errorVar(leg.key), '', 'string')
    declare(reasonVar(leg.key), '', 'string')
  }
  return bindings
}

/** The line a leg stamps when it has nothing of its own to say. */
function defaultMarker(leg: HelmLeg): WorkflowNode {
  const id = `log-${leg.key}`
  const description = `Marker for ${leg.key}`
  if (leg.marker) return markerNode({ id, description, expression: leg.marker })
  if (leg.block === 'get' || leg.block === 'events') {
    return markerNode({
      id,
      description,
      expression: `f'${markerLine(leg)} count={${countVar(leg.key)}}'`,
    })
  }
  if (leg.block === 'uninstall' || leg.block === 'test') {
    return markerNode({ id, description, text: markerLine(leg) })
  }
  return markerNode({
    id,
    description,
    expression: `f'${markerLine(leg)} status={${statusVar(leg.key)}}'`,
  })
}

/** A Try/Catch-wrapped leg: the catch branch stamps its marker and the then
 *  branch prints the caught message, which is where the chain carries on. */
function guardedNodes(
  leg: HelmLeg,
  block: WorkflowNode,
): { nodes: WorkflowNode[]; edges: WorkflowEdge[] } {
  const guard = `tc-${leg.key}`
  const caught = `log-${leg.key}-caught`
  const message = `log-${leg.key}`
  const bound = caughtVar(leg.key)
  return {
    nodes: [
      tryCatchNode({ id: guard, description: `Guard for ${leg.key}`, errorBinding: bound }),
      block,
      markerNode({
        id: caught,
        description: `Catch branch for ${leg.key}`,
        text: `${markerLine(leg)} caught`,
      }),
      markerNode({
        id: message,
        description: `Caught message for ${leg.key}`,
        expression: `f"${caughtPrefix(leg)}{${bound}['message'] if ${bound} else 'NO-ERROR-CAUGHT'}"`,
      }),
    ],
    edges: [
      handleEdge(guard, 'try', block.id),
      handleEdge(guard, 'catch', caught),
      handleEdge(guard, 'then', message),
    ],
  }
}

/** Build a whole proof: the Connect it needs, whatever the spec puts in front,
 *  one Block plus one marker per leg, and the bookend. */
export function buildHelmFixture(
  legs: readonly HelmLeg[],
  material: HelmMaterial,
): Record<string, unknown> {
  const variables: Record<string, FixtureVariable> = {
    [CA_VARIABLE]: { value: material.caCert ?? K8S_CA_PEM, type: 'string', scope: 'test' },
    [TOKEN_VARIABLE]: {
      value: material.adminToken ?? K8S_ADMIN_TOKEN,
      type: 'string',
      scope: 'test',
      secret: true,
    },
    [SESSION_VARIABLE]: { value: '', type: 'string', scope: 'test' },
    ...(material.variables ?? {}),
  }

  const nodes: WorkflowNode[] = []
  if (material.connect !== false) nodes.push(connectNode(material))
  if (material.before) nodes.push(...material.before)

  const edges: WorkflowEdge[] = []
  let previous = START_NODE_ID
  const link = (target: string): void => {
    edges.push(
      previous === START_NODE_ID
        ? { id: `edge-start-${target}`, source: previous, target }
        : edge(previous, target),
    )
    previous = target
  }
  for (const node of nodes) link(node.id)

  for (const leg of legs) {
    const block = blockNode(leg, legBindings(leg, variables))
    if (leg.guarded) {
      const guarded = guardedNodes(leg, block)
      nodes.push(...guarded.nodes)
      link(guarded.nodes[0].id)
      edges.push(...guarded.edges)
      previous = guarded.nodes[guarded.nodes.length - 1].id
      continue
    }
    const marker = defaultMarker(leg)
    nodes.push(block, marker)
    link(block.id)
    link(marker.id)
  }

  const bookend = markerNode({ id: 'log-done', description: 'Bookend', text: material.bookend })
  nodes.push(bookend)
  link(bookend.id)

  return {
    name: material.name,
    version: '1.0.0',
    description: '',
    workflow: { nodes: stackNodes(nodes), edges },
    variables,
    metadata: { tags: [], suite_id: null, parent_suite: null },
  }
}

// ---------------------------------------------------------------------------
// Console lines the verbs print
// ---------------------------------------------------------------------------

export const installedLine = (release: string, revision: number): string =>
  `Installed release '${release}' as revision ${revision}`
export const upgradedLine = (release: string, revision: number): string =>
  `Upgraded release '${release}' to revision ${revision}`
export const rolledBackLine = (release: string, revision: number): string =>
  `Rolled release '${release}' back to revision ${revision}`
export const uninstalledLine = (release: string): string => `Uninstalled release '${release}'`
export const ranTestsLine = (hooks: number, release: string): string =>
  `Ran ${hooks} test hook(s) for release '${release}'`
export const readReleaseLine = (release: string, revision: number): string =>
  `Read release '${release}' at revision ${revision}`

/** The WARN line a recorded failure writes (connectivity/block_outputs._recorded_failure_line). */
export const recordedLine = (action: string, reason: string, message: string): string =>
  reason ? `${action} failed (${reason}): ${message}` : `${action} failed: ${message}`

// ---------------------------------------------------------------------------
// Shared assertions
// ---------------------------------------------------------------------------

export type SessionVariables = Record<string, { value: unknown; type: string }>
export type WaveTable = { columns: Array<{ name: string; type: string }>; rows: unknown[][] }

export function cell(vars: SessionVariables, name: string): { value: unknown; type: string } {
  const found = vars[name]
  expect(found, `variable "${name}" was never bound`).toBeTruthy()
  return found
}

export const resultOf = (vars: SessionVariables, key: string): { value: unknown; type: string } =>
  cell(vars, resultVar(key))
export const statusOf = (vars: SessionVariables, key: string): string =>
  String(cell(vars, statusVar(key)).value)
export const logsOf = (vars: SessionVariables, key: string): string =>
  String(cell(vars, logsVar(key)).value)
export const errorOf = (vars: SessionVariables, key: string): string =>
  String(cell(vars, errorVar(key)).value)
export const reasonOf = (vars: SessionVariables, key: string): string =>
  String(cell(vars, reasonVar(key)).value)
export const countOf = (vars: SessionVariables, key: string): number =>
  Number(cell(vars, countVar(key)).value)
export const namesOf = (vars: SessionVariables, key: string): string[] =>
  cell(vars, namesVar(key)).value as string[]

/** The release document a Map-format Result carries. */
export function releaseDoc(vars: SessionVariables, key: string): Record<string, any> {
  const found = resultOf(vars, key)
  expect(found.type, `${key} Result must be a map to read the release document`).toBe('map')
  return found.value as Record<string, any>
}

function tableOf(vars: SessionVariables, key: string): WaveTable {
  const found = resultOf(vars, key)
  expect(found.type, `${key} Result must be a table`).toBe('table')
  return found.value as WaveTable
}

function expectColumns(
  table: WaveTable,
  key: string,
  columns: readonly string[],
  types: readonly string[],
): void {
  expect(
    table.columns.map((column) => column.name),
    `${key} Result columns`,
  ).toEqual([...columns])
  expect(
    table.columns.map((column) => column.type),
    `${key} Result column types`,
  ).toEqual([...types])
}

/** The one release row, asserted whole: the columns, their types and every
 *  cell. `Updated` is helm's own deploy stamp, so it is asserted non-empty. */
export function expectReleaseRow(
  vars: SessionVariables,
  key: string,
  expected: {
    name: string
    namespace: string
    revision: number
    status: string
    chart: string
    appVersion: string
  },
): void {
  const table = tableOf(vars, key)
  expectColumns(table, key, RELEASE_COLUMNS, RELEASE_TYPES)
  expect(table.rows.length, `${key} Result must carry one release row`).toBe(1)
  const [name, namespace, revision, updated, status, chart, appVersion] = table.rows[0] as [
    string,
    string,
    number,
    string,
    string,
    string,
    string,
  ]
  expect(name, `${key} Name`).toBe(expected.name)
  expect(namespace, `${key} Namespace`).toBe(expected.namespace)
  expect(revision, `${key} Revision`).toBe(expected.revision)
  expect(String(updated).length, `${key} Updated must carry helm's deploy stamp`).toBeGreaterThan(0)
  expect(status, `${key} Status`).toBe(expected.status)
  expect(chart, `${key} Chart`).toBe(expected.chart)
  expect(appVersion, `${key} App Version`).toBe(expected.appVersion)
}

/** The release table with its columns kept and no row, which is what a
 *  recorded failure leaves behind. */
export function expectEmptyRelease(vars: SessionVariables, key: string): void {
  const table = tableOf(vars, key)
  expectColumns(table, key, RELEASE_COLUMNS, RELEASE_TYPES)
  expect(table.rows, `${key} Result rows`).toEqual([])
}

/** One test-hook table, asserted whole: the columns, their types and every
 *  hook's name, kind and phase, in document order. */
export function expectTestRows(
  vars: SessionVariables,
  key: string,
  expected: Array<{ name: string; kind: string; phase: string }>,
): void {
  const table = tableOf(vars, key)
  expectColumns(table, key, TEST_COLUMNS, TEST_TYPES)
  expect(
    table.rows.map((row) => [row[0], row[1], row[2]]),
    `${key} test hooks`,
  ).toEqual(expected.map((hook) => [hook.name, hook.kind, hook.phase]))
  for (const row of table.rows) {
    expect(row.length, `${key} hook row must carry every column`).toBe(TEST_COLUMNS.length)
  }
}

/** Every recorded failure reports the same core: success false, helm's own
 *  message and the Reason a workflow branches on. */
export function expectRecorded(
  vars: SessionVariables,
  key: string,
  expected: { message?: string; reason: string; contains?: string },
): void {
  expect(cell(vars, okVar(key)).value, `${key} must report success false`).toBe(false)
  expect(reasonOf(vars, key), `${key} reason`).toBe(expected.reason)
  if (expected.message !== undefined) {
    expect(errorOf(vars, key), `${key} error`).toBe(expected.message)
  }
  if (expected.contains !== undefined) {
    expect(errorOf(vars, key), `${key} error`).toContain(expected.contains)
  }
}

/** A guarded leg: the catch branch ran, and the caught message is the sentence
 *  the Block raised. */
export function expectCaught(
  logs: readonly string[],
  leg: HelmLeg,
  expected: { message?: string; contains?: string },
): void {
  const all = logs.join('\n')
  expect(
    logs.some((text) => text === `${markerLine(leg)} caught`),
    `${leg.key}: the catch branch never ran, so the Block did not refuse.\n${all}`,
  ).toBeTruthy()
  const line = logs.find((text) => text.startsWith(caughtPrefix(leg))) ?? ''
  if (expected.message !== undefined) {
    expect(line, `${leg.key}: wrong refusal message.\n${all}`).toBe(
      `${caughtPrefix(leg)}${expected.message}`,
    )
  }
  if (expected.contains !== undefined) {
    expect(line, `${leg.key}: wrong refusal message.\n${all}`).toContain(expected.contains)
  }
}

/** Every leg stamped its ids on the console, so a failure names the row. */
export function expectMarkers(logs: readonly string[], legs: readonly HelmLeg[]): void {
  const all = logs.join('\n')
  for (const leg of legs) {
    expect(
      logs.some((text) => text.includes(markerLine(leg))),
      `${leg.key} (${leg.ids.join(', ')}) never reached its marker.\n${all}`,
    ).toBeTruthy()
  }
}

/** The plugin line a leg must have printed, asserted whole. */
export function expectLine(logs: readonly string[], expectedLine: string): void {
  expect(
    logs.includes(expectedLine),
    `the plugin never printed: ${expectedLine}\n${logs.join('\n')}`,
  ).toBeTruthy()
}

/** Every leg's Block carries the status its case declares: amber for a
 *  recorded failure, green otherwise. A guarded leg raises, so it is skipped. */
export async function expectLegStatuses(page: Page, legs: readonly HelmLeg[]): Promise<void> {
  for (const leg of legs) {
    if (leg.guarded) continue
    await expectNodeStatus(page, nodeId(leg), leg.records ? 'warning' : 'success')
  }
}

/** No Block anywhere on the canvas painted amber. */
export async function expectNoAmber(page: Page): Promise<void> {
  const statuses = await getNodeStatuses(page)
  expect(
    statuses.filter((entry) => entry.status === 'warning'),
    `no Block may paint amber: ${JSON.stringify(statuses)}`,
  ).toEqual([])
}

// ---------------------------------------------------------------------------
// Run helpers
// ---------------------------------------------------------------------------

export interface HelmRunOutcome {
  logs: string[]
  all: string
  vars: SessionVariables
}

async function sessionVariables(page: Page): Promise<SessionVariables> {
  const sessionId = await getActiveSessionId(page)
  return (await getSessionVariables(page, sessionId)) as SessionVariables
}

/** Import the built fixture, run it, and read back everything a proof needs. */
export async function runHelmFixture(
  page: Page,
  fixture: Record<string, unknown>,
  marker: string,
  timeoutMs = 240_000,
): Promise<HelmRunOutcome> {
  await importValidateAndNavigate(page, fixture, { injectHttp: true })
  const status = await startRun(page)
  const logs = await finishRun(page, status, marker, timeoutMs)
  return { logs, all: logs.join('\n'), vars: await sessionVariables(page) }
}

/** The same, for a run that is meant to end on a verdict of its own. */
export async function runHelmFixtureAnyVerdict(
  page: Page,
  fixture: Record<string, unknown>,
  marker: string,
  timeoutMs = 240_000,
): Promise<HelmRunOutcome & { verdict: string | null }> {
  await importValidateAndNavigate(page, fixture, { injectHttp: true })
  const status = await startRun(page)
  const { verdict, logs } = await finishRunAnyVerdict(page, status, marker, timeoutMs)
  return { verdict, logs, all: logs.join('\n'), vars: await sessionVariables(page) }
}

// ---------------------------------------------------------------------------
// Cluster cleanup
// ---------------------------------------------------------------------------

const K8S_ROOT = `https://${K8S_API_HOST}:${K8S_API_PORT}`
const K8S_HEADERS = { Authorization: `Bearer ${K8S_ADMIN_TOKEN}` }

/** Remove a release's objects and its helm storage record, in case the run
 *  left them behind. Never throws: it runs beside the seeded teardown. */
export async function uninstallQuietly(
  request: APIRequestContext,
  opts: { namespace: string; release: string },
): Promise<void> {
  const instance = encodeURIComponent(`app.kubernetes.io/instance=${opts.release}`)
  const stored = encodeURIComponent(`owner=helm,name=${opts.release}`)
  const collections = [
    `/apis/apps/v1/namespaces/${opts.namespace}/deployments?labelSelector=${instance}`,
    `/api/v1/namespaces/${opts.namespace}/pods?labelSelector=${instance}`,
    `/api/v1/namespaces/${opts.namespace}/secrets?labelSelector=${stored}`,
  ]
  for (const path of collections) {
    await request.delete(`${K8S_ROOT}${path}`, { headers: K8S_HEADERS }).catch(() => undefined)
  }
  // Services carry no deletecollection verb, so they are listed and removed one by one.
  const listed = await request
    .get(`${K8S_ROOT}/api/v1/namespaces/${opts.namespace}/services?labelSelector=${instance}`, {
      headers: K8S_HEADERS,
    })
    .catch(() => null)
  const body = (await listed?.json().catch(() => null)) as {
    items?: Array<{ metadata?: { name?: string } }>
  } | null
  for (const item of body?.items ?? []) {
    const name = item.metadata?.name
    if (!name) continue
    await request
      .delete(`${K8S_ROOT}/api/v1/namespaces/${opts.namespace}/services/${name}`, {
        headers: K8S_HEADERS,
      })
      .catch(() => undefined)
  }
}
