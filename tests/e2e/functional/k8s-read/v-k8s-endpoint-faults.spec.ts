/**
 * V-K8S-READ-R6: endpoint faults, against the k8s-stub service.
 *
 * Nothing here talks to kwok and nothing is seeded. The stub
 * (tests/e2e/services/k8s-stub) answers Kubernetes discovery successfully and
 * faults only the resource read, so the Block reaches the read and renders the
 * HTTP error under test instead of "this cluster has no resource kind". The
 * fault rides in the K8s Connect api_url path prefix, one directive per path
 * segment, so a session is configured once and every read under it inherits it.
 *
 * Three runs:
 *   golden        -> the checked-in fixture-stub-golden.json, the reviewable
 *                    shape of a stub-backed session: a 503 carrying a Status
 *                    body renders the LIST read wording with the cluster's own
 *                    text and the kind named once (G-65).
 *   recorded      -> twelve legs generated from RECORDED_CASES, all under
 *                    On error = Record and continue, each asserting the exact
 *                    WARN console line, the exact bound error / reason /
 *                    success values, and the amber Block (G-64, G-65, G-66,
 *                    the wording traps, the Table-refusal arms, L-32).
 *   hard fails    -> five legs generated from GUARDED_CASES, each wrapped in a
 *                    Try/Catch so the run survives, plus the S-06 / G-67 pair:
 *                    the SAME session and the SAME read at timeout 1 fails and
 *                    at timeout 10 succeeds (S-06, G-67, T-26).
 *
 * L-32 is proved here and not on kwok because kwok cannot produce a
 * kubelet's waiting-to-start wording in any pod state - it serves the log body
 * with HTTP 200 for a container in `waiting`, and an unscheduled pod answers
 * 204 with an empty body, which WAVE renders as a SUCCESSFUL empty read. The
 * stub supplies the cluster half of the sentence, so what is proved here is the
 * half WAVE owns: the "Kubernetes rejected the log request: " prefix and the
 * verbatim passthrough of the cluster's text.
 *
 * Every leg carries its option id in its log marker, so a failure names the row
 * it broke.
 *
 * Design Decisions: K8SREAD-6, K8SREAD-9, K8SREAD-10
 * REQ: REQ-5.1.1, REQ-3.4.1.5
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { getLogEntries, type LogEntry } from '../../helpers/log-reader'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import {
  chainEdges,
  edge,
  handleEdge,
  k8sConnectNode,
  k8sReadNode,
  markerNode,
  stackNodes,
  tryCatchNode,
  type K8sReadElementType,
  type WorkflowEdge,
  type WorkflowNode,
} from '../../helpers/k8s-nodes'
import { expectNodeStatus, finishRun, startRun } from '../../helpers/k8s-run'
import {
  HTTP_FIXTURE_HOST_SENTINEL,
  K8S_STUB_CA_PEM,
  K8S_STUB_DEFAULT_MESSAGE,
  K8S_STUB_PORT,
} from '../../helpers/config'
import fs from 'fs'
import path from 'path'

/** The stub as fixtures carry it. The literal 127.0.0.1:9461 form is what the
 *  container-shard URL rewrite recognizes; injectHttp turns it into the slirp
 *  gateway address there and leaves it alone on the host. */
const STUB_BASE = `https://${HTTP_FIXTURE_HOST_SENTINEL}:${K8S_STUB_PORT}`

/** The namespace the K8s Connect Block sets, and therefore the one every read
 *  message quotes. Nothing is seeded - the stub answers any namespace. */
const NAMESPACE = 'wave-val'

/** Log-marker prefix. Every leg's marker starts with it plus the option id. */
const MARK = 'R6'

/** The cluster-supplied sentence the stub replays for L-32. kwok cannot
 *  produce it in any pod state, so the spec supplies it and pins the WAVE half. */
const WAITING_TEXT = 'container "app" in pod "web" is waiting to start: ContainerCreating'

const NOT_JSON_MESSAGE =
  'Kubernetes API response body is not JSON - check whether a proxy or gateway answered instead of the cluster'

const METRICS_MISSING_MESSAGE =
  "This cluster does not serve the metrics API 'metrics.k8s.io/v1beta1' - check whether metrics-server is installed"

