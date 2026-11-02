/**
 * What this tab is currently sending into a test's Test Data (TDATA-16).
 *
 * The server knows about an upload from its first byte, which is what every
 * other session watches. This tab knows about its own from the moment the
 * person picks the file, and goes on knowing after the Test Data sheet is
 * closed, so the chip can carry the state either way.
 */

import { create } from 'zustand'

interface TestDataUploadState {
  /** Test id -> the ids of the uploads this tab has in flight for that test. */
  inFlight: Record<string, string[]>
  begin: (testId: string, uploadId: string) => void
  end: (testId: string, uploadId: string) => void
}

const NONE: string[] = []

export const useTestDataUploadStore = create<TestDataUploadState>((set) => ({
  inFlight: {},
  begin: (testId, uploadId) =>
    set((state) => ({
      inFlight: { ...state.inFlight, [testId]: [...(state.inFlight[testId] ?? []), uploadId] },
    })),
  end: (testId, uploadId) =>
    set((state) => {
      const left = (state.inFlight[testId] ?? []).filter((id) => id !== uploadId)
      const { [testId]: _dropped, ...rest } = state.inFlight
      return { inFlight: left.length > 0 ? { ...rest, [testId]: left } : rest }
    }),
}))

/** The ids this tab is sending for one test; a stable empty array when it sends none. */
export function useOwnUploadIds(testId: string | null): string[] {
  return useTestDataUploadStore((state) => (testId === null ? NONE : state.inFlight[testId] ?? NONE))
}
