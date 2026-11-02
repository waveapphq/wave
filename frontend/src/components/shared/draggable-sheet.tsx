/**
 * DraggableSheet - shared non-blocking floating panel.
 *
 * Promoted from the Functions Library modal's drag pattern: pointer drag via
 * the header handle, viewport clamping, ResizeObserver re-clamp, ESC close,
 * no overlay / focus trap (the canvas behind stays interactive). Every sheet
 * is its own window: it mounts in the nearest sheet layer, never inside the
 * sheet or markup that opened it.
 * Sheets share a module z-order: pointer-down brings a sheet to front and
 * ESC closes only the front-most open sheet. Width resize reuses the shared
 * dialog-resize affordance (520-1200px).
 */

import {
  use,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
  type Ref,
  type RefObject,
} from 'react'

import { createPortal, flushSync } from 'react-dom'
import { Maximize, Minimize } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  DialogResizeCorner,
  DialogResizeHandle,
  useDialogResize,
} from '@/components/shared/dialog-resize'
import { SheetFrozenContext, SheetLayerContext } from '@/components/shared/sheet-layer'

interface SheetOffset {
  x: number
  y: number
}

const ZERO_OFFSET: SheetOffset = { x: 0, y: 0 }

interface DragState {
  active: boolean
  pointerId: number | null
  startX: number
  startY: number
  startOffsetX: number
  startOffsetY: number
}

const INITIAL_DRAG_STATE: DragState = {
  active: false,
  pointerId: null,
  startX: 0,
  startY: 0,
  startOffsetX: 0,
  startOffsetY: 0,
}

/**
 * Clamp a viewport-centered offset so the sheet stays in the viewport.
 *
 * The sheet is positioned at `(50% + offsetX, 50% + offsetY)` with
 * `translate(-50%, -50%)` so its center sits at that point. When the sheet
 * is larger than the viewport on an axis we prioritize the top-left corner
 * staying visible so the drag handle and close button remain reachable.
 */
function clampOffsetToViewport(
  offset: SheetOffset,
  width: number,
  height: number,
): SheetOffset {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const halfW = width / 2
  const halfH = height / 2
  let x = offset.x
  let y = offset.y
  if (width <= vw) {
    const max = vw / 2 - halfW
    if (x > max) x = max
    if (x < -max) x = -max
  } else {
    // Sheet wider than viewport - pin the left edge to the viewport edge.
    x = halfW - vw / 2
  }
  if (height <= vh) {
    const max = vh / 2 - halfH
    if (y > max) y = max
    if (y < -max) y = -max
  } else {
    // Sheet taller than viewport - pin the top edge so the drag handle and
    // close button are reachable; the body itself scrolls.
    y = halfH - vh / 2
  }
  return { x, y }
}

interface SheetRegistryEntry {
  z: number
  apply: (z: number) => void
  /** Marks this sheet active (true) when it is the front-most open sheet. */
  setActive: (active: boolean) => void
  /** Plays the one-shot select pulse on this sheet. */
  pulse: () => void
}

// Open sheets in back-to-front order. Sheets occupy a compact z band starting
// at Z_BASE; re-stamping on each open / bring-to-front keeps the band bounded
// so Radix dialogs (z-50) always stack above sheets.
const Z_BASE = 30
let sheetOrder: SheetRegistryEntry[] = []

// The front-most open sheet is the active one; every other open sheet is not.
function syncActiveSheets(): void {
  const front = sheetOrder.at(-1)
  sheetOrder.forEach((e) => e.setActive(e === front))
}

function bringSheetToFront(entry: SheetRegistryEntry): void {
  sheetOrder = sheetOrder.filter((e) => e !== entry)
  sheetOrder.push(entry)
  sheetOrder.forEach((e, index) => {
    e.z = Z_BASE + index
    e.apply(e.z)
  })
  syncActiveSheets()
}

function removeSheet(entry: SheetRegistryEntry): void {
  sheetOrder = sheetOrder.filter((e) => e !== entry)
  syncActiveSheets()
}

