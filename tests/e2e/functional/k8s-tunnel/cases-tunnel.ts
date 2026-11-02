/**
 * The tunneled-write workflow, as data.
 *
 * One chained run holds two K8s Sessions at once. Session A reaches the
 * unpublished cluster through an SSH tunnel; session B reaches the published
 * cluster directly. The two are separate apiservers, so both sides use the
 * SAME namespace name and the only thing that differs between an A block and
 * a B block is the session it reads.
 *
 * The test process has no route to the tunneled cluster, so session A creates
 * and removes its own namespace from inside the workflow. Every object it
 * writes carries the run suffix, so a run that dies before its Delete leaves
 * nothing another run can collide with.
 */

import {
  chainEdges,
  k8sApplyNode,
  k8sApplyResultType,
  k8sConnectNode,
  k8sDeleteNode,
  k8sReadNode,
  markerNode,
  pluginNode,
  sshSessionOpenNode,
  stackNodes,
  type K8sApplyValues,
  type WorkflowEdge,
  type WorkflowNode,
} from '../../helpers/k8s-nodes'
import {
  HTTP_FIXTURE_HOST_SENTINEL,
  K8S_API_PORT,
  K8S_INTERNAL_PORT,
  K8S_INTERNAL_SERVICE,
  SSH_FIXTURE_HOST_SENTINEL,
  SSH_MAIN_PORT,
  SSH_STACK_PASSWORD,
  SSH_STACK_USER,
} from '../../helpers/config'

/** The published cluster's fixture-side URL. `injectHttp` rewrites it in
 *  container-shard mode; the tunneled URL below is deliberately outside that
 *  allowlist and stays literal. */
export const K8S_API_URL = `https://${HTTP_FIXTURE_HOST_SENTINEL}:${K8S_API_PORT}`

/** The tunneled URL: the backend's own loopback plus the port the tunnel Block
 *  bound. Nothing else joins the tunnel to Connect. */
export const TUNNELED_API_URL = "f'https://127.0.0.1:{lport}'"

/** kwok is pinned to Kubernetes 1.33 - every version read starts with this. */
export const K8S_VERSION_PREFIX = 'v1.33'

/** The bookend the console harvest gates on. */
export const TUNNEL_DONE_MARKER = 'k8s-tunnel-write-e2e-done'

/** The prefix of the single marker line the run stamps. */
export const TUNNEL_MARKER = '[KT]'

/** The `data` key both sides write, and the value each one writes to it. */
export const ORIGIN_KEY = 'origin'
export const ORIGIN_TUNNELED = 'tunneled'
export const ORIGIN_PUBLISHED = 'published'

/** `DESCRIPTION_TOO_LONG` fires above this, on save and on run alike. */
export const MAX_BLOCK_NAME = 64

/** The Test name the builder emits; `importFixtureTest` uniquifies it. */
export const TUNNEL_FIXTURE_NAME = 'K8s Tunneled Write E2E Test'

/** The fixed context the checked-in golden is built from. */
export const GOLDEN_SUFFIX = 'golden00'
export const GOLDEN_NAMESPACE = `wave-e2e-${GOLDEN_SUFFIX}`

/** What a run needs to name its objects. `namespace` is the same string on
 *  both clusters: two apiservers, so the name is free on each. */
export interface TunnelContext {
  suffix: string
  namespace: string
}

/** The build-time material a fixture carries. PEM and token bytes are never
 *  committed, so the checked-in golden holds empty strings here. */
export interface TunnelMaterial extends TunnelContext {
  caCert: string
  adminToken: string
}

/** The three ConfigMaps: one only the tunneled cluster holds, one only the
 *  published cluster holds, and one both hold under the same name. */
export interface TunnelNames {
  tunnelOnly: string
  publishedOnly: string
  shared: string
}

export function tunnelNames(ctx: TunnelContext): TunnelNames {
  return {
    tunnelOnly: `wave-tun-${ctx.suffix}`,
    publishedOnly: `wave-pub-${ctx.suffix}`,
    shared: `wave-both-${ctx.suffix}`,
  }
}

