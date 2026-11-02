/**
 * Shared block-name search.
 *
 * One substring matcher for both search surfaces: typing "as" in Quick Insert
 * matches names that contain "as", never a name with an "a" followed later by
 * an "s".
 */

import { describe, it, expect } from 'vitest'

import { filterByBlockQuery, matchesBlockQuery } from '@/features/workbench/lib/block-search'

/** Representative catalog in catalog order: plugins first, then controls. */
const CATALOG: ReadonlyArray<{ id: string; name: string }> = [
  { id: 'http-client', name: 'HTTP' },
  { id: 'shell-script', name: 'Shell Script' },
  { id: 'k8s-delete', name: 'K8s Delete' },
  { id: 'sql-query', name: 'SQL Query' },
  { id: 'assert', name: 'Assert' },
  { id: 'delay', name: 'Delay' },
  { id: 'fail', name: 'Fail Test' },
  { id: 'variable-setter', name: 'Variable Setter' },
  { id: 'wait-until', name: 'Wait Until' },
]

function names(items: ReadonlyArray<{ name: string }>): string[] {
  return items.map((item) => item.name)
}

describe('matchesBlockQuery', () => {
  it('matches a substring of the name', () => {
    expect(matchesBlockQuery('Shell Script', 'shell')).toBe(true)
    expect(matchesBlockQuery('Assert', 'as')).toBe(true)
  })

  it('rejects a scattered subsequence that is not a substring', () => {
    expect(matchesBlockQuery('Fail Test', 'as')).toBe(false)
    expect(matchesBlockQuery('Variable Setter', 'as')).toBe(false)
  })

  it('is case insensitive in both directions', () => {
    expect(matchesBlockQuery('Shell Script', 'SHELL')).toBe(true)
    expect(matchesBlockQuery('SHELL SCRIPT', 'shell')).toBe(true)
  })

  it('matches everything for an empty or whitespace-only query', () => {
    expect(matchesBlockQuery('Shell Script', '')).toBe(true)
    expect(matchesBlockQuery('Shell Script', '   ')).toBe(true)
  })

  it('ignores surrounding whitespace in the query', () => {
    expect(matchesBlockQuery('HTTP', '  http  ')).toBe(true)
  })

  it('matches a query spanning a space inside the name', () => {
    expect(matchesBlockQuery('SQL Query', 'l que')).toBe(true)
  })

  it('does not match when the text is absent', () => {
    expect(matchesBlockQuery('Shell Script', 'zzz')).toBe(false)
  })
})

describe('filterByBlockQuery', () => {
  it('returns exactly the two matching names, a plugin before a control', () => {
    expect(names(filterByBlockQuery(CATALOG, 'del'))).toEqual(['K8s Delete', 'Delay'])
  })

  it('keeps catalog order among the matches', () => {
    expect(names(filterByBlockQuery(CATALOG, 'a'))).toEqual([
      'Assert',
      'Delay',
      'Fail Test',
      'Variable Setter',
      'Wait Until',
    ])
  })

  it('returns every item unchanged for an empty query', () => {
    expect(filterByBlockQuery(CATALOG, '')).toEqual([...CATALOG])
  })

  it('returns every item for a whitespace-only query', () => {
    expect(names(filterByBlockQuery(CATALOG, '  '))).toEqual(names(CATALOG))
  })

  it('returns nothing when no name contains the query', () => {
    expect(filterByBlockQuery(CATALOG, 'zzzznothing')).toEqual([])
  })

  it('is case insensitive', () => {
    expect(names(filterByBlockQuery(CATALOG, 'SHELL SCRIPT'))).toEqual(['Shell Script'])
  })

  it('does not mutate the input', () => {
    const original = [...CATALOG]
    filterByBlockQuery(CATALOG, 'as')
    expect(CATALOG).toEqual(original)
  })
})
