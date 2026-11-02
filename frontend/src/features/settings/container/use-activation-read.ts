/**
 * useActivationRead - the first read of a staged Settings page: it runs when the
 * page turns active and holds no staged edits, and on retry.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { toFailureDetail } from '@/lib/failure-detail'

export type PageReadStatus = 'pending' | 'loaded' | 'failed'

export interface ActivationRead {
  status: PageReadStatus
  /** The API's reason when the read failed. */
  error?: string
  retry: () => void
}

/** `load` and `onLoaded` must be stable; a dirty page is never re-read, so its staged edits survive. */
export function useActivationRead<T>(
  active: boolean,
  dirty: boolean,
  load: () => Promise<T>,
  onLoaded: (value: T) => void,
): ActivationRead {
  const [status, setStatus] = useState<PageReadStatus>('pending')
  const [error, setError] = useState<string | undefined>()

  const read = useCallback(() => {
    setStatus('pending')
    setError(undefined)
    load().then(
      (value) => {
        onLoaded(value)
        setStatus('loaded')
      },
      (err: unknown) => {
        setError(toFailureDetail(err).message)
        setStatus('failed')
      },
    )
  }, [load, onLoaded])

  const dirtyRef = useRef(dirty)
  useEffect(() => {
    dirtyRef.current = dirty
  }, [dirty])

  // Value-transition ref, so a StrictMode double mount stays a single read.
  const wasActiveRef = useRef(false)
  useEffect(() => {
    if (active && !wasActiveRef.current && !dirtyRef.current) read()
    wasActiveRef.current = active
  }, [active, read])

  return { status, error, retry: read }
}