/** The `data` map a side writes: the side that wrote it, and the run it came
 *  from, so a read back proves the exact bytes. */
export function originData(ctx: TunnelContext, origin: string): Record<string, string> {
  return { [ORIGIN_KEY]: origin, run: ctx.suffix }
}

/** The namespace document session A applies. Namespace is cluster-scoped, so
 *  it takes no namespace segment and no Block namespace. */
export function namespaceManifest(namespace: string): string {
  return `apiVersion: v1\nkind: Namespace\nmetadata:\n  name: ${namespace}\n`
}

/** The plugin's own INFO line for a successful read. */
export const readLine = (kind: string, count: number, path: string): string =>
  `Read ${count} ${kind} object(s) from ${path}`

/** The plugin's own INFO line for a successful delete; `path` carries the query. */
export const deleteLine = (kind: string, count: number, path: string): string =>
  `Deleted ${count} ${kind} object(s) from ${path}`

/** The plugin's own INFO line for a successful apply. */
export const appliedLine = (count: number): string => `Applied ${count} object(s)`

/** The WARN line a recorded read failure writes. */
export const recordedReadLine = (reason: string, message: string): string =>
  `Read failed (${reason}): ${message}`

/** The cluster wording for a named object that is not there. */
export const notFoundMessage = (kind: string, name: string, namespace: string): string =>
  `K8s ${kind} '${name}' not found in namespace '${namespace}'`

export const configMapPath = (namespace: string, name: string): string =>
  `/api/v1/namespaces/${namespace}/configmaps/${name}`

/** A cluster-scoped delete takes no namespace segment; the cascade is always
 *  on the query. */
export const namespaceDeletePath = (name: string): string =>
  `/api/v1/namespaces/${name}?propagationPolicy=Background`

type FixtureVariable = { value: unknown; type: string; scope: string; secret?: boolean }

const SESSION_A = 'sess_a'
const SESSION_B = 'sess_b'

/** Every Block id the run drives, in chain order. */
export const TUNNEL_NODE_IDS = [
  'open-session',
  'tunnel-open',
  'connect-a',
  'connect-b',
  'ns-a',
  'apply-a-solo',
  'apply-b-solo',
  'apply-a-both',
  'apply-b-both',
  'get-a-solo',
  'get-b-both',
  'get-a-both',
  'get-b-miss',
  'get-a-miss',
  'log-roundtrip',
  'delete-a-ns',
  'tunnel-close',
  'close-session',
  'log-done',
] as const

/** The Blocks that record a failure instead of raising: each paints amber and
 *  leaves the run passed. */
export const RECORDING_NODE_IDS = ['get-b-miss', 'get-a-miss'] as const

/** Every Apply in the run. Each writes exactly one object, so the console
 *  carries one `Applied 1 object(s)` line per entry. */
export const APPLY_NODE_IDS = [
  'ns-a',
  'apply-a-solo',
  'apply-b-solo',
  'apply-a-both',
  'apply-b-both',
] as const

function applyConfigMap(
  id: string,
  description: string,
  session: string,
  ctx: TunnelContext,
  name: string,
  origin: string,
  outputBindings: Record<string, string>,
): WorkflowNode {
  const values: K8sApplyValues = {
    session,
    timeout: 30,
    define_with: 'form',
    kind: 'ConfigMap',
    name,
    data: originData(ctx, origin),
    if_exists: 'update',
    output_format: 'map',
    namespace: ctx.namespace,
    on_error: 'fail',
  }
  return k8sApplyNode({ id, description, expressionFields: ['session'], values, outputBindings })
}

function getConfigMap(
  id: string,
  description: string,
  session: string,
  ctx: TunnelContext,
  name: string,
  outputBindings: Record<string, string>,
  onError: 'fail' | 'record',
): WorkflowNode {
  return k8sReadNode({
    id,
    elementType: 'k8s-get',
    description,
    expressionFields: ['session'],
    values: {
      session,
      timeout: 30,
      resource_type: 'default',
      kind: 'ConfigMap',
      search_by: 'name',
      name,
      output_format: 'map',
      namespace: ctx.namespace,
      on_error: onError,
    },
    outputBindings,
  })
}

