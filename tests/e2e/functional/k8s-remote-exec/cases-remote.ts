/**
 * The remote K8s workflows, as data.
 *
 * Every leg is one SSH Session Open followed by a Remote Execution container
 * whose body holds the K8s Blocks, with the console bookend on the container's
 * then branch. The cluster and the gateway are named by their compose DNS
 * names, which resolve only inside the stack network, so a Connect that
 * succeeds can only have run on the SSH host.
 */

import { expect, type Page } from '../../helpers/playwright-fixtures'
import { getLogEntries } from '../../helpers/log-reader'
import { expectNodeStatus } from '../../helpers/k8s-run'
import {
  chainEdges,
  delayNode,
  edge,
  handleEdge,
  k8sApplyNode,
  k8sApplyResultType,
  type K8sApplyValues,
  k8sConnectNode,
  k8sCopyNode,
  k8sDeleteNode,
  k8sExecNode,
  k8sReadNode,
  k8sRolloutNode,
  k8sScaleNode,
  k8sScriptNode,
  markerNode,
  remoteExecutionNode,
  sshSessionExecNode,
  sshSessionOpenNode,
  stackNodes,
  type WorkflowEdge,
  type WorkflowNode,
} from '../../helpers/k8s-nodes'
import {
  HTTP_FIXTURE_HOST_SENTINEL,
  K8S_GATEWAY_PORT,
  K8S_GATEWAY_PREFIX,
  K8S_GATEWAY_SERVICE,
  K8S_INTERNAL_PORT,
  K8S_SERVICE,
  K8S_STUB_CA_PEM,
  K8S_STUB_PORT,
  K8S_STUB_STAMP_COLONLESS,
  K8S_STUB_STAMP_HOUR,
  SSH_BADPY_PORT,
  SSH_BANNER_PORT,
  SSH_FIXTURE_HOST_SENTINEL,
  SSH_MAIN_PORT,
  SSH_STACK_PASSWORD,
  SSH_STACK_USER,
} from '../../helpers/config'
import { SEEDED } from '../../helpers/k8s-seed'

/** The published cluster as in-network hosts reach it. Both kwok clusters
 *  come from one image and serve on the same in-network port. */
export const K8S_DIRECT_URL = `https://${K8S_SERVICE}:${K8S_INTERNAL_PORT}`

/** The plain-HTTP, path-prefixed front of the same cluster. */
export const K8S_GATEWAY_URL = `http://${K8S_GATEWAY_SERVICE}:${K8S_GATEWAY_PORT}${K8S_GATEWAY_PREFIX}`

/** kwok is pinned to Kubernetes 1.33.0. */
export const K8S_VERSION = 'v1.33.0'

/** The service account the cluster lets a run token be minted for. It is
 *  bound to the view role, so it reads ConfigMaps and nothing more. */
export const RUN_TOKEN_SERVICE_ACCOUNT = 'wave-tests'
export const RUN_TOKEN_NAMESPACE = 'default'
export const RUN_TOKEN_DURATION = 14400

/** The data the seeded ConfigMap carries (`seedRun(request, 'get')`). */
export const CONFIG_MAP_DATA: Record<string, string> = { key: 'value' }

/** The objects the write legs create. The run namespace is already unique, so
 *  the names are fixed. */
export const WRITTEN_REMOTE = {
  configMap: 'wave-remote-cm',
  configMapKey: 'locus',
  configMapValue: 'remote',
  datedConfigMap: 'wave-remote-dated',
  datedKey: 'expires',
  datedValue: '2026-01-01',
  secretForm: 'wave-remote-sec-form',
  secretFormKey: 'canary',
  secretManifest: 'wave-remote-sec-manifest',
  secretManifestKey: 'token',
} as const

/** The variable the secret leg's manifest reads its stringData through. */
export const WRITE_SECRETS_CANARY_VAR = 'k8s_canary'

/** An unquoted date and a trailing separator: the date must reach the cluster
 *  as text and the separator must open no second document. */
export const datedManifest = (name: string): string =>
  [
    'apiVersion: v1',
    'kind: ConfigMap',
    'metadata:',
    `  name: ${name}`,
    'data:',
    `  ${WRITTEN_REMOTE.datedKey}: ${WRITTEN_REMOTE.datedValue}`,
    '---',
    '',
  ].join('\n')

/** A Secret whose value rides a secret variable, never literal text. */
export const secretManifest = (name: string, key: string): string =>
  [
    'apiVersion: v1',
    'kind: Secret',
    'metadata:',
    `  name: ${name}`,
    'type: Opaque',
    'stringData:',
    `  ${key}: "{{ ${WRITE_SECRETS_CANARY_VAR} }}"`,
    '',
  ].join('\n')

/** The exec leg's marker, and the stdout `echo` leaves behind it. */
export const execEchoMarker = (suffix: string): string => `kr10-exec-${suffix}`
export const execEchoStdout = (suffix: string): string => `${execEchoMarker(suffix)}\n`

/** A script that writes one line to each stream. */
export const TWO_LINE_SCRIPT = (suffix: string): string =>
  [`echo kr10-out-${suffix}`, `echo kr10-err-${suffix} 1>&2`, ''].join('\n')
export const TWO_LINE_STDOUT = (suffix: string): string => `kr10-out-${suffix}\n`
export const TWO_LINE_STDERR = (suffix: string): string => `kr10-err-${suffix}\n`

/** The same, and then a non-zero exit. The code is distinct from every exit
 *  the local exec suite uses, so a mixed-up assertion cannot pass. */
export const RC3_SCRIPT = (suffix: string): string =>
  [`echo kr10-rc3-out-${suffix}`, `echo kr10-rc3-err-${suffix} 1>&2`, 'exit 3', ''].join('\n')
export const RC3_STDOUT = (suffix: string): string => `kr10-rc3-out-${suffix}\n`
export const RC3_STDERR = (suffix: string): string => `kr10-rc3-err-${suffix}\n`
export const RC3_EXIT = 3

/** The sshd account's home. The container is shared by every parallel shard,
 *  so every path carries the run suffix. */
export const SSH_HOST_HOME = '/home/wave'
export const sshHostFile = (suffix: string, name: string): string =>
  `${SSH_HOST_HOME}/${suffix}-${name}`

/** What the round-tripped file holds. No content this suite writes carries a quote. */
export const copyContent = (suffix: string): string => `kr11-copy-${suffix}`

/** A WAVE-side scheme named inside a Remote Execution body. */
export const SCHEME_SOURCE_PATH = 'artifact://run/x.txt'
export const SCHEME_TARGET_PATH = '/wave/exec/app/payload.txt'

/** The container of the seeded log pod whose log is canned. */
export const LOG_CONTAINER = SEEDED.containerApp

/** The `app` log kwok serves for the seeded pod, byte for byte, one entry per line. */
export const APP_LOG_LINES = [
  'app: starting payments-api v2.4.0',
  'app: listening on :8080',
  'app: GET /healthz 200 1ms',
  'app: GET /orders/42 200 12ms',
  'app: WARN upstream latency 812ms',
  'app: GET /healthz 200 1ms',
] as const

/** The same log as one text, the way the string format returns it. */
export const APP_LOG = APP_LOG_LINES.map((line) => `${line}\n`).join('')

/** The RFC3339 stamp kwok prefixes each line with when Timestamps is on. */
export const LOG_STAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{9}Z$/

/** A YAML document opens on one of the two envelope keys; the cluster's own
 *  key order puts `kind` first on a single-object read. */
export const YAML_HEAD_RE = /^apiVersion: /

/** The columns a per-line read with Timestamps on declares. */
export const LOG_TABLE_COLUMNS = ['TIME', 'MESSAGE'] as const

/** The columns a pod usage read declares. */
export const TOP_POD_COLUMNS = ['NAME', 'CPU', 'MEMORY'] as const
export const TOP_POD_CELL = { name: 0, cpu: 1, memory: 2 } as const

/** A CPU cell reads as fixed-point text: digits, one optional fraction, no exponent. */
export const PLAIN_DECIMAL_RE = /^\d+(\.\d+)?$/

/** The events the seeder POSTs about the kubelet pod, by name. */
export const SEEDED_EVENT_NAMES: readonly string[] = [
  SEEDED.eventEventTime,
  SEEDED.eventFirstTimestamp,
  SEEDED.eventCreationOnly,
  SEEDED.eventWarning,
]

/** `DESCRIPTION_TOO_LONG` fires above this, on save and on run alike. */
export const MAX_BLOCK_NAME = 64

/** The plugin's own INFO line for a Connect that read the cluster. */
export const connectedLine = (url: string): string =>
  `Connected to Kubernetes ${K8S_VERSION} at ${url}`

