/**
 * R4 case table - every K8s Top option the sweep proves, as data.
 *
 * The table IS the checklist. Each leg names its option ids (the id families
 * are defined in the suite README), the session it runs under, and the exact
 * Block values.
 * The spec builds one chained workflow from this table with the shared node
 * factories; the checked-in `fixture-top-golden.json` pins the emitted node
 * shape so the generated form stays reviewable against a hand-authored one.
 */

import {
  chainEdges,
  k8sConnectNode,
  k8sReadNode,
  markerNode,
  stackNodes,
  type WorkflowEdge,
  type WorkflowNode,
} from '../../helpers/k8s-nodes'
import { SEEDED } from '../../helpers/k8s-seed'
import { HTTP_FIXTURE_HOST_SENTINEL, K8S_API_PORT } from '../../helpers/config'

/** The fixture-side API URL. `injectHttp` rewrites it in container-shard mode. */
export const K8S_API_URL = `https://${HTTP_FIXTURE_HOST_SENTINEL}:${K8S_API_PORT}`

/** One mebibyte in bytes - Top reports memory in bytes, never in Mi. */
export const MEBIBYTE = 1024 * 1024

/** kwok's per-container usage annotations on a seeded pod: 250m and 512Mi. */
export const ANNOTATED_CPU_CORES = 0.25
export const ANNOTATED_MEMORY_BYTES = 512 * MEBIBYTE

/** kwok's ClusterResourceUsage default for a pod with no annotations. */
export const DEFAULT_CPU_CORES = 0.001
export const DEFAULT_MEMORY_BYTES = MEBIBYTE

/** kwok-node-0's capacity and allocatable, exact from the checked-in manifest. */
export const NODE_CAPACITY = { cpu: 32, memory: 274877906944 }

/** The name every leg reads when it is meant to miss. */
export const MISSING_NAME = 'nope'

/** Which credential a leg runs under. `junk` is a hand-written kubeconfig, not
 *  a Connect output: a junk bearer token 401s on /version, so K8s Connect
 *  cannot produce that session. */
export type TopSession = 'admin' | 'limited' | 'junk'

const SESSION_VARIABLE: Record<TopSession, string> = {
  admin: 'sess_admin',
  limited: 'sess_limited',
  junk: 'sess_junk',
}

export interface TopLeg {
  /** Short key: the node is `top-<key>`, its variables are `<key>_*`. */
  key: string
  /** Option ids this leg proves. */
  ids: readonly string[]
  /** What the leg is, for the marker and the Block name. */
  what: string
  session: TopSession
  /** Everything the Block carries beyond `session`. */
  values: Record<string, unknown>
  /** The sheet cannot author this shape, so it is written into the fixture
   *  directly - the same route G-54 takes on Get. */
  fixtureOnly?: boolean
  /** The leg records a failure instead of succeeding: it binds the core
   *  outputs and its Block is expected to paint amber. */
  records?: boolean
}

/** One row per leg. Successes first: a hard failure stops the run, so the
 *  recorded-failure legs sit at the tail where they cannot hide a success. */
