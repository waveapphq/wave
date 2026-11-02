/**
 * VariableEditor
 *
 * Shared editable variable table used inside EditDialog by both
 * System Variables (settings) and Suite Variables (suite detail).
 */

import { useCallback, useState, type ReactNode } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import {
  RowRemovalQuestion,
  useRowRemovalGuard,
} from '@/components/shared/child-editors/row-removal-guard'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { NameField } from '@/components/shared/fields/name-field'
import { MAX_VARIABLE_NAME_LENGTH } from '@/lib/field-constraints'
import { holdsSecretValue } from '@/lib/secret-envelope'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
/* v8 ignore next - COV-V8-003: V8 tracks import closing brace */
} from '@/components/ui/select'
import { randomUUID } from '@/lib/uuid'
import { DataTableToolbar } from '@/components/shared/data-table/data-table-toolbar'
import { getDefaultValueForType } from '@/lib/variable-defaults'
import {
  VARIABLE_TYPES,
  TYPE_LABELS,
  toEntityStoredValue,
  type VariableRow,
  type VariableType,
} from '@/lib/variable-types'

export interface VariableEditorProps {
  rows: VariableRow[]
  onChange: (rows: VariableRow[]) => void
  enableSelection?: boolean
  selectedIds?: Set<string>
  onSelectionChange?: (ids: Set<string>) => void
  bulkActions?: ReactNode
  /** Value column cell; the consumer adapts the row's stored JSON-string value at the edge. */
  renderValueCell: (row: VariableRow) => ReactNode
}

/** A row's value right after its type changes: the type default in the row's stored form. */
function storedTypeDefault(type: VariableType): string {
  return toEntityStoredValue(type, getDefaultValueForType(type)) as string
}

