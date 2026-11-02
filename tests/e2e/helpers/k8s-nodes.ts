/**
 * Canvas node and edge factories for TypeScript-built fixtures.
 *
 * The shapes match the checked-in fixtures byte for byte
 * (`functional/k8s-connect/fixture-matrix.json`,
 * `functional/http-plugin/rework-fixture.json`), so a built workflow and a
 * hand-authored one import identically.
 */

/** The implicit start node every workflow chain leaves from. */
const START_NODE_ID = 'start-node'

const NODE_DIMS = { width: 120, height: 62 }

export type NodePosition = { x: number; y: number }

export type WorkflowNode = {
  id: string
  type: 'workflowNode'
  position: NodePosition
  data: Record<string, unknown>
  measured: { width: number; height: number }
}

export type WorkflowEdge = {
  id: string
  source: string
  target: string
  sourceHandle?: string
  targetHandle?: string
}

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'

/** The four read Blocks. */
export type K8sReadElementType = 'k8s-get' | 'k8s-events' | 'k8s-logs' | 'k8s-top'

/** The four write Blocks. */
export type K8sWriteElementType = 'k8s-apply' | 'k8s-delete' | 'k8s-scale' | 'k8s-rollout'

/** The three Blocks that ride the pod exec channel. */
export type K8sExecElementType = 'k8s-exec' | 'k8s-script' | 'k8s-copy'

/** The six Helm Blocks. */
export type HelmElementType =
  | 'helm-install'
  | 'helm-upgrade'
  | 'helm-rollback'
  | 'helm-uninstall'
  | 'helm-test'
  | 'helm-status'

const K8S_LABELS: Record<
  | K8sReadElementType
  | K8sWriteElementType
  | K8sExecElementType
  | HelmElementType
  | 'k8s-connect',
  string
> = {
  'k8s-connect': 'K8s Connect',
  'k8s-get': 'K8s Get',
  'k8s-events': 'K8s Events',
  'k8s-logs': 'K8s Logs',
  'k8s-top': 'K8s Top',
  'k8s-apply': 'K8s Apply',
  'k8s-delete': 'K8s Delete',
  'k8s-scale': 'K8s Scale',
  'k8s-rollout': 'K8s Rollout',
  'k8s-exec': 'K8s Exec',
  'k8s-script': 'K8s Script',
  'k8s-copy': 'K8s Copy',
  'helm-install': 'Helm Install',
  'helm-upgrade': 'Helm Upgrade',
  'helm-rollback': 'Helm Rollback',
  'helm-uninstall': 'Helm Uninstall',
  'helm-test': 'Helm Test',
  'helm-status': 'Helm Status',
}

const DEFAULT_POSITION: NodePosition = { x: -75, y: 100 }

export type PluginNodeOptions = {
  id: string
  /** The Block's Name (`data.label`): the engine names the Block by it (EXEC-26). */
  label: string
  elementType: string
  category: string
  /** The Block's Description (`data.description`); no engine line reads it. */
  description?: string
  values?: Record<string, unknown>
  outputBindings?: Record<string, string>
  /** `config.values` keys evaluated as Python expressions. */
  expressionFields?: string[]
  templateFields?: string[]
  /** Present only when passed: `[]` reveals an output that defaults to secret. */
  outputSecretFields?: string[]
  version?: string
  position?: NodePosition
}

/** A plugin Block with any element type, values, bindings and expression fields. */
export function pluginNode(opts: PluginNodeOptions): WorkflowNode {
  const config: Record<string, unknown> = {
    values: opts.values ?? {},
    outputBindings: opts.outputBindings ?? {},
    profileBindings: [],
  }
  if (opts.outputSecretFields) config.outputSecretFields = [...opts.outputSecretFields]
  return {
    id: opts.id,
    type: 'workflowNode',
    position: opts.position ?? { ...DEFAULT_POSITION },
    data: {
      label: opts.label,
      elementType: opts.elementType,
      nodeType: 'plugin',
      category: opts.category,
      version: opts.version ?? '1.0.0',
      description: opts.description ?? '',
      hasNewerVersion: false,
      expressionFields: opts.expressionFields ?? [],
      templateFields: opts.templateFields ?? [],
      config,
    },
    measured: { ...NODE_DIMS },
  }
}