/** The head of the INFO line a granted run token writes; the expiry follows. */
export const runTokenLinePrefix = (serviceAccount: string): string =>
  `Run token for service account '${serviceAccount}' granted until`

/** The WARN line a recorded read failure writes. */
export const recordedReadLine = (reason: string, message: string): string =>
  `Read failed (${reason}): ${message}`

/** The ERROR line a Block that raised writes. */
export const blockFailedLine = (blockName: string, message: string): string =>
  `Block '${blockName}' failed: ${message}`

/** The cluster-scoped name no run ever creates. */
export const missingNamespaceName = (suffix: string): string => `does-not-exist-${suffix}`

/** The cluster wording for a namespace that is not there. */
export const missingNamespaceMessage = (name: string): string =>
  `K8s namespace '${name}' not found`

/** The refusal the Connect inside the validation leg raises before any request. */
export const TIMEOUT_REFUSAL = "Parameter 'timeout' must be positive"

/** The fixed context the checked-in golden is built from. */
export const GOLDEN_SUFFIX = 'golden00'
export const GOLDEN_NAMESPACES: ReadNamespaces = {
  get: 'wave-e2e-golden-get',
  events: 'wave-e2e-golden-events',
  logs: 'wave-e2e-golden-logs',
  top: 'wave-e2e-golden-top',
}

/** The fixed context the checked-in write golden is built from. */
export const WRITE_GOLDEN_SUFFIX = 'goldenw0'
export const WRITE_GOLDEN_NAMESPACE = 'wave-e2e-golden-write'

/** The Test names the builders emit; `importFixtureTest` uniquifies them. */
export const READ_FIXTURE_NAME = 'K8s Remote Read E2E Test'
export const SECRETS_FIXTURE_NAME = 'K8s Remote Secret Canary E2E Test'
export const GATEWAY_FIXTURE_NAME = 'K8s Remote Gateway E2E Test'
export const VALIDATION_FIXTURE_NAME = 'K8s Remote Validation E2E Test'
export const WRITE_FIXTURE_NAME = 'K8s Remote Write E2E Test'
export const WRITE_SECRETS_FIXTURE_NAME = 'K8s Remote Secret Write Canary E2E Test'
export const EXEC_FIXTURE_NAME = 'K8s Remote Exec Channel E2E Test'
export const COPY_FIXTURE_NAME = 'K8s Remote Copy E2E Test'
export const SCHEME_FIXTURE_NAME = 'K8s Remote Copy Scheme E2E Test'

/** The bookends the console harvests gate on. */
export const READ_DONE_MARKER = 'k8s-remote-read-e2e-done'
export const SECRETS_DONE_MARKER = 'k8s-remote-secrets-e2e-done'
export const GATEWAY_DONE_MARKER = 'k8s-remote-gateway-e2e-done'
export const VALIDATION_DONE_MARKER = 'k8s-remote-validation-e2e-done'
export const WRITE_DONE_MARKER = 'k8s-remote-write-e2e-done'
export const WRITE_SECRETS_DONE_MARKER = 'k8s-remote-write-secrets-e2e-done'
export const EXEC_DONE_MARKER = 'k8s-remote-exec-e2e-done'
export const COPY_DONE_MARKER = 'k8s-remote-copy-e2e-done'
export const SCHEME_DONE_MARKER = 'k8s-remote-scheme-e2e-done'

/** The prefixes of the summary lines the runs stamp. */
export const READ_MARKER = '[KR-1]'
export const SECRETS_MARKER = '[KR-2]'
export const GATEWAY_MARKER = '[KR-3]'
export const WRITE_MARKER = '[KR-8]'
export const WRITE_SECRETS_MARKER = '[KR-9]'
export const EXEC_MARKER = '[KR-10]'
export const COPY_MARKER = '[KR-11]'

/** The build-time material every leg carries. PEM and token bytes are never
 *  committed, so the checked-in golden holds empty strings here. */
export interface RemoteMaterial {
  suffix: string
  caCert: string
  adminToken: string
}

/** One namespace per seed profile the read leg reads. */
export interface ReadNamespaces {
  get: string
  events: string
  logs: string
  top: string
}

type FixtureVariable = { value: unknown; type: string; scope: string; secret?: boolean }

/** The Blocks every leg shares, by id. */
export const SHARED_IDS = {
  hold: 'delay-hold',
  openSession: 'open-session',
  container: 'container',
  summary: 'log-summary',
  done: 'log-done',
} as const

/** The read leg's body, by id, in chain order. */
export const READ_IDS = {
  connectA: 'connect-a',
  configMapMap: 'get-cm-map',
  configMapYaml: 'get-cm-yaml',
  events: 'events-ns',
  logsText: 'logs-text',
  logsTable: 'logs-table',
  topPods: 'top-pods',
  missing: 'get-missing',
  connectB: 'connect-b',
  configMapB: 'get-b',
} as const

/** The secret leg's body, by id. */
export const SECRETS_IDS = {
  connect: 'connect-a',
  secret: 'get-secret',
} as const

/** The gateway leg's body, by id. */
export const GATEWAY_IDS = {
  connect: 'connect-gw',
  namespaces: 'get-ns-list',
  missing: 'get-missing',
} as const

/** The validation leg's body, by id. */
export const VALIDATION_IDS = {
  connect: 'connect-bad',
  after: 'get-after',
} as const

/** The validation Connect's Name and Description; the failure line names it (EXEC-26). */
export const VALIDATION_CONNECT_NAME = 'Connect with a zero timeout'

/** Every variable name the read leg binds. */
export const READ_VARS = {
  sessionA: 'sess_a',
  versionA: 'ver_a',
  cmResult: 'cm_result',
  cmNames: 'cm_names',
  cmCount: 'cm_count',
  cmYaml: 'cm_yaml',
  evResult: 'ev_result',
  evCount: 'ev_count',
  logText: 'log_text',
  logTable: 'log_table',
  topUsage: 'top_usage',
  topCount: 'top_count',
  missOk: 'miss_ok',
  missReason: 'miss_reason',
  missError: 'miss_err',
  missNames: 'miss_names',
  missCount: 'miss_count',
  sessionB: 'sess_b',
  bNames: 'b_names',
  bCount: 'b_count',
} as const

export const SECRETS_VARS = {
  session: 'sess_a',
  version: 'ver_a',
  result: 'sec_result',
  names: 'sec_names',
  count: 'sec_count',
} as const

export const GATEWAY_VARS = {
  session: 'sess_gw',
  version: 'ver_gw',
  names: 'ns_names',
  count: 'ns_count',
  missOk: 'miss_ok',
  missReason: 'miss_reason',
  missError: 'miss_err',
} as const

export const VALIDATION_VARS = {
  session: 'sess_bad',
  count: 'after_count',
} as const

/** The write leg's body, by id, in chain order. */
export const WRITE_IDS = {
  connect: 'connect-a',
  applyForm: 'apply-cm',
  readForm: 'get-cm',
  applyManifest: 'apply-dated',
  readManifest: 'get-dated',
  drop: 'delete-cm',
  missing: 'get-dropped',
  scale: 'scale-deploy',
  rollout: 'rollout-status',
} as const

export const WRITE_VARS = {
  session: 'sess_a',
  version: 'ver_a',
  cmSummary: 'cm_summary',
  cmResult: 'cm_result',
  cmNames: 'cm_names',
  cmCount: 'cm_count',
  cmOk: 'cm_ok',
  readResult: 'read_result',
  readCount: 'read_count',
  dtSummary: 'dt_summary',
  dtResult: 'dt_result',
  dtNames: 'dt_names',
  dtCount: 'dt_count',
  dtOk: 'dt_ok',
  dtRead: 'dt_read',
  dtReadCount: 'dt_read_count',
  dropSummary: 'drop_summary',
  dropNames: 'drop_names',
  dropCount: 'drop_count',
  dropOk: 'drop_ok',
  missOk: 'miss_ok',
  missReason: 'miss_reason',
  missError: 'miss_err',
  missNames: 'miss_names',
  missCount: 'miss_count',
  scaleSummary: 'scale_summary',
  scaleOk: 'scale_ok',
  rollSummary: 'roll_summary',
  rollStatus: 'roll_status',
  rollOk: 'roll_ok',
} as const

/** The secret write leg's body, by id. */
export const WRITE_SECRETS_IDS = {
  connect: 'connect-a',
  applyForm: 'apply-sec-form',
  readForm: 'get-sec-form',
  applyManifest: 'apply-sec-manifest',
  readManifest: 'get-sec-manifest',
} as const

