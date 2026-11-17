/**
 * Watched build view geometry (WATCH-8): whether a finished test fits the canvas
 * at its smallest zoom, the smallest-zoom view on the top of one that does not,
 * and the least pan that brings a new Block into view. Margins follow the canvas
 * fit padding.
 */

import { getViewportForBounds, type Rect, type Viewport } from '@xyflow/react'

export interface CanvasSize {
  width: number
  height: number
  minZoom: number
  maxZoom: number
}

export function unionRect(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  }
}

/** The space the canvas fit leaves at each edge of one axis. */
function fitMargin(extent: number, padding: number): number {
  return Math.floor((extent - extent / (1 + padding)) / 2)
}

/** Whether the canvas fit shows the whole rect without going below the smallest zoom. */
export function fitsCanvas(rect: Rect, size: CanvasSize, padding: number): boolean {
  return getViewportForBounds(rect, size.width, size.height, 0, size.maxZoom, padding).zoom >= size.minZoom
}

/** The smallest-zoom view on the top of a test too big to fit; too wide as well, it centers where the build begins. */
export function topFrame(rect: Rect, start: Rect, size: CanvasSize, padding: number): Viewport {
  const zoom = size.minZoom
  const across = rect.width * zoom <= size.width - 2 * fitMargin(size.width, padding) ? rect : start
  return {
    x: size.width / 2 - (across.x + across.width / 2) * zoom,
    y: fitMargin(size.height, padding) - rect.y * zoom,
    zoom,
  }
}

/** How far one axis moves so [start, end] clears the margins; the start wins when both cannot. */
function axisShift(start: number, end: number, extent: number, margin: number): number {
  if (start < 0) return margin - start
  if (end > extent) return Math.max(extent - margin - end, margin - start)
  return 0
}

/** The least pan that brings a Block fully into view, or null while it already is. */
export function panIntoView(viewport: Viewport, block: Rect, size: CanvasSize, padding: number): Viewport | null {
  const { zoom } = viewport
  const left = block.x * zoom + viewport.x
  const top = block.y * zoom + viewport.y
  const right = left + block.width * zoom
  const bottom = top + block.height * zoom
  if (left >= 0 && top >= 0 && right <= size.width && bottom <= size.height) return null
  return {
    x: viewport.x + axisShift(left, right, size.width, fitMargin(size.width, padding)),
    y: viewport.y + axisShift(top, bottom, size.height, fitMargin(size.height, padding)),
    zoom,
  }
}
