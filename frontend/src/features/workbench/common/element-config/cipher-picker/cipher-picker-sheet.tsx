/**
 * CipherPickerSheet - the bespoke TLS cipher-suite picker over the fixed
 * host-independent catalog (GET /system/tls-capabilities), split into two
 * tables by protocol family (TLS 1.0-1.2 and TLS 1.3), each selectable and
 * drag-reorderable within its own family. The node's tls_min/max draft range
 * hides out-of-range rows and empty tables. Three states: default (value
 * undefined = the default, every visible row enabled), an explicit
 * ordered subset (stored table-1 order ++ table-2 order), and explicit zero.
 * Unchecking the last cipher lands in zero, not back to defaults; Reset
 * returns to defaults.
 */

import { useState, type ReactNode, type Ref } from 'react'
import { ChevronRight, GripVertical, X } from 'lucide-react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { DraggableSheet, type SheetHandle } from '@/components/shared/draggable-sheet'
import { useChildEditor } from '@/components/shared/child-editors/child-editor-scope'
import { EDIT_HEADER_LABEL } from '@/components/shared/variable-bodies/body-parts'
import type { TlsCipher } from '@/services/tls-capabilities'
import { CipherRow, SortableCipherRow } from './cipher-row'
import { compatTag, findCipher, isTls13, useTlsCapabilities, visibleCiphers } from './tls-inventory'

const DEFAULTS_NOTE = 'Default'

export interface CipherPickerSheetProps {
  /** Lets the opener raise this sheet again. */
  ref?: Ref<SheetHandle>
  /** The label of the row this editor was opened from, as the row shows it. */
  label: string
  /** undefined = default (every visible row enabled); [] = explicit zero
   *  ciphers; [...] = explicit ordered client-preference subset. */
  value: string[] | undefined
  /** The node's current draft TLS version range (concrete "1.0".."1.3" values). */
  minVersion: string
  maxVersion: string
  onSave: (value: string[] | undefined) => void
  onClose: () => void
}

/** Move `activeId` to `overId`'s slot within the list (no-op if either is absent). */
export function moveCipher(list: string[], activeId: string, overId: string): string[] {
  const from = list.indexOf(activeId)
  const to = list.indexOf(overId)
  if (from < 0 || to < 0 || from === to) return list
  return arrayMove(list, from, to)
}

/** Reorder within one family's slice of the list; reorder never crosses families. */
export function moveCipherInFamily(
  list: string[],
  family: ReadonlySet<string>,
  activeId: string,
  overId: string,
): string[] {
  const familySelection = list.filter((name) => family.has(name))
  const moved = moveCipher(familySelection, activeId, overId)
  if (moved === familySelection) return list
  return [...moved, ...list.filter((name) => !family.has(name))]
}

/** A checked suite and the name the list holds it under. */
export interface CipherPick {
  row: TlsCipher
  name: string
}

/** The `rows` that `names` name under either name, in `names` order, each once under its first name. */
function selectionPicks(names: string[], rows: TlsCipher[]): CipherPick[] {
  const picks: CipherPick[] = []
  for (const name of names) {
    const row = findCipher(rows, name)
    if (row && !picks.some((pick) => pick.row === row)) picks.push({ row, name })
  }
  return picks
}

/** One collapsible picker section: chevron header band + content-sized body. */
function CipherSection({
  sectionKey,
  label,
  testId,
  children,
}: Readonly<{
  sectionKey: string
  label: string
  testId?: string
  children: ReactNode
}>) {
  const [expanded, setExpanded] = useState(true)
  return (
    <div data-testid={testId} className="shrink-0 overflow-hidden rounded-lg border">
      <button
        type="button"
        data-testid={`cipher-section-toggle-${sectionKey}`}
        aria-expanded={expanded}
        onClick={() => setExpanded((prev) => !prev)}
        className={cn(
          'flex w-full items-center gap-1.5 bg-muted px-2.5 py-1.5 text-left cursor-pointer select-none',
          expanded && 'border-b border-border',
        )}
      >
        <ChevronRight
          aria-hidden="true"
          className={cn(
            'h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform',
            expanded && 'rotate-90',
          )}
        />
        <span className={EDIT_HEADER_LABEL}>{label}</span>
      </button>
      {expanded && <div>{children}</div>}
    </div>
  )
}

/** One protocol-family table: selected rows first (drag-reorderable, in
 *  preference order), then unselected rows in catalog order. */
function CipherFamilyTable({
  sectionKey,
  label,
  testId,
  rows,
  selected,
  withTags,
  onToggle,
  onDragEnd,
}: Readonly<{
  sectionKey: string
  label: string
  testId: string
  rows: TlsCipher[]
  selected: TlsCipher[]
  withTags?: boolean
  onToggle: (openssl: string, selected: boolean) => void
  onDragEnd: (event: DragEndEvent) => void
}>) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const unselected = rows.filter((row) => !selected.includes(row))
  const ianaFor = (row: TlsCipher) => (row.iana === row.openssl ? undefined : row.iana)
  const tagFor = (row: TlsCipher) => (withTags ? compatTag(row) : undefined)
  return (
    <CipherSection sectionKey={sectionKey} label={label} testId={testId}>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext
          items={selected.map((row) => row.openssl)}
          strategy={verticalListSortingStrategy}
        >
          {selected.map((row) => (
            <SortableCipherRow
              key={row.openssl}
              openssl={row.openssl}
              iana={ianaFor(row)}
              tag={tagFor(row)}
              onToggle={onToggle}
            />
          ))}
        </SortableContext>
      </DndContext>
      {unselected.map((row) => (
        <CipherRow
          key={row.openssl}
          openssl={row.openssl}
          iana={ianaFor(row)}
          tag={tagFor(row)}
          selected={false}
          onToggle={onToggle}
        />
      ))}
    </CipherSection>
  )
}

