/**
 * Canvas Breadcrumb / Status Bar - REQ-5.2.1.25
 *
 * Renders the workbench canvas's top chrome:
 *   - Back arrow (visible when backHref is set)
 *   - Breadcrumb path built from shadcn Breadcrumb primitives. Each segment
 *     carries an entity icon and a multiline-tooltip-aware truncating label.
 *     When the path overflows, all parent segments collapse into a single
 *     actionable `...` button whose popover lists the parents.
 *   - Test Data chip (rendered only when onOpenTestData is provided)
 *   - Session Artifacts chip (rendered only when onOpenArtifacts is provided)
 *   - Reset link (hidden in history mode via showReset=false)
 *   - Status pill
 *
 * The overflow cascade is driven by the internal `useBreadcrumbOverflow` hook,
 * which measures the rendered path against the available width via
 * ResizeObserver and trips the collapse threshold.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Archive, ArrowLeft, FolderOpen, Loader2, MoreHorizontal, RotateCcw } from 'lucide-react'
import { Separator } from '@/components/ui/separator'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { BreadcrumbSegmentIcon } from '@/components/shared/breadcrumb-segment-icon'
import type { BreadcrumbSegmentType } from '@/components/shared/breadcrumb-segment-icon'
import { TruncatedName } from '@/components/shared/truncated-name'
import { EntityListPopover } from '@/components/shared/entity-list-popover'
import { Skeleton } from '@/components/ui/skeleton'
import type { BreadcrumbSegment } from '@/features/workbench/hooks/use-breadcrumb-context'
import { cn } from '@/lib/utils'

export type WorkflowStatus =
  | 'idle'
  | 'running'
  | 'paused'
  | 'passed'
  | 'failed'
  | 'stopped'
  | 'skipped'

export interface CanvasBreadcrumbBarProps {
  /** Breadcrumb segments from root to current. */
  path: BreadcrumbSegment[]
  /** Back-button target href (drives back-arrow visibility). */
  backHref: string | null
  /** Current workflow execution status. */
  status?: WorkflowStatus
  /** Whether to render the Reset link (hidden in history mode). */
  showReset?: boolean
  /** Session artifact count driving the chip badge (badge hidden at 0). */
  artifactsCount?: number
  /**
   * Parent-segment placeholders to render while their names are still loading.
   * Each entry renders a skeleton in place of a future segment so the layout
   * doesn't pop when async fetches resolve.
   */
  pendingParents?: ReadonlyArray<{ type: BreadcrumbSegmentType }>
  /** Fires when back arrow is clicked. */
  onBack?: () => void
  /** Fires when the Reset link is clicked (confirmation is the caller's concern). */
  onReset?: () => void
  /** Opens the Session Artifacts sheet; the chip renders only when provided. */
  onOpenArtifacts?: () => void
  /** Opens the Test Data sheet; the chip renders only when provided. */
  onOpenTestData?: () => void
  /** At least one of this test's files is on its way in (TDATA-16). */
  testDataUploading?: boolean
  /** At least one upload did not finish and nobody has dismissed it (TDATA-16). */
  testDataInterrupted?: boolean
  /** Fires when an intermediate segment is clicked (passes the segment's href). */
  onNavigate?: (href: string) => void
}

const STATUS_CONFIG: Record<
  WorkflowStatus,
  { label: string; color: string; canReset: boolean; pulse?: boolean; dotColor: string }
> = {
  idle: { label: 'Idle', color: 'text-muted-foreground', canReset: false, dotColor: 'bg-muted-foreground' },
  running: { label: 'Running', color: 'text-blue-500', canReset: false, pulse: true, dotColor: 'bg-blue-500' },
  paused: { label: 'Paused', color: 'text-amber-500', canReset: false, dotColor: 'bg-amber-500' },
  passed: { label: 'Passed', color: 'text-green-500', canReset: true, dotColor: 'bg-green-500' },
  failed: { label: 'Failed', color: 'text-red-500', canReset: true, dotColor: 'bg-red-500' },
  stopped: { label: 'Stopped', color: 'text-muted-foreground', canReset: true, dotColor: 'bg-muted-foreground' },
  skipped: { label: 'Skipped', color: 'text-amber-500', canReset: true, dotColor: 'bg-amber-500' },
}

const SEGMENT_LINK_CLASS =
  'flex items-center gap-1.5 px-2 py-1 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-subtle transition-colors no-underline shrink-0'
