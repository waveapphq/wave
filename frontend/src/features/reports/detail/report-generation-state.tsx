/**
 * Centered interstitial cards for the report viewer (RVIEW-10).
 *
 * Generating (spinner + progress + runs count), failed (Try Again + View
 * Execution), permanent no-artifacts failure (Back to Reports only), and
 * the 409 still-running card (View Execution + Back to Reports).
 */

import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertCircle, Clock, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'

export interface ReportGenerationStateProps {
  phase: 'starting' | 'generating' | 'fetching'
  progress: { processed: number; total: number } | null
  error: { kind: string; message: string } | null
  executionId: string
  onRetry: () => void
}

const PROGRESS_LABEL = 'Report progress'

function StateCard({ children }: Readonly<{ children: ReactNode }>): ReactNode {
  return (
    <div className="flex flex-1 items-center justify-center py-16">
      <Card
        data-testid="report-generation-state"
        className="flex w-[420px] flex-col items-center gap-4 p-8 text-center"
      >
        {children}
      </Card>
    </div>
  )
}

function ErrorCard({
  error,
  executionId,
  onRetry,
}: Readonly<{
  error: { kind: string; message: string }
  executionId: string
  onRetry: () => void
}>): ReactNode {
  const navigate = useNavigate()
  if (error.kind === 'execution-running') {
    return (
      <StateCard>
        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-warning/10 text-warning">
          <Clock className="h-6 w-6" aria-hidden="true" />
        </div>
        <div className="text-base font-semibold">Execution still in progress</div>
        <p className="text-sm text-muted-foreground">{error.message}</p>
        <div className="flex gap-2">
          <Button variant="default" size="sm" onClick={() => { navigate(`/executions/${executionId}`) }}>
            View Execution
          </Button>
          <Button variant="outline" size="sm" onClick={() => { navigate('/reports') }}>
            Back to Reports
          </Button>
        </div>
      </StateCard>
    )
  }
  const permanent = error.kind === 'no-artifacts'
  return (
    <StateCard>
      <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-error/10 text-error">
        <AlertCircle className="h-6 w-6" aria-hidden="true" />
      </div>
      <div className="text-base font-semibold">Report generation failed</div>
      <p className="text-sm text-muted-foreground">{error.message}</p>
      <div className="flex gap-2">
        {permanent ? (
          <Button variant="default" size="sm" onClick={() => { navigate('/reports') }}>
            Back to Reports
          </Button>
        ) : (
          <>
            <Button variant="default" size="sm" onClick={onRetry}>
              Try Again
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => { navigate(`/executions/${executionId}`) }}
            >
              View Execution
            </Button>
          </>
        )}
      </div>
    </StateCard>
  )
}

export function ReportGenerationState({
  phase,
  progress,
  error,
  executionId,
  onRetry,
}: Readonly<ReportGenerationStateProps>): ReactNode {
  if (error) {
    return <ErrorCard error={error} executionId={executionId} onRetry={onRetry} />
  }
  const fetching = phase === 'fetching'
  return (
    <StateCard>
      <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Loader2
          className="h-6 w-6 animate-spin motion-reduce:animate-none"
          aria-hidden="true"
        />
      </div>
      <div aria-live="polite">
        <div className="text-base font-semibold">
          {fetching ? 'Preparing report…' : 'Generating report…'}
        </div>
        {!fetching && (
          <div className="mt-1 text-sm text-muted-foreground">
            Building the report. This usually takes a few seconds.
          </div>
        )}
      </div>
      {progress ? (
        <Progress
          value={progress.processed}
          max={progress.total}
          aria-label={PROGRESS_LABEL}
          className="w-full"
        />
      ) : (
        <Progress value={fetching ? 100 : null} aria-label={PROGRESS_LABEL} className="w-full" />
      )}
      {progress && (
        <div className="text-sm text-muted-foreground">
          {progress.processed} of {progress.total} runs processed
        </div>
      )}
    </StateCard>
  )
}
