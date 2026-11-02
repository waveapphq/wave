/**
 * CanvasReadOnlyContext
 *
 * Broadcasts the canvas-level read-only flag to descendants inside the
 * ReactFlow subtree (workflow nodes, the block action row, the element
 * config modal). The history canvas wraps its tree with the provider so
 * nested interactive pieces can suppress mutating controls without each
 * one re-deriving the mode from props.
 */

import { createContext, useContext, type ReactNode } from 'react'

const CanvasReadOnlyContext = createContext(false)

export function CanvasReadOnlyProvider({
  value,
  children,
}: Readonly<{ value: boolean; children: ReactNode }>) {
  return (
    <CanvasReadOnlyContext.Provider value={value}>
      {children}
    </CanvasReadOnlyContext.Provider>
  )
}

export function useCanvasReadOnly(): boolean {
  return useContext(CanvasReadOnlyContext)
}
