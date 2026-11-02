/**
 * Clearing the backend workbench session. The failure is reported where the
 * user is looking, and the caller learns the session is still there so a
 * gesture that depended on the clear can stop instead of presenting as done.
 */

import { workbenchApi } from '@/features/workbench/api/workbench'
import { toFailureDetail } from '@/lib/failure-detail'

/** Reports a failure to the user; the toast handle's `error` satisfies it. */
export type ReportSessionFailure = (message: string, title?: string) => void

const SESSION_FAILURE_TITLE = 'Session Not Cleared'

/** Resolves true when the session is gone, false when it is still there. */
export async function clearWorkbenchSession(report: ReportSessionFailure): Promise<boolean> {
  try {
    await workbenchApi.clearSession()
    return true
  } catch (err) {
    report(
      `The workbench session is still open on the server: ${toFailureDetail(err).message}`,
      SESSION_FAILURE_TITLE,
    )
    return false
  }
}
