/**
 * Tests for function-scope-vars.ts - pure helpers that filter variables and
 * namespace entries by the current Function scope.
 *
 * Contract:
 *   - Inside a Function, the Variable Manager hides all external scopes
 *     (system / regression / suite / test). Only PARAMETERS and VARIABLES
 *     are visible.
 *   - filterVariablesForScope(variables, scope) returns the input list
 *     intact when scope.insideFunction is false; otherwise it filters
 *     variables down to those whose names are present in
 *     scope.allowedVarNames (the set unioning declared inputs, declared
 *     outputs, and Function-local var names).
 *   - filterNamespaceVarsForScope(namespaceVars, scope) returns
 *     namespaceVars verbatim when scope.insideFunction is false; otherwise
 *     it returns an object with every external scope emptied
 *     (system: [], suite: [], regression: []).
 *
 * REQ scope: REQ-3.1.1.4 (Function variable isolation at the authoring
 * surface; the runtime contract is enforced separately).
 */

import { describe, it, expect } from 'vitest'

import {
  filterVariablesForScope,
  filterNamespaceVarsForScope,
} from '@/features/functions/canvas/function-scope-vars'

interface MinimalVariable {
  id: string
  name: string
  value: unknown
  type: 'string' | 'integer' | 'float' | 'boolean' | 'array' | 'map' | 'table'
}

interface NamespaceEntry {
  name: string
  type: string
  sources?: string[]
}

interface NamespaceVariables {
  system: NamespaceEntry[]
  suite: NamespaceEntry[]
  regression: NamespaceEntry[]
}

interface FunctionScope {
  insideFunction: boolean
  declaredInputNames: string[]
  declaredOutputNames: string[]
  allowedVarNames: Set<string>
}

const outsideScope: FunctionScope = {
  insideFunction: false,
  declaredInputNames: [],
  declaredOutputNames: [],
  allowedVarNames: new Set(),
}

function insideScope(allowed: string[]): FunctionScope {
  return {
    insideFunction: true,
    declaredInputNames: [],
    declaredOutputNames: [],
    allowedVarNames: new Set(allowed),
  }
}

// -----------------------------------------------------------------------------
// filterVariablesForScope
// -----------------------------------------------------------------------------

describe('filterVariablesForScope', () => {
  const vars: MinimalVariable[] = [
    { id: 'a', name: 'alpha', value: 1, type: 'integer' },
    { id: 'b', name: 'beta', value: 'x', type: 'string' },
    { id: 'c', name: 'gamma', value: true, type: 'boolean' },
  ]

  it('returns the input list unchanged when scope.insideFunction is false', () => {
    expect(filterVariablesForScope(vars, outsideScope)).toEqual(vars)
  })

  it('returns the same reference (identity) when scope.insideFunction is false', () => {
    // Avoid producing churn for the React render path - identity equality
    // keeps memoized selectors stable.
    expect(filterVariablesForScope(vars, outsideScope)).toBe(vars)
  })

  it('keeps only variables whose name appears in scope.allowedVarNames when inside', () => {
    const filtered = filterVariablesForScope(vars, insideScope(['alpha', 'gamma']))
    expect(filtered.map((v: MinimalVariable) => v.name)).toEqual(['alpha', 'gamma'])
  })

  it('returns an empty list when no variables match the allowed set', () => {
    const filtered = filterVariablesForScope(vars, insideScope(['unknown']))
    expect(filtered).toEqual([])
  })

  it('returns an empty list when the input list is empty (inside or outside)', () => {
    expect(filterVariablesForScope([], outsideScope)).toEqual([])
    expect(filterVariablesForScope([], insideScope(['alpha']))).toEqual([])
  })
})

// -----------------------------------------------------------------------------
// filterNamespaceVarsForScope
// -----------------------------------------------------------------------------

describe('filterNamespaceVarsForScope', () => {
  const namespaces: NamespaceVariables = {
    system: [{ name: 'sys_user', type: 'string' }],
    suite: [
      { name: 'suite_env', type: 'string' },
      { name: 'suite_timeout', type: 'integer' },
    ],
    regression: [{ name: 'reg_run_id', type: 'string' }],
  }

  it('returns the namespaces unchanged when scope.insideFunction is false', () => {
    expect(filterNamespaceVarsForScope(namespaces, outsideScope)).toEqual(namespaces)
  })

  it('returns the same reference when scope.insideFunction is false', () => {
    expect(filterNamespaceVarsForScope(namespaces, outsideScope)).toBe(namespaces)
  })

  it('empties every external namespace when scope.insideFunction is true', () => {
    const filtered = filterNamespaceVarsForScope(namespaces, insideScope([]))
    expect(filtered).toEqual({ system: [], suite: [], regression: [] })
  })

  it('does not mutate the input namespaces when filtering', () => {
    filterNamespaceVarsForScope(namespaces, insideScope([]))
    expect(namespaces.system).toHaveLength(1)
    expect(namespaces.suite).toHaveLength(2)
    expect(namespaces.regression).toHaveLength(1)
  })

  it('returns empty arrays for every namespace regardless of allowedVarNames contents', () => {
    // allowedVarNames addresses Function-scope vars; namespace entries are
    // never resolved against it. Inside-Function semantics: hide every
    // external scope entirely.
    const filtered = filterNamespaceVarsForScope(namespaces, insideScope(['sys_user']))
    expect(filtered).toEqual({ system: [], suite: [], regression: [] })
  })
})
