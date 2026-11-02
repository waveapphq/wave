/**
 * The K8s Logs option sweep, as a case table.
 *
 * The table IS the checklist: one row per option id, each carrying the exact
 * text the cluster returns for that setting. `fixture-logs-golden.json` holds
 * the reviewable shape and the head of the chain; every other leg is generated
 * from this table onto the end of it.
 */

import {
  edge,
  k8sReadNode,
  markerNode,
  stackNodes,
  type WorkflowEdge,
  type WorkflowNode,
} from '../../helpers/k8s-nodes'

/** Placeholder the golden fixture and the expected strings carry for the run namespace. */
export const NAMESPACE_A_SENTINEL = '__NS_A__'

/** The session variable the Connect Block at the head of the chain assigns. */
const SESSION_VAR = 'sess_logs'

/** Last node of the golden fixture; the generated legs chain off it. */
const GOLDEN_TAIL_ID = 'mark-l01'

/** Bookend marker: the console tail is harvested on this line, never on a bare read. */
export const SWEEP_DONE_MARKER = 'r3-logs-sweep-done'

/** Every marker line starts with this, so a failure names the option row it broke. */
export const MARKER_PREFIX = 'R3 '

// --- The log bodies kwok serves, byte for byte -------------------------------
// tests/e2e/services/kwok/logs/, keyed by CONTAINER NAME (kwok's ClusterLogs
// selector has no label matching). Verified live against the rebuilt cluster.

/** container `app`, 172 bytes, 6 lines. */
export const APP_LOG =
  'app: starting payments-api v2.4.0\n' +
  'app: listening on :8080\n' +
  'app: GET /healthz 200 1ms\n' +
  'app: GET /orders/42 200 12ms\n' +
  'app: WARN upstream latency 812ms\n' +
  'app: GET /healthz 200 1ms\n'

/** container `app` with `timestamps`, 358 bytes: a 30-character stamp plus a space per line. */
export const APP_LOG_STAMPED =
  '2026-01-01T00:00:00.000000001Z app: starting payments-api v2.4.0\n' +
  '2026-01-01T00:00:01.000000001Z app: listening on :8080\n' +
  '2026-01-01T00:00:02.000000001Z app: GET /healthz 200 1ms\n' +
  '2026-01-01T00:00:03.000000001Z app: GET /orders/42 200 12ms\n' +
  '2026-01-01T00:00:04.000000001Z app: WARN upstream latency 812ms\n' +
  '2026-01-01T00:00:05.000000001Z app: GET /healthz 200 1ms\n'

/** container `app`, previous instance, 138 bytes, 4 lines. */
export const APP_PREVIOUS_LOG =
  'app: starting payments-api v2.3.0\n' +
  'app: listening on :8080\n' +
  'app: ERROR database connection refused (db:5432)\n' +
  'app: FATAL exiting with code 1\n'

/** The last 2 of the 6 `app` lines. */
export const APP_LOG_TAIL_2 =
  'app: WARN upstream latency 812ms\napp: GET /healthz 200 1ms\n'

/** The first 40 bytes of `app`, which land mid-line. */
export const APP_LOG_CUT_40 = 'app: starting payments-api v2.4.0\napp: l'

/** container `sidecar`, 187 bytes, 4 lines. */
export const SIDECAR_LOG =
  'sidecar: envoy proxy ready, upstream app:8080\n' +
  'sidecar: access 10.244.0.9 "GET /healthz" 200\n' +
  'sidecar: access 10.244.0.17 "GET /orders/42" 200\n' +
  'sidecar: access 10.244.0.9 "GET /healthz" 200\n'

/** Any other container name falls through to `pod.log`: 48 bytes, 3 lines. */
export const POD_LOG = 'kwok-log-line-1\nkwok-log-line-2\nkwok-log-line-3\n'

/** container `recent`, written at container start: 6 archived lines stamped 365
 *  days back, then 4 fresh ones. 228 bytes unfiltered. */
export const RECENT_LOG =
  'recent: archived line 1\n' +
  'recent: archived line 2\n' +
  'recent: archived line 3\n' +
  'recent: archived line 4\n' +
  'recent: archived line 5\n' +
  'recent: archived line 6\n' +
  'recent: fresh line 1\n' +
  'recent: fresh line 2\n' +
  'recent: fresh line 3\n' +
  'recent: fresh line 4\n'

/** container `recent` inside a 30-day window: the 4 fresh lines, 84 bytes. */
export const RECENT_LOG_FRESH =
  'recent: fresh line 1\nrecent: fresh line 2\nrecent: fresh line 3\nrecent: fresh line 4\n'

/** The 30-day window that makes `since_seconds` a genuine subset filter. */
export const SINCE_WINDOW_SECONDS = 2_592_000

