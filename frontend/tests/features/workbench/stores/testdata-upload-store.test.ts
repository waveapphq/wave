/**
 * useTestDataUploadStore - what this tab is currently sending into a test's
 * Test Data (TDATA-16).
 *
 * Module: frontend/src/features/workbench/stores/testdata-upload-store.ts
 *
 * The store outlives the Test Data sheet, so the chip keeps spinning after the
 * sheet is closed, and it is keyed by test so one test's uploads never show up
 * on another's chip. A test with nothing in flight leaves no entry behind.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import {
  useOwnUploadIds,
  useTestDataUploadStore,
} from '@/features/workbench/stores/testdata-upload-store'

const TEST_ID = 'test-42'
const OTHER_TEST_ID = 'test-99'

function store() {
  return useTestDataUploadStore.getState()
}

beforeEach(() => {
  useTestDataUploadStore.setState({ inFlight: {} })
})

describe('useTestDataUploadStore', () => {
  it('holds nothing to begin with', () => {
    expect(store().inFlight).toEqual({})
  })

  it('records an upload under the test it belongs to', () => {
    store().begin(TEST_ID, 'up-1')

    expect(store().inFlight).toEqual({ [TEST_ID]: ['up-1'] })
  })

  it('keeps several uploads for one test', () => {
    store().begin(TEST_ID, 'up-1')
    store().begin(TEST_ID, 'up-2')

    expect(store().inFlight[TEST_ID]).toEqual(['up-1', 'up-2'])
  })

  it('keeps two tests apart', () => {
    store().begin(TEST_ID, 'up-1')
    store().begin(OTHER_TEST_ID, 'up-2')

    expect(store().inFlight).toEqual({ [TEST_ID]: ['up-1'], [OTHER_TEST_ID]: ['up-2'] })
  })

  it('drops one upload and keeps the rest', () => {
    store().begin(TEST_ID, 'up-1')
    store().begin(TEST_ID, 'up-2')

    store().end(TEST_ID, 'up-1')

    expect(store().inFlight[TEST_ID]).toEqual(['up-2'])
  })

  it('leaves no entry behind once the last upload is done', () => {
    store().begin(TEST_ID, 'up-1')

    store().end(TEST_ID, 'up-1')

    expect(store().inFlight).toEqual({})
  })

  it('ends an upload it never held without disturbing anything', () => {
    store().begin(TEST_ID, 'up-1')

    store().end(OTHER_TEST_ID, 'up-2')

    expect(store().inFlight).toEqual({ [TEST_ID]: ['up-1'] })
  })
})

describe('useOwnUploadIds', () => {
  it('reports the ids this tab is sending for one test', () => {
    store().begin(TEST_ID, 'up-1')

    const { result } = renderHook(() => useOwnUploadIds(TEST_ID))

    expect(result.current).toEqual(['up-1'])
  })

  it('reports the same empty array for a test with nothing in flight', () => {
    const first = renderHook(() => useOwnUploadIds(TEST_ID))
    const second = renderHook(() => useOwnUploadIds(OTHER_TEST_ID))

    expect(first.result.current).toBe(second.result.current)
    expect(first.result.current).toEqual([])
  })

  it('reports nothing for a test that was never saved', () => {
    store().begin(TEST_ID, 'up-1')

    const { result } = renderHook(() => useOwnUploadIds(null))

    expect(result.current).toEqual([])
  })
})
