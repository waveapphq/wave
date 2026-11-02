/**
 * The K8s exec-channel suite's case tables, its fixture builder and the
 * assertions the three exec specs share.
 *
 * The table IS the checklist. Each leg names the `KE-` ids it proves (the id
 * matrix is in the suite README), the exact Block values, and how its outputs
 * are bound. The spec builds one chained workflow per proof from these tables
 * with the shared node factories; `fixture-exec-golden.json` pins the emitted
 * node shape so the generated form stays reviewable against a hand-authored
 * one.
 *
 * Every positive leg binds EVERY output its Block declares, not just the
 * headline one: Exec and Script bind stdout, stderr, exit_code and success,
 * Copy binds summary and success, and a leg running under Record and continue
 * adds error and reason.
 */

import { expect, type Page } from '../../helpers/playwright-fixtures'
import { type LogEntry } from '../../helpers/log-reader'
import { expectNodeStatus, getNodeStatuses } from '../../helpers/k8s-run'
import {
  edge,
  k8sConnectNode,
  k8sCopyNode,
  k8sExecNode,
  k8sScriptNode,
  markerNode,
  pluginNode,
  stackNodes,
  type K8sCopyValues,
  type K8sExecValues,
  type K8sScriptValues,
  type WorkflowEdge,
  type WorkflowNode,
} from '../../helpers/k8s-nodes'
import { SEEDED } from '../../helpers/k8s-seed'
import {
  BACKEND_URL,
  HTTP_FIXTURE_HOST_SENTINEL,
  K8S_API_PORT,
} from '../../helpers/config'

/** The fixture-side API URL. `injectHttp` rewrites it in container-shard mode. */
export const K8S_API_URL = `https://${HTTP_FIXTURE_HOST_SENTINEL}:${K8S_API_PORT}`

/** The implicit node every chain leaves from. */
const START_NODE_ID = 'start-node'

/** `DESCRIPTION_TOO_LONG` fires above this, on save and on run alike. */
export const MAX_BLOCK_NAME = 64

/** A Block's Name holds at most this many characters. */
const MAX_NAME = 32

const SESSION_VARIABLE = 'sess_admin'
const TOKEN_VARIABLE = 'k8s_admin_token'
const CA_VARIABLE = 'k8s_ca'

// ---------------------------------------------------------------------------
// The cluster's exec fixture
// ---------------------------------------------------------------------------

/** The two pod names the checked-in ClusterExec doc grants exec to. */
export const EXEC_POD = SEEDED.podExec
export const EXEC_POD_B = SEEDED.podExecB
/** A pod the cluster serves no exec for, seeded so the refusal is the cluster's. */
export const NO_EXEC_POD = SEEDED.podNoExec
/** A pod name nothing ever creates, so the apiserver answers NotFound. */
export const ABSENT_POD = 'wave-pod-absent'

export const CONTAINER_APP = SEEDED.containerApp
export const CONTAINER_SIDECAR = SEEDED.containerSidecar

/** The working directory kwok chdirs into, per container name. */
export const WORK_DIR = {
  [CONTAINER_APP]: '/wave/exec/app',
  [CONTAINER_SIDECAR]: '/wave/exec/sidecar',
} as const

/** The value the ClusterExec doc puts in the environment, per container name. */
export const EXEC_TARGET = {
  [CONTAINER_APP]: 'app-container',
  [CONTAINER_SIDECAR]: 'sidecar-container',
} as const

/** The run-specific names the legs need. kwok runs every exec as a real process
 *  on the ONE kwok container filesystem, shared by every parallel shard, so
 *  every pod-side path the suite writes carries the run suffix. */
export interface ExecContext {
  namespace: string
  suffix: string
}

/** A pod-side path inside the `app` container's working directory. */
export const podFile = (ctx: ExecContext, name: string): string =>
  `${WORK_DIR[CONTAINER_APP]}/${ctx.suffix}-${name}`

/** The directory the whole-directory pull takes. */
export const podDir = (ctx: ExecContext): string => podFile(ctx, 'dir')

/** The path the session artifacts API lists a pulled or staged file under. */
export const artifactPath = (ctx: ExecContext, name: string): string => `${ctx.suffix}-${name}`

/** The same path as the scheme a Block writes. */
export const artifactRef = (ctx: ExecContext, name: string): string =>
  `artifact://${artifactPath(ctx, name)}`

/** The file the pull takes out of the pod, and what it holds. */
export const PULL_FILE = 'pull.txt'
export const pullContent = (ctx: ExecContext): string => `k8s-copy-pull-${ctx.suffix}`

/** The file the push sends into the pod, and what it holds. */
export const PUSH_FILE = 'push.txt'
export const pushContent = (ctx: ExecContext): string => `k8s-copy-push-${ctx.suffix}`

