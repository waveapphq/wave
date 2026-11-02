/**
 * One reading of a settled batch of writes: nothing when every call landed,
 * otherwise the first reason, prefixed by what did land when only some failed.
 */

import { toFailureDetail } from '@/lib/failure-detail'

/** Says what did land, e.g. "2 of 5 artifacts were removed." */
export type LandedSentence = (succeeded: number, total: number) => string

/** What to report, or null when every call in the batch succeeded. */
export function bulkFailureMessage(
  results: readonly PromiseSettledResult<unknown>[],
  landed: LandedSentence,
): string | null {
  const failures = results.filter(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  )
  if (failures.length === 0) {
    return null
  }
  const reason = toFailureDetail(failures[0].reason).message
  if (failures.length === results.length) {
    return reason
  }
  return `${landed(results.length - failures.length, results.length)} The rest failed: ${reason}`
}
