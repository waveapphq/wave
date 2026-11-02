/**
 * Variable sort utility.
 *
 * Pure sort function for the Variable Manager toolbar's sort dropdown.
 * The caller wraps the result in ``useMemo``, so the function itself
 * is stateless. Named without the ``use`` prefix so SonarQube's React
 * Hooks heuristic does not flag downstream callers that invoke it
 * inside a memoisation callback.
 *
 * REQ-3.1.3.11: Variable watching UI panel
 */

import type { Variable } from './types'

export type SortKey = 'name-asc' | 'name-desc' | 'type'

function compareNames(a: Variable, b: Variable): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
}

function compareNamesDesc(a: Variable, b: Variable): number {
  return -compareNames(a, b)
}

function compareByTypeThenName(a: Variable, b: Variable): number {
  const byType = a.type.localeCompare(b.type)
  if (byType !== 0) return byType
  return compareNames(a, b)
}

export function sortVariables(
  variables: ReadonlyArray<Variable>,
  sortKey: SortKey,
): Variable[] {
  if (variables.length === 0) return []
  const copy = variables.slice()
  switch (sortKey) {
    case 'name-asc':
      return copy.sort(compareNames)
    case 'name-desc':
      return copy.sort(compareNamesDesc)
    case 'type':
      return copy.sort(compareByTypeThenName)
  }
}
