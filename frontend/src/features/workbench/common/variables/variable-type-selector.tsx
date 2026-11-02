/**
 * VariableTypeSelector - the Type cell of a variable row: locked to an existing
 * variable's type, a free select for a variable that does not exist yet.
 * Design decision: VARSET-5
 */

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ConditionalTooltip } from '@/components/ui/tooltip'
import { VARIABLE_TYPES } from './variable-setter-editor/types'

export interface VariableTypeSelectorProps {
  type: string
  isExisting: boolean
  onTypeChange: (type: string) => void
  testId: string
  ariaLabel?: string
  className?: string
}

export function VariableTypeSelector({
  type,
  isExisting,
  onTypeChange,
  testId,
  ariaLabel,
  className = 'w-[100px]',
}: Readonly<VariableTypeSelectorProps>) {
  if (isExisting) {
    return (
      <div className={className}>
        <ConditionalTooltip content="Type is inherited from the existing variable" disabled>
          <span className="block">
            <Select value={type} disabled>
              <SelectTrigger
                className="h-8 text-sm pointer-events-none"
                data-testid={testId}
                aria-label={ariaLabel}
                aria-disabled
                tabIndex={-1}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VARIABLE_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </span>
        </ConditionalTooltip>
      </div>
    )
  }

  return (
    <div className={className}>
      <Select value={type} onValueChange={onTypeChange}>
        <SelectTrigger className="h-8 text-sm" data-testid={testId} aria-label={ariaLabel}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {VARIABLE_TYPES.map((t) => (
            <SelectItem key={t.value} value={t.value}>
              {t.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
