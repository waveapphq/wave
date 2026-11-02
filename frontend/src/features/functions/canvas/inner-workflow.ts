/**
 * Pure helpers for navigating the drill stack of nested local Functions.
 *
 * A "drill path" addresses a nested subtree inside a Test workflow. Each
 * entry references a Function node; the drill stack always terminates at a
 * Function node whose `localDefinition.workflow` is the active subtree.
 *
 * Both helpers are free of React, store, and DOM dependencies so they can be
 * unit-tested in isolation and reused from non-React contexts.
 */

export interface DrillEntry {
  nodeId: string
  label: string
}

interface DrillableLocalDefinition<N, E, V> {
  workflow: { nodes: N[]; edges: E[] }
  inputs: unknown[]
  outputs: unknown[]
  variables?: V[]
}

interface ParamMutableLocalDefinition<N, E, V, P> {
  workflow: { nodes: N[]; edges: E[] }
  inputs: P[]
  outputs: P[]
  variables?: V[]
}

interface DrillableNode<N, E, V> {
  id: string
  type: string
  position: { x: number; y: number }
  data: {
    label: string
    nodeType?: 'control' | 'plugin' | 'function'
    functionLifecycle?: 'local' | 'shared'
    localDefinition?: DrillableLocalDefinition<N, E, V>
    [key: string]: unknown
  }
  [key: string]: unknown
}

export interface ActiveSubtree<N, E, V> {
  nodes: N[]
  edges: E[]
  variables: V[]
  localDefinition: DrillableLocalDefinition<N, E, V> | null
}

/**
 * Resolve the active subtree for `drillPath`.
 *
 * - Empty drillPath returns the root tree (passed in as the first three args).
 * - Non-empty drillPath walks the stack and returns the deepest Function's
 *   localDefinition workflow + variables.
 * - Never crashes: an entry referencing a missing node, a non-Function node,
 *   or a Function without a materialized body degrades to the subtree at the
 *   deepest valid prefix (the nearest valid ancestor scope).
 */
export function walkActiveSubtree<N, E, V>(
  rootNodes: N[],
  rootEdges: E[],
  rootVariables: V[],
  drillPath: DrillEntry[],
): ActiveSubtree<N, E, V> {
  const rootResult: ActiveSubtree<N, E, V> = {
    nodes: rootNodes,
    edges: rootEdges,
    variables: rootVariables,
    localDefinition: null,
  }
  if (drillPath.length === 0) {
    return rootResult
  }

  let nodes = rootNodes as unknown as DrillableNode<N, E, V>[]
  let currentLocalDef: DrillableLocalDefinition<N, E, V> | null = null

  for (const entry of drillPath) {
    const found = nodes.find((n) => n.id === entry.nodeId)
    if (found?.data.nodeType !== 'function' || !found.data.localDefinition) {
      break
    }
    currentLocalDef = found.data.localDefinition
    nodes = currentLocalDef.workflow.nodes as unknown as DrillableNode<N, E, V>[]
  }

  if (!currentLocalDef) return rootResult
  return {
    nodes: currentLocalDef.workflow.nodes,
    edges: currentLocalDef.workflow.edges,
    variables: currentLocalDef.variables ?? [],
    localDefinition: currentLocalDef,
  }
}

/**
 * Find a node by id anywhere in the tree: top-level plus every nested
 * `localDefinition` body. Scope-independent lookup for surfaces that must
 * resolve a node outside the active drilled subtree (e.g. read-only sheets).
 */
export function findNodeDeepById<N extends { id: string; data?: Record<string, unknown> }>(
  nodes: ReadonlyArray<N>,
  id: string,
): N | null {
  for (const node of nodes) {
    if (node.id === id) return node
    const localDef = node.data?.localDefinition as
      | { workflow?: { nodes?: N[] } }
      | undefined
    const inner = localDef?.workflow?.nodes
    if (Array.isArray(inner)) {
      const found = findNodeDeepById(inner, id)
      if (found) return found
    }
  }
  return null
}

/**
 * Depth of the longest `drillPath` prefix that resolves to materialized
 * Function bodies in `rootNodes`. Used to reconcile the drill location after
 * a history restore or surgery.
 */
export function resolveValidDrillDepth<N>(rootNodes: N[], drillPath: DrillEntry[]): number {
  let nodes = rootNodes as unknown as DrillableNode<N, unknown, unknown>[]
  let depth = 0
  for (const entry of drillPath) {
    const found = nodes.find((n) => n.id === entry.nodeId)
    if (found?.data.nodeType !== 'function' || !found.data.localDefinition) {
      return depth
    }
    nodes = found.data.localDefinition.workflow.nodes as unknown as DrillableNode<
      N,
      unknown,
      unknown
    >[]
    depth++
  }
  return depth
}

