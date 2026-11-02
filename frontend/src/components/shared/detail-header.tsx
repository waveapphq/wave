/**
 * DetailHeader - Shared header for entity detail pages (suites, regressions, executions).
 *
 * Back button + optional entity-type icon + page title + Export and Delete action buttons.
 * When opened from a parent context (e.g. Suite detail from a Regression), the caller
 * supplies a `breadcrumbPrefix` slot (e.g. `<regression-link> /`) rendered before the
 * entity icon so the path reads as `[<-] <icon> <parent name> / <icon> <name>`.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Button } from '@/components/ui/button'
import { ArrowLeft, Download, Play, Trash2 } from 'lucide-react'
import { BreadcrumbSegmentIcon } from '@/components/shared/breadcrumb-segment-icon'
import type { BreadcrumbSegmentType } from '@/components/shared/breadcrumb-segment-icon'
import { TruncatedName } from '@/components/shared/truncated-name'
import { EntityListPopover } from '@/components/shared/entity-list-popover'
import { Skeleton } from '@/components/ui/skeleton'

export interface DetailHeaderProps {
  name: string
  onBack: () => void
  onRun?: () => void
  onExport?: () => void
  onDelete?: () => void
  runTestId?: string
  exportTestId?: string
  deleteTestId?: string
  /**
   * Custom action slot rendered on the right side of the header. When
   * provided, replaces the default Run / Export / Delete buttons entirely
   * so the caller has full control over the action set (e.g. the Execution
   * Detail toolbar which needs Stop / View Running / Re-run in addition to
   * Export / Delete with state-specific visibility).
   */
  actions?: ReactNode
  /**
   * Optional status indicator rendered next to the name (pulsing dot + label
   * for live-state pages such as execution detail).
   */
  statusSlot?: ReactNode
  /** Optional secondary line under the title row, above the divider (e.g. drill meta: finished · count · size). */
  subtitle?: ReactNode
  /**
   * Optional entity type for the leading icon next to the page title.
   * The icon color matches the sidebar convention (regression purple,
   * suite orange, test green, execution blue).
   */
  entityType?: BreadcrumbSegmentType
  /** Optional custom icon slot rendered before the page title (e.g. the report icon tile). */
  titleIcon?: ReactNode
  /**
   * Optional breadcrumb segments rendered before the entity icon + title
   * (e.g. on the Suite detail page when arriving from a Regression).
   * Each prefix entry renders as a clickable link to its href, followed
   * by the `/` separator. Use plain objects so the consumer doesn't have
   * to build the link styling itself.
   */
  breadcrumbPrefix?: ReadonlyArray<{
    type: BreadcrumbSegmentType
    /** When `null`, render a skeleton placeholder so the layout doesn't jump
     *  between empty and loaded states. */
    label: string | null
    href: string
    onNavigate: () => void
  }>
}

const TITLE_TEXT_CLASS = 'text-2xl font-semibold'
const TITLE_NAME_CLASS = 'text-2xl font-semibold min-w-0 max-w-none flex-1'
const PREFIX_LINK_CLASS =
  'flex items-center gap-3 text-2xl font-semibold text-muted-foreground hover:text-foreground transition-colors no-underline min-w-0 shrink-0'
const PREFIX_NAME_CLASS = 'text-2xl font-semibold min-w-0'

