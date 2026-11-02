/**
 * OutputListSection - the author-declared export rows under the fixed output
 * rows, laid out in the Output Variables table's four columns.
 */

import { useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { TextField } from '@/components/shared/fields/text-field'
import { useStableKeys } from '@/components/shared/variable-bodies/use-stable-keys'
import type { OutputListRowState } from '@/features/workbench/lib/node-parameters/types'
import type { VariableType } from '@/lib/variable-types'
import { RowActionButton } from '../../config/move-pair'
import { VariableTypeSelector } from '../../variables/variable-type-selector'
import { ParameterTableColumns } from '../parameters/parameter-table'
import type { ComboboxVariable } from '../shared/variable-combobox-base'
import type { OutputListEditState } from '../use-output-list'
import { OutputBindingCombobox } from './output-binding-combobox'

const EMPTY_ROW: OutputListRowState = { name: '', binding: '', secret: false, type: 'string' }
const HEADING_CLASS = 'p-2 text-left text-xs font-medium text-muted-foreground'
// Every cell centers its control on one 36 px line, so a message below never shifts the row.
const LINE_CLASS = 'flex h-9 items-center'

function withoutIndex<T>(items: T[], index: number): T[] {
  return items.filter((_, i) => i !== index)
}

interface OutputListRowProps {
  index: number
  row: OutputListRowState
  nameError?: string
  showNameError: boolean
  bindingError?: string
  variables: ComboboxVariable[]
  onChange: (row: OutputListRowState) => void
  onNameBlur: () => void
  onRemove: () => void
}

function OutputListRow({
  index,
  row,
  nameError,
  showNameError,
  bindingError,
  variables,
  onChange,
  onNameBlur,
  onRemove,
}: Readonly<OutputListRowProps>) {
  const ordinal = index + 1
  const boundType = variables.find((variable) => variable.name === row.binding)?.type
  const visibleNameError = showNameError ? nameError : undefined
  const nameErrorId = `output-list-name-error-${index}`
  const bindingErrorId = `output-list-binding-error-${index}`

  const handleBindingChange = (binding: string) => {
    const existingType = variables.find((variable) => variable.name === binding)?.type
    onChange({ ...row, binding, type: (existingType as VariableType | undefined) ?? row.type })
  }

  return (
    <>
      <tr className="border-b border-border last:border-0 [&>td]:align-top">
        <td className="p-2 w-8" />
        <td className="p-2 overflow-hidden">
          <TextField
            value={row.name}
            onChange={(name) => onChange({ ...row, name })}
            onBlur={onNameBlur}
            aria-invalid={visibleNameError !== undefined}
            aria-label={`Variable export ${ordinal} name`}
            aria-describedby={visibleNameError === undefined ? undefined : nameErrorId}
            className="font-mono"
            data-testid={`output-list-name-${index}`}
          />
        </td>
        <td className="py-2 px-0">
          <div className={LINE_CLASS}>
            <VariableTypeSelector
              type={boundType ?? row.type}
              isExisting={boundType !== undefined}
              onTypeChange={(type) => onChange({ ...row, type: type as VariableType })}
              testId={`output-list-type-${index}`}
              ariaLabel={`Variable export ${ordinal} type`}
              className="w-full"
            />
          </div>
        </td>
        <td className="p-2">
          <div className={LINE_CLASS}>
            <Checkbox
              data-testid={`output-list-secret-${index}`}
              checked={row.secret}
              onCheckedChange={(checked) => onChange({ ...row, secret: checked === true })}
              aria-label={`Variable export ${ordinal} secret`}
            />
          </div>
        </td>
        <td className="p-2">
          <div className={`${LINE_CLASS} gap-2`}>
            <div className="relative flex-1 min-w-0" data-testid={`output-list-binding-${index}`}>
              <OutputBindingCombobox
                value={row.binding}
                onChange={handleBindingChange}
                parameterType=""
                availableVariables={variables}
                errorId={bindingError === undefined ? undefined : bindingErrorId}
                ariaLabel={`Variable export ${ordinal} WAVE variable`}
              />
            </div>
            <RowActionButton
              testId={`output-list-remove-${index}`}
              ariaLabel={`Remove variable export ${ordinal}`}
              onClick={onRemove}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </RowActionButton>
          </div>
          {bindingError !== undefined && (
            <div role="alert" id={bindingErrorId} className="text-xs text-destructive mt-1">
              {bindingError}
            </div>
          )}
        </td>
      </tr>
      {visibleNameError !== undefined && (
        <tr>
          <td className="w-8" />
          <td colSpan={4} className="px-2 pb-2">
            <div role="alert" id={nameErrorId} className="text-xs text-destructive">
              {visibleNameError}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

export interface OutputListSectionProps extends OutputListEditState {
  availableVariables: ComboboxVariable[]
}

export function OutputListSection({
  policy,
  rows,
  onRowsChange,
  rowErrors,
  bindingErrors,
  availableVariables,
}: Readonly<OutputListSectionProps>) {
  const tableRef = useRef<HTMLTableElement>(null)
  const addRef = useRef<HTMLButtonElement>(null)
  const rowKeys = useStableKeys(rows.length)
  // A name error shows once its field has lost focus, like the Variable Setter (VARSET-8).
  const [touched, setTouched] = useState<boolean[]>(() => rows.map(() => false))

  const focusName = (index: number) => {
    tableRef.current
      ?.querySelector<HTMLElement>(`[data-testid="output-list-name-${index}"]`)
      ?.focus()
  }

  const handleAdd = () => {
    flushSync(() => {
      setTouched((current) => [...current.slice(0, rows.length), false])
      onRowsChange([...rows, { ...EMPTY_ROW }])
    })
    focusName(rows.length)
  }

  const handleRemove = (index: number) => {
    const next = withoutIndex(rows, index)
    flushSync(() => {
      setTouched((current) => withoutIndex(current, index))
      onRowsChange(next)
    })
    if (index < next.length) focusName(index)
    else addRef.current?.focus()
  }

  const handleRowChange = (index: number, row: OutputListRowState) => {
    onRowsChange(rows.map((current, i) => (i === index ? row : current)))
  }

  const handleNameBlur = (index: number) => {
    setTouched((current) => current.map((value, i) => (i === index ? true : value)))
  }

  return (
    <div className="space-y-2">
      <table ref={tableRef} className="w-full table-fixed [&>tbody>tr]:border-0">
        <ParameterTableColumns isOutput />
        <thead>
          <tr className="border-b border-border">
            <th className="p-2 w-8" />
            <th className={`${HEADING_CLASS} w-[160px]`}>{policy.nameHeading}</th>
            <th className={`${HEADING_CLASS} w-[100px]`}>Type</th>
            <th className="p-2 w-[56px] text-center text-xs font-medium text-muted-foreground">
              Secret
            </th>
            <th className={HEADING_CLASS}>{policy.bindingHeading}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <OutputListRow
              key={rowKeys[index]}
              index={index}
              row={row}
              nameError={rowErrors[index]}
              showNameError={touched[index] === true}
              bindingError={bindingErrors[index]}
              variables={availableVariables}
              onChange={(next) => handleRowChange(index, next)}
              onNameBlur={() => handleNameBlur(index)}
              onRemove={() => handleRemove(index)}
            />
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td className="p-2 w-8" />
            <td colSpan={4} className="p-2">
              <Button
                ref={addRef}
                variant="outline"
                size="sm"
                data-testid="output-list-add"
                aria-label={policy.addLabel}
                onClick={handleAdd}
              >
                <Plus className="h-3.5 w-3.5" />
                {policy.addLabel}
              </Button>
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
