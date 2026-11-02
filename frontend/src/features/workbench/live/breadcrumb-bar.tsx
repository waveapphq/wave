/**
 * LiveBreadcrumbBar - live workbench wrapper over CanvasBreadcrumbBar.
 *
 * Consumes the shared workbench breadcrumb-context hook so segments + back
 * href reflect the current nav origin / tracked execution. Status + onReset
 * are forwarded from the live container.
 */

import { useNavigate } from 'react-router-dom'
import {
  CanvasBreadcrumbBar,
  type WorkflowStatus,
} from '@/features/workbench/common/canvas/chrome/canvas-breadcrumb-bar'
import { useBreadcrumbContext } from '@/features/workbench/hooks/use-breadcrumb-context'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import { useDrillHandler } from '@/features/functions/canvas/use-drill-handler'

export interface LiveBreadcrumbBarProps {
  status: WorkflowStatus
  artifactsCount?: number
  testDataUploading?: boolean
  testDataInterrupted?: boolean
  onReset?: () => void
  onOpenArtifacts?: () => void
  onOpenTestData?: () => void
}

export function LiveBreadcrumbBar({
  status,
  artifactsCount,
  testDataUploading,
  testDataInterrupted,
  onReset,
  onOpenArtifacts,
  onOpenTestData,
}: Readonly<LiveBreadcrumbBarProps>) {
  const navigate = useNavigate()
  const { segments, backHref, pendingParents } = useBreadcrumbContext()
  const drillPath = useWorkflowStore((s) => s.drillPath)
  const functionViewMode = useWorkflowStore((s) => s.functionViewMode)
  const { popOne, popDrillTo } = useDrillHandler()

  // The library View's own Function is drill entry 1, so its root sits one level down (FN-BC-4).
  const rootDepth = functionViewMode ? 1 : 0
  const handleBack = () => {
    if (drillPath.length > rootDepth) {
      popOne()
      return
    }
    /* v8 ignore next - COV-V8-003: defensive guard - back arrow hidden when backHref null */
    if (backHref) navigate(backHref)
  }

  // Intermediate segment click: a function-segment's id is the 1-indexed
  // depth as a string (set in use-breadcrumb-context). Clicking segment
  // depth=N truncates drillPath to length N (the user views that segment
  // as their inside-Function context; the deeper levels go away). The Test
  // segment gets `#drill-0` which truncates to length 0 (Test root). For
  // any other segment type, parseFunctionDepth returns null and we fall
  // back to navigate(href).
  const handleNavigate = (href: string) => {
    const fnDepth = parseFunctionDepth(href, segments)
    if (fnDepth !== null) {
      popDrillTo(fnDepth)
      return
    }
    navigate(href)
  }

  return (
    <CanvasBreadcrumbBar
      path={segments}
      backHref={backHref}
      status={status}
      artifactsCount={artifactsCount}
      testDataUploading={testDataUploading}
      testDataInterrupted={testDataInterrupted}
      pendingParents={pendingParents}
      onBack={handleBack}
      onReset={onReset}
      onOpenArtifacts={onOpenArtifacts}
      onOpenTestData={onOpenTestData}
      onNavigate={handleNavigate}
    />
  )
}

/**
 * If the given href belongs to a function drill segment, return its 1-indexed
 * depth so the caller can dispatch popDrillTo(depth - 1). Otherwise return
 * null and let the caller fall back to router navigation.
 *
 * The hook (`use-breadcrumb-context`) sets each intermediate function
 * segment's href to `#drill-<depth>`. The previously-leaf Test segment
 * (now intermediate when drilled) gets `#drill-0` which maps to
 * popDrillTo(0) - clearing every drill level back to the Test root. Other
 * segment hrefs (e.g. `/suites/x`) never match the regex, so the caller
 * falls through to router navigation.
 *
 * The `segments` argument is retained on the signature so future drill-segment
 * variants (e.g. id-only segments produced by alternate hook wirings) can
 * resolve depth via a lookup without changing the contract; the regex covers
 * every production case.
 */
function parseFunctionDepth(
  href: string,
  segments: Array<{ type: string; href?: string; id?: string }>,
): number | null {
  const drillMatch = /^#drill-(\d+)$/.exec(href)
  if (drillMatch) {
    const depth = Number(drillMatch[1])
    if (Number.isFinite(depth) && depth >= 0) return depth
  }
  // Fallback for alternate wirings: look up the segment by href or id.
  const match = segments.find(
    /* v8 ignore next - COV-V8-003: fallback only reachable when href !== '#drill-N' but the bar's onNavigate fires with a function-segment href; the standard hook always sets the #drill-N format */
    (s) => s.type === 'function' && (s.href === href || s.id === href),
  )
  if (!match?.id) return null
  const depth = Number(match.id)
  if (!Number.isFinite(depth) || depth < 1) return null
  return depth
}
