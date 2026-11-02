/**
 * The shared "Test not found" sink.
 *
 * Load, run and save all meet the same 404 on the open test. One reporter
 * decides whether a failure is that state, so no surface has to re-derive it.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  reportTestNotFound,
  useDeletedTestStore,
} from '@/features/workbench/stores/deleted-test-store'

describe('deleted test store', () => {
  beforeEach(() => {
    useDeletedTestStore.getState().clear()
  })

  it('starts with no dialog raised', () => {
    expect(useDeletedTestStore.getState().info).toBeNull()
  })

  it('raises the dialog for a 404 and says it took the failure', () => {
    const taken = reportTestNotFound({ status: 404 }, { testId: 't1', testName: 'Payment smoke' })

    expect(taken).toBe(true)
    expect(useDeletedTestStore.getState().info).toEqual({
      testId: 't1',
      testName: 'Payment smoke',
    })
  })

  it('leaves every other status to the caller', () => {
    expect(reportTestNotFound({ status: 500 }, { testId: 't1', testName: null })).toBe(false)
    expect(useDeletedTestStore.getState().info).toBeNull()
  })

  it('leaves a failure with no status to the caller', () => {
    expect(reportTestNotFound(new Error('offline'), { testId: 't1', testName: null })).toBe(false)
    expect(useDeletedTestStore.getState().info).toBeNull()
  })

  it('leaves a rejection with no error object at all to the caller', () => {
    expect(reportTestNotFound(undefined, { testId: 't1', testName: null })).toBe(false)
    expect(useDeletedTestStore.getState().info).toBeNull()
  })

  it('clears what it raised', () => {
    reportTestNotFound({ status: 404 }, { testId: 't1', testName: null })

    useDeletedTestStore.getState().clear()

    expect(useDeletedTestStore.getState().info).toBeNull()
  })
})