const SEGMENT_PAGE_CLASS =
  'flex items-center gap-1.5 px-2 py-1 rounded-md text-sm font-medium text-foreground cursor-default min-w-0 flex-1'
const LEAF_TRUNCATE_CLASS = 'text-sm font-medium min-w-0 max-w-none flex-1'
const COLLAPSE_BUTTON_CLASS =
  'inline-flex items-center justify-center px-2 py-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-subtle transition-colors shrink-0'
/** Shared by the Test Data and Artifacts chips (TDATA-3: same size). */
const CHIP_CLASS = 'flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground'
const CHIP_ICON_CLASS = 'h-3.5 w-3.5'

const UPLOADING_LABEL = 'Uploading'
const INTERRUPTED_LABEL = 'An upload did not finish'
const BOTH_LABEL = 'Uploading; an upload did not finish'

interface TestDataStateProps {
  uploading: boolean
  interrupted: boolean
}

/** The chip's own state: the spinner, the exclamation mark, or both (TDATA-16). */
function TestDataChipState({ uploading, interrupted }: Readonly<TestDataStateProps>) {
  if (!uploading && !interrupted) return null
  let label = interrupted ? INTERRUPTED_LABEL : UPLOADING_LABEL
  if (uploading && interrupted) label = BOTH_LABEL
  return (
    <span
      data-testid="breadcrumb-testdata-state"
      data-uploading={uploading ? 'true' : 'false'}
      data-interrupted={interrupted ? 'true' : 'false'}
      className="relative flex h-4 w-4 shrink-0 items-center justify-center"
    >
      {uploading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      {interrupted && (
        <span aria-hidden="true" className="absolute text-[11px] font-bold leading-none text-error">
          !
        </span>
      )}
      {/* The chip's aria-label names the button, so the state only carries as a live region. */}
      <span aria-live="polite" className="sr-only">
        {label}
      </span>
    </span>
  )
}

/**
 * Measures whether the rendered breadcrumb path overflows its container.
 * The path collapses to state B (`...` parents + leaf) the moment scrollWidth
 * exceeds clientWidth with a 1px slack.
 *
 * Re-measures whenever the path content changes (segments grow, leaf label
 * resolves, parent skeletons swap in) AND whenever the ol element resizes
 * (parent grows / shrinks). useLayoutEffect ensures the measurement runs
 * after every layout pass so the cascade keeps up with the actual DOM.
 */
function useBreadcrumbOverflow(
  navRef: React.RefObject<HTMLElement | null>,
  contentToken: string,
): boolean {
  const [shouldCollapse, setShouldCollapse] = useState(false)
  useLayoutEffect(() => {
    const nav = navRef.current
    /* v8 ignore next - COV-V8-003: ref guard for SSR / unmount race */
    if (!nav) return
    const measure = () => {
      setShouldCollapse(nav.scrollWidth > nav.clientWidth + 1)
    }
    measure()
    /* v8 ignore next 4 - COV-V8-003: ResizeObserver path exercised at runtime */
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(measure)
      observer.observe(nav)
      return () => observer.disconnect()
    }
  }, [navRef, contentToken])
  return shouldCollapse
}

function SegmentLink({
  segment,
  onNavigate,
}: Readonly<{ segment: BreadcrumbSegment; onNavigate?: (href: string) => void }>) {
  /* v8 ignore next - COV-V8-003: defensive href guard - only called when href is set */
  const href = segment.href ?? '#'
  // Parent labels are plain spans at natural width (no per-segment truncate cap).
  // The cascade collapses parents to `...` once the row would overflow - then
  // the leaf gets the room. Truncating each parent independently would hide
  // the cascade signal and we'd end up with multiple ellipses + clipped leaf.
  return (
    <a
      href={href}
      className={SEGMENT_LINK_CLASS}
      onClick={(e) => {
        e.preventDefault()
        onNavigate?.(href)
      }}
    >
      <BreadcrumbSegmentIcon type={segment.type} />
      {segment.isPending ? (
        <Skeleton className="h-4 w-24" />
      ) : (
        <span className="text-sm whitespace-nowrap">{segment.label}</span>
      )}
    </a>
  )
}