function isFrontMostSheet(entry: SheetRegistryEntry): boolean {
  return sheetOrder.at(-1) === entry
}

function reclampToViewport(
  el: HTMLElement,
  setOffset: (updater: (prev: SheetOffset) => SheetOffset) => void,
): void {
  setOffset((prev) =>
    clampOffsetToViewport(prev, el.offsetWidth, el.offsetHeight),
  )
}

// Named open sheets, so callers can focus one without holding a ref
// (duplicate node open -> focus its sheet; From-library -> focus the library).
const namedSheets = new Map<string, SheetRegistryEntry>()

interface SheetGeometry {
  offset: SheetOffset
  width: number
  height: number | undefined
}

// Session-scoped geometry memory for named sheets: once dragged or resized,
// a sheet reopens where the user left it (cleared on page reload).
const sheetGeometry = new Map<string, SheetGeometry>()

// localStorage tier of the geometry memory for sheets that opt in via
// `persistGeometry` (the variable watchers): adjusted size + position also
// survive page reloads. LRU-capped single-key map.
const GEOMETRY_STORAGE_KEY = 'draggable-sheet.geometry'
const GEOMETRY_STORAGE_CAP = 100

function readGeometryStore(): Record<string, SheetGeometry> {
  try {
    const parsed: unknown = JSON.parse(
      localStorage.getItem(GEOMETRY_STORAGE_KEY) ?? '{}',
    )
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, SheetGeometry>
    }
    return {}
  } catch {
    return {}
  }
}

function readRememberedGeometry(
  sheetId: string | undefined,
  persistGeometry: boolean,
): SheetGeometry | undefined {
  if (!sheetId) return undefined
  const inSession = sheetGeometry.get(sheetId)
  if (inSession) return inSession
  return persistGeometry ? readGeometryStore()[sheetId] : undefined
}

// A remembered size never reopens below the sheet's own floor.
function floored(size: number | undefined, floor: number | undefined): number | undefined {
  return size === undefined ? undefined : Math.max(size, floor ?? 0)
}

function writePersistedGeometry(sheetId: string, geometry: SheetGeometry): void {
  const store = readGeometryStore()
  // Re-insert so the entry moves to the freshest LRU position.
  delete store[sheetId]
  store[sheetId] = geometry
  const keys = Object.keys(store)
  for (let i = 0; i < keys.length - GEOMETRY_STORAGE_CAP; i++) {
    delete store[keys[i]]
  }
  localStorage.setItem(GEOMETRY_STORAGE_KEY, JSON.stringify(store))
}

/** Bring the open sheet registered under `sheetId` to the front. */
export function focusSheet(sheetId: string): boolean {
  const entry = namedSheets.get(sheetId)
  if (!entry) return false
  bringSheetToFront(entry)
  return true
}

/** Play the one-shot select pulse on the open sheet registered under `sheetId`. */
export function pulseSheet(sheetId: string): boolean {
  const entry = namedSheets.get(sheetId)
  if (!entry) return false
  entry.pulse()
  return true
}

/** Canonical reopen affordance: raise the already-open sheet and pulse it.
 *  Every "user re-triggered an open sheet" path goes through this one helper
 *  or the SheetHandle below. */
export function refocusSheet(sheetId: string): boolean {
  if (!focusSheet(sheetId)) return false
  pulseSheet(sheetId)
  return true
}

/** Handle on a sheet, held by the control that opens it. */
export interface SheetHandle {
  /** Raise the open sheet to the front and play the select pulse. */
  refocus: () => void
}

/** Raises and pulses the sheet behind a handle, once the sheet has handed it over. */
export function refocusHandle(handle: RefObject<SheetHandle | null>): void {
  handle.current?.refocus()
}

/** Opens a sheet; pressing its opener again while it is open raises and pulses it. */
export function openOrRefocus(
  isOpen: boolean,
  handle: RefObject<SheetHandle | null>,
  open: () => void,
): void {
  if (isOpen) refocusHandle(handle)
  open()
}

