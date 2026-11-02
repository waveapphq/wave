/**
 * buildFilterParams Utility Tests
 *
 * Tests for the shared URL params builder for table filter hooks.
 *
 * Utility: frontend/src/components/shared/tables/table-utils.tsx
 */

import { describe, it, expect } from 'vitest'
import { buildFilterParams } from '@/components/shared/tables/table-utils'

describe('buildFilterParams', () => {
  it('sets string filter values when truthy', () => {
    const params = buildFilterParams({ search: 'hello', type: 'sql' }, 25)
    expect(params.get('search')).toBe('hello')
    expect(params.get('type')).toBe('sql')
  })

  it('skips string filter values when empty', () => {
    const params = buildFilterParams({ search: '', type: '' }, 25)
    expect(params.has('search')).toBe(false)
    expect(params.has('type')).toBe(false)
  })

  it('joins array filter values with commas when non-empty', () => {
    const params = buildFilterParams({ tags: ['a', 'b', 'c'] }, 25)
    expect(params.get('tags')).toBe('a,b,c')
  })

  it('skips array filter values when empty', () => {
    const params = buildFilterParams({ status: [] }, 25)
    expect(params.has('status')).toBe(false)
  })

  it('always sets page to 1', () => {
    const params = buildFilterParams({}, 25)
    expect(params.get('page')).toBe('1')
  })

  it('always sets pageSize from argument', () => {
    const params = buildFilterParams({}, 50)
    expect(params.get('pageSize')).toBe('50')
  })

  it('handles mixed string and array filters', () => {
    const params = buildFilterParams(
      { search: 'test', status: ['passed', 'failed'], suiteIds: [], tags: ['api'] },
      10,
    )
    expect(params.get('search')).toBe('test')
    expect(params.get('status')).toBe('passed,failed')
    expect(params.has('suiteIds')).toBe(false)
    expect(params.get('tags')).toBe('api')
    expect(params.get('page')).toBe('1')
    expect(params.get('pageSize')).toBe('10')
  })

  it('ignores non-string non-array values', () => {
    // Defensive check - buildFilterParams only processes string/array
    const params = buildFilterParams({ count: 42 }, 25)
    expect(params.has('count')).toBe(false)
  })
})