/** A source path the pod does not hold, for the recorded Copy failure. */
export const ABSENT_FILE = 'absent.txt'

/** The directory pull's files, name and content. The row count is the file count. */
export const DIR_FILES: ReadonlyArray<readonly [string, string]> = [
  ['a.txt', 'aaa'],
  ['b.txt', 'bbbb'],
  ['c.txt', 'ccccc'],
]

/** The limit rows the fixture carries on the limit pulls: the Block's own defaults. */
export const FIXTURE_MAX_SIZE_MIB = 256
export const FIXTURE_MAX_FILES = 10000

/** What the sheets type over them (KE-19, KE-20). */
export const TYPED_MAX_SIZE_MIB = 1
export const TYPED_MAX_FILES = 2

/** The size pull's files: the first fits under 1 MiB, the two together do not. */
export const BIG_FILES = ['big-1.bin', 'big-2.bin'] as const
export const BIG_FILE_SIZE = 700_000

/** What an earlier pull lands at the paths the size pull's files land at. */
export const priorContent = (ctx: ExecContext, name: string): string =>
  `prior-${name}-${ctx.suffix}`

/** The artifact folders the two limit pulls name. */
export const LIMIT_SIZE_ARTIFACT = 'limit-size'
export const LIMIT_FILES_ARTIFACT = 'limit-files'

/** The name a pull gives a file it keeps aside while it overwrites it. */
export const KEEP_NAME = /(^|\/)\.[^/]+\.[0-9a-f]{8}\.keep$/

// ---------------------------------------------------------------------------
// Legs
// ---------------------------------------------------------------------------

type LegBase = {
  /** Short key: the node is `<block>-<key>`, its variables are `<key>_*`. */
  key: string
  /** The `KE-` ids this leg proves. */
  ids: readonly string[]
  /** What the leg is, for the marker and the Block's Description. */
  what: string
  /** The Block's own Name, for a leg whose engine line a spec reads (EXEC-26). */
  name?: string
  /** The Block records its failure instead of raising: it binds error and
   *  reason too, and is expected to paint amber. */
  records?: boolean
  /** Overrides the marker expression. */
  marker?: string
}

/** K8s Copy values plus the two From Pod limit rows (K8SEXEC-10). */
export type K8sCopyLimitValues = K8sCopyValues & { max_size_mib?: number; max_files?: number }

export type ExecLeg =
  | (LegBase & { block: 'exec'; values: K8sExecValues })
  | (LegBase & { block: 'script'; values: K8sScriptValues })
  | (LegBase & { block: 'copy'; values: K8sCopyLimitValues })
  | (LegBase & { block: 'file'; values: Record<string, unknown> })

/** The node id the spec addresses a leg's Block by. */
export const nodeId = (leg: ExecLeg): string => `${leg.block}-${leg.key}`

export const stdoutVar = (key: string): string => `${key}_stdout`
export const stderrVar = (key: string): string => `${key}_stderr`
export const exitVar = (key: string): string => `${key}_exit`
export const okVar = (key: string): string => `${key}_ok`
export const errorVar = (key: string): string => `${key}_error`
export const reasonVar = (key: string): string => `${key}_reason`
export const summaryVar = (key: string): string => `${key}_summary`

/** The marker one leg writes, so a failure names the row it broke. */
export function legMarker(leg: ExecLeg): string {
  return `[${leg.ids.join('|')}]`
}

/** The unique head of one leg's console line: its ids and its key. */
export function markerLine(leg: ExecLeg): string {
  return `${legMarker(leg)} ${leg.key}`
}

/** A leg's Description: it is capped, so the ids ride the marker line and the
 *  Description carries the leg key. */
export function blockName(leg: ExecLeg): string {
  const name = `${leg.key}: ${leg.what}`
  if (name.length > MAX_BLOCK_NAME) {
    throw new Error(`leg "${leg.key}" needs a shorter what: ${name.length} > ${MAX_BLOCK_NAME}`)
  }
  return name
}

/** The Name the engine calls a leg's Block by (EXEC-26). */
export function legName(leg: ExecLeg): string {
  if (!leg.name) throw new Error(`leg "${leg.key}" needs a name: an engine line names its Block`)
  if (leg.name.length > MAX_NAME) {
    throw new Error(`leg "${leg.key}" needs a shorter name: ${leg.name.length} > ${MAX_NAME}`)
  }
  return leg.name
}

/** The head of the ERROR line a Block that RAISES writes to the console. */
export const blockFailedPrefix = (leg: ExecLeg): string => `Block '${legName(leg)}' failed:`

