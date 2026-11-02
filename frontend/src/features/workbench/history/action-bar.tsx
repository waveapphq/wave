/**
 * HistoryActionBar - paint-only toolbar for the historical test canvas.
 *
 * Unlike the live `CanvasActionBar`, this toolbar owns a tiny fixed set
 * of controls: the environment the run used (read-only label, not a
 * selector) and a single "Open in Workbench" button that navigates to
 * the editable test. No Save / Edit / Undo / Redo / Run / Debug / Pause
 * / Step controls because none of them mean anything on a frozen
 * snapshot.
 */

import { type ReactNode } from 'react'
import { ExternalLink, FileBarChart } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EnvReadout } from '@/features/workbench/common/canvas/canvas-action-bar/env-readout'

export interface HistoryActionBarProps {
  /** Environment name used for the run. `null` means "no env recorded". */
  environmentName: string | null
  /** Click handler for the "Report" button (RVIEW-13 entry point). */
  onOpenReport?: () => void
  /** Click handler for the "Open in Workbench" button. */
  onOpenInWorkbench?: () => void
}

export function HistoryActionBar({
  environmentName,
  onOpenReport,
  onOpenInWorkbench,
}: Readonly<HistoryActionBarProps>): ReactNode {
  return (
    <div
      data-testid="canvas-toolbar"
      data-mode="history"
      className="flex h-12 shrink-0 items-center justify-between border-b border-default bg-background px-4"
    >
      {/* Left side: intentionally empty - no Save / Edit / Undo / Redo in
          history mode. The div keeps the flex layout (push right group
          to the right edge). */}
      <div data-testid="toolbar-left-group" className="flex items-center gap-2" />

      {/* Right side: run environment (disabled display) + Open in
          Workbench button. */}
      <div data-testid="toolbar-right-group" className="flex items-center gap-2">
        <EnvReadout environmentName={environmentName} />

        <Button
          data-testid="history-report-button"
          variant="outline"
          size="sm"
          onClick={onOpenReport}
          className="h-8 gap-1.5"
        >
          <FileBarChart className="h-4 w-4" />
          <span className="text-sm">Report</span>
        </Button>

        <Button
          data-testid="open-in-workbench-button"
          variant="default"
          size="sm"
          onClick={onOpenInWorkbench}
          className="h-8 gap-1.5"
        >
          <ExternalLink className="h-4 w-4" />
          <span className="text-sm">Open in Workbench</span>
        </Button>
      </div>
    </div>
  )
}
