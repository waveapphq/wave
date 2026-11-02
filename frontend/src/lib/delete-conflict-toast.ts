/**
 * Shared helper that turns a 409 ACTIVE_EXECUTIONS API error from any entity
 * delete call (test / suite / regression) into the standard destructive toast
 * with a "View execution" action. Keeps the 409 UX identical across surfaces.
 */

import type { ApiError } from '@/services/api-client/types'
import type { ToastOptions } from '@/lib/toast-options'

export type DeleteEntityType = 'test' | 'suite' | 'regression'

interface ToastLike {
  toast: (options: ToastOptions) => void
}

// Matches react-router v7 NavigateFunction shape without importing it so this
// module stays free of router coupling. The `unknown` return covers both the
// synchronous and promise-returning overloads.
type NavigateLike = (path: string) => unknown

interface HandleDeleteConflictOptions {
  error: unknown
  entityType: DeleteEntityType
  toast: ToastLike
  navigate: NavigateLike
}

function extractExecutionIds(error: ApiError): string[] | null {
  const rawDetails = (error as unknown as { details?: unknown }).details
  if (!rawDetails || typeof rawDetails !== 'object' || Array.isArray(rawDetails)) {
    return null
  }
  const ids = (rawDetails as Record<string, unknown>).execution_ids
  if (!Array.isArray(ids)) return null
  const filtered = ids.filter((v): v is string => typeof v === 'string' && v.length > 0)
  return filtered.length > 0 ? filtered : null
}

/**
 * Returns true when the given error was a 409 ACTIVE_EXECUTIONS response and a
 * destructive toast with a "View execution" link was shown. Callers can use
 * the return to decide whether further error handling is needed.
 */
export function handleDeleteConflict(options: HandleDeleteConflictOptions): boolean {
  const { error, entityType, toast, navigate } = options
  const apiErr = error as ApiError | undefined
  if (apiErr?.status !== 409 || apiErr?.code !== 'CONFLICT') return false

  const executionIds = extractExecutionIds(apiErr)
  if (!executionIds) return false

  const firstId = executionIds[0]
  toast.toast({
    variant: 'error',
    title: `Cannot delete ${entityType}`,
    message: `Execution ${firstId} is still running. Stop it and try again.`,
    action: {
      label: 'View execution',
      onClick: () => {
        navigate(`/executions/${firstId}`)
      },
    },
  })
  return true
}
