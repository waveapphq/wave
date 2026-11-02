/**
 * Report viewer header actions (RVIEW-1): Download JSON + Export HTML.
 *
 * Export HTML runs the ensureReport orchestration for the html format,
 * disabling the button with an "Exporting…" label (plus progress when
 * known) while in flight; failures surface as an error toast carrying the
 * raw backend message.
 */

import { useCallback, useState, type ReactNode } from 'react'
import { Download, FileDown, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { ensureReport } from '@/features/reports/api/reports'
import { downloadReportArtifact } from '@/features/reports/api/download'

export interface ReportViewerActionsProps {
  executionId: string
  jsonArtifactId: string | null
}

export function ReportViewerActions({
  executionId,
  jsonArtifactId,
}: Readonly<ReportViewerActionsProps>): ReactNode {
  const { error: toastError } = useToast()
  const [exporting, setExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState<{
    processed: number
    total: number
  } | null>(null)

  const notifyFailure = useCallback(
    (error: unknown) => {
      toastError((error as Error).message)
    },
    [toastError],
  )

  const handleDownloadJson = useCallback(() => {
    void downloadReportArtifact(
      jsonArtifactId as string,
      `report-${executionId}.json`,
    ).catch(notifyFailure)
  }, [jsonArtifactId, executionId, notifyFailure])

  const handleExportHtml = useCallback((): void => {
    setExporting(true)
    setExportProgress(null)
    const run = async (): Promise<void> => {
      try {
        const { artifactId } = await ensureReport(executionId, 'html', {
          onProgress: setExportProgress,
        })
        await downloadReportArtifact(artifactId, `report-${executionId}.html`)
      } finally {
        setExporting(false)
        setExportProgress(null)
      }
    }
    run().catch(notifyFailure)
  }, [executionId, notifyFailure])

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        data-testid="download-json-btn"
        disabled={!jsonArtifactId}
        onClick={handleDownloadJson}
      >
        <Download className="mr-1.5 h-4 w-4" />
        Download JSON
      </Button>
      <Button
        variant="outline"
        size="sm"
        data-testid="export-html-btn"
        disabled={exporting}
        onClick={handleExportHtml}
      >
        {exporting ? (
          <>
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin motion-reduce:animate-none" />
            Exporting…
            {exportProgress && (
              <span className="ml-1.5 font-mono text-xs">
                {exportProgress.processed}/{exportProgress.total}
              </span>
            )}
          </>
        ) : (
          <>
            <FileDown className="mr-1.5 h-4 w-4" />
            Export HTML
          </>
        )}
      </Button>
    </>
  )
}