/** Open state for a sheet one control opens. */
export interface SheetOpener {
  open: boolean
  ref: RefObject<SheetHandle | null>
  /** Opens the sheet, or raises and pulses it while it is open. */
  show: () => void
  hide: () => void
}

export function useSheetOpener(): SheetOpener {
  const [open, setOpen] = useState(false)
  const ref = useRef<SheetHandle>(null)
  return {
    open,
    ref,
    show: () => openOrRefocus(open, ref, () => setOpen(true)),
    hide: () => setOpen(false),
  }
}

/** Whether a modal Radix dialog is open; it owns ESC, so sheet-level close
 *  handlers defer while one is up. Non-modal role="dialog" surfaces (Radix
 *  Popover content such as autocomplete dropdowns) must not block closes. */
export function hasOpenModalDialog(): boolean {
  return (
    document.querySelector(
      '[role="dialog"][aria-modal="true"], [role="alertdialog"]',
    ) !== null
  )
}

/** Whether an open popup layer (a Select listbox, a menu) owns ESC itself.
 *  A layer mid close-animation stays mounted as data-state="closed" and does not. */
function hasOpenPopupLayer(): boolean {
  return (
    document.querySelector(
      '[role="listbox"]:not([data-state="closed"]), [role="menu"]:not([data-state="closed"])',
    ) !== null
  )
}

export interface DraggableSheetProps {
  /** Lets the sheet's opener raise it again (see useSheetOpener). */
  ref?: Ref<SheetHandle>
  open: boolean
  /** Invoked by ESC (front-most sheet only). The consumer decides whether to
   *  actually close - unsaved-changes guards live in the consumer. */
  onClose: () => void
  /** Optional registration key (unique per sheet): enables focusSheet() and
   *  session-scoped geometry memory (adjusted position/width survive reopen). */
  sheetId?: string
  /** Hosts inside a dialog that owns ESC need the key in the capture phase, so
   *  the sheet closes instead of nothing. */
  captureEsc?: boolean
  /** Also persist the adjusted geometry to localStorage (survives reloads). */
  persistGeometry?: boolean
  ariaLabel: string
  /** Header content (icon + title + actions). The header bar is the drag handle. */
  header: ReactNode
  /** Extra classes for the header bar (e.g. compact padding). */
  headerClassName?: string
  /** Pixel offset added to the centered position (cascade support). */
  initialOffset?: SheetOffset
  initialWidth?: number
  /** Fixed starting height; omit for auto (content-driven) height. */
  initialHeight?: number
  minWidth?: number
  minHeight?: number
  /** Pixels added to the resolved height (e.g. a validation strip), on top of
   *  the resizable base height - so the base size + resize floor stay independent
   *  of the strip and the sheet grows/shrinks as it appears/clears. */
  extraHeight?: number
  resizable?: boolean
  /**
   * When true, the sheet snaps to a new `initialWidth`/`initialHeight` whenever
   * those props change (e.g. the inspect modal's per-mode geometry), until the
   * user manually drags/resizes it. Opt-in so other sheets keep init-once sizing.
   */
  responsiveSize?: boolean
  /** Adds a header control that fills the viewport and restores the previous
   *  box on the second press; called on every toggle. Omit for no control. */
  onMaximize?: () => void
  className?: string
  'data-testid': string
  /** Extra data attributes on the sheet root, for a host that names its state. */
  dataAttributes?: Readonly<Record<`data-${string}`, string>>
  children: ReactNode
}

