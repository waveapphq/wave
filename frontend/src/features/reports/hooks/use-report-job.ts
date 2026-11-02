/**
 * Viewer-side report orchestration state machine.
 *
 * REQ-5.2.4.13: Reporting endpoints (generate-on-view orchestration)
 *
 * ensuring -> polling (first progress tick) -> fetching-artifact -> ready,
 * or error with the classified kind. Unmount flips the isCanceled flag so
 * ensureReport rejects with the swallowed 'canceled' kind.
 */

import { useCallback, useEffect, useState } from 'react'
import { ensureReport, fetchReportJson } from '@/features/reports/api/reports'
import type { ReportErrorKind } from '@/features/reports/api/reports'
import type { WaveReport } from '@/features/reports/api/types'

export type ReportViewStatus = 'ensuring' | 'polling' | 'fetching-artifact' | 'ready' | 'error'

export interface ReportJobProgressTick {
  processed: number
  total: number
}

export interface ReportViewError {
  kind: ReportErrorKind
  message: string
}

export interface UseReportJobResult {
  status: ReportViewStatus
  report: WaveReport | null
  artifactId: string | null
  progress: ReportJobProgressTick | null
  error: ReportViewError | null
  retry: () => void
}

export function useReportJob(executionId: string): UseReportJobResult {
  const [status, setStatus] = useState<ReportViewStatus>('ensuring')
  const [report, setReport] = useState<WaveReport | null>(null)
  const [artifactId, setArtifactId] = useState<string | null>(null)
  const [progress, setProgress] = useState<ReportJobProgressTick | null>(null)
  const [error, setError] = useState<ReportViewError | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let canceled = false
    setStatus('ensuring')
    setReport(null)
    setArtifactId(null)
    setProgress(null)
    setError(null)

    const run = async (): Promise<void> => {
      const ensured = await ensureReport(executionId, 'json', {
        onProgress: (tick) => {
          setStatus('polling')
          setProgress(tick)
        },
        isCanceled: () => canceled,
      })
      setStatus('fetching-artifact')
      setArtifactId(ensured.artifactId)
      let data: WaveReport
      try {
        data = await fetchReportJson(ensured.artifactId)
      } catch (fetchError) {
        throw Object.assign(fetchError as Error, { kind: 'artifact-fetch-failed' })
      }
      setReport(data)
      setStatus('ready')
    }
    // The viewer's own error state reports the failure; there is nothing to await.
    run().catch((runError: unknown) => {
      const kind = (runError as { kind: ReportErrorKind }).kind
      if (kind === 'canceled') return
      setError({ kind, message: (runError as Error).message })
      setStatus('error')
    })

    return () => {
      canceled = true
    }
  }, [executionId, attempt])

  const retry = useCallback(() => {
    setAttempt((current) => current + 1)
  }, [])

  return { status, report, artifactId, progress, error, retry }
}
