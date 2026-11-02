/**
 * The one WAVE tooltip - REQ-5.2.1.17
 *
 * Every hover hint in the product comes from this component. It fixes the
 * surface, arrow, stacking, Escape, close-on-leave and not-shown-on-touch; a
 * call site chooses only delay, side/align, the wide variant, and whether
 * there is content at all.
 */

import * as React from 'react'
import * as RadixTooltip from '@radix-ui/react-tooltip'
import { cn, detectTouchDevice } from '@/lib/utils'

/**
 * System-wide tooltip timings:
 * - ENABLED (500): hover hints on functional controls. Long enough that a
 *   quick mouse sweep does not flash a tooltip on every icon.
 * - DISABLED (100): explanations for controls whose click does nothing; the
 *   user is asking "why didn't that work?" so the answer must surface fast.
 */
export const ENABLED_TOOLTIP_DELAY_MS = 500
export const DISABLED_TOOLTIP_DELAY_MS = 100

export interface ConditionalTooltipProps {
  /** Tooltip body. Empty (undefined / null / '') renders the trigger unwrapped. */
  content: React.ReactNode
  /** A single trigger node, rendered unchanged. */
  children: React.ReactElement
  /** When true, uses the faster disabled-state delay. */
  disabled?: boolean
  /** Explicit hover delay override; falls back to the system constants. */
  delayMs?: number
  side?: React.ComponentProps<typeof RadixTooltip.Content>['side']
  align?: React.ComponentProps<typeof RadixTooltip.Content>['align']
  sideOffset?: number
  /** Wrap and cap the width for content of unbounded length: at 30vw, or 'fixed' at 26rem so a reason keeps its line count on any screen. */
  wide?: boolean | 'fixed'
  /** Controlled open, so code can show the hint on a key press. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function ConditionalTooltip({
  content,
  children,
  disabled = false,
  delayMs,
  side = 'top',
  align = 'center',
  sideOffset = 4,
  wide = false,
  open,
  onOpenChange,
}: Readonly<ConditionalTooltipProps>) {
  if (content === undefined || content === null || content === '') {
    return children
  }
  if (detectTouchDevice()) {
    return children
  }
  const resolvedDelay = delayMs ?? (disabled ? DISABLED_TOOLTIP_DELAY_MS : ENABLED_TOOLTIP_DELAY_MS)
  return (
    <RadixTooltip.Provider
      delayDuration={resolvedDelay}
      skipDelayDuration={0}
      disableHoverableContent
    >
      <RadixTooltip.Root open={open} onOpenChange={onOpenChange}>
        <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
        <RadixTooltip.Portal>
          <RadixTooltip.Content
            data-slot="tooltip-content"
            side={side}
            align={align}
            sideOffset={sideOffset}
            className={cn(
              'z-[100] rounded-md px-2.5 py-[5px] text-xs text-popover-foreground shadow-md',
              'bg-[var(--color-bg-card)] dark:bg-popover',
              'border border-foreground/20 dark:border-white/15',
              'animate-in fade-in-0 zoom-in-95',
              'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
              'data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
              wide ? 'whitespace-normal break-words' : 'whitespace-nowrap',
              wide === true && 'max-w-[30vw]',
              wide === 'fixed' && 'max-w-[26rem]',
            )}
          >
            {content}
            <RadixTooltip.Arrow asChild>
              <span
                data-slot="tooltip-arrow"
                className={cn(
                  'z-[100] size-2.5 translate-y-[calc(-50%_-_1px)] rotate-45 rounded-[2px]',
                  'bg-[var(--color-bg-card)] dark:bg-popover',
                  'border-b border-r border-foreground/20 dark:border-white/15',
                )}
              />
            </RadixTooltip.Arrow>
          </RadixTooltip.Content>
        </RadixTooltip.Portal>
      </RadixTooltip.Root>
    </RadixTooltip.Provider>
  )
}
