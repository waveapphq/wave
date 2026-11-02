/**
 * Password strength score (MCP-7): four segments filled by the score and the label word under them.
 */

import { cn } from '@/lib/utils'
import type { PasswordStrengthResult } from '@/features/settings/api/password-strength'

export interface PasswordStrengthProps {
  strength?: PasswordStrengthResult
  'data-testid'?: string
}

const SEGMENTS = [1, 2, 3, 4] as const

const FILL_BY_SCORE: Record<PasswordStrengthResult['score'], string> = {
  0: 'bg-error',
  1: 'bg-error',
  2: 'bg-warning',
  3: 'bg-success',
  4: 'bg-success',
}

export function PasswordStrength({
  strength,
  'data-testid': testId,
}: Readonly<PasswordStrengthProps>) {
  if (!strength) return null
  const fill = FILL_BY_SCORE[strength.score]
  return (
    <div data-testid={testId} className="mt-2">
      <meter
        className="sr-only"
        min={0}
        max={4}
        value={strength.score}
        aria-label="Password strength"
        aria-valuetext={strength.label}
      />
      <div aria-hidden="true" className="flex gap-1">
        {SEGMENTS.map((segment) => (
          <span
            key={segment}
            className={cn('h-1 flex-1 rounded-full', segment <= strength.score ? fill : 'bg-input')}
          />
        ))}
      </div>
      <p className="mt-1.5 text-xs text-foreground">{strength.label}</p>
    </div>
  )
}
