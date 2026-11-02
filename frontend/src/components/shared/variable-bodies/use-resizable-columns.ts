/**
 * useResizableColumns - shared column width / drag-resize / auto-fit logic behind
 * the read ValueGrid and the table edit body. Holds transient pixel widths, a
 * drag handler clamped to a per-grid minimum, and double-click auto-fit. Widths
 * re-seed when the column SET changes (columnSig) - never on row/value edits,
 * which would yank widths mid-edit. Measurement uses the grid mono font; jsdom
 * has no canvas text metrics, so callers fall back to configured widths there.
 *
 * REQ-3.1.3.11: Variable watching UI panel
 */

import { useEffect, useRef, useState, type MouseEvent } from 'react'

export const MIN_COLUMN_WIDTH = 56
const MAX_FIT_WIDTH = 600
const CELL_PADDING_X = 16 // px-2 left + right
const FIT_BUFFER = 8
const MEASURE_FONT = '12.5px ui-monospace, monospace'

let measureCanvas: HTMLCanvasElement | null = null
function measureText(text: string): number {
  measureCanvas ??= document.createElement('canvas')
  const ctx = measureCanvas.getContext('2d')
  if (!ctx) return 0
  ctx.font = MEASURE_FONT
  return ctx.measureText(text).width
}

/** A copy of `widths` with `index` set to `value` (the others unchanged). */
export function replaceWidth(widths: readonly number[], index: number, value: number): number[] {
  return widths.map((width, i) => (i === index ? value : width))
}

/** Begin a column drag-resize: track the mouse and report each clamped width
 *  through `onWidth` until mouseup. Holds no width state - the caller owns it,
 *  so both the uncontrolled hook and the controlled edit body share the math. */
export function startColumnDrag(
  event: MouseEvent,
  startWidth: number,
  minWidth: number,
  onWidth: (width: number) => void,
): void {
  event.preventDefault()
  event.stopPropagation()
  const startX = event.clientX
  const onMove = (move: globalThis.MouseEvent) => {
    onWidth(Math.max(minWidth, startWidth + (move.clientX - startX)))
  }
  const onUp = () => {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
  }
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}

/** Widest single (\n-delimited) line of the text - the unwrapped content width. */
function longestLineWidth(text: string): number {
  let max = 0
  for (const line of text.split('\n')) {
    const width = measureText(line)
    if (width > max) max = width
  }
  return max
}

/** True when canvas text metrics are available (false in jsdom / SSR). */
export function hasTextMetrics(): boolean {
  return measureText('x') > 0
}

export interface FitOptions {
  /** Lower bound for the fitted width (default MIN_COLUMN_WIDTH). */
  minWidth?: number
  /** Extra px added to the first text's width - room for inline header controls
   *  (the type pill + kebab) that sit beside the column name in the edit body. */
  firstExtra?: number
}

/** Auto-fit width for a column from all its texts (header + cells): widest line,
 *  padded and clamped to [minWidth, MAX_FIT_WIDTH]. */
export function fitColumnWidth(
  texts: readonly string[],
  { minWidth = MIN_COLUMN_WIDTH, firstExtra = 0 }: FitOptions = {},
): number {
  let max = 0
  texts.forEach((text, index) => {
    const width = longestLineWidth(text) + (index === 0 ? firstExtra : 0)
    if (width > max) max = width
  })
  return Math.min(
    MAX_FIT_WIDTH,
    Math.max(minWidth, Math.ceil(max) + CELL_PADDING_X + FIT_BUFFER),
  )
}

interface UseResizableColumnsOptions {
  /** Changes when the column SET changes (add/remove/reorder) - re-seeds widths. */
  columnSig: string
  /** Initial widths; re-run on a columnSig change. */
  seed: () => number[]
  /** Auto-fit width for one column (double-click handle). */
  fit: (index: number) => number
  /** Drag clamp minimum (default MIN_COLUMN_WIDTH). */
  minWidth?: number
}

export function useResizableColumns({
  columnSig,
  seed,
  fit,
  minWidth = MIN_COLUMN_WIDTH,
}: UseResizableColumnsOptions) {
  const [widths, setWidths] = useState(seed)
  const sigRef = useRef(columnSig)
  const seedRef = useRef(seed)
  seedRef.current = seed
  useEffect(() => {
    if (sigRef.current !== columnSig) {
      sigRef.current = columnSig
      setWidths(seedRef.current())
    }
  }, [columnSig])

  const startResize = (index: number, event: MouseEvent) =>
    startColumnDrag(event, widths[index], minWidth, (width) =>
      setWidths((current) => replaceWidth(current, index, width)),
    )

  const fitColumn = (index: number) => {
    const width = fit(index)
    setWidths((current) => replaceWidth(current, index, width))
  }

  return { widths, startResize, fitColumn }
}
