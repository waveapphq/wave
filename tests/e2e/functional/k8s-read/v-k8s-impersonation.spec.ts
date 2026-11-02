/**
 * V-K8S-IMPERSONATION: Impersonate user / Impersonate groups on all four K8s
 * read Blocks, against the real kwok cluster.
 *
 * Two runs inside one seeded namespace:
 *
 *   baseline (checked-in golden fixture) -> the admin session reads a Secret
 *     list, the namespace events, a pod log and pod usage with NO impersonation
 *     set. Every read succeeds. This is the control every refusal below is
 *     measured against: without it a 403 could mean "the read is broken here".
 *   impersonation sweep (built from the case table) -> ten legs that change
 *     ONLY the impersonation pair and assert what the cluster answers.
 *
 * The cluster grants User wave-reader pods, pods/log and events; Group
 * wave-readers pods only; and nothing at all to wave-nobody. No token maps to
 * any of the three (tests/e2e/services/kwok/manifests/rbac-impersonation.yaml),
 * so a refusal naming one of them cannot come from the caller's own identity -
 * that is what makes the 403 legs proof rather than coincidence.
 *
 * Option IDs: S-13 (leg A), S-14 (legs C, F, H), S-15 (legs B, K), S-16 (legs
 * D, G), S-17 (leg E), L-31 (legs I, J).
 *
 * Every failing leg runs with On error = Record and continue, so the run
 * reaches its bookend marker and each refusal is readable as an amber Block
 * with a WARN badge, one WARN console line, and the Block's own error and
 * reason outputs.
 *
 * REQ: REQ-5.1.1, REQ-3.4.1.5
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { getLogEntries } from '../../helpers/log-reader'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import { seedRun, SEEDED, type SeededRun } from '../../helpers/k8s-seed'
import {
  chainEdges,
  k8sConnectNode,
  k8sReadNode,
  markerNode,
  stackNodes,
  type K8sReadElementType,
  type WorkflowNode,
} from '../../helpers/k8s-nodes'
import {
  expectNodeStatus,
  expectNodesSuccess,
  finishRun,
  startRun,
} from '../../helpers/k8s-run'
import {
  HTTP_FIXTURE_HOST_SENTINEL,
  K8S_ADMIN_TOKEN,
  K8S_API_PORT,
  K8S_CA_PEM,
  K8S_IMPERSONATE_GROUP,
  K8S_IMPERSONATE_NOBODY,
  K8S_IMPERSONATE_USER,
} from '../../helpers/config'
import fs from 'fs'
import path from 'path'

const BASELINE_MARKER = 'r5-baseline-done'
const SWEEP_MARKER = 'r5-impersonation-done'

/** The api_url both fixtures carry; injectHttp rewrites it for container shards. */
const API_URL = `https://${HTTP_FIXTURE_HOST_SENTINEL}:${K8S_API_PORT}`

/** No token in tokens.csv maps to this, so every request carrying it is a 401. */
const JUNK_TOKEN = 'r5-not-a-real-token'

/** The user the admin token authenticates as (tests/e2e/services/kwok/tokens.csv).
 *  A refusal naming an impersonated subject may never name this one instead. */
const CALLER_USER = 'wave-admin'

/** The last line of the canned app.log the kwok ClusterLogs doc serves. */
const APP_LOG_TAIL = 'app: GET /healthz 200 1ms'

/** Run-time facts written into the fixtures' declared variables. */
type Material = { namespace: string }

// --- the reads each leg performs, one shape per Block --------------------

const GET_SECRET_LIST = {
  session: 'sess_admin',
  resource_type: 'default',
  kind: 'Secret',
  search_by: 'list',
  output_format: 'map',
  on_error: 'record',
} as const

const GET_POD_LIST = {
  session: 'sess_admin',
  resource_type: 'default',
  kind: 'Pod',
  search_by: 'list',
  output_format: 'map',
  on_error: 'record',
} as const

