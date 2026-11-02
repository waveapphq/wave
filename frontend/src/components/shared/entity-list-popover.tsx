/**
 * EntityListPopover - shared popover that lists named entities.
 *
 * A trigger button (rendered as a label or count) opens a Radix Popover that
 * displays the supplied entities as a vertical list. Each row is either a
 * static label (no `href`) or a clickable link (with `href`, fires the
 * optional `onNavigate` callback). Used by the collision-resolution modal
 * and by the canvas breadcrumb collapsed-parents popover.
 */

import { type ReactNode } from 'react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'

export interface EntityListEntry {
  id: string
  name: string
  /** Optional leading icon (rendered before the name). */
  icon?: ReactNode
  /** When set, the row is rendered as a button that fires `onNavigate(href)`. */
  href?: string
}

export interface EntityListPopoverProps {
  /** Trigger label (e.g. "3 suites"). */
  triggerLabel: ReactNode
  /** List rows. */
  entities: ReadonlyArray<EntityListEntry>
  /** Optional list section label (rendered above the rows). */
  label?: string
  /** Optional className applied to the trigger button. Overrides the default underline-dotted style. */
  triggerClassName?: string
  /** Optional ariaLabel applied to the trigger button. */
  triggerAriaLabel?: string
  /** Base test id used to derive trigger / list / row testIds. */
  testId?: string
  /** Explicit trigger testId override (replaces `${testId}-trigger`). */
  triggerTestId?: string
  /** Explicit list testId override (replaces `${testId}-list`). */
  listTestId?: string
  /** Optional className applied to the popover content. */
  contentClassName?: string
  /** Fires when a row with an `href` is clicked. */
  onNavigate?: (href: string) => void
}

const DEFAULT_TRIGGER_CLASS =
  'underline decoration-dotted underline-offset-2 cursor-pointer hover:decoration-solid'

export function EntityListPopover({
  triggerLabel,
  entities,
  label,
  triggerClassName,
  triggerAriaLabel,
  testId,
  triggerTestId,
  listTestId,
  contentClassName,
  onNavigate,
}: Readonly<EntityListPopoverProps>) {
  /* v8 ignore next 2 - COV-V8-003: nested ternary branches for testId resolution; both explicit-override and testId-derived paths are exercised, but the "neither set" fallback is consumer-driven and not used by current callers */
  const resolvedTriggerTestId = triggerTestId ?? (testId ? `${testId}-trigger` : undefined)
  const resolvedListTestId = listTestId ?? (testId ? `${testId}-list` : undefined)
  // When triggerClassName is supplied, the caller is providing the full visual style
  // (e.g. a ghost button); otherwise fall back to the default underline-dotted look.
  const finalTriggerClass = triggerClassName ?? DEFAULT_TRIGGER_CLASS
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={finalTriggerClass}
          data-testid={resolvedTriggerTestId}
          aria-label={triggerAriaLabel}
        >
          {triggerLabel}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className={cn(
          // Sizing rules:
          //   - `w-max` shrink-wraps to the widest child (rows + label).
          //   - `min-w-[14rem]` keeps the popover from feeling cramped when
          //     every entry is short.
          //   - `max-w-[28rem]` caps the width so a single long name can't
          //     blow the popover across the viewport.
          //   - `max-h-56` shows roughly five rows plus the header; anything
          //     beyond that scrolls vertically.
          //   - `overflow-auto` on the inner list yields the horizontal scroll
          //     too: rows use `whitespace-nowrap` so a name longer than
          //     `max-w-[28rem]` simply scrolls into view.
          'w-max min-w-[14rem] max-w-[28rem] p-0',
          contentClassName,
        )}
        align="start"
      >
        <div className="max-h-56 overflow-auto p-2" data-testid={resolvedListTestId}>
          {label && (
            <p className="sticky left-0 text-xs font-medium text-muted-foreground px-2 py-1 bg-popover">
              {label}
            </p>
          )}
          {entities.map((entity) => {
            const rowTestId = testId ? `${testId}-row-${entity.id}` : undefined
            const baseRowClass =
              'flex items-center gap-2 px-2 py-1 text-sm rounded whitespace-nowrap min-w-full'
            if (entity.href) {
              const href = entity.href
              return (
                <button
                  type="button"
                  key={entity.id}
                  className={`${baseRowClass} text-left hover:bg-subtle cursor-pointer`}
                  data-testid={rowTestId}
                  onClick={() => onNavigate?.(href)}
                >
                  {entity.icon}
                  <span>{entity.name}</span>
                </button>
              )
            }
            return (
              <div
                key={entity.id}
                className={`${baseRowClass} hover:bg-muted`}
                data-testid={rowTestId}
              >
                {entity.icon}
                <span>{entity.name}</span>
              </div>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}