export type K8sConnectNodeOptions = Omit<
  PluginNodeOptions,
  'label' | 'elementType' | 'category'
> & { label?: string }

/** The Connect Block at the head of a chain. */
export function k8sConnectNode(opts: K8sConnectNodeOptions): WorkflowNode {
  return pluginNode({
    ...opts,
    label: opts.label ?? K8S_LABELS['k8s-connect'],
    elementType: 'k8s-connect',
    category: 'kubernetes',
  })
}

export type K8sReadNodeOptions = Omit<
  PluginNodeOptions,
  'label' | 'elementType' | 'category'
> & {
  elementType: K8sReadElementType
  label?: string
}

/** One read Block: Get, Events, Logs or Top. */
export function k8sReadNode(opts: K8sReadNodeOptions): WorkflowNode {
  return pluginNode({
    ...opts,
    label: opts.label ?? K8S_LABELS[opts.elementType],
    elementType: opts.elementType,
    category: 'kubernetes',
  })
}

/** The `config.values` rows every session-riding K8s Block carries, by wire name. */
export type K8sCommonValues = {
  session?: string
  timeout?: number
  namespace?: string
  impersonate_user?: string
  impersonate_groups?: string
  on_error?: 'fail' | 'record'
}

/** The gated core outputs every session-riding K8s Block offers. */
export type K8sCoreBindings = {
  success?: string
  error?: string
  reason?: string
}

type BlockNodeOptions<Values, Bindings> = Omit<
  PluginNodeOptions,
  'label' | 'elementType' | 'category' | 'values' | 'outputBindings'
> & {
  label?: string
  values?: Values
  outputBindings?: Bindings
}

/** K8s Apply `config.values`, by wire name. */
export type K8sApplyValues = K8sCommonValues & {
  define_with?: 'manifest' | 'form'
  manifest?: string
  kind?: 'ConfigMap' | 'Secret' | 'Job'
  name?: string
  /** The ConfigMap form's Data map. It never reaches a Secret. */
  data?: Record<string, unknown>
  /** The Secret form's Data map, the wire name its three descriptors share. */
  secret_data?: Record<string, unknown>
  secret_type?: 'Opaque' | 'kubernetes.io/tls' | 'kubernetes.io/dockerconfigjson'
  job_from?: 'image' | 'cronjob'
  cronjob_name?: string
  image?: string
  command?: string
  if_exists?: 'update' | 'fail'
  /** One value for the wire name both Output Format rows share; `map` is Array in Manifest mode. */
  output_format?: 'map' | 'json' | 'yaml'
}

export type K8sApplyOutputBindings = K8sCoreBindings & {
  summary?: string
  result?: string
  names?: string
  count?: string
}

export type K8sApplyNodeOptions = BlockNodeOptions<K8sApplyValues, K8sApplyOutputBindings>

/** The type Apply declares for `result`, which the bound variable must carry:
 *  text for JSON and YAML, one entry per document for a manifest, else a map. */
export function k8sApplyResultType(values: K8sApplyValues): 'map' | 'array' | 'string' {
  const format = values.output_format ?? 'map'
  if (format === 'json' || format === 'yaml') return 'string'
  return (values.define_with ?? 'manifest') === 'manifest' ? 'array' : 'map'
}

/** The Apply Block. Bind `result` to a variable of `k8sApplyResultType(values)`. */
export function k8sApplyNode(opts: K8sApplyNodeOptions): WorkflowNode {
  return pluginNode({
    ...opts,
    label: opts.label ?? K8S_LABELS['k8s-apply'],
    elementType: 'k8s-apply',
    category: 'kubernetes',
  })
}

/** K8s Delete `config.values`, by wire name. */
export type K8sDeleteValues = K8sCommonValues & {
  resource_type?: 'default' | 'custom'
  /** Any kind the cluster serves; the picker's catalog is not a wire constraint. */
  kind?: string
  kind_custom?: string
  delete_by?: 'name' | 'selector'
  name?: string
  label_selector?: string
  ignore_not_found?: boolean
  cascade?: 'background' | 'foreground' | 'orphan'
  grace_period_seconds?: number
  wait_until_gone?: boolean
}

