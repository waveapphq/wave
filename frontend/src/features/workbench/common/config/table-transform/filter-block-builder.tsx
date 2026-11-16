/**
 * FilterBlockBuilder - a controlled editor for per-column table filter blocks.
 */

import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { EntryChangeQuestions, useEntryChange } from '@/components/shared/variable-bodies/entry-change-questions'
import type { AvailableVariable } from '@/features/workbench/lib/codemirror/type-inference'
import { compareValueFits, conditionRowProblem } from '@/features/workbench/lib/validation/condition-checks'
import {
  newLiteralRow,
  nextId,
  withValueType,
  withoutCompareValue,
  type AssertionItem,
  type LiteralAssertion,
} from '@/features/workbench/common/config/assertion-builder/types'
import {
  appendWithOperator,
  removeAtPath,
} from '@/features/workbench/common/config/assertion-builder/tree-helpers'
import {
  ConditionExpressionRow,
  ConditionLiteralRow,
} from '@/features/workbench/common/config/assertion-builder/condition-row'
import { ColumnRefControl } from './column-ref-control'
import type { ColumnRef, ColumnRefContext, TableColumnType, TableFilterBlock } from './types'

const AS_TYPES: Array<{ value: TableColumnType; label: string }> = [
  { value: 'string', label: 'String' },
  { value: 'integer', label: 'Integer' },
  { value: 'float', label: 'Float' },
  { value: 'boolean', label: 'Boolean' },
]

const NO_VARIABLES: AvailableVariable[] = []

function replaceAt<T>(items: T[], index: number, next: T): T[] {
  const copy = [...items]
  copy[index] = next
  return copy
}

/** A filter row compares the table cell, so it starts bound to `_cell` (CSV-12). */
function newLiteral(asType: TableColumnType): LiteralAssertion {
  return { ...newLiteralRow(asType), variable: '_cell' }
}

/** A filter's as Type is the type every literal row compares the cell as (CSV-12); `lost` counts the values that go. */
function retypeLiterals(conditions: AssertionItem[], asType: TableColumnType): { conditions: AssertionItem[]; lost: number } {
  let lost = 0
  const retyped = conditions.map((item) => {
    if (item.type !== 'literal') return item
    const next = withValueType(item, asType)
    if (compareValueFits(item, next)) return next
    lost++
    return withoutCompareValue(next)
  })
  return { conditions: retyped, lost }
}

function ConditionDeleteButton({
  testId,
  label,
  onDelete,
}: Readonly<{ testId: string; label: string; onDelete: () => void }>) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive shrink-0"
      data-testid={testId}
      aria-label={label}
      onClick={onDelete}
    >
      <Trash2 className="h-3.5 w-3.5" />
    </Button>
  )
}

export interface FilterBlockBuilderProps {
  filters: TableFilterBlock[]
  columnRefProps: ColumnRefContext
  /** Workflow variables offered (with `_cell`) in filter expression fields. */
  availableVariables?: AvailableVariable[]
  onChange: (filters: TableFilterBlock[]) => void
}

