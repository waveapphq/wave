/**
 * useVariableEditors - the row delete handler and the name check a variable window runs.
 *
 * REQ-3.1.3.11: Variable watching UI panel
 * REQ-3.1.3.1: Variable scoping with namespace-based access
 */

import { useCallback } from 'react'

import type { DrillEntry } from '@/features/functions/canvas/inner-workflow'
import { activeScopeNames, useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import type { Variable } from './types'

interface UseVariableEditorsParams {
  /** The rows the panel shows; an Edit window's row is one of them. */
  variables: Variable[]
  onVariableDelete?: (id: string) => void
}

export function useVariableEditors({
  variables,
  onVariableDelete,
}: UseVariableEditorsParams) {
  const handleDelete = useCallback(
    (variableId: string) => {
      onVariableDelete?.(variableId)
    },
    [onVariableDelete]
  )

  // One namespace per scope: a Function's inputs, outputs and locals, or the Test variables (REQ-3.1.2.4).
  const checkNameExists = useCallback(
    (name: string, excludeId: string, functionPath?: DrillEntry[]) => {
      const { nodes, edges, variables: testVariables, drillPath } = useWorkflowStore.getState()
      const ownName = variables.find((v) => v.id === excludeId)?.name
      if (name === ownName) return false
      return activeScopeNames(nodes, edges, testVariables, functionPath ?? drillPath).includes(name)
    },
    [variables]
  )

  return {
    handleDelete,
    checkNameExists,
  }
}
