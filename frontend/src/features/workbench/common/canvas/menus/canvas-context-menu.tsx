/**
 * CanvasContextMenu Component
 *
 * Positioned menu shown on right-clicking the canvas pane (empty area).
 * Items: Paste, Select All, Fit View.
 */

import { useCallback, useEffect, useRef } from 'react'
import { ClipboardPaste, MousePointerSquareDashed, Maximize, SkipForward, ToggleRight, RotateCcw, X, Pause, Check } from 'lucide-react'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import { workbenchApi } from '@/features/workbench/api/workbench'
import { useToast } from '@/components/ui/toast'
import { toFailureDetail } from '@/lib/failure-detail'
import { formatShortcut } from '@/lib/platform'

interface CanvasContextMenuProps {
  open: boolean
  position: { x: number; y: number }
  /** Flow-coordinate position of the right-click - used to place pasted nodes at cursor */
  flowPosition?: { x: number; y: number }
  onClose: () => void
  /** Current execution status - controls Reset item enabled/disabled state */
  executionStatus?: string
  /** Called when Reset menu item is clicked */
  onReset?: () => void
  /** Live workbench session id - when set, breakpoint and debug-option toggles
   *  are also pushed to the running engine via PATCH endpoints. */
  sessionId?: string
}

const menuItemClass =
  'relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground w-full text-left bg-transparent border-0'

const menuItemDisabledClass =
  'relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none opacity-50 pointer-events-none w-full text-left bg-transparent border-0'

/** Pushes a debug change to the live engine, or does nothing when there is no
 *  engine to push to. `consequence` says what the run does if the push fails. */
type DebugPush = (
  call: (sessionId: string) => Promise<unknown>,
  title: string,
  consequence: string,
) => void

/** Without a session the choice is local only: nothing to push, nothing to report. */
const NO_LIVE_SESSION: DebugPush = () => {}

interface MenuItemsProps extends CanvasContextMenuProps {
  pushDebug: DebugPush
}

/** The closed menu subscribes to nothing, and a menu with no live session
 *  needs no way to report a push it never makes. */
export function CanvasContextMenu(props: Readonly<CanvasContextMenuProps>) {
  if (!props.open) return null
  if (props.sessionId === undefined) {
    return <CanvasMenuItems {...props} pushDebug={NO_LIVE_SESSION} />
  }
  return <LiveCanvasContextMenu {...props} sessionId={props.sessionId} />
}

function LiveCanvasContextMenu(props: Readonly<CanvasContextMenuProps & { sessionId: string }>) {
  const { error: toastError } = useToast()
  const { sessionId } = props
  // The canvas keeps the choice the user made, so a push the engine never took
  // is reported by naming what the run does instead.
  const pushDebug = useCallback<DebugPush>(
    (call, title, consequence) => {
      void call(sessionId).catch((err: unknown) => {
        toastError(`${consequence}: ${toFailureDetail(err).message}`, title)
      })
    },
    [sessionId, toastError],
  )
  return <CanvasMenuItems {...props} pushDebug={pushDebug} />
}