/** The one read-only rule: the deepest Shared Function on `path` decides, and an edit-mode Shared is editable. */
export function isScopeReadOnly<N>(rootNodes: N[], path: DrillEntry[]): boolean {
  let nodes = rootNodes as unknown as DrillableNode<N, unknown, unknown>[]
  let deepestShared: DrillableNode<N, unknown, unknown> | null = null
  for (const entry of path) {
    const found = nodes.find((n) => n.id === entry.nodeId)
    if (!found) break
    if (found.data.functionLifecycle === 'shared') deepestShared = found
    if (!found.data.localDefinition) break
    nodes = found.data.localDefinition.workflow.nodes as unknown as DrillableNode<N, unknown, unknown>[]
  }
  return deepestShared !== null && !deepestShared.data.editMode
}

/**
 * Apply `mutator` to the active subtree's nodes array, returning a new root
 * `nodes` tree with the mutation propagated. Untouched siblings preserve
 * referential identity (structural sharing) so render layers can rely on
 * shallow reference checks.
 */
export function applyMutationAtPath<N>(
  rootNodes: N[],
  drillPath: DrillEntry[],
  mutator: (nodes: N[]) => N[],
): N[] {
  if (drillPath.length === 0) {
    return mutator(rootNodes)
  }

  const { typedRoot, idx, target, rest } = resolveDrillStep<N>(rootNodes, drillPath)
  // resolveDrillStep validates localDefinition is set; non-null below is safe.
  const localDef = target.data.localDefinition!
  const newInner = applyMutationAtPath(localDef.workflow.nodes, rest, mutator)

  const updatedTarget: DrillableNode<N, unknown, unknown> = {
    ...target,
    data: {
      ...target.data,
      localDefinition: {
        ...localDef,
        workflow: {
          ...localDef.workflow,
          nodes: newInner,
        },
      },
    },
  }

  const result = typedRoot.slice()
  result[idx] = updatedTarget
  return result as unknown as N[]
}

/**
 * Apply `mutator` to the active subtree's edges array, returning a new root
 * `nodes` tree (with the edges replaced inside the deepest Function's
 * localDefinition). When drillPath is empty, returns the rootNodes unchanged
 * since edges at root level live next to nodes in the parent store.
 */
export function applyEdgesMutationAtPath<N, E>(
  rootNodes: N[],
  drillPath: DrillEntry[],
  mutator: (edges: E[]) => E[],
): N[] {
  if (drillPath.length === 0) {
    return rootNodes
  }

  const typedRoot = rootNodes as unknown as DrillableNode<N, E, unknown>[]
  const [head, ...rest] = drillPath
  const idx = typedRoot.findIndex((n) => n.id === head.nodeId)
  if (idx === -1) {
    throw new Error(`Drill path references missing node '${head.nodeId}'`)
  }
  const target = typedRoot[idx]
  if (target.data.nodeType !== 'function' || !target.data.localDefinition) {
    throw new Error(`Drill path entry '${head.nodeId}' is not a Function node`)
  }

  let newWorkflowEdges: E[]
  let newInnerNodes: N[]
  if (rest.length === 0) {
    newInnerNodes = target.data.localDefinition.workflow.nodes
    newWorkflowEdges = mutator(target.data.localDefinition.workflow.edges)
  } else {
    newInnerNodes = applyEdgesMutationAtPath(
      target.data.localDefinition.workflow.nodes,
      rest,
      mutator,
    )
    newWorkflowEdges = target.data.localDefinition.workflow.edges
  }

  const updatedTarget: DrillableNode<N, E, unknown> = {
    ...target,
    data: {
      ...target.data,
      localDefinition: {
        ...target.data.localDefinition,
        workflow: {
          nodes: newInnerNodes,
          edges: newWorkflowEdges,
        },
      },
    },
  }

  const result = typedRoot.slice()
  result[idx] = updatedTarget
  return result as unknown as N[]
}

/**
 * Convenience wrapper around `walkActiveSubtree` for callers that already
 * have a state-like object with `nodes`, `edges`, `variables`, and
 * `drillPath`. Exists so the workflow store and Var Manager hooks can share
 * one entry point instead of repeating the same four-arg call.
 */
export function getActiveTree<N, E, V>(state: {
  nodes: N[]
  edges: E[]
  variables: V[]
  drillPath: DrillEntry[]
}): ActiveSubtree<N, E, V> {
  return walkActiveSubtree(state.nodes, state.edges, state.variables, state.drillPath)
}

/**
 * Apply `mutator` to the active subtree's variables array, returning a new
 * root `nodes` tree (with variables replaced inside the deepest Function's
 * localDefinition). When drillPath is empty, returns rootNodes unchanged.
 */
