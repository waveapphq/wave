/**
 * R1 case table - every K8s Get option the sweep proves, as data.
 *
 * The table IS the checklist. Each leg names its option ids (the id families
 * are defined in the suite README), the session it runs under, the exact
 * Block values, and the plugin INFO line the read must print. The spec builds
 * one chained
 * workflow from this table with the shared node factories; the checked-in
 * `fixture-get-golden.json` pins the emitted node shape so the generated form
 * stays reviewable against a hand-authored one.
 *
 * Two exported halves: the Kind sweep and the shape legs (search, selector,
 * format, version, namespace). They ship in one file today; splitting them
 * into two specs is a one-line change if the file outgrows its 60 s budget.
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

/** The read-only namespace baked into the kwok image, and the custom resource
 *  standing in it. Nothing writes to `restricted`, so both are stable. */
export const CRD_NAMESPACE = 'restricted'
export const CRD_KIND = 'WaveGadget'
export const CRD_OBJECT = 'wave-gadget-0'
export const CRD_ROOT = '/apis/wave.e2e/v1'

/** The kubectl columns a Pod Table carries, in order. */
export const POD_TABLE_COLUMNS = [
  'Name',
  'Ready',
  'Status',
  'Restarts',
  'Age',
  'IP',
  'Node',
  'Nominated Node',
  'Readiness Gates',
] as const

/** The kubectl columns a Secret Table carries, in order. */
export const SECRET_TABLE_COLUMNS = ['Name', 'Type', 'Data', 'Age'] as const

/** A kind no cluster serves, for the discovery miss. */
export const MISSING_KIND = 'widgets'

/** Which credential a leg runs under. `junk` and `empty` are hand-written
 *  session variables, not Connect outputs: a junk bearer token 401s on
 *  /version, so K8s Connect cannot produce that session at all. */
export type GetSession = 'admin' | 'limited' | 'anon' | 'junk' | 'empty'

export const SESSION_VARIABLE: Record<GetSession, string> = {
  admin: 'sess_admin',
  limited: 'sess_limited',
  anon: 'sess_anon',
  junk: 'sess_junk',
  empty: 'sess_empty',
}

/** The `result` type the Output Format and Search by pair declares.
 *  The fixture declares the bound variable with exactly this type, and the
 *  pre-run gate refuses a mismatch, so a run that STARTS proves it. */
export type ResultType = 'map' | 'array' | 'table' | 'string'

/** The plugin's own success line: `Read {n} {kind} object(s) from {path}`. */
export interface ExpectedRead {
  kind: string
  path: string
  /** Set only where the count is fixed; otherwise any count is accepted. */
  count?: number
}

export interface GetLeg {
  /** Short key: the node is `get-<key>`, its variables are `<key>_*`. */
  key: string
  /** Option ids this leg proves. */
  ids: readonly string[]
  /** What the leg is, for the marker and the Block name. */
  what: string
  session: GetSession
  /** Everything the Block carries beyond `session`. */
  values: Record<string, unknown>
  /** Bind `result` and declare the variable with this type. */
  resultType?: ResultType
  /** The sheet cannot author this shape, so it is written into the fixture
   *  directly - the route G-54 and T-14 both take. */
  fixtureOnly?: boolean
  /** The leg records a failure instead of succeeding: it binds the core
   *  outputs and its Block is expected to paint amber. */
  records?: boolean
  expectRead?: ExpectedRead
  /** Overrides the marker expression, for a leg whose console line has to
   *  carry more than its count. */
  marker?: string
}

/** The run-specific names a leg needs. */
export interface GetContext {
  namespace: string
  namespaceB: string
  storageClass: string
  persistentVolume: string
}

const core = (ctx: GetContext, plural: string): string =>
  `/api/v1/namespaces/${ctx.namespace}/${plural}`
const apps = (ctx: GetContext, plural: string): string =>
  `/apis/apps/v1/namespaces/${ctx.namespace}/${plural}`
const batch = (ctx: GetContext, plural: string): string =>
  `/apis/batch/v1/namespaces/${ctx.namespace}/${plural}`
