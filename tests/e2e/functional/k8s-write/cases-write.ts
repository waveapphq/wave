/**
 * The K8s write suite's case tables, its fixture builder and the assertions
 * every write spec shares.
 *
 * The table IS the checklist. Each leg names the `KW-` ids it proves (the id
 * matrix is in the suite README), the credential it runs under, the exact
 * Block values, and how its outputs are bound. The spec builds one chained
 * workflow per proof from these tables with the shared node factories;
 * `fixture-write-golden.json` pins the emitted node shape so the generated
 * form stays reviewable against a hand-authored one.
 *
 * Three exported groups: the object names and manifests the cluster receives,
 * the leg tables one per proof, and the console-line and Summary-table
 * assertions the specs read their results through.
 */

import { expect, type APIRequestContext, type Page } from '../../helpers/playwright-fixtures'
import { expectNodeStatus, getNodeStatuses } from '../../helpers/k8s-run'
import {
  edge,
  handleEdge,
  k8sApplyNode,
  k8sApplyResultType,
  k8sConnectNode,
  k8sDeleteNode,
  k8sReadNode,
  k8sRolloutNode,
  k8sScaleNode,
  markerNode,
  stackNodes,
  tryCatchNode,
  type K8sApplyValues,
  type K8sDeleteValues,
  type K8sRolloutValues,
  type K8sScaleValues,
  type WorkflowEdge,
  type WorkflowNode,
} from '../../helpers/k8s-nodes'
import {
  HTTP_FIXTURE_HOST_SENTINEL,
  K8S_ADMIN_TOKEN,
  K8S_API_HOST,
  K8S_API_PORT,
} from '../../helpers/config'

/** The fixture-side API URL. `injectHttp` rewrites it in container-shard mode. */
export const K8S_API_URL = `https://${HTTP_FIXTURE_HOST_SENTINEL}:${K8S_API_PORT}`

/** The implicit node every chain leaves from. */
const START_NODE_ID = 'start-node'

/** `DESCRIPTION_TOO_LONG` fires above this, on save and on run alike. */
export const MAX_BLOCK_NAME = 64

/** The image the kwok cluster runs, matching the seeded workloads. */
const POD_IMAGE = 'busybox:1.36'

/** Which credential a leg runs under. `view` is bound to the read-only role,
 *  so every write it attempts is refused by the cluster. */
export type WriteSession = 'admin' | 'limited'

export const SESSION_VARIABLE: Record<WriteSession, string> = {
  admin: 'sess_admin',
  limited: 'sess_limited',
}

const TOKEN_VARIABLE: Record<WriteSession, string> = {
  admin: 'k8s_admin_token',
  limited: 'k8s_limited_token',
}

/** Every object the suite writes. The run namespace isolates the namespaced
 *  ones, so only the cluster-scoped namespace carries the run suffix. */
export const WRITTEN = {
  goldenConfigMap: 'wave-write-cm',
  goldenKey: 'mode',
  goldenValue: 'form',
  cycleConfigMap: 'wave-cycle-cm',
  secret: 'wave-write-secret',
  secretKey: 'canary',
  deployment: 'wave-write-deploy',
  deleteConfigMap: 'wave-delete-cm',
  rbacConfigMap: 'wave-rbac-cm',
  /** A selector no object in the run namespace carries. */
  absentSelector: 'wave-write=absent',
} as const

/** The run-specific names the legs need. */
export interface WriteContext {
  namespace: string
  /** The cluster-scoped namespace the suite applies and deletes itself. */
  namespaceC: string
  /** The Secret value, unique per run so the leak sweep cannot collide. */
  canary: string
}

/** The `result` type a bound Result variable declares. */
export type ResultType = 'map' | 'array' | 'table' | 'string'

const EMPTY_BY_TYPE: Record<ResultType, unknown> = {
  map: {},
  array: [],
  table: [],
  string: '',
}

