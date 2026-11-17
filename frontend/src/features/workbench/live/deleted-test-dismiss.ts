/**
 * The two answers to the "Test not found" dialog. Discard returns the canvas
 * to a fresh draft; Keep on canvas leaves the work where it is, unbound from
 * the test that is gone.
 */

import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import { useDeletedTestStore } from '@/features/workbench/stores/deleted-test-store'
import { clearWorkbenchSession, type ReportSessionFailure } from '@/features/workbench/lib/clear-session'
import { alreadyReported } from '@/features/workbench/lib/already-reported'

export interface DismissDeletedTestDeps {
  /** Drops the local run state and its session id. */
  resetWorkbenchRun: () => void
  /** Where a failed session clear is reported. */
  toastError: ReportSessionFailure
  /** Drops the browser-storage draft so the empty canvas leaves nothing behind. */
  clearDraft: () => void
  /** Only the tab that holds the session drops the run and clears it on the server. */
  holdsSession: boolean
}

export function dismissDeletedTest(deps: DismissDeletedTestDeps): void {
  const store = useWorkflowStore.getState()
  useDeletedTestStore.getState().clear()
  store.clearEditingTest()
  store.reset()
  // reset() lowers isCanvasReady and clears the pending fit request, so without
  // a new one the canvas stays behind the loading overlay for the rest of the mount.
  store.requestFitView({ padding: 0.2, duration: 0 })
  deps.clearDraft()
  // The run and the server session belong to the holder; any other tab only mirrors.
  if (!deps.holdsSession) return
  deps.resetWorkbenchRun()
  // The backend session still points at the deleted test; without this the
  // dialog comes back on the next /workbench navigation.
  clearWorkbenchSession(deps.toastError).catch(alreadyReported)
}

/** Leaves the canvas untouched and drops the test identity, so the work saves
 *  as a new test instead of re-answering the same 404. */
export function keepDeletedTestOnCanvas(): void {
  useWorkflowStore.getState().clearEditingTest()
  useDeletedTestStore.getState().clear()
}