const net = (ctx: GetContext, plural: string): string =>
  `/apis/networking.k8s.io/v1/namespaces/${ctx.namespace}/${plural}`
const rbac = (ctx: GetContext, plural: string): string =>
  `/apis/rbac.authorization.k8s.io/v1/namespaces/${ctx.namespace}/${plural}`

/** A picker (default) list read of one kind. */
function kindList(
  key: string,
  ids: readonly string[],
  kind: string,
  path: string,
  extra: Record<string, unknown> = {},
): GetLeg {
  return {
    key,
    ids,
    what: `${kind} list read`,
    session: 'admin',
    values: {
      resource_type: 'default',
      kind,
      search_by: 'list',
      output_format: 'map',
      ...extra,
    },
    expectRead: { kind, path },
  }
}

/** The 23 stock Kinds, each carrying a rotated option. 17 are namespaced and
 *  6 are cluster-scoped, which is why six paths carry no namespace segment. */
export function kindLegs(ctx: GetContext): GetLeg[] {
  return [
    {
      key: 'g07',
      ids: ['G-01', 'G-07', 'G-30', 'G-34', 'G-37', 'G-45', 'S-01', 'S-05', 'S-08', 'RESULT-TYPE'],
      what: 'Pod by name, Map, session default namespace',
      session: 'admin',
      values: {
        resource_type: 'default',
        kind: 'Pod',
        search_by: 'name',
        name: SEEDED.podLabeled,
        output_format: 'map',
      },
      resultType: 'map',
      expectRead: {
        kind: 'Pod',
        path: `${core(ctx, 'pods')}/${SEEDED.podLabeled}`,
        count: 1,
      },
    },
    {
      key: 'g36',
      ids: ['G-36', 'G-45', 'S-11', 'RESULT-TYPE'],
      what: 'Pod list, Map, all namespaces off',
      session: 'admin',
      values: {
        resource_type: 'default',
        kind: 'Pod',
        search_by: 'list',
        output_format: 'map',
        all_namespaces: false,
      },
      resultType: 'array',
      expectRead: { kind: 'Pod', path: core(ctx, 'pods') },
    },
    kindList('g14', ['G-14'], 'ConfigMap', core(ctx, 'configmaps')),
    {
      key: 'g15a',
      ids: ['G-15'],
      what: 'Secret by name, Map - the value must never surface',
      // The result rides the console on purpose: the registered data value has
      // to come back masked there too, not only in the stored record.
      marker: "f'[G-15] g15a count={g15a_count} data={g15a_result}'",
      session: 'admin',
      values: {
        resource_type: 'default',
        kind: 'Secret',
        search_by: 'name',
        name: SEEDED.secret,
        output_format: 'map',
      },
      resultType: 'map',
      expectRead: {
        kind: 'Secret',
        path: `${core(ctx, 'secrets')}/${SEEDED.secret}`,
        count: 1,
      },
    },
    {
      key: 'g15b',
      ids: ['G-15'],
      what: 'Secret list, Table - metadata only',
      session: 'admin',
      values: {
        resource_type: 'default',
        kind: 'Secret',
        search_by: 'list',
        output_format: 'table',
      },
      resultType: 'table',
      expectRead: { kind: 'Secret', path: core(ctx, 'secrets'), count: 1 },
    },
    kindList('g13', ['G-13'], 'Service', core(ctx, 'services')),
    kindList('g10', ['G-10'], 'Endpoints', core(ctx, 'endpoints')),
    kindList('g11', ['G-11'], 'Ingress', net(ctx, 'ingresses')),
    kindList('g12', ['G-12'], 'NetworkPolicy', net(ctx, 'networkpolicies')),
    kindList('g18', ['G-18'], 'PersistentVolumeClaim', core(ctx, 'persistentvolumeclaims')),
    kindList('g24', ['G-24'], 'Role', rbac(ctx, 'roles')),
    kindList('g25', ['G-25'], 'RoleBinding', rbac(ctx, 'rolebindings')),
    kindList('g16', ['G-16'], 'ServiceAccount', core(ctx, 'serviceaccounts')),
    kindList('g05', ['G-05'], 'Deployment', apps(ctx, 'deployments')),
    kindList('g08', ['G-08'], 'ReplicaSet', apps(ctx, 'replicasets')),
    kindList('g09', ['G-09'], 'StatefulSet', apps(ctx, 'statefulsets')),
    kindList('g04', ['G-04'], 'DaemonSet', apps(ctx, 'daemonsets')),
    kindList('g06', ['G-06'], 'Job', batch(ctx, 'jobs')),
    kindList('g03', ['G-03'], 'CronJob', batch(ctx, 'cronjobs')),
    kindList('g23', ['G-23'], 'Node', '/api/v1/nodes'),
    kindList('g20', ['G-20'], 'ClusterRole', '/apis/rbac.authorization.k8s.io/v1/clusterroles'),
    kindList(
      'g21',
      ['G-21'],
      'ClusterRoleBinding',
      '/apis/rbac.authorization.k8s.io/v1/clusterrolebindings',
    ),
    {
      key: 'g22',
      ids: ['G-22'],
      what: 'Namespace by name - the run namespace itself',
      session: 'admin',
      values: {
        resource_type: 'default',
        kind: 'Namespace',
        search_by: 'name',
        name: ctx.namespace,
        output_format: 'map',
      },
      expectRead: { kind: 'Namespace', path: `/api/v1/namespaces/${ctx.namespace}`, count: 1 },
    },
    {
      key: 'g17',
      ids: ['G-17', 'G-55'],
      what: 'PersistentVolume list, both namespace options ignored',
      session: 'admin',
      values: {
        resource_type: 'default',
        kind: 'PersistentVolume',
        search_by: 'list',
        output_format: 'map',
        all_namespaces: true,
        namespace: ctx.namespaceB,
      },
      fixtureOnly: true,
      expectRead: { kind: 'PersistentVolume', path: '/api/v1/persistentvolumes' },
    },
    kindList('g19', ['G-19'], 'StorageClass', '/apis/storage.k8s.io/v1/storageclasses'),
  ]
}

