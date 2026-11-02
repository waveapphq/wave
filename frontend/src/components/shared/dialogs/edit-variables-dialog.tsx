import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { EditDialog } from '@/components/ui/edit-dialog'
import { VariableEditor } from '@/components/shared/variable-editor/variable-editor'
import { hasVariableErrors } from '@/lib/variable-validation'
import { useChildEditorScope } from '@/components/shared/child-editors/child-editor-scope'
import { formErrorsNote } from '@/lib/child-editors'

const VARIABLES_NOTE = formErrorsNote('variables')
import type { VariableRow } from '@/lib/variable-types'

export function EditVariablesDialog({
  open,
  onOpenChange,
  title,
  description,
  isDirty,
  onSave,
  onDiscard,
  formatError,
  editVariables,
  onChange,
  selectedIds,
  onSelectionChange,
  onBulkDuplicate,
  onBulkDelete,
  renderValueCell,
}: Readonly<{
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  isDirty: boolean
  onSave: () => Promise<void>
  onDiscard: () => void
  formatError: (err: unknown) => ReactNode
  editVariables: VariableRow[]
  onChange: (rows: VariableRow[]) => void
  selectedIds: Set<string>
  onSelectionChange: (ids: Set<string>) => void
  onBulkDuplicate: () => void
  onBulkDelete: () => void
  /** Injected shared value cell for the Value column (entity-scope edge adapter). */
  renderValueCell: (row: VariableRow) => ReactNode
}>): ReactNode {
  const childEditors = useChildEditorScope()
  return (
    /* v8 ignore next 14 - COV-V8-003: V8 tracks JSX prop expressions as branches */
    <EditDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      isDirty={isDirty}
      onSave={onSave}
      onDiscard={onDiscard}
      saveDisabled={hasVariableErrors(editVariables)}
      invalidNote={VARIABLES_NOTE}
      childEditors={childEditors}
      className="sm:max-w-3xl"
      formatError={formatError}
      allowFloatingSheet
      data-testid="edit-variables-dialog"
    >
      <VariableEditor
        rows={editVariables}
        onChange={onChange}
        enableSelection
        selectedIds={selectedIds}
        onSelectionChange={onSelectionChange}
        renderValueCell={renderValueCell}
        bulkActions={
          <>
            <Button variant="outline" size="sm" onClick={onBulkDuplicate}>
              Duplicate
            </Button>
            <Button variant="destructive" size="sm" onClick={onBulkDelete}>
              Delete
            </Button>
          </>
        }
      />
    </EditDialog>
  )
}
