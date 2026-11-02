/**
 * MovePair and RowActionButton - the reorder arrow pair and the icon button
 * behind it, shared by the branch cards and the ordered-list rows.
 */

import { useCallback, type ReactNode } from 'react'
import { ArrowUp, ArrowDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCanvasReadOnly } from '../canvas/read-only-context'

const DISABLED_ACTION = 'text-muted-foreground opacity-50 cursor-not-allowed'
const ENABLED_ACTION = 'text-muted-foreground hover:text-foreground'

export interface RowActionButtonProps {
  testId: string
  ariaLabel: string
  disabled?: boolean
  onClick: () => void
  className?: string
  children: ReactNode
}

export function RowActionButton({
  testId,
  ariaLabel,
  disabled = false,
  onClick,
  className,
  children,
}: Readonly<RowActionButtonProps>) {
  // A read-only canvas disables the button through its fieldset; the look must follow.
  const readOnly = useCanvasReadOnly()
  const isDisabled = disabled || readOnly
  const handleClick = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation()
      onClick()
    },
    [onClick],
  )
  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={ariaLabel}
      disabled={isDisabled}
      onClick={handleClick}
      className={cn(
        'p-0.5 rounded focus-visible:ring-2 focus-visible:ring-offset-2',
        isDisabled ? DISABLED_ACTION : cn(ENABLED_ACTION, className),
      )}
    >
      {children}
    </button>
  )
}

export interface MovePairProps {
  canMoveUp: boolean
  canMoveDown: boolean
  onMove: (direction: 'up' | 'down') => void
  upLabel: string
  downLabel: string
  upTestId: string
  downTestId: string
}

export function MovePair({
  canMoveUp,
  canMoveDown,
  onMove,
  upLabel,
  downLabel,
  upTestId,
  downTestId,
}: Readonly<MovePairProps>) {
  return (
    <div className="flex gap-0.5">
      <RowActionButton
        testId={upTestId}
        ariaLabel={upLabel}
        disabled={!canMoveUp}
        onClick={() => onMove('up')}
      >
        <ArrowUp className="w-3.5 h-3.5" />
      </RowActionButton>
      <RowActionButton
        testId={downTestId}
        ariaLabel={downLabel}
        disabled={!canMoveDown}
        onClick={() => onMove('down')}
      >
        <ArrowDown className="w-3.5 h-3.5" />
      </RowActionButton>
    </div>
  )
}