export const WRITE_SECRETS_VARS = {
  session: 'sess_a',
  version: 'ver_a',
  formResult: 'sec_form',
  formNames: 'sec_form_names',
  formCount: 'sec_form_count',
  formRead: 'sec_form_read',
  formReadCount: 'sec_form_read_count',
  manResult: 'sec_man',
  manNames: 'sec_man_names',
  manCount: 'sec_man_count',
  manRead: 'sec_man_read',
  manReadCount: 'sec_man_read_count',
} as const

/** The exec leg's body, by id. */
export const EXEC_IDS = {
  connect: 'connect-a',
  mark: 'exec-mark',
  two: 'script-two',
  rc3: 'script-rc3',
  noexec: 'exec-noexec',
} as const

/** The prefix each exec Block's four variables share. */
export const EXEC_KEYS = { mark: 'mark', two: 'two', rc3: 'rc3', noexec: 'noexec' } as const

export const EXEC_VARS = { session: 'sess_a', version: 'ver_a' } as const

/** The Copy leg, by id. Three of these run on WAVE against the SSH host. */
export const COPY_IDS = {
  hostWrite: 'ssh-write',
  connect: 'connect-a',
  push: 'copy-push',
  read: 'exec-read',
  pull: 'copy-pull',
  hostVerify: 'ssh-verify',
  hostClean: 'ssh-clean',
} as const

export const COPY_VARS = {
  session: 'sess_a',
  version: 'ver_a',
  writeExit: 'write_exit',
  homeStdout: 'home_stdout',
  homeExit: 'home_exit',
  cleanExit: 'clean_exit',
} as const

/** The scheme-refusal leg, by id. It is never run. */
export const SCHEME_IDS = { connect: 'connect-a', copy: 'copy-scheme' } as const

export const SCHEME_VARS = { session: 'sess_a', version: 'ver_a' } as const

const stringVar = (value = ''): FixtureVariable => ({ value, type: 'string', scope: 'test' })
const secretVar = (value = ''): FixtureVariable => ({
  value,
  type: 'string',
  scope: 'test',
  secret: true,
})
const integerVar = (): FixtureVariable => ({ value: 0, type: 'integer', scope: 'test' })
const booleanVar = (): FixtureVariable => ({ value: false, type: 'boolean', scope: 'test' })
const arrayVar = (): FixtureVariable => ({ value: [], type: 'array', scope: 'test' })
const mapVar = (): FixtureVariable => ({ value: {}, type: 'map', scope: 'test' })
const tableVar = (): FixtureVariable => ({ value: [], type: 'table', scope: 'test' })

/** The recorded-failure bindings a Get under Record and continue offers. */
function recordedVars(ok: string, reason: string, error: string): Record<string, FixtureVariable> {
  return { [ok]: booleanVar(), [reason]: stringVar(), [error]: stringVar() }
}

/** A direct Connect: TLS on, the checked-in CA, the admin token. */
function connectDirect(
  id: string,
  description: string,
  namespace: string,
  outputBindings: Record<string, string>,
  extra: Record<string, unknown> = {},
  label?: string,
): WorkflowNode {
  return k8sConnectNode({
    id,
    ...(label ? { label } : {}),
    description,
    expressionFields: ['token', 'ca_cert'],
    values: {
      api_url: K8S_DIRECT_URL,
      namespace,
      timeout: 30,
      token: 'k8s_admin_token',
      verify_ssl: true,
      ca_cert: 'k8s_ca',
      ...extra,
    },
    outputBindings,
  })
}

/** A Get of one ConfigMap by name, as a map. */
function getConfigMap(
  id: string,
  description: string,
  session: string,
  namespace: string,
  name: string,
  outputBindings: Record<string, string>,
  outputFormat: 'map' | 'yaml' = 'map',
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
      output_format: outputFormat,
      namespace,
      on_error: 'fail',
    },
    outputBindings,
  })
}

/** A Get of one Namespace by name that records its failure instead of raising. */
function getMissingNamespace(
  id: string,
  suffix: string,
  session: string,
  outputBindings: Record<string, string>,
): WorkflowNode {
  return k8sReadNode({
    id,
    elementType: 'k8s-get',
    description: 'Get a namespace that does not exist',
    expressionFields: ['session'],
    values: {
      session,
      timeout: 30,
      resource_type: 'default',
      kind: 'Namespace',
      search_by: 'name',
      name: missingNamespaceName(suffix),
      output_format: 'map',
      on_error: 'record',
    },
    outputBindings,
  })
}

interface RemoteWorkflowSpec {
  name: string
  material: RemoteMaterial
  /** The Blocks inside the container, in chain order. */
  body: readonly WorkflowNode[]
  /** The Blocks on the then branch, in chain order; the bookend follows them. */
  after: readonly WorkflowNode[]
  bookend: string
  variables: Record<string, FixtureVariable>
  /** A Delay ahead of the SSH open, so a websocket collector can subscribe. */
  holdMs?: number
  /** The Blocks ahead of the SSH open, in chain order; they run on WAVE. */
  before?: readonly WorkflowNode[]
  /** The Blocks between the SSH open and the container, in chain order; they
   *  run on WAVE and can ride the session the open just returned. */
  preBody?: readonly WorkflowNode[]
  /** The SSH host's port; defaults to the main sshd service. */
  sshPort?: number
}

/** Vertical spacing of the stacked columns. */
const ROW_STEP = 70
const HEAD_X = -75
const BODY_X = 120

/** Build one remote workflow: the SSH open, the container, its body and its
 *  then branch, the bookend, and the variables every leg shares. */
function remoteWorkflow(spec: RemoteWorkflowSpec): Record<string, unknown> {
  const variables: Record<string, FixtureVariable> = {
    ssh_pwd: secretVar(SSH_STACK_PASSWORD),
    k8s_admin_token: secretVar(spec.material.adminToken),
    k8s_ca: stringVar(spec.material.caCert),
    sid: stringVar(),
    rsid: stringVar(),
    ...spec.variables,
  }

  const head: WorkflowNode[] = [...(spec.before ?? [])]
  if (spec.holdMs !== undefined) {
    head.push(
      delayNode({
        id: SHARED_IDS.hold,
        description: 'WS subscribe window',
        durationMs: spec.holdMs,
      }),
    )
  }
  head.push(
    sshSessionOpenNode({
      id: SHARED_IDS.openSession,
      description: 'SSH session the worker rides',
      expressionFields: ['password'],
      values: {
        host: SSH_FIXTURE_HOST_SENTINEL,
        port: spec.sshPort ?? Number(SSH_MAIN_PORT),
        username: SSH_STACK_USER,
        password: 'ssh_pwd',
        host_key_verification: 'disabled',
      },
      outputBindings: { session_id: 'sid' },
    }),
  )
  head.push(...(spec.preBody ?? []))
  head.push(
    remoteExecutionNode({
      id: SHARED_IDS.container,
      description: 'Run the body on the SSH host',
      expressionFields: ['session_id'],
      values: { session_id: 'sid' },
      outputBindings: { remote_session_id: 'rsid' },
    }),
  )
  const after: WorkflowNode[] = [
    ...spec.after,
    markerNode({ id: SHARED_IDS.done, description: 'Bookend', text: spec.bookend }),
  ]

  for (const node of [...head, ...spec.body, ...after]) {
    const name = String((node.data as { description?: string }).description ?? '')
    if (name.length > MAX_BLOCK_NAME) {
      throw new Error(
        `Block name for ${node.id} is ${name.length} characters, over ${MAX_BLOCK_NAME}`,
      )
    }
  }

  const headOut = stackNodes(head, { x: HEAD_X, startY: 100, step: ROW_STEP })
  const bodyOut = stackNodes(spec.body, {
    x: BODY_X,
    startY: 100 + head.length * ROW_STEP,
    step: ROW_STEP,
  })
  const afterOut = stackNodes(after, {
    x: HEAD_X,
    startY: 100 + (head.length + spec.body.length) * ROW_STEP,
    step: ROW_STEP,
  })

  const chain = (ids: readonly string[]): WorkflowEdge[] =>
    ids.slice(1).map((id, index) => edge(ids[index], id))
  const bodyIds = spec.body.map((node) => node.id)
  const afterIds = after.map((node) => node.id)
  const edges: WorkflowEdge[] = [
    ...chainEdges(head.map((node) => node.id)),
    handleEdge(SHARED_IDS.container, 'body', bodyIds[0]),
    ...chain(bodyIds),
    handleEdge(SHARED_IDS.container, 'then', afterIds[0]),
    ...chain(afterIds),
  ]

  return {
    name: spec.name,
    version: '1.0.0',
    description: '',
    workflow: { nodes: [...headOut, ...bodyOut, ...afterOut], edges },
    variables,
    metadata: { tags: [], suite_id: null, parent_suite: null },
  }
}

type FixtureShape = {
  workflow: { nodes: WorkflowNode[]; edges: WorkflowEdge[] }
}

