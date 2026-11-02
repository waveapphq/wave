/**
 * The active Function scope, read from the drill path: outside a Function nothing is in scope; inside,
 * the deepest Function's names from the one scope-names reader (REQ-3.1.3.11).
 */

import { useMemo } from 'react'

import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import { walkActiveSubtree } from '@/features/functions/canvas/inner-workflow'
import { functionScopeNames, type ScopeBody } from '@/features/workbench/lib/function-scope-rows'

export interface FunctionScope {
  insideFunction: boolean
  /** Stable identity of the drilled scope (drillPath join); '' at root. */
  scopeId?: string
  declaredInputNames: string[]
  declaredOutputNames: string[]
  allowedVarNames: Set<string>
}

const EMPTY_SCOPE: FunctionScope = {
  insideFunction: false,
  scopeId: '',
  declaredInputNames: [],
  declaredOutputNames: [],
  allowedVarNames: new Set(),
}

export function useFunctionScope(): FunctionScope {
  const rootNodes = useWorkflowStore((state) => state.nodes)
  const drillPath = useWorkflowStore((state) => state.drillPath)

  return useMemo(() => {
    if (drillPath.length === 0) return EMPTY_SCOPE

    // A path that resolves to no body is still inside a Function, with nothing in scope.
    const active = walkActiveSubtree(rootNodes, [], [], drillPath)
    const names = functionScopeNames(active.localDefinition as ScopeBody | null)
    const namesOf = (kind: 'input' | 'output') =>
      names.filter((entry) => entry.kind === kind).map((entry) => entry.name)

    return {
      insideFunction: true,
      scopeId: drillPath.map((entry) => entry.nodeId).join('/'),
      declaredInputNames: namesOf('input'),
      declaredOutputNames: namesOf('output'),
      allowedVarNames: new Set(names.map((entry) => entry.name)),
    }
  }, [rootNodes, drillPath])
}
