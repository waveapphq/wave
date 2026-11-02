/**
 * The workflow behind STOPPED-READ-SILENT, as data.
 *
 * One Parallel section whose reader lane carries a short time limit and holds a
 * K8s Get the stub answers long after that limit. The sibling lane finishes at
 * once, so the only thing the section waits on is the read.
 */

import {
  chainEdges,
  edge,
  handleEdge,
  k8sConnectNode,
  k8sReadNode,
  markerNode,
  parallelNode,
  stackNodes,
  type WorkflowEdge,
  type WorkflowNode,
} from '../../helpers/k8s-nodes'
import {
  HTTP_FIXTURE_HOST_SENTINEL,
  K8S_STUB_CA_PEM,
  K8S_STUB_PORT,
} from '../../helpers/config'

/** The stub as fixtures carry it; `injectHttp` rewrites the host per mode. */
const STUB_BASE = `https://${HTTP_FIXTURE_HOST_SENTINEL}:${K8S_STUB_PORT}`

/** Seconds the stub sits on the resource read before answering. */
export const READ_DELAY_SECONDS = 8

/** Milliseconds the reader lane is allowed. Long enough for Connect and
 *  discovery, far short of the read's answer. */
export const BRANCH_LIMIT_MS = 2500

/** The read's own timeout, above the stub delay, so the read SUCCEEDS on the
 *  host and writes its INFO line - late. */
export const READ_TIMEOUT_SECONDS = 30

/** Nothing is seeded: the stub answers any namespace. */
export const NAMESPACE = 'wave-val'

/** The kind the delayed read asks for; the read line names it. */
export const READ_KIND = 'Pod'

export const STOPPED_FIXTURE_NAME = 'K8s Stopped Read E2E Test'

/** The lane names the section's own lines quote. */
export const READER_BRANCH = 'reader'
export const QUIET_BRANCH = 'quiet'

export const STOPPED_IDS = {
  before: 'log-before',
  section: 'par-cut',
  connect: 'connect-slow',
  read: 'get-slow',
  quiet: 'log-quiet',
  exit: 'log-exit',
} as const

export const STOPPED_VARS = {
  session: 'sess',
  count: 'read_count',
  names: 'read_names',
} as const

/** The bookend the sibling lane stamps; it lands before the section is cut. */
export const QUIET_MARKER = 'k8s-stopped-e2e-quiet'

/** The line the exit lane would stamp. An expired lane skips the exit, so it
 *  must never appear. */
export const EXIT_MARKER = 'k8s-stopped-e2e-exit'

/** The Parallel control's own line for a lane that ran out of time. */
export const branchExpiredLine = (branch: string, limitMs: number): string =>
  `Branch '${branch}' exceeded its time limit of ${limitMs} ms`

/** The read Block's own INFO line, whatever count and path it carries. */
export const READ_LINE_RE = /^Read \d+ \w+ object\(s\) from /

const ROW_STEP = 90

/** The stopped-read workflow: a Log, the section, its two lanes and its exit. */
export function buildStoppedReadFixture(): Record<string, unknown> {
  const v = STOPPED_VARS

  const head: WorkflowNode[] = [
    markerNode({
      id: STOPPED_IDS.before,
      description: 'Before the section',
      text: 'k8s-stopped-e2e-start',
    }),
    parallelNode({
      id: STOPPED_IDS.section,
      description: 'A capped lane over a delayed read',
      branches: [
        { id: 'branch_1', name: READER_BRANCH, timeLimitMs: BRANCH_LIMIT_MS },
        { id: 'branch_2', name: QUIET_BRANCH },
      ],
    }),
  ]

  const lane: WorkflowNode[] = [
    k8sConnectNode({
      id: STOPPED_IDS.connect,
      description: 'The stub, holding every read back',
      expressionFields: ['ca_cert'],
      values: {
        api_url: `${STUB_BASE}/cfg/delay=${READ_DELAY_SECONDS}`,
        namespace: NAMESPACE,
        timeout: READ_TIMEOUT_SECONDS,
        verify_ssl: true,
        ca_cert: 'k8s_stub_ca',
      },
      outputBindings: { session: v.session },
    }),
    k8sReadNode({
      id: STOPPED_IDS.read,
      elementType: 'k8s-get',
      description: 'A read answered long after the lane is cut',
      expressionFields: ['session'],
      values: {
        session: v.session,
        timeout: READ_TIMEOUT_SECONDS,
        resource_type: 'default',
        kind: READ_KIND,
        search_by: 'list',
        output_format: 'map',
        on_error: 'fail',
      },
      outputBindings: { names: v.names, count: v.count },
    }),
  ]

  const quiet: WorkflowNode[] = [
    markerNode({
      id: STOPPED_IDS.quiet,
      description: 'The sibling lane',
      text: QUIET_MARKER,
    }),
  ]

  const exit: WorkflowNode[] = [
    markerNode({ id: STOPPED_IDS.exit, description: 'Exit lane', text: EXIT_MARKER }),
  ]

  const nodes = [
    ...stackNodes(head, { x: 0, startY: 40, step: ROW_STEP }),
    ...stackNodes(lane, { x: -200, startY: 40 + head.length * ROW_STEP, step: ROW_STEP }),
    ...stackNodes(quiet, { x: 0, startY: 40 + head.length * ROW_STEP, step: ROW_STEP }),
    ...stackNodes(exit, { x: 200, startY: 40 + head.length * ROW_STEP, step: ROW_STEP }),
  ]

  const edges: WorkflowEdge[] = [
    ...chainEdges(head.map((node) => node.id)),
    handleEdge(STOPPED_IDS.section, 'branch_1', STOPPED_IDS.connect),
    edge(STOPPED_IDS.connect, STOPPED_IDS.read),
    handleEdge(STOPPED_IDS.section, 'branch_2', STOPPED_IDS.quiet),
    handleEdge(STOPPED_IDS.section, 'then', STOPPED_IDS.exit),
  ]

  return {
    name: STOPPED_FIXTURE_NAME,
    version: '1.0.0',
    description: '',
    workflow: { nodes, edges },
    variables: {
      k8s_stub_ca: { value: K8S_STUB_CA_PEM, type: 'string', scope: 'test' },
      [v.session]: { value: '', type: 'string', scope: 'test', secret: true },
      [v.names]: { value: [], type: 'array', scope: 'test' },
      [v.count]: { value: 0, type: 'integer', scope: 'test' },
    },
    metadata: { tags: [], suite_id: null, parent_suite: null },
  }
}