type LegBase = {
  /** Short key: the node is `<block>-<key>`, its variables are `<key>_*`. */
  key: string
  /** The `KW-` ids this leg proves. */
  ids: readonly string[]
  /** What the leg is, for the marker and the Block name. */
  what: string
  /** Defaults to `admin`. */
  session?: WriteSession
  /** The Block records its failure instead of raising: it binds the core
   *  outputs and is expected to paint amber. */
  records?: boolean
  /** The Block is expected to RAISE: a Try/Catch wraps it, the catch branch
   *  stamps a marker and the caught message rides the then branch. */
  guarded?: boolean
  /** Overrides the marker expression. */
  marker?: string
  /** Settings held as expressions, beside `session`. */
  expressions?: readonly string[]
}

export type WriteLeg =
  | (LegBase & { block: 'apply'; values: K8sApplyValues })
  | (LegBase & { block: 'delete'; values: K8sDeleteValues })
  | (LegBase & { block: 'scale'; values: K8sScaleValues })
  | (LegBase & { block: 'rollout'; values: K8sRolloutValues })
  | (LegBase & { block: 'get'; values: Record<string, unknown>; resultType: ResultType })

/** The node id the spec addresses a leg's Block by. */
export const nodeId = (leg: WriteLeg): string => `${leg.block}-${leg.key}`

export const summaryVar = (key: string): string => `${key}_summary`
export const resultVar = (key: string): string => `${key}_result`
export const namesVar = (key: string): string => `${key}_names`
export const countVar = (key: string): string => `${key}_count`
export const statusVar = (key: string): string => `${key}_status`
export const okVar = (key: string): string => `${key}_ok`
export const errorVar = (key: string): string => `${key}_err`
export const reasonVar = (key: string): string => `${key}_reason`
/** The map a Try/Catch binds the caught error to. */
export const caughtVar = (key: string): string => `${key}_caught`

/** The marker one leg writes, so a failure names the row it broke. */
export function legMarker(leg: WriteLeg): string {
  return `[${leg.ids.join('|')}]`
}

/** The unique head of one leg's console line: its ids and its key. */
export function markerLine(leg: WriteLeg): string {
  return `${legMarker(leg)} ${leg.key}`
}

/** The head of the line a guarded leg prints on its then branch. */
export function caughtPrefix(leg: WriteLeg): string {
  return `${markerLine(leg)} msg=`
}

/** A Block name is capped, so the ids ride the marker line and the Block
 *  carries the leg key. */
export function blockName(leg: WriteLeg): string {
  const name = `${leg.key}: ${leg.what}`
  if (name.length > MAX_BLOCK_NAME) {
    throw new Error(`leg "${leg.key}" needs a shorter what: ${name.length} > ${MAX_BLOCK_NAME}`)
  }
  return name
}

// ---------------------------------------------------------------------------
// Manifests
// ---------------------------------------------------------------------------

/** A two-replica Deployment, complete enough for a server-side apply. */
export function deploymentManifest(name: string, replicas: number): string {
  return [
    'apiVersion: apps/v1',
    'kind: Deployment',
    'metadata:',
    `  name: ${name}`,
    'spec:',
    `  replicas: ${replicas}`,
    '  selector:',
    '    matchLabels:',
    `      app: ${name}`,
    '  template:',
    '    metadata:',
    '      labels:',
    `        app: ${name}`,
    '    spec:',
    '      containers:',
    '        - name: app',
    `          image: ${POD_IMAGE}`,
    '',
  ].join('\n')
}

/** The one cluster-scoped object the suite writes. */
export function namespaceManifest(name: string): string {
  return ['apiVersion: v1', 'kind: Namespace', 'metadata:', `  name: ${name}`, ''].join('\n')
}

// ---------------------------------------------------------------------------
// Paths and console lines
// ---------------------------------------------------------------------------

export const corePath = (namespace: string, plural: string): string =>
  `/api/v1/namespaces/${namespace}/${plural}`
export const appsPath = (namespace: string, plural: string): string =>
  `/apis/apps/v1/namespaces/${namespace}/${plural}`
export const clusterPath = (plural: string): string => `/api/v1/${plural}`

/** The RESOURCE cell: kubectl's `type/name`, with the API group when there is
 *  one (`_k8s_common.type_name`). */
export const typeName = (kind: string, group: string, name: string): string =>
  `${kind.toLowerCase()}${group ? `.${group}` : ''}/${name}`