/** The name the list holds for a dragged row: row ids are OpenSSL names, the list may hold an IANA name. */
export function heldName(picks: readonly CipherPick[], id: unknown): string {
  return picks.find((pick) => pick.row.openssl === id)?.name ?? String(id)
}

export function CipherPickerSheet({
  ref,
  label,
  value,
  minVersion,
  maxVersion,
  onSave,
  onClose,
}: Readonly<CipherPickerSheetProps>) {
  // null = default (every visible row); [] = explicit zero; [...] = explicit subset.
  const [selected, setSelected] = useState<string[] | null>(value ?? null)
  const { capabilities, error: fetchError } = useTlsCapabilities()

  const visible = capabilities ? visibleCiphers(capabilities, minVersion, maxVersion) : []
  const family12 = visible.filter((cipher) => !isTls13(cipher))
  const family13 = visible.filter(isTls13)
  const allVisibleNames = [...family12, ...family13].map((cipher) => cipher.openssl)

  const isDefault = selected === null
  const effective = selected ?? allVisibleNames
  const picks12 = selectionPicks(effective, family12)
  const picks13 = selectionPicks(effective, family13)
  const selected12 = picks12.map((pick) => pick.row)
  const selected13 = picks13.map((pick) => pick.row)
  const selectedCount = picks12.length + picks13.length

  const toggle = (openssl: string, isSelected: boolean) =>
    setSelected((prev) => {
      // From the default state, the first change materializes the explicit set.
      const base = prev ?? allVisibleNames
      const target = findCipher(visible, openssl)
      return isSelected ? [...base, openssl] : base.filter((name) => findCipher(visible, name) !== target)
    })

  /* v8 ignore start - COV-V8-003: dnd-kit drag events do not fire under jsdom */
  const dragEndWithin = (picks: CipherPick[]) => (event: DragEndEvent) => {
    const { active, over } = event
    if (!over) return
    const names = new Set(picks.map((pick) => pick.name))
    const from = heldName(picks, active.id)
    const to = heldName(picks, over.id)
    setSelected((prev) => moveCipherInFamily(prev ?? allVisibleNames, names, from, to))
  }
  /* v8 ignore stop */

  const loading = capabilities === null && fetchError === null

  const commit = () => onSave(isDefault ? undefined : [...picks12, ...picks13].map((pick) => pick.name))

  useChildEditor({
    label,
    hasChanges: JSON.stringify(selected) !== JSON.stringify(value ?? null),
    cannotBeSaved: capabilities === null,
    apply: commit,
  })

  return (
    <DraggableSheet
      ref={ref}
      open
      onClose={onClose}
      sheetId="cipher-picker"
      resizable
      ariaLabel="Edit value"
      data-testid="cipher-picker-sheet"
      initialWidth={560}
      initialHeight={520}
      minWidth={480}
      minHeight={360}
      className="max-w-[90vw] max-h-[85vh] shadow-xl"
      headerClassName="py-2"
      header={
        <>
          <div className="flex flex-1 items-center gap-2 min-w-0">
            <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="text-sm font-semibold truncate">Edit value</span>
            <span
              data-testid="cipher-picker-type-badge"
              className="text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-600 dark:text-sky-400"
            >
              ciphers
            </span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Close cipher picker"
            onClick={onClose}
            onPointerDown={(event) => event.stopPropagation()}
            className="h-7 w-7"
          >
            <X className="h-4 w-4" />
          </Button>
        </>
      }
    >
      <div className="flex flex-1 min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain px-4 py-3">
        {loading && (
          <p aria-live="polite" data-testid="cipher-picker-loading" className="text-sm text-muted-foreground">
            Loading cipher inventory…
          </p>
        )}
        {fetchError && (
          <p role="alert" data-testid="cipher-picker-error" className="text-sm text-destructive">
            Could not load the cipher inventory: {fetchError}. Reopen the picker to retry.
          </p>
        )}
        {capabilities && (
          <>
            {family12.length > 0 && (
              <CipherFamilyTable
                sectionKey="tls12"
                label="TLS 1.0-1.2 - preference order"
                testId="cipher-table-tls12"
                rows={family12}
                selected={selected12}
                withTags
                onToggle={toggle}
                onDragEnd={dragEndWithin(picks12)}
              />
            )}
            {family13.length > 0 && (
              <CipherFamilyTable
                sectionKey="tls13"
                label="TLS 1.3 - preference order"
                testId="cipher-table-tls13"
                rows={family13}
                selected={selected13}
                onToggle={toggle}
                onDragEnd={dragEndWithin(picks13)}
              />
            )}
          </>
        )}
      </div>

      <div className="flex items-center gap-2 px-3 py-2 border-t bg-muted/30 rounded-b-lg shrink-0">
        <span
          data-testid="cipher-picker-metric"
          className="text-xs text-muted-foreground tabular-nums"
        >
          {isDefault ? `All ${allVisibleNames.length} enabled` : `${selectedCount} selected`}
        </span>
        {isDefault && (
          <span
            data-testid="cipher-picker-defaults-note"
            className="text-xs text-muted-foreground"
          >
            {DEFAULTS_NOTE}
          </span>
        )}
        <span className="flex-1" />
        {!isDefault && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="cipher-picker-reset-button"
            onClick={() => setSelected(null)}
          >
            Reset to defaults
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="cipher-picker-cancel-button"
          onClick={onClose}
        >
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          data-testid="cipher-picker-save-button"
          disabled={capabilities === null}
          onClick={() => {
            commit()
            onClose()
          }}
        >
          Save
        </Button>
      </div>
    </DraggableSheet>
  )
}