/** The applied-object type the roundtrip Apply declares for `result`. */
const APPLIED_RESULT_TYPE = k8sApplyResultType({ define_with: 'form', output_format: 'map' })

/** The three exported rosters are what the spec addresses Blocks by, so they
 *  have to keep matching the chain the builder emits. */
function assertRoster(nodes: readonly WorkflowNode[]): void {
  const same = (a: readonly string[], b: readonly string[]): boolean =>
    a.length === b.length && a.every((entry, index) => entry === b[index])
  const idsOf = (predicate: (node: WorkflowNode) => boolean): string[] =>
    nodes.filter(predicate).map((node) => node.id)
  const valuesOf = (node: WorkflowNode): Record<string, unknown> =>
    (node.data.config as { values: Record<string, unknown> }).values

  const rosters: Array<[string, readonly string[], string[]]> = [
    ['TUNNEL_NODE_IDS', TUNNEL_NODE_IDS, idsOf(() => true)],
    [
      'APPLY_NODE_IDS',
      APPLY_NODE_IDS,
      idsOf((node) => node.data.elementType === 'k8s-apply'),
    ],
    [
      'RECORDING_NODE_IDS',
      RECORDING_NODE_IDS,
      idsOf((node) => valuesOf(node).on_error === 'record'),
    ],
  ]
  for (const [name, declared, actual] of rosters) {
    if (!same(declared, actual)) {
      throw new Error(`${name} is [${declared.join(', ')}] but the run holds [${actual.join(', ')}]`)
    }
  }
}

/** Build the whole run: the SSH leg, the two Connects, the interleaved writes
 *  and reads, the marker, the namespace teardown and the bookend. */
