/**
 * The block-timeout suite's leg model, its fixture builder and the assertions
 * both specs share.
 *
 * The table IS the checklist. Each leg names the `TO-` ids it proves, builds
 * its own Block with that Block's own factory, and pins the exact sentence the
 * Block must say when its Timeout runs out. A leg either raises, and a
 * Try/Catch carries the caught message onto the console, or records, and binds
 * the output core so the Reason can be read back.
 */

import { expect, type Page } from '../../helpers/playwright-fixtures'
import { expectNodeStatus, finishRun, startRun } from '../../helpers/k8s-run'
import {
  getActiveSessionId,
  getSessionVariables,
  importValidateAndNavigate,
} from '../../helpers/fixture-import'
import {
  edge,
  handleEdge,
  k8sConnectNode,
  markerNode,
  stackNodes,
  tryCatchNode,
  type WorkflowEdge,
  type WorkflowNode,
} from '../../helpers/k8s-nodes'
import {
  HTTP_FIXTURE_HOST_SENTINEL,
  K8S_STUB_CA_PEM,
  K8S_STUB_HOST,
  K8S_STUB_PORT,
} from '../../helpers/config'

// ---------------------------------------------------------------------------
// The stalling cluster
// ---------------------------------------------------------------------------

/** The stub as a fixture carries it; `injectHttp` rewrites the sentinel. */
const STUB_FIXTURE_BASE = `https://${HTTP_FIXTURE_HOST_SENTINEL}:${K8S_STUB_PORT}`

/** The stub as WAVE reaches it, which is what an error message names. */
const STUB_REACHED_BASE = `https://${K8S_STUB_HOST}:${K8S_STUB_PORT}`

/**
 * How long the stub holds an answer, in seconds. Well above every Timeout a
 * leg types, including the widest cleanup-room bound: a leg must be killed by
 * its own deadline, never reach the stalled answer and refuse for some other
 * reason.
 */
export const STALL_SECONDS = 10

/** Every RESOURCE read stalls; discovery stays fast, so Connect still succeeds. */
export const DELAY_PREFIX = `/cfg/delay=${STALL_SECONDS}`

/** Discovery stalls too, so K8s Connect can be made to pass its own Timeout. */
export const VDELAY_PREFIX = `/cfg/vdelay=${STALL_SECONDS}`

/** The stub URL a fixture carries. */
export const stubUrl = (prefix: string): string => `${STUB_FIXTURE_BASE}${prefix}`

/** The same URL as the running block reports it. */
export const reachedStubUrl = (prefix: string): string => `${STUB_REACHED_BASE}${prefix}`

/** The Timeout every guarded leg types, in seconds. */
export const SHORT_TIMEOUT = 1

/** The Timeout the session head types, well above the stall. */
export const GENEROUS_TIMEOUT = 30

// ---------------------------------------------------------------------------
// The sentences a block says when its Timeout runs out
// ---------------------------------------------------------------------------

/** A count of seconds as the block words it: singular only for exactly one. */
export const secondsText = (seconds: number): string =>
  `${seconds} ${seconds === 1 ? 'second' : 'seconds'}`

/** A REST request the cluster never answered. */
export const restTimeoutMessage = (method: string, path: string, seconds: number): string =>
  `Kubernetes API request ${method} ${path} timed out after ${secondsText(seconds)}`

/** K8s Connect's own version read, which never came back. */
export const connectTimeoutMessage = (apiUrl: string, seconds: number): string =>
  `Could not read the Kubernetes version from ${apiUrl}: ` +
  restTimeoutMessage('GET', '/version', seconds)

/** A helm run the process deadline killed; the deadline is what the block names. */
export const helmDeadlineMessage = (verb: string, seconds: number): string =>
  `helm ${verb} did not finish within ${seconds} s`

/** The Reason a timed-out helm run classifies to. */
export const TIMEOUT_REASON = 'Timeout'

// ---------------------------------------------------------------------------
// Leg model
// ---------------------------------------------------------------------------

/** The identity and bindings the builder hands a leg's own node factory. */
export type NodeSlot = {
  id: string
  description: string
  expressionFields: string[]
  outputBindings: Record<string, string>
}

export type TimeoutLeg = {
  /** Short key: the node is `to-<key>`, its variables are `<key>_*`. */
  key: string
  /** The `TO-` ids this leg proves. */
  ids: readonly string[]
  /** What the leg is, for the marker and the Block name. */
  what: string
  /** The exact sentence the Block must say. */
  message: string
  /** The Block, built with its own factory so its values stay typed here. */
  node: (slot: NodeSlot) => WorkflowNode
  /** The Block records its failure instead of raising: it binds the output
   *  core, paints amber, and reports the Reason below. */
  records?: boolean
  /** The Reason a recorded leg must report. */
  reason?: string
}

