/**
 * ExecutionConsole
 *
 * Thin wrapper around the Workbench ConsolePanel. The execution id doubles
 * as the workbench session id by design, so the live
 * log topic `log:{execution_id}` on the existing WebSocket infrastructure
 * already carries the right entries for tracked executions. Reusing the
 * Workbench console panel gives Execution Detail the same level filter,
 * settings popover, virtualized content, and collapse behavior without
 * duplicating any of it.
 *
 * Sizing + collapse are driven by the parent's controlled state (the
 * enclosing ResizablePanel + collapsed/onCollapsedChange props mirror the
 * Workbench container exactly).
 */

import { ConsolePanel } from '@/features/workbench/common/console/console-panel'

export interface ExecutionConsoleProps {
  executionId: string
  testId?: string
  collapsed: boolean
  onCollapsedChange: (collapsed: boolean) => void
}

export function ExecutionConsole({
  executionId,
  testId,
  collapsed,
  onCollapsedChange,
}: Readonly<ExecutionConsoleProps>) {
  return (
    <div data-testid={testId} className="h-full">
      <ConsolePanel
        sessionId={executionId}
        collapsed={collapsed}
        onCollapsedChange={onCollapsedChange}
      />
    </div>
  )
}
