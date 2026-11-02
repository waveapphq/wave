/**
 * R2 case table - every K8s Events option the sweep proves, as data.
 *
 * The table IS the checklist. Each leg names its option ids (the id families
 * are defined in the suite README), the session it runs under, and the exact
 * Block values. The
 * spec builds one chained workflow from this table with the shared node
 * factories; the checked-in `fixture-events-golden.json` pins the emitted node
 * shape so the generated form stays reviewable against a hand-authored one.
 */

import {
  chainEdges,
  edge,
  handleEdge,
  k8sConnectNode,
  k8sReadNode,
  markerNode,
  stackNodes,
  tryCatchNode,
  type WorkflowEdge,
  type WorkflowNode,
} from '../../helpers/k8s-nodes'
import { SEEDED } from '../../helpers/k8s-seed'
import { HTTP_FIXTURE_HOST_SENTINEL, K8S_API_PORT } from '../../helpers/config'

/** The fixture-side API URL. `injectHttp` rewrites it in container-shard mode. */
export const K8S_API_URL = `https://${HTTP_FIXTURE_HOST_SENTINEL}:${K8S_API_PORT}`

/** The four kwok Stage events the kubelet-events pod emits, oldest first. */
export const STAGE_REASONS = ['Pulling', 'Pulled', 'Created', 'Started'] as const

/** The four events the seeder POSTs onto the same pod, one per timestamp shape. */
export const POSTED_REASONS = [
  SEEDED.eventTimeReason,
  SEEDED.firstTimestampReason,
  SEEDED.creationOnlyReason,
  SEEDED.warningReason,
] as const

/** Everything a scoped read of the kubelet-events pod returns. The seeder gates
 *  on all four Stage events before it POSTs, so the set is exact. */
export const KUBELET_REASONS: readonly string[] = [...STAGE_REASONS, ...POSTED_REASONS]

/** Newest first, the order `_seen_at` must produce. The 1.5 s settle between the
 *  Stage chain and the POSTs is what makes the head deterministic. */
export const KUBELET_ORDER: readonly string[] = [
  SEEDED.creationOnlyReason,
  'Started',
  'Created',
  'Pulled',
  'Pulling',
  SEEDED.warningReason,
  SEEDED.eventTimeReason,
  SEEDED.firstTimestampReason,
]

/** The clause the apiserver cannot parse: no operator in it. */
export const MALFORMED_SELECTOR_TOKEN = 'bogus'

/** A value that turns the block's field selector into one the apiserver cannot
 *  parse: the comma opens a second clause with no operator in it. */
export const MALFORMED_REASON = `${SEEDED.warningReason},${MALFORMED_SELECTOR_TOKEN}`

/** Which credential a leg runs under. `anon` and `junk` are hand-written
 *  kubeconfigs, not Connect outputs: a junk bearer token 401s on /version, so
 *  K8s Connect cannot build that session at all. */
export type EventsSession = 'admin' | 'anon' | 'junk'

const SESSION_VARIABLE: Record<EventsSession, string> = {
  admin: 'sess_admin',
  anon: 'sess_anon',
  junk: 'sess_junk',
}

/** The shape `result` comes back in, which decides the bound variable's type. */
export type ResultShape = 'array' | 'string' | 'table'

export interface EventsLeg {
  /** Short key: the node is `evt-<key>`, its variables are `<key>_*`. */
  key: string
  /** Option ids this leg proves. */
  ids: readonly string[]
  /** What the leg is, for the marker and the Block name. */
  what: string
  session: EventsSession
  /** Everything the Block carries beyond `session`. */
  values: Record<string, unknown>
  shape: ResultShape
  /** The leg records a failure instead of succeeding: its Block paints amber. */
  records?: boolean
  /** The leg succeeds but its point is the output core, so bind it too. */
  core?: boolean
}

/** Scope one read to the kubelet-events pod through the picker path. */
const scopedToKubeletPod = {
  scope_to_object: true,
  object_type: 'default',
  object_kind: 'Pod',
  object_name: SEEDED.podKubelet,
}

/** One row per leg. Successes first: a recorded failure sits at the tail where
 *  it cannot hide a success, and the guarded S-03 leg is wired separately. */
