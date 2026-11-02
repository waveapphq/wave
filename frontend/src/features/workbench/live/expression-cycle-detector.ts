/**
 * Cycle detection for computed-variable expressions.
 *
 * Variable saves are local Zustand mutations and never call the backend
 * directly; the backend cycle check at `set_entity_variables` only fires
 * at test-save time. This module mirrors the backend logic so the scalar
 * variable edit dialog can surface the same error message inline at
 * dialog-save time, before the user discovers the cycle at test save or
 * runtime. The backend remains the source of truth and validates again
 * when the test is saved.
 *
 * Message format matches the backend contract anchored in
 * `backend/wavecore/api/services/variable_service.py::_validate_no_cycles_for_payload`:
 *
 *     Circular reference detected for variable '<name>': <a> -> ... -> <a>
 *
 * The cycle path is normalized to start at the lexicographically smallest
 * variable in the cycle so the message is deterministic.
 */

import { PYTHON_KEYWORD_SET } from '@/features/workbench/lib/python-builtins'
import { EXPRESSION_SAFE_NAMES } from '@/features/workbench/lib/expression-sandbox'

export interface VariableLike {
  name: string
  value?: unknown
  isExpression?: boolean
}

function extractIdentifiers(expression: string): string[] {
  const matches = expression.match(/\b([a-zA-Z_]\w*)\b/g)
  if (!matches) return []
  return matches.filter(
    (id) => !EXPRESSION_SAFE_NAMES.has(id) && !PYTHON_KEYWORD_SET.has(id),
  )
}

function buildDependencies(
  variables: ReadonlyArray<VariableLike>,
): Map<string, Set<string>> {
  const computed = new Set<string>()
  for (const v of variables) {
    if (v.isExpression && typeof v.value === 'string') {
      computed.add(v.name)
    }
  }
  const deps = new Map<string, Set<string>>()
  for (const v of variables) {
    if (!v.isExpression || typeof v.value !== 'string') continue
    const refs = extractIdentifiers(v.value)
    deps.set(v.name, new Set(refs.filter((r) => computed.has(r))))
  }
  return deps
}

function dfsCycle(
  node: string,
  deps: Map<string, Set<string>>,
  visited: Set<string>,
  recStack: Set<string>,
  path: string[],
): string[] | null {
  visited.add(node)
  recStack.add(node)
  path.push(node)
  // deps.get(node) is always defined: dfsCycle is only called with nodes
  // that are keys in the deps map (the outer findCycle loops over deps.keys
  // and recursive calls only descend into neighbors that buildDependencies
  // already filtered to computed-var names, all of which are deps keys).
  const neighbors = deps.get(node) as Set<string>
  for (const neighbor of neighbors) {
    if (!visited.has(neighbor)) {
      const found = dfsCycle(neighbor, deps, visited, recStack, [...path])
      if (found) return found
    } else if (recStack.has(neighbor)) {
      const cycleStart = path.indexOf(neighbor)
      return [...path.slice(cycleStart), neighbor]
    }
  }
  recStack.delete(node)
  return null
}

function findCycle(deps: Map<string, Set<string>>): string[] | null {
  const visited = new Set<string>()
  const recStack = new Set<string>()
  for (const node of deps.keys()) {
    if (visited.has(node)) continue
    const cycle = dfsCycle(node, deps, visited, recStack, [])
    if (cycle) return cycle
  }
  return null
}

function normalizeCycle(cycle: string[]): string[] {
  // Cycle is [v0, v1, ..., vN, v0] with the start repeated at the end.
  // Rotate so the lexicographically smallest variable is first.
  const nodes = cycle.slice(0, -1)
  let minIdx = 0
  for (let i = 1; i < nodes.length; i++) {
    if (nodes[i] < nodes[minIdx]) minIdx = i
  }
  const rotated = [...nodes.slice(minIdx), ...nodes.slice(0, minIdx)]
  return [...rotated, rotated[0]]
}

/**
 * Detect a circular reference among the given variables. Returns the same
 * error message format as the backend, or null if no cycle exists.
 */
export function detectExpressionCycle(
  variables: ReadonlyArray<VariableLike>,
): string | null {
  const deps = buildDependencies(variables)
  if (deps.size === 0) return null
  const cycle = findCycle(deps)
  if (!cycle) return null
  const normalized = normalizeCycle(cycle)
  const varName = normalized[0]
  const pathStr = normalized.join(' -> ')
  return `Circular reference detected for variable '${varName}': ${pathStr}`
}