const EVENTS_NAMESPACE = {
  session: 'sess_admin',
  scope_to_object: false,
  event_type: 'any',
  output_format: 'map',
  on_error: 'record',
} as const

const LOGS_KUBELET_POD = {
  session: 'sess_admin',
  pod: SEEDED.podKubelet,
  container: SEEDED.containerApp,
  previous: false,
  tail_lines: 1,
  timestamps: false,
  on_error: 'record',
} as const

const TOP_POD_ALL = {
  session: 'sess_admin',
  scope: 'pod',
  select_by: 'all',
  include_containers: false,
  on_error: 'record',
} as const

// --- what a refused leg renders ------------------------------------------

type Refusal = {
  /** The Status reason the Block records. */
  reason: string
  /** Which arm of the shared API-error mapper renders it. */
  arm: 'permission' | 'auth'
  /** The cluster's own text, which WAVE passes through unchanged. */
  cluster: (namespace: string) => string
}

const ARM_PREFIX = {
  permission: 'Kubernetes API permission denied: ',
  auth: 'Kubernetes API authentication failed: ',
} as const

const forbidden = (cluster: (namespace: string) => string): Refusal => ({
  reason: 'Forbidden',
  arm: 'permission',
  cluster,
})

/** The Block's `error` output for a refused leg. */
function refusedError(refusal: Refusal, namespace: string): string {
  return `${ARM_PREFIX[refusal.arm]}${refusal.cluster(namespace)}`
}

/** The single WARN console line a recorded failure writes. */
function refusedWarnLine(refusal: Refusal, namespace: string): string {
  return `Read failed (${refusal.reason}): ${refusedError(refusal, namespace)}`
}

/** The apiserver's RBAC refusal for a namespaced collection read. */
const cannotList = (user: string, resource: string, group: string) => (namespace: string) =>
  `${resource}${group ? `.${group}` : ''} is forbidden: User "${user}" cannot list resource ` +
  `"${resource}" in API group "${group}" in the namespace "${namespace}"`

// --- the case table: this IS the checklist -------------------------------

type Evidence = {
  /** Block output bound to a variable and printed by the leg's marker. */
  output: string
  type: 'array' | 'integer' | 'string'
  /** Substring the printed value must carry. */
  contains?: string
  /** Lower bound the printed integer must reach. */
  atLeast?: number
}

type Leg = {
  /** Single letter; names the canvas Blocks and the marker line. */
  key: string
  /** Option ID from the coverage matrix. */
  covers: string
  what: string
  block: K8sReadElementType
  values: Record<string, unknown>
  refusal?: Refusal
  evidence?: Evidence
}

