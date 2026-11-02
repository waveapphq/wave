/**
 * delete-conflict-toast tests
 *
 * Shared helper that turns a 409 ACTIVE_EXECUTIONS API error returned from any
 * entity delete call (test / suite / regression) into the standard destructive
 * toast with a "View execution" action. Consumed by the three entity delete
 * flows so the UX stays identical across them.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ApiError } from '@/services/api-client/types'
import { handleDeleteConflict } from '@/lib/delete-conflict-toast'

function makeConflictError(executionIds: string[] | undefined): ApiError {
  // Runtime shape mirrors the backend envelope { error: { code, message, details } }
  // surfaced by parseErrorResponse + createApiError in services/api-client.
  const err = new Error('Cannot delete: execution is running') as ApiError
  err.type = 'client'
  err.status = 409
  err.code = 'CONFLICT'
  err.isRetryable = false
  if (executionIds !== undefined) {
    // Shape-cast: backend returns details as a dict; the ApiError type declares
    // it as Array<Record<string, unknown>> but the plumbing just copies through.
    ;(err as unknown as { details: Record<string, unknown> }).details = {
      execution_ids: executionIds,
    }
  }
  return err
}

describe('handleDeleteConflict', () => {
  let toastFn: ReturnType<typeof vi.fn>
  let navigate: ReturnType<typeof vi.fn>

  beforeEach(() => {
    toastFn = vi.fn()
    navigate = vi.fn()
  })

  it('returns false for non-ApiError input (generic Error)', () => {
    const handled = handleDeleteConflict({
      error: new Error('network exploded'),
      entityType: 'test',
      toast: { toast: toastFn },
      navigate,
    })
    expect(handled).toBe(false)
    expect(toastFn).not.toHaveBeenCalled()
  })

  it('returns false for ApiError with status other than 409', () => {
    const err = new Error('not found') as ApiError
    err.type = 'not_found'
    err.status = 404
    err.isRetryable = false

    const handled = handleDeleteConflict({
      error: err,
      entityType: 'test',
      toast: { toast: toastFn },
      navigate,
    })
    expect(handled).toBe(false)
    expect(toastFn).not.toHaveBeenCalled()
  })

  it('returns false for 409 without execution_ids details', () => {
    const handled = handleDeleteConflict({
      error: makeConflictError(undefined),
      entityType: 'test',
      toast: { toast: toastFn },
      navigate,
    })
    expect(handled).toBe(false)
    expect(toastFn).not.toHaveBeenCalled()
  })

  it('returns false for 409 where execution_ids is not an array', () => {
    const err = new Error('Cannot delete') as ApiError
    err.type = 'client'
    err.status = 409
    err.code = 'CONFLICT'
    err.isRetryable = false
    ;(err as unknown as { details: Record<string, unknown> }).details = {
      execution_ids: 'not-an-array',
    }

    const handled = handleDeleteConflict({
      error: err,
      entityType: 'test',
      toast: { toast: toastFn },
      navigate,
    })
    expect(handled).toBe(false)
    expect(toastFn).not.toHaveBeenCalled()
  })

  it('returns false for 409 with empty execution_ids array', () => {
    const handled = handleDeleteConflict({
      error: makeConflictError([]),
      entityType: 'test',
      toast: { toast: toastFn },
      navigate,
    })
    expect(handled).toBe(false)
    expect(toastFn).not.toHaveBeenCalled()
  })

  it('shows destructive toast with execution id for test delete', () => {
    const handled = handleDeleteConflict({
      error: makeConflictError(['exec-abc']),
      entityType: 'test',
      toast: { toast: toastFn },
      navigate,
    })

    expect(handled).toBe(true)
    expect(toastFn).toHaveBeenCalledTimes(1)
    const opts = toastFn.mock.calls[0][0]
    expect(opts.variant).toBe('error')
    expect(opts.title).toBe('Cannot delete test')
    expect(opts.message).toContain('exec-abc')
    expect(opts.action.label).toBe('View execution')
  })

  it('renders entity-specific title for suite', () => {
    handleDeleteConflict({
      error: makeConflictError(['exec-1']),
      entityType: 'suite',
      toast: { toast: toastFn },
      navigate,
    })
    expect(toastFn.mock.calls[0][0].title).toBe('Cannot delete suite')
  })

  it('renders entity-specific title for regression', () => {
    handleDeleteConflict({
      error: makeConflictError(['exec-1']),
      entityType: 'regression',
      toast: { toast: toastFn },
      navigate,
    })
    expect(toastFn.mock.calls[0][0].title).toBe('Cannot delete regression')
  })

  it('action navigates to /executions/{first id} on click', () => {
    handleDeleteConflict({
      error: makeConflictError(['exec-first', 'exec-second']),
      entityType: 'regression',
      toast: { toast: toastFn },
      navigate,
    })
    const action = toastFn.mock.calls[0][0].action as {
      label: string
      onClick: () => void
    }
    action.onClick()
    expect(navigate).toHaveBeenCalledWith('/executions/exec-first')
  })
})
