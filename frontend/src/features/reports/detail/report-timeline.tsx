/**
 * Report timeline (RVIEW-6, RVIEW-7), mirroring the exported HTML report
 * document: a runs/blocks table (# / name / status / started / duration)
 * followed by a collapsible "Timeline Chart" gantt whose rows are keyed by
 * order number. Run names link to the historical canvas; block names are
 * plain text with a muted parent path prefix. Rows missing ended_at extend
 * to the domain end at reduced opacity.
 */

import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { ConditionalTooltip } from '@/components/ui/tooltip'
import { Timestamp } from '@/components/shared/timestamp/timestamp'
import {
  getStatusColor,
  getStatusDotColor,
  getStatusLabel,
} from '@/components/shared/tables/table-utils'
import { formatDuration } from '@/lib/format-duration'
import {
  axisTicks,
  computeTimelineDomain,
  toTrackPercents,
  type TimelineDomain,
} from '@/features/reports/lib/timeline-scale'
import { listedBlocks } from '@/features/reports/lib/report-block-rows'
import type { ReportTimelineBlock, ReportTimelineRun } from '@/features/reports/api/types'

export interface ReportTimelineProps {
  runs: ReportTimelineRun[]
  blocks: ReportTimelineBlock[]
  entityType: 'test' | 'suite' | 'regression'
}

interface TimelineRowModel {
  key: string
  order: number
  name: string
  label: ReactNode
  status: string
  started_at: string | null
  ended_at: string | null
  duration: number | null
}

const TH_CLASS =
  'border-b bg-muted/30 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground'
const MONO_CELL_CLASS = 'px-3 py-2 font-mono text-xs text-muted-foreground'

/** One-decimal duration like the exported report document ("2.1s"). */
function formatRowDuration(duration: number | null): string {
  return formatDuration(duration === null ? null : Math.round(duration * 10) / 10)
}

function runLabel(run: ReportTimelineRun): ReactNode {
  return (
    <Link
      to={`/executions/history/${run.run_id}`}
      aria-label={`${run.test_name}, ${run.status}, ${formatDuration(run.duration)}`}
      className="text-primary hover:underline"
    >
      {run.test_name}
    </Link>
  )
}

function blockLabel(block: ReportTimelineBlock): ReactNode {
  const segments = block.block_path.split(' / ')
  const leaf = segments.at(-1)
  return (
    <span className="inline-flex min-w-0 items-baseline gap-1">
      {segments.length > 1 && (
        <span
          data-testid="timeline-path-prefix"
          className="shrink-0 text-xs text-muted-foreground"
        >
          {segments.slice(0, -1).join(' / ')} /
        </span>
      )}
      <span className="truncate">{leaf}</span>
    </span>
  )
}