export const TOP_LEGS: readonly TopLeg[] = [
  {
    key: 't01',
    ids: ['T-01', 'T-03', 'T-10'],
    what: 'pod scope, every pod, no container breakdown',
    session: 'admin',
    values: { scope: 'pod', select_by: 'all', include_containers: false },
  },
  {
    key: 't03d',
    ids: ['T-03', 'TOP-DEFAULT-ALL'],
    what: 'pod scope with Select by never written, which means every pod',
    session: 'admin',
    values: { scope: 'pod' },
  },
  {
    key: 't11',
    ids: ['T-11', 'T-15', 'T-16'],
    what: 'pod scope, every pod, one row per container',
    session: 'admin',
    values: { scope: 'pod', select_by: 'all', include_containers: true },
  },
  {
    key: 't05',
    ids: ['T-05', 'T-08'],
    what: 'pod scope, label selector app=wave-target',
    session: 'admin',
    values: { scope: 'pod', select_by: 'selector', label_selector: 'app=wave-target' },
  },
  {
    key: 't09',
    ids: ['T-09'],
    what: 'pod scope, selector mode with no selector (known degenerate)',
    session: 'admin',
    values: { scope: 'pod', select_by: 'selector' },
  },
  {
    key: 't13',
    ids: ['T-13'],
    what: 'pod scope, every pod, all namespaces',
    session: 'admin',
    values: { scope: 'pod', select_by: 'all', all_namespaces: true },
  },
  {
    key: 't14',
    ids: ['T-14'],
    what: 'pod scope, one pod by name, all namespaces ticked',
    session: 'admin',
    fixtureOnly: true,
    values: {
      scope: 'pod',
      select_by: 'name',
      name: SEEDED.podLabeled,
      all_namespaces: true,
    },
  },
  {
    key: 't02',
    ids: ['T-02', 'T-17'],
    what: 'node scope, every node',
    session: 'admin',
    values: { scope: 'node', select_by: 'all' },
  },
  {
    key: 't12',
    ids: ['T-12'],
    what: 'node scope with the container breakdown ticked',
    session: 'admin',
    fixtureOnly: true,
    values: { scope: 'node', select_by: 'all', include_containers: true },
  },
  {
    key: 't23',
    ids: ['T-23'],
    what: 'pod scope, a pod name that does not exist',
    session: 'admin',
    records: true,
    values: { scope: 'pod', select_by: 'name', name: MISSING_NAME, on_error: 'record' },
  },
  {
    key: 't24',
    ids: ['T-24'],
    what: 'node scope, a node name that does not exist',
    session: 'admin',
    records: true,
    values: { scope: 'node', select_by: 'name', name: MISSING_NAME, on_error: 'record' },
  },
  {
    key: 't22',
    ids: ['T-22'],
    what: 'pod scope under the limited token, which carries no metrics rules',
    session: 'limited',
    records: true,
    values: { scope: 'pod', select_by: 'all', on_error: 'record' },
  },
  {
    key: 't25',
    ids: ['T-25'],
    what: 'pod scope under a junk bearer token',
    session: 'junk',
    records: true,
    values: { scope: 'pod', select_by: 'all', on_error: 'record' },
  },
]

/** The bookend marker the console harvest waits for. */
export const TOP_DONE_MARKER = 'k8s-top-sweep-done'

/** The marker line one leg writes, so a failure names the row it broke. */
export function legMarker(leg: TopLeg): string {
  return `[${leg.ids.join('|')}]`
}

export const usageVar = (leg: TopLeg): string => `${leg.key}_usage`
export const countVar = (leg: TopLeg): string => `${leg.key}_count`
export const okVar = (leg: TopLeg): string => `${leg.key}_ok`
export const errorVar = (leg: TopLeg): string => `${leg.key}_err`
export const reasonVar = (leg: TopLeg): string => `${leg.key}_reason`

/** A hand-written kubeconfig in the shape K8s Connect emits, so a session can
 *  carry a credential Connect itself would refuse to build. */
export function handWrittenSession(token: string, namespace: string): string {
  return JSON.stringify({
    apiVersion: 'v1',
    kind: 'Config',
    clusters: [
      {
        name: 'wave',
        cluster: { server: K8S_API_URL, 'insecure-skip-tls-verify': true },
      },
    ],
    users: [{ name: 'wave', user: { token } }],
    contexts: [{ name: 'wave', context: { cluster: 'wave', user: 'wave', namespace } }],
    'current-context': 'wave',
  })
}

/** A table variable as the session-variables API serializes it. */
export interface UsageTable {
  columns: Array<{ name: string; type: string }>
  rows: unknown[][]
}

/** The heading a pod read prints with the breakdown off (K8SREAD-17). */
export const POD_COLUMNS = ['NAME', 'CPU', 'MEMORY'] as const
export const POD_COLUMN_TYPES = ['string', 'float', 'integer'] as const

/** The breakdown inserts CONTAINER at index 1 and shifts CPU and MEMORY right. */
export const CONTAINER_COLUMNS = ['NAME', 'CONTAINER', 'CPU', 'MEMORY'] as const
export const CONTAINER_COLUMN_TYPES = ['string', 'string', 'float', 'integer'] as const

/** A node row prints its usage, then its capacity, then its allocatable. */
export const NODE_COLUMNS = [
  'NAME',
  'CPU',
  'MEMORY',
  'CAPACITY CPU',
  'CAPACITY MEMORY',
  'ALLOCATABLE CPU',
  'ALLOCATABLE MEMORY',
] as const
export const NODE_COLUMN_TYPES = [
  'string',
  'float',
  'integer',
  'float',
  'integer',
  'float',
  'integer',
] as const

/** Cell positions per heading, so an inserted column moves one index map
 *  instead of every assertion that reads a row. */