export interface DeleteQuery {
  /** Sent on every delete; `background` is what an unset row sends. */
  cascade?: 'background' | 'foreground' | 'orphan'
  /** Sent only when set. Zero IS sent. */
  gracePeriodSeconds?: number
  /** Selector mode only. */
  labelSelector?: string
}

const POLICIES: Record<string, string> = {
  background: 'Background',
  foreground: 'Foreground',
  orphan: 'Orphan',
}

/** The query a delete builds, in the order the plugin adds the keys. */
export function deleteQuery(opts: DeleteQuery = {}): string {
  const parts = [`propagationPolicy=${POLICIES[opts.cascade ?? 'background']}`]
  if (opts.gracePeriodSeconds !== undefined) {
    parts.push(`gracePeriodSeconds=${opts.gracePeriodSeconds}`)
  }
  if (opts.labelSelector !== undefined) {
    parts.push(`labelSelector=${encodeURIComponent(opts.labelSelector)}`)
  }
  return `?${parts.join('&')}`
}

/** The word each write Block puts at the head of a recorded WARN line. */
export type WriteAction = 'Apply' | 'Delete' | 'Scale' | 'Rollout'

/** K8s Apply's own INFO line. */
export const appliedLine = (count: number): string => `Applied ${count} object(s)`

/** K8s Delete's own INFO line. Its path carries the query. */
export const deletedLine = (count: number, kind: string, path: string): string =>
  `Deleted ${count} ${kind} object(s) from ${path}`

/** K8s Scale's own INFO line. */
export const scaledLine = (target: string, previous: number, replicas: number): string =>
  `Scaled ${target} from ${previous} to ${replicas}`

/** K8s Rollout's own INFO line, whichever operation ran. */
export const rolloutLine = (operation: string, target: string): string =>
  `Rollout ${operation} on ${target}`

/** K8s Get's own INFO line, for a read-back leg. */
export const readLine = (kind: string, count: number, path: string): string =>
  `Read ${count} ${kind} object(s) from ${path}`

/** The WARN line a recorded failure writes (verbs/_outputs._recorded_failure_line). */
export function recordedLine(action: WriteAction, reason: string, message: string): string {
  return reason ? `${action} failed (${reason}): ${message}` : `${action} failed: ${message}`
}

// ---------------------------------------------------------------------------
// Cluster wordings
// ---------------------------------------------------------------------------

/** The cluster's own already-exists row, as `map_api_error` renders it. */
export const alreadyExists = (kind: string, name: string, namespace: string): string =>
  `K8s ${kind} '${name}' already exists in namespace '${namespace}'`

/** The cluster's own not-found row for a named object. */
export const notFound = (kind: string, name: string, namespace: string): string =>
  `K8s ${kind} '${name}' not found in namespace '${namespace}'`

/** A denial the cluster words itself; WAVE only prefixes it. */
export const permissionDenied = (detail: string): string =>
  `Kubernetes API permission denied: ${detail}`

/** The view-only identity's refusal of a server-side apply. */
export const cannotPatch = (plural: string, name: string, namespace: string): string =>
  `${plural} "${name}" is forbidden: User "wave-limited" cannot patch resource` +
  ` "${plural}" in API group "" in the namespace "${namespace}"`

// ---------------------------------------------------------------------------
// Case tables
// ---------------------------------------------------------------------------

/** KW-01, KW-02: the leg pair the checked-in golden fixture holds. */
export function goldenLegs(): WriteLeg[] {
  return [
    {
      key: 'golden',
      ids: ['KW-01', 'KW-02'],
      what: 'ConfigMap by form, create',
      block: 'apply',
      values: {
        define_with: 'form',
        kind: 'ConfigMap',
        name: WRITTEN.goldenConfigMap,
        data: { [WRITTEN.goldenKey]: WRITTEN.goldenValue },
        if_exists: 'update',
        output_format: 'map',
      },
    },
    {
      key: 'readback',
      ids: ['KW-02'],
      what: 'read the applied ConfigMap back',
      block: 'get',
      resultType: 'map',
      values: {
        resource_type: 'default',
        kind: 'ConfigMap',
        search_by: 'name',
        name: WRITTEN.goldenConfigMap,
        output_format: 'map',
      },
    },
  ]
}