export type K8sDeleteOutputBindings = K8sCoreBindings & {
  summary?: string
  names?: string
  count?: string
}

export type K8sDeleteNodeOptions = BlockNodeOptions<K8sDeleteValues, K8sDeleteOutputBindings>

/** The Delete Block. */
export function k8sDeleteNode(opts: K8sDeleteNodeOptions): WorkflowNode {
  return pluginNode({
    ...opts,
    label: opts.label ?? K8S_LABELS['k8s-delete'],
    elementType: 'k8s-delete',
    category: 'kubernetes',
  })
}

/** K8s Scale `config.values`, by wire name. */
export type K8sScaleValues = K8sCommonValues & {
  resource_type?: 'default' | 'custom'
  kind?: 'Deployment' | 'ReplicaSet' | 'ReplicationController' | 'StatefulSet'
  kind_custom?: string
  name?: string
  replicas?: number
}

export type K8sScaleOutputBindings = K8sCoreBindings & {
  summary?: string
}

export type K8sScaleNodeOptions = BlockNodeOptions<K8sScaleValues, K8sScaleOutputBindings>

/** The Scale Block. */
export function k8sScaleNode(opts: K8sScaleNodeOptions): WorkflowNode {
  return pluginNode({
    ...opts,
    label: opts.label ?? K8S_LABELS['k8s-scale'],
    elementType: 'k8s-scale',
    category: 'kubernetes',
  })
}

/** K8s Rollout `config.values`, by wire name. */
export type K8sRolloutValues = K8sCommonValues & {
  operation?: 'restart' | 'status' | 'undo'
  kind?: 'Deployment' | 'StatefulSet' | 'DaemonSet'
  name?: string
  to_revision?: number
}

export type K8sRolloutOutputBindings = K8sCoreBindings & {
  summary?: string
  /** Offered only while `operation` is `status`. */
  status?: string
}

export type K8sRolloutNodeOptions = BlockNodeOptions<K8sRolloutValues, K8sRolloutOutputBindings>

/** The Rollout Block. */
export function k8sRolloutNode(opts: K8sRolloutNodeOptions): WorkflowNode {
  return pluginNode({
    ...opts,
    label: opts.label ?? K8S_LABELS['k8s-rollout'],
    elementType: 'k8s-rollout',
    category: 'kubernetes',
  })
}

/** K8s Exec `config.values`, by wire name. */
export type K8sExecValues = K8sCommonValues & {
  pod?: string
  container?: string
  /** One command line, split shell-style by the Block. */
  command?: string
}

/** The stream outputs K8s Exec and K8s Script share. */
export type K8sStreamOutputBindings = K8sCoreBindings & {
  stdout?: string
  stderr?: string
  exit_code?: string
}

export type K8sExecNodeOptions = BlockNodeOptions<K8sExecValues, K8sStreamOutputBindings>

/** The Exec Block. */
export function k8sExecNode(opts: K8sExecNodeOptions): WorkflowNode {
  return pluginNode({
    ...opts,
    label: opts.label ?? K8S_LABELS['k8s-exec'],
    elementType: 'k8s-exec',
    category: 'kubernetes',
  })
}

/** K8s Script `config.values`, by wire name. */
export type K8sScriptValues = K8sCommonValues & {
  pod?: string
  container?: string
  /** Invoked bare, never with -c; may carry flags. */
  interpreter?: string
  /** Fed to the interpreter on standard input. */
  script?: string
}

export type K8sScriptNodeOptions = BlockNodeOptions<K8sScriptValues, K8sStreamOutputBindings>

/** The Script Block. */
export function k8sScriptNode(opts: K8sScriptNodeOptions): WorkflowNode {
  return pluginNode({
    ...opts,
    label: opts.label ?? K8S_LABELS['k8s-script'],
    elementType: 'k8s-script',
    category: 'kubernetes',
  })
}

/** K8s Copy `config.values`, by wire name. `source_path` and `target_path` are
 *  one wire name each; which side of the copy they name follows `direction`. */
export type K8sCopyValues = K8sCommonValues & {
  direction?: 'from_pod' | 'to_pod'
  pod?: string
  container?: string
  source_path?: string
  target_path?: string
  no_preserve?: boolean
}