export function buildTunnelFixture(material: TunnelMaterial): Record<string, unknown> {
  const ctx: TunnelContext = { suffix: material.suffix, namespace: material.namespace }
  const names = tunnelNames(ctx)

  const variables: Record<string, FixtureVariable> = {
    ssh_pwd: { value: SSH_STACK_PASSWORD, type: 'string', scope: 'test', secret: true },
    k8s_admin_token: { value: material.adminToken, type: 'string', scope: 'test', secret: true },
    k8s_ca: { value: material.caCert, type: 'string', scope: 'test' },
    sid: { value: '', type: 'string', scope: 'test' },
    tid: { value: '', type: 'string', scope: 'test' },
    lport: { value: 0, type: 'integer', scope: 'test' },
    sess_a: { value: '', type: 'string', scope: 'test' },
    sess_b: { value: '', type: 'string', scope: 'test' },
    ver_a: { value: '', type: 'string', scope: 'test' },
    ver_b: { value: '', type: 'string', scope: 'test' },
    ns_a_names: { value: [], type: 'array', scope: 'test' },
    ns_a_count: { value: 0, type: 'integer', scope: 'test' },
    a_solo_applied: { value: {}, type: APPLIED_RESULT_TYPE, scope: 'test' },
    a_solo_names: { value: [], type: 'array', scope: 'test' },
    a_solo_count: { value: 0, type: 'integer', scope: 'test' },
    b_solo_names: { value: [], type: 'array', scope: 'test' },
    b_solo_count: { value: 0, type: 'integer', scope: 'test' },
    a_both_count: { value: 0, type: 'integer', scope: 'test' },
    b_both_count: { value: 0, type: 'integer', scope: 'test' },
    a_solo_read: { value: 0, type: 'integer', scope: 'test' },
    a_solo_result: { value: {}, type: 'map', scope: 'test' },
    a_both_result: { value: {}, type: 'map', scope: 'test' },
    b_both_result: { value: {}, type: 'map', scope: 'test' },
    b_miss_count: { value: 0, type: 'integer', scope: 'test' },
    b_miss_names: { value: [], type: 'array', scope: 'test' },
    b_miss_ok: { value: false, type: 'boolean', scope: 'test' },
    b_miss_err: { value: '', type: 'string', scope: 'test' },
    b_miss_reason: { value: '', type: 'string', scope: 'test' },
    a_miss_count: { value: 0, type: 'integer', scope: 'test' },
    a_miss_names: { value: [], type: 'array', scope: 'test' },
    a_miss_ok: { value: false, type: 'boolean', scope: 'test' },
    a_miss_err: { value: '', type: 'string', scope: 'test' },
    a_miss_reason: { value: '', type: 'string', scope: 'test' },
    a_del_names: { value: [], type: 'array', scope: 'test' },
    a_del_count: { value: 0, type: 'integer', scope: 'test' },
    tunnel_closed: { value: false, type: 'boolean', scope: 'test' },
  }

  const nodes: WorkflowNode[] = [
    sshSessionOpenNode({
      id: 'open-session',
      description: 'SSH session the tunnel rides',
      expressionFields: ['password'],
      values: {
        host: SSH_FIXTURE_HOST_SENTINEL,
        port: Number(SSH_MAIN_PORT),
        username: SSH_STACK_USER,
        password: 'ssh_pwd',
        host_key_verification: 'disabled',
      },
      outputBindings: { session_id: 'sid' },
    }),
    pluginNode({
      id: 'tunnel-open',
      label: 'SSH Tunnel Open',
      elementType: 'ssh-tunnel-open',
      category: 'network',
      description: 'Tunnel to the unpublished cluster',
      expressionFields: ['session_id'],
      values: {
        session_id: 'sid',
        local_port: 0,
        remote_host: K8S_INTERNAL_SERVICE,
        remote_port: Number(K8S_INTERNAL_PORT),
      },
      outputBindings: { tunnel_id: 'tid', local_port: 'lport' },
    }),
    k8sConnectNode({
      id: 'connect-a',
      description: 'Session A: the tunneled cluster',
      expressionFields: ['api_url', 'token', 'ca_cert'],
      values: {
        api_url: TUNNELED_API_URL,
        namespace: ctx.namespace,
        timeout: 30,
        token: 'k8s_admin_token',
        verify_ssl: true,
        ca_cert: 'k8s_ca',
        tls_server_name: K8S_INTERNAL_SERVICE,
      },
      outputBindings: { session: SESSION_A, cluster_version: 'ver_a' },
    }),
    k8sConnectNode({
      id: 'connect-b',
      description: 'Session B: the published cluster',
      expressionFields: ['token', 'ca_cert'],
      values: {
        api_url: K8S_API_URL,
        namespace: ctx.namespace,
        timeout: 30,
        token: 'k8s_admin_token',
        verify_ssl: true,
        ca_cert: 'k8s_ca',
      },
      outputBindings: { session: SESSION_B, cluster_version: 'ver_b' },
    }),
    k8sApplyNode({
      id: 'ns-a',
      description: 'Session A: create the run namespace',
      expressionFields: ['session'],
      values: {
        session: SESSION_A,
        timeout: 30,
        define_with: 'manifest',
        manifest: namespaceManifest(ctx.namespace),
        if_exists: 'update',
        output_format: 'map',
        on_error: 'fail',
      },
      outputBindings: { names: 'ns_a_names', count: 'ns_a_count' },
    }),
    applyConfigMap(
      'apply-a-solo',
      'Session A: write the tunnel-only ConfigMap',
      SESSION_A,
      ctx,
      names.tunnelOnly,
      ORIGIN_TUNNELED,
      { result: 'a_solo_applied', names: 'a_solo_names', count: 'a_solo_count' },
    ),
    applyConfigMap(
      'apply-b-solo',
      'Session B: write the published-only ConfigMap',
      SESSION_B,
      ctx,
      names.publishedOnly,
      ORIGIN_PUBLISHED,
      { names: 'b_solo_names', count: 'b_solo_count' },
    ),
    applyConfigMap(
      'apply-a-both',
      'Session A: write the shared-name ConfigMap',
      SESSION_A,
      ctx,
      names.shared,
      ORIGIN_TUNNELED,
      { count: 'a_both_count' },
    ),
    applyConfigMap(
      'apply-b-both',
      'Session B: write the shared-name ConfigMap',
      SESSION_B,
      ctx,
      names.shared,
      ORIGIN_PUBLISHED,
      { count: 'b_both_count' },
    ),
    getConfigMap(
      'get-a-solo',
      'Session A: read the tunnel-only ConfigMap back',
      SESSION_A,
      ctx,
      names.tunnelOnly,
      { result: 'a_solo_result', count: 'a_solo_read' },
      'fail',
    ),
    getConfigMap(
      'get-b-both',
      'Session B: read the shared-name ConfigMap',
      SESSION_B,
      ctx,
      names.shared,
      { result: 'b_both_result' },
      'fail',
    ),
    getConfigMap(
      'get-a-both',
      'Session A: read the shared-name ConfigMap',
      SESSION_A,
      ctx,
      names.shared,
      { result: 'a_both_result' },
      'fail',
    ),
    getConfigMap(
      'get-b-miss',
      'Session B: the tunnel-only ConfigMap is absent',
      SESSION_B,
      ctx,
      names.tunnelOnly,
      {
        names: 'b_miss_names',
        count: 'b_miss_count',
        success: 'b_miss_ok',
        error: 'b_miss_err',
        reason: 'b_miss_reason',
      },
      'record',
    ),
    getConfigMap(
      'get-a-miss',
      'Session A: the published-only ConfigMap is absent',
      SESSION_A,
      ctx,
      names.publishedOnly,
      {
        names: 'a_miss_names',
        count: 'a_miss_count',
        success: 'a_miss_ok',
        error: 'a_miss_err',
        reason: 'a_miss_reason',
      },
      'record',
    ),
    markerNode({
      id: 'log-roundtrip',
      description: 'Roundtrip and split marker',
      expression:
        `f'${TUNNEL_MARKER} verA={ver_a} verB={ver_b} nsA={ns_a_count}` +
        ` applyA={a_solo_count} applyB={b_solo_count} readA={a_solo_read}` +
        ` missB={b_miss_reason} missA={a_miss_reason}'`,
    }),
    k8sDeleteNode({
      id: 'delete-a-ns',
      description: 'Session A: remove the run namespace',
      expressionFields: ['session'],
      values: {
        session: SESSION_A,
        timeout: 30,
        resource_type: 'default',
        kind: 'Namespace',
        delete_by: 'name',
        name: ctx.namespace,
        ignore_not_found: true,
        cascade: 'background',
        // The namespace goes to Terminating and its contents drain after the
        // run, so the Block must not sit on the poll.
        wait_until_gone: false,
        on_error: 'fail',
      },
      outputBindings: { names: 'a_del_names', count: 'a_del_count' },
    }),
    pluginNode({
      id: 'tunnel-close',
      label: 'SSH Tunnel Close',
      elementType: 'ssh-tunnel-close',
      category: 'network',
      description: 'Close the tunnel',
      expressionFields: ['tunnel_id'],
      values: { tunnel_id: 'tid' },
      outputBindings: { closed: 'tunnel_closed' },
    }),
    pluginNode({
      id: 'close-session',
      label: 'SSH Session Close',
      elementType: 'ssh-session-close',
      category: 'remote',
      description: 'Close the SSH session',
      expressionFields: ['session_id'],
      values: { session_id: 'sid' },
    }),
    markerNode({ id: 'log-done', description: 'Bookend', text: TUNNEL_DONE_MARKER }),
  ]

  for (const node of nodes) {
    const name = String((node.data as { description?: string }).description ?? '')
    if (name.length > MAX_BLOCK_NAME) {
      throw new Error(
        `Block name for ${node.id} is ${name.length} characters, over ${MAX_BLOCK_NAME}`,
      )
    }
  }
  assertRoster(nodes)

  const laidOut = stackNodes(nodes)
  const edges: WorkflowEdge[] = chainEdges(laidOut.map((node) => node.id))

  return {
    name: TUNNEL_FIXTURE_NAME,
    version: '1.0.0',
    description: '',
    workflow: { nodes: laidOut, edges },
    variables,
    metadata: { tags: [], suite_id: null, parent_suite: null },
  }
}
