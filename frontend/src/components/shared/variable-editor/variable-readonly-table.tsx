/**
 * VariableReadonlyTable
 *
 * Read-only display of variables in a compact card-style layout.
 * Used by System Variables (settings tab) and Suite Variables (suite detail sidebar).
 */

import type { ReactNode } from 'react'
import { Lock } from 'lucide-react'
import { NullText } from '@/components/shared/variable-bodies/body-parts'
import { formatValue, getValueColorClass, isNullValue } from '@/lib/variable-format'
import type { VariableType } from '@/lib/variable-types'
import { useMaskingSettingsStore } from '@/stores/masking-settings-store'

export interface VariableReadonlyTableProps {
  variables: Record<string, { type: VariableType; value?: string | null; secret: boolean }>
  emptyMessage?: string
}

export function VariableReadonlyTable({
  variables,
  emptyMessage = 'No variables defined',
}: Readonly<VariableReadonlyTableProps>): ReactNode {
  const reveal = useMaskingSettingsStore((s) => s.sharedVariables)
  const entries = Object.entries(variables)

  if (entries.length === 0) {
    return (
      <div
        data-testid="variable-readonly-table"
        className="py-6 text-center text-sm text-muted-foreground"
      >
        {emptyMessage}
      </div>
    )
  }

  return (
    <div data-testid="variable-readonly-table" className="rounded-md border overflow-hidden">
      {entries.map(([name, variable]) => {
        // Same text as the Variable Manager rows; a secret masks unless the system reveals it.
        const isNull = isNullValue(variable.value)
        const valueColorClass = isNull ? '' : getValueColorClass(variable.type, variable.secret)

        return (
          <div
            key={name}
            data-testid="variable-row"
            className="flex flex-col gap-1 px-3 py-2 border-b border-border/50 last:border-b-0 overflow-hidden"
          >
            {/* Row 1: Name + Secret icon */}
            <div className="flex items-center gap-2 min-w-0">
              {variable.secret && (
                <Lock className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
              )}
              <span className="flex-1 font-medium text-sm break-all min-w-0">
                {name}
              </span>
            </div>
            {/* Row 2: Type badge + Value */}
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded flex-shrink-0">
                {variable.type}
              </span>
              <span
                data-testid="variable-value"
                className={`flex-1 text-sm font-mono break-all min-w-0 ${valueColorClass}`}
              >
                {isNull ? (
                  <NullText />
                ) : (
                  formatValue(variable.value, variable.type, variable.secret && !reveal)
                )}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