export function CanvasBreadcrumbBar({
  path,
  backHref,
  status = 'idle',
  showReset = true,
  artifactsCount = 0,
  pendingParents,
  onBack,
  onReset,
  onOpenArtifacts,
  onOpenTestData,
  testDataUploading = false,
  testDataInterrupted = false,
  onNavigate,
}: Readonly<CanvasBreadcrumbBarProps>): ReactNode {
  const statusConfig = STATUS_CONFIG[status]

  const navRef = useRef<HTMLOListElement | null>(null)
  // Token whose change re-triggers the overflow measurement (path content
  // updates or pending-parent placeholder churn change the rendered width,
  // but the nav element's own size may stay the same so ResizeObserver alone
  // wouldn't fire).
  const contentToken = useMemo(
    () =>
      path
        .map((s) => `${s.type}:${s.label}:${s.isPending ? 'p' : 'l'}`)
        .concat((pendingParents ?? []).map((p) => `pending-${p.type}`))
        .join('|'),
    [path, pendingParents],
  )
  const detectedOverflow = useBreadcrumbOverflow(navRef, contentToken)
  // Stable cascade state: once we decide to collapse parents for a given
  // content set, stay collapsed even if the resulting layout no longer
  // overflows. Collapsing increases room for the leaf which would otherwise
  // flip detection off and oscillate.
  const [shouldCollapse, setShouldCollapse] = useState(false)
  useEffect(() => {
    setShouldCollapse(false)
  }, [contentToken])
  useEffect(() => {
    if (detectedOverflow) setShouldCollapse(true)
  }, [detectedOverflow])
  // Secondary trigger: when the leaf's TruncatedName starts clipping, the
  // row is over budget even if the ol's own scrollWidth comparison didn't
  // catch it (e.g. shrink-0 parents fit, but the leaf gets squeezed).
  const handleLeafTruncatedChange = useCallback((isTruncated: boolean) => {
    if (isTruncated) setShouldCollapse(true)
  }, [])

  const showBackArrow = backHref !== null

  // Partition path into parents + leaf for collapse rendering.
  const { parents, leaf } = useMemo(() => {
    /* v8 ignore next - COV-V8-003: empty-path guard, hook always returns at least 1 segment */
    if (path.length === 0) return { parents: [] as BreadcrumbSegment[], leaf: null }
    return {
      parents: path.slice(0, -1),
      /* v8 ignore next - COV-V8-003: `?? null` fallback - path is non-empty here per the guard above */
      leaf: path.at(-1) ?? null,
    }
  }, [path])

  return (
    <div
      data-testid="canvas-breadcrumb"
      className="flex h-11 shrink-0 items-center justify-between border-b border-default bg-muted/30 px-4"
    >
      {/* Left side: back arrow + path */}
      <div className="flex items-center gap-2 min-w-0 flex-1">
        {showBackArrow && (
          <Button
            data-testid="breadcrumb-back-arrow"
            variant="ghost"
            size="sm"
            onClick={onBack}
            className="h-7 w-7 p-0 shrink-0"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">Go back</span>
          </Button>
        )}
        <Breadcrumb data-testid="breadcrumb-path" className="min-w-0 flex-1 py-0 overflow-hidden">
          <ol
            ref={navRef}
            className="flex items-center min-w-0 overflow-hidden"
            style={{ flexWrap: 'nowrap' }}
          >
            {!shouldCollapse &&
              pendingParents?.map((pending, index) => (
                <BreadcrumbItemWithSeparator key={`pending-${pending.type}-${index}`}>
                  <span
                    className="flex items-center gap-1.5 px-2 py-1"
                    data-testid={`breadcrumb-pending-${pending.type}`}
                  >
                    <BreadcrumbSegmentIcon type={pending.type} />
                    <Skeleton className="h-4 w-24" />
                  </span>
                </BreadcrumbItemWithSeparator>
              ))}
            {/* v8 ignore start - COV-V8-003: id fallback chain (segment.id ?? segment.href ?? segment.label) inside map callback */}
            {!shouldCollapse &&
              parents.map((segment) => (
                <BreadcrumbItemWithSeparator key={`${segment.type}:${segment.id ?? segment.href ?? segment.label}`}>
                  <SegmentLink segment={segment} onNavigate={onNavigate} />
                </BreadcrumbItemWithSeparator>
              ))}
            {/* v8 ignore stop */}
            {shouldCollapse && parents.length > 0 && (
              <BreadcrumbItemWithSeparator>
                <EntityListPopover
                  triggerLabel={
                    <>
                      {/* Hidden parent icons keep the per-segment-icon DOM
                          count parity without exposing parent labels
                          in the inline path while collapsed. */}
                      <span className="hidden" aria-hidden="true">
                        {/* v8 ignore start - COV-V8-003: id fallback chain inside map callback */}
                        {parents.map((segment) => (
                          <BreadcrumbSegmentIcon
                            key={`hidden-${segment.id ?? segment.href ?? segment.label}`}
                            type={segment.type}
                          />
                        ))}
                        {/* v8 ignore stop */}
                      </span>
                      <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                    </>
                  }
                  triggerClassName={COLLAPSE_BUTTON_CLASS}
                  triggerTestId="breadcrumb-collapse-button"
                  listTestId="breadcrumb-parents-list"
                  triggerAriaLabel="Show parent path"
                  label="Parent path"
                  entities={parents.map((segment) => ({
                    /* v8 ignore next - COV-V8-003: id fallback chain */
                    id: segment.id ?? segment.href ?? segment.label,
                    name: segment.label,
                    href: segment.href,
                    icon: <BreadcrumbSegmentIcon type={segment.type} />,
                  }))}
                  onNavigate={onNavigate}
                />
              </BreadcrumbItemWithSeparator>
            )}
            {leaf && (
              <BreadcrumbItem className="min-w-0 flex-1">
                <BreadcrumbPage className={SEGMENT_PAGE_CLASS}>
                  <BreadcrumbSegmentIcon type={leaf.type} />
                  {leaf.isPending ? (
                    <Skeleton className="h-4 w-32" />
                  ) : (
                    <TruncatedName
                      value={leaf.label}
                      className={LEAF_TRUNCATE_CLASS}
                      onTruncatedChange={handleLeafTruncatedChange}
                    />
                  )}
                </BreadcrumbPage>
              </BreadcrumbItem>
            )}
          </ol>
        </Breadcrumb>
      </div>
      {/* Right side: test data + artifacts chips, reset, status */}
      <div className="flex items-center gap-3 shrink-0 pl-3">
        {onOpenTestData && (
          <>
            <button
              data-testid="breadcrumb-testdata-chip"
              type="button"
              aria-label="Test data"
              onClick={onOpenTestData}
              className={CHIP_CLASS}
            >
              <FolderOpen className={CHIP_ICON_CLASS} aria-hidden="true" />
              <span>Test Data</span>
              <TestDataChipState
                uploading={testDataUploading}
                interrupted={testDataInterrupted}
              />
            </button>
            <Separator orientation="vertical" className="h-5" />
          </>
        )}
        {onOpenArtifacts && (
          <>
            <button
              data-testid="breadcrumb-artifacts-chip"
              type="button"
              aria-label="Session artifacts"
              onClick={onOpenArtifacts}
              className={CHIP_CLASS}
            >
              <Archive className={CHIP_ICON_CLASS} aria-hidden="true" />
              <span>Artifacts</span>
              {artifactsCount > 0 && (
                <Badge variant="primary" className="px-1.5 py-0 text-[11px] leading-4">
                  {artifactsCount}
                </Badge>
              )}
            </button>
            <Separator orientation="vertical" className="h-5" />
          </>
        )}
        {showReset && (
          <>
            <button
              data-testid="breadcrumb-reset-link"
              type="button"
              onClick={onReset}
              disabled={!statusConfig.canReset}
              className={cn(
                'flex items-center gap-1 text-sm',
                statusConfig.canReset
                  ? 'text-muted-foreground hover:text-foreground'
                  : 'text-muted-foreground/50 cursor-not-allowed',
              )}
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Reset</span>
            </button>
            <Separator orientation="vertical" className="h-5" />
          </>
        )}
        <div
          data-testid="workflow-status"
          data-status={status}
          className={cn('flex items-center gap-1.5 text-sm', statusConfig.color)}
        >
          <span
            aria-hidden="true"
            className={cn(
              'inline-block h-2 w-2 rounded-full',
              statusConfig.dotColor,
              statusConfig.pulse && 'animate-pulse',
            )}
          />
          <span>{statusConfig.label}</span>
        </div>
      </div>
    </div>
  )
}

/**
 * BreadcrumbItem + trailing `/` separator. Renders the separator as the
 * shared `/` divider (children override) instead of the default chevron.
 */
function BreadcrumbItemWithSeparator({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <>
      <BreadcrumbItem>{children}</BreadcrumbItem>
      <BreadcrumbSeparator className="text-muted-foreground mx-0.5">/</BreadcrumbSeparator>
    </>
  )
}
