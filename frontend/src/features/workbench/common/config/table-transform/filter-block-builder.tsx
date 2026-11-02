/**
 * FilterBlockBuilder - a controlled editor for per-column table filter blocks.
 */

import { Fragment } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { safeStringify } from '@/lib/utils'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { TextField } from '@/components/shared/fields/text-field'
import { ExpressionToggle } from '@/components/shared/fields/expression-toggle'
import { numberEntryProps, takesEntryText } from '@/lib/number-entry'
import {
  ExpressionField,
  type AvailableVariable,
} from '@/features/workbench/common/element-config/expressions/expression-field'
import {
  UNARY_OPERATORS,
  getOperatorsForType,
  nextId,
  withOperator,
  withValueType,
  type AssertionItem,
  type LiteralAssertion,
} from '@/features/workbench/common/config/assertion-builder/types'
import {
  appendWithOperator,
  compareToProblem,
  removeAtPath,
} from '@/features/workbench/common/config/assertion-builder/tree-helpers'
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

function newLiteral(asType: TableColumnType): LiteralAssertion {
  return withOperator(
    {
      id: nextId('csv-filter-cond'),
      type: 'literal',
      variable: '_cell',
      value_type: asType,
      operator: '',
      reference_value: '',
      reference_is_expression: false,
    },
    getOperatorsForType(asType)[0].value,
  )
}

/** A filter's as Type is the type every literal row compares the cell as (CSV-12). */
function retypeLiterals(conditions: AssertionItem[], asType: TableColumnType): AssertionItem[] {
  return conditions.map((item) => (item.type === 'literal' ? withValueType(item, asType) : item))
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
  const updateBlock = (index: number, next: TableFilterBlock) =>
    onChange(replaceAt(filters, index, next))

  const addBlock = () =>
    onChange([
      ...filters,
      { id: nextId('csv-filter'), column: { mode: 'name', value: '' }, asType: 'string', conditions: [] },
    ])

  return (
    <div className="space-y-3">
      {filters.map((block, blockIndex) => {
        const setConditions = (conditions: AssertionItem[]) =>
          updateBlock(blockIndex, { ...block, conditions })
        const operators = getOperatorsForType(block.asType)

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
                onValueChange={(value) => {
                  const asType = value as TableColumnType
                  updateBlock(blockIndex, { ...block, asType, conditions: retypeLiterals(block.conditions, asType) })
                }}
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
                if (cond.type === 'expression') {
                  return (
                    <div key={cond.id} className="flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <ExpressionField
                          name={`csv-filter-expr-${cond.id}`}
                          displayName="filter expression"
                          value={cond.expression}
                          onChange={(value: string) =>
                            setConditions(
                              replaceAt(block.conditions, condIndex, { ...cond, expression: value }),
                            )
                          }
                          availableVariables={[...availableVariables, { name: '_cell', type: block.asType }]}
                          placeholder="_cell != None"
                          isFieldExpression={false}
                        />
                      </div>
                      <ConditionDeleteButton
                        testId={`filter-condition-delete-${cond.id}`}
                        label="Delete filter condition"
                        onDelete={() => setConditions(removeAtPath(block.conditions, [condIndex]))}
                      />
                    </div>
                  )
                }
                if (cond.type === 'literal') {
                  const isUnary = UNARY_OPERATORS.has(cond.operator)
                  const valueProblem = compareToProblem(cond)
                  const valueErrorId = `filter-condition-error-${cond.id}`
                  return (
                    <Fragment key={cond.id}>
                      <div className="flex items-center gap-2">
                        <Select
                          value={cond.operator}
                          onValueChange={(value) =>
                            setConditions(replaceAt(block.conditions, condIndex, withOperator(cond, value)))
                          }
                        >
                          <SelectTrigger
                            data-testid={`filter-condition-operator-${cond.id}`}
                            className="h-8 w-[160px] shrink-0"
                            aria-label="Filter condition operator"
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {operators.map((op) => (
                              <SelectItem key={op.value} value={op.value}>
                                {op.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {!isUnary &&
                          (cond.reference_is_expression ? (
                            <div
                              className="flex-1 min-w-0"
                              data-testid={`filter-condition-value-${cond.id}`}
                            >
                              <ExpressionField
                                name={`csv-filter-ref-${cond.id}`}
                                displayName="filter value"
                                value={safeStringify(cond.reference_value)}
                                onChange={(value: string) =>
                                  setConditions(
                                    replaceAt(block.conditions, condIndex, {
                                      ...cond,
                                      reference_value: value,
                                    }),
                                  )
                                }
                                availableVariables={[...availableVariables, { name: '_cell', type: block.asType }]}
                                placeholder="Expression"
                                isFieldExpression={false}
                              />
                            </div>
                          ) : (
                            <div className="flex-1 min-w-0">
                              <TextField
                                data-testid={`filter-condition-value-${cond.id}`}
                                aria-label="Filter condition value"
                                inputMode={numberEntryProps(block.asType).inputMode}
                                aria-invalid={valueProblem === null ? undefined : true}
                                aria-describedby={valueProblem === null ? undefined : valueErrorId}
                                value={safeStringify(cond.reference_value)}
                                onChange={(value) => {
                                  if (!takesEntryText(value, block.asType)) return
                                  setConditions(
                                    replaceAt(block.conditions, condIndex, {
                                      ...cond,
                                      reference_value: value,
                                    }),
                                  )
                                }}
                                placeholder="Value"
                              />
                            </div>
                          ))}
                        {!isUnary && (
                          <ExpressionToggle
                            pressed={cond.reference_is_expression}
                            onPressedChange={() =>
                              setConditions(
                                replaceAt(block.conditions, condIndex, {
                                  ...cond,
                                  reference_is_expression: !cond.reference_is_expression,
                                }),
                              )
                            }
                            data-testid={`filter-condition-expr-toggle-${cond.id}`}
                            label="Toggle expression mode for value"
                          />
                        )}
                        <ConditionDeleteButton
                          testId={`filter-condition-delete-${cond.id}`}
                          label="Delete filter condition"
                          onDelete={() => setConditions(removeAtPath(block.conditions, [condIndex]))}
                        />
                      </div>
                      {valueProblem !== null && (
                        <p id={valueErrorId} data-testid={valueErrorId} role="alert" className="pl-1 text-xs text-destructive">
                          {valueProblem}
                        </p>
                      )}
                    </Fragment>
                  )
                }
                return null
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
    </div>
  )
}
