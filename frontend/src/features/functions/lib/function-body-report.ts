/**
 * Where the three canvas gestures that read a Function's published body report
 * a failure. They are actions the user just triggered, not load steps, so the
 * report lands on the gesture rather than blocking the canvas behind it.
 */

import { toFailureDetail } from '@/lib/failure-detail'

export const FUNCTION_BODY_FAILED_TITLE = 'Could Not Load Function Body'

/** Names the server's own reason under one title, so all three read alike. */
export function reportFunctionBodyFailure(
  toastError: (message: string, title?: string) => void,
  error: unknown,
): void {
  toastError(toFailureDetail(error).message, FUNCTION_BODY_FAILED_TITLE)
}
