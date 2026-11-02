/**
 * Assertion Builder - Action Buttons (delete, move up, move down)
 */

import { ChevronDown, ChevronUp, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface ActionButtonsProps {
  pathStr: string
  index: number
  total: number
  isNested: boolean
  onDelete: () => void
  onMoveUp: () => void
  onMoveDown: () => void
}

export function ActionButtons({
  pathStr,
  index,
  total,
  isNested,
  onDelete,
  onMoveUp,
  onMoveDown,
}: Readonly<ActionButtonsProps>) {
  // Nested items can always move (escape the group at boundaries)
  const canMoveUp = isNested || index > 0
  const canMoveDown = isNested || index < total - 1
  return (
    <div className="flex items-center gap-0.5 shrink-0">
      <Button
        variant="ghost"
        size="sm"
        className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
        data-testid={`assert-delete-${pathStr}`}
        aria-label="Delete assertion"
        onClick={onDelete}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-8 w-8 p-0"
        data-testid={`assert-move-up-${pathStr}`}
        aria-label="Move assertion up"
        onClick={onMoveUp}
        disabled={!canMoveUp}
      >
        <ChevronUp className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-8 w-8 p-0"
        data-testid={`assert-move-down-${pathStr}`}
        aria-label="Move assertion down"
        onClick={onMoveDown}
        disabled={!canMoveDown}
      >
        <ChevronDown className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}
