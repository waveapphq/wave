/**
 * Preview table of the Add Hosts dialog (NET-4): checkable host keys, with marked
 * rows ("Already trusted", "Key changed") shown but not selectable.
 */

import { functionalUpdate, type ColumnDef, type RowSelectionState } from '@tanstack/react-table'
import { DataTable } from '@/components/shared/data-table/data-table'
import type { DataTableColumnMeta } from '@/components/shared/data-table/types'
import type { HostKeyType } from '@/features/settings/api/ssh-hosts'

export type HostKeyMarker = 'none' | 'already-trusted' | 'key-changed'

export interface HostKeyPreviewRow {
  id: string
  hostNames: string[]
  port: number
  keyType: HostKeyType
  key: string
  fingerprint: string
  marker: HostKeyMarker
}

export interface HostKeyPreviewTableProps {
  rows: HostKeyPreviewRow[]
  /** Paste lines shows the Host column and cuts the fingerprint; Detect shows it whole. */
  showHost: boolean
  selected: RowSelectionState
  onSelectedChange: (next: RowSelectionState) => void
}

type PreviewColumn = ColumnDef<HostKeyPreviewRow, unknown>

const MARKER_TEXT: Record<HostKeyMarker, string> = {
  none: '',
  'already-trusted': 'Already trusted',
  'key-changed': 'Key changed',
}

const getRowId = (row: HostKeyPreviewRow) => row.id
/** A marked row's checkbox name ends with its marker, so the disabled checkbox says why. */
const getRowLabel = (row: HostKeyPreviewRow) =>
  [row.hostNames.join(', '), row.keyType, MARKER_TEXT[row.marker]].filter(Boolean).join(' ')
const canSelectRow = (row: HostKeyPreviewRow) => row.marker === 'none'

function Marker({ marker }: Readonly<{ marker: HostKeyMarker }>) {
  if (marker === 'already-trusted') {
    return <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">{MARKER_TEXT[marker]}</span>
  }
  if (marker === 'key-changed') {
    return <span className="shrink-0 whitespace-nowrap text-xs text-error">{MARKER_TEXT[marker]}</span>
  }
  return null
}

function fingerprintColumn(cut: boolean): PreviewColumn {
  return {
    id: 'fingerprint',
    header: 'Fingerprint',
    cell: ({ row }) => (
      // A cut fingerprint takes no width of its own, so its column gets the room the fixed columns leave.
      <div className={cut ? 'flex w-0 min-w-full items-center gap-2' : 'flex items-center gap-2'}>
        <span
          className={cut ? 'min-w-0 truncate font-mono text-xs' : 'whitespace-nowrap font-mono text-xs'}
          title={row.original.fingerprint}
          translate="no"
        >
          {row.original.fingerprint}
        </span>
        <Marker marker={row.original.marker} />
      </div>
    ),
  }
}

const HOST_COLUMN: PreviewColumn = {
  id: 'host',
  header: 'Host',
  cell: ({ row }) => {
    const names = row.original.hostNames.join(', ')
    return (
      <span className="block max-w-40 truncate" title={names} translate="no">
        {names}
      </span>
    )
  },
  meta: { width: 'w-48' } satisfies DataTableColumnMeta,
}

const KEY_TYPE_COLUMN: PreviewColumn = {
  id: 'key_type',
  header: 'Key type',
  cell: ({ row }) => (
    <span className="whitespace-nowrap" translate="no">
      {row.original.keyType}
    </span>
  ),
}

const PASTE_COLUMNS: PreviewColumn[] = [
  HOST_COLUMN,
  { ...KEY_TYPE_COLUMN, meta: { width: 'w-26' } satisfies DataTableColumnMeta },
  fingerprintColumn(true),
]
const DETECT_COLUMNS: PreviewColumn[] = [KEY_TYPE_COLUMN, fingerprintColumn(false)]

export function HostKeyPreviewTable({
  rows,
  showHost,
  selected,
  onSelectedChange,
}: Readonly<HostKeyPreviewTableProps>) {
  return (
    <DataTable
      columns={showHost ? PASTE_COLUMNS : DETECT_COLUMNS}
      data={rows}
      enableSorting={false}
      defaultPageSize={0}
      entityName="keys"
      enableSelection
      canSelectRow={canSelectRow}
      rowSelection={selected}
      onRowSelectionChange={(updater) => onSelectedChange(functionalUpdate(updater, selected))}
      getRowId={getRowId}
      getRowLabel={getRowLabel}
    />
  )
}