const SWEEP: readonly Leg[] = [
  {
    key: 'B',
    covers: 'S-15',
    what: 'impersonating wave-reader is refused the Secret list, and the message names it',
    block: 'k8s-get',
    values: { ...GET_SECRET_LIST, impersonate_user: K8S_IMPERSONATE_USER },
    refusal: forbidden(cannotList(K8S_IMPERSONATE_USER, 'secrets', '')),
  },
  {
    key: 'C',
    covers: 'S-14',
    what: 'impersonating wave-reader still reads pods - impersonation does not just break the request',
    block: 'k8s-get',
    values: { ...GET_POD_LIST, impersonate_user: K8S_IMPERSONATE_USER },
    evidence: { output: 'names', type: 'array', contains: SEEDED.podLabeled },
  },
  {
    key: 'D',
    covers: 'S-16',
    what: 'impersonating the unbound wave-nobody with no groups is refused the pod list',
    block: 'k8s-get',
    values: { ...GET_POD_LIST, impersonate_user: K8S_IMPERSONATE_NOBODY },
    refusal: forbidden(cannotList(K8S_IMPERSONATE_NOBODY, 'pods', '')),
  },
  {
    key: 'E',
    covers: 'S-17',
    what: 'the same read plus the wave-readers group succeeds',
    block: 'k8s-get',
    values: {
      ...GET_POD_LIST,
      impersonate_user: K8S_IMPERSONATE_NOBODY,
      impersonate_groups: K8S_IMPERSONATE_GROUP,
    },
    evidence: { output: 'names', type: 'array', contains: SEEDED.podLabeled },
  },
  {
    key: 'F',
    covers: 'S-14',
    what: 'Events under wave-reader reads the namespace events',
    block: 'k8s-events',
    values: { ...EVENTS_NAMESPACE, impersonate_user: K8S_IMPERSONATE_USER },
    evidence: { output: 'count', type: 'integer', atLeast: 4 },
  },
  {
    key: 'G',
    covers: 'S-16',
    what: 'Events under wave-nobody is refused, naming it',
    block: 'k8s-events',
    values: { ...EVENTS_NAMESPACE, impersonate_user: K8S_IMPERSONATE_NOBODY },
    refusal: forbidden(cannotList(K8S_IMPERSONATE_NOBODY, 'events', '')),
  },
  {
    key: 'H',
    covers: 'S-14',
    what: 'Logs under wave-reader reads the pod log',
    block: 'k8s-logs',
    values: { ...LOGS_KUBELET_POD, impersonate_user: K8S_IMPERSONATE_USER },
    evidence: { output: 'logs', type: 'string', contains: APP_LOG_TAIL },
  },
  {
    key: 'I',
    covers: 'L-31',
    what: 'Logs under wave-nobody is refused on the log subresource, naming it',
    block: 'k8s-logs',
    values: { ...LOGS_KUBELET_POD, impersonate_user: K8S_IMPERSONATE_NOBODY },
    refusal: forbidden(
      (namespace) =>
        `pods "${SEEDED.podKubelet}" is forbidden: User "${K8S_IMPERSONATE_NOBODY}" cannot ` +
        `get resource "pods/log" in API group "" in the namespace "${namespace}"`,
    ),
  },
  {
    key: 'J',
    covers: 'L-31',
    what: 'Logs through a junk-token session is refused with the authentication wording',
    block: 'k8s-logs',
    values: { ...LOGS_KUBELET_POD, session: 'k8s_junk_session' },
    refusal: { reason: 'Unauthorized', arm: 'auth', cluster: () => 'Unauthorized' },
  },
  {
    key: 'K',
    covers: 'S-15',
    what: 'Top under wave-reader is refused the metrics read, naming it',
    block: 'k8s-top',
    values: { ...TOP_POD_ALL, impersonate_user: K8S_IMPERSONATE_USER },
    refusal: forbidden(cannotList(K8S_IMPERSONATE_USER, 'pods', 'metrics.k8s.io')),
  },
]

const legOf = (key: string): Leg => SWEEP.find((leg) => leg.key === key) as Leg

// --- fixture assembly -----------------------------------------------------

type FixtureVariable = { value: unknown; type: string; scope: string; secret?: boolean }

const stringVar = (value = ''): FixtureVariable => ({ value, type: 'string', scope: 'test' })

const ZERO: Record<Evidence['type'], unknown> = { array: [], integer: 0, string: '' }

/** A session the K8s Connect Block never produced: valid kubeconfig, dead token. */
function junkSession(namespace: string): string {
  return JSON.stringify({
    apiVersion: 'v1',
    kind: 'Config',
    clusters: [
      {
        name: 'wave',
        cluster: { server: API_URL, 'insecure-skip-tls-verify': true },
      },
    ],
    users: [{ name: 'wave', user: { token: JUNK_TOKEN } }],
    contexts: [{ name: 'wave', context: { cluster: 'wave', user: 'wave', namespace } }],
    'current-context': 'wave',
  })
}

/** Write the TEST-ONLY cluster material into a fixture's declared variables.
 *  None of it is ever committed inside a fixture file. */
