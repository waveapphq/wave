/**
 * listVisibility - what an entity list shows while it loads (LIST-6).
 *
 * Module: frontend/src/lib/list-visibility.ts
 *
 * One rule for every list: skeletons until the first read has finished, then
 * either the rows or the empty state, never both and never one before the
 * other. The trap it closes is that "not loading and no rows" is also true in
 * the moment before the first read has started, which flashes an empty state in
 * front of a list that turns out to be full. A list that already has rows keeps
 * them while a later read is out.
 */

import { describe, it, expect } from 'vitest'
import { listVisibility } from '@/lib/list-visibility'

describe('listVisibility - before the first read has finished', () => {
  it('shows the table with skeletons, whatever the debounced flag says', () => {
    expect(listVisibility(false, false, null, 0)).toEqual({
      busy: true,
      showEmpty: false,
      showTable: true,
    })
  })

  it('never calls the list empty on the strength of no rows yet', () => {
    expect(listVisibility(false, false, null, 0).showEmpty).toBe(false)
  })

  it('stays busy while the read is slow enough to have raised the flag', () => {
    expect(listVisibility(false, true, null, 0).busy).toBe(true)
  })
})

describe('listVisibility - once the first read has finished', () => {
  it('shows the empty state for a list with nothing in it', () => {
    expect(listVisibility(true, false, null, 0)).toEqual({
      busy: false,
      showEmpty: true,
      showTable: false,
    })
  })

  it('shows the rows for a list with something in it', () => {
    expect(listVisibility(true, false, null, 3)).toEqual({
      busy: false,
      showEmpty: false,
      showTable: true,
    })
  })

  it('keeps the rows while a later read is slow, so nothing open on one is lost', () => {
    expect(listVisibility(true, true, null, 3)).toEqual({
      busy: false,
      showEmpty: false,
      showTable: true,
    })
  })

  it('shows skeletons for a slow later read when there are no rows to hold', () => {
    expect(listVisibility(true, true, null, 0)).toEqual({
      busy: true,
      showEmpty: false,
      showTable: true,
    })
  })
})

describe('listVisibility - a read that failed', () => {
  it('shows neither the table nor the empty state, so the error stands alone', () => {
    expect(listVisibility(true, false, 'Failed to fetch', 0)).toEqual({
      busy: false,
      showEmpty: false,
      showTable: false,
    })
  })

  it('holds the table back even where rows from an earlier read are still around', () => {
    expect(listVisibility(true, false, 'Failed to fetch', 3).showTable).toBe(false)
  })
})