export type K8sCopyOutputBindings = K8sCoreBindings & {
  summary?: string
}

export type K8sCopyNodeOptions = BlockNodeOptions<K8sCopyValues, K8sCopyOutputBindings>

/** The Copy Block. */
export function k8sCopyNode(opts: K8sCopyNodeOptions): WorkflowNode {
  return pluginNode({
    ...opts,
    label: opts.label ?? K8S_LABELS['k8s-copy'],
    elementType: 'k8s-copy',
    category: 'kubernetes',
  })
}

/** The `config.values` rows every Helm Block carries, by wire name. */
export type HelmCommonValues = {
  session?: string
  timeout?: number
  namespace?: string
  /** The executable to run: a PATH name or a path (relative starts at the home folder); empty runs `helm` from the PATH. */
  helm_path?: string
  impersonate_user?: string
  impersonate_groups?: string
  on_error?: 'fail' | 'record'
}

/** The shape Output Format asks Result for. */
export type HelmOutputFormat = 'table' | 'map' | 'json' | 'yaml'

/** The chart source and the chart-repository credentials Install and Upgrade share. */
export type HelmChartValues = HelmCommonValues & {
  release?: string
  chart?: string
  version?: string
  repo?: string
  /** Values YAML, written to a file and passed as --values. */
  values?: string
  /** One --set key=value per entry. */
  set?: Record<string, unknown>
  output_format?: HelmOutputFormat
  repo_username?: string
  repo_password?: string
  repo_ca_cert?: string
  repo_verify_ssl?: boolean
}

/** Helm Install `config.values`, by wire name. */
export type HelmInstallValues = HelmChartValues & {
  create_namespace?: boolean
  atomic?: boolean
  /** Offered only while Atomic is ticked; adds to Timeout to form the bound. */
  cleanup_timeout?: number
}

/** Helm Upgrade `config.values`, by wire name. */
export type HelmUpgradeValues = HelmChartValues & {
  install?: boolean
  /** Never emitted beside `reset_values`: the two share one slot. */
  reuse_values?: boolean
  reset_values?: boolean
  create_namespace?: boolean
  atomic?: boolean
  cleanup_on_fail?: boolean
  /** Offered only while Atomic or Cleanup on Fail is ticked; adds to Timeout. */
  cleanup_timeout?: number
}

/** Helm Rollback `config.values`, by wire name. */
export type HelmRollbackValues = HelmCommonValues & {
  release?: string
  /** Empty rolls back to the revision before the current one. */
  revision?: number
  output_format?: HelmOutputFormat
  cleanup_on_fail?: boolean
  /** Offered only while Cleanup on Fail is ticked; adds to Timeout. */
  cleanup_timeout?: number
}

/** Helm Uninstall `config.values`, by wire name. */
export type HelmUninstallValues = HelmCommonValues & {
  release?: string
  keep_history?: boolean
  ignore_not_found?: boolean
  cascade?: 'background' | 'foreground' | 'orphan'
}

/** Helm Test `config.values`, by wire name. */
export type HelmTestValues = HelmCommonValues & {
  release?: string
  logs?: boolean
  output_format?: HelmOutputFormat
}

/** Helm Status `config.values`, by wire name. */
export type HelmStatusValues = HelmCommonValues & {
  release?: string
  revision?: number
  output_format?: HelmOutputFormat
}

/** Result, Status and the gated core: what a release-shaped Block offers. */
export type HelmReleaseOutputBindings = K8sCoreBindings & {
  result?: string
  status?: string
}

/** Uninstall offers the core alone: helm prints no document for it. */
export type HelmCoreOutputBindings = K8sCoreBindings

/** Test offers Result and the gated Logs, and no Status. */
export type HelmTestOutputBindings = K8sCoreBindings & {
  result?: string
  logs?: string
}

/** The type Result declares, which the bound variable must carry: the one-row
 *  table by default, the release document for Map, text for JSON and YAML. */
export function helmResultType(
  format: HelmOutputFormat | undefined,
): 'table' | 'map' | 'string' {
  if (format === 'map') return 'map'
  if (format === 'json' || format === 'yaml') return 'string'
  return 'table'
}