type ReadValues = Record<string, unknown>

type FixtureVariable = { value: unknown; type: string; scope: string }

type BuiltWorkflow = {
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  variables: Record<string, FixtureVariable>
}

function fixtureOf(name: string, built: BuiltWorkflow): Record<string, unknown> {
  return {
    name,
    version: '1.0.0',
    description: '',
    workflow: { nodes: built.nodes, edges: built.edges },
    variables: built.variables,
    metadata: { tags: [], suite_id: null, parent_suite: null },
  }
}

/** A K8s Connect Block pointed at the stub, carrying one fault configuration. */
function stubConnectNode(id: string, prefix: string, sessionVar: string): WorkflowNode {
  return k8sConnectNode({
    id,
    description: `Stub session, prefix "${prefix || '(none)'}"`,
    values: {
      api_url: `${STUB_BASE}${prefix}`,
      namespace: NAMESPACE,
      timeout: 30,
      verify_ssl: true,
      ca_cert: 'k8s_stub_ca',
    },
    outputBindings: { session: sessionVar },
    expressionFields: ['ca_cert'],
  })
}

/** The CA variable every generated fixture carries. */
function stubCaVariable(): Record<string, FixtureVariable> {
  return { k8s_stub_ca: { value: K8S_STUB_CA_PEM, type: 'string', scope: 'test' } }
}

// ---------------------------------------------------------------------------
// The recorded sweep: the case table IS the checklist.
// ---------------------------------------------------------------------------

type RecordedCase = {
  /** The option row this leg proves. */
  optionId: string
  /** Node-id and variable-name stem. */
  key: string
  /** Stub configuration, as the api_url path prefix. */
  prefix: string
  elementType: K8sReadElementType
  /** Block config beyond `session` and `on_error`. */
  values: ReadValues
  /** The exact message the Block records. */
  message: string
  /** The Status reason the cluster sent, or null when the body carried none. */
  reason: string | null
  /** Substrings the message must NOT carry - the wording this row replaced. */
  mustNotContain?: readonly string[]
  /** An object name that must appear exactly once in the message. */
  namedOnce?: string
}

const GET_LIST: ReadValues = {
  resource_type: 'default',
  kind: 'Pod',
  search_by: 'list',
  output_format: 'map',
}

const GET_NAMED: ReadValues = {
  resource_type: 'default',
  kind: 'Pod',
  search_by: 'name',
  name: 'stub-one',
  output_format: 'map',
}

