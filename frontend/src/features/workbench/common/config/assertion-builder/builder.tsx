/**
 * Assertion Builder - Assert Control Configuration UI
 *
 * Custom inline editor for building assertion conditions.
 * Supports literal comparisons, boolean expressions, and nested AND/OR groups.
 * Controlled: it draws the list it is given and hands every change up.
 */

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
import { newLiteralRow, nextId } from './types'
import {
  appendWithOperator,
  addToGroup,
  removeAtPath,
  removeGroupById,
  updateAtPath,
  moveAtPath,
} from './tree-helpers'
import { AddAssertionButton } from './add-assertion-button'
import { AssertionItemRow } from './assertion-item-row'

type AssertionContent = LiteralAssertion | ExpressionAssertion | AssertionGroup

/** Each item with its raw index and its count among the rows or the AND / OR items, for the test ids. */
function indexedItems(items: AssertionItem[]) {
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
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AssertionBuilder({
  assertions,
  availableVariables,
  onAssertionsChange,
}: Readonly<AssertionBuilderProps>) {
  // --- Operations ---

  const add = (item: AssertionContent, parentId?: string) =>
    onAssertionsChange(parentId ? addToGroup(assertions, parentId, item) : appendWithOperator(assertions, item))

  const handleAddLiteral = (parentId?: string) => add(newLiteralRow(), parentId)

  const handleAddExpression = (parentId?: string) =>
    add({ id: nextId('expr'), type: 'expression', expression: '' }, parentId)

  const handleAddGroup = (parentId?: string) => add({ id: nextId('group'), type: 'group', items: [] }, parentId)

  const handleDelete = (path: number[]) => onAssertionsChange(removeAtPath(assertions, path))

  const handleUpdate = (path: number[], updated: AssertionItem) =>
    onAssertionsChange(updateAtPath(assertions, path, updated))

  const handleMove = (path: number[], direction: 'up' | 'down') =>
    onAssertionsChange(moveAtPath(assertions, path, direction))

  const handleDeleteGroup = (groupId: string) => onAssertionsChange(removeGroupById(assertions, groupId))

  // Assertion indices (non-operator items only) and operator indices for the test ids
  const renderItems = indexedItems(assertions)
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
