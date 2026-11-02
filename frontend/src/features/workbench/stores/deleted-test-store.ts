/**
 * The open test is gone from the server. One place raises the "Test not found"
 * dialog, so every surface that can meet a 404 on the open test - load, run,
 * save - reports it the same way without threading a callback through the tree.
 */

import { create } from 'zustand'

/** The test the dialog names. */
export interface DeletedTestInfo {
  testId: string
  testName: string | null
}

interface DeletedTestState {
  info: DeletedTestInfo | null
  raise: (info: DeletedTestInfo) => void
  clear: () => void
}

export const useDeletedTestStore = create<DeletedTestState>((set) => ({
  info: null,
  raise: (info: DeletedTestInfo) => set({ info }),
  clear: () => set({ info: null }),
}))

/** Routes a not-found failure to the dialog. True when it took the failure, so
 *  the caller returns instead of reporting it as an unknown error. */
export function reportTestNotFound(err: unknown, info: DeletedTestInfo): boolean {
  if ((err as { status?: number } | null)?.status !== 404) return false
  useDeletedTestStore.getState().raise(info)
  return true
}
