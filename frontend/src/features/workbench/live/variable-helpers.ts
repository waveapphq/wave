/**
 * Variable Helpers - Shared utilities for variable conversion
 *
 * Used by both test loading and test fixing to convert backend variable formats
 * to the frontend WorkflowVariable format.
 */

import type { WorkflowVariable, NamespaceEntry } from '@/features/workbench/stores/workflow-store'
import { canvasVariable, newVariableId } from '@/features/workbench/lib/canonical-workflow'

/** Convert a Test's stored variables (keyed by name) to canvas variables. */
export function convertBackendVariables(
  variables: Record<string, { type: string; value?: unknown; isExpression?: boolean; isTemplate?: boolean; secret?: boolean; [key: string]: unknown }>,
  makeId: (name: string) => string = newVariableId,
): WorkflowVariable[] {
  return Object.entries(variables).map(([name, varData]) =>
    canvasVariable(makeId(name), name, varData),
  )
}

/**
 * Convert system variables from API format to NamespaceEntry format.
 * Returns lightweight entries for autocomplete (no values, no scope).
 */
export function convertSystemVariables(
  systemVars: Record<string, { type: string; value: unknown; secret?: boolean }>,
): NamespaceEntry[] {
  return Object.entries(systemVars)
    .map(([name, varData]) => ({
      name,
      type: varData.type,
    }))
}

/**
 * Convert suite variables from API format to NamespaceEntry format.
 * Returns lightweight entries for autocomplete (no values, no scope).
 */
export function convertSuiteVariables(
  suiteVars: Record<string, { type: string; value: unknown; secret?: boolean }>,
): NamespaceEntry[] {
  return Object.entries(suiteVars)
    .map(([name, varData]) => ({
      name,
      type: varData.type,
    }))
}

/**
 * Merge namespace entries from multiple suites into a single list.
 * When the same variable (name + type) exists in multiple suites,
 * the sources array tracks which suites contribute it.
 */
export function mergeSuiteNamespaceEntries(
  suitesData: Array<{ suiteId: string; suiteName: string; entries: NamespaceEntry[] }>
): NamespaceEntry[] {
  if (suitesData.length === 0) return []
  const byKey = new Map<string, NamespaceEntry>()
  for (const { suiteName, entries } of suitesData) {
    for (const entry of entries) {
      const key = `${entry.name}:${entry.type}`
      const existing = byKey.get(key)
      if (existing) {
        if (!existing.sources!.includes(suiteName)) {
          existing.sources = [...existing.sources!, suiteName]
        }
      } else {
        byKey.set(key, { name: entry.name, type: entry.type, sources: [suiteName] })
      }
    }
  }
  return [...byKey.values()]
}

/** Entry for expression autocomplete namespace completions. */
export interface NamespaceDottedEntry {
  name: string
  type: string
  source: string
  /** Only the bare root carries it; pickers drop those, autocomplete keeps them. */
  isNamespaceRoot?: boolean
}

/**
 * Create dotted namespace entries for expression autocomplete.
 *
 * Given namespace entries like [{name: "timeout", type: "integer"}],
 * produces:
 * - A top-level namespace entry: {name: "system", type: "object", source: "System Variables"}
 * - Dotted field entries: {name: "system.timeout", type: "integer", source: "System Variables"}
 *
 * @param vars - Variables belonging to this namespace
 * @param namespace - Namespace prefix ("system", "suite", "regression")
 * @param description - Human-readable name (e.g., "Auth Suite") for suite/regression
 */
export function createNamespaceDottedEntries(
  vars: Pick<NamespaceEntry, 'name' | 'type'>[],
  namespace: string,
  description?: string,
): NamespaceDottedEntry[] {
  if (vars.length === 0) return []

  let sourceLabel: string
  if (namespace === 'system') {
    sourceLabel = 'System Variables'
  } else if (namespace === 'suite') {
    sourceLabel = 'Suite'
  } else {
    sourceLabel = description ? `Regression: ${description}` : 'Regression'
  }

  const result: NamespaceDottedEntry[] = []

  // Top-level namespace entry (e.g., "system" as object)
  result.push({
    name: namespace,
    type: 'object',
    source: sourceLabel,
    isNamespaceRoot: true,
  })

  // Dotted entries for each variable (e.g., "system.timeout")
  for (const v of vars) {
    result.push({
      name: `${namespace}.${v.name}`,
      type: v.type,
      source: sourceLabel,
    })
  }

  return result
}