/** KW-03 to KW-05: create, update in place, and refuse an existing object. */
export function applyCycleLegs(ctx: WriteContext): WriteLeg[] {
  const form: K8sApplyValues = {
    define_with: 'form',
    kind: 'ConfigMap',
    name: WRITTEN.cycleConfigMap,
    if_exists: 'update',
    output_format: 'map',
  }
  return [
    {
      key: 'create',
      ids: ['KW-03'],
      what: 'ConfigMap by form, first apply',
      block: 'apply',
      values: { ...form, data: { round: 'one' } },
    },
    {
      key: 'update',
      ids: ['KW-04'],
      what: 'the same ConfigMap, applied again',
      block: 'apply',
      values: { ...form, data: { round: 'two' } },
    },
    {
      key: 'strict',
      ids: ['KW-05'],
      what: 'If exists Fail on an object that is there',
      block: 'apply',
      records: true,
      values: {
        ...form,
        data: { round: 'three' },
        if_exists: 'fail',
        on_error: 'record',
      },
      marker: `f'[KW-05] strict ok={${okVar('strict')}} reason={${reasonVar('strict')}}'`,
    },
    {
      key: 'reread',
      ids: ['KW-04'],
      what: 'read the updated ConfigMap back',
      block: 'get',
      resultType: 'map',
      values: {
        resource_type: 'default',
        kind: 'ConfigMap',
        search_by: 'name',
        name: WRITTEN.cycleConfigMap,
        namespace: ctx.namespace,
        output_format: 'map',
      },
    },
  ]
}

/** KW-06, KW-07: the Secret form, and the value that must never surface. */
export function secretLegs(ctx: WriteContext): WriteLeg[] {
  return [
    {
      key: 'secret',
      ids: ['KW-06', 'KW-07'],
      what: 'Opaque Secret by form',
      block: 'apply',
      values: {
        define_with: 'form',
        kind: 'Secret',
        name: WRITTEN.secret,
        secret_data: { [WRITTEN.secretKey]: ctx.canary },
        secret_type: 'Opaque',
        if_exists: 'update',
        output_format: 'map',
      },
      // The result rides the console on purpose: the written value has to come
      // back masked there too, not only in the stored record.
      marker: `f'[KW-06|KW-07] secret count={${countVar('secret')}} data={${resultVar('secret')}}'`,
    },
  ]
}

/** KW-08 to KW-12: one Deployment through apply, scale, restart, status and
 *  a cascading delete. Every leg needs the one the leg before it left. */
export function deploymentLegs(ctx: WriteContext): WriteLeg[] {
  return [
    {
      key: 'deploy',
      ids: ['KW-08'],
      what: 'Deployment manifest, two replicas',
      block: 'apply',
      values: {
        define_with: 'manifest',
        manifest: deploymentManifest(WRITTEN.deployment, 2),
        if_exists: 'update',
        output_format: 'map',
      },
    },
    {
      key: 'scaled',
      ids: ['KW-09'],
      what: 'scale the Deployment to five',
      block: 'scale',
      values: {
        resource_type: 'default',
        kind: 'Deployment',
        name: WRITTEN.deployment,
        replicas: 5,
      },
    },
    {
      key: 'replicas',
      ids: ['KW-09'],
      what: 'read the replica count back',
      block: 'get',
      resultType: 'map',
      values: {
        resource_type: 'default',
        kind: 'Deployment',
        search_by: 'name',
        name: WRITTEN.deployment,
        output_format: 'map',
      },
    },
    {
      key: 'restart',
      ids: ['KW-10'],
      what: 'restart the Deployment rollout',
      block: 'rollout',
      values: { operation: 'restart', kind: 'Deployment', name: WRITTEN.deployment },
    },
    {
      key: 'stamped',
      ids: ['KW-10'],
      what: 'read the restart annotation back',
      block: 'get',
      resultType: 'map',
      values: {
        resource_type: 'default',
        kind: 'Deployment',
        search_by: 'name',
        name: WRITTEN.deployment,
        output_format: 'map',
      },
    },
    {
      key: 'rollstat',
      ids: ['KW-11'],
      what: 'report the rollout state',
      block: 'rollout',
      values: { operation: 'status', kind: 'Deployment', name: WRITTEN.deployment },
      marker: `f'[KW-11] rollstat status={${statusVar('rollstat')}}'`,
    },
    {
      key: 'dropdeploy',
      ids: ['KW-12'],
      what: 'delete the Deployment, Foreground',
      block: 'delete',
      values: {
        resource_type: 'default',
        kind: 'Deployment',
        delete_by: 'name',
        name: WRITTEN.deployment,
        cascade: 'foreground',
        wait_until_gone: true,
        timeout: 60,
      },
    },
    {
      key: 'nopods',
      ids: ['KW-12'],
      what: 'no pod of the workload is left',
      block: 'get',
      resultType: 'array',
      values: {
        resource_type: 'default',
        kind: 'Pod',
        search_by: 'selector',
        label_selector: `app=${WRITTEN.deployment}`,
        namespace: ctx.namespace,
        output_format: 'map',
      },
    },
  ]
}

