/**
 * Summary area of the report viewer (RVIEW-4, RVIEW-5), mirroring the
 * exported HTML report document: a plain meta container (no heading)
 * followed by a "Test Results" / "Block Results" section of count cards.
 */

import type { ReactNode } from 'react'
import { Timestamp } from '@/components/shared/timestamp/timestamp'
import { formatDuration } from '@/lib/format-duration'
import { countBlocksByTile } from '@/features/reports/lib/report-block-rows'
import type {
  ReportExecutionInfo,
  ReportSummary,
  ReportTimelineBlock,
} from '@/features/reports/api/types'

export interface ReportSummaryHeaderProps {
  summary: ReportSummary
  execution: ReportExecutionInfo
  blocks: ReportTimelineBlock[]
  generatedAt: string
}

interface CountCard {
  key: string
  label: string
  value: number
}

const FIELD_LABEL_CLASS = 'text-[11px] font-semibold uppercase tracking-wider text-muted-foreground'

const COUNT_VALUE_COLORS: Record<string, string> = {
  total: 'text-foreground',
  passed: 'text-success',
  failed: 'text-error',
  warning: 'text-warning',
  skipped: 'text-warning',
  stopped: 'text-foreground',
  excluded: 'text-foreground',
  pending: 'text-foreground',
}

function suiteCountCards(summary: ReportSummary): CountCard[] {
  const { counts } = summary
  return [
    { key: 'total', label: 'Tests', value: counts.total },
    { key: 'passed', label: 'Passed', value: counts.passed },
    { key: 'failed', label: 'Failed', value: counts.failed },
    { key: 'skipped', label: 'Skipped', value: counts.skipped },
    { key: 'stopped', label: 'Stopped', value: counts.stopped },
    { key: 'excluded', label: 'Excluded', value: counts.excluded },
    { key: 'pending', label: 'Pending', value: counts.pending },
  ]
}

function blockCountCards(blocks: ReportTimelineBlock[]): CountCard[] {
  const counts = countBlocksByTile(blocks)
  return [
    {
      key: 'total',
      label: 'Total',
      value: Object.values(counts).reduce((sum, value) => sum + value, 0),
    },
    { key: 'passed', label: 'Passed', value: counts.passed },
    { key: 'failed', label: 'Failed', value: counts.failed },
    { key: 'warning', label: 'Warning', value: counts.warning },
    { key: 'skipped', label: 'Skipped', value: counts.skipped },
    { key: 'stopped', label: 'Stopped', value: counts.stopped },
  ]
}

function MetaField({ label, children }: Readonly<{ label: string; children: ReactNode }>) {
  return (
    <div className="min-w-0">
      <div className={FIELD_LABEL_CLASS}>{label}</div>
      <div className="mt-0.5 text-[13px] font-semibold">{children}</div>
    </div>
  )
}

export function ReportSummaryHeader({
  summary,
  execution,
  blocks,
  generatedAt,
}: Readonly<ReportSummaryHeaderProps>): ReactNode {
  const isTest = execution.entity_type === 'test'
  const cards = isTest ? blockCountCards(blocks) : suiteCountCards(summary)
  const heading = isTest ? 'Block Results' : 'Test Results'

  return (
    <div data-testid="report-summary">
      <dl className="m-0 grid grid-cols-3 gap-x-6 gap-y-3 rounded-[10px] border bg-muted/30 p-4">
        <MetaField label="Environment">{execution.environment ?? '-'}</MetaField>
        <MetaField label="Triggered By">{execution.triggered_by}</MetaField>
        <MetaField label="Started">
          <Timestamp value={execution.started_at} style="full" />
        </MetaField>
        <MetaField label="Duration">{formatDuration(summary.duration)}</MetaField>
        <MetaField label="Execution ID">
          <span className="font-mono text-xs">{execution.id}</span>
        </MetaField>
        <MetaField label="Ended">
          <Timestamp value={execution.ended_at} style="full" />
        </MetaField>
      </dl>
      <div className="mt-9">
        <h2 className="mb-3 flex items-center justify-between text-[15px] font-bold uppercase tracking-wider">
          {heading}
          <span
            data-testid="report-generated-at"
            className="text-xs font-normal normal-case tracking-normal text-muted-foreground"
          >
            Report generated <Timestamp value={generatedAt} style="full" />
          </span>
        </h2>
        <div className="flex flex-wrap gap-2.5">
          {cards.map((card) => (
            <div
              key={card.key}
              data-testid={`summary-count-${card.key}`}
              className="min-w-[88px] flex-1 rounded-[10px] border bg-background px-3.5 py-3"
            >
              <div
                className={`text-[22px] font-extrabold leading-tight tabular-nums ${
                  card.value === 0 ? 'text-muted-foreground' : COUNT_VALUE_COLORS[card.key]
                }`}
              >
                {card.value}
              </div>
              <div className={FIELD_LABEL_CLASS}>{card.label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