/** Every Block id a built fixture holds, in emitted order. */
export function nodeIds(fixture: Record<string, unknown>): string[] {
  return (fixture as FixtureShape).workflow.nodes.map((node) => node.id)
}

/** The Blocks inside the container: everything reachable from its body handle
 *  over plain edges, the same rule the canvas paints the locus badge by. */
export function remoteBodyIds(fixture: Record<string, unknown>): string[] {
  const { edges } = (fixture as FixtureShape).workflow
  const members: string[] = []
  const queue = edges
    .filter((entry) => entry.source === SHARED_IDS.container && entry.sourceHandle === 'body')
    .map((entry) => entry.target)
  while (queue.length > 0) {
    const id = queue.shift() as string
    if (members.includes(id)) continue
    members.push(id)
    for (const entry of edges) {
      if (entry.source === id && entry.sourceHandle === undefined) queue.push(entry.target)
    }
  }
  return members
}

/** KR-1: every read Block inside one container, then a second session minted
 *  from a run token, then a read riding it. */
export function buildReadFixture(
  material: RemoteMaterial & { namespaces: ReadNamespaces },
): Record<string, unknown> {
  const ns = material.namespaces
  const v = READ_VARS

  const variables: Record<string, FixtureVariable> = {
    [v.sessionA]: secretVar(),
    [v.versionA]: stringVar(),
    [v.cmResult]: mapVar(),
    [v.cmNames]: arrayVar(),
    [v.cmCount]: integerVar(),
    [v.cmYaml]: stringVar(),
    [v.evResult]: arrayVar(),
    [v.evCount]: integerVar(),
    [v.logText]: stringVar(),
    [v.logTable]: tableVar(),
    [v.topUsage]: tableVar(),
    [v.topCount]: integerVar(),
    ...recordedVars(v.missOk, v.missReason, v.missError),
    [v.missNames]: arrayVar(),
    [v.missCount]: integerVar(),
    [v.sessionB]: secretVar(),
    [v.bNames]: arrayVar(),
    [v.bCount]: integerVar(),
  }

  const body: WorkflowNode[] = [
    connectDirect(READ_IDS.connectA, 'Session A: the cluster by its stack name', ns.get, {
      session: v.sessionA,
      cluster_version: v.versionA,
    }),
    getConfigMap(
      READ_IDS.configMapMap,
      'Read the seeded ConfigMap as a map',
      v.sessionA,
      ns.get,
      SEEDED.configMap,
      { result: v.cmResult, names: v.cmNames, count: v.cmCount },
    ),
    getConfigMap(
      READ_IDS.configMapYaml,
      'Read the seeded ConfigMap as YAML',
      v.sessionA,
      ns.get,
      SEEDED.configMap,
      { result: v.cmYaml },
      'yaml',
    ),
    k8sReadNode({
      id: READ_IDS.events,
      elementType: 'k8s-events',
      description: 'Events of the last hour in the events namespace',
      expressionFields: ['session'],
      values: {
        session: v.sessionA,
        timeout: 30,
        within_seconds: 3600,
        output_format: 'map',
        namespace: ns.events,
        on_error: 'fail',
      },
      outputBindings: { result: v.evResult, count: v.evCount },
    }),
    k8sReadNode({
      id: READ_IDS.logsText,
      elementType: 'k8s-logs',
      description: 'The app container log as text',
      expressionFields: ['session'],
      values: {
        session: v.sessionA,
        timeout: 30,
        pod: SEEDED.podMulti,
        container: LOG_CONTAINER,
        namespace: ns.logs,
        on_error: 'fail',
      },
      outputBindings: { logs: v.logText },
    }),
    k8sReadNode({
      id: READ_IDS.logsTable,
      elementType: 'k8s-logs',
      description: 'The same log as a TIME and MESSAGE table',
      expressionFields: ['session'],
      values: {
        session: v.sessionA,
        timeout: 30,
        pod: SEEDED.podMulti,
        container: LOG_CONTAINER,
        timestamps: true,
        output_format: 'array',
        namespace: ns.logs,
        on_error: 'fail',
      },
      outputBindings: { logs: v.logTable },
    }),
    k8sReadNode({
      id: READ_IDS.topPods,
      elementType: 'k8s-top',
      description: 'Usage of every pod in the top namespace',
      expressionFields: ['session'],
      values: {
        session: v.sessionA,
        timeout: 30,
        scope: 'pod',
        select_by: 'all',
        namespace: ns.top,
        on_error: 'fail',
      },
      outputBindings: { usage: v.topUsage, count: v.topCount },
    }),
    getMissingNamespace(READ_IDS.missing, material.suffix, v.sessionA, {
      names: v.missNames,
      count: v.missCount,
      success: v.missOk,
      error: v.missError,
      reason: v.missReason,
    }),
    connectDirect(
      READ_IDS.connectB,
      `Session B: a run token for ${RUN_TOKEN_SERVICE_ACCOUNT}`,
      ns.get,
      { session: v.sessionB },
      {
        acquire_run_token: true,
        run_token_service_account: RUN_TOKEN_SERVICE_ACCOUNT,
        run_token_namespace: RUN_TOKEN_NAMESPACE,
        run_token_duration: RUN_TOKEN_DURATION,
      },
    ),
    getConfigMap(
      READ_IDS.configMapB,
      'Session B: read the seeded ConfigMap',
      v.sessionB,
      ns.get,
      SEEDED.configMap,
      { names: v.bNames, count: v.bCount },
    ),
  ]

  const after: WorkflowNode[] = [
    markerNode({
      id: SHARED_IDS.summary,
      description: 'Summary marker',
      expression:
        `f'${READ_MARKER} ver={${v.versionA}} cm={${v.cmCount}} ev={${v.evCount}}` +
        ` logs={len(${v.logText})} top={${v.topCount}} miss={${v.missReason}}` +
        ` b={${v.bCount}}'`,
    }),
  ]

  return remoteWorkflow({
    name: READ_FIXTURE_NAME,
    material,
    body,
    after,
    bookend: READ_DONE_MARKER,
    variables,
  })
}

/** KR-2: one Get of the seeded Secret, whose value is the canary. The whole
 *  result rides the summary line on purpose: it has to come back masked there. */
export function buildSecretsFixture(
  material: RemoteMaterial & { namespace: string; holdMs: number },
): Record<string, unknown> {
  const v = SECRETS_VARS
  const variables: Record<string, FixtureVariable> = {
    [v.session]: secretVar(),
    [v.version]: stringVar(),
    [v.result]: mapVar(),
    [v.names]: arrayVar(),
    [v.count]: integerVar(),
  }

  const body: WorkflowNode[] = [
    connectDirect(SECRETS_IDS.connect, 'The cluster by its stack name', material.namespace, {
      session: v.session,
      cluster_version: v.version,
    }),
    k8sReadNode({
      id: SECRETS_IDS.secret,
      elementType: 'k8s-get',
      description: 'Read the seeded Secret as a map',
      expressionFields: ['session'],
      values: {
        session: v.session,
        timeout: 30,
        resource_type: 'default',
        kind: 'Secret',
        search_by: 'name',
        name: SEEDED.secret,
        output_format: 'map',
        namespace: material.namespace,
        on_error: 'fail',
      },
      outputBindings: { result: v.result, names: v.names, count: v.count },
    }),
  ]

  const after: WorkflowNode[] = [
    markerNode({
      id: SHARED_IDS.summary,
      description: 'Summary marker',
      expression:
        `f'${SECRETS_MARKER} count={${v.count}} names={${v.names}}` + ` data={${v.result}}'`,
    }),
  ]

  return remoteWorkflow({
    name: SECRETS_FIXTURE_NAME,
    material,
    body,
    after,
    bookend: SECRETS_DONE_MARKER,
    variables,
    holdMs: material.holdMs,
  })
}

/** KR-3: a plain-HTTP Connect through the path-prefixed gateway, a list read
 *  and a recorded miss riding it. */