export function DraggableSheet({
  ref,
  open,
  onClose,
  sheetId,
  captureEsc = false,
  persistGeometry = false,
  ariaLabel,
  header,
  headerClassName,
  initialOffset,
  initialWidth,
  initialHeight,
  minWidth,
  minHeight,
  extraHeight = 0,
  resizable = true,
  responsiveSize = false,
  onMaximize,
  className,
  'data-testid': testId,
  dataAttributes,
  children,
}: Readonly<DraggableSheetProps>) {
  const layer = use(SheetLayerContext)
  const frozen = use(SheetFrozenContext)
  const remembered = readRememberedGeometry(sheetId, persistGeometry)
  const [offset, setOffset] = useState<SheetOffset>(
    remembered?.offset ?? initialOffset ?? ZERO_OFFSET,
  )
  const [zIndex, setZIndex] = useState(Z_BASE)
  const [maximized, setMaximized] = useState(false)
  const restoreRef = useRef<SheetGeometry | null>(null)
  const [active, setActive] = useState(false)
  const [pulsing, setPulsing] = useState(false)
  const dragRef = useRef<DragState>(INITIAL_DRAG_STATE)
  const sheetRef = useRef<HTMLElement>(null)
  const entryRef = useRef<SheetRegistryEntry | null>(null)
  entryRef.current ??= {
    z: Z_BASE,
    apply: setZIndex,
    setActive,
    pulse: () => setPulsing(true),
  }
  const entry = entryRef.current
  useImperativeHandle(
    ref,
    () => ({
      refocus: () => {
        if (!open) return
        bringSheetToFront(entry)
        entry.pulse()
      },
    }),
    [open, entry],
  )
  const openerRef = useRef<Element | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  // Only user-adjusted geometry is remembered; untouched sheets keep the
  // default centered + cascade placement on every open.
  const userAdjustedRef = useRef(false)
  // A manual RESIZE (not a move) freezes the mode-driven auto-resize; dragging
  // only repositions, so it must NOT stop a responsive sheet from re-snapping
  // (a fixed-size watcher can only be moved).
  const userResizedRef = useRef(false)

  const {
    dialogWidth,
    dialogHeight,
    handleResizeStart,
    handleCornerResizeStart,
    resetSize,
    clampUpToMin,
  } = useDialogResize({
    initialWidth: floored(remembered?.width, minWidth) ?? initialWidth,
    initialHeight: floored(remembered?.height, minHeight) ?? initialHeight,
    minWidth,
    minHeight,
  })

  // Responsive sheets (inspect modal) snap to the new default size when their
  // mode changes - but never on the first render (that would clobber remembered
  // geometry) and never once the user has manually RESIZED (a move/drag still
  // re-snaps).
  const didMountRef = useRef(false)
  useEffect(() => {
    if (!responsiveSize) return
    if (!didMountRef.current) {
      didMountRef.current = true
      return
    }
    // A user-resized sheet keeps its size across mode changes - but never below
    // the new mode's minimum, so a mode with a larger min grows it up (a larger
    // current size is left alone). An untouched sheet snaps to the new default.
    if (userResizedRef.current) {
      clampUpToMin()
      return
    }
    // responsiveSize consumers (the inspect modal) always pass an explicit size.
    resetSize(initialWidth!, initialHeight)
  }, [responsiveSize, initialWidth, initialHeight, resetSize, clampUpToMin])

  useEffect(() => {
    if (!open || !sheetId) return
    if (!userAdjustedRef.current) return
    const geometry = { offset, width: dialogWidth, height: dialogHeight }
    sheetGeometry.set(sheetId, geometry)
    if (persistGeometry) writePersistedGeometry(sheetId, geometry)
  }, [open, sheetId, offset, dialogWidth, dialogHeight, persistGeometry])

  // Open sheets join the shared z-order on top; any pointer-down inside the
  // sheet brings it to front. The listener is attached natively because the
  // section is non-interactive markup (mirrors the canvas keydown pattern).
  useEffect(() => {
    if (!open) return
    // The section is always mounted when open (the ref is assigned before
    // effects run), so the cast is safe.
    const el = sheetRef.current as HTMLElement
    bringSheetToFront(entry)
    if (sheetId) namedSheets.set(sheetId, entry)
    const handleSheetPointerDown = () => bringSheetToFront(entry)
    el.addEventListener('pointerdown', handleSheetPointerDown)
    return () => {
      el.removeEventListener('pointerdown', handleSheetPointerDown)
      if (sheetId) namedSheets.delete(sheetId)
      removeSheet(entry)
    }
  }, [open, entry, sheetId])

  // Hand focus back where it came from on close, so the surface behind (the
  // canvas, whose keys only fire while it holds focus) is live again. Focus the
  // user has since moved elsewhere themselves is left alone.
  //
  // Captured during the opening render, not in an effect: a sheet that focuses
  // something of its own on mount (Quick Insert's search box) would otherwise
  // be recorded as its own opener, and handing focus back to a control that
  // left with the sheet leaves the canvas deaf.
  if (open && openerRef.current === null) openerRef.current = document.activeElement
  if (!open && openerRef.current !== null) openerRef.current = null
  useEffect(() => {
    if (!open) return
    const opener = openerRef.current
    return () => {
      // The sheet is already gone by now, so focus has fallen to the page body
      // unless the user has moved it somewhere themselves.
      if (document.activeElement !== document.body) return
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
    }
  }, [open])

  // ESC closes the front-most open sheet only.
  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      // This capture listener runs before the popup's own, so it stands down.
      if (captureEsc && hasOpenPopupLayer()) return
      // An ESC already consumed (by a Radix dismissable layer, or by the
      // front-most sheet earlier in this same dispatch) must not close more.
      // A host dialog marks it before the capture path runs, which is why only
      // the bubble path honors the flag.
      if (!captureEsc && event.defaultPrevented) return
      if (!isFrontMostSheet(entry)) return
      event.preventDefault()
      if (captureEsc) event.stopPropagation()
      onCloseRef.current()
    }
    if (captureEsc) {
      document.addEventListener('keydown', handleKeyDown, true)
      return () => document.removeEventListener('keydown', handleKeyDown, true)
    }
    globalThis.addEventListener('keydown', handleKeyDown)
    return () => globalThis.removeEventListener('keydown', handleKeyDown)
  }, [open, entry, captureEsc])

  // Re-clamp the offset whenever the sheet resizes (content growth, theme
  // change). Without this, a sheet dragged near an edge can grow past it and
  // push its header off-screen, leaving the user no way to close it.
  useEffect(() => {
    const el = sheetRef.current
    if (!el || !open) return
    // Spec-compliant observers queue their callbacks; environments that fire
    // synchronously inside observe() are mid-commit, where flushSync throws.
    let insideObserveCall = true
    const observer = new ResizeObserver(() => {
      if (insideObserveCall) {
        reclampToViewport(el, setOffset)
      } else {
        // flushSync keeps the clamped position in lockstep with the resize
        // that triggered it (ResizeObserver fires between layout and paint).
        flushSync(() => reclampToViewport(el, setOffset))
      }
    })
    observer.observe(el)
    insideObserveCall = false
    return () => observer.disconnect()
  }, [open])

  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return
      // A sheet opened from inside the header is its own window.
      if (!event.currentTarget.contains(event.target as Node)) return
      // Header buttons stopPropagation on pointerdown, so this drag handler
      // only runs for the bare header surface. Clear any stray text
      // selection so the browser doesn't treat this pointerdown as the
      // start of a native text-drag (which would prevent pointer capture).
      const sel = globalThis.getSelection?.()
      if (sel && !sel.isCollapsed) sel.removeAllRanges()
      event.preventDefault()
      userAdjustedRef.current = true
      dragRef.current = {
        active: true,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startOffsetX: offset.x,
        startOffsetY: offset.y,
      }
      event.currentTarget.setPointerCapture(event.pointerId)
    },
    [offset.x, offset.y],
  )

  const handlePointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const state = dragRef.current
      if (!state.active || state.pointerId !== event.pointerId) return
      // The drag handle lives inside the sheet section, so the ref is set
      // whenever the pointermove handler fires.
      const el = sheetRef.current as HTMLElement
      const dx = event.clientX - state.startX
      const dy = event.clientY - state.startY
      const raw = { x: state.startOffsetX + dx, y: state.startOffsetY + dy }
      setOffset(clampOffsetToViewport(raw, el.offsetWidth, el.offsetHeight))
    },
    [],
  )

  const handlePointerUp = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const state = dragRef.current
      if (!state.active || state.pointerId !== event.pointerId) return
      dragRef.current = INITIAL_DRAG_STATE
      try {
        event.currentTarget.releasePointerCapture(event.pointerId)
      } catch {
        // releasePointerCapture can throw if capture was already released
        // (e.g., user dragged outside window); safe to swallow.
      }
    },
    [],
  )

  const handleResizeStartTracked = useCallback(
    (event: React.MouseEvent) => {
      userAdjustedRef.current = true
      userResizedRef.current = true
      handleResizeStart(event)
    },
    [handleResizeStart],
  )

  const handleCornerResizeStartTracked = useCallback(
    (event: React.MouseEvent) => {
      userAdjustedRef.current = true
      userResizedRef.current = true
      // An auto-height sheet fixes its height from the measured size on the
      // first corner drag; the body scrolls past the fixed height afterwards.
      handleCornerResizeStart(
        event,
        (sheetRef.current as HTMLElement).offsetHeight,
      )
    },
    [handleCornerResizeStart],
  )

  const toggleMaximize = useCallback(() => {
    const previous = restoreRef.current
    if (previous) {
      restoreRef.current = null
      resetSize(previous.width, previous.height)
      setOffset(previous.offset)
    } else {
      restoreRef.current = { offset, width: dialogWidth, height: dialogHeight }
      resetSize(globalThis.innerWidth, globalThis.innerHeight)
      setOffset(ZERO_OFFSET)
    }
    setMaximized(previous === null)
  }, [offset, dialogWidth, dialogHeight, resetSize])

  const transform = useMemo(
    () => `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
    [offset.x, offset.y],
  )

  if (!open) return null

  const section = (
    <section
      ref={sheetRef}
      aria-label={ariaLabel}
      {...dataAttributes}
      data-testid={testId}
      data-draggable-sheet=""
      data-active={active ? 'true' : undefined}
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget) setPulsing(false)
      }}
      className={cn(
        'fixed left-1/2 top-1/2',
        'flex flex-col',
        // A clearer border than the default so the floating sheet never blends
        // into the canvas; the front-most (active) sheet gains the indigo focus
        // ring shared by every draggable sheet.
        'bg-background border border-muted-foreground/40 rounded-lg shadow-lg',
        // Default to no text selection across the sheet: selected text turns
        // subsequent pointerdowns into native text-drag gestures, which
        // prevents the drag handler from firing until the user deselects.
        'select-none',
        active && 'ring-1 ring-indigo-500/50',
        className,
        pulsing && 'animate-sheet-select-pulse',
      )}
      style={{
        transform,
        width: dialogWidth,
        height: dialogHeight === undefined ? undefined : dialogHeight + extraHeight,
        zIndex,
      }}
    >
      {/* Header / drag handle - intentionally not a native button because it
          hosts the title and action buttons, and nested interactive elements
          are invalid. Pointer events here drive the drag logic; keyboard
          users move focus to the close button instead. */}
      <div
        data-testid={`${testId}-drag-handle`}
        aria-label="Drag to move"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className={cn(
          'flex items-center justify-between gap-3 px-4 py-3 border-b',
          'cursor-grab active:cursor-grabbing select-none',
          headerClassName,
        )}
      >
        {header}
        {onMaximize && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Maximize"
            aria-pressed={maximized}
            onClick={() => {
              toggleMaximize()
              onMaximize()
            }}
            onPointerDown={(event) => event.stopPropagation()}
            className="h-7 w-7 shrink-0"
          >
            {maximized ? (
              <Minimize className="h-4 w-4" />
            ) : (
              <Maximize className="h-4 w-4" />
            )}
          </Button>
        )}
      </div>
      {resizable && <DialogResizeHandle onResizeStart={handleResizeStartTracked} />}
      {resizable && (
        <DialogResizeCorner onResizeStart={handleCornerResizeStartTracked} />
      )}
      {/* The freeze covers the body only: the header's own close and maximize
          controls stay operable so a frozen sheet can still be dismissed. */}
      {frozen === undefined ? (
        children
      ) : (
        <fieldset disabled={frozen} className="contents">
          {children}
        </fieldset>
      )}
    </section>
  )

  return createPortal(section, layer ?? document.body)
}
