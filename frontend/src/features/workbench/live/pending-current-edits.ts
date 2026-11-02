/** Open Edit windows holding an unsaved change, keyed by name and scope, for the run-conflict guard (VMGR-64). */

import { create } from 'zustand'

import { scopedVariableKey } from '@/features/workbench/lib/variable-scope-key'

export interface PendingWindowEdit {
  name: string
  /** Node ids from the root canvas inward; absent, empty or null at the root canvas. */
  functionPath?: string[] | null
  /** The window holds a definition change, not only a Current value. */
  definitionChanged?: boolean
  /** Runs the window's own Save, confirms included; rejects when a write did not land or a confirm was canceled. */
  save: () => Promise<void>
  /** Returns the window to its saved state. */
  drop: () => void
}

/** The person canceled one of the confirms a window's Save asks. */
export class SaveCanceledError extends Error {
  constructor() {
    super('The save was canceled')
    this.name = 'SaveCanceledError'
  }
}

interface PendingCurrentEditsState {
  pending: Map<string, PendingWindowEdit>
  setPending: (edit: PendingWindowEdit) => void
  clearPending: (name: string, functionPath?: string[] | null) => void
  clearAll: () => void
}

export const usePendingCurrentEdits = create<PendingCurrentEditsState>((set) => ({
  pending: new Map(),
  setPending: (edit) =>
    set((state) => {
      const next = new Map(state.pending)
      next.set(scopedVariableKey(edit.name, edit.functionPath), edit)
      return { pending: next }
    }),
  clearPending: (name, functionPath) =>
    set((state) => {
      const key = scopedVariableKey(name, functionPath)
      if (!state.pending.has(key)) return state
      const next = new Map(state.pending)
      next.delete(key)
      return { pending: next }
    }),
  clearAll: () => set((state) => (state.pending.size === 0 ? state : { pending: new Map() })),
}))