export type HelmInstallNodeOptions = BlockNodeOptions<
  HelmInstallValues,
  HelmReleaseOutputBindings
>

/** The Helm Install Block. Bind `result` to a variable of `helmResultType(output_format)`. */
export function helmInstallNode(opts: HelmInstallNodeOptions): WorkflowNode {
  return pluginNode({
    ...opts,
    label: opts.label ?? K8S_LABELS['helm-install'],
    elementType: 'helm-install',
    category: 'helm',
  })
}

export type HelmUpgradeNodeOptions = BlockNodeOptions<
  HelmUpgradeValues,
  HelmReleaseOutputBindings
>

/** The Helm Upgrade Block. */
export function helmUpgradeNode(opts: HelmUpgradeNodeOptions): WorkflowNode {
  return pluginNode({
    ...opts,
    label: opts.label ?? K8S_LABELS['helm-upgrade'],
    elementType: 'helm-upgrade',
    category: 'helm',
  })
}

export type HelmRollbackNodeOptions = BlockNodeOptions<
  HelmRollbackValues,
  HelmReleaseOutputBindings
>

/** The Helm Rollback Block. */
export function helmRollbackNode(opts: HelmRollbackNodeOptions): WorkflowNode {
  return pluginNode({
    ...opts,
    label: opts.label ?? K8S_LABELS['helm-rollback'],
    elementType: 'helm-rollback',
    category: 'helm',
  })
}

export type HelmUninstallNodeOptions = BlockNodeOptions<
  HelmUninstallValues,
  HelmCoreOutputBindings
>

/** The Helm Uninstall Block. */
export function helmUninstallNode(opts: HelmUninstallNodeOptions): WorkflowNode {
  return pluginNode({
    ...opts,
    label: opts.label ?? K8S_LABELS['helm-uninstall'],
    elementType: 'helm-uninstall',
    category: 'helm',
  })
}

export type HelmTestNodeOptions = BlockNodeOptions<HelmTestValues, HelmTestOutputBindings>

/** The Helm Test Block. */
export function helmTestNode(opts: HelmTestNodeOptions): WorkflowNode {
  return pluginNode({
    ...opts,
    label: opts.label ?? K8S_LABELS['helm-test'],
    elementType: 'helm-test',
    category: 'helm',
  })
}

export type HelmStatusNodeOptions = BlockNodeOptions<
  HelmStatusValues,
  HelmReleaseOutputBindings
>

/** The Helm Status Block. */
export function helmStatusNode(opts: HelmStatusNodeOptions): WorkflowNode {
  return pluginNode({
    ...opts,
    label: opts.label ?? K8S_LABELS['helm-status'],
    elementType: 'helm-status',
    category: 'helm',
  })
}

/** SSH Session Open `config.values`, by wire name. */
export type SshSessionOpenValues = {
  host?: string
  port?: number
  username?: string
  password?: string
  private_key?: string
  passphrase?: string
  host_key_verification?: 'strict' | 'accept-new' | 'disabled'
  connect_timeout?: number
}

export type SshSessionOpenOutputBindings = {
  session_id?: string
  connected?: string
  server_banner?: string
  hop_count?: string
}

export type SshSessionOpenNodeOptions = BlockNodeOptions<
  SshSessionOpenValues,
  SshSessionOpenOutputBindings
>

/** The SSH Session Open Block: the session a tunnel or a Remote Execution rides. */
export function sshSessionOpenNode(opts: SshSessionOpenNodeOptions): WorkflowNode {
  return pluginNode({
    ...opts,
    label: opts.label ?? 'SSH Session Open',
    elementType: 'ssh-session-open',
    category: 'remote',
  })
}

/** SSH Session Exec `config.values`, by wire name. */
export type SshSessionExecValues = {
  session_id?: string
  command?: string
  timeout?: number
}

/** The outputs SSH Session Exec offers; a non-zero exit is returned, not raised. */
export type SshSessionExecOutputBindings = {
  stdout?: string
  stderr?: string
  exit_code?: string
}

export type SshSessionExecNodeOptions = BlockNodeOptions<
  SshSessionExecValues,
  SshSessionExecOutputBindings
>

