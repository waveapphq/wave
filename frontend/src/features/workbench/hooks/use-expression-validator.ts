/**
 * The expression parser load, shared by every surface that validates an
 * expression. The parser is an asset read like any other: when it fails, the
 * surface says so and shows its expressions as unchecked, because a validator
 * that never loaded returns no issues and no issues must never read as valid.
 */

import { useCallback, useEffect, useState } from 'react'

import { initializeTreeSitter, isInitialized } from '@/features/workbench/lib/tree-sitter-init'
import { toFailureDetail, type FailureDetail } from '@/lib/failure-detail'

export interface ExpressionValidator {
  /** True once the parser is loaded, so an empty issue list means valid. */
  ready: boolean
  /** Why the parser could not be loaded. Set means nothing is being checked. */
  failure: FailureDetail | null
  /** Loads the parser again. */
  retry: () => void
}

/** The one sentence every surface uses for an expression it could not check. */
export function notCheckedMessage(failure: FailureDetail): string {
  return `Not checked - could not load expression validation. ${failure.message}`
}

export function useExpressionValidator(active = true): ExpressionValidator {
  const [ready, setReady] = useState(isInitialized)
  const [failure, setFailure] = useState<FailureDetail | null>(null)

  const load = useCallback(() => {
    if (isInitialized()) {
      setReady(true)
      return
    }
    setFailure(null)
    initializeTreeSitter().then(
      () => {
        setReady(true)
      },
      (error_: unknown) => {
        setFailure(toFailureDetail(error_))
      },
    )
  }, [])

  useEffect(() => {
    if (active) load()
  }, [active, load])

  return { ready, failure, retry: load }
}