export const POD_CELL = { name: 0, cpu: 1, memory: 2 } as const
export const CONTAINER_CELL = { name: 0, container: 1, cpu: 2, memory: 3 } as const
export const NODE_CELL = {
  name: 0,
  cpu: 1,
  memory: 2,
  capacityCpu: 3,
  capacityMemory: 4,
  allocatableCpu: 5,
  allocatableMemory: 6,
} as const

/** One pod row of `usage`, read out of the table by cell position. */
export interface PodUsageRow {
  name: string
  cpu: number
  memory: number
}

/** One container row: the same cells, plus the container the breakdown names. */
export interface ContainerUsageRow extends PodUsageRow {
  container: string
}

/** One node row: usage, plus the node's own capacity and allocatable. */
export interface NodeUsageRow extends PodUsageRow {
  capacity: { cpu: number; memory: number }
  allocatable: { cpu: number; memory: number }
}

type FixtureVariable = { value: unknown; type: string; scope: string; secret?: boolean }

export interface TopSweepMaterial {
  adminToken: string
  limitedToken: string
  junkToken: string
  caCert: string
  namespace: string
}

function connectNode(id: string, tokenVariable: string, opts: TopSweepMaterial, sessionVariable: string): WorkflowNode {
  return k8sConnectNode({
    id,
    description: `Session for ${sessionVariable}`,
    expressionFields: ['token', 'ca_cert'],
    values: {
      api_url: K8S_API_URL,
      namespace: opts.namespace,
      timeout: 30,
      token: tokenVariable,
      verify_ssl: true,
      ca_cert: 'k8s_ca',
    },
    outputBindings: { session: sessionVariable },
  })
}

/** Build the whole sweep: two Connect Blocks, one Top Block plus one marker
 *  per leg, and the bookend. */
export function buildTopSweepFixture(material: TopSweepMaterial): Record<string, unknown> {
  const variables: Record<string, FixtureVariable> = {
    k8s_admin_token: { value: material.adminToken, type: 'string', scope: 'test', secret: true },
    k8s_limited_token: { value: material.limitedToken, type: 'string', scope: 'test', secret: true },
    k8s_ca: { value: material.caCert, type: 'string', scope: 'test' },
    sess_admin: { value: '', type: 'string', scope: 'test' },
    sess_limited: { value: '', type: 'string', scope: 'test' },
    sess_junk: {
      value: handWrittenSession(material.junkToken, material.namespace),
      type: 'string',
      scope: 'test',
    },
  }

  const nodes: WorkflowNode[] = [
    connectNode('connect-admin', 'k8s_admin_token', material, 'sess_admin'),
    connectNode('connect-limited', 'k8s_limited_token', material, 'sess_limited'),
  ]

  for (const leg of TOP_LEGS) {
    const outputBindings: Record<string, string> = {
      usage: usageVar(leg),
      count: countVar(leg),
    }
    variables[usageVar(leg)] = { value: [], type: 'table', scope: 'test' }
    variables[countVar(leg)] = { value: 0, type: 'integer', scope: 'test' }
    if (leg.records) {
      outputBindings.success = okVar(leg)
      outputBindings.error = errorVar(leg)
      outputBindings.reason = reasonVar(leg)
      variables[okVar(leg)] = { value: false, type: 'boolean', scope: 'test' }
      variables[errorVar(leg)] = { value: '', type: 'string', scope: 'test' }
      variables[reasonVar(leg)] = { value: '', type: 'string', scope: 'test' }
    }
    nodes.push(
      k8sReadNode({
        id: `top-${leg.key}`,
        elementType: 'k8s-top',
        description: `${legMarker(leg)} ${leg.what}`,
        expressionFields: ['session'],
        values: { session: SESSION_VARIABLE[leg.session], timeout: 30, ...leg.values },
        outputBindings,
      }),
      markerNode({
        id: `log-${leg.key}`,
        description: `Marker for ${leg.key}`,
        expression: `f'${legMarker(leg)} rows={${countVar(leg)}}'`,
      }),
    )
  }

  nodes.push(
    markerNode({ id: 'log-done', description: 'Bookend', text: TOP_DONE_MARKER }),
  )

  const laidOut = stackNodes(nodes)
  const edges: WorkflowEdge[] = chainEdges(laidOut.map((node) => node.id))

  return {
    name: 'K8s Top Option Sweep E2E Test',
    version: '1.0.0',
    description: '',
    workflow: { nodes: laidOut, edges },
    variables,
    metadata: { tags: [], suite_id: null, parent_suite: null },
  }
}