/** That whole line, with the sentence the Block raised. */
export const blockFailedLine = (leg: ExecLeg, message: string): string =>
  `${blockFailedPrefix(leg)} ${message}`

// ---------------------------------------------------------------------------
// Commands and scripts
// ---------------------------------------------------------------------------

/** One `sh -c` command line. The body is quoted so the whole script reaches
 *  the interpreter as a single argument after the Block's shell-style split. */
export const shellCommand = (body: string): string => `sh -c "${body}"`

/** Write a file in the pod. No content here ever carries a quote. */
export const writeFileBody = (path: string, content: string): string =>
  `printf %s '${content}' > ${path}`

/** The command that reports which container's working directory it landed in. */
export const WHERE_AM_I = shellCommand('pwd; echo $WAVE_EXEC_TARGET')

/** What `WHERE_AM_I` writes to standard output in a given container. */
export const whereAmIOutput = (container: keyof typeof WORK_DIR): string =>
  `${WORK_DIR[container]}\n${EXEC_TARGET[container]}\n`

/** The multi-line body a `/bin/sh` interpreter reads to EOF and then exits. */
export const SHELL_SCRIPT = ['echo shell-out', 'echo shell-err 1>&2', ''].join('\n')

/** A body a shell could not run: a generator expression and a keyword argument. */
export const PYTHON_SCRIPT = [
  'import sys',
  '',
  'print(sum(int(part) for part in "4 5 6".split()))',
  'print("py-stderr", file=sys.stderr)',
  '',
].join('\n')

/** A script that writes both streams and then exits non-zero. */
export const EXIT_SCRIPT = ['echo before-exit', 'echo after-exit 1>&2', 'exit 5', ''].join('\n')

/** What each script body writes, and the code the last one ends on. */
export const SHELL_SCRIPT_STDOUT = 'shell-out\n'
export const SHELL_SCRIPT_STDERR = 'shell-err\n'
export const PYTHON_SCRIPT_STDOUT = '15\n'
export const PYTHON_SCRIPT_STDERR = 'py-stderr\n'
export const EXIT_SCRIPT_STDOUT = 'before-exit\n'
export const EXIT_SCRIPT_STDERR = 'after-exit\n'
export const EXIT_SCRIPT_EXIT = 5

// ---------------------------------------------------------------------------
// Console lines and cluster wordings
// ---------------------------------------------------------------------------

/** The locus clause every exec-channel failure row carries (`PodExec.where`). */
export const where = (pod: string, container: string, namespace: string): string =>
  `pod '${pod}' (container '${container}') in namespace '${namespace}'`

export const execRefused = (locus: string, detail: string): string =>
  `Could not run the command in ${locus}: ${detail}`

export const scriptRefused = (locus: string, detail: string): string =>
  `Could not run the script in ${locus}: ${detail}`

export const copyRefused = (way: 'from' | 'to', locus: string, detail: string): string =>
  `Could not copy ${way} ${locus}: ${detail}`

/** The refusal of a pull that goes over its Max size (MiB) (K8SEXEC-10). */
export const overSizeDetail = (maxSizeMib: number): string =>
  `the copy is larger than the ${maxSizeMib} MiB Max size (MiB) allows; copy a narrower path or raise Max size (MiB)`

/** The refusal of a pull that goes over its Max files (K8SEXEC-10). */
export const overFilesDetail = (maxFiles: number): string =>
  `the copy holds more files than the ${maxFiles} Max files allows; copy fewer files or raise Max files`

export const TOO_LARGE_REASON = 'ArchiveTooLarge'
export const TOO_MANY_REASON = 'ArchiveTooManyEntries'

/** The apiserver's own sentence for a pod that is not there. */
export const podNotFound = (pod: string): string => `pods "${pod}" not found`

/** The reason the cluster gives for a pod its exec fixture does not cover. The
 *  MESSAGE differs between the v4 and v5 transports, so nothing asserts it. */
export const NO_EXEC_REASON = 'InternalError'

/** K8s Exec's own INFO line. */
export const ranCommandLine = (pod: string, exitCode: number): string =>
  `Ran the command in pod '${pod}': exit code ${exitCode}`

/** K8s Script's own INFO line. */
export const ranScriptLine = (pod: string, exitCode: number): string =>
  `Ran the script in pod '${pod}': exit code ${exitCode}`

/** K8s Copy's own INFO line. */
export const copiedLine = (from: string, to: string): string => `Copied ${from} to ${to}`

/** The word each Block puts at the head of a recorded WARN line. */
export type ExecAction = 'Exec' | 'Script' | 'Copy'