const RECORDED_CASES: readonly RecordedCase[] = [
  {
    optionId: 'G-64',
    key: 'g64',
    prefix: '',
    elementType: 'k8s-get',
    values: { ...GET_LIST, output_format: 'table' },
    message:
      "This cluster will not print a table for kind 'Pod' - choose Map, JSON or YAML for this kind",
    reason: 'NotAcceptable',
  },
  {
    optionId: 'G-65',
    key: 'g65named',
    prefix: '/cfg/status=503',
    elementType: 'k8s-get',
    values: GET_NAMED,
    message: `Kubernetes could not read Pod 'stub-one' in namespace '${NAMESPACE}': ${K8S_STUB_DEFAULT_MESSAGE}`,
    reason: 'ServiceUnavailable',
    mustNotContain: ['rejected the update'],
    namedOnce: "'stub-one'",
  },
  {
    optionId: 'G-65',
    key: 'g65msg',
    prefix: '/cfg/status=503/msg=the%20cluster%20is%20draining',
    elementType: 'k8s-get',
    values: GET_LIST,
    message: `Kubernetes could not list Pod objects in namespace '${NAMESPACE}': the cluster is draining`,
    reason: 'ServiceUnavailable',
    mustNotContain: ['rejected the update'],
  },
  {
    optionId: 'G-66',
    key: 'g66list503',
    prefix: '/cfg/status=503/body=html',
    elementType: 'k8s-get',
    values: GET_LIST,
    message: `Kubernetes could not list Pod objects in namespace '${NAMESPACE}' (HTTP 503)`,
    reason: null,
    mustNotContain: [K8S_STUB_DEFAULT_MESSAGE],
  },
  {
    optionId: 'G-66',
    key: 'g66named401',
    prefix: '/cfg/status=401/body=html',
    elementType: 'k8s-get',
    values: GET_NAMED,
    message: `Kubernetes could not read Pod 'stub-one' in namespace '${NAMESPACE}' (HTTP 401)`,
    reason: null,
    mustNotContain: ['Kubernetes API authentication failed'],
    namedOnce: "'stub-one'",
  },
  {
    optionId: 'G-66',
    key: 'g66list403',
    prefix: '/cfg/status=403/body=html',
    elementType: 'k8s-get',
    values: GET_LIST,
    message: `Kubernetes could not list Pod objects in namespace '${NAMESPACE}' (HTTP 403)`,
    reason: null,
    mustNotContain: ['Kubernetes API permission denied'],
  },
  {
    optionId: 'G-66',
    key: 'g66list400',
    prefix: '/cfg/status=400/body=html',
    elementType: 'k8s-get',
    values: GET_LIST,
    message: `Kubernetes could not list Pod objects in namespace '${NAMESPACE}' (HTTP 400)`,
    reason: null,
  },
  {
    optionId: 'READ-WORDING',
    key: 'trap401',
    prefix: '/cfg/status=401',
    elementType: 'k8s-get',
    values: GET_NAMED,
    message: `Kubernetes API authentication failed: ${K8S_STUB_DEFAULT_MESSAGE}`,
    reason: 'Unauthorized',
  },
  {
    optionId: 'READ-WORDING',
    key: 'trap403',
    prefix: '/cfg/status=403',
    elementType: 'k8s-get',
    values: GET_LIST,
    message: `Kubernetes API permission denied: ${K8S_STUB_DEFAULT_MESSAGE}`,
    reason: 'Forbidden',
  },
  {
    optionId: 'TABLE-KIND',
    key: 'e21plain',
    prefix: '',
    elementType: 'k8s-events',
    values: { output_format: 'table' },
    message:
      "This cluster will not print a table for kind 'Event' - choose Map, JSON or YAML for this kind",
    reason: 'NotAcceptable',
  },
  {
    optionId: 'TABLE-KIND',
    key: 'e21refused',
    prefix: '/cfg/status=406',
    elementType: 'k8s-events',
    values: { output_format: 'table' },
    message:
      "This cluster will not print a table for kind 'Event' - choose Map, JSON or YAML for this kind",
    reason: 'NotAcceptable',
  },
  {
    optionId: 'L-32',
    key: 'l32',
    prefix: `/cfg/status=400/msg=${encodeURIComponent(WAITING_TEXT)}`,
    elementType: 'k8s-logs',
    values: { pod: 'web', container: 'app' },
    message: `Kubernetes rejected the log request: ${WAITING_TEXT}`,
    reason: 'BadRequest',
  },
]

const RECORDED_MARKER = 'k8s-faults-recorded-done'

function buildRecordedWorkflow(cases: readonly RecordedCase[]): BuiltWorkflow {
  const nodes: WorkflowNode[] = []
  const chain: string[] = []
  const variables: Record<string, FixtureVariable> = stubCaVariable()
  const sessions = new Map<string, string>()

  for (const c of cases) {
    let sessionVar = sessions.get(c.prefix)
    if (sessionVar === undefined) {
      sessionVar = `sess_${sessions.size + 1}`
      sessions.set(c.prefix, sessionVar)
      variables[sessionVar] = { value: '', type: 'string', scope: 'test' }
      const connectId = `connect-${sessions.size}`
      nodes.push(stubConnectNode(connectId, c.prefix, sessionVar))
      chain.push(connectId)
    }

    const okVar = `${c.key}_ok`
    const errorVar = `${c.key}_error`
    const reasonVar = `${c.key}_reason`
    variables[okVar] = { value: false, type: 'boolean', scope: 'test' }
    variables[errorVar] = { value: '', type: 'string', scope: 'test' }
    variables[reasonVar] = { value: '', type: 'string', scope: 'test' }

    const readId = readNodeId(c.key)
    nodes.push(
      k8sReadNode({
        id: readId,
        elementType: c.elementType,
        description: `${c.optionId} ${c.key}`,
        values: { session: sessionVar, ...c.values, on_error: 'record' },
        outputBindings: { success: okVar, error: errorVar, reason: reasonVar },
        expressionFields: ['session'],
      }),
    )
    chain.push(readId)

    const markId = `mark-${c.key}`
    nodes.push(
      markerNode({
        id: markId,
        description: `${c.optionId} bound outputs`,
        expression: `f'${MARK} ${c.optionId} ${c.key} ok={${okVar}} reason={${reasonVar}} error={${errorVar}}'`,
      }),
    )
    chain.push(markId)
  }

  const doneId = 'log-done'
  nodes.push(
    markerNode({ id: doneId, description: 'Bookend marker', text: RECORDED_MARKER }),
  )
  chain.push(doneId)

  return { nodes: stackNodes(nodes), edges: chainEdges(chain), variables }
}