/** A Block name is capped at 64 characters by DESCRIPTION_TOO_LONG. */
const MAX_BLOCK_NAME = 64

export const nodeId = (leg: TimeoutLeg): string => `to-${leg.key}`

export const okVar = (key: string): string => `${key}_ok`
export const errorVar = (key: string): string => `${key}_err`
export const reasonVar = (key: string): string => `${key}_reason`
/** The map a Try/Catch binds the caught error to. */
export const caughtVar = (key: string): string => `${key}_caught`

/** The marker one leg writes, so a failure names the row it broke. */
export const legMarker = (leg: TimeoutLeg): string => `[${leg.ids.join('|')}]`

/** The unique head of one leg's console line: its ids and its key. */
export const markerLine = (leg: TimeoutLeg): string => `${legMarker(leg)} ${leg.key}`

/** The head of the line a guarded leg prints on its then branch. */
export const caughtPrefix = (leg: TimeoutLeg): string => `${markerLine(leg)} msg=`

export function blockName(leg: TimeoutLeg): string {
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

/** The one session variable every riding Block reads. */
export const SESSION_VARIABLE = 'k8s_session'
const CA_VARIABLE = 'k8s_stub_ca'
const START_NODE_ID = 'start-node'

export interface TimeoutMaterial {
  /** The Test name. */
  name: string
  /** The console marker the harvest gates on. */
  bookend: string
  /** The namespace the session head carries. */
  namespace: string
  /** The stub prefix the session head connects through. */
  prefix?: string
  /** Omit the session head: the spec's own first leg is the Connect. */
  connect?: false
  /** Extra fixture variables. */
  variables?: Record<string, FixtureVariable>
}

/** A K8s Connect against the stub, with whatever Timeout and prefix are asked for. */
export function stubConnectNode(opts: {
  id: string
  description: string
  prefix: string
  namespace: string
  timeout: number
  outputBindings?: Record<string, string>
}): WorkflowNode {
  return k8sConnectNode({
    id: opts.id,
    description: opts.description,
    expressionFields: ['ca_cert'],
    values: {
      api_url: stubUrl(opts.prefix),
      namespace: opts.namespace,
      timeout: opts.timeout,
      verify_ssl: true,
      ca_cert: CA_VARIABLE,
    },
    outputBindings: opts.outputBindings ?? { session: SESSION_VARIABLE },
  })
}

/** Which outputs a leg binds. A guarded leg binds nothing: it raises, so the
 *  engine never reaches the bindings. */
function legBindings(
  leg: TimeoutLeg,
  variables: Record<string, FixtureVariable>,
): Record<string, string> {
  const declare = (name: string, value: unknown, type: string): void => {
    variables[name] = { value, type, scope: 'test' }
  }
  if (!leg.records) {
    declare(caughtVar(leg.key), {}, 'map')
    return {}
  }
  declare(okVar(leg.key), false, 'boolean')
  declare(errorVar(leg.key), '', 'string')
  declare(reasonVar(leg.key), '', 'string')
  return { success: okVar(leg.key), error: errorVar(leg.key), reason: reasonVar(leg.key) }
}

/** A recorded leg's marker: its ids, its Reason and the sentence it recorded. */
function recordedMarker(leg: TimeoutLeg): WorkflowNode {
  return markerNode({
    id: `log-${leg.key}`,
    description: `Marker for ${leg.key}`,
    expression:
      `f'${markerLine(leg)} ok={${okVar(leg.key)}} ` +
      `reason={${reasonVar(leg.key)}} msg={${errorVar(leg.key)}}'`,
  })
}

/** A Try/Catch-wrapped leg: the catch branch stamps its marker and the then
 *  branch prints the caught message, which is where the chain carries on. */
function guardedNodes(
  leg: TimeoutLeg,
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
        expression:
          `f"${caughtPrefix(leg)}` + `{${bound}['message'] if ${bound} else 'NO-ERROR-CAUGHT'}"`,
      }),
    ],
    edges: [
      handleEdge(guard, 'try', block.id),
      handleEdge(guard, 'catch', caught),
      handleEdge(guard, 'then', message),
    ],
  }
}

/** Build a whole proof: the session head, one Block plus one marker per leg,
 *  and the bookend. */