export const EVENTS_LEGS: readonly EventsLeg[] = [
  {
    key: 'e01',
    ids: ['E-01'],
    what: 'whole-namespace read, no object scope',
    session: 'admin',
    values: { output_format: 'map' },
    shape: 'array',
  },
  {
    key: 'e02',
    ids: [
      'E-02',
      'E-03',
      'E-05',
      'E-08',
      'E-17',
      'E-19',
      'E-22',
      'E-25',
      'E-32',
      'E-33',
      'E-34',
      'E-35',
    ],
    what: 'scoped to the kubelet-events pod, no filters (the anchor)',
    session: 'admin',
    values: { ...scopedToKubeletPod, output_format: 'map' },
    shape: 'array',
  },
  {
    key: 'e04',
    ids: ['E-04', 'E-12'],
    what: 'scoped through Custom object type with the exact kind typed',
    session: 'admin',
    values: {
      scope_to_object: true,
      object_type: 'custom',
      object_kind_custom: 'Pod',
      object_name: SEEDED.podKubelet,
      output_format: 'map',
    },
    shape: 'array',
  },
  {
    key: 'e13',
    ids: ['E-13', 'EVENTS-KIND-RESOLVE'],
    what: 'scoped through Custom with the PLURAL kind, which discovery resolves',
    session: 'admin',
    core: true,
    values: {
      scope_to_object: true,
      object_type: 'custom',
      object_kind_custom: 'pods',
      object_name: SEEDED.podKubelet,
      output_format: 'map',
    },
    shape: 'array',
  },
  {
    key: 'e13b',
    ids: ['EVENTS-KIND-RESOLVE'],
    what: 'scoped through Custom with the kubectl SHORT name',
    session: 'admin',
    values: {
      scope_to_object: true,
      object_type: 'custom',
      object_kind_custom: 'po',
      object_name: SEEDED.podKubelet,
      output_format: 'map',
    },
    shape: 'array',
  },
  {
    key: 'e09',
    ids: ['E-09'],
    what: 'scoped to the Deployment',
    session: 'admin',
    values: {
      scope_to_object: true,
      object_type: 'default',
      object_kind: 'Deployment',
      object_name: SEEDED.deployment,
      output_format: 'map',
    },
    shape: 'array',
  },
  {
    key: 'e10',
    ids: ['E-10'],
    what: 'scoped to the ReplicaSet',
    session: 'admin',
    values: {
      scope_to_object: true,
      object_type: 'default',
      object_kind: 'ReplicaSet',
      object_name: SEEDED.replicaSet,
      output_format: 'map',
    },
    shape: 'array',
  },
  {
    key: 'e11',
    ids: ['E-11'],
    what: 'the anchor object name under a kind that has no events at all',
    session: 'admin',
    core: true,
    values: {
      scope_to_object: true,
      object_type: 'default',
      object_kind: 'Service',
      object_name: SEEDED.podKubelet,
      output_format: 'map',
    },
    shape: 'array',
  },
  {
    key: 'e14',
    ids: ['E-14'],
    what: 'event type Any',
    session: 'admin',
    values: { ...scopedToKubeletPod, event_type: 'any', output_format: 'map' },
    shape: 'array',
  },
  {
    key: 'e15',
    ids: ['E-15'],
    what: 'event type Warning',
    session: 'admin',
    values: { ...scopedToKubeletPod, event_type: 'Warning', output_format: 'map' },
    shape: 'array',
  },
  {
    key: 'e16',
    ids: ['E-16'],
    what: 'event type Normal',
    session: 'admin',
    values: { ...scopedToKubeletPod, event_type: 'Normal', output_format: 'map' },
    shape: 'array',
  },
  {
    key: 'e18',
    ids: ['E-18'],
    what: 'one event reason',
    session: 'admin',
    values: { ...scopedToKubeletPod, reason: SEEDED.warningReason, output_format: 'map' },
    shape: 'array',
  },
  {
    key: 'e20',
    ids: ['E-20'],
    what: 'a day-wide age window',
    session: 'admin',
    values: { ...scopedToKubeletPod, within_seconds: 86_400, output_format: 'map' },
    shape: 'array',
  },
  {
    key: 'e21',
    ids: ['E-21'],
    what: 'a one-second age window, which every seeded event is older than',
    session: 'admin',
    values: { ...scopedToKubeletPod, within_seconds: 1, output_format: 'map' },
    shape: 'array',
  },
  {
    key: 'e23',
    ids: ['E-23'],
    what: 'max events below the available count',
    session: 'admin',
    values: { ...scopedToKubeletPod, max_events: 3, output_format: 'map' },
    shape: 'array',
  },
  {
    key: 'e24',
    ids: ['E-24'],
    what: 'max events above the available count',
    session: 'admin',
    values: { ...scopedToKubeletPod, max_events: 100, output_format: 'map' },
    shape: 'array',
  },
  {
    key: 'e26',
    ids: ['E-26', 'TABLE-KIND'],
    what: 'Table output the cluster really prints, cut at one row',
    session: 'admin',
    values: { ...scopedToKubeletPod, max_events: 1, output_format: 'table' },
    shape: 'table',
  },
  {
    key: 'e27',
    ids: ['E-27'],
    what: 'JSON output cut at two events',
    session: 'admin',
    values: { ...scopedToKubeletPod, max_events: 2, output_format: 'json' },
    shape: 'string',
  },
  {
    key: 'e28',
    ids: ['E-28'],
    what: 'YAML output cut at two events',
    session: 'admin',
    values: { ...scopedToKubeletPod, max_events: 2, output_format: 'yaml' },
    shape: 'string',
  },
  {
    key: 'e29a',
    ids: ['E-29'],
    what: "the second namespace's pod, read from the session namespace only",
    session: 'admin',
    core: true,
    values: {
      scope_to_object: true,
      object_type: 'default',
      object_kind: 'Pod',
      object_name: SEEDED.podOther,
      output_format: 'map',
    },
    shape: 'array',
  },
  {
    key: 'e29b',
    ids: ['E-29'],
    what: 'the same scoped read with All namespaces ticked',
    session: 'admin',
    values: {
      scope_to_object: true,
      object_type: 'default',
      object_kind: 'Pod',
      object_name: SEEDED.podOther,
      all_namespaces: true,
      output_format: 'map',
    },
    shape: 'array',
  },
  {
    key: 'e37',
    ids: ['E-37'],
    what: 'an event reason that makes the field selector unparsable',
    session: 'admin',
    records: true,
    values: { reason: MALFORMED_REASON, output_format: 'map', on_error: 'record' },
    shape: 'array',
  },
  {
    key: 'e38',
    ids: ['E-38'],
    what: 'an anonymous session, which no role binds',
    session: 'anon',
    records: true,
    values: { output_format: 'map', on_error: 'record' },
    shape: 'array',
  },
  {
    key: 'e39',
    ids: ['E-39'],
    what: 'a junk bearer token',
    session: 'junk',
    records: true,
    values: { output_format: 'map', on_error: 'record' },
    shape: 'array',
  },
]