/** The WARN line a recorded failure writes (`verbs/_outputs._recorded_failure_line`). */
export function recordedLine(action: ExecAction, reason: string, message: string): string {
  return reason ? `${action} failed (${reason}): ${message}` : `${action} failed: ${message}`
}

// ---------------------------------------------------------------------------
// Case tables
// ---------------------------------------------------------------------------

const execBase = (pod: string, container: string): K8sExecValues => ({ pod, container })

/** KE-01, KE-02: the leg the checked-in golden fixture holds. */
export function goldenLegs(): ExecLeg[] {
  return [
    {
      key: 'golden',
      ids: ['KE-01', 'KE-02'],
      what: 'a busybox command that exits 0',
      block: 'exec',
      values: {
        ...execBase(EXEC_POD, CONTAINER_APP),
        command: shellCommand('echo golden-ok'),
      },
    },
  ]
}

export const GOLDEN_STDOUT = 'golden-ok\n'

/** KE-03 to KE-07: both streams, per-container targeting, a non-zero exit and
 *  the shell-style split. */
export function commandLegs(): ExecLeg[] {
  return [
    {
      key: 'streams',
      ids: ['KE-03'],
      what: 'writes stdout and stderr, exits 0',
      block: 'exec',
      values: {
        ...execBase(EXEC_POD, CONTAINER_APP),
        command: shellCommand('echo out-line; echo err-line 1>&2'),
      },
    },
    {
      key: 'inapp',
      ids: ['KE-04'],
      what: 'the same command in the app container',
      block: 'exec',
      values: { ...execBase(EXEC_POD, CONTAINER_APP), command: WHERE_AM_I },
    },
    {
      key: 'insidecar',
      ids: ['KE-05'],
      what: 'the same command in the sidecar container',
      block: 'exec',
      values: { ...execBase(EXEC_POD, CONTAINER_SIDECAR), command: WHERE_AM_I },
    },
    {
      key: 'nonzero',
      ids: ['KE-06'],
      what: 'a command that exits 7',
      block: 'exec',
      values: {
        ...execBase(EXEC_POD, CONTAINER_APP),
        command: shellCommand('echo before-exit; echo after-exit 1>&2; exit 7'),
      },
    },
    {
      key: 'quoted',
      ids: ['KE-07'],
      what: 'a quoted argument holding a space',
      block: 'exec',
      values: {
        ...execBase(EXEC_POD, CONTAINER_APP),
        command: 'printf "[%s]" "one two" three',
      },
    },
  ]
}

/** What each command leg writes, and the code the non-zero one ends on. */
export const STREAMS_STDOUT = 'out-line\n'
export const STREAMS_STDERR = 'err-line\n'
export const NONZERO_STDOUT = 'before-exit\n'
export const NONZERO_STDERR = 'after-exit\n'
export const NONZERO_EXIT = 7
export const QUOTED_STDOUT = '[one two][three]'

/** KE-08, KE-10: the two refusals the cluster makes, both recorded. */
export function refusedLegs(): ExecLeg[] {
  return [
    {
      key: 'absent',
      ids: ['KE-08'],
      what: 'a pod that does not exist, recorded',
      block: 'exec',
      records: true,
      values: {
        ...execBase(ABSENT_POD, CONTAINER_APP),
        command: shellCommand('echo never'),
        on_error: 'record',
      },
      marker: `f'[KE-08] absent ok={${okVar('absent')}} reason={${reasonVar('absent')}}'`,
    },
    {
      key: 'noexec',
      ids: ['KE-10'],
      what: 'a pod the cluster serves no exec for',
      block: 'exec',
      records: true,
      values: {
        ...execBase(NO_EXEC_POD, CONTAINER_APP),
        command: shellCommand('echo never'),
        on_error: 'record',
      },
      marker: `f'[KE-10] noexec ok={${okVar('noexec')}} reason={${reasonVar('noexec')}}'`,
    },
  ]
}

/** KE-09: the same missing pod under Fail the block. */
export function hardFailLegs(): ExecLeg[] {
  return [
    {
      key: 'hardfail',
      ids: ['KE-09'],
      what: 'the same missing pod, Fail the block',
      name: 'Missing pod, Fail the block',
      block: 'exec',
      values: {
        ...execBase(ABSENT_POD, CONTAINER_APP),
        command: shellCommand('echo never'),
      },
    },
  ]
}

/** KE-11 to KE-14: two interpreters, a non-zero exit, and a recorded refusal.
 *  These run in the second exec-fixture pod, so the suite proves the selector
 *  grants both names. */
