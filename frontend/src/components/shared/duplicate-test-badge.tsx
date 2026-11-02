/**
 * DuplicateTestBadge - shown next to a test that appears in 2+ suites of
 * the same regression. Hover reveals the list of containing suites (in
 * regression order) in a scrollable HoverCard.
 *
 * The trigger intentionally renders nothing when fewer than 2 suites are
 * supplied so callers can pass the raw map entry without pre-checking.
 */

import type { ReactNode } from 'react'
import { Copy } from 'lucide-react'
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card'
import { ScrollArea } from '@/components/ui/scroll-area'

export interface DuplicateTestBadgeSuite {
  id: string
  name: string
}

export interface DuplicateTestBadgeProps {
  suites: DuplicateTestBadgeSuite[]
}

export function DuplicateTestBadge({
  suites,
}: Readonly<DuplicateTestBadgeProps>): ReactNode {
  if (suites.length < 2) return null

  return (
    <HoverCard openDelay={150} closeDelay={80}>
      <HoverCardTrigger asChild>
        <span
          data-testid="duplicate-test-badge"
          aria-label={`Runs in ${suites.length} suites of this regression`}
          className="inline-flex h-4 w-4 items-center justify-center rounded-sm border border-amber-300/60 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-900/30 dark:text-amber-300"
        >
          <Copy className="h-3 w-3" />
        </span>
      </HoverCardTrigger>
      <HoverCardContent
        side="top"
        align="start"
        className="w-56 p-0"
        data-testid="duplicate-test-badge-content"
      >
        <div className="px-3 py-2 text-xs font-medium text-muted-foreground border-b">
          Runs in {suites.length} suites of this regression
        </div>
        <ScrollArea
          data-testid="duplicate-test-badge-scroll"
          className="max-h-48 p-2"
        >
          <ul className="space-y-0.5">
            {suites.map((suite) => (
              <li
                key={suite.id}
                data-testid="duplicate-test-badge-suite"
                className="truncate rounded px-2 py-1 text-sm hover:bg-muted"
              >
                {suite.name}
              </li>
            ))}
          </ul>
        </ScrollArea>
      </HoverCardContent>
    </HoverCard>
  )
}