/** A custom-mode read of one Pod by name. The four name forms all have to
 *  resolve to the same plural, so they all print the same path. */
function customPodByName(key: string, ids: readonly string[], typed: string, ctx: GetContext): GetLeg {
  return {
    key,
    ids,
    what: `custom kind '${typed}' by name`,
    session: 'admin',
    values: {
      resource_type: 'custom',
      kind_custom: typed,
      search_by: 'name',
      name: SEEDED.podLabeled,
      output_format: 'map',
    },
    expectRead: {
      kind: 'Pod',
      path: `${core(ctx, 'pods')}/${SEEDED.podLabeled}`,
      count: 1,
    },
  }
}

/** Resolution forms, selectors, formats, version pins and namespace options. */
export function shapeLegs(ctx: GetContext): GetLeg[] {
  const labelQuery = `?labelSelector=${encodeURIComponent(SEEDED.labelSelector)}`
  const fieldOnly = `?fieldSelector=metadata.name%3D${SEEDED.podPlain}`
  const bothQuery = `${labelQuery}&fieldSelector=metadata.name%3D${SEEDED.podPlain}`
  return [
    customPodByName('g02', ['G-02', 'G-26'], 'Pod', ctx),
    customPodByName('g27', ['G-27'], 'pods', ctx),
    customPodByName('g28', ['G-28'], 'pod', ctx),
    customPodByName('g29', ['G-29'], 'po', ctx),
    {
      key: 'g31',
      ids: ['G-31'],
      what: "custom kind 'deploy' via the group walk",
      session: 'admin',
      values: {
        resource_type: 'custom',
        kind_custom: 'deploy',
        search_by: 'list',
        output_format: 'map',
      },
      expectRead: { kind: 'Deployment', path: apps(ctx, 'deployments') },
    },
    {
      key: 'g33',
      ids: ['G-33'],
      what: 'a real custom resource, in the image namespace',
      session: 'admin',
      values: {
        resource_type: 'custom',
        kind_custom: CRD_KIND,
        search_by: 'list',
        output_format: 'map',
        namespace: CRD_NAMESPACE,
      },
      expectRead: {
        kind: CRD_KIND,
        path: `${CRD_ROOT}/namespaces/${CRD_NAMESPACE}/wavegadgets`,
        count: 1,
      },
    },
    {
      key: 'g35',
      ids: ['G-35', 'G-40'],
      what: 'label selector keeps the labeled pod',
      session: 'admin',
      values: {
        resource_type: 'default',
        kind: 'Pod',
        search_by: 'selector',
        label_selector: SEEDED.labelSelector,
        output_format: 'map',
      },
      expectRead: { kind: 'Pod', path: `${core(ctx, 'pods')}${labelQuery}` },
    },
    {
      key: 'g42',
      ids: ['G-42'],
      what: 'field selector on metadata.name',
      session: 'admin',
      values: {
        resource_type: 'default',
        kind: 'Pod',
        search_by: 'selector',
        field_selector: `metadata.name=${SEEDED.podPlain}`,
        output_format: 'map',
      },
      expectRead: { kind: 'Pod', path: `${core(ctx, 'pods')}${fieldOnly}`, count: 1 },
    },
    {
      key: 'g44',
      ids: ['G-44'],
      what: 'both selectors, the intersection',
      session: 'admin',
      values: {
        resource_type: 'default',
        kind: 'Pod',
        search_by: 'selector',
        label_selector: SEEDED.labelSelector,
        field_selector: `metadata.name=${SEEDED.podPlain}`,
        output_format: 'map',
      },
      expectRead: { kind: 'Pod', path: `${core(ctx, 'pods')}${bothQuery}`, count: 0 },
    },
    {
      key: 'g41',
      ids: ['G-41', 'G-43'],
      what: 'selector mode, no selector (degenerate)',
      session: 'admin',
      values: {
        resource_type: 'default',
        kind: 'Pod',
        search_by: 'selector',
        output_format: 'map',
      },
      expectRead: { kind: 'Pod', path: core(ctx, 'pods') },
    },
    {
      key: 'g53',
      ids: ['G-53'],
      what: 'all namespaces on a selector read',
      session: 'admin',
      values: {
        resource_type: 'default',
        kind: 'Pod',
        search_by: 'selector',
        label_selector: SEEDED.labelSelector,
        output_format: 'map',
        all_namespaces: true,
      },
      expectRead: { kind: 'Pod', path: `/api/v1/pods${labelQuery}` },
    },
    {
      key: 'g54',
      ids: ['G-54'],
      what: 'all namespaces ticked on a name read',
      session: 'admin',
      values: {
        resource_type: 'default',
        kind: 'Pod',
        search_by: 'name',
        name: SEEDED.podLabeled,
        output_format: 'map',
        all_namespaces: true,
      },
      fixtureOnly: true,
      expectRead: {
        kind: 'Pod',
        path: `${core(ctx, 'pods')}/${SEEDED.podLabeled}`,
        count: 1,
      },
    },
    {
      key: 'g47',
      ids: ['G-47', 'RESULT-TYPE'],
      what: 'Output Format JSON, list read',
      session: 'admin',
      values: {
        resource_type: 'default',
        kind: 'Pod',
        search_by: 'list',
        output_format: 'json',
      },
      resultType: 'string',
      expectRead: { kind: 'Pod', path: core(ctx, 'pods') },
    },
    {
      key: 'g48',
      ids: ['G-48', 'RESULT-TYPE'],
      what: 'Output Format YAML, name read',
      session: 'admin',
      values: {
        resource_type: 'default',
        kind: 'Pod',
        search_by: 'name',
        name: SEEDED.podLabeled,
        output_format: 'yaml',
      },
      resultType: 'string',
      expectRead: {
        kind: 'Pod',
        path: `${core(ctx, 'pods')}/${SEEDED.podLabeled}`,
        count: 1,
      },
    },
    {
      key: 'g46',
      ids: ['G-46', 'RESULT-TYPE'],
      what: 'Output Format Table, list read',
      session: 'admin',
      values: {
        resource_type: 'default',
        kind: 'Pod',
        search_by: 'list',
        output_format: 'table',
      },
      resultType: 'table',
      expectRead: { kind: 'Pod', path: core(ctx, 'pods') },
    },
    {
      key: 's10',
      ids: ['S-10'],
      what: 'a whitespace-only namespace override',
      session: 'admin',
      values: {
        resource_type: 'default',
        kind: 'Pod',
        search_by: 'name',
        name: SEEDED.podLabeled,
        output_format: 'map',
        namespace: '   ',
      },
      expectRead: {
        kind: 'Pod',
        path: `${core(ctx, 'pods')}/${SEEDED.podLabeled}`,
        count: 1,
      },
    },
  ]
}