export function scriptLegs(): ExecLeg[] {
  const base = { pod: EXEC_POD_B, container: CONTAINER_APP }
  return [
    {
      key: 'shell',
      ids: ['KE-11'],
      what: 'a multi-line /bin/sh script to EOF',
      block: 'script',
      values: { ...base, script: SHELL_SCRIPT },
    },
    {
      key: 'python',
      ids: ['KE-12'],
      what: 'a python3 body the shell could not run',
      block: 'script',
      values: { ...base, interpreter: 'python3', script: PYTHON_SCRIPT },
    },
    {
      key: 'scriptexit',
      ids: ['KE-13'],
      what: 'a script that exits 5',
      block: 'script',
      values: { ...base, script: EXIT_SCRIPT },
    },
    {
      key: 'scriptbad',
      ids: ['KE-14'],
      what: 'a missing pod, recorded',
      block: 'script',
      records: true,
      values: {
        pod: ABSENT_POD,
        container: CONTAINER_APP,
        script: SHELL_SCRIPT,
        on_error: 'record',
      },
      marker: `f'[KE-14] scriptbad ok={${okVar('scriptbad')}} reason={${reasonVar('scriptbad')}}'`,
    },
  ]
}

/** KE-15 to KE-17: a file out of the pod, a directory out of the pod, and a
 *  source path the pod does not hold. Each Copy leg follows the Exec leg that
 *  wrote what it takes. */
export function pullLegs(ctx: ExecContext): ExecLeg[] {
  const dir = podDir(ctx)
  const seedDir = [
    `mkdir -p ${dir}`,
    ...DIR_FILES.map(([name, content]) => writeFileBody(`${dir}/${name}`, content)),
  ].join(' && ')
  return [
    {
      key: 'seedfile',
      ids: ['KE-15'],
      what: 'write the file the pull takes',
      block: 'exec',
      values: {
        ...execBase(EXEC_POD, CONTAINER_APP),
        command: shellCommand(writeFileBody(podFile(ctx, PULL_FILE), pullContent(ctx))),
      },
    },
    {
      key: 'pullfile',
      ids: ['KE-15'],
      what: 'pull one file into the artifacts',
      block: 'copy',
      values: {
        direction: 'from_pod',
        pod: EXEC_POD,
        container: CONTAINER_APP,
        source_path: podFile(ctx, PULL_FILE),
        target_path: artifactRef(ctx, PULL_FILE),
      },
    },
    {
      key: 'seeddir',
      ids: ['KE-16'],
      what: 'write the directory the pull takes',
      block: 'exec',
      values: { ...execBase(EXEC_POD, CONTAINER_APP), command: shellCommand(seedDir) },
    },
    {
      key: 'pulldir',
      ids: ['KE-16'],
      what: 'pull a directory whole',
      block: 'copy',
      values: {
        direction: 'from_pod',
        pod: EXEC_POD,
        container: CONTAINER_APP,
        source_path: dir,
        target_path: artifactRef(ctx, 'dir'),
      },
    },
    {
      key: 'badpull',
      ids: ['KE-17'],
      what: 'a source path the pod does not hold',
      block: 'copy',
      records: true,
      values: {
        direction: 'from_pod',
        pod: EXEC_POD,
        container: CONTAINER_APP,
        source_path: podFile(ctx, ABSENT_FILE),
        target_path: artifactRef(ctx, ABSENT_FILE),
        on_error: 'record',
      },
      marker: `f'[KE-17] badpull ok={${okVar('badpull')}} reason={${reasonVar('badpull')}}'`,
    },
  ]
}

/** KE-19, KE-20: two pulls over the limit rows the sheets set. An earlier pull
 *  lands known bytes where the size pull's files land, so the refusal must put
 *  them back; the last leg removes the pod-side folders. */
