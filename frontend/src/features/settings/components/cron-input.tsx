/**
 * CronInput Component
 *
 * Input field for cron expressions with validation and human-readable description.
 * Supports standard 5-field cron format (minute hour day month weekday).
 */

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

// ============================================================================
// Types
// ============================================================================

export interface CronInputProps {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  className?: string
}

const MESSAGE_ID = 'cron-expression-message'

// ============================================================================
// Cron Validation
// ============================================================================

/** Validate a single cron field: wildcard, step, range, or list */
function isValidCronField(field: string): boolean {
  // Wildcard: *
  if (field === '*') return true
  // Step from wildcard: */N
  if (/^\*\/\d+$/.test(field)) return true
  // Numeric range list with optional step: N(-N)?(,N(-N)?)* (/N)?
  if (/^\d+(-\d+)?(,\d+(-\d+)?)*(\/\d+)?$/.test(field)) return true
  return false
}

function isValidCron(expression: string): boolean {
  const parts = expression.trim().split(/\s+/)
  if (parts.length !== 5) return false
  return parts.every(isValidCronField)
}

function describeCron(expression: string): string {
  const parts = expression.trim().split(/\s+/)
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts

  const pieces: string[] = []

  if (minute.startsWith('*/')) {
    pieces.push(`Every ${minute.slice(2)} minutes`)
  } else if (hour.startsWith('*/')) {
    pieces.push(`Every ${hour.slice(2)} hours`)
  } else if (minute !== '*' && hour !== '*') {
    pieces.push(`At ${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`)
  } else if (minute === '*') {
    pieces.push('Every minute')
  } else {
    pieces.push(`At minute ${minute}`)
  }

  if (dayOfMonth !== '*') {
    pieces.push(`on day ${dayOfMonth}`)
  }
  if (month !== '*') {
    pieces.push(`in month ${month}`)
  }
  if (dayOfWeek !== '*') {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    const dayNum = Number.parseInt(dayOfWeek, 10)
    if (!Number.isNaN(dayNum) && dayNum >= 0 && dayNum <= 6) {
      pieces.push(`on ${days[dayNum]}`)
    } else {
      pieces.push(`on weekday ${dayOfWeek}`)
    }
  }

  return pieces.join(' ')
}

// ============================================================================
// Component
// ============================================================================

export function CronInput({ value, onChange, disabled, className }: Readonly<CronInputProps>) {
  const trimmed = value.trim()
  const valid = trimmed !== '' && isValidCron(trimmed)
  const invalid = trimmed !== '' && !valid

  return (
    <div className={className}>
      <Label htmlFor="cron-expression" className="text-sm font-medium mb-1.5 block">
        Cron Expression
      </Label>
      <Input
        id="cron-expression"
        name="cron"
        data-testid="cron-input"
        autoComplete="off"
        spellCheck={false}
        aria-invalid={invalid}
        aria-describedby={trimmed === '' ? undefined : MESSAGE_ID}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder="0 2 * * *"
        className="font-mono"
      />
      {valid && (
        <p id={MESSAGE_ID} data-testid="cron-description" className="text-xs text-muted-foreground mt-1">
          {describeCron(trimmed)}
        </p>
      )}
      {invalid && (
        <p id={MESSAGE_ID} data-testid="cron-error" className="text-xs text-destructive mt-1">
          Invalid cron expression. Use 5-field format: minute hour day month weekday
        </p>
      )}
    </div>
  )
}
