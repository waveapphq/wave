/**
 * useEnrichedVariables - Variables enrichment hook
 *
 * Fetches variables from the workflow store, enriches them with output
 * source info, and merges in profile-bound alias/field variables for autocomplete.
 *
 * Inside a drilled-in Function the visible names are the Function scope's own
 * (inputs, outputs, locals, profile aliases): external scopes are not
 * addressable from inside the Function.
 */

import { useMemo } from 'react'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import {
  functionScopeNames,
  functionScopeRows,
  type ManagerRow,
  type ScopeBody,
  type ScopeName,
} from '@/features/workbench/lib/function-scope-rows'
import { createNamespaceDottedEntries } from '@/features/workbench/live/variable-helpers'
import { walkActiveSubtree } from '@/features/functions/canvas/inner-workflow'
import type { ProfileBinding } from './dialogs/profile-binding-modal'
import type { EnrichedVariable } from './types'

// A profile alias the open Block binds itself comes from its own bindings, with its fields.
const SCOPE_ALIAS_ENTRIES = new WeakSet<EnrichedVariable>()

function scopeEntry(entry: ScopeName, row: ManagerRow | undefined): EnrichedVariable {
  if (entry.kind === 'profile' || row === undefined) {
    const alias: EnrichedVariable = { id: `scope-profile:${entry.name}`, name: entry.name, value: null, type: 'map' }
    SCOPE_ALIAS_ENTRIES.add(alias)
    return alias
  }
  const writer = entry.writers.at(-1)
  if (entry.kind === 'local') return { ...row, source: writer, ...(writer !== undefined && { isOutputBinding: true }) }
  return {
    id: row.id,
    name: row.name,
    value: row.value,
    type: row.type,
    source: entry.kind === 'input' ? 'Function input' : 'Function output',
    isOutputBinding: entry.kind === 'output' || writer !== undefined,
    isSecret: row.isSecret,
  }
}

/** The names a Function scope reads, as autocomplete entries: inputs, outputs, locals, then profile aliases. */
function scopeVariables(body: ScopeBody | null): EnrichedVariable[] {
  const rows = new Map<string, ManagerRow>()
  for (const row of functionScopeRows(body)) if (!rows.has(row.name)) rows.set(row.name, row)
  return functionScopeNames(body).map((entry) => scopeEntry(entry, rows.get(entry.name)))
}

export function useEnrichedVariables(
  profileBindings: ProfileBinding[],
): EnrichedVariable[] {
  // Get available variables from workflow store, enriched with output source info
  const storeVariables = useWorkflowStore((state) => state.variables ?? [])
  const storeNodes = useWorkflowStore((state) => state.nodes)
  const storeEdges = useWorkflowStore((state) => state.edges)
  const drillPath = useWorkflowStore((state) => state.drillPath)
  const namespaceSystemVars = useWorkflowStore((state) => state.namespaceVariables.system)
  const namespaceSuiteVars = useWorkflowStore((state) => state.namespaceVariables.suite)
  const namespaceRegressionVars = useWorkflowStore((state) => state.namespaceVariables.regression)
  const variables = useMemo(() => {
    // Inside a Function only its own scope is addressable: no Test variables, no namespaces.
    if (drillPath.length > 0) {
      const active = walkActiveSubtree(storeNodes, storeEdges, storeVariables, drillPath)
      return scopeVariables(active.localDefinition as ScopeBody | null)
    }

    const sourceMap = new Map<string, string>()
    for (const node of storeNodes) {
      const config = node.data.config
      const bindings = config?.outputBindings as Record<string, string> | undefined
      if (bindings) {
        const name = node.data.label
        for (const varName of Object.values(bindings)) {
          if (varName) sourceMap.set(varName, name)
        }
      }
    }
    const enriched: EnrichedVariable[] = storeVariables.map((v) => ({
      ...v,
      source: sourceMap.get(v.name),
      isOutputBinding: sourceMap.has(v.name),
    }))

    // Add namespace dotted entries for expression autocomplete (e.g., system.host)
    const namespaceDotted: EnrichedVariable[] = createNamespaceDottedEntries(namespaceSystemVars, 'system')
      .map((d) => ({
        id: `ns-${d.name}`,
        name: d.name,
        value: null,
        type: d.type,
        source: d.source,
        ...(d.isNamespaceRoot && { isNamespaceRoot: true }),
      }))

    const suiteDotted: EnrichedVariable[] = createNamespaceDottedEntries(namespaceSuiteVars, 'suite')
      .map((d) => ({
        id: `ns-${d.name}`,
        name: d.name,
        value: null,
        type: d.type,
        source: d.source,
        ...(d.isNamespaceRoot && { isNamespaceRoot: true }),
      }))

    const regressionDotted: EnrichedVariable[] = createNamespaceDottedEntries(namespaceRegressionVars, 'regression')
      .map((d) => ({
        id: `ns-${d.name}`,
        name: d.name,
        value: null,
        type: d.type,
        source: d.source,
        ...(d.isNamespaceRoot && { isNamespaceRoot: true }),
      }))

    return [...enriched, ...namespaceDotted, ...suiteDotted, ...regressionDotted]
  }, [drillPath, storeVariables, storeNodes, storeEdges, namespaceSystemVars, namespaceSuiteVars, namespaceRegressionVars])

  // Enrich available variables with profile alias + field entries for autocomplete
  return useMemo(() => {
    if (profileBindings.length === 0) return variables
    const ownAliases = new Set(profileBindings.map((b) => b.alias))
    const kept = variables.filter((v) => !(SCOPE_ALIAS_ENTRIES.has(v) && ownAliases.has(v.name)))
    const profileVars: typeof variables = []
    for (const b of profileBindings) {
      if (!b.alias) continue
      const profileSource = `Profile: ${b.profileName}`
      profileVars.push({
        id: `profile-${b.profileId}`,
        name: b.alias,
        value: null,
        type: 'map' as const,
        source: profileSource,
      })
      for (const f of b.fields ?? []) {
        profileVars.push({
          id: `profile-${b.profileId}-${f.name}`,
          name: `${b.alias}.${f.name}`,
          value: null,
          type: 'string' as const,
          source: profileSource,
        })
      }
    }
    return [...kept, ...profileVars]
  }, [variables, profileBindings])
}