export function limitLegs(ctx: ExecContext): ExecLeg[] {
  const sizes = podFile(ctx, 'sizes')
  const prior = podFile(ctx, 'prior')
  const many = podFile(ctx, 'many')
  const seed = [
    `mkdir -p ${sizes} ${prior} ${many}`,
    ...BIG_FILES.map((name) => `head -c ${BIG_FILE_SIZE} /dev/zero > ${sizes}/${name}`),
    ...BIG_FILES.map((name) => writeFileBody(`${prior}/${name}`, priorContent(ctx, name))),
    ...DIR_FILES.map(([name, content]) => writeFileBody(`${many}/${name}`, content)),
  ].join(' && ')
  const pull = { direction: 'from_pod', pod: EXEC_POD, container: CONTAINER_APP } as const
  const limits = { max_size_mib: FIXTURE_MAX_SIZE_MIB, max_files: FIXTURE_MAX_FILES }
  return [
    {
      key: 'seedlimits',
      ids: ['KE-19', 'KE-20'],
      what: 'write what the limit pulls take',
      block: 'exec',
      values: { ...execBase(EXEC_POD, CONTAINER_APP), command: shellCommand(seed) },
    },
    {
      key: 'prior',
      ids: ['KE-19'],
      what: 'land known bytes where the size pull lands',
      block: 'copy',
      values: { ...pull, source_path: prior, target_path: `artifact://${LIMIT_SIZE_ARTIFACT}/` },
    },
    {
      key: 'sizepull',
      ids: ['KE-19'],
      what: 'a pull over its Max size',
      block: 'copy',
      records: true,
      values: {
        ...pull,
        source_path: sizes,
        target_path: `artifact://${LIMIT_SIZE_ARTIFACT}/`,
        on_error: 'record',
        ...limits,
      },
      marker: `f'[KE-19] sizepull ok={${okVar('sizepull')}} reason={${reasonVar('sizepull')}}'`,
    },
    {
      key: 'filespull',
      ids: ['KE-20'],
      what: 'a pull over its Max files',
      block: 'copy',
      records: true,
      values: {
        ...pull,
        source_path: many,
        target_path: `artifact://${LIMIT_FILES_ARTIFACT}/`,
        on_error: 'record',
        ...limits,
      },
      marker: `f'[KE-20] filespull ok={${okVar('filespull')}} reason={${reasonVar('filespull')}}'`,
    },
    {
      key: 'droplimits',
      ids: ['KE-19', 'KE-20'],
      what: 'remove the folders the limit legs wrote',
      block: 'exec',
      values: {
        ...execBase(EXEC_POD, CONTAINER_APP),
        command: shellCommand(`rm -rf ${sizes} ${prior} ${many}`),
      },
    },
  ]
}

/** KE-18: an artifact an earlier Block wrote is pushed into the pod, and a
 *  K8s Exec reads it back out. */
export function pushLegs(ctx: ExecContext): ExecLeg[] {
  return [
    {
      key: 'stage',
      ids: ['KE-18'],
      what: 'write the artifact the push sends',
      block: 'file',
      values: {
        operation: 'write',
        path: artifactRef(ctx, PUSH_FILE),
        content: pushContent(ctx),
        if_exists: 'overwrite',
      },
    },
    {
      key: 'push',
      ids: ['KE-18'],
      what: 'push the artifact into the pod',
      block: 'copy',
      values: {
        direction: 'to_pod',
        pod: EXEC_POD,
        container: CONTAINER_APP,
        source_path: artifactRef(ctx, PUSH_FILE),
        target_path: podFile(ctx, PUSH_FILE),
      },
    },
    {
      key: 'readback',
      ids: ['KE-18'],
      what: 'cat the pushed file back out',
      block: 'exec',
      values: {
        ...execBase(EXEC_POD, CONTAINER_APP),
        command: `cat ${podFile(ctx, PUSH_FILE)}`,
      },
    },
  ]
}

// ---------------------------------------------------------------------------
// Fixture builder
// ---------------------------------------------------------------------------

type FixtureVariable = { value: unknown; type: string; scope: string; secret?: boolean }

export interface ExecMaterial {
  adminToken: string
  caCert: string
  namespace: string
  name: string
  bookend: string
}

function connectNode(namespace: string): WorkflowNode {
  return k8sConnectNode({
    id: 'connect-admin',
    description: `Session for ${SESSION_VARIABLE}`,
    expressionFields: ['token', 'ca_cert'],
    values: {
      api_url: K8S_API_URL,
      namespace,
      timeout: 30,
      verify_ssl: true,
      ca_cert: CA_VARIABLE,
      token: TOKEN_VARIABLE,
    },
    outputBindings: { session: SESSION_VARIABLE },
  })
}

function blockNode(leg: ExecLeg, bindings: Record<string, string>): WorkflowNode {
  const shared = {
    id: nodeId(leg),
    description: blockName(leg),
    expressionFields: ['session'],
    ...(leg.name ? { label: legName(leg) } : {}),
  }
  if (leg.block === 'exec') {
    return k8sExecNode({
      ...shared,
      values: { session: SESSION_VARIABLE, ...leg.values },
      outputBindings: bindings,
    })
  }
  if (leg.block === 'script') {
    return k8sScriptNode({
      ...shared,
      values: { session: SESSION_VARIABLE, ...leg.values },
      outputBindings: bindings,
    })
  }
  if (leg.block === 'copy') {
    return k8sCopyNode({
      ...shared,
      values: { session: SESSION_VARIABLE, ...leg.values },
      outputBindings: bindings,
    })
  }
  return pluginNode({
    id: nodeId(leg),
    label: leg.name ? legName(leg) : 'File I/O',
    elementType: 'file-io',
    category: 'system',
    description: blockName(leg),
    values: leg.values,
    outputBindings: bindings,
  })
}