export function FilterBlockBuilder({
  filters,
  columnRefProps,
  availableVariables = NO_VARIABLES,
  onChange,
}: Readonly<FilterBlockBuilderProps>) {
  const change = useEntryChange()
  const updateBlock = (index: number, next: TableFilterBlock) =>
    onChange(replaceAt(filters, index, next))

  const addBlock = () =>
    onChange([
      ...filters,
      { id: nextId('csv-filter'), column: { mode: 'name', value: '' }, asType: 'string', conditions: [] },
    ])

  // An as Type change that would lose a compare value asks the shared value-loss question once for the block (FIELD-13).
  const changeAsType = (blockIndex: number, block: TableFilterBlock, asType: TableColumnType) => {
    const { conditions, lost } = retypeLiterals(block.conditions, asType)
    const apply = () => updateBlock(blockIndex, { ...block, asType, conditions })
    if (lost === 0) apply()
    else change.askType(block.asType, asType, lost, apply)
  }

  return (
    <div className="space-y-3">
      {filters.map((block, blockIndex) => {
        const setConditions = (conditions: AssertionItem[]) =>
          updateBlock(blockIndex, { ...block, conditions })
        const cellVariables = [...availableVariables, { name: '_cell', type: block.asType }]

        return (
          <div key={block.id} className="space-y-1">
            {blockIndex > 0 && (
              <div className="flex justify-center">
                <Badge variant="info" className="text-[10px]">
                  AND
                </Badge>
              </div>
            )}
            <div
              data-testid={`filter-block-${block.id}`}
              className="rounded-md border border-border p-3 space-y-2"
            >
            <div className="flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <ColumnRefControl
                  mode={block.column.mode}
                  value={block.column.value}
                  hasHeader={columnRefProps.hasHeader}
                  schemaColumns={columnRefProps.schemaColumns}
                  onChange={(ref: ColumnRef) => updateBlock(blockIndex, { ...block, column: ref })}
                />
              </div>
              <span className="text-xs text-muted-foreground shrink-0">as</span>
              <Select
                value={block.asType}
                onValueChange={(value) => changeAsType(blockIndex, block, value as TableColumnType)}
              >
                <SelectTrigger
                  data-testid={`filter-astype-${block.id}`}
                  className="h-8 w-[120px] shrink-0"
                  aria-label="Filter column type"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AS_TYPES.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <ConditionDeleteButton
                testId={`filter-delete-block-${block.id}`}
                label="Delete filter block"
                onDelete={() => onChange(filters.filter((other) => other.id !== block.id))}
              />
            </div>

            <div className="space-y-2 pl-2">
              {block.conditions.map((cond, condIndex) => {
                if (cond.type === 'operator') {
                  // Key by the preceding condition's stable id (operators are never first).
                  const prevId = (block.conditions[condIndex - 1] as { id?: string }).id
                  return (
                    <Badge key={`op-${prevId}`} variant="info" className="text-[10px]">
                      {cond.value.toUpperCase()}
                    </Badge>
                  )
                }
                if (cond.type === 'group') return null
                const problem = conditionRowProblem(cond)
                const deleteButton = (
                  <ConditionDeleteButton
                    testId={`filter-condition-delete-${cond.id}`}
                    label="Delete filter condition"
                    onDelete={() => setConditions(removeAtPath(block.conditions, [condIndex]))}
                  />
                )
                const onRow = (next: AssertionItem) => setConditions(replaceAt(block.conditions, condIndex, next))
                if (cond.type === 'expression') {
                  return (
                    <ConditionExpressionRow
                      key={cond.id}
                      row={cond}
                      onRow={onRow}
                      availableVariables={cellVariables}
                      testIdStem={`filter-condition-expr-${cond.id}`}
                      message={problem?.message}
                      grows={problem !== null}
                      actions={deleteButton}
                    />
                  )
                }
                return (
                  <ConditionLiteralRow
                    key={cond.id}
                    row={cond}
                    onRow={onRow}
                    availableVariables={cellVariables}
                    testIdStem={`filter-condition-value-${cond.id}`}
                    operatorTestId={`filter-condition-operator-${cond.id}`}
                    toggleTestId={`filter-condition-expr-toggle-${cond.id}`}
                    valueMessage={problem?.message}
                    grows={false}
                    actions={deleteButton}
                  />
                )
              })}

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8"
                  data-testid={`filter-add-literal-${block.id}`}
                  onClick={() =>
                    setConditions(appendWithOperator(block.conditions, newLiteral(block.asType)))
                  }
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Add Literal
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8"
                  data-testid={`filter-add-expression-${block.id}`}
                  onClick={() =>
                    setConditions(
                      appendWithOperator(block.conditions, {
                        id: nextId('csv-filter-cond'),
                        type: 'expression',
                        expression: '',
                      }),
                    )
                  }
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Add Expression
                </Button>
              </div>
            </div>
            </div>
          </div>
        )
      })}
      <Button
        variant="outline"
        size="sm"
        className="h-8"
        data-testid="filter-add-block"
        onClick={addBlock}
      >
        <Plus className="h-3.5 w-3.5 mr-1" />
        Add Filter
      </Button>
      <EntryChangeQuestions change={change} subject="entry" />
    </div>
  )
}
