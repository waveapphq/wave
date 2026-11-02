/**
 * CompareBody - the inspect modal Compare-mode shell.
 *
 * Default: a 1fr/1fr two-pane layout - the host resolves both value bodies
 * (single-mode Initial + single-mode Current) and hands them in as nodes. Each
 * pane carries a small uppercase muted label; the Current pane draws a hairline
 * divider. Table mini-grids wrap a per-pane horizontal scroller.
 *
 * `stacked` (compact scalars - int / float / boolean): the two labeled values
 * stack vertically (label + value per row, values aligned) so a short-value diff
 * reads top-to-bottom instead of being lost far apart side-by-side.
 *
 * REQ-3.1.3.11: Variable watching UI panel
 */

import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

interface ComparePaneProps {
  testId: string
  label: string
  node: ReactNode
  tableGrid: boolean
  divider?: boolean
  /** Fill the pane height so the body (a string editor) grows with a resize. */
  fill?: boolean
}

// A filling pane wraps the body so a string editor grows; a table grid wraps a
// horizontal scroller; everything else renders the body as-is.
function paneBody(node: ReactNode, fill: boolean, tableGrid: boolean): ReactNode {
  if (fill) return <div className="min-h-0 flex-1">{node}</div>
  if (tableGrid) return <div className="overflow-x-auto">{node}</div>
  return node
}

function ComparePane({
  testId,
  label,
  node,
  tableGrid,
  divider,
  fill,
}: Readonly<ComparePaneProps>) {
  return (
    <div
      data-testid={testId}
      // The body row takes the height under the label, so a centered line stays inside the pane (VMGR-94).
      className={cn(
        'min-w-0 px-4 py-3',
        fill ? 'flex flex-col' : 'grid grid-rows-[auto_1fr]',
        divider && 'border-l',
      )}
    >
      <div className="mb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      {paneBody(node, !!fill, tableGrid)}
    </div>
  )
}

export interface CompareBodyProps {
  initialNode: ReactNode
  currentNode: ReactNode
  initialLabel: string
  currentLabel: string
  tableGrid: boolean
  /** Compact scalars stack the two labeled values vertically instead of
   *  side-by-side, so a short-value diff reads top-to-bottom. */
  stacked?: boolean
  /** String panes fill their height so the editors grow with a resize. */
  fill?: boolean
}

export function CompareBody({
  initialNode,
  currentNode,
  initialLabel,
  currentLabel,
  tableGrid,
  stacked,
  fill,
}: Readonly<CompareBodyProps>) {
  if (stacked) {
    return (
      <div
        data-testid="compare-body"
        className="grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-2 px-4 py-3"
      >
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {initialLabel}
        </span>
        <div data-testid="compare-pane-initial" className="min-w-0">
          {initialNode}
        </div>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {currentLabel}
        </span>
        <div data-testid="compare-pane-current" className="min-w-0">
          {currentNode}
        </div>
      </div>
    )
  }
  return (
    <div
      data-testid="compare-body"
      // The grid fills the (resizable) body height so the inter-pane divider
      // spans the full modal; `fill` bounds string/code editors (h-full) while
      // content panes use min-h-full so tall values still grow and scroll.
      className={cn('grid grid-cols-2', fill ? 'h-full' : 'min-h-full')}
    >
      <ComparePane
        testId="compare-pane-initial"
        label={initialLabel}
        node={initialNode}
        tableGrid={tableGrid}
        fill={fill}
      />
      <ComparePane
        testId="compare-pane-current"
        label={currentLabel}
        node={currentNode}
        tableGrid={tableGrid}
        divider
        fill={fill}
      />
    </div>
  )
}
