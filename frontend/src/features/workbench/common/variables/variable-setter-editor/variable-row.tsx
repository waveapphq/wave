/**
 * Variable Setter Editor - Variable Row
 *
 * One target variable: its name, type, Secret and the one value field (FIELD-1).
 * Design decisions: VARSET-3, VARSET-5, VARSET-6, VARSET-7, VARSET-8, VARSET-10
 */

import { useCallback, useId, type RefCallback } from 'react'
import { Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { Command, CommandList, CommandEmpty, CommandItem } from '@/components/ui/command'
import { ConditionalTooltip } from '@/components/ui/tooltip'
import { NameField } from '@/components/shared/fields/name-field'
import { counterState, MAX_VARIABLE_NAME_LENGTH } from '@/lib/field-constraints'
import { setterRowModes } from '@/features/workbench/lib/node-parameters/field-modes'
import { FieldCellView, useFieldCell } from '@/features/workbench/common/element-config/parameters/field-cell'
import type { Parameter } from '@/features/workbench/common/element-config/parameters/parameter-table-types'
import type { SecretSaveTarget } from '@/features/workbench/common/variables/variable-inspect-modal/secret-visibility-notice'
import type { AvailableVariable, VariableRow as VariableRowType } from './types'
import { VariableTypeSelector } from '../variable-type-selector'

export interface VariableRowProps {
  row: VariableRowType
  index: number
  totalRows: number
  /** The name's message, shown from the moment the window opens. */
  nameProblem: string | null
  /** The value's message the field cannot see itself (a blank {x}, a dropped literal, a blank {x} entry). */
  valueMessage: string | null
  isExisting: boolean
  isAutocompleteOpen: boolean
  availableVariables: AvailableVariable[]
  filteredSuggestions: AvailableVariable[]
  nameInputRef: RefCallback<HTMLTextAreaElement>
  /** Whose save seals a typed secret: the Test, or the Function a library Function view shows. */
  secretSaveTarget?: SecretSaveTarget
  onNameChange: (index: number, name: string) => void
  onNameBlur: (index: number) => void
  onTypeChange: (index: number, type: string) => void
  onSecretToggle: (index: number) => void
  onRowValue: (index: number, value: unknown) => void
  onRowModes: (index: number, patch: Partial<VariableRowType>) => void
  onCellValidation: (rowKey: string, error: string | null) => void
  onDelete: (index: number) => void
  onOpenAutocomplete: (index: number | null) => void
}

// The word the row's Delete button names it by; its value field is heard by it while the row has no name.
const ROW_WORD = 'variable'

/** The row value as a Block field: it takes null and has no default (REQ-3.1.3.21). */
function valueParameter(row: VariableRowType, index: number): Parameter {
  return {
    name: `varset-value-${index}`,
    label: row.name,
    // A Template is text, kept as written on a variable retyped since (FNCFG-9).
    type: (row.isTemplate === true ? 'string' : row.type) as Parameter['type'],
    required: false,
    acceptsNull: true,
    secret: row.isSecret === true && row.type !== 'boolean',
    // List and map entries keep their declared types (REQ-3.1.3.19).
    typedValues: row.type === 'array' || row.type === 'map',
  }
}

// A row grows 20 px of padding per line under one of its boxes, so the list's 8 px spacing stays below them (VARSET-8).
const ROW_GROWTH_CLASSES = ['', 'pb-5', 'pb-10'] as const

function holdsNothing(value: unknown): boolean {
  return value === null || value === undefined || value === ''
}

export function VariableRowComponent({
  row,
  index,
  totalRows,
  nameProblem,
  valueMessage,
  isExisting,
  isAutocompleteOpen,
  availableVariables,
  filteredSuggestions,
  nameInputRef,
  secretSaveTarget,
  onNameChange,
  onNameBlur,
  onTypeChange,
  onSecretToggle,
  onRowValue,
  onRowModes,
  onCellValidation,
  onDelete,
  onOpenAutocomplete,
}: Readonly<VariableRowProps>) {
  const nameErrorId = useId()
  const reportCell = useCallback(
    (_name: string, error: string | null) => onCellValidation(row.key, error),
    [onCellValidation, row.key],
  )
  const cell = useFieldCell({
    mode: 'input',
    parameter: valueParameter(row, index),
    value: row.value,
    onChange: (value) => onRowValue(index, value),
    modes: setterRowModes(row, (patch) => onRowModes(index, patch)),
    availableVariables,
    fieldError: valueMessage ?? undefined,
    onValidationChange: reportCell,
    toggleTestId: `varset-expression-toggle-${index}`,
    secretSaveTarget,
    accessibleName: row.name.trim() === '' ? ROW_WORD : undefined,
  })
  const hasNameProblem = nameProblem !== null
  const linesUnderName =
    Number(counterState(row.name.length, MAX_VARIABLE_NAME_LENGTH) !== 'hidden') + Number(hasNameProblem)
  const linesUnderRow = Math.max(linesUnderName, Number(cell.hasMessage))

  return (
    <div className={cn('flex items-center gap-2', ROW_GROWTH_CLASSES[linesUnderRow])}>
      {/* Name field with autocomplete - VARSET-3; the column keeps the box's height, its counter and message sit below it */}
      <div className="h-9 w-[189px] shrink-0">
        <Popover
          open={isAutocompleteOpen}
          /* v8 ignore next - COV-RADIX-012 */
          onOpenChange={(open) => { if (open) onOpenAutocomplete(index) }}
        >
          <PopoverAnchor asChild>
            <NameField
              ref={nameInputRef}
              data-testid={`varset-name-input-${index}`}
              value={row.name}
              onChange={(value) => onNameChange(index, value)}
              onFocus={() => onOpenAutocomplete(index)}
              onBlur={() => onNameBlur(index)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') onOpenAutocomplete(null)
                if (e.key === ' ' && e.ctrlKey) {
                  e.preventDefault()
                  onOpenAutocomplete(index)
                }
              }}
              placeholder="Variable name"
              maxLength={MAX_VARIABLE_NAME_LENGTH}
              aria-label="Name"
              aria-invalid={hasNameProblem}
              aria-describedby={hasNameProblem ? nameErrorId : undefined}
            />
          </PopoverAnchor>
          {filteredSuggestions.length > 0 && (
            <PopoverContent
              className="p-0"
              style={{
                width: 'var(--radix-popover-trigger-width)',
                minWidth: '320px',
              }}
              align="start"
              onOpenAutoFocus={(e) => e.preventDefault()}
            >
              <Command>
                <CommandList>
                  <CommandEmpty>No matching variables</CommandEmpty>
                  {filteredSuggestions.map((v) => (
                    <CommandItem
                      key={v.name}
                      value={v.name}
                      onSelect={() => {
                        onNameChange(index, v.name)
                        onOpenAutocomplete(null)
                      }}
                      className="flex items-center gap-2"
                    >
                      <ConditionalTooltip content={v.name} wide>
                        <span className="flex-1 min-w-0 truncate">{v.name}</span>
                      </ConditionalTooltip>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {v.type}
                      </span>
                    </CommandItem>
                  ))}
                </CommandList>
              </Command>
            </PopoverContent>
          )}
        </Popover>
        {hasNameProblem && (
          <p
            id={nameErrorId}
            role="alert"
            data-testid={`varset-name-error-${index}`}
            className="mt-1 truncate text-xs text-destructive"
          >
            {nameProblem}
          </p>
        )}
      </div>

      {/* Type selector - VARSET-5 */}
      <VariableTypeSelector
        type={row.type}
        isExisting={isExisting}
        onTypeChange={(type) => onTypeChange(index, type)}
        testId={`varset-type-select-${index}`}
        ariaLabel="Type"
        className="w-[100px] shrink-0"
      />

      {/* Secret checkbox - SECUI-2; disabled for boolean (never secret) */}
      <div className="flex h-8 w-8 shrink-0 items-center justify-center">
        <Checkbox
          data-testid={`varset-secret-checkbox-${index}`}
          checked={row.isSecret === true}
          disabled={row.type === 'boolean'}
          onCheckedChange={() => onSecretToggle(index)}
          aria-label="Secret"
        />
      </div>

      {/* The one value field with its expand and {x} - VARSET-6, VARSET-7 */}
      <div className="min-w-0 flex-1">
        <FieldCellView state={cell} />
      </div>

      {/* Delete button - disabled on sole empty row (VARSET-10 empty state) */}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onDelete(index)}
        disabled={totalRows === 1 && !row.name && holdsNothing(row.value)}
        data-testid={`varset-delete-${index}`}
        className="h-8 w-8 shrink-0 p-0 text-muted-foreground hover:text-destructive"
        aria-label={`Delete ${ROW_WORD}`}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}
