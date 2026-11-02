/**
 * Shared resize affordance for the workbench floating dialogs and sheets.
 *
 * Exposes a width-only right-edge handle and a both-axis bottom-right corner
 * grip backed by one hook, so every resizable surface shares the same bounds
 * handling, hover affordance, and drag amplification. Per-instance bounds
 * (min/max width, min height) override the shared defaults.
 */

import { useCallback, useRef, useState } from 'react'

/** Default starting width matches Tailwind's `max-w-2xl` (672px). */
const DEFAULT_WIDTH = 672
const DEFAULT_MIN_WIDTH = 520
const DEFAULT_MAX_WIDTH = 1200
const DEFAULT_MIN_HEIGHT = 240
/**
 * Pointer deltas are amplified 2x because the resize handles hug the edge of
 * a centered surface - dragging the edge by `dx` shifts one side and the
 * centering re-balances the other, so the visible size change is half the
 * raw drag distance without this multiplier.
 */
const DRAG_GAIN = 2


export interface DialogResizeConfig {
  initialWidth?: number
  /** Fixed starting height; omit for auto (content-driven) height. */
  initialHeight?: number
  minWidth?: number
  maxWidth?: number
  minHeight?: number
}

export interface UseDialogResize {
  dialogWidth: number
  /** `undefined` = auto height (no fixed height applied yet). */
  dialogHeight: number | undefined
  handleResizeStart: (event: React.MouseEvent) => void
  /** Both-axis corner drag. `measuredHeight` seeds the height when auto. */
  handleCornerResizeStart: (event: React.MouseEvent, measuredHeight: number) => void
  /** Imperatively snap the size to a new default (e.g. on inspect-mode change). */
  resetSize: (width: number, height: number | undefined) => void
  /** Grow the size up to the current min bounds, keeping it if already larger
   *  (e.g. a resized sheet switching to a mode with a larger min). */
  clampUpToMin: () => void
}


export function useDialogResize(config: DialogResizeConfig = {}): UseDialogResize {
  const {
    initialWidth = DEFAULT_WIDTH,
    initialHeight,
    minWidth = DEFAULT_MIN_WIDTH,
    maxWidth = DEFAULT_MAX_WIDTH,
    minHeight = DEFAULT_MIN_HEIGHT,
  } = config
  const [dialogWidth, setDialogWidth] = useState(initialWidth)
  const [dialogHeight, setDialogHeight] = useState<number | undefined>(initialHeight)
  const resizeRef = useRef<{
    startX: number
    startY: number
    startWidth: number
    startHeight: number
    corner: boolean
  } | null>(null)

  const beginDrag = useCallback(
    (event: React.MouseEvent, startHeight: number, corner: boolean) => {
      event.preventDefault()
      resizeRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        startWidth: dialogWidth,
        startHeight,
        corner,
      }

      const handleMouseMove = (moveEvent: MouseEvent) => {
        /* v8 ignore next - COV-BRANCH-100 */
        if (!resizeRef.current) return
        const state = resizeRef.current
        const dx = moveEvent.clientX - state.startX
        setDialogWidth(
          Math.max(
            minWidth,
            Math.min(maxWidth, state.startWidth + dx * DRAG_GAIN),
          ),
        )
        if (state.corner) {
          const dy = moveEvent.clientY - state.startY
          // Height has no fixed max: the sheet's viewport offset clamp keeps
          // the header reachable for over-tall surfaces.
          setDialogHeight(Math.max(minHeight, state.startHeight + dy * DRAG_GAIN))
        }
      }

      const handleMouseUp = () => {
        resizeRef.current = null
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
      }

      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    },
    [dialogWidth, minWidth, maxWidth, minHeight],
  )

  const handleResizeStart = useCallback(
    (event: React.MouseEvent) => beginDrag(event, 0, false),
    [beginDrag],
  )

  const handleCornerResizeStart = useCallback(
    (event: React.MouseEvent, measuredHeight: number) =>
      beginDrag(event, dialogHeight ?? measuredHeight, true),
    [beginDrag, dialogHeight],
  )

  const resetSize = useCallback((width: number, height: number | undefined) => {
    setDialogWidth(width)
    setDialogHeight(height)
  }, [])

  const clampUpToMin = useCallback(() => {
    setDialogWidth((w) => Math.max(w, minWidth))
    setDialogHeight((h) => (h === undefined ? undefined : Math.max(h, minHeight)))
  }, [minWidth, minHeight])

  return {
    dialogWidth,
    dialogHeight,
    handleResizeStart,
    handleCornerResizeStart,
    resetSize,
    clampUpToMin,
  }
}


export interface DialogResizeHandleProps {
  onResizeStart: (event: React.MouseEvent) => void
}


export function DialogResizeHandle({
  onResizeStart,
}: Readonly<DialogResizeHandleProps>) {
  return (
    <button
      type="button"
      data-testid="dialog-resize-handle"
      aria-label="Resize dialog width"
      onMouseDown={onResizeStart}
      // `style` overrides `all: unset` so the absolute-positioned handle
      // remains a thin column on the dialog's right edge without inheriting
      // button padding / borders.
      style={{
        all: 'unset',
        position: 'absolute',
        right: 0,
        top: 0,
        bottom: '1rem',
        width: '0.375rem',
        cursor: 'ew-resize',
        zIndex: 10,
      }}
      className="hover:bg-primary/20 active:bg-primary/30 transition-colors focus-visible:bg-primary/30"
    />
  )
}


export interface DialogResizeCornerProps {
  onResizeStart: (event: React.MouseEvent) => void
}

/** Bottom-right both-axis grip; pointer-only (aria-hidden), like the edge handle. */
export function DialogResizeCorner({
  onResizeStart,
}: Readonly<DialogResizeCornerProps>) {
  return (
    <div
      data-testid="dialog-resize-corner"
      aria-hidden="true"
      onMouseDown={onResizeStart}
      style={{
        position: 'absolute',
        right: 0,
        bottom: 0,
        width: '1rem',
        height: '1rem',
        cursor: 'nwse-resize',
        zIndex: 11,
      }}
      className="text-muted-foreground/60 hover:text-muted-foreground transition-colors"
    >
      <svg viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden="true">
        <path d="M13 7L7 13M13 11l-2 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </div>
  )
}
