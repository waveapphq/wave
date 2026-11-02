/**
 * CatalogChip - the catalog chip in a script editor footer (Get Tables, Get fields): start a pull,
 * stop it while it runs, open the loaded catalog, refresh it, or try again
 * after a failure (SQL-12, OS-12).
 *
 * REQ-3.4.1.6: SQL database operations
 * REQ-5.1.4: Database connectivity
 * REQ-3.3.2.6: OpenSearch query editor
 */

import { useCallback, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from 'react'
import { Check, CircleAlert, Database, Loader2, RefreshCw, Square } from 'lucide-react'

import { Button, type ButtonProps } from '@/components/ui/button'
import { ConditionalTooltip } from '@/components/ui/tooltip'
import { pluralize } from '@/lib/pluralize'
import { cn } from '@/lib/utils'
import { CatalogPopover, type CatalogItem, type CatalogPopoverNouns } from './catalog-popover'

export type CatalogChipState = 'idle' | 'connecting' | 'reading' | 'done' | 'settled' | 'failed'

/** The words of one catalog; without a connecting label a connecting pull shows the reading one. */
export interface CatalogChipNouns {
  idle: string
  connecting?: string
  reading: string
  done: (count: number) => string
  settled: (count: number) => string
  failed: string
  stopLabel: string
  refreshLabel: string
  popover: CatalogPopoverNouns
}

export const SQL_CATALOG_NOUNS: CatalogChipNouns = {
  idle: 'Get Tables',
  connecting: 'Connecting...',
  reading: 'Getting tables...',
  done: (count) => `Got ${pluralize(count, 'table')}`,
  settled: (count) => `Tables · ${count}`,
  failed: 'Could not get tables',
  stopLabel: 'Stop getting tables',
  refreshLabel: 'Refresh tables',
  popover: {
    searchLabel: 'Search tables',
    searchPlaceholder: 'Search tables…',
    emptyText: 'No tables',
    noMatchText: 'No matching tables',
    listLabel: 'Tables',
  },
}

export const OPENSEARCH_CATALOG_NOUNS: CatalogChipNouns = {
  idle: 'Get fields',
  reading: 'Getting fields...',
  done: (count) => `Got ${pluralize(count, 'field')}`,
  settled: (count) => `Fields · ${count}`,
  failed: 'Could not get fields',
  stopLabel: 'Stop getting fields',
  refreshLabel: 'Refresh fields',
  popover: {
    searchLabel: 'Search fields',
    searchPlaceholder: 'Search fields…',
    emptyText: 'No fields',
    noMatchText: 'No matching fields',
    listLabel: 'Fields',
  },
}

export interface CatalogChipProps {
  state: CatalogChipState
  count: number
  items: readonly CatalogItem[] | null
  nouns: CatalogChipNouns
  /** Why the last pull failed; the failed chip's tooltip when not empty. */
  error?: string | null
  /** Why nothing can be pulled yet; when not empty the idle chip shows disabled with it as the tooltip. */
  blockedNote?: string | null
  /** Idle click, and the failed click that tries again. */
  onStart: () => void
  /** The Stop beside a pull that is still running. */
  onStop: () => void
  /** The refresh beside the settled chip. */
  onRefresh: () => void
  /** An item picked in the popover. */
  onInsert: (name: string) => void
  /** Hands focus back to the editor once the popover is gone. */
  onPopoverClosed?: () => void
}

const NO_ITEMS: readonly CatalogItem[] = []

// The chip reads like the F1 Help chip beside it; in a short footer its label gives way first.
const CHIP_CLASSES = '!h-7 min-w-0 gap-2 px-2 !text-xs'
const ICON_CLASSES = 'h-3.5 w-3.5 shrink-0'
const LABEL_CLASSES = 'min-w-0 truncate'
const DONE_CLASSES =
  '!border-[var(--color-success-border)] !bg-[var(--color-success-bg)] !text-[var(--color-success-text)]'
// A pull in flight: the chip becomes a group, so its Stop is no button inside a button.
const BUSY_CLASSES =
  'h-7 rounded-md border border-[var(--color-border-default)] bg-subtle pl-2 pr-1 text-xs font-semibold text-default shadow-sm'

function chipLabel(state: CatalogChipState, count: number, nouns: CatalogChipNouns): string {
  switch (state) {
    case 'idle':
      return nouns.idle
    case 'connecting':
      return nouns.connecting ?? nouns.reading
    case 'reading':
      return nouns.reading
    case 'done':
      return nouns.done(count)
    case 'settled':
      return nouns.settled(count)
    case 'failed':
      return nouns.failed
  }
}

type LabelRef = (node: HTMLSpanElement | null) => void

/** Whether the label is cut short; the tooltip then carries it whole. */
function useLabelClipped(label: string): [LabelRef, boolean] {
  const [node, setNode] = useState<HTMLSpanElement | null>(null)
  const [clipped, setClipped] = useState(false)
  useLayoutEffect(() => {
    if (!node) return
    const observer = new ResizeObserver(() => setClipped(node.scrollWidth > node.clientWidth))
    observer.observe(node)
    return () => observer.disconnect()
  }, [node, label])
  return [setNode, clipped]
}

/** The label is the button's own child, so nothing between them keeps it from shrinking. */
function ChipButton({
  icon,
  label,
  labelRef,
  className,
  ref,
  ...props
}: Readonly<
  Omit<ButtonProps, 'asChild' | 'children' | 'variant' | 'size'> & {
    icon: ReactNode
    label: string
    labelRef: LabelRef
    ref?: Ref<HTMLButtonElement>
  }
>) {
  return (
    <Button ref={ref} asChild variant="outline" size="sm" className={cn(CHIP_CLASSES, className)} {...props}>
      <button type="button">
        {icon}
        <span ref={labelRef} className={LABEL_CLASSES}>
          {label}
        </span>
      </button>
    </Button>
  )
}

/** The whole label, then why the chip cannot act, once the label is cut short. */
function chipTooltip(label: string, clipped: boolean, reason: string | null | undefined): ReactNode {
  if (!clipped) return reason
  if (!reason) return label
  return (
    <>
      <span className="block">{label}</span>
      <span className="block">{reason}</span>
    </>
  )
}

/** A loaded chip opens the catalog popover; the open state goes with it once the items do. */
function LoadedCatalogButton({
  items,
  nouns,
  onInsert,
  onPopoverClosed,
  className,
  icon,
  label,
  ref,
}: Readonly<{
  items: readonly CatalogItem[]
  nouns: CatalogPopoverNouns
  onInsert: (name: string) => void
  onPopoverClosed?: () => void
  className?: string
  icon: ReactNode
  label: string
  ref?: Ref<HTMLButtonElement>
}>) {
  const [open, setOpen] = useState(false)
  const [labelRef, clipped] = useLabelClipped(label)
  return (
    <CatalogPopover
      open={open}
      onOpenChange={setOpen}
      items={items}
      nouns={nouns}
      onInsert={onInsert}
      onClosed={onPopoverClosed}
      tooltip={clipped ? label : null}
    >
      <ChipButton ref={ref} icon={icon} label={label} labelRef={labelRef} className={className} />
    </CatalogPopover>
  )
}

type FocusHandoff = (node: HTMLButtonElement) => () => void

/** A ref for every chip control: once a focused control leaves, the first one that arrives takes focus. */
function useFocusHandoff(): FocusHandoff {
  const focusLeft = useRef(false)
  return useCallback((node: HTMLButtonElement) => {
    if (focusLeft.current) {
      focusLeft.current = false
      node.focus()
    }
    return () => {
      if (node.ownerDocument.activeElement === node) focusLeft.current = true
    }
  }, [])
}

function StopButton({
  label,
  focusRef,
  onStop,
}: Readonly<{ label: string; focusRef: FocusHandoff; onStop: () => void }>) {
  return (
    <Button
      ref={focusRef}
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      onClick={onStop}
      className="!h-5 !w-5 shrink-0 rounded-sm bg-muted"
    >
      <Square className="h-3 w-3" aria-hidden="true" />
    </Button>
  )
}

function RefreshButton({
  label,
  focusRef,
  onRefresh,
}: Readonly<{ label: string; focusRef: FocusHandoff; onRefresh: () => void }>) {
  return (
    <Button
      ref={focusRef}
      type="button"
      variant="outline"
      size="icon"
      aria-label={label}
      onClick={onRefresh}
      className="!h-7 !w-7 shrink-0"
    >
      <RefreshCw className={ICON_CLASSES} aria-hidden="true" />
    </Button>
  )
}

/** The done or settled chip, which opens the loaded catalog. */
function LoadedChip({
  done,
  label,
  focusRef,
  items,
  nouns,
  onInsert,
  onPopoverClosed,
}: Readonly<{
  done: boolean
  label: string
  focusRef: FocusHandoff
  items: readonly CatalogItem[]
  nouns: CatalogPopoverNouns
  onInsert: (name: string) => void
  onPopoverClosed?: () => void
}>) {
  return (
    <LoadedCatalogButton
      ref={focusRef}
      items={items}
      nouns={nouns}
      onInsert={onInsert}
      onPopoverClosed={onPopoverClosed}
      className={done ? DONE_CLASSES : undefined}
      icon={
        done ? (
          <Check className={ICON_CLASSES} aria-hidden="true" />
        ) : (
          <Database className={cn(ICON_CLASSES, 'text-primary')} aria-hidden="true" />
        )
      }
      label={label}
    />
  )
}

/** The idle chip that starts a pull, the failed one that tries again, or the blocked one that says why not. */
function StartChip({
  failed,
  error,
  blockedNote,
  label,
  focusRef,
  onStart,
}: Readonly<{
  failed: boolean
  error?: string | null
  blockedNote: string | null
  label: string
  focusRef: FocusHandoff
  onStart: () => void
}>) {
  const blocked = blockedNote !== null
  const [labelRef, clipped] = useLabelClipped(label)
  const reason = blockedNote ?? (failed ? error : null)
  return (
    <ConditionalTooltip content={chipTooltip(label, clipped, reason)} disabled={blocked} wide>
      <ChipButton
        ref={focusRef}
        aria-disabled={blocked || undefined}
        onClick={blocked ? undefined : onStart}
        className={cn(failed && '!text-error', blocked && 'opacity-50 cursor-not-allowed')}
        icon={
          failed ? (
            <CircleAlert className={ICON_CLASSES} aria-hidden="true" />
          ) : (
            <Database className={ICON_CLASSES} aria-hidden="true" />
          )
        }
        label={label}
        labelRef={labelRef}
      />
    </ConditionalTooltip>
  )
}

export function CatalogChip({
  state,
  count,
  items,
  nouns,
  error,
  blockedNote,
  onStart,
  onStop,
  onRefresh,
  onInsert,
  onPopoverClosed,
}: Readonly<CatalogChipProps>) {
  const note = blockedNote || null
  // A blocked chip reads idle whatever its pull holds.
  const shown: CatalogChipState = note === null ? state : 'idle'
  const label = chipLabel(shown, count, nouns)
  const busy = shown === 'connecting' || shown === 'reading'
  const passFocus = useFocusHandoff()

  let primary: ReactNode = null
  let secondary: ReactNode = null
  if (busy) {
    secondary = <StopButton key="stop" label={nouns.stopLabel} focusRef={passFocus} onStop={onStop} />
  } else if (shown === 'done' || shown === 'settled') {
    primary = (
      <LoadedChip
        done={shown === 'done'}
        label={label}
        focusRef={passFocus}
        items={items ?? NO_ITEMS}
        nouns={nouns.popover}
        onInsert={onInsert}
        onPopoverClosed={onPopoverClosed}
      />
    )
    if (shown === 'settled') {
      secondary = (
        <RefreshButton
          key="refresh"
          label={nouns.refreshLabel}
          focusRef={passFocus}
          onRefresh={onRefresh}
        />
      )
    }
  } else {
    primary = (
      <StartChip
        failed={shown === 'failed'}
        error={error}
        blockedNote={note}
        label={label}
        focusRef={passFocus}
        onStart={onStart}
      />
    )
  }

  // One live region stays mounted through every state, so each change is announced.
  return (
    <div
      data-testid="get-tables-chip"
      data-state={shown}
      className={cn('inline-flex min-w-0 items-center gap-1', busy && BUSY_CLASSES)}
    >
      {busy ? (
        <Loader2
          data-testid="get-tables-spinner"
          aria-hidden="true"
          className="h-3.5 w-3.5 shrink-0 animate-spin motion-reduce:animate-none text-muted-foreground"
        />
      ) : null}
      <span
        data-testid="get-tables-status"
        aria-live="polite"
        className={busy ? LABEL_CLASSES : 'sr-only'}
      >
        {label}
      </span>
      {primary}
      {secondary}
    </div>
  )
}