/** KW-13 to KW-16: a delete, then the same delete against nothing, three ways. */
export function deleteLegs(): WriteLeg[] {
  const byName: K8sDeleteValues = {
    resource_type: 'default',
    kind: 'ConfigMap',
    delete_by: 'name',
    name: WRITTEN.deleteConfigMap,
  }
  return [
    {
      key: 'seed',
      ids: ['KW-13'],
      what: 'the ConfigMap the delete legs remove',
      block: 'apply',
      values: {
        define_with: 'form',
        kind: 'ConfigMap',
        name: WRITTEN.deleteConfigMap,
        data: { role: 'target' },
        if_exists: 'update',
        output_format: 'map',
      },
    },
    {
      key: 'drop',
      ids: ['KW-13'],
      what: 'delete it by name and wait',
      block: 'delete',
      values: { ...byName, wait_until_gone: true },
    },
    {
      key: 'gone',
      ids: ['KW-14'],
      what: 'delete the same name again',
      block: 'delete',
      guarded: true,
      values: { ...byName, ignore_not_found: false },
    },
    {
      key: 'ignored',
      ids: ['KW-15'],
      what: 'the same delete, Ignore not found',
      block: 'delete',
      values: { ...byName, ignore_not_found: true },
    },
    {
      key: 'selnone',
      ids: ['KW-16'],
      what: 'a selector matching nothing',
      block: 'delete',
      values: {
        resource_type: 'default',
        kind: 'ConfigMap',
        delete_by: 'selector',
        label_selector: WRITTEN.absentSelector,
      },
    },
    {
      key: 'selignore',
      ids: ['KW-16'],
      what: 'the same selector, Ignore not found on',
      block: 'delete',
      values: {
        resource_type: 'default',
        kind: 'ConfigMap',
        delete_by: 'selector',
        label_selector: WRITTEN.absentSelector,
        ignore_not_found: true,
      },
    },
  ]
}

/** KW-17, KW-18: the cluster-scoped write, applied and removed. */
export function clusterScopedLegs(ctx: WriteContext): WriteLeg[] {
  return [
    {
      key: 'nsmade',
      ids: ['KW-17'],
      what: 'Namespace manifest',
      block: 'apply',
      values: {
        define_with: 'manifest',
        manifest: namespaceManifest(ctx.namespaceC),
        if_exists: 'update',
        output_format: 'map',
      },
    },
    {
      key: 'nsread',
      ids: ['KW-17'],
      what: 'read the Namespace back',
      block: 'get',
      resultType: 'map',
      values: {
        resource_type: 'default',
        kind: 'Namespace',
        search_by: 'name',
        name: ctx.namespaceC,
        output_format: 'map',
      },
    },
    {
      key: 'nsgone',
      ids: ['KW-18'],
      what: 'delete the Namespace',
      block: 'delete',
      values: {
        resource_type: 'default',
        kind: 'Namespace',
        delete_by: 'name',
        name: ctx.namespaceC,
        // Namespace removal is finalizer-driven, so the suite asserts the
        // accepted delete and never a controller loop.
        wait_until_gone: false,
      },
    },
  ]
}

