/**
 * Report viewer route component for /reports/:executionId (RVIEW-1, RVIEW-10).
 *
 * Drives useReportJob with the route's executionId - opening the viewer for
 * an execution without a JSON report auto-starts generation - and
 * switches between the generation/error interstitials and the ready
 * document (Summary, Timeline, Errors, Logs).
 */

import { useCallback, useMemo, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { FileBarChart } from 'lucide-react'
import { EntityTypeChip } from '@/components/shared/entity-type-chip'
import { ScrollArea } from '@/components/ui/scroll-area'
import { DetailHeader } from '@/components/shared/detail-header'
import {
  getStatusColor,
  getStatusDotColor,
  getStatusLabel,
} from '@/components/shared/tables/table-utils'
import { useReportJob, type ReportViewStatus } from '@/features/reports/hooks/use-report-job'
import { buildReportLogEntries } from '@/features/reports/lib/report-log-entries'
import { ReportSummaryHeader } from '@/features/reports/detail/report-summary-header'
import { ReportTimeline } from '@/features/reports/detail/report-timeline'
import { ReportErrorsTable } from '@/features/reports/detail/report-errors-table'
import { ReportLogsPanel } from '@/features/reports/detail/report-logs-panel'
import { ReportGenerationState } from '@/features/reports/detail/report-generation-state'
import { ReportViewerActions } from '@/features/reports/detail/report-viewer-actions'

function generationPhase(status: ReportViewStatus): 'starting' | 'generating' | 'fetching' {
  if (status === 'fetching-artifact') return 'fetching'
  if (status === 'ensuring') return 'starting'
  return 'generating'
}

export function ReportViewerPage(): ReactNode {
  const navigate = useNavigate()
  const { executionId } = useParams<{ executionId: string }>()
  const { status, report, artifactId, progress, error, retry } = useReportJob(
    executionId as string,
  )

  const logEntries = useMemo(() => (report ? buildReportLogEntries(report.logs) : []), [report])

  const handleBack = useCallback(() => {
    navigate('/reports')
  }, [navigate])

  const phase = generationPhase(status)

  return (
    <div data-testid="report-viewer-page" className="flex h-full flex-col">
      <DetailHeader
        name={report ? report.execution.name : 'Report'}
        onBack={handleBack}
        titleIcon={
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-success/10 text-success">
            <FileBarChart className="h-5 w-5" aria-hidden="true" />
          </div>
        }
        statusSlot={
          report ? (
            <span className="flex shrink-0 items-center gap-3">
              <EntityTypeChip type={report.execution.entity_type} />
              <span
                className={`flex items-center gap-1.5 text-sm font-semibold ${getStatusColor(
                  report.execution.status,
                )}`}
              >
                <span
                  className={`h-2 w-2 rounded-full ${getStatusDotColor(report.execution.status)}`}
                  aria-hidden="true"
                />
                {getStatusLabel(report.execution.status)}
              </span>
            </span>
          ) : undefined
        }
        actions={
          report ? (
            <ReportViewerActions executionId={executionId as string} jsonArtifactId={artifactId} />
          ) : undefined
        }
      />
      {report ? (
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-9 p-6">
            <ReportSummaryHeader
              summary={report.summary}
              execution={report.execution}
              blocks={report.timeline.blocks}
              generatedAt={report.generated_at}
            />
            <ReportTimeline
              runs={report.timeline.runs}
              blocks={report.timeline.blocks}
              entityType={report.execution.entity_type}
            />
            <ReportErrorsTable errors={report.errors} />
            <ReportLogsPanel entries={logEntries} />
          </div>
        </ScrollArea>
      ) : (
        <ReportGenerationState
          phase={phase}
          progress={progress}
          error={error}
          executionId={executionId as string}
          onRetry={retry}
        />
      )}
    </div>
  )
}