export function buildTimeoutFixture(
  legs: readonly TimeoutLeg[],
  material: TimeoutMaterial,
): Record<string, unknown> {
  const variables: Record<string, FixtureVariable> = {
    [CA_VARIABLE]: { value: K8S_STUB_CA_PEM, type: 'string', scope: 'test' },
    [SESSION_VARIABLE]: { value: '', type: 'string', scope: 'test' },
    ...(material.variables ?? {}),
  }

  const nodes: WorkflowNode[] = []
  if (material.connect !== false) {
    nodes.push(
      stubConnectNode({
        id: 'connect-k8s',
        description: `Session for ${SESSION_VARIABLE}`,
        prefix: material.prefix ?? DELAY_PREFIX,
        namespace: material.namespace,
        timeout: GENEROUS_TIMEOUT,
      }),
    )
  }

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
    const block = leg.node({
      id: nodeId(leg),
      description: blockName(leg),
      expressionFields: ['session'],
      outputBindings: legBindings(leg, variables),
    })
    if (leg.records) {
      const marker = recordedMarker(leg)
      nodes.push(block, marker)
      link(block.id)
      link(marker.id)
      continue
    }
    const guarded = guardedNodes(leg, block)
    nodes.push(...guarded.nodes)
    link(guarded.nodes[0].id)
    edges.push(...guarded.edges)
    previous = guarded.nodes[guarded.nodes.length - 1].id
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
// Shared assertions
// ---------------------------------------------------------------------------

export type SessionVariables = Record<string, { value: unknown; type: string }>

function cell(vars: SessionVariables, name: string): { value: unknown; type: string } {
  const found = vars[name]
  expect(found, `variable "${name}" was never bound`).toBeTruthy()
  return found
}

/** Every leg stamped its ids on the console, so a failure names the row. */
export function expectMarkers(logs: readonly string[], legs: readonly TimeoutLeg[]): void {
  const all = logs.join('\n')
  for (const leg of legs) {
    expect(
      logs.some((text) => text.includes(markerLine(leg))),
      `${leg.key} (${leg.ids.join(', ')}) never reached its marker.\n${all}`,
    ).toBeTruthy()
  }
}

/** A guarded leg: the catch branch ran, and the caught message is the exact
 *  sentence the leg's case declares. */
export function expectTimedOut(logs: readonly string[], leg: TimeoutLeg): void {
  const all = logs.join('\n')
  expect(
    logs.some((text) => text === `${markerLine(leg)} caught`),
    `${leg.key}: the catch branch never ran, so the Block did not refuse.\n${all}`,
  ).toBeTruthy()
  const line = logs.find((text) => text.startsWith(caughtPrefix(leg))) ?? ''
  expect(line, `${leg.key}: wrong timeout message.\n${all}`).toBe(
    `${caughtPrefix(leg)}${leg.message}`,
  )
}

/** A recorded leg: success false, the exact sentence, and the Reason. */
export function expectRecordedTimeout(vars: SessionVariables, leg: TimeoutLeg): void {
  expect(cell(vars, okVar(leg.key)).value, `${leg.key} must report success false`).toBe(false)
  expect(String(cell(vars, errorVar(leg.key)).value), `${leg.key} error`).toBe(leg.message)
  expect(String(cell(vars, reasonVar(leg.key)).value), `${leg.key} reason`).toBe(leg.reason)
}

/** Every recorded leg's Block painted amber; a guarded one raised, so it is skipped. */
export async function expectLegStatuses(
  page: Page,
  legs: readonly TimeoutLeg[],
): Promise<void> {
  for (const leg of legs) {
    if (!leg.records) continue
    await expectNodeStatus(page, nodeId(leg), 'warning')
  }
}

// ---------------------------------------------------------------------------
// Run helper
// ---------------------------------------------------------------------------

export interface TimeoutRunOutcome {
  logs: string[]
  all: string
  vars: SessionVariables
  /** Wall-clock seconds the whole run took, start to bookend. */
  elapsedSeconds: number
}

/** Import the built fixture, run it, and read back everything a proof needs. */
export async function runTimeoutFixture(
  page: Page,
  fixture: Record<string, unknown>,
  marker: string,
  timeoutMs = 240_000,
): Promise<TimeoutRunOutcome> {
  await importValidateAndNavigate(page, fixture, { injectHttp: true })
  const started = Date.now()
  const status = await startRun(page)
  const logs = await finishRun(page, status, marker, timeoutMs)
  const elapsedSeconds = (Date.now() - started) / 1000
  const sessionId = await getActiveSessionId(page)
  const vars = (await getSessionVariables(page, sessionId)) as SessionVariables
  return { logs, all: logs.join('\n'), vars, elapsedSeconds }
}