function readNodeId(key: string): string {
  return `read-${key}`
}

/** The console line a recorded failure writes. */
function recordedWarnLine(c: RecordedCase): string {
  return c.reason === null
    ? `Read failed: ${c.message}`
    : `Read failed (${c.reason}): ${c.message}`
}

/** The marker line the leg's Log Block writes from the bound outputs. */
function recordedMarkerLine(c: RecordedCase): string {
  return `${MARK} ${c.optionId} ${c.key} ok=False reason=${c.reason ?? ''} error=${c.message}`
}

function countOf(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

// ---------------------------------------------------------------------------
// The hard-fail sweep: each leg guarded by a Try/Catch so the run survives.
// ---------------------------------------------------------------------------

type GuardedCase = {
  optionId: string
  key: string
  prefix: string
  elementType: K8sReadElementType
  values: ReadValues
  /** The exact message the raised error carries. */
  message: string
}

const GUARDED_CASES: readonly GuardedCase[] = [
  {
    optionId: 'S-06',
    key: 's06',
    prefix: '/cfg/delay=3',
    elementType: 'k8s-get',
    values: { ...GET_LIST, timeout: 1, on_error: 'fail' },
    message: `Kubernetes API request GET /api/v1/namespaces/${NAMESPACE}/pods timed out after 1 second`,
  },
  {
    optionId: 'T-26',
    key: 't26fail',
    prefix: '/cfg/metrics=404',
    elementType: 'k8s-top',
    values: { scope: 'pod', select_by: 'all', on_error: 'fail' },
    message: METRICS_MISSING_MESSAGE,
  },
  {
    optionId: 'T-26',
    key: 't26record',
    prefix: '/cfg/metrics=404',
    elementType: 'k8s-top',
    values: { scope: 'pod', select_by: 'all', on_error: 'record' },
    message: METRICS_MISSING_MESSAGE,
  },
  {
    optionId: 'READ-WORDING',
    key: 's15json',
    prefix: '/cfg/body=html',
    elementType: 'k8s-get',
    values: { ...GET_LIST, output_format: 'json', on_error: 'record' },
    message: NOT_JSON_MESSAGE,
  },
  {
    optionId: 'READ-WORDING',
    key: 's15yaml',
    prefix: '/cfg/body=html',
    elementType: 'k8s-get',
    values: { ...GET_LIST, output_format: 'yaml', on_error: 'fail' },
    message: NOT_JSON_MESSAGE,
  },
]

/** The successful half of the timeout pair: the SAME session and the SAME read
 *  as S-06, with the timeout raised above the stub's delay. */
const G67 = {
  optionId: 'G-67',
  key: 'g67',
  prefix: '/cfg/delay=3',
  values: { ...GET_LIST, timeout: 10, on_error: 'fail' },
  infoLine: `Read 2 Pod object(s) from /api/v1/namespaces/${NAMESPACE}/pods`,
} as const

const GUARDED_MARKER = 'k8s-faults-guarded-done'

function guardedCaughtLine(c: GuardedCase): string {
  return `${MARK} ${c.optionId} ${c.key} caught`
}

function guardedErrorLine(c: GuardedCase): string {
  return `${MARK} ${c.optionId} ${c.key} msg=${c.message}`
}

function buildGuardedWorkflow(): BuiltWorkflow {
  const nodes: WorkflowNode[] = []
  const edges: WorkflowEdge[] = []
  const variables: Record<string, FixtureVariable> = stubCaVariable()
  const sessions = new Map<string, string>()
  let previous = ''

  const link = (target: string): void => {
    edges.push(
      previous === ''
        ? { id: `edge-start-${target}`, source: 'start-node', target }
        : edge(previous, target),
    )
    previous = target
  }

  const sessionFor = (prefix: string): string => {
    const existing = sessions.get(prefix)
    if (existing !== undefined) return existing
    const sessionVar = `sess_${sessions.size + 1}`
    sessions.set(prefix, sessionVar)
    variables[sessionVar] = { value: '', type: 'string', scope: 'test' }
    const connectId = `connect-${sessions.size}`
    nodes.push(stubConnectNode(connectId, prefix, sessionVar))
    link(connectId)
    return sessionVar
  }

  for (const c of GUARDED_CASES) {
    const sessionVar = sessionFor(c.prefix)
    const errVar = `${c.key}_err`
    variables[errVar] = { value: {}, type: 'map', scope: 'test' }

    const guardId = `tc-${c.key}`
    nodes.push(
      tryCatchNode({
        id: guardId,
        description: `${c.optionId} guard`,
        errorBinding: errVar,
      }),
    )
    link(guardId)

    const readId = readNodeId(c.key)
    nodes.push(
      k8sReadNode({
        id: readId,
        elementType: c.elementType,
        description: `${c.optionId} ${c.key}`,
        values: { session: sessionVar, ...c.values },
        expressionFields: ['session'],
      }),
    )
    edges.push(handleEdge(guardId, 'try', readId))

    const caughtId = `caught-${c.key}`
    nodes.push(
      markerNode({
        id: caughtId,
        description: `${c.optionId} catch branch`,
        text: guardedCaughtLine(c),
      }),
    )
    edges.push(handleEdge(guardId, 'catch', caughtId))

    const errId = `err-${c.key}`
    nodes.push(
      markerNode({
        id: errId,
        description: `${c.optionId} caught message`,
        expression: `f'${MARK} ${c.optionId} ${c.key} msg={${errVar}["message"]}'`,
      }),
    )
    edges.push(handleEdge(guardId, 'then', errId))
    previous = errId

    // The timeout pair rides the same session: the succeeding half goes in
    // straight after the failing half, unguarded.
    if (c.key === 's06') {
      const okId = readNodeId(G67.key)
      variables.g67_count = { value: 0, type: 'integer', scope: 'test' }
      nodes.push(
        k8sReadNode({
          id: okId,
          elementType: 'k8s-get',
          description: `${G67.optionId} ${G67.key}`,
          values: { session: sessionVar, ...G67.values },
          outputBindings: { count: 'g67_count' },
          expressionFields: ['session'],
        }),
      )
      link(okId)
      const okMarkId = `mark-${G67.key}`
      nodes.push(
        markerNode({
          id: okMarkId,
          description: `${G67.optionId} bound outputs`,
          expression: `f'${MARK} ${G67.optionId} ${G67.key} count={g67_count}'`,
        }),
      )
      link(okMarkId)
    }
  }

  const doneId = 'log-done'
  nodes.push(
    markerNode({ id: doneId, description: 'Bookend marker', text: GUARDED_MARKER }),
  )
  link(doneId)

  return { nodes: stackNodes(nodes), edges, variables }
}

// ---------------------------------------------------------------------------

function dump(entries: readonly LogEntry[]): string {
  return entries.map((e) => `${e.level} ${e.message}`).join('\n')
}

function loadGoldenFixture(): Record<string, unknown> {
  const fixture = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, 'fixture-stub-golden.json'), 'utf-8'),
  ) as { variables: Record<string, { value: unknown }> }
  fixture.variables.k8s_stub_ca.value = K8S_STUB_CA_PEM
  return fixture as unknown as Record<string, unknown>
}