export function applyVariablesMutationAtPath<N, V>(
  rootNodes: N[],
  drillPath: DrillEntry[],
  mutator: (variables: V[]) => V[],
): N[] {
  if (drillPath.length === 0) {
    return rootNodes
  }

  const typedRoot = rootNodes as unknown as DrillableNode<N, unknown, V>[]
  const [head, ...rest] = drillPath
  const idx = typedRoot.findIndex((n) => n.id === head.nodeId)
  if (idx === -1) {
    throw new Error(`Drill path references missing node '${head.nodeId}'`)
  }
  const target = typedRoot[idx]
  if (target.data.nodeType !== 'function' || !target.data.localDefinition) {
    throw new Error(`Drill path entry '${head.nodeId}' is not a Function node`)
  }

  let newVariables: V[]
  let newInnerNodes: N[]
  if (rest.length === 0) {
    newInnerNodes = target.data.localDefinition.workflow.nodes
    newVariables = mutator(target.data.localDefinition.variables ?? [])
  } else {
    newInnerNodes = applyVariablesMutationAtPath(
      target.data.localDefinition.workflow.nodes,
      rest,
      mutator,
    )
    newVariables = target.data.localDefinition.variables ?? []
  }

  const updatedTarget: DrillableNode<N, unknown, V> = {
    ...target,
    data: {
      ...target.data,
      localDefinition: {
        ...target.data.localDefinition,
        variables: newVariables,
        workflow: {
          ...target.data.localDefinition.workflow,
          nodes: newInnerNodes,
        },
      },
    },
  }

  const result = typedRoot.slice()
  result[idx] = updatedTarget
  return result as unknown as N[]
}

/**
 * Generic param-array bubble. Both `applyInputsMutationAtPath` and
 * `applyOutputsMutationAtPath` are thin field-selector wrappers around this
 * helper - the recursion + path-bubbling logic lives here only once.
 *
 * `field` picks which of `localDefinition.inputs` / `localDefinition.outputs`
 * the mutator operates on. The recursive call passes the same field
 * downward so deep drills still target the right slot.
 */
/**
 * Validated lookup of the next drill step. Throws the same anchored errors
 * the older `apply*MutationAtPath` helpers throw inline; centralized here so
 * the param-mutator path doesn't duplicate the preamble.
 */
function resolveDrillStep<N>(
  rootNodes: N[],
  drillPath: DrillEntry[],
): {
  typedRoot: DrillableNode<N, unknown, unknown>[]
  idx: number
  target: DrillableNode<N, unknown, unknown>
  rest: DrillEntry[]
} {
  const typedRoot = rootNodes as unknown as DrillableNode<N, unknown, unknown>[]
  const [head, ...rest] = drillPath
  const idx = typedRoot.findIndex((n) => n.id === head.nodeId)
  if (idx === -1) {
    throw new Error(`Drill path references missing node '${head.nodeId}'`)
  }
  const target = typedRoot[idx]
  if (target.data.nodeType !== 'function' || !target.data.localDefinition) {
    throw new Error(`Drill path entry '${head.nodeId}' is not a Function node`)
  }
  return { typedRoot, idx, target, rest }
}

function applyParamMutationAtPath<N, P>(
  field: 'inputs' | 'outputs',
  rootNodes: N[],
  drillPath: DrillEntry[],
  mutator: (params: P[]) => P[],
): N[] {
  if (drillPath.length === 0) {
    return rootNodes
  }

  const { typedRoot, idx, target, rest } = resolveDrillStep<N>(rootNodes, drillPath)
  const localDef = target.data.localDefinition as ParamMutableLocalDefinition<N, unknown, unknown, P>

  let newParams: P[]
  let newInnerNodes: N[]
  if (rest.length === 0) {
    newInnerNodes = localDef.workflow.nodes
    newParams = mutator(localDef[field] ?? [])
  } else {
    newInnerNodes = applyParamMutationAtPath<N, P>(field, localDef.workflow.nodes, rest, mutator)
    newParams = localDef[field] ?? []
  }

  const updatedTarget = {
    ...target,
    data: {
      ...target.data,
      localDefinition: {
        ...localDef,
        [field]: newParams,
        workflow: {
          ...localDef.workflow,
          nodes: newInnerNodes,
        },
      },
    },
  } as DrillableNode<N, unknown, unknown>

  const result = typedRoot.slice()
  result[idx] = updatedTarget
  return result as unknown as N[]
}

/**
 * Apply `mutator` to the active Function's `localDefinition.inputs` array,
 * returning a new root `nodes` tree with the result. When drillPath is
 * empty, returns rootNodes unchanged (the store layer is responsible for
 * rejecting input mutations at Test root since inputs only exist on
 * Functions).
 */
export function applyInputsMutationAtPath<N, P>(
  rootNodes: N[],
  drillPath: DrillEntry[],
  mutator: (inputs: P[]) => P[],
): N[] {
  return applyParamMutationAtPath<N, P>('inputs', rootNodes, drillPath, mutator)
}

/**
 * Apply `mutator` to the active Function's `localDefinition.outputs` array,
 * returning a new root `nodes` tree with the result. Mirror of
 * `applyInputsMutationAtPath` with the `outputs` field selected.
 */
export function applyOutputsMutationAtPath<N, P>(
  rootNodes: N[],
  drillPath: DrillEntry[],
  mutator: (outputs: P[]) => P[],
): N[] {
  return applyParamMutationAtPath<N, P>('outputs', rootNodes, drillPath, mutator)
}