/** The SSH Session Exec Block: one command on a live session, run from WAVE. */
export function sshSessionExecNode(opts: SshSessionExecNodeOptions): WorkflowNode {
  return pluginNode({
    ...opts,
    label: opts.label ?? 'SSH Session Exec',
    elementType: 'ssh-session-exec',
    category: 'remote',
  })
}

/** Remote Execution `config.values`, by wire name. */
export type RemoteExecutionValues = {
  session_id?: string
}

export type RemoteExecutionOutputBindings = {
  remote_session_id?: string
}

export type RemoteExecutionNodeOptions = BlockNodeOptions<
  RemoteExecutionValues,
  RemoteExecutionOutputBindings
>

/** The Remote Execution container. Its body and then legs are wired with `handleEdge`. */
export function remoteExecutionNode(opts: RemoteExecutionNodeOptions): WorkflowNode {
  return pluginNode({
    ...opts,
    label: opts.label ?? 'Remote Execution',
    elementType: 'remote-execution',
    category: 'remote',
  })
}

/** Quote plain text as a Python string literal, for an expression field. */
export function literal(text: string): string {
  return `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

export type MarkerNodeOptions = {
  id: string
  description: string
  level?: LogLevel
  position?: NodePosition
} & ({ text: string; expression?: never } | { expression: string; text?: never })

/** A Log Block stamping a run marker. `text` is quoted for you; `expression`
 *  is passed through so a marker can carry an f-string. */
export function markerNode(opts: MarkerNodeOptions): WorkflowNode {
  const message = opts.expression === undefined ? literal(opts.text) : opts.expression
  return pluginNode({
    id: opts.id,
    label: 'Log',
    elementType: 'log',
    category: 'system',
    description: opts.description,
    expressionFields: ['message'],
    values: { message, level: opts.level ?? 'INFO' },
    position: opts.position,
  })
}

export type DelayNodeOptions = {
  id: string
  description: string
  durationMs: number
  position?: NodePosition
}

/** A Delay control Block - the hold that lets a WS collector subscribe. */
export function delayNode(opts: DelayNodeOptions): WorkflowNode {
  return {
    id: opts.id,
    type: 'workflowNode',
    position: opts.position ?? { ...DEFAULT_POSITION },
    data: {
      label: 'Delay',
      elementType: 'delay',
      nodeType: 'control',
      category: 'timing',
      version: '1.0.0',
      description: opts.description,
      hasNewerVersion: false,
      expressionFields: [],
      templateFields: [],
      config: {
        values: { duration: opts.durationMs },
        outputBindings: {},
        profileBindings: [],
      },
    },
    measured: { ...NODE_DIMS },
  }
}

export type TryCatchNodeOptions = {
  id: string
  description: string
  /** Variable the caught error map binds to. */
  errorBinding?: string
  enableCatch?: boolean
  enableFinally?: boolean
  position?: NodePosition
}

/** A Try/Catch control Block. Its legs are wired with `handleEdge`. */
export function tryCatchNode(opts: TryCatchNodeOptions): WorkflowNode {
  const outputBindings: Record<string, string> = {}
  if (opts.errorBinding) outputBindings.error = opts.errorBinding
  return {
    id: opts.id,
    type: 'workflowNode',
    position: opts.position ?? { ...DEFAULT_POSITION },
    data: {
      label: 'Try/Catch',
      elementType: 'try-catch-finally',
      nodeType: 'control',
      category: 'flow',
      version: '1.0.0',
      description: opts.description,
      hasNewerVersion: false,
      expressionFields: [],
      templateFields: [],
      variableExpressionKeys: [],
      config: {
        values: {
          enable_catch: opts.enableCatch ?? true,
          enable_finally: opts.enableFinally ?? false,
        },
        outputBindings,
        profileBindings: [],
      },
    },
    measured: { ...NODE_DIMS },
  }
}

/** One lane of a Parallel section. `timeLimitMs` caps that lane alone. */
export type ParallelBranch = {
  id: string
  name: string
  timeLimitMs?: number
}

export type ParallelNodeOptions = {
  id: string
  description: string
  branches: readonly ParallelBranch[]
  join?: 'all' | 'first'
  /** Cap on the whole section, in milliseconds. */
  timeLimitMs?: number
  position?: NodePosition
}

/** A Parallel control Block. Its lanes and exit are wired with `handleEdge`. */
export function parallelNode(opts: ParallelNodeOptions): WorkflowNode {
  const values: Record<string, unknown> = {
    branches: opts.branches.map((branch) => {
      const entry: Record<string, unknown> = { id: branch.id, name: branch.name }
      if (branch.timeLimitMs !== undefined) entry.time_limit = branch.timeLimitMs
      return entry
    }),
    join: opts.join ?? 'all',
  }
  if (opts.timeLimitMs !== undefined) values.time_limit = opts.timeLimitMs
  return {
    id: opts.id,
    type: 'workflowNode',
    position: opts.position ?? { ...DEFAULT_POSITION },
    data: {
      label: 'Parallel',
      elementType: 'parallel',
      nodeType: 'control',
      category: 'flow',
      version: '1.0.0',
      description: opts.description,
      hasNewerVersion: false,
      expressionFields: [],
      templateFields: [],
      variableExpressionKeys: [],
      config: { values, outputBindings: {}, profileBindings: [] },
    },
    measured: { ...NODE_DIMS },
  }
}

export type ControlNodeOptions = {
  id: string
  /** The Block's Name (`data.label`): the engine names the Block by it (EXEC-26). */
  label: string
  elementType: string
  category: string
  description: string
  values: Record<string, unknown>
  outputBindings?: Record<string, string>
  expressionFields?: string[]
  /** Variable Setter rows whose values are Python expressions. */
  variableExpressionKeys?: string[]
  disabled?: boolean
  position?: NodePosition
}

/** Any control Block (If/Else, Switch, Assert, loops, Wait Until, Variable Setter, Halt, Break, Continue). */
export function controlNode(opts: ControlNodeOptions): WorkflowNode {
  const data: Record<string, unknown> = {
    label: opts.label,
    elementType: opts.elementType,
    nodeType: 'control',
    category: opts.category,
    version: '1.0.0',
    description: opts.description,
    hasNewerVersion: false,
    expressionFields: opts.expressionFields ?? [],
    templateFields: [],
    variableExpressionKeys: opts.variableExpressionKeys ?? [],
    config: {
      values: opts.values,
      outputBindings: opts.outputBindings ?? {},
      profileBindings: [],
    },
  }
  if (opts.disabled) data.disabled = true
  return {
    id: opts.id,
    type: 'workflowNode',
    position: opts.position ?? { ...DEFAULT_POSITION },
    data,
    measured: { ...NODE_DIMS },
  }
}

/** The branch handles a container Block emits (paths, branches, bodies, split legs, the retry lane). */
export type BranchHandle =
  | 'try'
  | 'catch'
  | 'finally'
  | 'then'
  | 'body'
  | 'retry'
  | 'pass'
  | 'fail'
  | `branch_${number}`

/** A plain edge between two Blocks. */
export function edge(source: string, target: string): WorkflowEdge {
  return { id: `edge-${source}-${target}`, source, target }
}

/** An edge leaving a named branch handle. */
export function handleEdge(
  source: string,
  handle: BranchHandle,
  target: string,
): WorkflowEdge {
  return { id: `edge-${source}-${handle}`, source, target, sourceHandle: handle }
}

/** Wire `start-node` -> ids[0] -> ids[1] -> ... in order. */
export function chainEdges(ids: readonly string[]): WorkflowEdge[] {
  if (ids.length === 0) return []
  const edges: WorkflowEdge[] = [
    { id: `edge-start-${ids[0]}`, source: START_NODE_ID, target: ids[0] },
  ]
  for (let i = 1; i < ids.length; i++) edges.push(edge(ids[i - 1], ids[i]))
  return edges
}

export type StackOptions = { x?: number; startY?: number; step?: number }

/** Lay nodes out in one readable column, in array order. */
export function stackNodes(
  nodes: readonly WorkflowNode[],
  opts: StackOptions = {},
): WorkflowNode[] {
  const x = opts.x ?? DEFAULT_POSITION.x
  const startY = opts.startY ?? DEFAULT_POSITION.y
  const step = opts.step ?? 70
  return nodes.map((node, index) => ({
    ...node,
    position: { x, y: startY + index * step },
  }))
}
