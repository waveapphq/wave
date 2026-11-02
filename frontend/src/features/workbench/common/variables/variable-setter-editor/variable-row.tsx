/**
 * Variable Setter Editor - Variable Row
 *
 * Individual row component for a single variable in the setter editor.
 * Design decisions: VARSET-3, VARSET-5, VARSET-6, VARSET-7, VARSET-8, VARSET-10
 */

import { useId, type RefCallback } from 'react'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { Command, CommandList, CommandEmpty, CommandItem } from '@/components/ui/command'
import { FieldErrorContext } from '@/components/shared/fields/field-error-context'
import { NameField } from '@/components/shared/fields/name-field'
import { ExpressionToggle } from '@/components/shared/fields/expression-toggle'
import { MAX_VARIABLE_NAME_LENGTH } from '@/lib/field-constraints'
import { isStoredSecretValue } from '@/lib/secret-envelope'
import type { AvailableVariable, RowValidation, VariableRow as VariableRowType } from './types'
import { VariableTypeSelector } from '../variable-type-selector'
import { ValueField } from './row-fields'
import { ConditionalTooltip } from '@/components/ui/tooltip'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VariableRowProps {
  row: VariableRowType
  index: number
  totalRows: number
  validation: RowValidation | undefined
  isTouched: boolean
  isExisting: boolean
  isAutocompleteOpen: boolean
  availableVariables: AvailableVariable[]
  filteredSuggestions: AvailableVariable[]
  nameInputRef: RefCallback<HTMLTextAreaElement>
  onNameChange: (index: number, name: string) => void
  onNameBlur: (index: number) => void
  onTypeChange: (index: number, type: string) => void
  onValueChange: (index: number, value: unknown) => void
  onExpressionToggle: (index: number) => void
  onSecretToggle: (index: number) => void
  onDelete: (index: number) => void
  onOpenAutocomplete: (index: number | null) => void
  onEditValue: (rowIndex: number) => void
  onEditSecret: (rowIndex: number) => void
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function VariableRowComponent({
  row,
  index,
  totalRows,
  validation,
  isTouched,
  isExisting,
  isAutocompleteOpen,
  availableVariables,
  filteredSuggestions,
  nameInputRef,
  onNameChange,
  onNameBlur,
  onTypeChange,
  onValueChange,
  onExpressionToggle,
  onSecretToggle,
  onDelete,
  onOpenAutocomplete,
  onEditValue,
  onEditSecret,
}: Readonly<VariableRowProps>) {
  const isExpr = row.isExpression
  const isSecret = row.isSecret === true
  const errorId = useId()
  const showError = isTouched && validation?.error
  const errorField = showError ? validation.field : null

  return (
    <div key={row.key} className="space-y-1">
      <div className="flex items-start gap-2">
        {/* Name field with autocomplete - VARSET-3 */}
        <div className="relative flex-1 min-w-[120px]">
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
                aria-invalid={errorField === 'name'}
                aria-describedby={errorField === 'name' ? errorId : undefined}
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
        </div>

        {/* Type selector - VARSET-5 */}
        <VariableTypeSelector
          type={row.type}
          isExisting={isExisting}
          onTypeChange={(type) => onTypeChange(index, type)}
          testId={`varset-type-select-${index}`}
          ariaLabel="Type"
        />

        {/* Secret checkbox - SECUI-2; disabled for boolean (never secret) */}
        <div className="flex h-8 w-8 shrink-0 items-center justify-center">
          <Checkbox
            data-testid={`varset-secret-checkbox-${index}`}
            checked={isSecret}
            disabled={row.type === 'boolean'}
            onCheckedChange={() => onSecretToggle(index)}
            aria-label="Secret"
          />
        </div>

        {/* Value field - varies by type and expression mode - VARSET-6, VARSET-7 */}
        <FieldErrorContext value={errorField === 'value' ? errorId : undefined}>
          <ValueField
            row={row}
            index={index}
            isExpr={isExpr}
            secret={isSecret && isStoredSecretValue(row.value)}
            availableVariables={availableVariables}
            onValueChange={onValueChange}
            onEditValue={onEditValue}
            onEditSecret={onEditSecret}
          />
        </FieldErrorContext>

        {/* Expression toggle - VARSET-6 */}
        <ExpressionToggle
          pressed={isExpr}
          onPressedChange={() => onExpressionToggle(index)}
          data-testid={`varset-expression-toggle-${index}`}
          label="Toggle expression mode"
        />

        {/* Delete button - disabled on sole empty row (VARSET-10 empty state) */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onDelete(index)}
          disabled={totalRows === 1 && !row.name && row.value === ''}
          data-testid={`varset-delete-${index}`}
          className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
          aria-label="Delete variable"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Validation messages - VARSET-8 */}
      {showError && (
        <p id={errorId} className="text-xs text-destructive pl-1" role="alert">
          {validation.error}
        </p>
      )}
    </div>
  )
}
