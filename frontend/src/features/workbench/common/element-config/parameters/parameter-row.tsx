/**
 * ParameterRow - Single parameter row within the ParameterTable.
 *
 * The table row around the one field: info, name with its required mark, type, the output Secret,
 * and the value cell (the field cell, its {x} and Template held in the Block lists).
 * - CANVAS-128-131: INPUT/OUTPUT sections structure
 */

import { Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import { blockFieldModes } from '@/features/workbench/lib/node-parameters/field-modes'
import { RequiredMark } from '@/components/shared/fields/required-mark'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ConditionalTooltip } from '@/components/ui/tooltip'
import type { SecretSaveTarget } from '@/features/workbench/common/variables/variable-inspect-modal/secret-visibility-notice'
import type { ElementTypes } from '@/lib/variable-validation'
import type { AvailableVariable } from '../expressions/expression-field'
import type { MapParamExtras, Parameter } from './parameter-table-types'
import type { ScriptEditorProps } from './parameter-value-inputs'
import { FieldCellView, useFieldCell } from './field-cell'

/** The Type cell: a picker where the parameter's type is selectable, else the type as text. */
function TypeCell({
  parameter,
  label,
  selectedType,
  onTypeChange,
  className,
}: Readonly<{
  parameter: Parameter
  /** The row's visible name, which names the type picker. */
  label: string
  selectedType: string | undefined
  onTypeChange?: (type: string) => void
  className: string
}>) {
  return (
    <td className={className}>
      {parameter.selectableType && onTypeChange ? (
        <Select value={selectedType} onValueChange={onTypeChange}>
          <SelectTrigger
            data-testid={`type-select-${parameter.name}`}
            aria-label={`${label} type`}
            className="h-auto border-0 bg-transparent shadow-none px-0 py-0 text-xs text-muted-foreground capitalize gap-0.5 w-fit focus:ring-0 focus-visible:ring-1 focus-visible:ring-ring"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {parameter.selectableType.options.map((opt) => (
              <SelectItem key={opt} value={opt} className="text-xs capitalize">
                {opt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <span className="text-xs text-muted-foreground capitalize truncate block">
          {parameter.type}
        </span>
      )}
    </td>
  )
}

export function ParameterRow({
  mode,
  parameter,
  value,
  onChange,
  onTypeChange,
  availableVariables,
  onValidationChange,
  fieldError,
  expressionFields,
  onExpressionFieldsChange,
  templateFields,
  onTemplateFieldsChange,
  secret = false,
  onSecretChange,
  allValues,
  allParameters,
  credentialCatalogKeys,
  mapExtras,
  runsOnRemoteHost = false,
  readOnly = false,
  testId = null,
  scriptEditor,
  elementTypes,
  onElementTypesChange,
  secretSaveTarget = 'test',
}: Readonly<{
  mode: 'input' | 'output'
  parameter: Parameter
  value: unknown
  onChange: (value: unknown) => void
  onTypeChange?: (type: string) => void
  availableVariables: AvailableVariable[]
  onValidationChange?: (name: string, error: string | null) => void
  fieldError?: string
  expressionFields: string[]
  onExpressionFieldsChange: (fields: string[]) => void
  templateFields: string[]
  onTemplateFieldsChange: (fields: string[]) => void
  /** Output mode only: the bound variable is secret (SECUI-3/4). */
  secret?: boolean
  onSecretChange?: (secret: boolean) => void
  allValues?: Record<string, unknown>
  allParameters?: Parameter[]
  /** Plugin credential-key catalog for map-entry advisories (lowercase keys). */
  credentialCatalogKeys?: string[]
  /** Generated-row + advisory extras for this map param. */
  mapExtras?: MapParamExtras
  /** The block runs on the execution host: no Browse. */
  runsOnRemoteHost?: boolean
  /** Read-only canvas: no Browse. */
  readOnly?: boolean
  /** The open test, for the file-reference picker; null while the test is unsaved. */
  testId?: string | null
  /** Python and SQL blocks only: what their script body carries into the editor sheet. */
  scriptEditor?: ScriptEditorProps
  /** A typed map setting's element types and their change sink (REQ-3.1.3.19). */
  elementTypes?: ElementTypes
  onElementTypesChange?: (types: ElementTypes | undefined) => void
  /** What saving seals a credential typed here: the Test, or the Function a View shows. */
  secretSaveTarget?: SecretSaveTarget
}>) {
  const cell = useFieldCell({
    mode,
    parameter,
    value,
    onChange,
    modes: blockFieldModes(parameter.name, {
      expressionFields,
      onExpressionFieldsChange,
      templateFields,
      onTemplateFieldsChange,
      elementTypes,
      onElementTypesChange,
    }),
    availableVariables,
    fieldError,
    onValidationChange,
    allValues,
    allParameters,
    allExpressionFields: expressionFields,
    credentialCatalogKeys,
    mapExtras,
    runsOnRemoteHost,
    readOnly,
    testId,
    scriptEditor,
    secretSaveTarget,
  })
  const { cellPadding, displayLabel } = cell
  const testIdPrefix = mode === 'output' ? 'output-row' : 'param-row'

  return (
    <tr
      data-testid={`${testIdPrefix}-${parameter.name}`}
      className={cn(
        'border-b border-border last:border-0',
        cell.remoteLock && 'cursor-not-allowed opacity-50',
      )}
    >
      {/* Info column - both modes: the (i) shows the param Description */}
      <td className={cn(cellPadding, 'w-8')}>
        {parameter.description && (
          <ConditionalTooltip content={parameter.description} side="right" wide>
            <span className="relative inline-flex">
              <Info className="h-4 w-4 text-muted-foreground cursor-help" />
            </span>
          </ConditionalTooltip>
        )}
      </td>

      {/* Parameter name: the whole name, wrapped (REQ-3.1.1.5) */}
      <td className={cellPadding}>
        <span className="block break-words text-sm">
          {displayLabel}
          {cell.isRequired && mode === 'input' && <RequiredMark />}
        </span>
      </td>

      <TypeCell
        parameter={parameter}
        label={displayLabel}
        selectedType={cell.selectedType}
        onTypeChange={onTypeChange}
        className={cn(cellPadding, 'overflow-hidden')}
      />

      {/* Secret - output mode only: marks the bound variable secret (SECUI-3/4). */}
      {mode === 'output' && (
        <td className={cn(cellPadding, 'text-center')}>
          <Checkbox
            data-testid={`output-secret-${parameter.name}`}
            checked={secret}
            onCheckedChange={(checked) => onSecretChange?.(checked === true)}
            aria-label={`${displayLabel} secret`}
          />
        </td>
      )}

      {/* Value / Assign to: the value field, its expand column, Browse, the {x} column (FIELD-1) */}
      <td className={cellPadding}>
        <FieldCellView state={cell} />
      </td>
    </tr>
  )
}