/** KW-19, KW-20: the read-only identity's write, refused both ways. */
export function rbacLegs(): WriteLeg[] {
  const form: K8sApplyValues = {
    define_with: 'form',
    kind: 'ConfigMap',
    name: WRITTEN.rbacConfigMap,
    data: { attempt: 'denied' },
    if_exists: 'update',
    output_format: 'map',
  }
  return [
    {
      key: 'denied',
      ids: ['KW-19'],
      what: 'apply under the view-only identity',
      block: 'apply',
      session: 'limited',
      guarded: true,
      values: form,
    },
    {
      key: 'recorded',
      ids: ['KW-20'],
      what: 'the same apply, Record and continue',
      block: 'apply',
      session: 'limited',
      records: true,
      values: { ...form, on_error: 'record' },
      marker: `f'[KW-20] recorded ok={${okVar('recorded')}} reason={${reasonVar('recorded')}}'`,
    },
  ]
}

// ---------------------------------------------------------------------------
// Fixture builder
// ---------------------------------------------------------------------------

type FixtureVariable = { value: unknown; type: string; scope: string; secret?: boolean }

export interface WriteMaterial {
  adminToken: string
  limitedToken: string
  caCert: string
  namespace: string
  /** Which Connect Blocks the workflow needs, in order. */
  connects: readonly WriteSession[]
  name: string
  bookend: string
}

function connectNode(session: WriteSession, namespace: string): WorkflowNode {
  return k8sConnectNode({
    id: `connect-${session}`,
    description: `Session for ${SESSION_VARIABLE[session]}`,
    expressionFields: ['token', 'ca_cert'],
    values: {
      api_url: K8S_API_URL,
      namespace,
      timeout: 30,
      verify_ssl: true,
      ca_cert: 'k8s_ca',
      token: TOKEN_VARIABLE[session],
    },
    outputBindings: { session: SESSION_VARIABLE[session] },
  })
}

function blockNode(leg: WriteLeg, bindings: Record<string, string>): WorkflowNode {
  const shared = {
    id: nodeId(leg),
    description: blockName(leg),
    expressionFields: ['session', ...(leg.expressions ?? [])],
  }
  const session = SESSION_VARIABLE[leg.session ?? 'admin']
  if (leg.block === 'apply') {
    return k8sApplyNode({ ...shared, values: { session, ...leg.values }, outputBindings: bindings })
  }
  if (leg.block === 'delete') {
    return k8sDeleteNode({
      ...shared,
      values: { session, ...leg.values },
      outputBindings: bindings,
    })
  }
  if (leg.block === 'scale') {
    return k8sScaleNode({ ...shared, values: { session, ...leg.values }, outputBindings: bindings })
  }
  if (leg.block === 'rollout') {
    return k8sRolloutNode({
      ...shared,
      values: { session, ...leg.values },
      outputBindings: bindings,
    })
  }
  return k8sReadNode({
    ...shared,
    elementType: 'k8s-get',
    values: { session, ...leg.values },
    outputBindings: bindings,
  })
}

/** Which outputs a leg binds, and the variable each one declares. A guarded
 *  leg binds nothing: it raises, so the engine never reaches the bindings. */
