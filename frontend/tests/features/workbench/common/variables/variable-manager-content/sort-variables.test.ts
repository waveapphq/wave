/**
 * Tests for the sortVariables pure-sort utility.
 *
 * The variable manager toolbar exposes three sort options: Name A-Z (default),
 * Name Z-A, and Type. The hook is a pure function: same input returns the
 * same logical ordering. The caller wraps it in useMemo, so the function
 * itself need not memoise.
 *
 * REQ-3.1.3.11: Variable watching UI panel
 */

import { describe, it, expect } from 'vitest'
import { sortVariables, type SortKey } from '@/features/workbench/common/variables/variable-manager-content/sort-variables'
import type { Variable } from '@/features/workbench/common/variables/variable-manager-content/types'

function makeVar(overrides: Partial<Variable> & { id: string; name: string }): Variable {
  return {
    value: '',
    type: 'string',
    ...overrides,
  }
}

describe('sortVariables', () => {
  describe('name-asc (default Name A-Z)', () => {
    it('sorts variables alphabetically by name', () => {
      const input = [
        makeVar({ id: '1', name: 'zebra' }),
        makeVar({ id: '2', name: 'alpha' }),
        makeVar({ id: '3', name: 'mike' }),
      ]
      const sorted: Variable[] = sortVariables(input, 'name-asc')
      expect(sorted.map((v: Variable) => v.name)).toEqual(['alpha', 'mike', 'zebra'])
    })

    it('is case-insensitive (uppercase and lowercase interleave naturally)', () => {
      const input = [
        makeVar({ id: '1', name: 'Bravo' }),
        makeVar({ id: '2', name: 'alpha' }),
        makeVar({ id: '3', name: 'Charlie' }),
      ]
      const sorted: Variable[] = sortVariables(input, 'name-asc')
      expect(sorted.map((v: Variable) => v.name)).toEqual(['alpha', 'Bravo', 'Charlie'])
    })
  })

  describe('name-desc (Name Z-A)', () => {
    it('sorts variables in reverse alphabetical order by name', () => {
      const input = [
        makeVar({ id: '1', name: 'alpha' }),
        makeVar({ id: '2', name: 'zebra' }),
        makeVar({ id: '3', name: 'mike' }),
      ]
      const sorted: Variable[] = sortVariables(input, 'name-desc')
      expect(sorted.map((v: Variable) => v.name)).toEqual(['zebra', 'mike', 'alpha'])
    })
  })

  describe('type', () => {
    it('groups variables by type alphabetically', () => {
      const input = [
        makeVar({ id: '1', name: 'a', type: 'string' }),
        makeVar({ id: '2', name: 'b', type: 'integer' }),
        makeVar({ id: '3', name: 'c', type: 'boolean' }),
        makeVar({ id: '4', name: 'd', type: 'integer' }),
      ]
      const sorted: Variable[] = sortVariables(input, 'type')
      const types = sorted.map((v: Variable) => v.type)
      // boolean before integer before string
      expect(types).toEqual(['boolean', 'integer', 'integer', 'string'])
    })

    it('sorts by name within the same type group (stable secondary order)', () => {
      const input = [
        makeVar({ id: '1', name: 'beta', type: 'string' }),
        makeVar({ id: '2', name: 'alpha', type: 'string' }),
        makeVar({ id: '3', name: 'gamma', type: 'integer' }),
      ]
      const sorted: Variable[] = sortVariables(input, 'type')
      // integers first, then strings; within strings, alpha before beta
      expect(sorted.map((v: Variable) => v.name)).toEqual(['gamma', 'alpha', 'beta'])
    })
  })

  describe('contract', () => {
    it('does not mutate the input array', () => {
      const input: Variable[] = [
        makeVar({ id: '1', name: 'zebra' }),
        makeVar({ id: '2', name: 'alpha' }),
      ]
      const inputBefore = input.map((v: Variable) => v.name)
      sortVariables(input, 'name-asc')
      expect(input.map((v: Variable) => v.name)).toEqual(inputBefore)
    })

    it('returns an empty array for empty input', () => {
      expect(sortVariables([], 'name-asc')).toEqual([])
      expect(sortVariables([], 'name-desc')).toEqual([])
      expect(sortVariables([], 'type')).toEqual([])
    })

    it('handles a single-element array for every sort key', () => {
      const single = [makeVar({ id: '1', name: 'only' })]
      const keys: SortKey[] = ['name-asc', 'name-desc', 'type']
      for (const key of keys) {
        const sorted = sortVariables(single, key)
        expect(sorted).toHaveLength(1)
        expect(sorted[0].name).toBe('only')
      }
    })
  })
})