/** The whole sweep, in run order. */
export function getLegs(ctx: GetContext): GetLeg[] {
  return [...kindLegs(ctx), ...shapeLegs(ctx)]
}

/** The pod names the failure legs miss on. Each is unique to its leg, so the
 *  WARN line it writes can be counted on its own. */
export const MISSING_POD = 'wave-nope-s20'
export const MISSING_POD_YAML = 'wave-nope-yaml'

/** A field label no Pod carries. The cluster answers 400 with its own text. */
export const BAD_FIELD_SELECTOR = 'spec.bogus=1'

/** The eight empty-shape cells and their error wordings, plus the amber row.
 *  Split out of the sweep so neither file outgrows its runtime budget. */
export function failureLegs(): GetLeg[] {
  return [
    {
      key: 'g56',
      ids: ['G-56'],
      what: 'junk token, Map + listed empty',
      session: 'junk',
      records: true,
      values: {
        resource_type: 'default',
        kind: 'Pod',
        search_by: 'list',
        output_format: 'map',
        on_error: 'record',
      },
      resultType: 'array',
    },
    {
      key: 'g57',
      ids: ['G-57'],
      what: 'anonymous session, Map + named empty',
      session: 'anon',
      records: true,
      values: {
        resource_type: 'default',
        kind: 'Pod',
        search_by: 'name',
        name: SEEDED.podLabeled,
        output_format: 'map',
        on_error: 'record',
      },
      resultType: 'map',
    },
    {
      key: 'g58',
      ids: ['G-32', 'G-58'],
      what: 'unknown kind, Table + listed empty',
      session: 'admin',
      records: true,
      values: {
        resource_type: 'custom',
        kind_custom: MISSING_KIND,
        search_by: 'list',
        output_format: 'table',
        on_error: 'record',
      },
      resultType: 'table',
    },
    {
      key: 'g59',
      ids: ['G-59', 'S-20', 'ONE-WARN'],
      what: 'missing name, Table + named empty, amber',
      session: 'admin',
      records: true,
      values: {
        resource_type: 'default',
        kind: 'Pod',
        search_by: 'name',
        name: MISSING_POD,
        output_format: 'table',
        on_error: 'record',
      },
      resultType: 'table',
    },
    {
      key: 'g60',
      ids: ['G-60'],
      what: 'junk token, JSON + listed empty',
      session: 'junk',
      records: true,
      values: {
        resource_type: 'default',
        kind: 'Pod',
        search_by: 'list',
        output_format: 'json',
        on_error: 'record',
      },
      resultType: 'string',
    },
    {
      key: 'g61',
      ids: ['G-61'],
      what: 'view-only token on a Secret, JSON + named empty',
      session: 'limited',
      records: true,
      values: {
        resource_type: 'default',
        kind: 'Secret',
        search_by: 'name',
        name: SEEDED.secret,
        output_format: 'json',
        on_error: 'record',
      },
      resultType: 'string',
    },
    {
      key: 'g62a',
      ids: ['G-62', 'READ-WORDING'],
      what: 'refused field selector, YAML + listed empty',
      session: 'admin',
      records: true,
      values: {
        resource_type: 'default',
        kind: 'Pod',
        search_by: 'selector',
        field_selector: BAD_FIELD_SELECTOR,
        output_format: 'yaml',
        on_error: 'record',
      },
      resultType: 'string',
    },
    {
      key: 'g62b',
      ids: ['G-62'],
      what: 'missing name, YAML + named empty',
      session: 'admin',
      records: true,
      values: {
        resource_type: 'default',
        kind: 'Pod',
        search_by: 'name',
        name: MISSING_POD_YAML,
        output_format: 'yaml',
        on_error: 'record',
      },
      resultType: 'string',
    },
  ]
}