export function buildGatewayFixture(
  material: RemoteMaterial & { namespace: string },
): Record<string, unknown> {
  const v = GATEWAY_VARS
  const variables: Record<string, FixtureVariable> = {
    [v.session]: secretVar(),
    [v.version]: stringVar(),
    [v.names]: arrayVar(),
    [v.count]: integerVar(),
    ...recordedVars(v.missOk, v.missReason, v.missError),
  }

  const body: WorkflowNode[] = [
    k8sConnectNode({
      id: GATEWAY_IDS.connect,
      description: 'The cluster through the plain-HTTP gateway',
      expressionFields: ['token'],
      values: {
        api_url: K8S_GATEWAY_URL,
        namespace: material.namespace,
        timeout: 30,
        token: 'k8s_admin_token',
      },
      outputBindings: { session: v.session, cluster_version: v.version },
    }),
    k8sReadNode({
      id: GATEWAY_IDS.namespaces,
      elementType: 'k8s-get',
      description: 'List every namespace through the gateway',
      expressionFields: ['session'],
      values: {
        session: v.session,
        timeout: 30,
        resource_type: 'default',
        kind: 'Namespace',
        search_by: 'list',
        output_format: 'map',
        on_error: 'fail',
      },
      outputBindings: { names: v.names, count: v.count },
    }),
    getMissingNamespace(GATEWAY_IDS.missing, material.suffix, v.session, {
      success: v.missOk,
      error: v.missError,
      reason: v.missReason,
    }),
  ]

  const after: WorkflowNode[] = [
    markerNode({
      id: SHARED_IDS.summary,
      description: 'Summary marker',
      expression:
        `f'${GATEWAY_MARKER} ver={${v.version}} namespaces={${v.count}}` +
        ` miss={${v.missReason}}'`,
    }),
  ]

  return remoteWorkflow({
    name: GATEWAY_FIXTURE_NAME,
    material,
    body,
    after,
    bookend: GATEWAY_DONE_MARKER,
    variables,
  })
}

/** KR-4: a Connect the plugin refuses before any request, then a Get that
 *  must never run. The bookend never prints: the run fails inside the body. */
export function buildValidationFixture(
  material: RemoteMaterial & { namespace: string },
): Record<string, unknown> {
  const v = VALIDATION_VARS
  const variables: Record<string, FixtureVariable> = {
    [v.session]: secretVar(),
    [v.count]: integerVar(),
  }

  const body: WorkflowNode[] = [
    connectDirect(
      VALIDATION_IDS.connect,
      VALIDATION_CONNECT_NAME,
      material.namespace,
      { session: v.session },
      { timeout: 0 },
      VALIDATION_CONNECT_NAME,
    ),
    getConfigMap(
      VALIDATION_IDS.after,
      'A read that must never run',
      v.session,
      material.namespace,
      SEEDED.configMap,
      { count: v.count },
    ),
  ]

  return remoteWorkflow({
    name: VALIDATION_FIXTURE_NAME,
    material,
    body,
    after: [],
    bookend: VALIDATION_DONE_MARKER,
    variables,
  })
}

// ---------------------------------------------------------------------------
// The host-diagnosis legs and the event-stamp leg
// ---------------------------------------------------------------------------

/** The claim the container makes about a host with no usable interpreter. A
 *  host whose python3 answers the version probe is never described this way. */
export const NO_INTERPRETER_CLAIM = 'no compatible Python interpreter'

/** Every Block failure line carries this; a leg with no bookend gates on it. */
export const BLOCK_FAILED_MARKER = "' failed: "

export const BANNER_FIXTURE_NAME = 'K8s Remote Banner Host E2E Test'
export const BADPY_FIXTURE_NAME = 'K8s Remote Broken Interpreter E2E Test'
export const STAMPS_FIXTURE_NAME = 'K8s Remote Event Stamp E2E Test'

export const BANNER_DONE_MARKER = 'k8s-remote-banner-e2e-done'
export const BADPY_DONE_MARKER = 'k8s-remote-badpy-e2e-done'
export const STAMPS_DONE_MARKER = 'k8s-remote-stamps-e2e-done'
export const STAMPS_MARKER = '[KR-7]'

/** The one body Block the two host-diagnosis legs carry. It never runs: the
 *  container fails before the body starts. */
export const HOST_IDS = { connect: 'connect-host' } as const
export const HOST_VARS = { session: 'sess_host' } as const

export const STAMPS_IDS = {
  connectLocal: 'connect-local',
  eventsLocal: 'events-local',
  connectRemote: 'connect-remote',
  eventsRemote: 'events-remote',
  connectHour: 'connect-hour',
  eventsHour: 'events-hour',
} as const

export const STAMPS_VARS = {
  localSession: 'sess_local',
  localResult: 'ev_local',
  localCount: 'ev_local_n',
  remoteSession: 'sess_remote',
  remoteResult: 'ev_remote',
  remoteCount: 'ev_remote_n',
  hourSession: 'sess_hour',
  hourResult: 'ev_hour',
  hourCount: 'ev_hour_n',
} as const

/** The stub as a Block running on WAVE reaches it; `injectHttp` rewrites the
 *  host per mode. */
const STUB_LOCAL_BASE = `https://${HTTP_FIXTURE_HOST_SENTINEL}:${K8S_STUB_PORT}`

/** The same stub as in-network hosts reach it: its compose DNS name, whose SAN
 *  the stub certificate covers, on the same port. */
const STUB_SERVICE = 'k8s-stub'
const STUB_REMOTE_BASE = `https://${STUB_SERVICE}:${K8S_STUB_PORT}`

/** Nothing is seeded on the stub: it answers any namespace. */
export const STAMPS_NAMESPACE = 'wave-val'

/** The events the stub serves on its events path, by name. */
export const STUB_EVENT_NAMES: readonly string[] = ['stub-one', 'stub-two']

/** The offset each stamp form puts at the end of an event timestamp. */
export const COLONLESS_OFFSET_RE = /\+0000$/
export const HOUR_OFFSET_RE = /\+00$/

/** A Connect to the stub carrying one timestamp form. */
function stubConnect(
  id: string,
  description: string,
  base: string,
  form: string,
  sessionVar: string,
): WorkflowNode {
  return k8sConnectNode({
    id,
    description,
    expressionFields: ['ca_cert'],
    values: {
      api_url: `${base}/cfg/stamp=${form}`,
      namespace: STAMPS_NAMESPACE,
      timeout: 30,
      verify_ssl: true,
      ca_cert: 'k8s_stub_ca',
    },
    outputBindings: { session: sessionVar },
  })
}

/** An Events read of the stub's events, ordered by the stamps under test. */
function stubEvents(
  id: string,
  description: string,
  sessionVar: string,
  outputBindings: Record<string, string>,
): WorkflowNode {
  return k8sReadNode({
    id,
    elementType: 'k8s-events',
    description,
    expressionFields: ['session'],
    values: {
      session: sessionVar,
      timeout: 30,
      within_seconds: 3600,
      max_events: 10,
      output_format: 'map',
      on_error: 'fail',
    },
    outputBindings,
  })
}

/** The one body Block a host-diagnosis leg carries. */
function hostLegBody(): WorkflowNode[] {
  return [
    connectDirect(HOST_IDS.connect, 'A Connect the host never reaches', 'default', {
      session: HOST_VARS.session,
    }),
  ]
}

/** KR-5: the container on the host that prints a notice ahead of every
 *  command's output. The run fails; what matters is what it says. */
export function buildBannerFixture(material: RemoteMaterial): Record<string, unknown> {
  return remoteWorkflow({
    name: BANNER_FIXTURE_NAME,
    material,
    body: hostLegBody(),
    after: [],
    bookend: BANNER_DONE_MARKER,
    variables: { [HOST_VARS.session]: secretVar() },
    sshPort: Number(SSH_BANNER_PORT),
  })
}

/** KR-6: the container on the host whose python3 answers the version probe and
 *  then fails to run anything, with its reason on stderr. */
export function buildBadpyFixture(material: RemoteMaterial): Record<string, unknown> {
  return remoteWorkflow({
    name: BADPY_FIXTURE_NAME,
    material,
    body: hostLegBody(),
    after: [],
    bookend: BADPY_DONE_MARKER,
    variables: { [HOST_VARS.session]: secretVar() },
    sshPort: Number(SSH_BADPY_PORT),
  })
}

/** KR-7: the same Events read on WAVE and on the host, over stamps whose
 *  offset carries no colon, plus the hour-only form on the host. */