/** Which outputs a leg binds, and the variable each one declares. Every leg
 *  binds EVERY output its Block declares outside the Record gate. */
function legBindings(
  leg: ExecLeg,
  variables: Record<string, FixtureVariable>,
): Record<string, string> {
  const bindings: Record<string, string> = {}
  if (leg.block === 'file') return bindings
  const declare = (name: string, value: unknown, type: string): void => {
    variables[name] = { value, type, scope: 'test' }
  }
  if (leg.block === 'copy') {
    bindings.summary = summaryVar(leg.key)
    declare(summaryVar(leg.key), [], 'table')
  } else {
    bindings.stdout = stdoutVar(leg.key)
    bindings.stderr = stderrVar(leg.key)
    bindings.exit_code = exitVar(leg.key)
    declare(stdoutVar(leg.key), '', 'string')
    declare(stderrVar(leg.key), '', 'string')
    declare(exitVar(leg.key), 0, 'integer')
  }
  bindings.success = okVar(leg.key)
  declare(okVar(leg.key), false, 'boolean')
  if (leg.records) {
    bindings.error = errorVar(leg.key)
    bindings.reason = reasonVar(leg.key)
    declare(errorVar(leg.key), '', 'string')
    declare(reasonVar(leg.key), '', 'string')
  }
  return bindings
}

/** The line a leg stamps when it has nothing of its own to say. */
function defaultMarker(leg: ExecLeg): WorkflowNode {
  const id = `log-${leg.key}`
  const description = `Marker for ${leg.key}`
  if (leg.marker) return markerNode({ id, description, expression: leg.marker })
  if (leg.block === 'file') return markerNode({ id, description, text: markerLine(leg) })
  if (leg.block === 'copy') {
    return markerNode({
      id,
      description,
      expression: `f'${markerLine(leg)} ok={${okVar(leg.key)}}'`,
    })
  }
  return markerNode({
    id,
    description,
    expression: `f'${markerLine(leg)} exit={${exitVar(leg.key)}} ok={${okVar(leg.key)}}'`,
  })
}

/** Build a whole proof: the Connect Block, one Block plus one marker per leg,
 *  and the bookend. */
