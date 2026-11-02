/**
 * Keyboard Shortcuts Hook - Undo/redo and clipboard shortcuts
 *
 * Wires up keyboard shortcuts for undo, redo, copy, cut, paste,
 * duplicate, and select-all using the workflow store actions.
 */

import { useCallback } from 'react'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import { useUndoRedoShortcuts } from '@/features/workbench/hooks/use-undo-redo-shortcuts'
import { useCanvasShortcuts } from '@/features/workbench/hooks/use-canvas-shortcuts'

export interface KeyboardShortcutsResult {
  handleUndo: () => void
  handleRedo: () => void
}

export function useKeyboardShortcuts(): KeyboardShortcutsResult {
  const canUndo = useWorkflowStore((state) => state.canUndo())
  const canRedo = useWorkflowStore((state) => state.canRedo())
  const undo = useWorkflowStore((state) => state.undo)
  const redo = useWorkflowStore((state) => state.redo)
  const copy = useWorkflowStore((state) => state.copy)
  const cut = useWorkflowStore((state) => state.cut)
  const paste = useWorkflowStore((state) => state.paste)
  const duplicate = useWorkflowStore((state) => state.duplicate)
  const selectAll = useWorkflowStore((state) => state.selectAll)
  const requestDeleteSelected = useWorkflowStore((state) => state.requestDeleteSelected)
  const disconnectSelected = useWorkflowStore((state) => state.disconnectSelected)
  const clipboard = useWorkflowStore((state) => state.clipboard)
  const selectedNodeIds = useWorkflowStore((state) => state.selectedNodeIds)
  const selectedEdgeIds = useWorkflowStore((state) => state.selectedEdgeIds)

  /* v8 ignore start - COV-CONTAINER-002 */
  const handleUndo = useCallback(function triggerUndo() {
    undo()
  }, [undo])

  const handleRedo = useCallback(function triggerRedo() {
    redo()
  }, [redo])
  /* v8 ignore stop */

  useUndoRedoShortcuts({ onUndo: handleUndo, onRedo: handleRedo, canUndo, canRedo })

  const hasSelection = selectedNodeIds.length > 0 || selectedEdgeIds.length > 0
  const hasClipboard = !!clipboard && clipboard.nodes.length > 0
  useCanvasShortcuts({
    onCopy: copy,
    onCut: cut,
    onPaste: paste,
    onDuplicate: duplicate,
    onSelectAll: selectAll,
    onDelete: requestDeleteSelected,
    onDisconnect: disconnectSelected,
    hasSelection,
    hasClipboard,
  })

  return { handleUndo, handleRedo }
}
