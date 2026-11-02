/**
 * Selectors that map the canvas drill stack to how a run names its target.
 *
 * At the Test level (empty drill stack) Run Scope falls back to the standard
 * test-mode run endpoint. Drilled into a Function (any drill-stack depth) the
 * dispatch targets the scoped invocation path with the active Function node id
 * and the path of Function instances it sits inside.
 */

export interface DrillEntry {
  nodeId: string
  label: string
}

export interface RunScopeDispatch {
  mode: 'test' | 'function'
  scopedFunctionNodeId?: string
  /** Function instance ids from the Test canvas to the canvas that holds the scoped Function. */
  functionPath?: string[]
}

export function selectRunScopeDispatch(args: {
  drillPath: DrillEntry[] | undefined
}): RunScopeDispatch {
  const drillPath = args.drillPath ?? []
  if (drillPath.length === 0) {
    return { mode: 'test' }
  }
  const leaf = drillPath.at(-1)!
  return {
    mode: 'function',
    scopedFunctionNodeId: leaf.nodeId,
    functionPath: drillPath.slice(0, -1).map((entry) => entry.nodeId),
  }
}

/** Run/Debug Current and from Here on a Block inside an opened Function body name every opened Function. */
export function selectAdHocFunctionPath(
  drillPath: readonly DrillEntry[] | undefined,
): { functionPath?: string[] } {
  if (!drillPath || drillPath.length === 0) return {}
  return { functionPath: drillPath.map((entry) => entry.nodeId) }
}