export function buildStampsFixture(material: RemoteMaterial): Record<string, unknown> {
  const v = STAMPS_VARS
  const variables: Record<string, FixtureVariable> = {
    k8s_stub_ca: stringVar(K8S_STUB_CA_PEM),
    [v.localSession]: secretVar(),
    [v.localResult]: arrayVar(),
    [v.localCount]: integerVar(),
    [v.remoteSession]: secretVar(),
    [v.remoteResult]: arrayVar(),
    [v.remoteCount]: integerVar(),
    [v.hourSession]: secretVar(),
    [v.hourResult]: arrayVar(),
    [v.hourCount]: integerVar(),
  }

  const before: WorkflowNode[] = [
    stubConnect(
      STAMPS_IDS.connectLocal,
      'On WAVE: the stub, colonless offsets',
      STUB_LOCAL_BASE,
      K8S_STUB_STAMP_COLONLESS,
      v.localSession,
    ),
    stubEvents(STAMPS_IDS.eventsLocal, 'On WAVE: read the events', v.localSession, {
      result: v.localResult,
      count: v.localCount,
    }),
  ]

  const body: WorkflowNode[] = [
    stubConnect(
      STAMPS_IDS.connectRemote,
      'On the host: the stub, colonless offsets',
      STUB_REMOTE_BASE,
      K8S_STUB_STAMP_COLONLESS,
      v.remoteSession,
    ),
    stubEvents(STAMPS_IDS.eventsRemote, 'On the host: read the events', v.remoteSession, {
      result: v.remoteResult,
      count: v.remoteCount,
    }),
    stubConnect(
      STAMPS_IDS.connectHour,
      'On the host: the stub, hour-only offsets',
      STUB_REMOTE_BASE,
      K8S_STUB_STAMP_HOUR,
      v.hourSession,
    ),
    stubEvents(STAMPS_IDS.eventsHour, 'On the host: read the hour-only events', v.hourSession, {
      result: v.hourResult,
      count: v.hourCount,
    }),
  ]

  const after: WorkflowNode[] = [
    markerNode({
      id: SHARED_IDS.summary,
      description: 'Summary marker',
      expression:
        `f'${STAMPS_MARKER} local={${v.localCount}} remote={${v.remoteCount}}` +
        ` hour={${v.hourCount}}'`,
    }),
  ]

  return remoteWorkflow({
    name: STAMPS_FIXTURE_NAME,
    material,
    before,
    body,
    after,
    bookend: STAMPS_DONE_MARKER,
    variables,
  })
}

// ---------------------------------------------------------------------------
// The write, exec and copy legs
// ---------------------------------------------------------------------------

/** The variable type an Apply's `result` binding must be declared as. */
function applyResultVar(values: K8sApplyValues): FixtureVariable {
  const declared = k8sApplyResultType(values)
  if (declared === 'array') return arrayVar()
  if (declared === 'string') return stringVar()
  return mapVar()
}

/** A Get of one Secret by name, as a map. */
function getSecret(
  id: string,
  description: string,
  session: string,
  namespace: string,
  name: string,
  outputBindings: Record<string, string>,
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
      kind: 'Secret',
      search_by: 'name',
      name,
      output_format: 'map',
      namespace,
      on_error: 'fail',
    },
    outputBindings,
  })
}

/** KR-8: every write Block inside one container - a ConfigMap applied from the
 *  form and read back, a manifest whose unquoted date stays text and whose
 *  trailing separator opens no second document, a delete, the miss it leaves,
 *  a Scale and a Rollout Status. */
export function buildWriteFixture(
  material: RemoteMaterial & { namespace: string },
): Record<string, unknown> {
  const v = WRITE_VARS
  const ns = material.namespace

  const formValues: K8sApplyValues = {
    session: v.session,
    timeout: 30,
    namespace: ns,
    define_with: 'form',
    kind: 'ConfigMap',
    name: WRITTEN_REMOTE.configMap,
    data: { [WRITTEN_REMOTE.configMapKey]: WRITTEN_REMOTE.configMapValue },
    if_exists: 'update',
    output_format: 'map',
    on_error: 'fail',
  }
  const manifestValues: K8sApplyValues = {
    session: v.session,
    timeout: 30,
    namespace: ns,
    define_with: 'manifest',
    manifest: datedManifest(WRITTEN_REMOTE.datedConfigMap),
    if_exists: 'update',
    output_format: 'map',
    on_error: 'fail',
  }

  const variables: Record<string, FixtureVariable> = {
    [v.session]: secretVar(),
    [v.version]: stringVar(),
    [v.cmSummary]: tableVar(),
    [v.cmResult]: applyResultVar(formValues),
    [v.cmNames]: arrayVar(),
    [v.cmCount]: integerVar(),
    [v.cmOk]: booleanVar(),
    [v.readResult]: mapVar(),
    [v.readCount]: integerVar(),
    [v.dtSummary]: tableVar(),
    [v.dtResult]: applyResultVar(manifestValues),
    [v.dtNames]: arrayVar(),
    [v.dtCount]: integerVar(),
    [v.dtOk]: booleanVar(),
    [v.dtRead]: mapVar(),
    [v.dtReadCount]: integerVar(),
    [v.dropSummary]: tableVar(),
    [v.dropNames]: arrayVar(),
    [v.dropCount]: integerVar(),
    [v.dropOk]: booleanVar(),
    ...recordedVars(v.missOk, v.missReason, v.missError),
    [v.missNames]: arrayVar(),
    [v.missCount]: integerVar(),
    [v.scaleSummary]: tableVar(),
    [v.scaleOk]: booleanVar(),
    [v.rollSummary]: tableVar(),
    [v.rollStatus]: stringVar(),
    [v.rollOk]: booleanVar(),
  }

  const body: WorkflowNode[] = [
    connectDirect(WRITE_IDS.connect, 'The cluster by its stack name', ns, {
      session: v.session,
      cluster_version: v.version,
    }),
    k8sApplyNode({
      id: WRITE_IDS.applyForm,
      description: 'Apply a ConfigMap from the form',
      expressionFields: ['session'],
      values: formValues,
      outputBindings: {
        summary: v.cmSummary,
        result: v.cmResult,
        names: v.cmNames,
        count: v.cmCount,
        success: v.cmOk,
      },
    }),
    getConfigMap(
      WRITE_IDS.readForm,
      'Read the applied ConfigMap back',
      v.session,
      ns,
      WRITTEN_REMOTE.configMap,
      { result: v.readResult, count: v.readCount },
    ),
    k8sApplyNode({
      id: WRITE_IDS.applyManifest,
      description: 'Apply a manifest whose date is text',
      expressionFields: ['session'],
      values: manifestValues,
      outputBindings: {
        summary: v.dtSummary,
        result: v.dtResult,
        names: v.dtNames,
        count: v.dtCount,
        success: v.dtOk,
      },
    }),
    getConfigMap(
      WRITE_IDS.readManifest,
      'Read the dated ConfigMap back',
      v.session,
      ns,
      WRITTEN_REMOTE.datedConfigMap,
      { result: v.dtRead, count: v.dtReadCount },
    ),
    k8sDeleteNode({
      id: WRITE_IDS.drop,
      description: 'Delete the form ConfigMap by name',
      expressionFields: ['session'],
      values: {
        session: v.session,
        timeout: 30,
        namespace: ns,
        resource_type: 'default',
        kind: 'ConfigMap',
        delete_by: 'name',
        name: WRITTEN_REMOTE.configMap,
        wait_until_gone: true,
        on_error: 'fail',
      },
      outputBindings: {
        summary: v.dropSummary,
        names: v.dropNames,
        count: v.dropCount,
        success: v.dropOk,
      },
    }),
    k8sReadNode({
      id: WRITE_IDS.missing,
      elementType: 'k8s-get',
      description: 'Read the ConfigMap the delete removed',
      expressionFields: ['session'],
      values: {
        session: v.session,
        timeout: 30,
        resource_type: 'default',
        kind: 'ConfigMap',
        search_by: 'name',
        name: WRITTEN_REMOTE.configMap,
        output_format: 'map',
        namespace: ns,
        on_error: 'record',
      },
      outputBindings: {
        names: v.missNames,
        count: v.missCount,
        success: v.missOk,
        error: v.missError,
        reason: v.missReason,
      },
    }),
    k8sScaleNode({
      id: WRITE_IDS.scale,
      description: 'Scale the seeded Deployment to three',
      expressionFields: ['session'],
      values: {
        session: v.session,
        timeout: 30,
        namespace: ns,
        resource_type: 'default',
        kind: 'Deployment',
        name: SEEDED.deployment,
        replicas: 3,
        on_error: 'fail',
      },
      outputBindings: { summary: v.scaleSummary, success: v.scaleOk },
    }),
    k8sRolloutNode({
      id: WRITE_IDS.rollout,
      description: 'Report the Deployment rollout',
      expressionFields: ['session'],
      values: {
        session: v.session,
        timeout: 30,
        namespace: ns,
        operation: 'status',
        kind: 'Deployment',
        name: SEEDED.deployment,
        on_error: 'fail',
      },
      outputBindings: { summary: v.rollSummary, status: v.rollStatus, success: v.rollOk },
    }),
  ]

  const after: WorkflowNode[] = [
    markerNode({
      id: SHARED_IDS.summary,
      description: 'Summary marker',
      expression:
        `f'${WRITE_MARKER} cm={${v.cmCount}} dated={${v.dtCount}} drop={${v.dropCount}}` +
        ` miss={${v.missReason}} roll={${v.rollStatus}}'`,
    }),
  ]

  return remoteWorkflow({
    name: WRITE_FIXTURE_NAME,
    material,
    body,
    after,
    bookend: WRITE_DONE_MARKER,
    variables,
  })
}