/** The leg the checked-in golden fixture holds. */
export const GOLDEN_LEG: GetLeg = {
  key: 'golden',
  ids: ['G-01', 'G-07', 'G-34', 'G-37'],
  what: 'Pod by name, Map',
  session: 'admin',
  values: {
    resource_type: 'default',
    kind: 'Pod',
    search_by: 'name',
    name: SEEDED.podLabeled,
    output_format: 'map',
  },
  resultType: 'map',
}

/** The bookend markers the console harvests wait for. */
export const GET_DONE_MARKER = 'k8s-get-sweep-done'
export const GET_FAILURES_DONE_MARKER = 'k8s-get-failures-done'
export const GET_GOLDEN_MARKER = 'k8s-get-golden-done'

/** The marker one leg writes, so a failure names the row it broke. */
export function legMarker(leg: GetLeg): string {
  return `[${leg.ids.join('|')}]`
}

/** The unique head of one leg's console line: its ids and its key. Two legs
 *  can carry the same id list, so the key is what tells them apart. */
export function markerLine(leg: GetLeg): string {
  return `${legMarker(leg)} ${leg.key}`
}

/** A Block name is capped at 64 characters, so the ids ride the marker line
 *  and the Block carries the leg key. */
export function blockName(leg: GetLeg): string {
  const name = `${leg.key}: ${leg.what}`
  if (name.length > MAX_BLOCK_NAME) {
    throw new Error(`leg "${leg.key}" needs a shorter what: ${name.length} > ${MAX_BLOCK_NAME}`)
  }
  return name
}

