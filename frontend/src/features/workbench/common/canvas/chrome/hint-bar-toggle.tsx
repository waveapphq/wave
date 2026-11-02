/**
 * HintPopoverToggle Component
 *
 * REQ-4.2.5 Keyboard shortcuts for common operations
 *
 * Circle toggle button for the interactions hint popover.
 * Displays "?" and reflects open/closed state via aria-expanded.
 * Positioned bottom-right of canvas near React Flow zoom controls.
 */

import { Button } from '@/components/ui/button'

interface HintPopoverToggleProps {
  isOpen: boolean
  onToggle: () => void
}

export function HintPopoverToggle({ isOpen, onToggle }: Readonly<HintPopoverToggleProps>) {
  return (
    <Button
      variant="outline"
      size="icon"
      className="h-7 w-7 rounded-full text-xs font-bold"
      onClick={onToggle}
      aria-label="Toggle keyboard shortcuts"
      aria-expanded={isOpen}
      data-testid="hint-popover-toggle"
    >
      ?
    </Button>
  )
}
