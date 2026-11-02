/**
 * WorkbenchShell - shared layout for live and history modes.
 *
 * Owns only the layout: the outer `workbench-page` div, the action-bar
 * row, the breadcrumb bar, the palette strip, the canvas area, and the
 * two collapsible `ResizablePanel`s (console and variable manager). It
 * has no mode knowledge; it takes ReactNode slots and renders them.
 * `renderConsole` and `renderVariableManager` are render-props because
 * the shell owns `usePanelState` and threads `collapsed` /
 * `onCollapsedChange` into the collapsible-aware wrappers.
 *
 * Live wrappers live in `features/workbench/live/*`; history wrappers
 * live in `features/workbench/history/*`. Each mode's container composes
 * its wrappers and hands them to this shell.
 */

import { type ReactNode } from 'react'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable'
import { usePanelState } from '@/features/workbench/common/use-panel-state'

export interface PanelSlotProps {
  collapsed: boolean
  onCollapsedChange: (collapsed: boolean) => void
}

export interface WorkbenchShellProps {
  /** Tagged on the outer div for diagnostics and test assertions. */
  mode?: 'live' | 'history'
  actionBar: ReactNode
  breadcrumbBar: ReactNode
  /** Session-ownership mirror banner strip, below the breadcrumb bar. */
  mirrorBanner?: ReactNode
  palette: ReactNode
  canvas: ReactNode
  renderConsole: (slot: PanelSlotProps) => ReactNode
  renderVariableManager: (slot: PanelSlotProps) => ReactNode
}

export function WorkbenchShell({
  mode = 'live',
  actionBar,
  breadcrumbBar,
  mirrorBanner,
  palette,
  canvas,
  renderConsole,
  renderVariableManager,
}: Readonly<WorkbenchShellProps>): ReactNode {
  const {
    consolePanelRef,
    consoleCollapsed,
    setConsoleCollapsed,
    handleConsoleCollapsedChange,
    varManagerPanelRef,
    varManagerCollapsed,
    setVarManagerCollapsed,
    handleVarManagerCollapsedChange,
  } = usePanelState()

  return (
    <div
      data-testid="workbench-page"
      data-mode={mode}
      className="flex h-full flex-col"
    >
      <div data-testid="canvas-action-bar" className="contents">
        {actionBar}
      </div>
      {breadcrumbBar}
      {mirrorBanner}
      <div data-testid="canvas-main-content" className="flex flex-1 overflow-hidden">
        <div data-testid="palette-panel" className="contents">
          {palette}
        </div>
        <ResizablePanelGroup orientation="horizontal">
          <ResizablePanel minSize="30%">
            <ResizablePanelGroup orientation="vertical">
              <ResizablePanel minSize="30%">
                <div className="relative h-full">{canvas}</div>
              </ResizablePanel>
              {/* v8 ignore next 2 - COV-BRANCH-175 */}
              <ResizableHandle
                orientation="vertical"
                id="console-resize-handle"
                /* v8 ignore next - COV-BRANCH-197 */
                style={consoleCollapsed ? { display: 'none' } : undefined}
              />
              <ResizablePanel
                panelRef={consolePanelRef}
                collapsible
                collapsedSize={48}
                defaultSize="20%"
                minSize={100}
                maxSize="60%"
                /* v8 ignore start - COV-BRANCH-175 */
                onResize={(panelSize, _id, prevPanelSize) => {
                  if (prevPanelSize === undefined) {
                    queueMicrotask(() => consolePanelRef.current?.collapse())
                    return
                  }
                  setConsoleCollapsed(panelSize.inPixels <= 48)
                }}
                /* v8 ignore stop */
              >
                {renderConsole({
                  collapsed: consoleCollapsed,
                  onCollapsedChange: handleConsoleCollapsedChange,
                })}
              </ResizablePanel>
            </ResizablePanelGroup>
          </ResizablePanel>
          {/* v8 ignore next - COV-BRANCH-176 */}
          <ResizableHandle
            id="variable-manager-resize-handle"
            style={varManagerCollapsed ? { display: 'none' } : undefined}
          />
          <ResizablePanel
            panelRef={varManagerPanelRef}
            className="min-w-0"
            collapsible
            collapsedSize={64}
            defaultSize={320}
            minSize={240}
            maxSize="60%"
            /* v8 ignore start - COV-BRANCH-176 */
            onResize={(panelSize, _id, prevPanelSize) => {
              if (prevPanelSize === undefined) return
              setVarManagerCollapsed(panelSize.inPixels <= 64)
            }}
            /* v8 ignore stop */
          >
            {renderVariableManager({
              collapsed: varManagerCollapsed,
              onCollapsedChange: handleVarManagerCollapsedChange,
            })}
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  )
}
