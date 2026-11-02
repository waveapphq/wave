/**
 * Remote Body Membership - Graph Traversal Utility (REQ-3.4.1.3)
 *
 * Computes the set of nodes that sit inside a Remote Execution container's body
 * sub-flow (reached forward from the container's cyan `body` handle). A node in
 * that set runs on the SSH session host when remotable, else locally on WAVE -
 * which drives the per-block R / L locus badge.
 *
 * Memoized on the (nodes, edges) references so it recomputes once per graph
 * change and every node's membership check is an O(1) Set lookup. A drilled
 * Function body runs where its instance runs, so membership follows the drill path.
 */

import { getPluginById } from '@/features/workbench/lib/plugin-definitions'

interface MembershipNode {
  id: string
  data: { elementType?: string }
}

interface DrillableMembershipNode {
  id: string
  data?: {
    nodeType?: string
    localDefinition?: { workflow?: { nodes?: MembershipNode[]; edges?: MembershipEdge[] } }
  }
}

interface DrillEntry {
  nodeId: string
}

interface MembershipEdge {
  source: string
  target: string
  sourceHandle?: string
}

/** Forward BFS from a container's body target, adding every reachable node to
 *  `members`. The `then` egress leaves the container from the container node, so
 *  it is never reached from here. */
function collectBodyChain(
  startId: string,
  edges: readonly MembershipEdge[],
  members: Set<string>,
): void {
  const queue: string[] = [startId]
  while (queue.length > 0) {
    const current = queue.shift()!
    if (members.has(current)) continue
    members.add(current)
    for (const e of edges) {
      if (e.source === current && !members.has(e.target)) queue.push(e.target)
    }
  }
}

function computeRemoteBodyMembers(
  nodes: readonly MembershipNode[],
  edges: readonly MembershipEdge[],
): Set<string> {
  const members = new Set<string>()
  for (const node of nodes) {
    if (node.data?.elementType !== 'remote-execution') continue
    const bodyEdge = edges.find((e) => e.source === node.id && e.sourceHandle === 'body')
    if (bodyEdge) collectBodyChain(bodyEdge.target, edges, members)
  }
  return members
}

// One entry per graph level, so the root and each drilled body keep their own result.
const cache = new WeakMap<readonly MembershipNode[], WeakMap<readonly MembershipEdge[], Set<string>>>()

/** Nodes inside any Remote Execution container's body sub-flow (memoized). */
export function getRemoteBodyMembers(
  nodes: readonly MembershipNode[],
  edges: readonly MembershipEdge[],
): Set<string> {
  let byEdges = cache.get(nodes)
  if (!byEdges) {
    byEdges = new WeakMap()
    cache.set(nodes, byEdges)
  }
  let members = byEdges.get(edges)
  if (!members) {
    members = computeRemoteBodyMembers(nodes, edges)
    byEdges.set(edges, members)
  }
  return members
}

/** Whether a node of the scope the canvas shows sits inside a Remote Execution body,
 *  counting the call site of every drilled Function (walked as walkActiveSubtree does). */
export function isInRemoteBody(
  rootNodes: readonly MembershipNode[],
  rootEdges: readonly MembershipEdge[],
  drillPath: readonly DrillEntry[],
  nodeId: string,
): boolean {
  let nodes = rootNodes
  let edges = rootEdges
  for (const entry of drillPath) {
    const found = (nodes as readonly DrillableMembershipNode[]).find((n) => n.id === entry.nodeId)
    const body = found?.data?.nodeType === 'function' ? found.data.localDefinition?.workflow : undefined
    if (!body) break
    if (getRemoteBodyMembers(nodes, edges).has(entry.nodeId)) return true
    nodes = body.nodes ?? []
    edges = body.edges ?? []
  }
  return getRemoteBodyMembers(nodes, edges).has(nodeId)
}

/** Only a remotable block inside a Remote Execution body runs on the execution host. */
export function runsOnExecutionHost(inRemoteBody: boolean, elementType: string): boolean {
  return inRemoteBody && getPluginById(elementType)?.remotable === true
}
