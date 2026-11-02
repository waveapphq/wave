/**
 * Pure variable-snapshot diff for the watch-mode / mirror variable pulse.
 *
 * changedVariableNames returns the names present in `next` whose value or
 * expression differs from `prev`, plus names newly added in `next`, in `next`
 * order. Names removed in `next` are never reported (nothing to pulse).
 */

import { sameStoredValue } from '@/lib/variable-format'

export interface VariableSnapshot {
  name: string
  value?: unknown
  expression?: string
}

export function changedVariableNames(
  prev: readonly VariableSnapshot[],
  next: readonly VariableSnapshot[],
): string[] {
  const prevByName = new Map(prev.map((variable) => [variable.name, variable]))
  const changed: string[] = []
  for (const variable of next) {
    const before = prevByName.get(variable.name)
    if (before === undefined) {
      changed.push(variable.name)
      continue
    }
    if (!sameStoredValue(before.value, variable.value) || before.expression !== variable.expression) {
      changed.push(variable.name)
    }
  }
  return changed
}
