/**
 * ExecutionsRowActions Component
 *
 * REQ-5.2.1.40: Execution history screen
 * REQ-5.2.1.23: Confirmation dialogs for destructive actions
 *
 * Row-level actions for the executions DataTable:
 * - View button (always visible)
 * - Export button (always visible, opens the shared export dialog)
 * - Stop button (running only, opens ConfirmationDialog with variant='discard')
 * - Delete button (terminal only, opens ConfirmationDialog with variant='delete')
 *
 * Owns its own ConfirmationDialog state to keep the container clean.
 */

import { useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { isTerminalStatus } from '@/components/shared/tables/table-utils'
import { Download, Eye, RotateCw, Square, Trash2 } from 'lucide-react'
import type { Execution } from '@/features/executions/api/types'

export interface ExecutionsRowActionsProps {
  execution: Execution
  onView: (id: string) => void
  onExport: (id: string) => void
  onRerun: (id: string) => void
  onStop: (id: string) => void
  onDelete: (id: string) => void
}

type ConfirmAction = 'stop' | 'delete'

interface ConfirmDialogState {
  isOpen: boolean
  action: ConfirmAction | null
}

export function ExecutionsRowActions({
  execution,
  onView,
  onExport,
  onRerun,
  onStop,
  onDelete,
}: Readonly<ExecutionsRowActionsProps>) {
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState>({
    isOpen: false,
    action: null,
  })

  const openConfirmDialog = useCallback((action: ConfirmAction) => {
    setConfirmDialog({ isOpen: true, action })
  }, [])

  const closeConfirmDialog = useCallback(() => {
    setConfirmDialog((prev) => ({ ...prev, isOpen: false }))
  }, [])

  const handleConfirm = useCallback(() => {
    if (confirmDialog.action === 'stop') {
      onStop(execution.id)
    } else if (confirmDialog.action === 'delete') {
      onDelete(execution.id)
    }
    closeConfirmDialog()
  }, [confirmDialog.action, execution.id, onStop, onDelete, closeConfirmDialog])

  const isRunning = execution.status === 'running'
  const isTerminal = isTerminalStatus(execution.status)

  return (
    <>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          data-testid="row-action-view"
          aria-label={`View ${execution.name}`}
          onClick={() => onView(execution.id)}
        >
          <Eye className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          data-testid="row-action-export"
          aria-label={`Export ${execution.name}`}
          onClick={() => onExport(execution.id)}
        >
          <Download className="h-4 w-4" />
        </Button>
        {isRunning && (
          <Button
            variant="ghost"
            size="icon"
            data-testid="row-action-stop"
            aria-label={`Stop ${execution.name}`}
            onClick={() => openConfirmDialog('stop')}
            className="text-error hover:bg-error/10 hover:text-error"
          >
            <Square className="h-4 w-4" fill="currentColor" />
          </Button>
        )}
        {isTerminal && (
          <Button
            variant="ghost"
            size="icon"
            data-testid="row-action-rerun"
            aria-label={`Re-run ${execution.name}`}
            onClick={() => onRerun(execution.id)}
          >
            <RotateCw className="h-4 w-4" />
          </Button>
        )}
        {isTerminal && (
          <Button
            variant="ghost"
            size="icon"
            data-testid="row-action-delete"
            aria-label={`Delete ${execution.name}`}
            onClick={() => openConfirmDialog('delete')}
            className="text-error hover:bg-error/10 hover:text-error"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>

      <ConfirmationDialog
        isOpen={confirmDialog.isOpen}
        onClose={closeConfirmDialog}
        onConfirm={handleConfirm}
        variant={confirmDialog.action === 'delete' ? 'delete' : 'discard'}
        title={
          confirmDialog.action === 'stop'
            ? `Stop "${execution.name}"?`
            : `Delete "${execution.name}"?`
        }
        description={
          confirmDialog.action === 'stop'
            ? 'This will gracefully stop the running execution and run any finalization steps.'
            : 'This will permanently remove this execution and all of its artifacts and reports from history. This action cannot be undone.'
        }
        confirmLabel={confirmDialog.action === 'stop' ? 'Stop' : 'Delete'}
        cancelLabel="Cancel"
      />
    </>
  )
}