export function VariableEditor({
  rows,
  onChange,
  enableSelection = false,
  selectedIds,
  onSelectionChange,
  bulkActions,
  renderValueCell,
}: Readonly<VariableEditorProps>): ReactNode {
  const selectedCount = selectedIds?.size ?? 0

  // The secret row awaiting the un-secure confirm-and-clear: un-securing a
  // stored secret drops its sealed value, so the removal is confirmed first.
  const [unsecureRow, setUnsecureRow] = useState<VariableRow | null>(null)

  const handleAdd = useCallback(() => {
    const existingNames = new Set(rows.map((r) => r.name))
    let suffix = 1
    let newName = `new_var_${suffix}`
    while (existingNames.has(newName)) {
      suffix++
      newName = `new_var_${suffix}`
    }
    onChange([
      ...rows,
      {
        id: randomUUID(),
        name: newName,
        type: 'string',
        secret: false,
        value: '',
      },
    ])
  }, [rows, onChange])

  const rowGuard = useRowRemovalGuard()

  const handleDelete = useCallback(
    (id: string) => {
      onChange(rows.filter((r) => r.id !== id))
      /* v8 ignore start - COV-V8-003: selection cleanup on delete */
      if (selectedIds?.has(id) && onSelectionChange) {
        const next = new Set(selectedIds)
        next.delete(id)
        onSelectionChange(next)
      }
      /* v8 ignore stop */
    },
    [rows, onChange, selectedIds, onSelectionChange],
  )

  const handleUpdate = useCallback(
    (id: string, field: keyof VariableRow, value: string | boolean) => {
      onChange(
        rows.map((r): VariableRow => {
          if (r.id !== id) return r
          /* v8 ignore next 3 - COV-V8-003: Radix Select onValueChange untestable in JSDOM */
          if (field === 'type' && value !== r.type) {
            return { ...r, type: value as VariableType, value: storedTypeDefault(value as VariableType), elementTypes: undefined }
          }
          return { ...r, [field]: value } as VariableRow
        }),
      )
    },
    [rows, onChange],
  )

  // Securing is immediate; un-securing a stored secret prompts confirm-and-clear.
  const handleSecretChange = useCallback(
    (row: VariableRow, checked: boolean) => {
      if (checked) {
        handleUpdate(row.id, 'secret', true)
        return
      }
      if (holdsSecretValue(row.value)) {
        setUnsecureRow(row)
      } else {
        handleUpdate(row.id, 'secret', false)
      }
    },
    [handleUpdate],
  )

  const handleToggleSelect = useCallback(
    (id: string) => {
      /* v8 ignore next - COV-V8-003: guard clause for optional selection */
      if (!onSelectionChange || !selectedIds) return
      const next = new Set(selectedIds)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      onSelectionChange(next)
    },
    [selectedIds, onSelectionChange],
  )

  const handleSelectAll = useCallback(() => {
    /* v8 ignore next - COV-V8-003: guard clause for optional selection */
    if (!onSelectionChange) return
    const allSelected = rows.length > 0 && selectedIds?.size === rows.length
    if (allSelected) {
      onSelectionChange(new Set())
    } else {
      onSelectionChange(new Set(rows.map((r) => r.id)))
    }
  }, [rows, selectedIds, onSelectionChange])

  const colCount = enableSelection ? 6 : 5

  return (
    <div data-testid="variable-editor" className="space-y-2">
      <RowRemovalQuestion guard={rowGuard} />
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Variables
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-testid="add-variable-btn"
          onClick={handleAdd}
          className="h-7 text-xs"
        >
          <Plus className="mr-1 h-3.5 w-3.5" /> Add
        </Button>
      </div>

      {/* Bulk actions toolbar */}
      {enableSelection && bulkActions && selectedCount > 0 && (
        <DataTableToolbar selectedCount={selectedCount}>
          {bulkActions}
        </DataTableToolbar>
      )}

      {/* Table - table-fixed (like the profile parameter table) so a long value
          truncates inside its bounded column instead of stretching the column and
          squashing Name. scrollbar-gutter reserves the vertical scrollbar's width
          so it never pushes the w-full table into a stray horizontal scroll. */}
      <div className="rounded-md border overflow-y-auto max-h-[calc(85vh-18rem)] [scrollbar-gutter:stable]">
        <table className="w-full table-fixed text-sm">
          <thead className="sticky top-0 z-10">
            <tr className="border-b bg-card">
              {enableSelection && (
                <th className="py-2 pl-3 w-8">
                  <Checkbox
                    checked={rows.length > 0 && selectedIds?.size === rows.length}
                    onCheckedChange={handleSelectAll}
                    aria-label="Select all"
                  />
                </th>
              )}
              <th className="py-2 pl-3 text-left text-xs font-medium text-muted-foreground w-44">
                Name
              </th>
              <th className="py-2 px-2 text-left text-xs font-medium text-muted-foreground w-28">
                Type
              </th>
              <th className="py-2 px-2 text-center text-xs font-medium text-muted-foreground w-16">
                Secret
              </th>
              <th className="py-2 px-2 text-left text-xs font-medium text-muted-foreground">
                Value
              </th>
              <th className="py-2 px-2 w-10" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={colCount}
                  className="py-8 text-center text-sm text-muted-foreground"
                >
                  No variables yet. Click + Add to create one.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.id}
                  data-testid="variable-editor-row"
                  className="border-b last:border-b-0"
                >
                  {/* Selection checkbox */}
                  {enableSelection && (
                    <td className="py-1.5 pl-3">
                      <Checkbox
                        /* v8 ignore next - COV-V8-003: V8 tracks ?. and ?? */
                        checked={selectedIds?.has(row.id) ?? false}
                        /* v8 ignore next - COV-V8-003 */
                        onCheckedChange={() => handleToggleSelect(row.id)}
                        /* v8 ignore next - COV-V8-003: V8 tracks || */
                        aria-label={`Select ${row.name || 'variable'}`}
                      />
                    </td>
                  )}

                  {/* Name */}
                  <td className="py-1.5 pl-3 min-w-0">
                    <NameField
                      data-testid="variable-name-input"
                      value={row.name}
                      /* v8 ignore next 3 - COV-V8-003 */
                      onChange={(value) =>
                        handleUpdate(row.id, 'name', value)
                      }
                      placeholder="variable_name"
                      className="h-8 font-mono text-xs"
                      maxLength={MAX_VARIABLE_NAME_LENGTH}
                      aria-label="Name"
                    />
                  </td>

                  {/* Type */}
                  <td className="py-1.5 px-2">
                    <Select
                      value={row.type}
                      /* v8 ignore next 3 - COV-V8-003 */
                      onValueChange={(val) =>
                        handleUpdate(row.id, 'type', val)
                      }
                    >
                      <SelectTrigger
                        data-testid="variable-type-select"
                        aria-label="Type"
                        className="h-8 text-xs"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {VARIABLE_TYPES.map((t) => (
                          <SelectItem key={t} value={t}>
                            {TYPE_LABELS[t]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>

                  {/* Secret */}
                  <td className="py-1.5 px-2 text-center">
                    <Checkbox
                      data-testid={`variable-secret-${row.id}`}
                      checked={row.secret}
                      disabled={row.type === 'boolean'}
                      onCheckedChange={(checked) =>
                        handleSecretChange(row, checked === true)
                      }
                      aria-label="Secret"
                    />
                  </td>

                  {/* Value */}
                  <td className="py-1.5 px-2">
                    <div className="flex min-w-0">{renderValueCell(row)}</div>
                  </td>

                  {/* Delete */}
                  <td className="py-1.5 px-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      data-testid="variable-delete-btn"
                      aria-label={`Delete variable ${row.name}`.trim()}
                      /* v8 ignore next - COV-V8-003 */
                      onClick={() =>
                        rowGuard.request([row.name], () => handleDelete(row.id))
                      }
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Un-secure confirm-and-clear: dropping secret protection deletes the value */}
      {unsecureRow && (
        <ConfirmationDialog
          isOpen
          onClose={() => setUnsecureRow(null)}
          onConfirm={() => {
            onChange(
              rows.map((r): VariableRow =>
                r.id === unsecureRow.id ? { ...r, secret: false, value: '' } : r,
              ),
            )
            setUnsecureRow(null)
          }}
          variant="delete"
          title="Remove Secret Protection?"
          description="Removing secret protection will permanently delete the stored value. This action cannot be undone."
          confirmLabel="Remove & Delete Value"
        />
      )}
    </div>
  )
}
