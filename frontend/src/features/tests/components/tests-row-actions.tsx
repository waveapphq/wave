/**
 * TestsRowActions Component
 *
 * Row-level actions for the tests table.
 * - Run button (primary action, always visible)
 * - Overflow menu with: Edit, Duplicate, Add to Suite, Remove from Suite, Delete
 */

/* v8 ignore next - COV-V8-006 */
import {
  Dropdown,
  DropdownTrigger,
  DropdownMenu,
  DropdownItem,
  DropdownDivider,
} from '@/components/ui/dropdown'
import { Button } from '@/components/ui/button'
import { Icon, PlayIcon, EditIcon, CopyIcon, TrashIcon } from '@/components/ui/icon'
import { MoreHorizontal, FolderPlus, FolderMinus, Download } from 'lucide-react'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { SuitePickerPopover } from './suite-picker-popover'
import { useSuiteConfirmState } from './use-suite-confirm-state'
import { ConditionalTooltip } from '@/components/ui/tooltip'

export interface Suite {
  id: string
  name: string
}

export interface TestsRowActionsProps {
  testId: string
  testName: string
  suites?: Suite[]
  /** Suite IDs this test currently belongs to (for filtering Remove picker) */
  testSuiteIds?: string[]
  onRun: (testId: string) => void
  onEdit: (testId: string) => void
  onDelete: (testId: string) => void
  onDuplicate: (testId: string) => void
  onExport?: (testId: string) => void
  onAddToSuite?: (testId: string, suiteId: string) => void
  onRemoveFromSuite?: (testId: string, suiteId: string) => void
  runDisabled?: boolean
  runDisabledReason?: string
}

export function TestsRowActions({
  testId,
  testName,
  suites = [],
  testSuiteIds = [],
  onRun,
  onEdit,
  onDelete,
  onExport,
  onDuplicate,
  onAddToSuite,
  onRemoveFromSuite,
  runDisabled = false,
  runDisabledReason,
}: Readonly<TestsRowActionsProps>) {
  const confirm = useSuiteConfirmState(suites)

  // For Remove from Suite, only show suites this test belongs to
  const removableSuites = suites.filter(s => testSuiteIds.includes(s.id))

  const handleAddConfirm = () => {
    if (confirm.pendingSuiteId) {
      onAddToSuite?.(testId, confirm.pendingSuiteId)
    }
    confirm.resetPending()
  }

  const handleRemoveConfirm = () => {
    if (confirm.pendingSuiteId) {
      onRemoveFromSuite?.(testId, confirm.pendingSuiteId)
    }
    confirm.resetPending()
  }

  return (
    <div data-testid="row-actions" className="flex items-center gap-1">
      <ConditionalTooltip content={runDisabled ? runDisabledReason : undefined} disabled wide>
        <span className="inline-flex">
          <Button
            size="sm"
            data-testid="action-run"
            aria-label={`Run ${testName}`}
            onClick={() => onRun(testId)}
            disabled={runDisabled}
            className="h-8 w-8 p-0 transition-[transform,box-shadow] duration-200 hover:scale-110 hover:shadow-md"
          >
            <Icon icon={PlayIcon} size="sm" />
          </Button>
        </span>
      </ConditionalTooltip>
      <Dropdown placement="bottom-end">
        <DropdownTrigger
          data-testid="action-menu-trigger"
          aria-label={`More actions for ${testName}`}
          className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-subtle transition-[transform,background-color] duration-200 hover:scale-110"
        >
          <Icon icon={MoreHorizontal} size="sm" />
        </DropdownTrigger>
        <DropdownMenu className="min-w-[180px]">
          <DropdownItem onSelect={() => onEdit(testId)}>
            <Icon icon={EditIcon} size="sm" className="mr-2" />
            Edit
          </DropdownItem>
          <DropdownItem onSelect={() => onDuplicate(testId)}>
            <Icon icon={CopyIcon} size="sm" className="mr-2" />
            Duplicate
          </DropdownItem>
          {onExport && (
            <DropdownItem onSelect={() => onExport(testId)} data-testid="action-export">
              <Icon icon={Download} size="sm" className="mr-2" />
              Export
            </DropdownItem>
          )}
          {suites.length > 0 && onAddToSuite && (
            <SuitePickerPopover
              label="Add to Suite"
              icon={FolderPlus}
              testId="action-add-to-suite"
              suites={suites}
              onSelect={confirm.handleAddSelect}
            />
          )}
          {removableSuites.length > 0 && onRemoveFromSuite && (
            <SuitePickerPopover
              label="Remove from Suite"
              icon={FolderMinus}
              testId="action-remove-from-suite"
              suites={removableSuites}
              onSelect={confirm.handleRemoveSelect}
            />
          )}
          <DropdownDivider />
          <DropdownItem onSelect={() => onDelete(testId)} className="text-error">
            <Icon icon={TrashIcon} size="sm" className="mr-2" />
            Delete
          </DropdownItem>
        </DropdownMenu>
      </Dropdown>

      {/* Confirmation dialogs - rendered outside Dropdown so they survive menu close */}
      <ConfirmationDialog
        isOpen={confirm.addConfirmOpen}
        onClose={confirm.handleAddCancel}
        onConfirm={handleAddConfirm}
        variant="move"
        title={`Add "${testName}" to "${confirm.pendingSuiteName}"?`}
        description="This test will be added to the selected suite."
        confirmLabel="Add"
      />
      <ConfirmationDialog
        isOpen={confirm.removeConfirmOpen}
        onClose={confirm.handleRemoveCancel}
        onConfirm={handleRemoveConfirm}
        variant="move"
        title={`Remove "${testName}" from "${confirm.pendingSuiteName}"?`}
        description="This test will be removed from the selected suite."
        confirmLabel="Remove"
      />
    </div>
  )
}
