/**
 * SuitesRowActions Component
 *
 * Row-level actions for the suites table.
 * - Run button (primary action, always visible)
 * - Overflow menu with: Edit, Duplicate, Delete
 * - NO Move to Suite (suites have no parent entity)
 */

/* v8 ignore next - COV-V8-001 */
import { EntityRowActions } from '@/components/shared/actions/entity-row-actions'
import { DropdownItem } from '@/components/ui/dropdown'
import { Icon } from '@/components/ui/icon'
import { Download } from 'lucide-react'

export interface SuitesRowActionsProps {
  suiteId: string
  suiteName: string
  onRun: (suiteId: string) => void
  onEdit: (suiteId: string) => void
  onDelete: (suiteId: string) => void
  onDuplicate: (suiteId: string) => void
  onExport?: (suiteId: string) => void
  runDisabled?: boolean
  runDisabledReason?: string
}

export function SuitesRowActions({
  suiteId,
  suiteName,
  onRun,
  onEdit,
  onDelete,
  onDuplicate,
  onExport,
  runDisabled = false,
  runDisabledReason,
}: Readonly<SuitesRowActionsProps>) {
  return (
    <EntityRowActions
      entityId={suiteId}
      entityName={suiteName}
      onRun={onRun}
      onEdit={onEdit}
      onDelete={onDelete}
      onDuplicate={onDuplicate}
      runDisabled={runDisabled}
      runDisabledReason={runDisabledReason}
    >
      {onExport && (
        <DropdownItem onSelect={() => onExport(suiteId)} data-testid="row-action-export">
          <Icon icon={Download} size="sm" className="mr-2" />
          Export
        </DropdownItem>
      )}
    </EntityRowActions>
  )
}