export function buildExecFixture(
  legs: readonly ExecLeg[],
  material: ExecMaterial,
): Record<string, unknown> {
  const variables: Record<string, FixtureVariable> = {
    [CA_VARIABLE]: { value: material.caCert, type: 'string', scope: 'test' },
    [SESSION_VARIABLE]: { value: '', type: 'string', scope: 'test' },
    [TOKEN_VARIABLE]: {
      value: material.adminToken,
      type: 'string',
      scope: 'test',
      secret: true,
    },
  }

  const nodes: WorkflowNode[] = [connectNode(material.namespace)]
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
  link(nodes[0].id)

  for (const leg of legs) {
    const block = blockNode(leg, legBindings(leg, variables))
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

/** The columns K8s Copy declares on Summary, whatever direction it went. */
export const COPY_SUMMARY_COLUMNS = ['SOURCE', 'TARGET', 'SIZE'] as const
export const COPY_SUMMARY_TYPES = ['string', 'string', 'integer'] as const

export function cell(vars: SessionVariables, name: string): { value: unknown; type: string } {
  const found = vars[name]
  expect(found, `variable "${name}" was never bound`).toBeTruthy()
  return found
}

export const stdoutOf = (vars: SessionVariables, key: string): string =>
  String(cell(vars, stdoutVar(key)).value)
export const stderrOf = (vars: SessionVariables, key: string): string =>
  String(cell(vars, stderrVar(key)).value)
export const exitOf = (vars: SessionVariables, key: string): number =>
  Number(cell(vars, exitVar(key)).value)
export const okOf = (vars: SessionVariables, key: string): unknown => cell(vars, okVar(key)).value
export const errorOf = (vars: SessionVariables, key: string): string =>
  String(cell(vars, errorVar(key)).value)
export const reasonOf = (vars: SessionVariables, key: string): string =>
  String(cell(vars, reasonVar(key)).value)

/** The success flag a leg the cluster carried out reports. */
export function expectSuccess(vars: SessionVariables, key: string): void {
  expect(okOf(vars, key), `${key} must report success true`).toBe(true)
}

/** Every output an Exec or Script leg declares, asserted whole: both streams,
 *  the exit code and the success flag. */
export function expectStreams(
  vars: SessionVariables,
  key: string,
  expected: { stdout: string; stderr: string; exitCode: number },
): void {
  expect(stdoutOf(vars, key), `${key} stdout`).toBe(expected.stdout)
  expect(stderrOf(vars, key), `${key} stderr`).toBe(expected.stderr)
  expect(exitOf(vars, key), `${key} exit code`).toBe(expected.exitCode)
  expectSuccess(vars, key)
}

/** The core a recorded failure reports: success false and the cluster's own
 *  reason. Returns the error sentence so the caller can match it. */
export function expectRecordedCore(
  vars: SessionVariables,
  key: string,
  reason: string,
): string {
  expect(okOf(vars, key), `${key} must report success false`).toBe(false)
  expect(reasonOf(vars, key), `${key} reason`).toBe(reason)
  const message = errorOf(vars, key)
  expect(message.length, `${key} error must carry the cluster's sentence`).toBeGreaterThan(0)
  return message
}

/** The empty streams a recorded Exec or Script failure leaves behind. */
export function expectEmptyStreams(vars: SessionVariables, key: string): void {
  expect(stdoutOf(vars, key), `${key} stdout`).toBe('')
  expect(stderrOf(vars, key), `${key} stderr`).toBe('')
  expect(exitOf(vars, key), `${key} exit code`).toBe(0)
}

/** The Summary a Copy leg bound: the three columns it always declares and
 *  their types, whatever the copy did. */
export function copySummary(vars: SessionVariables, key: string): WaveTable {
  const found = cell(vars, summaryVar(key))
  expect(found.type, `${key} Summary must be a table`).toBe('table')
  const table = found.value as WaveTable
  expect(
    table.columns.map((column) => column.name),
    `${key} Summary columns`,
  ).toEqual([...COPY_SUMMARY_COLUMNS])
  expect(
    table.columns.map((column) => column.type),
    `${key} Summary column types`,
  ).toEqual([...COPY_SUMMARY_TYPES])
  return table
}

export type CopyRow = { source: string; target: string; size: number }

/** The Summary rows of a Copy leg, one per file, named rather than positional. */
export function copyRows(vars: SessionVariables, key: string): CopyRow[] {
  return copySummary(vars, key).rows.map((row) => {
    const [source, target, size] = row as [string, string, number]
    return { source, target, size }
  })
}

/** A recorded Copy failure keeps its declared columns and carries no row. */
export function expectEmptyCopy(vars: SessionVariables, key: string): void {
  expect(copySummary(vars, key).rows, `${key} Summary rows`).toEqual([])
}

const warningsIn = (entries: readonly LogEntry[]): string[] =>
  entries.filter((entry) => entry.level === 'WARN').map((entry) => entry.message)

/** Exactly one WARN line, the one this recorded failure writes. The console
 *  trims every entry it renders and a command's own stderr can end in a
 *  newline, so the expected line is trimmed too. */
export function expectRecordedWarning(
  entries: readonly LogEntry[],
  action: ExecAction,
  reason: string,
  message: string,
  context: string,
): void {
  const line = recordedLine(action, reason, message).trim()
  expect(
    warningsIn(entries).filter((entry) => entry === line).length,
    `expected exactly one WARN line for the recorded ${action} failure.\n${context}`,
  ).toBe(1)
}

/** No WARN line at all from this Block: nothing was recorded. */
export function expectNoRecordedWarning(
  entries: readonly LogEntry[],
  action: ExecAction,
  context: string,
): void {
  expect(
    warningsIn(entries).filter((entry) => entry.startsWith(`${action} failed`)),
    `nothing may be recorded here.\n${context}`,
  ).toEqual([])
}

/** Every leg stamped its ids on the console, so a failure names the row. */
export function expectMarkers(logs: readonly string[], legs: readonly ExecLeg[]): void {
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
 *  recorded failure, green otherwise. */
export async function expectLegStatuses(page: Page, legs: readonly ExecLeg[]): Promise<void> {
  for (const leg of legs) {
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

// ---------------------------------------------------------------------------
// The run's artifacts
// ---------------------------------------------------------------------------

export type ArtifactEntry = { path: string; size_bytes: number }

/** Everything the run's artifacts directory holds, as the session API lists it. */
export async function listArtifacts(page: Page): Promise<ArtifactEntry[]> {
  const resp = await page.request.get(`${BACKEND_URL}/workbench/session/artifacts`)
  expect(resp.ok(), `GET session artifacts failed: ${resp.status()}`).toBeTruthy()
  const body = (await resp.json()) as { items: ArtifactEntry[] }
  return body.items
}

/** One artifact's bytes, read back through the session API. */
export async function readArtifact(page: Page, artifact: string): Promise<string> {
  const resp = await page.request.get(
    `${BACKEND_URL}/workbench/session/artifacts/content/${artifact}`,
  )
  expect(resp.ok(), `GET artifact ${artifact} failed: ${resp.status()}`).toBeTruthy()
  return resp.text()
}