/** container `unicode` cut at byte 32: a clean cut just before the euro sign. */
export const UNICODE_CUT_32 = 'unicode: euro at 32 ------------'

/** container `unicode` cut at byte 33, one byte inside the 3-byte euro sign. */
export const UNICODE_CUT_33 = `${UNICODE_CUT_32}\uFFFD`

// --- Pod and container names -------------------------------------------------

/** Seeded by `seedRun(request, 'logs')` in namespace A. */
export const POD_MULTI = 'wave-pod-multi'
export const POD_SOLO = 'wave-pod-solo'
/** Seeded by `seedRun(request, 'logs')` in namespace B. */
export const POD_B = 'wave-pod-b'

/** The log-fixture pods `seedRun` does not create yet - see the spec header. */
export const POD_RECENT = 'wave-pod-recent'
export const POD_UNICODE = 'wave-pod-unicode'
export const CONTAINER_RECENT = 'recent'
export const CONTAINER_UNICODE = 'unicode'

// --- The cluster's own refusals, verbatim ------------------------------------

/** A container the pod does not have. The apiserver does NOT list the real ones here. */
export const UNKNOWN_CONTAINER_400 =
  `Kubernetes rejected the log request: container nope is not valid for pod ${POD_MULTI}`

// --- The case table ----------------------------------------------------------

/** The type the `logs` output declares, which Output Format and Timestamps pick
 *  together. The fixture declares the bound variable with exactly this type and
 *  the pre-run gate refuses a mismatch, so a run that STARTS proves it. */
export type LogsShape = 'string' | 'array' | 'table'

/** The zero value each declared shape carries in the fixture. */
const EMPTY_BY_SHAPE: Record<LogsShape, unknown> = { string: '', array: [], table: [] }

export type LogsCase = {
  /** Canvas node id and the prefix of this leg's output variables. */
  id: string
  /** The option row (or rows) this leg proves. */
  option: string
  /** What the leg does, shown on the Block and in the marker line. */
  title: string
  /** Values merged over `{ session }`. */
  values: Record<string, unknown>
  /** Route the read at namespace B through the namespace override. */
  namespaceB?: boolean
  /** The leg is meant to fail: `on_error` = record, so the chain continues. */
  record?: boolean
  /** Declared type of the bound `logs` variable; `string` when unset. */
  shape?: LogsShape
  /** What the marker's `len()` counts, in words; `chars` when unset. */
  unit?: string
  /** Exact `logs` output. `__NS_A__` is resolved against the seeded run. */
  logs?: string
  /** Exact `error` output on a recorded failure. */
  error?: string
  /** Exact `reason` output on a recorded failure. */
  reason?: string
}