async function runFixture(
  page: Page,
  fixture: Record<string, unknown>,
  marker: string,
): Promise<{ logs: string[]; entries: LogEntry[] }> {
  await importValidateAndNavigate(page, fixture, { injectHttp: true })
  const status = await startRun(page)
  const logs = await finishRun(page, status, marker)
  return { logs, entries: await getLogEntries(page) }
}

test.describe('K8s read Blocks against the fault-injecting stub endpoint', () => {
  test('G-65: a 503 carrying a Status body renders the read wording with the cluster text', async ({
    page,
  }) => {
    const { logs, entries } = await runFixture(
      page,
      loadGoldenFixture(),
      'k8s-faults-golden-done',
    )
    const message = `Kubernetes could not list Pod objects in namespace '${NAMESPACE}': ${K8S_STUB_DEFAULT_MESSAGE}`

    await test.step('the WARN console line carries the cluster text verbatim', async () => {
      const warn = entries.find((e) => e.message === `Read failed (ServiceUnavailable): ${message}`)
      expect(warn, `expected the recorded WARN line.\n${dump(entries)}`).toBeTruthy()
      expect(warn?.level).toBe('WARN')
    })

    await test.step('the kind is named once and the update wording is gone', async () => {
      expect(countOf(message, 'Pod')).toBe(1)
      expect(message).not.toContain('rejected the update')
    })

    await test.step('the bound outputs report the recorded failure', async () => {
      expect(logs).toContain(
        `${MARK} G-65 golden ok=False reason=ServiceUnavailable count=0 error=${message}`,
      )
      await expectNodeStatus(page, 'get-golden', 'warning')
    })
  })

  test('recorded faults render the exact read wording on every row of the case table', async ({
    page,
  }) => {
    const built = buildRecordedWorkflow(RECORDED_CASES)
    const { logs, entries } = await runFixture(
      page,
      fixtureOf('K8s Endpoint Faults - recorded', built),
      RECORDED_MARKER,
    )

    for (const c of RECORDED_CASES) {
      await test.step(`${c.optionId} ${c.key}`, async () => {
        const warnLine = recordedWarnLine(c)
        const warn = entries.find((e) => e.message === warnLine)
        expect(
          warn,
          `${c.optionId} ${c.key}: expected WARN "${warnLine}".\n${dump(entries)}`,
        ).toBeTruthy()
        expect(warn?.level, `${c.optionId} ${c.key}: a recorded failure is WARN`).toBe('WARN')

        expect(
          logs,
          `${c.optionId} ${c.key}: expected the bound-output marker.`,
        ).toContain(recordedMarkerLine(c))

        for (const forbidden of c.mustNotContain ?? []) {
          expect(
            c.message,
            `${c.optionId} ${c.key}: the message must not carry "${forbidden}"`,
          ).not.toContain(forbidden)
        }
        if (c.namedOnce !== undefined) {
          expect(
            countOf(c.message, c.namedOnce),
            `${c.optionId} ${c.key}: the object must be named once`,
          ).toBe(1)
        }
        if (c.message.includes('(HTTP ')) {
          expect(
            c.message,
            `${c.optionId} ${c.key}: the status tail must not leave a dangling colon`,
          ).not.toMatch(/:\s*$/)
        }

        await expectNodeStatus(page, readNodeId(c.key), 'warning')
      })
    }
  })

  test('hard faults stop the Block under both On error settings, and the timeout pair discriminates', async ({
    page,
  }) => {
    const built = buildGuardedWorkflow()
    const { logs, entries } = await runFixture(
      page,
      fixtureOf('K8s Endpoint Faults - hard fails', built),
      GUARDED_MARKER,
    )

    for (const c of GUARDED_CASES) {
      await test.step(`${c.optionId} ${c.key}`, async () => {
        expect(
          logs,
          `${c.optionId} ${c.key}: the catch branch must have run.\n${dump(entries)}`,
        ).toContain(guardedCaughtLine(c))
        expect(
          logs,
          `${c.optionId} ${c.key}: expected the caught message.\n${dump(entries)}`,
        ).toContain(guardedErrorLine(c))
        expect(
          await page
            .locator(`[data-testid="workflow-node-${readNodeId(c.key)}"]`)
            .getAttribute('data-execution-status'),
          `${c.optionId} ${c.key}: the Block must not succeed`,
        ).not.toBe('success')
      })
    }

    await test.step('G-67: the identical read at timeout 10 succeeds', async () => {
      expect(
        logs,
        `expected the successful read line.\n${dump(entries)}`,
      ).toContain(G67.infoLine)
      expect(logs).toContain(`${MARK} ${G67.optionId} ${G67.key} count=2`)
      await expectNodeStatus(page, readNodeId(G67.key), 'success')
    })
  })
})