/** `DESCRIPTION_TOO_LONG` fires above this, on save and on run alike. */
export const MAX_BLOCK_NAME = 64

export const namesVar = (leg: GetLeg): string => `${leg.key}_names`
export const countVar = (leg: GetLeg): string => `${leg.key}_count`
export const resultVar = (leg: GetLeg): string => `${leg.key}_result`
export const okVar = (leg: GetLeg): string => `${leg.key}_ok`
export const errorVar = (leg: GetLeg): string => `${leg.key}_err`
export const reasonVar = (leg: GetLeg): string => `${leg.key}_reason`

/** The plugin's own INFO line for a successful read. */
export function readLine(kind: string, count: number, path: string): string {
  return `Read ${count} ${kind} object(s) from ${path}`
}

/** The WARN line a recorded failure writes (connectivity/block_outputs._recorded_failure_line). */
export function recordedLine(reason: string, message: string): string {
  return reason ? `Read failed (${reason}): ${message}` : `Read failed: ${message}`
}

/** A hand-written kubeconfig in the shape K8s Connect emits, so a session can
 *  carry a credential Connect itself would refuse to build. */
export function handWrittenSession(token: string, namespace: string): string {
  return JSON.stringify({
    apiVersion: 'v1',
    kind: 'Config',
    clusters: [
      { name: 'wave', cluster: { server: K8S_API_URL, 'insecure-skip-tls-verify': true } },
    ],
    users: [{ name: 'wave', user: { token } }],
    contexts: [{ name: 'wave', context: { cluster: 'wave', user: 'wave', namespace } }],
    'current-context': 'wave',
  })
}

type FixtureVariable = { value: unknown; type: string; scope: string; secret?: boolean }

