/**
 * Errors section of the report viewer (RVIEW-8), mirroring the exported
 * HTML report document: h2 section heading with a count aside, one
 * bordered card per ERROR/FATAL record, success-tinted empty state.
 */

import type { ReactNode } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Timestamp } from '@/components/shared/timestamp/timestamp'
import type { ReportError } from '@/features/reports/api/types'
import { ConditionalTooltip } from '@/components/ui/tooltip'

export interface ReportErrorsTableProps {
  errors: ReportError[]
}

export function ReportErrorsTable({ errors }: Readonly<ReportErrorsTableProps>): ReactNode {
  return (
    <section data-testid="report-errors">
      <h2 className="mb-3 flex items-center justify-between text-[15px] font-bold uppercase tracking-wider">
        Errors
        {errors.length > 0 && (
          <span className="text-xs font-normal normal-case tracking-normal text-muted-foreground">
            {errors.length} {errors.length === 1 ? 'error' : 'errors'}
          </span>
        )}
      </h2>
      <div className="flex flex-col gap-3">
        {errors.length === 0 ? (
          <div
            data-testid="errors-empty-state"
            className="flex items-center gap-2 rounded-[10px] border border-success/30 bg-success/5 px-4 py-3 text-sm text-success"
          >
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
            No errors recorded
          </div>
        ) : (
          errors.map((error, index) => {
            const source = [error.test_name, error.block_path].filter(Boolean).join(' / ')
            return (
              <div
                key={`${error.timestamp}-${index}`}
                data-testid="error-card"
                className="rounded-[10px] border border-error/40 bg-error/5 p-4"
              >
                <div className="flex items-center gap-3">
                  <Badge variant="error">{error.level}</Badge>
                  <ConditionalTooltip content={source} wide>
                    <span className="truncate text-sm font-semibold">{source}</span>
                  </ConditionalTooltip>
                  <Timestamp
                    value={error.timestamp}
                    style="time"
                    className="ml-auto shrink-0 font-mono text-xs text-muted-foreground"
                  />
                </div>
                <div className="mt-1.5 text-sm font-medium text-error">{error.message}</div>
              </div>
            )
          })
        )}
      </div>
    </section>
  )
}
