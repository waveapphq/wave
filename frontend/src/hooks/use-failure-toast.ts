import { useCallback } from 'react'
import { useToast } from '@/components/ui/toast'
import { toFailureDetail } from '@/lib/failure-detail'

export interface FailureToast {
  report: (err: unknown) => void
  run: <A extends unknown[]>(action: (...args: A) => Promise<unknown>) => (...args: A) => void
}

/** One toast-reporting catch for gestures whose props cannot carry a rejection. */
export function useFailureToast(title: string): FailureToast {
  const { error: toastError } = useToast()

  const report = useCallback(
    (err: unknown) => {
      toastError(toFailureDetail(err).message, title)
    },
    [toastError, title]
  )

  const run = useCallback(
    <A extends unknown[]>(action: (...args: A) => Promise<unknown>) =>
      (...args: A): void => {
        action(...args).catch(report)
      },
    [report]
  )

  return { report, run }
}