function legBindings(
  leg: WriteLeg,
  variables: Record<string, FixtureVariable>,
): Record<string, string> {
  const bindings: Record<string, string> = {}
  if (leg.guarded) {
    variables[caughtVar(leg.key)] = { value: {}, type: 'map', scope: 'test' }
    return bindings
  }
  const declare = (name: string, value: unknown, type: string): void => {
    variables[name] = { value, type, scope: 'test' }
  }
  if (leg.block !== 'get') {
    bindings.summary = summaryVar(leg.key)
    declare(summaryVar(leg.key), [], 'table')
  }
  if (leg.block === 'apply' || leg.block === 'delete' || leg.block === 'get') {
    bindings.names = namesVar(leg.key)
    bindings.count = countVar(leg.key)
    declare(namesVar(leg.key), [], 'array')
    declare(countVar(leg.key), 0, 'integer')
  }
  if (leg.block === 'apply') {
    const type = k8sApplyResultType(leg.values)
    bindings.result = resultVar(leg.key)
    declare(resultVar(leg.key), EMPTY_BY_TYPE[type], type)
  }
  if (leg.block === 'get') {
    bindings.result = resultVar(leg.key)
    declare(resultVar(leg.key), EMPTY_BY_TYPE[leg.resultType], leg.resultType)
  }
  if (leg.block === 'rollout' && leg.values.operation === 'status') {
    bindings.status = statusVar(leg.key)
    declare(statusVar(leg.key), '', 'string')
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
function defaultMarker(leg: WriteLeg): WorkflowNode {
  const id = `log-${leg.key}`
  const description = `Marker for ${leg.key}`
  if (leg.marker) return markerNode({ id, description, expression: leg.marker })
  if (leg.block === 'scale' || leg.block === 'rollout') {
    return markerNode({ id, description, text: markerLine(leg) })
  }
  return markerNode({
    id,
    description,
    expression: `f'${markerLine(leg)} count={${countVar(leg.key)}}'`,
  })
}

/** A Try/Catch-wrapped leg: the catch branch stamps its marker and the then
 *  branch prints the caught message, which is where the chain carries on. */
function guardedNodes(
  leg: WriteLeg,
  block: WorkflowNode,
): { nodes: WorkflowNode[]; edges: WorkflowEdge[] } {
  const guard = `tc-${leg.key}`
  const caught = `log-${leg.key}-caught`
  const message = `log-${leg.key}`
  const bound = caughtVar(leg.key)
  return {
    nodes: [
      tryCatchNode({
        id: guard,
        description: `Guard for ${leg.key}`,
        errorBinding: bound,
      }),
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
          `f"${caughtPrefix(leg)}{${bound}['message'] if ${bound} else 'NO-ERROR-CAUGHT'}"`,
      }),
    ],
    edges: [
      handleEdge(guard, 'try', block.id),
      handleEdge(guard, 'catch', caught),
      handleEdge(guard, 'then', message),
    ],
  }
}

/** Build a whole proof: the Connect Blocks it needs, one Block plus one marker
 *  per leg, and the bookend. */
