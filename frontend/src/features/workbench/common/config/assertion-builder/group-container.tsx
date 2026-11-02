/**
 * Assertion Builder - Group Container
 *
 * Renders a group of assertion items with nested AND/OR operators.
 */

import { useMemo } from 'react'
import { ChevronDown, ChevronUp, Group, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

import type {
  AssertionGroup,
  AssertionNodeProps,
  OperatorItem,
} from './types'
import { AddAssertionButton } from './add-assertion-button'
import { AssertionItemRow } from './assertion-item-row'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface GroupContainerProps extends AssertionNodeProps {
  group: AssertionGroup
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function GroupContainer({
  group,
  path,
  index,
  total,
  availableVariables,
  onUpdate,
  onDelete,
  onMove,
  onAddLiteral,
  onAddExpression,
  onAddGroup,
  onDeleteGroup,
}: Readonly<GroupContainerProps>) {
  // Compute assertion and operator indices for group children
  const childEntries = useMemo(() => {
    let assertionIdx = 0
    let operatorIdx = 0
    return group.items.map((child, rawIndex) => {
      if (child.type === 'operator') {
        operatorIdx++
        return { child, rawIndex, assertionIndex: -1, operatorIndex: operatorIdx }
      }
      const idx = assertionIdx++
      return { child, rawIndex, assertionIndex: idx, operatorIndex: -1 }
    })
  }, [group.items])

  const childAssertionCount = childEntries.filter((e) => e.assertionIndex >= 0).length

  return (
    <div
      className="border border-dashed rounded-lg p-3"
      data-testid={`assert-group-${group.id}`}
    >
      {childAssertionCount === 0 && (
        <div
          role="alert"
          data-testid={`assert-group-empty-${group.id}`}
          className="text-sm text-destructive py-2 text-center"
        >
          At least one assertion is required
        </div>
      )}

      {/* Group items (interleaved) */}
      {childAssertionCount > 0 && (
        <div className="space-y-1">
          {childEntries.map((entry) => {
            if (entry.child.type === 'operator') {
              return (
                <div key={`op-${entry.rawIndex}`} className="flex justify-center py-1">
                  <button
                    type="button"
                    data-testid={`assert-operator-toggle-${group.id}-${entry.operatorIndex}`}
                    className="text-xs font-medium text-muted-foreground hover:text-foreground px-3 py-0.5 rounded-full border bg-muted/50 focus-visible:ring-2 focus-visible:ring-offset-2"
                    onClick={() => {
                      const newOp = (entry.child as OperatorItem).value === 'and' ? 'or' : 'and'
                      onUpdate([...path, entry.rawIndex], { type: 'operator', value: newOp } as OperatorItem)
                    }}
                  >
                    {entry.child.value.toUpperCase()}
                  </button>
                </div>
              )
            }
            return (
              /* v8 ignore next 2 - COV-BRANCH-104 */
              <div key={'id' in entry.child ? entry.child.id : `item-${entry.rawIndex}`}>
                <AssertionItemRow
                  item={entry.child}
                  path={[...path, entry.rawIndex]}
                  index={entry.assertionIndex}
                  total={childAssertionCount}
                  availableVariables={availableVariables}
                  onUpdate={onUpdate}
                  onDelete={onDelete}
                  onMove={onMove}
                  onAddLiteral={onAddLiteral}
                  onAddExpression={onAddExpression}
                  onAddGroup={onAddGroup}
                  onDeleteGroup={onDeleteGroup}
                />
              </div>
            )
          })}
        </div>
      )}

      {/* Add + group action buttons */}
      <div className="flex items-center gap-1 mt-2">
        <AddAssertionButton
          testIdSuffix={group.id}
          onAddLiteral={() => onAddLiteral(group.id)}
          onAddExpression={() => onAddExpression(group.id)}
          compact
        />
        <Button
          variant="outline"
          size="sm"
          className="h-8 w-8 p-0"
          data-testid={`assert-group-add-group-${group.id}`}
          aria-label="Add nested group"
          onClick={() => onAddGroup(group.id)}
        >
          <Group className="h-3.5 w-3.5" />
        </Button>

        <div className="w-px h-5 bg-border mx-1" />

        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
          data-testid={`assert-group-delete-${group.id}`}
          aria-label="Delete group"
          onClick={() => onDeleteGroup(group.id)}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          data-testid={`assert-group-move-up-${group.id}`}
          aria-label="Move group up"
          onClick={() => onMove(path, 'up')}
          disabled={index === 0}
        >
          <ChevronUp className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          data-testid={`assert-group-move-down-${group.id}`}
          aria-label="Move group down"
          onClick={() => onMove(path, 'down')}
          disabled={index === total - 1}
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  )
}