function withMaterial(
  fixture: Record<string, unknown>,
  material: Material,
): Record<string, unknown> {
  const variables = { ...(fixture.variables as Record<string, FixtureVariable>) }
  const written: Record<string, string> = {
    k8s_admin_token: K8S_ADMIN_TOKEN,
    k8s_ca: K8S_CA_PEM,
    k8s_ns: material.namespace,
    k8s_junk_session: junkSession(material.namespace),
  }
  for (const [name, value] of Object.entries(written)) {
    if (variables[name]) variables[name] = { ...variables[name], value }
  }
  return { ...fixture, variables }
}

function loadBaselineFixture(material: Material): Record<string, unknown> {
  const raw = fs.readFileSync(path.resolve(__dirname, 'fixture-impersonation.json'), 'utf-8')
  return withMaterial(JSON.parse(raw) as Record<string, unknown>, material)
}

const connectNode = (): WorkflowNode =>
  k8sConnectNode({
    id: 'connect-admin',
    description: 'Admin session pinned to the run namespace',
    expressionFields: ['token', 'ca_cert', 'namespace'],
    values: {
      api_url: API_URL,
      namespace: 'k8s_ns',
      timeout: 30,
      token: 'k8s_admin_token',
      verify_ssl: true,
      ca_cert: 'k8s_ca',
    },
    outputBindings: { session: 'sess_admin' },
  })

const okVar = (leg: Leg) => `${leg.key.toLowerCase()}_ok`
const errorVar = (leg: Leg) => `${leg.key.toLowerCase()}_error`
const reasonVar = (leg: Leg) => `${leg.key.toLowerCase()}_reason`
const evidenceVar = (leg: Leg) => `${leg.key.toLowerCase()}_evidence`

const readNodeId = (leg: Leg) => `read-${leg.key.toLowerCase()}`
const markerNodeId = (leg: Leg) => `log-${leg.key.toLowerCase()}`

/** The prefix the leg's marker line starts with. */
const markerPrefix = (leg: Leg) => `R5 leg${leg.key} ${leg.covers} `

function markerExpression(leg: Leg): string {
  const tail = leg.evidence ? ` evidence={${evidenceVar(leg)}}` : ''
  return (
    `f'${markerPrefix(leg)}ok={${okVar(leg)}} reason={${reasonVar(leg)}} ` +
    `error={${errorVar(leg)}}${tail}'`
  )
}

/** Build the whole sweep workflow from the case table. */
function buildSweepFixture(material: Material): Record<string, unknown> {
  const nodes: WorkflowNode[] = [connectNode()]

  for (const leg of SWEEP) {
    const outputBindings: Record<string, string> = {
      success: okVar(leg),
      error: errorVar(leg),
      reason: reasonVar(leg),
    }
    if (leg.evidence) outputBindings[leg.evidence.output] = evidenceVar(leg)
    nodes.push(
      k8sReadNode({
        id: readNodeId(leg),
        elementType: leg.block,
        description: `${leg.covers} leg ${leg.key} - ${leg.what}`,
        expressionFields: ['session'],
        values: leg.values,
        outputBindings,
      }),
    )
    nodes.push(
      markerNode({
        id: markerNodeId(leg),
        description: `${leg.covers} leg ${leg.key} marker`,
        expression: markerExpression(leg),
      }),
    )
  }
  nodes.push(markerNode({ id: 'log-done', description: 'Bookend marker', text: SWEEP_MARKER }))

  const variables: Record<string, FixtureVariable> = {
    k8s_admin_token: { value: '', type: 'string', scope: 'test', secret: true },
    k8s_ca: stringVar(),
    k8s_ns: stringVar(),
    k8s_junk_session: stringVar(),
    sess_admin: stringVar(),
  }
  for (const leg of SWEEP) {
    variables[okVar(leg)] = { value: false, type: 'boolean', scope: 'test' }
    variables[errorVar(leg)] = stringVar()
    variables[reasonVar(leg)] = stringVar()
    if (leg.evidence) {
      variables[evidenceVar(leg)] = {
        value: ZERO[leg.evidence.type],
        type: leg.evidence.type,
        scope: 'test',
      }
    }
  }

  const laidOut = stackNodes(nodes)
  return withMaterial(
    {
      name: 'K8s Read Impersonation Sweep E2E Test',
      version: '1.0.0',
      description: '',
      workflow: { nodes: laidOut, edges: chainEdges(laidOut.map((node) => node.id)) },
      variables,
      metadata: { tags: [], suite_id: null, parent_suite: null },
    },
    material,
  )
}