function StatusPill({ status }: Readonly<{ status: string }>): ReactNode {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border bg-muted/40 px-2.5 py-0.5 text-xs font-semibold ${getStatusColor(
        status,
      )}`}
    >
      <span
        className={`h-2 w-2 rounded-full ${getStatusDotColor(status)}`}
        aria-hidden="true"
      />
      {getStatusLabel(status)}
    </span>
  )
}

function ChartRow({
  row,
  domain,
}: Readonly<{ row: TimelineRowModel; domain: TimelineDomain }>): ReactNode {
  const track = toTrackPercents(row, domain)
  return (
    <div className="flex items-center gap-3 py-1">
      <span className="w-10 shrink-0 text-right font-mono text-xs text-muted-foreground">
        {row.order}
      </span>
      <div className="relative h-4 min-w-0 flex-1 overflow-hidden rounded bg-muted/40">
        <ConditionalTooltip
          wide
          content={
            <div className="text-xs">
              <div className="font-medium">
                {row.order} &middot; {row.name}
              </div>
              <div>
                {getStatusLabel(row.status)} - {formatRowDuration(row.duration)}
              </div>
              <div className="opacity-85">
                <Timestamp value={row.started_at} style="time" /> -{' '}
                <Timestamp value={row.ended_at} style="time" />
              </div>
            </div>
          }
        >
          <div
            data-testid="timeline-bar"
            className={`absolute top-0 h-full rounded ${getStatusDotColor(row.status)} ${
              track.openEnded ? 'opacity-50' : ''
            }`}
            style={{ left: `${track.leftPercent}%`, width: `${track.widthPercent}%` }}
          />
        </ConditionalTooltip>
      </div>
      <span className="w-16 shrink-0 text-right font-mono text-xs text-muted-foreground">
        {formatRowDuration(row.duration)}
      </span>
    </div>
  )
}

function ChartHead({
  domain,
  labelTitle,
}: Readonly<{ domain: TimelineDomain; labelTitle: string }>): ReactNode {
  const [startTick, endTick] = axisTicks(domain)
  return (
    <div className="flex items-center gap-3 pb-1.5">
      <span className="w-10 shrink-0 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {labelTitle}
      </span>
      <span
        data-testid="timeline-axis"
        className="flex min-w-0 flex-1 items-center justify-between"
      >
        <Timestamp
          value={new Date(startTick).toISOString()}
          style="time"
          className="shrink-0 font-mono text-[10px] text-muted-foreground"
        />
        <Timestamp
          value={new Date(endTick).toISOString()}
          style="time"
          className="shrink-0 font-mono text-[10px] text-muted-foreground"
        />
      </span>
      <span className="w-16 shrink-0" aria-hidden="true" />
    </div>
  )
}

export function ReportTimeline({
  runs,
  blocks,
  entityType,
}: Readonly<ReportTimelineProps>): ReactNode {
  const isBlocks = entityType === 'test'
  const rows: TimelineRowModel[] = isBlocks
    ? listedBlocks(blocks).map((block) => ({
        key: block.block_id,
        order: block.order,
        name: block.block_path,
        label: blockLabel(block),
        status: block.status,
        started_at: block.started_at,
        ended_at: block.ended_at,
        duration: block.duration,
      }))
    : runs.map((run) => ({
        key: run.run_id,
        order: run.order,
        name: run.test_name,
        label: runLabel(run),
        status: run.status,
        started_at: run.started_at,
        ended_at: run.ended_at,
        duration: run.duration,
      }))

  const domain = computeTimelineDomain(rows)
  const labelTitle = isBlocks ? 'Block' : 'Test'

  return (
    <section data-testid="report-timeline">
      <h2 className="mb-3 text-[15px] font-bold uppercase tracking-wider">Timeline</h2>
      {domain ? (
        <>
          <div className="overflow-hidden rounded-[10px] border">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  <th className={`${TH_CLASS} w-11`}>#</th>
                  <th className={TH_CLASS}>{labelTitle}</th>
                  <th className={TH_CLASS}>Status</th>
                  <th className={TH_CLASS}>Started</th>
                  <th className={TH_CLASS}>Duration</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key} data-testid="timeline-row" className="border-b last:border-b-0">
                    <td className={`${MONO_CELL_CLASS} w-11`}>{row.order}</td>
                    <td className="px-3 py-2 font-medium">{row.label}</td>
                    <td className="px-3 py-2">
                      <StatusPill status={row.status} />
                    </td>
                    <td className={MONO_CELL_CLASS}>
                      <Timestamp value={row.started_at} style="time" />
                    </td>
                    <td className={MONO_CELL_CLASS}>{formatRowDuration(row.duration)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <details open className="group mt-3.5 rounded-[10px] border">
            <summary className="flex cursor-pointer select-none list-none items-center gap-2 px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-muted-foreground [&::-webkit-details-marker]:hidden">
              <ChevronRight
                className="h-3 w-3 transition-transform group-open:rotate-90"
                aria-hidden="true"
              />
              Timeline Chart
            </summary>
            <div className="px-4 pb-3.5 pt-0.5">
              <ChartHead domain={domain} labelTitle={labelTitle} />
              {rows.map((row) => (
                <ChartRow key={row.key} row={row} domain={domain} />
              ))}
            </div>
          </details>
        </>
      ) : (
        <div
          data-testid="timeline-empty"
          className="rounded-[10px] border bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground"
        >
          No timeline data recorded
        </div>
      )}
    </section>
  )
}
