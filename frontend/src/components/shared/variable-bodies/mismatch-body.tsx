/**
 * MismatchBody - type-mismatch guard body: amber notice naming the received
 * vs declared type, with the raw runtime value below tinted by its actual
 * render type. The host shows it only for displayed RUNTIME values.
 *
 * REQ-3.1.3.11: Variable watching UI panel
 */

import { cn } from '@/lib/utils'
import {
  formatCellText,
  getCellColorClass,
  inferRenderType,
} from '@/lib/variable-format'
import type { VariableType } from '@/lib/variable-types'

export interface MismatchBodyProps {
  value: unknown
  declaredType: VariableType
}

export function MismatchBody({ value, declaredType }: Readonly<MismatchBodyProps>) {
  const actualType = inferRenderType(value)
  return (
    <div
      data-testid="mismatch-body"
      className="space-y-2 font-mono text-sm select-text"
    >
      <div className="italic text-amber-600 dark:text-amber-400">
        received {actualType} - declared {declaredType}
      </div>
      <div className={cn('whitespace-pre-wrap break-words', getCellColorClass(actualType))}>
        {formatCellText(value)}
      </div>
    </div>
  )
}
