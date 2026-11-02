/**
 * ValidationStrip - the shared validation strip above a variable modal footer:
 * a single message, or - for a multi-problem result (e.g. a table's column + cell
 * errors) - the first message plus a "(+N more)" expander that opens the full list
 * (reuses the shared EntityListPopover). Used by both the inspect and create
 * modals so the affordance is identical and lives in one place.
 *
 * REQ-3.1.3.11: Variable watching UI panel
 */

import { EntityListPopover } from '@/components/shared/entity-list-popover'

export interface ValidationStripProps {
  /** Test id for the strip; the expander derives `${testId}-more[-list]`. */
  testId: string
  message: string
  /** Full ordered message list - drives the "(+N more)" expander when > 1. */
  messages: string[] | null
  /** 'error' (default, red, blocking) or 'advisory' (amber, non-blocking). */
  severity?: 'error' | 'advisory'
}

export function ValidationStrip({
  testId,
  message,
  messages,
  severity = 'error',
}: Readonly<ValidationStripProps>) {
  // <output> carries the implicit status role; error severity overrides to alert.
  return (
    <output
      data-testid={testId}
      role={severity === 'error' ? 'alert' : undefined}
      aria-live="polite"
      // select-text overrides the draggable sheet's select-none so the error can
      // be highlighted + copied.
      className={
        severity === 'error'
          ? 'block select-text cursor-text border-t border-destructive/40 bg-destructive/10 px-3 py-1.5 font-mono text-xs text-destructive'
          : 'block select-text cursor-text border-t border-amber-500/40 bg-amber-500/10 px-3 py-1.5 font-mono text-xs text-amber-600 dark:text-amber-400'
      }
    >
      {messages && messages.length > 1 ? (
        <span className="inline-flex flex-wrap items-center gap-x-1">
          {messages[0]}
          <EntityListPopover
            triggerLabel={`(+${messages.length - 1} more)`}
            triggerClassName="underline decoration-dotted underline-offset-2 cursor-pointer hover:decoration-solid"
            triggerTestId={`${testId}-more`}
            listTestId={`${testId}-more-list`}
            entities={messages.map((entry, index) => ({ id: String(index), name: entry }))}
          />
        </span>
      ) : (
        message
      )}
    </output>
  )
}
