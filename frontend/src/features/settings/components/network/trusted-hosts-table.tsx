/**
 * Trusted SSH Hosts table (NET-3): every staged row with a trash icon and a Delete-only
 * Mass Action; removals are staged by the page, so nothing asks for confirmation.
 */

import { useMemo, useState } from 'react'
import type { ColumnDef, RowSelectionState, SortingFn, SortingState } from '@tanstack/react-table'
import { SimpleBulkActions } from '@/components/shared/actions/simple-bulk-actions'
import { actionsColumn } from '@/components/shared/data-table/column-factories'
import { DataTableColumnHeader } from '@/components/shared/data-table/data-table-column-header'
import { Timestamp } from '@/components/shared/timestamp/timestamp'
import { NetworkAddButton } from '@/features/settings/components/network/network-add-button'
import { NetworkRemoveButton } from '@/features/settings/components/network/network-remove-button'
import { NetworkTable } from '@/features/settings/components/network/network-table'
import type { StagedTrustedHost } from '@/features/settings/api/ssh-hosts'

type HostColumn = ColumnDef<StagedTrustedHost, unknown>

const HOST_SORTING: SortingState = [{ id: 'host', desc: false }]
const HEADER_CLASS = 'whitespace-nowrap'
const NO_SELECTION: RowSelectionState = {}
const ADD_LABEL = 'Add hosts'

const getRowId = (row: StagedTrustedHost) => row.id
const getRowLabel = (row: StagedTrustedHost) => row.host
const searchText = (row: StagedTrustedHost) => row.host

function compareText(a: string, b: string): number {
  if (a === b) return 0
  return a < b ? -1 : 1
}

/** Host, then port, then key type, in plain character order like the server's list. */
const byHostPortKeyType: SortingFn<StagedTrustedHost> = ({ original: a }, { original: b }) =>
  compareText(a.host, b.host) || a.port - b.port || compareText(a.key_type, b.key_type)

const DATA_COLUMNS: HostColumn[] = [
  {
    id: 'host',
    accessorKey: 'host',
    sortingFn: byHostPortKeyType,
    header: ({ column }) => <DataTableColumnHeader column={column} label="Host" className={HEADER_CLASS} />,
    cell: ({ row }) => (
      <span className="block max-w-60 truncate" title={row.original.host} translate="no">
        {row.original.host}
      </span>
    ),
    meta: { sticky: 'left', skeletonWidth: 'w-40' },
  },
  {
    id: 'port',
    accessorKey: 'port',
    header: ({ column }) => <DataTableColumnHeader column={column} label="Port" className={HEADER_CLASS} />,
    meta: { skeletonWidth: 'w-10' },
  },
  {
    id: 'key_type',
    accessorKey: 'key_type',
    header: ({ column }) => <DataTableColumnHeader column={column} label="Key type" className={HEADER_CLASS} />,
    cell: ({ row }) => <span translate="no">{row.original.key_type}</span>,
    meta: { skeletonWidth: 'w-16' },
  },
  {
    id: 'fingerprint',
    accessorKey: 'fingerprint',
    header: ({ column }) => <DataTableColumnHeader column={column} label="Fingerprint" className={HEADER_CLASS} />,
    // The fingerprint takes no width of its own and fills what the one-line columns leave.
    cell: ({ row }) => (
      <span
        className="block w-0 min-w-full truncate font-mono text-xs"
        title={row.original.fingerprint}
        translate="no"
      >
        {row.original.fingerprint}
      </span>
    ),
    meta: { skeletonWidth: 'w-64', width: 'w-full' },
  },
  {
    id: 'added',
    accessorKey: 'added',
    // Text sorting reads a staged row's missing date as empty, so it sorts before every saved date.
    sortingFn: 'text',
    header: ({ column }) => <DataTableColumnHeader column={column} label="Added" className={HEADER_CLASS} />,
    cell: ({ row }) =>
      row.original.added === null ? (
        <span className="text-muted-foreground">Unsaved</span>
      ) : (
        <Timestamp value={row.original.added} style="date" className="whitespace-nowrap" />
      ),
    meta: { skeletonWidth: 'w-24' },
  },
]

const ACTIONS_HEADER = { header: () => <span className="sr-only">Actions</span> }

function buildColumns(onRemove: (ids: string[]) => void, disabled: boolean): HostColumn[] {
  const trashColumn = actionsColumn<StagedTrustedHost>({
    skeletonWidth: 'w-8',
    render: (row) => (
      <NetworkRemoveButton
        aria-label={`Remove ${row.host}`}
        disabled={disabled}
        onClick={() => onRemove([row.id])}
      />
    ),
  })
  // The trash column header reads blank on screen (NET-3) but keeps its name for screen readers.
  return [...DATA_COLUMNS, Object.assign(trashColumn, ACTIONS_HEADER)]
}

export interface TrustedHostsTableProps {
  hosts: StagedTrustedHost[]
  loading: boolean
  /** Disables Add hosts, Mass Action and every trash button (while the page saves). */
  disabled?: boolean
  onAdd: () => void
  onRemove: (ids: string[]) => void
}

export function TrustedHostsTable({
  hosts,
  loading,
  disabled = false,
  onAdd,
  onRemove,
}: Readonly<TrustedHostsTableProps>) {
  const [selectionMode, setSelectionMode] = useState(false)
  const [selected, setSelected] = useState<RowSelectionState>(NO_SELECTION)

  const columns = useMemo(() => buildColumns(onRemove, disabled), [onRemove, disabled])

  // A row that left the table (removed or saved away) no longer counts as selected.
  const liveSelected = useMemo(() => {
    const ids = new Set(hosts.map((host) => host.id))
    return Object.fromEntries(Object.entries(selected).filter(([id, on]) => on && ids.has(id)))
  }, [hosts, selected])
  const selectedIds = Object.keys(liveSelected)

  const exitSelectionMode = () => {
    setSelected(NO_SELECTION)
    setSelectionMode(false)
  }

  const handleDelete = () => {
    onRemove(selectedIds)
    exitSelectionMode()
  }

  return (
    <NetworkTable
      data-testid="trusted-hosts-table"
      columns={columns}
      data={hosts}
      getRowId={getRowId}
      getRowLabel={getRowLabel}
      searchPlaceholder="Search hosts…"
      searchText={searchText}
      entityName="hosts"
      emptyMessage="No trusted SSH hosts"
      emptyAction={<NetworkAddButton label={ADD_LABEL} onClick={onAdd} disabled={disabled} />}
      defaultSorting={HOST_SORTING}
      loading={loading}
      selection={{ active: selectionMode, selected: liveSelected, onChange: setSelected }}
      actions={
        <>
          <SimpleBulkActions
            selectedCount={selectedIds.length}
            selectionModeActive={selectionMode}
            onDelete={handleDelete}
            onEnterSelectionMode={() => setSelectionMode(true)}
            onExitSelectionMode={exitSelectionMode}
            disabled={disabled}
          />
          <NetworkAddButton label={ADD_LABEL} onClick={onAdd} disabled={disabled} />
        </>
      }
    />
  )
}