/** KR-9: one planted value written as a Secret twice - once through the form's
 *  declared credential and once through a manifest's stringData reading a
 *  secret variable - then read back both times. */
export function buildWriteSecretsFixture(
  material: RemoteMaterial & { namespace: string; canary: string; holdMs: number },
): Record<string, unknown> {
  const v = WRITE_SECRETS_VARS
  const ns = material.namespace

  const formValues: K8sApplyValues = {
    session: v.session,
    timeout: 30,
    namespace: ns,
    define_with: 'form',
    kind: 'Secret',
    name: WRITTEN_REMOTE.secretForm,
    secret_data: { [WRITTEN_REMOTE.secretFormKey]: material.canary },
    secret_type: 'Opaque',
    if_exists: 'update',
    output_format: 'map',
    on_error: 'fail',
  }
  const manifestValues: K8sApplyValues = {
    session: v.session,
    timeout: 30,
    namespace: ns,
    define_with: 'manifest',
    manifest: secretManifest(WRITTEN_REMOTE.secretManifest, WRITTEN_REMOTE.secretManifestKey),
    if_exists: 'update',
    output_format: 'map',
    on_error: 'fail',
  }

  const variables: Record<string, FixtureVariable> = {
    [WRITE_SECRETS_CANARY_VAR]: secretVar(material.canary),
    [v.session]: secretVar(),
    [v.version]: stringVar(),
    [v.formResult]: applyResultVar(formValues),
    [v.formNames]: arrayVar(),
    [v.formCount]: integerVar(),
    [v.formRead]: mapVar(),
    [v.formReadCount]: integerVar(),
    [v.manResult]: applyResultVar(manifestValues),
    [v.manNames]: arrayVar(),
    [v.manCount]: integerVar(),
    [v.manRead]: mapVar(),
    [v.manReadCount]: integerVar(),
  }

  const body: WorkflowNode[] = [
    connectDirect(WRITE_SECRETS_IDS.connect, 'The cluster by its stack name', ns, {
      session: v.session,
      cluster_version: v.version,
    }),
    // secret_data is a declared credential; listing it as a template field would unseal it at rest.
    k8sApplyNode({
      id: WRITE_SECRETS_IDS.applyForm,
      description: 'Apply an Opaque Secret from the form',
      expressionFields: ['session'],
      values: formValues,
      outputBindings: { result: v.formResult, names: v.formNames, count: v.formCount },
    }),
    getSecret(
      WRITE_SECRETS_IDS.readForm,
      'Read the form Secret back as a map',
      v.session,
      ns,
      WRITTEN_REMOTE.secretForm,
      { result: v.formRead, count: v.formReadCount },
    ),
    k8sApplyNode({
      id: WRITE_SECRETS_IDS.applyManifest,
      description: 'Apply an Opaque Secret from a manifest',
      expressionFields: ['session'],
      templateFields: ['manifest'],
      values: manifestValues,
      outputBindings: { result: v.manResult, names: v.manNames, count: v.manCount },
    }),
    getSecret(
      WRITE_SECRETS_IDS.readManifest,
      'Read the manifest Secret back as a map',
      v.session,
      ns,
      WRITTEN_REMOTE.secretManifest,
      { result: v.manRead, count: v.manReadCount },
    ),
  ]

  const after: WorkflowNode[] = [
    markerNode({
      id: SHARED_IDS.summary,
      description: 'Summary marker',
      expression:
        `f'${WRITE_SECRETS_MARKER} form={${v.formResult}} man={${v.manResult}}` +
        ` rf={${v.formRead}} rm={${v.manRead}}'`,
    }),
  ]

  return remoteWorkflow({
    name: WRITE_SECRETS_FIXTURE_NAME,
    material,
    body,
    after,
    bookend: WRITE_SECRETS_DONE_MARKER,
    variables,
    holdMs: material.holdMs,
  })
}

/** KR-10: the exec channel inside the container - an Exec, two Scripts and a
 *  refusal the cluster makes. */
export function buildExecFixture(
  material: RemoteMaterial & {
    namespace: string
    podExec: string
    podExecB: string
    podNoExec: string
    container: string
  },
): Record<string, unknown> {
  const v = EXEC_VARS
  const k = EXEC_KEYS

  const streamVars = (key: string): Record<string, FixtureVariable> => ({
    [`${key}_stdout`]: stringVar(),
    [`${key}_stderr`]: stringVar(),
    [`${key}_exit`]: integerVar(),
    [`${key}_ok`]: booleanVar(),
  })
  const streamBindings = (key: string): Record<string, string> => ({
    stdout: `${key}_stdout`,
    stderr: `${key}_stderr`,
    exit_code: `${key}_exit`,
    success: `${key}_ok`,
  })

  const variables: Record<string, FixtureVariable> = {
    [v.session]: secretVar(),
    [v.version]: stringVar(),
    ...streamVars(k.mark),
    ...streamVars(k.two),
    ...streamVars(k.rc3),
    ...streamVars(k.noexec),
    [`${k.noexec}_error`]: stringVar(),
    [`${k.noexec}_reason`]: stringVar(),
  }

  const body: WorkflowNode[] = [
    connectDirect(EXEC_IDS.connect, 'Connect to the cluster from the host', material.namespace, {
      session: v.session,
      cluster_version: v.version,
    }),
    k8sExecNode({
      id: EXEC_IDS.mark,
      description: 'Exec: echo the run marker',
      expressionFields: ['session'],
      values: {
        session: v.session,
        pod: material.podExec,
        container: material.container,
        command: `sh -c "echo ${execEchoMarker(material.suffix)}"`,
      },
      outputBindings: streamBindings(k.mark),
    }),
    k8sScriptNode({
      id: EXEC_IDS.two,
      description: 'Script: two lines under /bin/sh',
      expressionFields: ['session'],
      values: {
        session: v.session,
        pod: material.podExecB,
        container: material.container,
        interpreter: '/bin/sh',
        script: TWO_LINE_SCRIPT(material.suffix),
      },
      outputBindings: streamBindings(k.two),
    }),
    k8sScriptNode({
      id: EXEC_IDS.rc3,
      description: 'Script: a non-zero exit is data',
      expressionFields: ['session'],
      values: {
        session: v.session,
        pod: material.podExecB,
        container: material.container,
        interpreter: '/bin/sh',
        script: RC3_SCRIPT(material.suffix),
      },
      outputBindings: streamBindings(k.rc3),
    }),
    k8sExecNode({
      id: EXEC_IDS.noexec,
      description: 'Exec on a pod the cluster grants no exec',
      expressionFields: ['session'],
      values: {
        session: v.session,
        pod: material.podNoExec,
        container: material.container,
        command: 'sh -c "echo never"',
        on_error: 'record',
      },
      outputBindings: {
        ...streamBindings(k.noexec),
        error: `${k.noexec}_error`,
        reason: `${k.noexec}_reason`,
      },
    }),
  ]

  const after: WorkflowNode[] = [
    markerNode({
      id: SHARED_IDS.summary,
      description: 'Summary marker',
      expression:
        `f'${EXEC_MARKER} mark={${k.mark}_exit} two={${k.two}_exit}` +
        ` rc={${k.rc3}_exit} noexec={${k.noexec}_reason}'`,
    }),
  ]

  return remoteWorkflow({
    name: EXEC_FIXTURE_NAME,
    material,
    body,
    after,
    bookend: EXEC_DONE_MARKER,
    variables,
  })
}

/** One command on the SSH session the open returned, run from WAVE. */
function sshHostCommand(
  id: string,
  description: string,
  command: string,
  outputBindings: Record<string, string>,
): WorkflowNode {
  return sshSessionExecNode({
    id,
    description,
    expressionFields: ['session_id'],
    values: { session_id: 'sid', command, timeout: 30 },
    outputBindings,
  })
}

/** KR-11: one file from the SSH host into the pod and back, on one session.
 *  `podPath` is supplied by the caller so this module never imports another
 *  suite's path helper. */
