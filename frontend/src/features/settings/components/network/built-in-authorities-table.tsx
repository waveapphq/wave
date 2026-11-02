/**
 * Built-in Authorities: the bundled public list, read-only (NET-5).
 */

import { useMemo } from 'react'
import type { SortingState } from '@tanstack/react-table'
import type { CertificateRow } from '@/features/settings/api/certificates'
import {
  certificateActionsColumn,
  certificateExpiresColumn,
  certificateId,
  certificateName,
  certificateNameColumn,
  certificateOrganizationColumn,
  withColumnWidth,
} from '@/features/settings/components/network/certificate-columns'
import { NetworkTable } from '@/features/settings/components/network/network-table'

const BY_NAME: SortingState = [{ id: 'name', desc: false }]

const rowSearchText = (row: CertificateRow) => `${row.name} ${row.organization}`

export interface BuiltInAuthoritiesTableProps {
  certificates: CertificateRow[]
  loading: boolean
  onView: (id: string) => void
}

export function BuiltInAuthoritiesTable({ certificates, loading, onView }: Readonly<BuiltInAuthoritiesTableProps>) {
  const columns = useMemo(
    () => [
      certificateNameColumn<CertificateRow>({ pinned: true }),
      withColumnWidth(certificateOrganizationColumn<CertificateRow>(), 'w-68'),
      withColumnWidth(certificateExpiresColumn<CertificateRow>(), 'w-34'),
      certificateActionsColumn<CertificateRow>({ onView: (row) => onView(row.id) }),
    ],
    [onView],
  )

  return (
    <NetworkTable
      data-testid="built-in-authorities-table"
      columns={columns}
      data={certificates}
      getRowId={certificateId}
      getRowLabel={certificateName}
      searchPlaceholder="Search authorities…"
      searchText={rowSearchText}
      entityName="authorities"
      emptyMessage="No built-in authorities"
      loading={loading}
      defaultSorting={BY_NAME}
    />
  )
}