/** The bookend marker the console harvest waits for. */
export const EVENTS_DONE_MARKER = 'k8s-events-sweep-done'

/** The bookend of the golden run, which the Kind picker drives. */
export const EVENTS_GOLDEN_MARKER = 'k8s-events-golden-done'

/** The marker line one leg writes, so a failure names the row it broke. */
export function legMarker(leg: EventsLeg): string {
  return `[${leg.ids.join('|')}]`
}

/** The guarded leg: the shared S-03 row on a second Block. */
export const SESSION_EMPTY_MARKER = '[S-03]'
export const SESSION_EMPTY_CAUGHT = `${SESSION_EMPTY_MARKER} caught`
export const SESSION_EMPTY_ERROR_MARKER = `${SESSION_EMPTY_MARKER} err=`
export const SESSION_EMPTY_VARIABLE = 'sess_empty'
export const SESSION_EMPTY_ERROR = 's03_err'

export const resultVar = (leg: EventsLeg): string => `${leg.key}_result`
export const countVar = (leg: EventsLeg): string => `${leg.key}_count`
export const okVar = (leg: EventsLeg): string => `${leg.key}_ok`
export const errorVar = (leg: EventsLeg): string => `${leg.key}_err`
export const reasonVar = (leg: EventsLeg): string => `${leg.key}_reason`

/** A hand-written kubeconfig in the shape K8s Connect emits, so a session can
 *  carry a credential Connect itself would refuse to build. Pass no token for
 *  the anonymous identity. */
export function handWrittenSession(token: string | null, namespace: string): string {
  return JSON.stringify({
    apiVersion: 'v1',
    kind: 'Config',
    clusters: [
      {
        name: 'wave',
        cluster: { server: K8S_API_URL, 'insecure-skip-tls-verify': true },
      },
    ],
    users: [{ name: 'wave', user: token === null ? {} : { token } }],
    contexts: [{ name: 'wave', context: { cluster: 'wave', user: 'wave', namespace } }],
    'current-context': 'wave',
  })
}

/** One event object as the map-mode `result` carries it. */
export interface EventItem {
  reason?: string
  type?: string
  message?: string
  metadata?: { name?: string; namespace?: string }
  involvedObject?: { kind?: string; name?: string; namespace?: string }
}

/** A table variable as the session-variables API serializes it. */
export interface SerializedTable {
  columns: Array<{ name: string; type: string }>
  rows: unknown[][]
}

type FixtureVariable = { value: unknown; type: string; scope: string; secret?: boolean }

const EMPTY_FOR_SHAPE: Record<ResultShape, unknown> = {
  array: [],
  string: '',
  table: [],
}

export interface EventsSweepMaterial {
  adminToken: string
  junkToken: string
  caCert: string
  namespace: string
}

/** The admin Connect Block at the head of the chain. */
function connectNode(material: EventsSweepMaterial): WorkflowNode {
  return k8sConnectNode({
    id: 'connect-admin',
    description: 'Admin session, default namespace = the run namespace',
    expressionFields: ['token', 'ca_cert'],
    values: {
      api_url: K8S_API_URL,
      namespace: material.namespace,
      timeout: 30,
      token: 'k8s_admin_token',
      verify_ssl: true,
      ca_cert: 'k8s_ca',
    },
    outputBindings: { session: 'sess_admin' },
  })
}

