/**
 * Assertion Builder - Assert Control Configuration UI
 *
 * Custom inline editor for building assertion conditions.
 * Supports literal comparisons, boolean expressions, and nested AND/OR groups.
 */

import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { Group } from 'lucide-react'
import { Button } from '@/components/ui/button'

import type {
  AssertionItem,
  AssertionGroup,
  LiteralAssertion,
  ExpressionAssertion,
  OperatorItem,
  AssertionBuilderProps,
} from './types'
import { nextId } from './types'
import {
  appendWithOperator,
  addToGroup,
  removeAtPath,
  removeGroupById,
  updateAtPath,
  moveAtPath,
  areAssertionsComplete,
} from './tree-helpers'
import { AddAssertionButton } from './add-assertion-button'
import { AssertionItemRow } from './assertion-item-row'

// Re-export types for backward compatibility
export type {
  LiteralAssertion,
  ExpressionAssertion,
  OperatorItem,
  AssertionGroup,
  AssertionItem,
  AssertionBuilderProps,
} from './types'

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AssertionBuilder({
  assertions: propAssertions,
  availableVariables,
  onAssertionsChange,
  onValidChange,
}: Readonly<AssertionBuilderProps>) {
  // Internal state mirrors props for controlled editing
  const [items, setItems] = useState<AssertionItem[]>(propAssertions)

  // Sync internal state when props change from outside
  const prevPropsRef = useRef(propAssertions)
  useEffect(() => {
    if (prevPropsRef.current !== propAssertions) {
      setItems(propAssertions)
      prevPropsRef.current = propAssertions
    }
  }, [propAssertions])

  // Track validity - every row must be complete, not merely present
  useEffect(() => {
    onValidChange?.(areAssertionsComplete(items))
  }, [items, onValidChange])

  // Propagate changes: update internal state AND notify parent
  const propagate = useCallback(
    (updated: AssertionItem[]) => {
      setItems(updated)
      prevPropsRef.current = updated
      onAssertionsChange(updated)
    },
    [onAssertionsChange],
  )

  // --- Operations ---

  const handleAddLiteral = useCallback(
    (parentId?: string) => {
      const newItem: LiteralAssertion = {
        id: nextId('lit'),
        type: 'literal',
        variable: '',
        value_type: 'string',
        operator: 'equals',
        reference_value: '',
        reference_is_expression: false,
      }
      if (parentId) {
        propagate(addToGroup(items, parentId, newItem))
      } else {
        propagate(appendWithOperator(items, newItem))
      }
    },
    [items, propagate],
  )

  const handleAddExpression = useCallback(
    (parentId?: string) => {
      const newItem: ExpressionAssertion = {
        id: nextId('expr'),
        type: 'expression',
        expression: '',
      }
      if (parentId) {
        propagate(addToGroup(items, parentId, newItem))
      } else {
        propagate(appendWithOperator(items, newItem))
      }
    },
    [items, propagate],
  )

  const handleAddGroup = useCallback(
    (parentId?: string) => {
      const newGroup: AssertionGroup = {
        id: nextId('group'),
        type: 'group',
        items: [],
      }
      if (parentId) {
        propagate(addToGroup(items, parentId, newGroup))
      } else {
        propagate(appendWithOperator(items, newGroup))
      }
    },
    [items, propagate],
  )

  const handleDelete = useCallback(
    (path: number[]) => {
      propagate(removeAtPath(items, path))
    },
    [items, propagate],
  )

  const handleUpdate = useCallback(
    (path: number[], updated: AssertionItem) => {
      propagate(updateAtPath(items, path, updated))
    },
    [items, propagate],
  )

  const handleMove = useCallback(
    (path: number[], direction: 'up' | 'down') => {
      propagate(moveAtPath(items, path, direction))
    },
    [items, propagate],
  )

  const handleDeleteGroup = useCallback(
    (groupId: string) => {
      propagate(removeGroupById(items, groupId))
    },
    [items, propagate],
  )

  // Compute assertion indices (non-operator items only) and operator indices for test-ids
  const renderItems = useMemo(() => {
    let assertionIdx = 0
    let operatorIdx = 0
    return items.map((item, rawIndex) => {
      if (item.type === 'operator') {
        operatorIdx++
        return { item, rawIndex, assertionIndex: -1, operatorIndex: operatorIdx }
      }
      const idx = assertionIdx++
      return { item, rawIndex, assertionIndex: idx, operatorIndex: -1 }
    })
  }, [items])

  const assertionCount = renderItems.filter((r) => r.assertionIndex >= 0).length

  return (
    <div className="space-y-3" data-testid="assertion-builder">
      {/* Root scope container */}
      <div className="border border-dashed rounded-lg p-3" data-testid="assertion-builder-root">
        {assertionCount === 0 ? (
          <div
            role="alert"
            data-testid="assertion-builder-empty"
            className="text-sm text-destructive py-4 text-center"
          >
            At least one assertion is required
          </div>
        ) : (
          <div className="space-y-1">
            {renderItems.map((entry) => {
              if (entry.item.type === 'operator') {
                return (
                  <div key={`op-${entry.rawIndex}`} className="flex justify-center py-1">
                    <button
                      data-testid={`assert-operator-toggle-root-${entry.operatorIndex}`}
                      className="text-xs font-medium text-muted-foreground hover:text-foreground px-3 py-0.5 rounded-full border bg-muted/50"
                      onClick={() => {
                        const newOp = entry.item.type === 'operator' && entry.item.value === 'and' ? 'or' : 'and'
                        handleUpdate([entry.rawIndex], { type: 'operator', value: newOp } as OperatorItem)
                      }}
                    >
                      {entry.item.value.toUpperCase()}
                    </button>
                  </div>
                )
              }
              return (
                /* v8 ignore next 2 - COV-BRANCH-102 */
                <div key={'id' in entry.item ? entry.item.id : `item-${entry.rawIndex}`}>
                  <AssertionItemRow
                    item={entry.item}
                    path={[entry.rawIndex]}
                    index={entry.assertionIndex}
                    total={assertionCount}
                    availableVariables={availableVariables}
                    onUpdate={handleUpdate}
                    onDelete={handleDelete}
                    onMove={handleMove}
                    onAddLiteral={handleAddLiteral}
                    onAddExpression={handleAddExpression}
                    onAddGroup={handleAddGroup}
                    onDeleteGroup={handleDeleteGroup}
                  />
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Add buttons */}
      <div className="flex items-center gap-2">
        <AddAssertionButton
          testIdSuffix=""
          onAddLiteral={() => handleAddLiteral()}
          onAddExpression={() => handleAddExpression()}
          compact={false}
        />
        <Button
          variant="outline"
          size="sm"
          data-testid="assert-add-group"
          onClick={() => handleAddGroup()}
        >
          <Group className="h-3.5 w-3.5" />
          Add Group
        </Button>
      </div>

    </div>
  )
}
