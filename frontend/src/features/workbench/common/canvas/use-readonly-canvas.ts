/** Drilled-into-Shared selectors: read-only canvas state, drilled-into-Shared
 *  flag (for chrome visibility), and the deepest Shared's edit-mode info. */

import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'

type AnyData = Record<string, unknown> | undefined

function findDeepestSharedOnPath(
  drillPath: { nodeId: string }[],
  nodes: { id: string; data?: AnyData }[],
): { data: AnyData } | null {
  if (drillPath.length === 0) return null
  let cursor = nodes
  let deepestShared: { data: AnyData } | null = null
  for (const entry of drillPath) {
    const node = cursor.find((n) => n.id === entry.nodeId)
    if (!node) return deepestShared
    const data = node.data
    if (data?.functionLifecycle === 'shared') {
      deepestShared = { data }
    }
    const localDef = data?.localDefinition as
      | { workflow?: { nodes: { id: string; data?: AnyData }[] } }
      | undefined
    if (!localDef?.workflow?.nodes) return deepestShared
    cursor = localDef.workflow.nodes
  }
  return deepestShared
}

export function useReadOnlyCanvas(): boolean {
  // Single read-only-scope definition: the store selector decides.
  return useWorkflowStore((state) => state.isCurrentScopeReadOnly())
}

export function useIsDrilledIntoShared(): boolean {
  const drillPath = useWorkflowStore((state) => state.drillPath)
  const nodes = useWorkflowStore((state) => state.nodes)
  return findDeepestSharedOnPath(drillPath, nodes) !== null
}

export interface DrilledSharedInfo {
  nodeId: string
  editMode: boolean
  sourceVersion?: string
}

export function useDrilledSharedInfo(): DrilledSharedInfo | null {
  const drillPath = useWorkflowStore((state) => state.drillPath)
  const nodes = useWorkflowStore((state) => state.nodes)
  if (drillPath.length === 0) return null
  let cursor: { id: string; data?: AnyData }[] = nodes
  let deepest: { nodeId: string; data: Record<string, unknown> } | null = null
  for (const entry of drillPath) {
    const node = cursor.find((n) => n.id === entry.nodeId)
    if (!node) return deepest ? toInfo(deepest) : null
    const data = node.data
    if (data?.functionLifecycle === 'shared') {
      deepest = { nodeId: entry.nodeId, data }
    }
    const localDef = data?.localDefinition as
      | { workflow?: { nodes: { id: string; data?: AnyData }[] } }
      | undefined
    if (!localDef?.workflow?.nodes) return deepest ? toInfo(deepest) : null
    cursor = localDef.workflow.nodes
  }
  return deepest ? toInfo(deepest) : null
}

function toInfo(d: { nodeId: string; data: Record<string, unknown> }): DrilledSharedInfo {
  const data = d.data
  const upstream = data.upstreamLink as { sourceVersion?: string } | undefined
  return {
    nodeId: d.nodeId,
    editMode: !!data.editMode,
    sourceVersion: upstream?.sourceVersion ?? (data.functionVersion as string | undefined),
  }
}