export function buildWriteFixture(
  legs: readonly WriteLeg[],
  material: WriteMaterial,
): Record<string, unknown> {
  const variables: Record<string, FixtureVariable> = {
    k8s_ca: { value: material.caCert, type: 'string', scope: 'test' },
  }
  for (const session of material.connects) {
    variables[SESSION_VARIABLE[session]] = { value: '', type: 'string', scope: 'test' }
    variables[TOKEN_VARIABLE[session]] = {
      value: session === 'admin' ? material.adminToken : material.limitedToken,
      type: 'string',
      scope: 'test',
      secret: true,
    }
  }

  const nodes: WorkflowNode[] = material.connects.map((session) =>
    connectNode(session, material.namespace),
  )
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
// Shared assertions
// ---------------------------------------------------------------------------

export type SessionVariables = Record<string, { value: unknown; type: string }>
export type WaveTable = { columns: Array<{ name: string; type: string }>; rows: unknown[][] }

/** The columns Apply and Delete declare on Summary. */
export const SUMMARY_COLUMNS = ['RESOURCE', 'OUTCOME'] as const
export const SUMMARY_TYPES = ['string', 'string'] as const

/** The columns Scale declares on Summary. */
export const SCALE_SUMMARY_COLUMNS = ['RESOURCE', 'OUTCOME', 'PREVIOUS', 'REPLICAS'] as const
export const SCALE_SUMMARY_TYPES = ['string', 'string', 'integer', 'integer'] as const

/** The columns Rollout declares on Summary. */
export const ROLLOUT_SUMMARY_COLUMNS = ['RESOURCE', 'OUTCOME', 'MESSAGE'] as const
export const ROLLOUT_SUMMARY_TYPES = ['string', 'string', 'string'] as const

export function cell(vars: SessionVariables, name: string): { value: unknown; type: string } {
  const found = vars[name]
  expect(found, `variable "${name}" was never bound`).toBeTruthy()
  return found
}

export const namesOf = (vars: SessionVariables, key: string): string[] =>
  cell(vars, namesVar(key)).value as string[]
export const countOf = (vars: SessionVariables, key: string): number =>
  Number(cell(vars, countVar(key)).value)
export const resultOf = (vars: SessionVariables, key: string): { value: unknown; type: string } =>
  cell(vars, resultVar(key))
export const statusOf = (vars: SessionVariables, key: string): string =>
  String(cell(vars, statusVar(key)).value)
export const errorOf = (vars: SessionVariables, key: string): string =>
  String(cell(vars, errorVar(key)).value)
export const reasonOf = (vars: SessionVariables, key: string): string =>
  String(cell(vars, reasonVar(key)).value)

/** The Summary table a leg bound, asserted whole: the columns it declares,
 *  their types, and every cell of every row. */
export function expectSummary(
  vars: SessionVariables,
  key: string,
  expected: {
    columns: readonly string[]
    types: readonly string[]
    rows: readonly unknown[][]
  },
): void {
  const found = cell(vars, summaryVar(key))
  expect(found.type, `${key} Summary must be a table`).toBe('table')
  const table = found.value as WaveTable
  expect(
    table.columns.map((column) => column.name),
    `${key} Summary columns`,
  ).toEqual([...expected.columns])
  expect(
    table.columns.map((column) => column.type),
    `${key} Summary column types`,
  ).toEqual([...expected.types])
  expect(table.rows, `${key} Summary rows`).toEqual(expected.rows.map((row) => [...row]))
}

/** Every recorded failure reports the same core: success false, the cluster's
 *  message and reason, and the empty shapes for whatever it binds. */
export function expectRecorded(
  vars: SessionVariables,
  key: string,
  expected: { message: string; reason: string },
): void {
  expect(cell(vars, okVar(key)).value, `${key} must report success false`).toBe(false)
  expect(errorOf(vars, key), `${key} error`).toBe(expected.message)
  expect(reasonOf(vars, key), `${key} reason`).toBe(expected.reason)
}

/** The empty shapes a recorded Apply or Delete leaves behind when nothing
 *  landed: no rows, no names, count zero. */
export function expectEmptyWrite(
  vars: SessionVariables,
  key: string,
  columns: readonly string[],
): void {
  expect(countOf(vars, key), `${key} count`).toBe(0)
  expect(namesOf(vars, key), `${key} names`).toEqual([])
  const table = cell(vars, summaryVar(key)).value as WaveTable
  expect(
    table.columns.map((column) => column.name),
    `${key} keeps its Summary columns while empty`,
  ).toEqual([...columns])
  expect(table.rows, `${key} Summary rows`).toEqual([])
}

/** A guarded leg: the catch branch ran, and the caught message is the exact
 *  sentence the Block raised. */
export function expectCaught(
  logs: readonly string[],
  leg: WriteLeg,
  message: string,
): void {
  const all = logs.join('\n')
  expect(
    logs.some((text) => text === `${markerLine(leg)} caught`),
    `${leg.key}: the catch branch never ran, so the Block did not refuse.\n${all}`,
  ).toBeTruthy()
  const line = logs.find((text) => text.startsWith(caughtPrefix(leg))) ?? ''
  expect(line, `${leg.key}: wrong refusal message.\n${all}`).toBe(`${caughtPrefix(leg)}${message}`)
}

/** Every leg stamped its ids on the console, so a failure names the row. */
export function expectMarkers(logs: readonly string[], legs: readonly WriteLeg[]): void {
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
export async function expectLegStatuses(page: Page, legs: readonly WriteLeg[]): Promise<void> {
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

/** Remove a cluster-scoped namespace the suite applied, in case the run left
 *  it behind. Never throws: it runs beside the seeded teardown. */
export async function deleteNamespaceQuietly(
  request: APIRequestContext,
  name: string,
): Promise<void> {
  await request
    .delete(`https://${K8S_API_HOST}:${K8S_API_PORT}/api/v1/namespaces/${name}`, {
      headers: { Authorization: `Bearer ${K8S_ADMIN_TOKEN}` },
    })
    .catch(() => undefined)
}
