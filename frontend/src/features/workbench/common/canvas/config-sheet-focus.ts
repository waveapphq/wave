/**
 * Shared reopen guard for block config sheets: every entry point (canvas
 * double-click, node kebab Configure) raises + pulses the already-open sheet
 * instead of duplicating it.
 */

import { refocusSheet } from '@/components/shared/draggable-sheet'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'

/** True when the node's config sheet was already open (raised + pulsed). */
export function refocusOpenConfigSheet(nodeId: string): boolean {
  if (!useWorkflowStore.getState().openConfigNodeIds.includes(nodeId)) {
    return false
  }
  refocusSheet(`config-${nodeId}`)
  return true
}
