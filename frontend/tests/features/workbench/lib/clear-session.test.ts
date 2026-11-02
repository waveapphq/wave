/**
 * clearWorkbenchSession - a failed session clear is reported, and the caller
 * is told the session is still there so its next step can stop.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { clearWorkbenchSession } from '@/features/workbench/lib/clear-session'
import { workbenchApi } from '@/features/workbench/api/workbench'

vi.mock('@/features/workbench/api/workbench', () => ({
  workbenchApi: { clearSession: vi.fn() },
}))

const clearSession = vi.mocked(workbenchApi.clearSession)

describe('clearWorkbenchSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reports nothing and resolves true when the session is cleared', async () => {
    clearSession.mockResolvedValue({ cleared: true })
    const report = vi.fn()

    await expect(clearWorkbenchSession(report)).resolves.toBe(true)

    expect(clearSession).toHaveBeenCalledTimes(1)
    expect(report).not.toHaveBeenCalled()
  })

  it('reports the server reason and resolves false when the clear fails', async () => {
    clearSession.mockRejectedValue(new Error('Internal Server Error'))
    const report = vi.fn()

    await expect(clearWorkbenchSession(report)).resolves.toBe(false)

    expect(report).toHaveBeenCalledWith(
      'The workbench session is still open on the server: Internal Server Error',
      'Session Not Cleared',
    )
  })

  it('falls back to a generic reason when the failure carries no message', async () => {
    clearSession.mockRejectedValue({ status: 500 })
    const report = vi.fn()

    await expect(clearWorkbenchSession(report)).resolves.toBe(false)

    expect(report).toHaveBeenCalledWith(
      'The workbench session is still open on the server: Request failed',
      'Session Not Cleared',
    )
  })
})
