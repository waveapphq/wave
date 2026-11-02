/**
 * Additional Certificates: the admin's staged certificate list with eye, trash
 * and a Delete-only Mass Action; removals are staged, never confirmed (NET-7).
 */

import { useMemo, useState } from 'react'
import type { RowSelectionState, SortingState } from '@tanstack/react-table'
import { SimpleBulkActions } from '@/components/shared/actions/simple-bulk-actions'
import type { StagedCertificateRow } from '@/features/settings/api/certificates'
import {
  certificateActionsColumn,
  certificateExpiresColumn,
  certificateId,
  certificateName,
  certificateNameColumn,
  certificateTypeColumn,
  withColumnWidth,
} from '@/features/settings/components/network/certificate-columns'
import { NetworkAddButton } from '@/features/settings/components/network/network-add-button'
import { NetworkTable } from '@/features/settings/components/network/network-table'

const BY_NAME: SortingState = [{ id: 'name', desc: false }]
const NO_SELECTION: RowSelectionState = {}
const ADD_LABEL = 'Add certificate'

export interface AdditionalCertificatesTableProps {
  certificates: StagedCertificateRow[]
  loading: boolean
  onAdd: () => void
  onView: (row: StagedCertificateRow) => void
  onRemove: (ids: string[]) => void
  /** Locks Add certificate, Mass Action and the trash icons, as while saving. */
  disabled?: boolean
}

export function AdditionalCertificatesTable({
  certificates,
  loading,
  onAdd,
  onView,
  onRemove,
  disabled = false,
}: Readonly<AdditionalCertificatesTableProps>) {
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<RowSelectionState>(NO_SELECTION)

  const columns = useMemo(
    () => [
      certificateNameColumn<StagedCertificateRow>({ pinned: true }),
      withColumnWidth(certificateTypeColumn<StagedCertificateRow>(), 'w-50'),
      withColumnWidth(certificateExpiresColumn<StagedCertificateRow>(), 'w-34'),
      certificateActionsColumn<StagedCertificateRow>({
        onView,
        onRemove: (row) => onRemove([row.id]),
        removeDisabled: disabled,
      }),
    ],
    [onView, onRemove, disabled],
  )

  // Rows removed since they were checked no longer count.
  const selectedIds = certificates.filter((row) => selected[row.id]).map((row) => row.id)

  const exitSelection = () => {
    setSelecting(false)
    setSelected(NO_SELECTION)
  }

  const deleteSelected = () => {
    onRemove(selectedIds)
    exitSelection()
  }

  return (
    <NetworkTable
      data-testid="additional-certificates-table"
      columns={columns}
      data={certificates}
      getRowId={certificateId}
      getRowLabel={certificateName}
      searchPlaceholder="Search certificates…"
      searchText={certificateName}
      entityName="certificates"
      emptyMessage="No additional certificates"
      emptyAction={<NetworkAddButton label={ADD_LABEL} onClick={onAdd} disabled={disabled} />}
      actions={
        <>
          <SimpleBulkActions
            selectedCount={selectedIds.length}
            selectionModeActive={selecting}
            onDelete={deleteSelected}
            onEnterSelectionMode={() => setSelecting(true)}
            onExitSelectionMode={exitSelection}
            disabled={disabled}
          />
          <NetworkAddButton label={ADD_LABEL} onClick={onAdd} disabled={disabled} />
        </>
      }
      selection={{ active: selecting, selected, onChange: setSelected }}
      loading={loading}
      defaultSorting={BY_NAME}
    />
  )
}
