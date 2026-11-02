/**
 * RegressionsRowActions Component
 *
 * REQ-5.2.1.37: Regression management screen (list, create, edit, version control)
 *
 * Row-level actions for the regressions table.
 * - Run button (primary action, always visible)
 * - Overflow menu with: Edit, Duplicate, Delete
 * - NO Move to Regression (regressions are top of hierarchy)
 */

/* v8 ignore next - COV-V8-001 */
import { EntityRowActions } from '@/components/shared/actions/entity-row-actions'
import { DropdownItem } from '@/components/ui/dropdown'
import { Icon } from '@/components/ui/icon'
import { Download } from 'lucide-react'

export interface RegressionsRowActionsProps {
  regressionId: string
  regressionName: string
  onRun: (regressionId: string) => void
  onEdit: (regressionId: string) => void
  onDelete: (regressionId: string) => void
  onDuplicate: (regressionId: string) => void
  onExport?: (regressionId: string) => void
  runDisabled?: boolean
  runDisabledReason?: string
}

export function RegressionsRowActions({
  regressionId,
  regressionName,
  onRun,
  onEdit,
  onDelete,
  onDuplicate,
  onExport,
  runDisabled = false,
  runDisabledReason,
}: Readonly<RegressionsRowActionsProps>) {
  return (
    <EntityRowActions
      entityId={regressionId}
      entityName={regressionName}
      onRun={onRun}
      onEdit={onEdit}
      onDelete={onDelete}
      onDuplicate={onDuplicate}
      runDisabled={runDisabled}
      runDisabledReason={runDisabledReason}
    >
      {onExport && (
        <DropdownItem onSelect={() => onExport(regressionId)} data-testid="row-action-export">
          <Icon icon={Download} size="sm" className="mr-2" />
          Export
        </DropdownItem>
      )}
    </EntityRowActions>
  )
}