export function DetailHeader({
  name,
  onBack,
  onRun,
  onExport,
  onDelete,
  runTestId = 'detail-run-btn',
  exportTestId = 'export-btn',
  deleteTestId = 'delete-btn',
  actions,
  statusSlot,
  subtitle,
  entityType,
  titleIcon,
  breadcrumbPrefix,
}: Readonly<DetailHeaderProps>): ReactNode {
  // Collapse-prefix cascade:
  // - Render state A with the prefix at its natural content width. If the
  //   left row overflows, useLayoutEffect detects it and switches to state B
  //   before paint - so the user never sees the overflow.
  // - Render state B with each prefix replaced by `...` (still clickable),
  //   giving the title room to render at full width.
  // - The title's TruncatedName independently handles state C
  //   (collapsed parents + title still doesn't fit -> ellipsize the title
  //   with the multiline tooltip on hover). Its onTruncatedChange callback
  //   is also wired here so the title's first-render measurement is what
  //   tips the layout into state B even when the prefix alone would fit.
  // - shouldCollapsePrefix never reverts to false on its own; it resets only
  //   when the content token changes (i.e. a different page / different
  //   name). This avoids oscillation when collapsing creates enough room to
  //   un-collapse, which would re-overflow on the next pass.
  const leftRef = useRef<HTMLDivElement | null>(null)
  const [shouldCollapsePrefix, setShouldCollapsePrefix] = useState(false)
  const contentToken = useMemo(() => {
    const prefixToken = (breadcrumbPrefix ?? [])
      .map((p) => [p.type, p.label ?? ''].join(':'))
      .join('>')
    const entityToken = entityType ?? ''
    return [name, entityToken, prefixToken].join('|')
  }, [name, entityType, breadcrumbPrefix])
  // Reset the collapse state whenever the rendered content changes so the
  // next paint re-evaluates from natural widths.
  useEffect(() => {
    setShouldCollapsePrefix(false)
  }, [contentToken])
  useLayoutEffect(() => {
    const el = leftRef.current
    /* v8 ignore next - COV-V8-003: ref guard for SSR / unmount race */
    if (!el) return
    const measure = () => {
      if (el.scrollWidth > el.clientWidth + 1) {
        setShouldCollapsePrefix(true)
      }
    }
    measure()
    /* v8 ignore next 4 - COV-V8-003: ResizeObserver path exercised at runtime */
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(measure)
      observer.observe(el)
      return () => observer.disconnect()
    }
  }, [contentToken])
  const handleTitleTruncatedChange = useCallback((isTitleTruncated: boolean) => {
    if (isTitleTruncated) setShouldCollapsePrefix(true)
  }, [])
  return (
    <div className="border-b px-6 py-4">
      <div className="flex items-center justify-between gap-3">
      <div ref={leftRef} className="flex items-center gap-3 min-w-0 flex-1 overflow-hidden">
        <Button
          variant="ghost"
          size="icon"
          data-testid="detail-back-btn"
          aria-label="Back"
          onClick={onBack}
          className="h-8 w-8 shrink-0"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        {shouldCollapsePrefix && breadcrumbPrefix && breadcrumbPrefix.length > 0 ? (
          // State B: all parents collapse to a single `…` button. Clicking
          // the dots opens a popover listing each parent (icon + name); each
          // entry navigates to its detail page. Mirrors the canvas breadcrumb
          // collapse popover for visual + interaction parity.
          <span
            className="flex items-center gap-3 min-w-0 shrink-0"
            data-testid="detail-breadcrumb-collapsed"
          >
            <EntityListPopover
              triggerLabel={<span className={TITLE_TEXT_CLASS}>…</span>}
              triggerClassName={`${PREFIX_LINK_CLASS} px-2 rounded-md hover:bg-subtle`}
              triggerTestId="detail-breadcrumb-collapse-button"
              listTestId="detail-breadcrumb-parents-list"
              triggerAriaLabel="Show parent path"
              label="Parent path"
              entities={breadcrumbPrefix.map((segment) => ({
                id: `${segment.type}:${segment.href}`,
                /* v8 ignore next - COV-V8-003: nullish fallback for the loading-state placeholder; the popover row label is hidden behind the parent skeleton in practice */
                name: segment.label ?? segment.type,
                href: segment.href,
                icon: <BreadcrumbSegmentIcon type={segment.type} iconClassName="h-4 w-4" />,
              }))}
              onNavigate={(href) => {
                /* v8 ignore next - COV-V8-003: direct lookup on a non-empty array */
                const target = breadcrumbPrefix.find((p) => p.href === href)
                target?.onNavigate()
              }}
            />
            <span className={`${TITLE_TEXT_CLASS} text-muted-foreground shrink-0`} aria-hidden="true">/</span>
          </span>
        ) : (
          breadcrumbPrefix?.map((segment) => (
            <span
              key={`${segment.type}:${segment.href}`}
              className="flex items-center gap-3 min-w-0 shrink-0"
              data-testid={`detail-breadcrumb-${segment.type}`}
            >
              <a
                href={segment.href}
                className={PREFIX_LINK_CLASS}
                onClick={(e) => {
                  e.preventDefault()
                  segment.onNavigate()
                }}
              >
                <BreadcrumbSegmentIcon type={segment.type} iconClassName="h-5 w-5" />
                {segment.label === null ? (
                  <Skeleton className="h-6 w-32" />
                ) : (
                  <span className={PREFIX_NAME_CLASS}>{segment.label}</span>
                )}
              </a>
              <span className={`${TITLE_TEXT_CLASS} text-muted-foreground shrink-0`} aria-hidden="true">/</span>
            </span>
          ))
        )}
        {titleIcon}
        {entityType && (
          <BreadcrumbSegmentIcon
            type={entityType}
            iconClassName="h-5 w-5"
            data-testid={`detail-entity-icon-${entityType}`}
          />
        )}
        <h1 className="min-w-0 flex-1">
          <TruncatedName
            value={name}
            className={TITLE_NAME_CLASS}
            onTruncatedChange={handleTitleTruncatedChange}
          />
        </h1>
        {statusSlot}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {actions ?? (
          <>
            {onRun && (
              <Button
                variant="default"
                size="sm"
                data-testid={runTestId}
                onClick={onRun}
              >
                <Play className="h-4 w-4 mr-1.5" />
                Run
              </Button>
            )}
            {onExport && (
              <Button
                variant="outline"
                size="sm"
                data-testid={exportTestId}
                onClick={onExport}
              >
                <Download className="h-4 w-4 mr-1.5" />
                Export
              </Button>
            )}
            {onDelete && (
              <Button
                variant="outline"
                size="sm"
                data-testid={deleteTestId}
                onClick={onDelete}
              >
                <Trash2 className="h-4 w-4 mr-1.5" />
                Delete
              </Button>
            )}
          </>
        )}
      </div>
      </div>
      {subtitle && <div className="mt-1.5 pl-11">{subtitle}</div>}
    </div>
  )
}