// --- reading the run back -------------------------------------------------

function markerLine(logs: readonly string[], leg: Leg): string {
  const line = logs.find((text) => text.startsWith(markerPrefix(leg)))
  expect(
    line,
    `no marker line for leg ${leg.key} (${leg.covers}).\n${logs.join('\n')}`,
  ).toBeTruthy()
  return line as string
}

/** Everything a marker line printed after `evidence=`; the tail so a log body
 *  carrying its own spaces stays intact. */
function evidenceTail(line: string): string {
  const index = line.indexOf(' evidence=')
  expect(index, `this marker printed no evidence.\n${line}`).toBeGreaterThan(-1)
  return line.slice(index + ' evidence='.length)
}

/** Keys whose value differs between two configurations, union of both key sets. */
function differingKeys(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): string[] {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)])
  return [...keys].filter((key) => left[key] !== right[key]).sort()
}

async function expectWarnBadge(page: Page, nodeId: string): Promise<void> {
  const badge = page.locator(`[data-testid="workflow-node-${nodeId}"]`).locator(
    '[data-testid="node-run-state-badge"]',
  )
  await expect(badge, `Block ${nodeId} must carry the WARN badge`).toHaveText('WARN')
}

// --- the runs -------------------------------------------------------------

test.describe('K8s read Blocks: impersonation (real kwok cluster)', () => {
  let run: SeededRun

  test.beforeAll(async ({ request }) => {
    run = await seedRun(request, 'impersonation')
  })

  test.afterAll(async () => {
    await run?.teardown()
  })

  test('S-13 leg A: with no impersonation the admin session reads on all four Blocks', async ({
    page,
  }) => {
    await importValidateAndNavigate(page, loadBaselineFixture({ namespace: run.namespace }), {
      injectHttp: true,
    })

    const status = await startRun(page)
    const logs = await finishRun(page, status, BASELINE_MARKER)
    const all = logs.join('\n')
    const legA = (block: string): string => {
      const prefix = `R5 legA S-13 ${block} `
      const found = logs.find((text) => text.startsWith(prefix))
      expect(found, `no leg A marker for ${block}.\n${all}`).toBeTruthy()
      return found as string
    }

    await test.step('every Block succeeded', async () => {
      await expectNodesSuccess(page, [
        'connect-admin',
        'get-a',
        'log-get-a',
        'events-a',
        'log-events-a',
        'logs-a',
        'log-logs-a',
        'top-a',
        'log-top-a',
        'log-done',
      ])
    })

    await test.step('the Secret list comes back (the leg B control)', () => {
      const get = legA('get')
      expect(get, all).toContain('ok=True reason= error=')
      expect(evidenceTail(get), all).toContain(SEEDED.secret)
    })

    await test.step('events, log text and pod usage come back (the leg G, I and K controls)', () => {
      const events = legA('events')
      expect(events, all).toContain('ok=True reason= error=')
      expect(
        Number(evidenceTail(events)),
        `the seeded namespace must hold the kubelet events.\n${events}`,
      ).toBeGreaterThanOrEqual(4)

      const podLog = legA('logs')
      expect(podLog, all).toContain('ok=True reason= error=')
      expect(evidenceTail(podLog), all).toContain(APP_LOG_TAIL)
      expect(
        logs.some((text) =>
          new RegExp(
            `^Read \\d+ characters of log from pod '${SEEDED.podKubelet}' in '${run.namespace}'$`,
          ).test(text),
        ),
        `the Logs read line is missing.\n${all}`,
      ).toBeTruthy()

      // Usage rows appear 35-90 s after a pod is created and this profile does
      // not wait for them, so the count carries no floor here.
      expect(legA('top'), all).toContain('ok=True reason= error=')
    })

    await test.step('nothing was recorded as a failure', async () => {
      const entries = await getLogEntries(page)
      expect(
        entries.filter((entry) => entry.message.startsWith('Read failed')),
        'a clean baseline must write no recorded-failure line',
      ).toEqual([])
    })
  })

  test('S-14 to S-17 and L-31: the impersonation pair decides what each read Block may see', async ({
    page,
  }) => {
    await importValidateAndNavigate(page, buildSweepFixture({ namespace: run.namespace }), {
      injectHttp: true,
    })

    const status = await startRun(page)
    const logs = await finishRun(page, status, SWEEP_MARKER)
    const all = logs.join('\n')
    const entries = await getLogEntries(page)

    await test.step('the run finished and every marker Block ran', async () => {
      await expectNodesSuccess(page, [
        'connect-admin',
        ...SWEEP.map(markerNodeId),
        'log-done',
      ])
    })

    for (const leg of SWEEP) {
      const title = `leg ${leg.key} (${leg.covers}) - ${leg.what}`
      const refusal = leg.refusal

      if (refusal) {
        await test.step(title, async () => {
          const line = markerLine(logs, leg)
          expect(line, all).toContain('ok=False')
          expect(line, all).toContain(`reason=${refusal.reason}`)
          expect(line, all).toContain(`error=${refusedError(refusal, run.namespace)}`)

          const expected = refusedWarnLine(refusal, run.namespace)
          const warns = entries.filter(
            (entry) => entry.level === 'WARN' && entry.message === expected,
          )
          expect(
            warns.length,
            `leg ${leg.key} must write exactly one WARN line:\n${expected}\n${all}`,
          ).toBe(1)

          await expectNodeStatus(page, readNodeId(leg), 'warning')
          await expectWarnBadge(page, readNodeId(leg))

          const subject = leg.values.impersonate_user
          if (typeof subject === 'string') {
            expect(line, all).toContain(`User "${subject}"`)
            expect(
              line,
              `leg ${leg.key} must not name the caller - only impersonation can produce this`,
            ).not.toContain(`"${CALLER_USER}"`)
          }
        })
      } else {
        await test.step(title, async () => {
          const line = markerLine(logs, leg)
          expect(line, all).toContain('ok=True reason= error=')
          await expectNodeStatus(page, readNodeId(leg), 'success')

          const evidence = leg.evidence
          expect(evidence, `leg ${leg.key} must carry evidence`).toBeTruthy()
          const printed = evidenceTail(line)
          if (evidence?.contains) expect(printed, all).toContain(evidence.contains)
          if (evidence?.atLeast !== undefined) {
            expect(Number(printed), all).toBeGreaterThanOrEqual(evidence.atLeast)
          }
        })
      }
    }

    await test.step('S-14 vs S-15: one impersonated identity, two different answers', () => {
      const legB = markerLine(logs, legOf('B'))
      expect(legB, all).toContain('ok=False')
      expect(legB, all).toContain(`User "${K8S_IMPERSONATE_USER}"`)
      expect(markerLine(logs, legOf('C')), all).toContain('ok=True')
    })

    await test.step('S-17: the groups box is the ONLY field that differs from leg D', () => {
      expect(differingKeys(legOf('D').values, legOf('E').values)).toEqual([
        'impersonate_groups',
      ])
      expect(markerLine(logs, legOf('D')), all).toContain('ok=False')
      expect(markerLine(logs, legOf('E')), all).toContain('ok=True')
    })

    await test.step('L-31: the 401 and the 403 are different answers on the same Block', () => {
      const junk = markerLine(logs, legOf('J'))
      const unbound = markerLine(logs, legOf('I'))
      expect(junk, all).toContain('reason=Unauthorized')
      expect(unbound, all).toContain('reason=Forbidden')
      expect(unbound, all).toContain(`User "${K8S_IMPERSONATE_NOBODY}"`)
    })
  })
})
