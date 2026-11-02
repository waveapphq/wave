import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'

export interface UseFunctionViewLeaveParams {
  /** Fired right before the View is dropped. */
  onCanvasClosed: () => void
  clearDraft: () => void
}

export interface FunctionViewLeave {
  noticeOpen: boolean
  /** Close the View back to a draft workflow, after the notice when a draft is active. */
  close: () => void
  /** OK on the notice: drop the View and finish the Close. */
  acknowledge: () => void
  /** Escape or the backdrop: keep the View and its draft. */
  cancel: () => void
}

function viewDraftActive(): boolean {
  const { functionViewMode, hasEditModeNodes } = useWorkflowStore.getState()
  return functionViewMode !== null && hasEditModeNodes()
}

/** Close is the one View exit that drops an edit-mode draft with no dialog, so it notifies first (VIEW-10). */
export function useFunctionViewLeave({ onCanvasClosed, clearDraft }: UseFunctionViewLeaveParams): FunctionViewLeave {
  const navigate = useNavigate()
  const [closePending, setClosePending] = useState(false)

  const closeNow = useCallback(() => {
    onCanvasClosed()
    const store = useWorkflowStore.getState()
    store.reset()
    clearDraft()
    store.requestFitView({ padding: 0.2, duration: 0 })
    navigate('/workbench')
  }, [onCanvasClosed, clearDraft, navigate])

  const close = useCallback(() => {
    if (viewDraftActive()) setClosePending(true)
    else closeNow()
  }, [closeNow])

  const acknowledge = useCallback(() => {
    if (!closePending) return
    setClosePending(false)
    closeNow()
  }, [closePending, closeNow])

  const cancel = useCallback(() => {
    setClosePending(false)
  }, [])

  return { noticeOpen: closePending, close, acknowledge, cancel }
}