export function buildCopyFixture(
  material: RemoteMaterial & {
    namespace: string
    pod: string
    container: string
    podPath: string
  },
): Record<string, unknown> {
  const v = COPY_VARS
  const hostPush = sshHostFile(material.suffix, 'push.txt')
  const hostPull = sshHostFile(material.suffix, 'pull.txt')

  const variables: Record<string, FixtureVariable> = {
    [v.session]: secretVar(),
    [v.version]: stringVar(),
    [v.writeExit]: integerVar(),
    push_summary: tableVar(),
    push_ok: booleanVar(),
    read_stdout: stringVar(),
    read_stderr: stringVar(),
    read_exit: integerVar(),
    read_ok: booleanVar(),
    pull_summary: tableVar(),
    pull_ok: booleanVar(),
    [v.homeStdout]: stringVar(),
    [v.homeExit]: integerVar(),
    [v.cleanExit]: integerVar(),
  }

  // printf %s writes no trailing newline, so the file is exactly copyContent(suffix).
  const preBody: WorkflowNode[] = [
    sshHostCommand(
      COPY_IDS.hostWrite,
      'Write the run file on the SSH host',
      `printf %s '${copyContent(material.suffix)}' > ${hostPush}`,
      { exit_code: v.writeExit },
    ),
  ]

  const body: WorkflowNode[] = [
    connectDirect(COPY_IDS.connect, 'Connect to the cluster from the host', material.namespace, {
      session: v.session,
      cluster_version: v.version,
    }),
    k8sCopyNode({
      id: COPY_IDS.push,
      description: 'Copy the host file into the pod',
      expressionFields: ['session'],
      values: {
        session: v.session,
        direction: 'to_pod',
        pod: material.pod,
        container: material.container,
        source_path: hostPush,
        target_path: material.podPath,
      },
      outputBindings: { summary: 'push_summary', success: 'push_ok' },
    }),
    k8sExecNode({
      id: COPY_IDS.read,
      description: 'Read the pushed file back out of the pod',
      expressionFields: ['session'],
      values: {
        session: v.session,
        pod: material.pod,
        container: material.container,
        command: `cat ${material.podPath}`,
      },
      outputBindings: {
        stdout: 'read_stdout',
        stderr: 'read_stderr',
        exit_code: 'read_exit',
        success: 'read_ok',
      },
    }),
    k8sCopyNode({
      id: COPY_IDS.pull,
      description: 'Copy the pod file back to the host',
      expressionFields: ['session'],
      values: {
        session: v.session,
        direction: 'from_pod',
        pod: material.pod,
        container: material.container,
        source_path: material.podPath,
        target_path: hostPull,
      },
      outputBindings: { summary: 'pull_summary', success: 'pull_ok' },
    }),
  ]

  const after: WorkflowNode[] = [
    sshHostCommand(
      COPY_IDS.hostVerify,
      'Read the returned file on the SSH host',
      `cat ${hostPull}`,
      { stdout: v.homeStdout, exit_code: v.homeExit },
    ),
    sshHostCommand(
      COPY_IDS.hostClean,
      'Remove the files this run wrote on the host',
      `rm -f ${hostPush} ${hostPull}`,
      { exit_code: v.cleanExit },
    ),
    markerNode({
      id: SHARED_IDS.summary,
      description: 'Summary marker',
      expression:
        `f'${COPY_MARKER} read={read_stdout} home={${v.homeStdout}}` + ` exit={${v.homeExit}}'`,
    }),
  ]

  return remoteWorkflow({
    name: COPY_FIXTURE_NAME,
    material,
    preBody,
    body,
    after,
    bookend: COPY_DONE_MARKER,
    variables,
  })
}

/** KR-12: a Copy naming a WAVE-side scheme inside a Remote body. Never runs. */
export function buildCopySchemeFixture(
  material: RemoteMaterial & { namespace: string; pod: string; container: string },
): Record<string, unknown> {
  const v = SCHEME_VARS
  const variables: Record<string, FixtureVariable> = {
    [v.session]: secretVar(),
    [v.version]: stringVar(),
  }

  const body: WorkflowNode[] = [
    connectDirect(SCHEME_IDS.connect, 'Connect to the cluster from the host', material.namespace, {
      session: v.session,
      cluster_version: v.version,
    }),
    k8sCopyNode({
      id: SCHEME_IDS.copy,
      description: 'Copy naming an artifact path',
      expressionFields: ['session'],
      values: {
        session: v.session,
        direction: 'to_pod',
        pod: material.pod,
        container: material.container,
        source_path: SCHEME_SOURCE_PATH,
        target_path: SCHEME_TARGET_PATH,
      },
      outputBindings: {},
    }),
  ]

  return remoteWorkflow({
    name: SCHEME_FIXTURE_NAME,
    material,
    body,
    after: [],
    bookend: SCHEME_DONE_MARKER,
    variables,
  })
}

// ---------------------------------------------------------------------------
// Shared assertions
// ---------------------------------------------------------------------------

export type SessionVariables = Record<string, { value: unknown; type: string }>
export type WaveTable = { columns: Array<{ name: string; type: string }>; rows: unknown[][] }

/** One K8s object as a map-mode `result` carries it. */
export type K8sObject = {
  metadata?: { name?: string; namespace?: string }
  data?: Record<string, string>
  type?: string
}

export function cell(vars: SessionVariables, name: string): { value: unknown; type: string } {
  const found = vars[name]
  expect(found, `variable "${name}" was never bound`).toBeTruthy()
  return found
}

export const textOf = (vars: SessionVariables, name: string): string =>
  String(cell(vars, name).value)
export const numberOf = (vars: SessionVariables, name: string): number =>
  Number(cell(vars, name).value)
export const objectOf = (vars: SessionVariables, name: string): K8sObject =>
  cell(vars, name).value as K8sObject

/** A bound table: the declared type, the column names, and one cell per column in every row. */
export function tableOf(
  vars: SessionVariables,
  name: string,
  columns: readonly string[],
): WaveTable {
  const found = cell(vars, name)
  expect(found.type, `"${name}" must be a table`).toBe('table')
  const table = found.value as WaveTable
  expect(
    table.columns.map((column) => column.name),
    `"${name}" columns`,
  ).toEqual([...columns])
  for (const cells of table.rows) {
    expect(cells, `every "${name}" row is one cell per column`).toHaveLength(columns.length)
  }
  return table
}

/** The selector of the locus badge a Block inside a container carries (REQ-3.4.1.3). */
const LOCUS_BADGE = '[data-testid="node-remote-locus-badge"]'

/** Every Block inside the container shows exactly one `R` badge; the SSH
 *  Block, the container and the then branch show none; no `L` badge anywhere. */
export async function expectLocusBadges(
  page: Page,
  fixture: Record<string, unknown>,
): Promise<void> {
  const body = remoteBodyIds(fixture)
  const inside = new Set(body)
  for (const id of nodeIds(fixture)) {
    const badges = page.locator(`[data-testid="workflow-node-${id}"] ${LOCUS_BADGE}`)
    if (inside.has(id)) {
      await expect(badges, `${id} runs on the host, so it carries one R badge`).toHaveCount(1)
      await expect(badges).toHaveAttribute('data-locus', 'R')
      await expect(badges).toHaveText('R')
    } else {
      await expect(badges, `${id} is outside the container, so it carries no badge`).toHaveCount(0)
    }
  }
  await expect(page.locator(`${LOCUS_BADGE}[data-locus="L"]`), 'no L badge anywhere').toHaveCount(0)
  await expect(page.locator(LOCUS_BADGE), 'one badge per body member').toHaveCount(body.length)
}

/** A recorded read failure: the core outputs, exactly one WARN line with the
 *  cluster's wording, the Block amber, the run passed. */
export async function expectRecordedRead(
  page: Page,
  vars: SessionVariables,
  names: { ok: string; reason: string; error: string },
  nodeId: string,
  expected: { reason: string; message: string },
): Promise<void> {
  expect(cell(vars, names.ok).value, 'the read must report success false').toBe(false)
  expect(textOf(vars, names.reason), 'the recorded reason').toBe(expected.reason)
  expect(textOf(vars, names.error), 'the recorded error').toBe(expected.message)

  const entries = await getLogEntries(page)
  const warnings = entries.filter((entry) => entry.level === 'WARN').map((entry) => entry.message)
  const line = recordedReadLine(expected.reason, expected.message)
  expect(
    warnings.filter((text) => text === line).length,
    `expected exactly one WARN line: ${line}\n${warnings.join('\n')}`,
  ).toBe(1)

  await expectNodeStatus(page, nodeId, 'warning')
  await expect(page.locator('[data-testid="workflow-status"]')).toHaveAttribute(
    'data-status',
    'passed',
  )
}

/** A recorded miss on a cluster-scoped namespace the run never creates. */
export async function expectRecordedMiss(
  page: Page,
  vars: SessionVariables,
  names: { ok: string; reason: string; error: string },
  nodeId: string,
  suffix: string,
): Promise<void> {
  await expectRecordedRead(page, vars, names, nodeId, {
    reason: 'NotFound',
    message: missingNamespaceMessage(missingNamespaceName(suffix)),
  })
}

/** Every listed Block reads the status its leg declares. */
export async function expectStatuses(
  page: Page,
  fixture: Record<string, unknown>,
  expected: Record<string, string>,
): Promise<void> {
  for (const id of nodeIds(fixture)) {
    await expectNodeStatus(page, id, expected[id] ?? 'success')
  }
}
