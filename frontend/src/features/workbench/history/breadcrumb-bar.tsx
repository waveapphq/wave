/**
 * HistoryBreadcrumbBar - history workbench wrapper over CanvasBreadcrumbBar.
 *
 * Same wiring as LiveBreadcrumbBar but hides the Reset link because the
 * history canvas is read-only.
 */

import { useNavigate } from 'react-router-dom'
import {
  CanvasBreadcrumbBar,
  type WorkflowStatus,
} from '@/features/workbench/common/canvas/chrome/canvas-breadcrumb-bar'
import { useBreadcrumbContext } from '@/features/workbench/hooks/use-breadcrumb-context'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import { useDrillHandler } from '@/features/functions/canvas/use-drill-handler'

export interface HistoryBreadcrumbBarProps {
  status: WorkflowStatus
}

export function HistoryBreadcrumbBar({
  status,
}: Readonly<HistoryBreadcrumbBarProps>) {
  const navigate = useNavigate()
  const { segments, backHref, pendingParents } = useBreadcrumbContext()
  const drillPath = useWorkflowStore((s) => s.drillPath)
  const { popOne, popDrillTo } = useDrillHandler()

  const handleBack = () => {
    if (drillPath.length > 0) {
      popOne()
      return
    }
    /* v8 ignore next - COV-V8-003: defensive guard - back arrow hidden when backHref null */
    if (backHref) navigate(backHref)
  }
  const handleNavigate = (href: string) => {
    const drillMatch = /^#drill-(\d+)$/.exec(href)
    if (drillMatch) {
      const depth = Number(drillMatch[1])
      if (Number.isFinite(depth) && depth >= 0) {
        popDrillTo(depth)
        return
      }
    }
    navigate(href)
  }
  return (
    <CanvasBreadcrumbBar
      path={segments}
      backHref={backHref}
      status={status}
      pendingParents={pendingParents}
      showReset={false}
      onBack={handleBack}
      onNavigate={handleNavigate}
    />
  )
}
