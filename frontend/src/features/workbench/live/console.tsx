/**
 * LiveConsole - live-mode wrapper over `ConsolePanel`.
 *
 * Takes the live workbench's `sessionId` so the console subscribes to
 * the live WebSocket log stream. `collapsed` and `onCollapsedChange`
 * come from the shell's `usePanelState`.
 */

import { ConsolePanel } from '@/features/workbench/common/console/console-panel'
import type { PanelSlotProps } from '@/features/workbench/common/shell'

export interface LiveConsoleProps extends PanelSlotProps {
  sessionId?: string | null
}

export function LiveConsole({
  sessionId,
  collapsed,
  onCollapsedChange,
}: Readonly<LiveConsoleProps>) {
  return (
    <ConsolePanel
      sessionId={sessionId}
      collapsed={collapsed}
      onCollapsedChange={onCollapsedChange}
    />
  )
}