/** The zero value each declared result type carries in the fixture. */
const EMPTY_BY_TYPE: Record<ResultType, unknown> = {
  map: {},
  array: [],
  table: [],
  string: '',
}

export interface GetSweepMaterial {
  adminToken: string
  limitedToken: string
  junkToken: string
  caCert: string
  namespace: string
  /** Which Connect Blocks the workflow needs, in order. */
  connects: readonly GetSession[]
  /** Hand-written session variables the legs read. */
  handWritten?: readonly GetSession[]
  name: string
  bookend: string
}

const TOKEN_VARIABLE: Partial<Record<GetSession, string>> = {
  admin: 'k8s_admin_token',
  limited: 'k8s_limited_token',
}

function connectNode(session: GetSession, namespace: string): WorkflowNode {
  const tokenVariable = TOKEN_VARIABLE[session]
  const values: Record<string, unknown> = {
    api_url: K8S_API_URL,
    namespace,
    timeout: 30,
    verify_ssl: true,
    ca_cert: 'k8s_ca',
  }
  const expressionFields = ['ca_cert']
  if (tokenVariable) {
    values.token = tokenVariable
    expressionFields.unshift('token')
  }
  return k8sConnectNode({
    id: `connect-${session}`,
    description: `Session for ${SESSION_VARIABLE[session]}`,
    expressionFields,
    values,
    outputBindings: { session: SESSION_VARIABLE[session] },
  })
}

/** Build a whole sweep: the Connect Blocks it needs, one Get Block plus one
 *  marker per leg, and the bookend. */
export function buildGetFixture(
  legs: readonly GetLeg[],
  material: GetSweepMaterial,
): Record<string, unknown> {
  const variables: Record<string, FixtureVariable> = {
    k8s_ca: { value: material.caCert, type: 'string', scope: 'test' },
  }
  for (const session of material.connects) {
    variables[SESSION_VARIABLE[session]] = { value: '', type: 'string', scope: 'test' }
    const tokenVariable = TOKEN_VARIABLE[session]
    if (tokenVariable) {
      variables[tokenVariable] = {
        value: session === 'admin' ? material.adminToken : material.limitedToken,
        type: 'string',
        scope: 'test',
        secret: true,
      }
    }
  }
  for (const session of material.handWritten ?? []) {
    variables[SESSION_VARIABLE[session]] = {
      value:
        session === 'empty' ? '' : handWrittenSession(material.junkToken, material.namespace),
      type: 'string',
      scope: 'test',
    }
  }

  const nodes: WorkflowNode[] = material.connects.map((session) =>
    connectNode(session, material.namespace),
  )

  for (const leg of legs) {
    const outputBindings: Record<string, string> = {
      names: namesVar(leg),
      count: countVar(leg),
    }
    variables[namesVar(leg)] = { value: [], type: 'array', scope: 'test' }
    variables[countVar(leg)] = { value: 0, type: 'integer', scope: 'test' }
    if (leg.resultType) {
      outputBindings.result = resultVar(leg)
      variables[resultVar(leg)] = {
        value: EMPTY_BY_TYPE[leg.resultType],
        type: leg.resultType,
        scope: 'test',
      }
    }
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
        id: `get-${leg.key}`,
        elementType: 'k8s-get',
        description: blockName(leg),
        expressionFields: ['session'],
        values: { session: SESSION_VARIABLE[leg.session], ...leg.values },
        outputBindings,
      }),
      markerNode({
        id: `log-${leg.key}`,
        description: `Marker for ${leg.key}`,
        expression: leg.marker ?? `f'${markerLine(leg)} count={${countVar(leg)}}'`,
      }),
    )
  }

  nodes.push(markerNode({ id: 'log-done', description: 'Bookend', text: material.bookend }))

  const laidOut = stackNodes(nodes)
  const edges: WorkflowEdge[] = chainEdges(laidOut.map((node) => node.id))

  return {
    name: material.name,
    version: '1.0.0',
    description: '',
    workflow: { nodes: laidOut, edges },
    variables,
    metadata: { tags: [], suite_id: null, parent_suite: null },
  }
}
