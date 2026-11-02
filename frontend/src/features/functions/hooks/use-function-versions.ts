/**
 * Hook that fetches the published version list for a Function.
 *
 * Used by the Function instance config modal to render the version dropdown
 * with per-row publish dates + latest chip. Re-fetches whenever the
 * ``functionId`` prop changes; the caller can supply a ``refreshKey`` to
 * trigger a re-fetch after a publish/delete-version event.
 *
 * A failed read never empties the list: only an answered read says a Function
 * has no published versions. A Function the library no longer holds is one of
 * those answers, and it is what the missing-function banner is built on.
 */

import { useCallback, useEffect, useState } from 'react'

import { isFunctionAbsent, listFunctionVersions } from '@/features/functions/api/functions-api'
import type { VersionDescriptor } from '@/features/functions/api/types'
import { startBlockingRead, type ReportFailedRead } from '@/hooks/use-blocking-reads'
import { usePageBlock } from '@/hooks/use-page-block'

export interface UseFunctionVersionsResult {
  versions: VersionDescriptor[]
  latest: string
  isLoading: boolean
  /** The read failed: an empty list is NOT an answer. */
  failed: boolean
  /** Runs the read again. */
  retry: () => void
}

const VERSIONS_LABEL = 'Function versions'

/** Callers that report the failure themselves take no page block. */
const NO_REPORT: ReportFailedRead = () => {}

/** `blocking` suits a caller inside route content that owns no error state of
 *  its own; a dialog reports `failed` where the user is looking instead. */
export function useFunctionVersions(
  functionId: string,
  refreshKey: unknown = null,
  blocking = false,
): UseFunctionVersionsResult {
  const [state, setState] = useState({
    versions: [] as VersionDescriptor[],
    latest: '',
    isLoading: true,
    failed: false,
  })
  const [attempt, setAttempt] = useState(0)
  const { blockPage, clearPageBlock } = usePageBlock()

  useEffect(() => {
    if (!functionId) {
      setState({ versions: [], latest: '', isLoading: false, failed: false })
      return
    }
    let canceled = false
    setState((prev) => ({ ...prev, isLoading: true, failed: false }))
    startBlockingRead(
      {
        label: VERSIONS_LABEL,
        canceled: () => canceled,
        run: async () => {
          try {
            const result = await listFunctionVersions(functionId)
            if (canceled) return
            setState({
              versions: result.versions,
              latest: result.latest,
              isLoading: false,
              failed: false,
            })
            clearPageBlock(VERSIONS_LABEL)
          } catch (error_) {
            if (canceled) throw error_
            if (isFunctionAbsent(error_)) {
              setState({ versions: [], latest: '', isLoading: false, failed: false })
              clearPageBlock(VERSIONS_LABEL)
              return
            }
            setState((prev) => ({ ...prev, isLoading: false, failed: true }))
            throw error_
          }
        },
      },
      blocking ? blockPage : NO_REPORT,
    )
    return () => {
      canceled = true
    }
  }, [functionId, refreshKey, attempt, blocking, blockPage, clearPageBlock])

  const retry = useCallback(() => setAttempt((previous) => previous + 1), [])

  return { ...state, retry }
}