/** Build the whole sweep: one Connect Block, one Events Block plus one marker
 *  per leg, the guarded empty-session leg, and the bookend. */
export function buildEventsSweepFixture(
  material: EventsSweepMaterial,
): Record<string, unknown> {
  const variables: Record<string, FixtureVariable> = {
    k8s_admin_token: { value: material.adminToken, type: 'string', scope: 'test', secret: true },
    k8s_ca: { value: material.caCert, type: 'string', scope: 'test' },
    sess_admin: { value: '', type: 'string', scope: 'test' },
    sess_anon: {
      value: handWrittenSession(null, material.namespace),
      type: 'string',
      scope: 'test',
    },
    sess_junk: {
      value: handWrittenSession(material.junkToken, material.namespace),
      type: 'string',
      scope: 'test',
    },
    // Declared and left empty on purpose: this is the S-03 row.
    [SESSION_EMPTY_VARIABLE]: { value: '', type: 'string', scope: 'test' },
    [SESSION_EMPTY_ERROR]: { value: {}, type: 'map', scope: 'test' },
  }

  const nodes: WorkflowNode[] = [connectNode(material)]
  const chain: string[] = ['connect-admin']

  for (const leg of EVENTS_LEGS) {
    const outputBindings: Record<string, string> = {
      result: resultVar(leg),
      count: countVar(leg),
    }
    variables[resultVar(leg)] = {
      value: EMPTY_FOR_SHAPE[leg.shape],
      type: leg.shape,
      scope: 'test',
    }
    variables[countVar(leg)] = { value: 0, type: 'integer', scope: 'test' }
    if (leg.records || leg.core) {
      outputBindings.success = okVar(leg)
      outputBindings.error = errorVar(leg)
      outputBindings.reason = reasonVar(leg)
      variables[okVar(leg)] = { value: false, type: 'boolean', scope: 'test' }
      variables[errorVar(leg)] = { value: '', type: 'string', scope: 'test' }
      variables[reasonVar(leg)] = { value: '', type: 'string', scope: 'test' }
    }
    nodes.push(
      k8sReadNode({
        id: `evt-${leg.key}`,
        elementType: 'k8s-events',
        description: `${legMarker(leg)} ${leg.what}`,
        expressionFields: ['session'],
        values: { session: SESSION_VARIABLE[leg.session], timeout: 30, ...leg.values },
        outputBindings,
      }),
      markerNode({
        id: `log-${leg.key}`,
        description: `Marker for ${leg.key}`,
        expression: `f'${legMarker(leg)} n={${countVar(leg)}}'`,
      }),
    )
    chain.push(`evt-${leg.key}`, `log-${leg.key}`)
  }

  // S-03 raises from validate(), which stops the run, so it rides a Try/Catch.
  nodes.push(
    tryCatchNode({
      id: 'tc-s03',
      description: 'Guard for the empty-session leg',
      errorBinding: SESSION_EMPTY_ERROR,
    }),
    k8sReadNode({
      id: 'evt-s03',
      elementType: 'k8s-events',
      description: `${SESSION_EMPTY_MARKER} session points at a declared but empty variable`,
      expressionFields: ['session'],
      values: { session: SESSION_EMPTY_VARIABLE, timeout: 30, output_format: 'map' },
    }),
    markerNode({
      id: 'log-s03',
      description: 'Marker for the caught empty session',
      level: 'WARN',
      text: SESSION_EMPTY_CAUGHT,
    }),
    // The error binding is applied after the catch chain, so the message is
    // only readable on the then branch.
    markerNode({
      id: 'log-s03-err',
      description: 'Marker for the bound empty-session error',
      expression:
        `f'${SESSION_EMPTY_ERROR_MARKER}` +
        `{${SESSION_EMPTY_ERROR}["message"] if ${SESSION_EMPTY_ERROR} else "NO-ERROR-CAUGHT"}'`,
    }),
    markerNode({ id: 'log-done', description: 'Bookend', text: EVENTS_DONE_MARKER }),
  )
  chain.push('tc-s03')

  const laidOut = stackNodes(nodes)
  const edges: WorkflowEdge[] = [
    ...chainEdges(chain),
    handleEdge('tc-s03', 'try', 'evt-s03'),
    handleEdge('tc-s03', 'catch', 'log-s03'),
    handleEdge('tc-s03', 'then', 'log-s03-err'),
    edge('log-s03-err', 'log-done'),
  ]

  return {
    name: 'K8s Events Option Sweep E2E Test',
    version: '1.0.0',
    description: '',
    workflow: { nodes: laidOut, edges },
    variables,
    metadata: { tags: [], suite_id: null, parent_suite: null },
  }
}
