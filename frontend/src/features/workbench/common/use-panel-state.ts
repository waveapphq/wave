/**
 * Panel State Hook - Console and Variable Manager panel collapse/expand state
 *
 * Manages the collapsible state for the console and variable manager panels,
 * syncing with ResizablePanel imperative handles.
 */

import { useState, useCallback, useRef } from 'react'
import { type PanelImperativeHandle } from 'react-resizable-panels'

export interface PanelStateResult {
  // Console panel
  consolePanelRef: React.RefObject<PanelImperativeHandle | null>
  consoleCollapsed: boolean
  setConsoleCollapsed: (collapsed: boolean) => void
  handleConsoleCollapsedChange: (collapsed: boolean) => void

  // Variable manager panel
  varManagerPanelRef: React.RefObject<PanelImperativeHandle | null>
  varManagerCollapsed: boolean
  setVarManagerCollapsed: (collapsed: boolean) => void
  handleVarManagerCollapsedChange: (collapsed: boolean) => void
}

export function usePanelState(): PanelStateResult {
  // Console panel state
  const consolePanelRef = useRef<PanelImperativeHandle>(null)
  const [consoleCollapsed, setConsoleCollapsed] = useState(true)

  const handleConsoleCollapsedChange = useCallback((collapsed: boolean) => {
    setConsoleCollapsed(collapsed)
    if (collapsed) {
      consolePanelRef.current?.collapse()
    } else {
      consolePanelRef.current?.resize(200)
    }
  }, [])

  // Variable manager panel state
  const varManagerPanelRef = useRef<PanelImperativeHandle>(null)
  const [varManagerCollapsed, setVarManagerCollapsed] = useState(false)

  const handleVarManagerCollapsedChange = useCallback((collapsed: boolean) => {
    setVarManagerCollapsed(collapsed)
    if (collapsed) {
      varManagerPanelRef.current?.collapse()
    } else {
      varManagerPanelRef.current?.resize(320)
    }
  }, [])

  return {
    consolePanelRef,
    consoleCollapsed,
    setConsoleCollapsed,
    handleConsoleCollapsedChange,
    varManagerPanelRef,
    varManagerCollapsed,
    setVarManagerCollapsed,
    handleVarManagerCollapsedChange,
  }
}