function CanvasMenuItems({ position, flowPosition, onClose, executionStatus, onReset, pushDebug }: Readonly<MenuItemsProps>) {
  const paste = useWorkflowStore((state) => state.paste)
  const selectAll = useWorkflowStore((state) => state.selectAll)
  const requestFitView = useWorkflowStore((state) => state.requestFitView)
  const unskipAll = useWorkflowStore((state) => state.unskipAll)
  const enableAll = useWorkflowStore((state) => state.enableAll)
  const clearBreakpoints = useWorkflowStore((state) => state.clearBreakpoints)
  const setDebugOptions = useWorkflowStore((state) => state.setDebugOptions)
  const clipboard = useWorkflowStore((state) => state.clipboard)
  const hasSkippedNodes = useWorkflowStore((state) => state.skippedNodeIds.length > 0)
  const hasDisabledNodes = useWorkflowStore((state) => state.nodes.some((n) => n.data.disabled))
  const breakpointCount = useWorkflowStore((state) => state.breakpoints?.size ?? 0)
  const debugOptions = useWorkflowStore(
    (state) => state.debugOptions ?? { pauseOnFirstBlock: false, pauseOnErrors: false },
  )
  const menuRef = useRef<HTMLDivElement>(null)

  const hasClipboard = !!clipboard && clipboard.nodes.length > 0
  const isExecuting = executionStatus === 'running' || executionStatus === 'paused'
  const resetEnabled = executionStatus === 'passed' || executionStatus === 'failed' || executionStatus === 'stopped'

  // Close on any click outside the menu
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }

    // Use capture phase so it fires before React Flow's own click handlers
    document.addEventListener('mousedown', handleClickOutside, true)
    return () => document.removeEventListener('mousedown', handleClickOutside, true)
  }, [onClose])

  /** Compute paste offset so clipboard nodes center at the right-click flow position */
  const handlePaste = () => {
    if (!hasClipboard) return

    if (flowPosition && clipboard?.nodes.length) {
      // Center the pasted group at the right-click position
      const xs = clipboard.nodes.map((n) => n.position.x)
      const ys = clipboard.nodes.map((n) => n.position.y)
      const centerX = (Math.min(...xs) + Math.max(...xs)) / 2
      const centerY = (Math.min(...ys) + Math.max(...ys)) / 2

      paste({ x: flowPosition.x - centerX, y: flowPosition.y - centerY })
    } else {
      paste()
    }
  }

  return (
    <div
      ref={menuRef}
      role="menu"
      className="fixed z-50 min-w-[8rem] rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
      style={{ left: position.x, top: position.y }}
    >
      <button
        type="button"
        role="menuitem"
        tabIndex={-1}
        aria-disabled={!hasClipboard || isExecuting}
        className={hasClipboard && !isExecuting ? menuItemClass : menuItemDisabledClass}
        onClick={() => {
          if (isExecuting) return
          handlePaste()
          onClose()
        }}
      >
        <ClipboardPaste className="h-4 w-4 mr-2" />
        Paste
        <span aria-hidden="true" className="ml-auto pl-4 text-xs text-muted-foreground">{formatShortcut('V')}</span>
      </button>
      <button
        type="button"
        role="menuitem"
        tabIndex={-1}
        className={menuItemClass}
        onClick={() => {
          selectAll()
          onClose()
        }}
      >
        <MousePointerSquareDashed className="h-4 w-4 mr-2" />
        Select All
        <span aria-hidden="true" className="ml-auto pl-4 text-xs text-muted-foreground">{formatShortcut('A')}</span>
      </button>
      <button
        type="button"
        role="menuitem"
        tabIndex={-1}
        className={menuItemClass}
        onClick={() => {
          requestFitView()
          onClose()
        }}
      >
        <Maximize className="h-4 w-4 mr-2" />
        Fit View
      </button>
      <button
        type="button"
        role="menuitem"
        tabIndex={-1}
        aria-disabled={!hasSkippedNodes}
        className={hasSkippedNodes ? menuItemClass : menuItemDisabledClass}
        onClick={() => {
          if (!hasSkippedNodes) return
          unskipAll()
          onClose()
        }}
      >
        <SkipForward className="h-4 w-4 mr-2" />
        Unskip All
      </button>
      <button
        type="button"
        role="menuitem"
        tabIndex={-1}
        aria-disabled={!hasDisabledNodes || isExecuting}
        className={hasDisabledNodes && !isExecuting ? menuItemClass : menuItemDisabledClass}
        onClick={() => {
          if (!hasDisabledNodes || isExecuting) return
          enableAll()
          onClose()
        }}
      >
        <ToggleRight className="h-4 w-4 mr-2" />
        Enable All
      </button>
      <button
        type="button"
        role="menuitem"
        tabIndex={-1}
        aria-disabled={!resetEnabled}
        className={resetEnabled ? menuItemClass : menuItemDisabledClass}
        onClick={() => {
          if (!resetEnabled) return
          onReset?.()
          onClose()
        }}
      >
        <RotateCcw className="h-4 w-4 mr-2" />
        Reset
      </button>
      <hr className="-mx-1 my-1 h-px border-0 bg-border" />
      <button
        type="button"
        role="menuitem"
        tabIndex={-1}
        aria-disabled={breakpointCount === 0}
        className={breakpointCount > 0 ? menuItemClass : menuItemDisabledClass}
        onClick={() => {
          if (breakpointCount === 0) return
          clearBreakpoints()
          pushDebug(
            (sid) => workbenchApi.updateWorkbenchBreakpoints(sid, []),
            'Clear Breakpoints Failed',
            'The run still stops at the breakpoints you cleared',
          )
          onClose()
        }}
      >
        <X className="h-4 w-4 mr-2" />
        Clear Breakpoints
      </button>
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={debugOptions.pauseOnErrors}
        tabIndex={-1}
        className={menuItemClass}
        onClick={() => {
          const nextValue = !debugOptions.pauseOnErrors
          setDebugOptions({ ...debugOptions, pauseOnErrors: nextValue })
          pushDebug(
            (sid) => workbenchApi.updateDebugOptions(sid, { pause_on_errors: nextValue }),
            'Pause on Error Not Applied',
            'The run keeps the previous setting',
          )
          onClose()
        }}
      >
        <Pause className="h-4 w-4 mr-2" />
        Pause on Error
        {debugOptions.pauseOnErrors && <Check className="ml-auto pl-4 box-content h-4 w-4" />}
      </button>
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={debugOptions.pauseOnFirstBlock}
        tabIndex={-1}
        className={menuItemClass}
        onClick={() => {
          const nextValue = !debugOptions.pauseOnFirstBlock
          setDebugOptions({ ...debugOptions, pauseOnFirstBlock: nextValue })
          pushDebug(
            (sid) => workbenchApi.updateDebugOptions(sid, { pause_on_first_block: nextValue }),
            'Pause on First Block Not Applied',
            'The run keeps the previous setting',
          )
          onClose()
        }}
      >
        <Pause className="h-4 w-4 mr-2" />
        Pause on First Block
        {debugOptions.pauseOnFirstBlock && <Check className="ml-auto pl-4 box-content h-4 w-4" />}
      </button>
    </div>
  )
}
