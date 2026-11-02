/**
 * Certificate table columns shared by Built-in Authorities, Additional
 * Certificates and the Add Certificate preview (NET-5, NET-7, NET-8).
 */

import type { ColumnDef } from '@tanstack/react-table'
import { Eye } from 'lucide-react'
import { DataTableColumnHeader } from '@/components/shared/data-table/data-table-column-header'
import type { DataTableColumnMeta } from '@/components/shared/data-table/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { CertificateType } from '@/features/settings/api/certificates'
import { NetworkRemoveButton } from '@/features/settings/components/network/network-remove-button'

const PINNED_NAME_META: DataTableColumnMeta = { sticky: 'left', skeletonWidth: 'w-[70%]' }
const NAME_META: DataTableColumnMeta = { skeletonWidth: 'w-[70%]' }
const VIEW_ACTIONS_META: DataTableColumnMeta = { sticky: 'right', skeletonWidth: 'w-8', skeletonHeight: 'h-8', width: 'w-16' }
const VIEW_REMOVE_ACTIONS_META: DataTableColumnMeta = { ...VIEW_ACTIONS_META, width: 'w-26' }
const ICON_BUTTON_CLASS = 'h-8 w-8 p-0 text-muted-foreground'

interface Named {
  name: string
}

/** A certificate row's table id: its SHA-256 fingerprint. */
export const certificateId = (row: { id: string }): string => row.id

/** A certificate row's label for checkbox names and search. */
export const certificateName = (row: Named): string => row.name

/** The column at a fixed width; the columns left without one share the rest of the table. */
export function withColumnWidth<T>(column: ColumnDef<T, unknown>, width: string): ColumnDef<T, unknown> {
  return { ...column, meta: { ...column.meta, width } satisfies DataTableColumnMeta }
}

export interface CertificateNameColumnOptions<T> {
  /** Muted text after the name, for example "Already added". */
  marker?: (row: T) => string | undefined
  /** Keeps the column at the left edge when the table scrolls sideways. */
  pinned?: boolean
}

export function certificateNameColumn<T extends Named>({
  marker,
  pinned = false,
}: CertificateNameColumnOptions<T> = {}): ColumnDef<T, unknown> {
  return {
    id: 'name',
    accessorFn: (row) => row.name,
    header: ({ column }) => <DataTableColumnHeader column={column} label="Name" />,
    cell: ({ row }) => {
      const note = marker?.(row.original)
      return (
        <span className="flex min-w-0 items-center gap-2">
          <span translate="no">{row.original.name}</span>
          {note && <span className="shrink-0 text-xs text-muted-foreground">{note}</span>}
        </span>
      )
    },
    meta: pinned ? PINNED_NAME_META : NAME_META,
  }
}

export function certificateOrganizationColumn<T extends { organization: string }>(): ColumnDef<T, unknown> {
  return {
    id: 'organization',
    accessorFn: (row) => row.organization,
    header: ({ column }) => <DataTableColumnHeader column={column} label="Organization" />,
    cell: ({ getValue }) => <span translate="no">{getValue<string>()}</span>,
    meta: { skeletonWidth: 'w-40' } satisfies DataTableColumnMeta,
  }
}

export function certificateTypeColumn<T extends { type: CertificateType }>(): ColumnDef<T, unknown> {
  return {
    id: 'type',
    accessorFn: (row) => row.type,
    header: ({ column }) => <DataTableColumnHeader column={column} label="Type" />,
    meta: { skeletonWidth: 'w-20' } satisfies DataTableColumnMeta,
  }
}

export function certificateExpiresColumn<T extends { expires: string }>(
  isExpired?: (row: T) => boolean,
): ColumnDef<T, unknown> {
  return {
    id: 'expires',
    accessorFn: (row) => row.expires,
    header: ({ column }) => <DataTableColumnHeader column={column} label="Expires" />,
    cell: ({ row, getValue }) => (
      <span className="flex items-center gap-2 whitespace-nowrap">
        <span>{getValue<string>()}</span>
        {isExpired?.(row.original) && <Badge variant="error">Expired</Badge>}
      </span>
    ),
    meta: { skeletonWidth: 'w-20' } satisfies DataTableColumnMeta,
  }
}

export interface CertificateActionsOptions<T> {
  onView: (row: T) => void
  /** Omit for a read-only table: no trash icon. */
  onRemove?: (row: T) => void
  /** Disables the trash icon; the eye stays enabled. */
  removeDisabled?: boolean
}

export function certificateActionsColumn<T extends Named>({
  onView,
  onRemove,
  removeDisabled = false,
}: CertificateActionsOptions<T>): ColumnDef<T, unknown> {
  return {
    id: 'actions',
    header: () => <span className="sr-only">Actions</span>,
    enableSorting: false,
    cell: ({ row }) => (
      <span className="flex items-center justify-end gap-1">
        <Button
          variant="ghost"
          size="sm"
          className={ICON_BUTTON_CLASS}
          aria-label={`View ${row.original.name}`}
          onClick={() => onView(row.original)}
        >
          <Eye className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
        {onRemove && (
          <NetworkRemoveButton
            aria-label={`Remove ${row.original.name}`}
            disabled={removeDisabled}
            onClick={() => onRemove(row.original)}
          />
        )}
      </span>
    ),
    meta: onRemove ? VIEW_REMOVE_ACTIONS_META : VIEW_ACTIONS_META,
  }
}
