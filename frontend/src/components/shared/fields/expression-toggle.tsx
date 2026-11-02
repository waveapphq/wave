import { Braces } from 'lucide-react'

import { Toggle } from '@/components/ui/toggle'
import { cn } from '@/lib/utils'
import { PRESSED_LOOK_CLASS } from '@/lib/variable-format'

export interface ExpressionToggleProps {
  /** On while the field holds an expression. */
  pressed: boolean
  onPressedChange: (pressed: boolean) => void
  /** Accessible name of the icon-only button. */
  label: string
  'data-testid'?: string
  disabled?: boolean
}

/** The one {x} toggle of every field that takes an expression, in one size and one look (FIELD-1). */
export function ExpressionToggle({
  pressed,
  onPressedChange,
  label,
  'data-testid': testId,
  disabled = false,
}: Readonly<ExpressionToggleProps>) {
  // Only the props above reach the Toggle: a wrapping trigger's data-state would hide the pressed look.
  return (
    <Toggle
      data-slot="expression-toggle"
      data-testid={testId}
      pressed={pressed}
      onPressedChange={onPressedChange}
      disabled={disabled}
      size="sm"
      aria-label={label}
      className={cn(
        'h-8 w-8 p-0',
        PRESSED_LOOK_CLASS,
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      <Braces className="h-4 w-4" />
    </Toggle>
  )
}
