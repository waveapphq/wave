/**
 * SplitButton
 *
 * Shared primitive: primary action button joined to a dropdown caret that
 * exposes alternative actions. Extracted from the Workbench Debug/Run/Stop
 * controls and now also consumed by the Execution Detail toolbar (Stop).
 *
 * Contract (see tests/components/shared/split-button.test.tsx):
 *   - Primary click fires onPrimaryClick.
 *   - Caret button has its own accessible name `<label> options`.
 *   - Options open on caret click; each option fires its onClick.
 *   - disabled disables both buttons.
 *   - Per-option disabled prevents its onClick.
 *   - allowEmptyOptions hides the caret when options is [].
 */

import type { ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { Button, type ButtonVariant } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export interface SplitButtonOption {
  id: string
  label: string
  onClick: () => void
  disabled?: boolean
}

export interface SplitButtonProps {
  /** Visible label for the primary action. */
  label: string
  /** Optional leading icon. */
  icon?: ReactNode
  /** Button variant for both the primary action and the caret. */
  variant?: ButtonVariant
  /** Fired when the primary area is clicked. */
  onPrimaryClick: () => void
  /** Alternate actions surfaced through the caret dropdown. */
  options: SplitButtonOption[]
  /** Disables both buttons when true. */
  disabled?: boolean
  /** Disables only the caret (primary stays enabled). Defaults to false. */
  caretDisabled?: boolean
  /** When true, zero options hides the caret entirely. Defaults to false. */
  allowEmptyOptions?: boolean
  /** Optional prefix used to derive data-testid attributes for each part. */
  testIdPrefix?: string
}

export function SplitButton({
  label,
  icon,
  variant = 'default',
  onPrimaryClick,
  options,
  disabled = false,
  caretDisabled = false,
  allowEmptyOptions = false,
  testIdPrefix,
}: Readonly<SplitButtonProps>) {
  const showCaret = options.length > 0 || !allowEmptyOptions

  const primaryTestId = testIdPrefix ? `${testIdPrefix}-button` : undefined
  const caretTestId = testIdPrefix ? `${testIdPrefix}-button-dropdown` : undefined

  return (
    <div className="flex" data-split-button-variant={variant}>
      <Button
        variant={variant}
        size="sm"
        disabled={disabled}
        onClick={onPrimaryClick}
        data-testid={primaryTestId}
        className={showCaret ? 'h-8 gap-1.5 rounded-r-none border-r-0' : 'h-8 gap-1.5'}
      >
        {icon}
        <span className="text-sm">{label}</span>
      </Button>
      {showCaret && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant={variant}
              size="sm"
              disabled={disabled || caretDisabled}
              data-testid={caretTestId}
              className="h-8 w-7 rounded-l-none px-1"
              aria-label={`${label} options`}
            >
              <ChevronDown className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {options.map((option) => (
              <DropdownMenuItem
                key={option.id}
                disabled={option.disabled}
                data-testid={
                  testIdPrefix ? `${testIdPrefix}-${option.id}-option` : undefined
                }
                onClick={() => {
                  if (option.disabled) return
                  option.onClick()
                }}
              >
                {option.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}