export const LOGS_CASES: readonly LogsCase[] = [
  {
    id: 'l05',
    option: 'L-05',
    title: 'container app',
    values: { pod: POD_MULTI, container: 'app' },
    logs: APP_LOG,
  },
  {
    id: 'l06',
    option: 'L-06',
    title: 'container sidecar',
    values: { pod: POD_MULTI, container: 'sidecar' },
    logs: SIDECAR_LOG,
  },
  {
    id: 'l07',
    option: 'L-07',
    title: 'container the pod does not have',
    values: { pod: POD_MULTI, container: 'nope' },
    record: true,
    logs: '',
    error: UNKNOWN_CONTAINER_400,
    reason: 'BadRequest',
  },
  {
    id: 'l08',
    option: 'L-08',
    title: 'previous false',
    values: { pod: POD_MULTI, container: 'app', previous: false },
    logs: APP_LOG,
  },
  {
    id: 'l09',
    option: 'L-09',
    title: 'previous true',
    values: { pod: POD_MULTI, container: 'app', previous: true },
    logs: APP_PREVIOUS_LOG,
  },
  {
    id: 'l11',
    option: 'L-11',
    title: 'tail_lines unset',
    values: { pod: POD_MULTI, container: 'app' },
    logs: APP_LOG,
  },
  {
    id: 'l12',
    option: 'L-12',
    title: 'tail_lines below the line count',
    values: { pod: POD_MULTI, container: 'app', tail_lines: 2 },
    logs: APP_LOG_TAIL_2,
  },
  {
    id: 'l13',
    option: 'L-13',
    title: 'tail_lines above the line count',
    values: { pod: POD_MULTI, container: 'app', tail_lines: 99 },
    logs: APP_LOG,
  },
  {
    id: 'l15',
    option: 'L-15',
    title: 'since_seconds unset',
    values: { pod: POD_RECENT, container: CONTAINER_RECENT },
    logs: RECENT_LOG,
  },
  {
    id: 'l16',
    option: 'L-16',
    title: 'since_seconds against the fixed-timestamp file',
    values: { pod: POD_MULTI, container: 'app', since_seconds: 60 },
    logs: '',
  },
  {
    id: 'l17',
    option: 'L-17',
    title: 'since_seconds as a subset filter',
    values: {
      pod: POD_RECENT,
      container: CONTAINER_RECENT,
      since_seconds: SINCE_WINDOW_SECONDS,
    },
    logs: RECENT_LOG_FRESH,
  },
  {
    id: 'l19',
    option: 'L-19',
    title: 'timestamps false',
    values: { pod: POD_MULTI, container: 'app', timestamps: false },
    logs: APP_LOG,
  },
  {
    id: 'l20',
    option: 'L-20',
    title: 'timestamps true',
    values: { pod: POD_MULTI, container: 'app', timestamps: true },
    logs: APP_LOG_STAMPED,
  },
  {
    id: 'lshapestr',
    option: 'LOGS-SHAPE-STRING',
    title: 'Output Format String',
    values: { pod: POD_MULTI, container: 'app', output_format: 'string' },
    logs: APP_LOG,
  },
  {
    id: 'lshapearr',
    option: 'LOGS-SHAPE-ARRAY',
    title: 'Output Format Array, one entry per line',
    values: { pod: POD_MULTI, container: 'app', output_format: 'array' },
    shape: 'array',
    unit: 'entries',
  },
  {
    id: 'lshapetab',
    option: 'LOGS-SHAPE-TABLE',
    title: 'Output Format Table, TIME and MESSAGE',
    values: {
      pod: POD_MULTI,
      container: 'app',
      timestamps: true,
      output_format: 'array',
    },
    shape: 'table',
    unit: 'rows',
  },
  {
    id: 'l21',
    option: 'L-21',
    title: 'max_bytes unset',
    values: { pod: POD_MULTI, container: 'app' },
    logs: APP_LOG,
  },
  {
    id: 'l22',
    option: 'L-22/L-24',
    title: 'max_bytes below the body, landing mid-line',
    values: { pod: POD_MULTI, container: 'app', max_bytes: 40 },
    logs: APP_LOG_CUT_40,
  },
  {
    id: 'l23',
    option: 'L-23',
    title: 'max_bytes above the body',
    values: { pod: POD_MULTI, container: 'app', max_bytes: 9999 },
    logs: APP_LOG,
  },
  {
    id: 'l25',
    option: 'L-25',
    title: 'max_bytes cutting inside a multi-byte character',
    values: { pod: POD_UNICODE, container: CONTAINER_UNICODE, max_bytes: 33 },
    logs: UNICODE_CUT_33,
  },
  {
    id: 'l25c',
    option: 'L-25 control',
    title: 'max_bytes cutting cleanly one byte earlier',
    values: { pod: POD_UNICODE, container: CONTAINER_UNICODE, max_bytes: 32 },
    logs: UNICODE_CUT_32,
  },
  {
    id: 'l27',
    option: 'L-27',
    title: 'no namespace override',
    values: { pod: POD_MULTI, container: 'app', namespace: '' },
    logs: APP_LOG,
  },
  {
    id: 'l28',
    option: 'L-28/S-09',
    title: 'namespace override to namespace B',
    values: { pod: POD_B, container: 'app' },
    namespaceB: true,
    logs: APP_LOG,
  },
  {
    id: 'l28n',
    option: 'L-28/S-09 negative',
    title: 'the same read with no override lands in namespace A',
    values: { pod: POD_B, container: 'app' },
    record: true,
    logs: '',
    error: `K8s Pod '${POD_B}' not found in namespace '${NAMESPACE_A_SENTINEL}'`,
    reason: 'NotFound',
  },
  {
    id: 'l30',
    option: 'L-30',
    title: 'pod does not exist',
    values: { pod: 'nope', container: 'app' },
    record: true,
    logs: '',
    error: `K8s Pod 'nope' not found in namespace '${NAMESPACE_A_SENTINEL}'`,
    reason: 'NotFound',
  },
]

// --- Fixture assembly --------------------------------------------------------

export type SeededNamespaces = { namespace: string; namespaceB: string }

type FixtureShape = {
  workflow: { nodes: WorkflowNode[]; edges: WorkflowEdge[] }
  variables: Record<string, unknown>
  [key: string]: unknown
}

const stringVar = () => ({ value: '', type: 'string', scope: 'test' })
const booleanVar = () => ({ value: false, type: 'boolean', scope: 'test' })

/** Resolve the run-namespace placeholder in an expected string. */
export function resolveNamespace(text: string, ns: SeededNamespaces): string {
  return text.split(NAMESPACE_A_SENTINEL).join(ns.namespace)
}

