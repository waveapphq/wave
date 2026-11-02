/**
 * FocusCurrentButton - centers the canvas on the currently executing block.
 */

import { type ReactNode } from 'react'
import { Focus } from 'lucide-react'
import { Button } from '@/components/ui/button'

export interface FocusCurrentButtonProps {
  onFocusCurrent?: () => void
  disabled?: boolean
}

export function FocusCurrentButton({
  onFocusCurrent,
  disabled = false,
}: Readonly<FocusCurrentButtonProps>): ReactNode {
  return (
    <Button
      data-testid="action-focus-current-button"
      variant="default"
      size="sm"
      onClick={onFocusCurrent}
      disabled={disabled}
      className="h-8 gap-1.5"
    >
      <Focus className="h-4 w-4" />
      <span className="text-sm">Focus Current</span>
    </Button>
  )
}
