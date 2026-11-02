/**
 * ExecutionInfoPanel
 *
 * Read-only left sidebar panel for the Execution Detail view. Mirrors the
 * visual style of the Regression / Suite metadata sidebar: collapsible
 * section with an uppercase title and a bordered rounded container of
 * icon + label rows. Variable Manager / Watch List are intentionally
 * removed.
 */

import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Activity,
  AlignLeft,
  Calendar,
  ChevronsUpDown,
  Clock,
  ListChecks,
  ServerCog,
  Tag,
  User,
} from 'lucide-react'
import { MetadataRow } from '@/components/shared/metadata-sidebar'
import { formatDuration } from '@/lib/format-duration'
import { Timestamp } from '@/components/shared/timestamp/timestamp'
import type { ExecutionApiResponse } from '@/features/executions/api/types'
import { cn } from '@/lib/utils'

interface ExecutionCounts {
  total: number
  passed: number
  failed: number
  pending: number
  skipped: number
  excluded: number
  stopped?: number
}

interface ExecutionInfoPanelData extends ExecutionApiResponse {
  counts?: ExecutionCounts
  environment_id?: string
  environment?: { id: string; name: string } | null
  tags?: string[]
  description?: string | null
}

export interface ExecutionInfoPanelProps {
  execution: ExecutionInfoPanelData
}

const STATUS_VARIANT: Record<string, 'success' | 'error' | 'warning' | 'default'> = {
  passed: 'success',
  failed: 'error',
  stopped: 'warning',
  running: 'default',
  paused: 'default',
  skipped: 'warning',
}

function humanStatus(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1)
}

function StatusBadge({ status }: Readonly<{ status: string }>) {
  const variant = STATUS_VARIANT[status] ?? 'default'
  const isRunning = status === 'running'
  return (
    <span className="inline-flex items-center gap-2">
      {isRunning && (
        <span
          className={cn('inline-block h-2 w-2 animate-pulse rounded-full bg-primary')}
          aria-hidden="true"
        />
      )}
      <Badge variant={variant}>{humanStatus(status)}</Badge>
    </span>
  )
}

function TotalsGrid({ counts }: Readonly<{ counts: ExecutionCounts }>) {
  const items: { label: string; value: number; colorClass: string }[] = [
    { label: 'Total', value: counts.total, colorClass: 'text-foreground' },
    { label: 'Passed', value: counts.passed, colorClass: 'text-success' },
    { label: 'Excluded', value: counts.excluded, colorClass: 'text-muted-foreground' },
    { label: 'Failed', value: counts.failed, colorClass: 'text-error' },
    { label: 'Skipped', value: counts.skipped, colorClass: 'text-muted-foreground' },
    { label: 'Pending', value: counts.pending, colorClass: 'text-warning' }
  ]
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-1 tabular-nums">
      {items.map((item) => (
        <div key={item.label} className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground">{item.label}:</span>
          <span className={cn('font-semibold', item.colorClass)}>{item.value}</span>
        </div>
      ))}
    </div>
  )
}

function ReadOnlySection({
  title,
  children,
}: Readonly<{ title: string; children: ReactNode }>) {
  return (
    <Collapsible defaultOpen>
      <div className="border-b border-border">
        <div className="flex items-center justify-between px-4 py-3">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-1">
              <ChevronsUpDown className="h-3.5 w-3.5" />
              <span className="text-sm font-semibold uppercase tracking-wider">{title}</span>
            </Button>
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent>{children}</CollapsibleContent>
      </div>
    </Collapsible>
  )
}

export function ExecutionInfoPanel({ execution }: Readonly<ExecutionInfoPanelProps>) {
  const counts: ExecutionCounts = execution.counts ?? {
    total: 0,
    passed: 0,
    failed: 0,
    pending: 0,
    skipped: 0,
    excluded: 0,
  }
  const tags = execution.tags ?? []

  return (
    <div data-testid="execution-info-panel" className="flex h-full flex-col">
      <ScrollArea className="flex-1">
        <div className="space-y-0">
          <ReadOnlySection title="Execution Info">
            <div className="px-4 pb-3">
              <div className="overflow-hidden rounded-md border">
                <div className="space-y-1 px-3 py-2">
                  <MetadataRow icon={<Activity className="h-3.5 w-3.5" />} label="Status">
                    <div className="-ml-2.5">
                      <StatusBadge status={execution.status} />
                    </div>
                  </MetadataRow>

                  <MetadataRow icon={<ListChecks className="h-3.5 w-3.5" />} label="Totals">
                    <TotalsGrid counts={counts} />
                  </MetadataRow>
                </div>

                <div className="space-y-1 border-t border-border/50 px-3 py-2">
                  <MetadataRow icon={<Calendar className="h-3.5 w-3.5" />} label="Started">
                    <Timestamp value={execution.started_at} style="datetime" />
                  </MetadataRow>

                  <MetadataRow icon={<Clock className="h-3.5 w-3.5" />} label="Duration">
                    <span>{formatDuration(execution.duration)}</span>
                  </MetadataRow>

                  <MetadataRow icon={<User className="h-3.5 w-3.5" />} label="Triggered">
                    <span>{execution.triggered_by || '-'}</span>
                  </MetadataRow>

                  <MetadataRow icon={<ServerCog className="h-3.5 w-3.5" />} label="Environment">
                    <span>{execution.environment?.name || execution.environment_id || '-'}</span>
                  </MetadataRow>
                </div>
              </div>
            </div>
          </ReadOnlySection>

          <ReadOnlySection title="Tags & Description">
            <div className="px-4 pb-3">
              <div className="overflow-hidden rounded-md border">
                <div className="space-y-1 px-3 py-2">
                  <MetadataRow icon={<Tag className="h-3.5 w-3.5" />} label="Tags">
                    {tags.length > 0 ? (
                      <div className="-ml-2.5 flex flex-wrap gap-1">
                        {tags.map((tag) => (
                          <Badge key={tag} variant="default">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <span className="text-muted-foreground italic">No tags</span>
                    )}
                  </MetadataRow>

                  <MetadataRow icon={<AlignLeft className="h-3.5 w-3.5" />} label="Description">
                    <p className={execution.description ? '' : 'text-muted-foreground italic'}>
                      {execution.description || 'No description'}
                    </p>
                  </MetadataRow>
                </div>
              </div>
            </div>
          </ReadOnlySection>
        </div>
      </ScrollArea>
    </div>
  )
}