/** The output variable a leg binds its `logs` to. */
export const logsVar = (id: string): string => `${id}_logs`

/**
 * Take the golden fixture, point it at the seeded namespaces, and chain every
 * case in the table onto the end of it. Each leg is followed by a Log Block
 * stamping its option id, and the chain ends on the bookend marker.
 */
export function buildLogsSweepFixture(
  golden: Record<string, unknown>,
  ns: SeededNamespaces,
): Record<string, unknown> {
  const hydrated = JSON.parse(
    resolveNamespace(JSON.stringify(golden), ns),
  ) as FixtureShape

  const nodes = [...hydrated.workflow.nodes]
  const edges = [...hydrated.workflow.edges]
  const variables: Record<string, unknown> = { ...hydrated.variables }
  let previous = GOLDEN_TAIL_ID

  for (const testCase of LOGS_CASES) {
    const values: Record<string, unknown> = { session: SESSION_VAR, ...testCase.values }
    if (testCase.namespaceB) {
      values.namespace = ns.namespaceB
    }
    if (testCase.record) values.on_error = 'record'

    const shape = testCase.shape ?? 'string'
    const outputBindings: Record<string, string> = { logs: logsVar(testCase.id) }
    variables[logsVar(testCase.id)] = {
      value: EMPTY_BY_SHAPE[shape],
      type: shape,
      scope: 'test',
    }
    if (testCase.record) {
      outputBindings.success = `${testCase.id}_ok`
      outputBindings.error = `${testCase.id}_err`
      outputBindings.reason = `${testCase.id}_reason`
      variables[`${testCase.id}_ok`] = booleanVar()
      variables[`${testCase.id}_err`] = stringVar()
      variables[`${testCase.id}_reason`] = stringVar()
    }

    nodes.push(
      k8sReadNode({
        id: testCase.id,
        elementType: 'k8s-logs',
        description: `${testCase.option} ${testCase.title}`,
        expressionFields: ['session'],
        values,
        outputBindings,
      }),
    )
    const markerId = `mark-${testCase.id}`
    nodes.push(
      markerNode({
        id: markerId,
        description: `${testCase.option} marker`,
        expression: testCase.record
          ? `f'${MARKER_PREFIX}${testCase.option} ok={${testCase.id}_ok} reason={${testCase.id}_reason}'`
          : `f'${MARKER_PREFIX}${testCase.option} ${testCase.unit ?? 'chars'}={len(${logsVar(testCase.id)})}'`,
      }),
    )
    edges.push(edge(previous, testCase.id), edge(testCase.id, markerId))
    previous = markerId
  }

  nodes.push(
    markerNode({
      id: 'mark-done',
      description: 'bookend',
      text: SWEEP_DONE_MARKER,
    }),
  )
  edges.push(edge(previous, 'mark-done'))

  return { ...hydrated, workflow: { nodes: stackNodes(nodes), edges }, variables }
}

/** The leg that carries the deliberately mismatched binding, and its variable. */
export const BINDING_NODE_ID = 'lbind'
export const BINDING_VAR = 'lbind_logs'

/**
 * The golden chain plus one per-line read with Timestamps on, whose `logs` is
 * bound to a variable declared `declared` instead of the table it produces.
 * Nothing here is meant to run: the pre-run gate is the surface under test.
 */
export function buildLogsBindingFixture(
  golden: Record<string, unknown>,
  ns: SeededNamespaces,
  declared: LogsShape,
): Record<string, unknown> {
  const hydrated = JSON.parse(
    resolveNamespace(JSON.stringify(golden), ns),
  ) as FixtureShape

  const nodes = [...hydrated.workflow.nodes]
  const edges = [...hydrated.workflow.edges]
  const variables: Record<string, unknown> = { ...hydrated.variables }
  variables[BINDING_VAR] = {
    value: EMPTY_BY_SHAPE[declared],
    type: declared,
    scope: 'test',
  }

  nodes.push(
    k8sReadNode({
      id: BINDING_NODE_ID,
      elementType: 'k8s-logs',
      description: 'LOGS-SHAPE-TABLE a table bound to the wrong type',
      expressionFields: ['session'],
      values: {
        session: SESSION_VAR,
        pod: POD_MULTI,
        container: 'app',
        timestamps: true,
        output_format: 'array',
      },
      outputBindings: { logs: BINDING_VAR },
    }),
  )
  edges.push(edge(GOLDEN_TAIL_ID, BINDING_NODE_ID))

  return {
    ...hydrated,
    name: 'K8s Logs Binding Type E2E Test',
    workflow: { nodes: stackNodes(nodes), edges },
    variables,
  }
}
