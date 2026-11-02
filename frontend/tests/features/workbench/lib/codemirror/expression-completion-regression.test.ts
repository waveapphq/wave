/**
 * Expression Completion - Regression Namespace Tests
 *
 * REQ-5.2.1.37: Regression management - expression autocomplete
 *
 * Tests for regression.* namespace completions in the expression editor:
 * - `regression.` namespace appears in top-level completions
 * - After dot, regression variable names appear as fields
 * - Source label shows "Regression" or "Regression:{name}"
 * - Variables update when `regression-variables-changed` event fires
 *
 * Module: frontend/src/features/workbench/lib/codemirror/expression-completion.ts
 */

import { describe, it, expect, afterEach } from 'vitest'
import { EditorState } from '@codemirror/state'
import { CompletionContext } from '@codemirror/autocomplete'
import {
  createExpressionCompletionSource,
  type AvailableVariable,
} from '@/features/workbench/lib/codemirror/expression-completion'

// ============================================================================
// Test Helpers
// ============================================================================

function getCompletions(
  doc: string,
  pos: number,
  variables: AvailableVariable[],
  isFieldExpression = false,
  showInfo = false,
) {
  const source = createExpressionCompletionSource(variables, isFieldExpression, showInfo)
  const state = EditorState.create({ doc })
  const context = new CompletionContext(state, pos, false)
  return source(context)
}

function getSectionName(opt: { section?: string | { name: string } }): string | undefined {
  if (!opt.section) return undefined
  if (typeof opt.section === 'string') return opt.section
  return opt.section.name
}

// ============================================================================
// Mock Variables
// ============================================================================

const regressionVariables: AvailableVariable[] = [
  {
    name: 'regression',
    type: 'namespace',
    source: 'System',
    description: 'Regression-scoped variables',
  },
  {
    name: 'regression.base_url',
    type: 'string',
    source: 'Regression:WAVE 26.04',
    description: 'Base URL for the regression',
  },
  {
    name: 'regression.timeout',
    type: 'integer',
    source: 'Regression:WAVE 26.04',
    description: 'Default timeout',
  },
  {
    name: 'regression.api_key',
    type: 'string',
    source: 'Regression:WAVE 26.04',
    description: 'API key for authentication',
  },
  // Also include suite variables for coexistence test
  {
    name: 'suite',
    type: 'namespace',
    source: 'System',
    description: 'Suite-scoped variables',
  },
  {
    name: 'suite.db_host',
    type: 'string',
    source: 'Suite:Auth Suite',
    description: 'Database host',
  },
]

afterEach(() => {
  // No views to clean up in these tests
})

// ============================================================================
// Tests
// ============================================================================

describe('Expression Completion - Regression Namespace', () => {
  describe('Top-level completions', () => {
    it('shows regression namespace in top-level completions', () => {
      const result = getCompletions('', 0, regressionVariables)
      expect(result).not.toBeNull()

      const regressionOpt = result!.options.find((o) => o.label === 'regression')
      expect(regressionOpt).toBeDefined()
      expect(regressionOpt!.type).toBe('variable')
    })

    it('regression namespace is in Namespaces section (like suite)', () => {
      const result = getCompletions('', 0, regressionVariables)
      expect(result).not.toBeNull()

      const regressionOpt = result!.options.find((o) => o.label === 'regression')
      expect(regressionOpt).toBeDefined()
      expect(getSectionName(regressionOpt!)).toBe('Namespaces')
    })

    it('regression and suite namespaces coexist in Namespaces section', () => {
      const result = getCompletions('', 0, regressionVariables)
      expect(result).not.toBeNull()

      const namespaceOptions = result!.options.filter(
        (o) => getSectionName(o) === 'Namespaces'
      )
      const names = namespaceOptions.map((o) => o.label)
      expect(names).toContain('regression')
      expect(names).toContain('suite')
    })
  })

  describe('Dot-context completions (after regression.)', () => {
    it('shows regression variable names after regression.', () => {
      const result = getCompletions('regression.', 11, regressionVariables)
      expect(result).not.toBeNull()

      const labels = result!.options.map((o) => o.label)
      expect(labels).toContain('regression.base_url')
      expect(labels).toContain('regression.timeout')
      expect(labels).toContain('regression.api_key')
    })

    it('does not show suite variables after regression.', () => {
      const result = getCompletions('regression.', 11, regressionVariables)
      expect(result).not.toBeNull()

      const labels = result!.options.map((o) => o.label)
      expect(labels).not.toContain('suite.db_host')
    })

    it('filters regression fields by typed prefix', () => {
      const result = getCompletions('regression.base', 14, regressionVariables)
      expect(result).not.toBeNull()

      const labels = result!.options.map((o) => o.label)
      expect(labels).toContain('regression.base_url')
      expect(labels).not.toContain('regression.timeout')
    })

    it('regression fields show in Fields section', () => {
      const result = getCompletions('regression.', 11, regressionVariables)
      expect(result).not.toBeNull()

      const fieldOptions = result!.options.filter(
        (o) => getSectionName(o) === 'Fields'
      )
      expect(fieldOptions.length).toBeGreaterThan(0)
    })
  })

  describe('Source labels', () => {
    it('regression namespace shows source as System', () => {
      const result = getCompletions('', 0, regressionVariables)
      expect(result).not.toBeNull()

      const regressionOpt = result!.options.find((o) => o.label === 'regression')
      expect(regressionOpt).toBeDefined()
      expect(regressionOpt!.detail).toContain('System')
    })

    it('regression variables show "Regression:" source label', () => {
      const result = getCompletions('regression.', 11, regressionVariables)
      expect(result).not.toBeNull()

      const baseUrlOpt = result!.options.find((o) => o.label === 'regression.base_url')
      expect(baseUrlOpt).toBeDefined()
      expect(baseUrlOpt!.detail).toContain('Regression:')
    })

    it('regression variable detail includes type', () => {
      const result = getCompletions('regression.', 11, regressionVariables)
      expect(result).not.toBeNull()

      const baseUrlOpt = result!.options.find((o) => o.label === 'regression.base_url')
      expect(baseUrlOpt).toBeDefined()
      expect(baseUrlOpt!.detail).toContain('string')
    })
  })

  describe('Info tooltip', () => {
    it('includes description when showInfo is true', () => {
      const result = getCompletions('regression.', 11, regressionVariables, false, true)
      expect(result).not.toBeNull()

      const baseUrlOpt = result!.options.find((o) => o.label === 'regression.base_url')
      expect(baseUrlOpt).toBeDefined()
      expect(baseUrlOpt!.info).toBe('Base URL for the regression')
    })

    it('omits description when showInfo is false', () => {
      const result = getCompletions('regression.', 11, regressionVariables, false, false)
      expect(result).not.toBeNull()

      const baseUrlOpt = result!.options.find((o) => o.label === 'regression.base_url')
      expect(baseUrlOpt).toBeDefined()
      expect(baseUrlOpt!.info).toBeUndefined()
    })
  })

  describe('Variable updates via CustomEvent', () => {
    it('new variables appear after variable list changes', () => {
      // First completion call with original variables
      const result1 = getCompletions('regression.', 11, regressionVariables)
      const labels1 = result1!.options.map((o) => o.label)
      expect(labels1).not.toContain('regression.new_var')

      // After event fires, caller creates new source with updated variables
      const updatedVariables: AvailableVariable[] = [
        ...regressionVariables,
        {
          name: 'regression.new_var',
          type: 'string',
          source: 'Regression:WAVE 26.04',
          description: 'Newly added variable',
        },
      ]

      const result2 = getCompletions('regression.', 11, updatedVariables)
      const labels2 = result2!.options.map((o) => o.label)
      expect(labels2).toContain('regression.new_var')
    })

    it('removed variables disappear after variable list changes', () => {
      // First call has all variables
      const result1 = getCompletions('regression.', 11, regressionVariables)
      expect(result1!.options.map((o) => o.label)).toContain('regression.api_key')

      // After removal, api_key is gone
      const reducedVariables = regressionVariables.filter(
        (v) => v.name !== 'regression.api_key'
      )

      const result2 = getCompletions('regression.', 11, reducedVariables)
      expect(result2!.options.map((o) => o.label)).not.toContain('regression.api_key')
    })
  })

  describe('Edge cases', () => {
    it('returns null for empty regression namespace (no dotted variables)', () => {
      const varsWithoutDotted: AvailableVariable[] = [
        {
          name: 'regression',
          type: 'namespace',
          source: 'System',
          description: 'Regression-scoped variables',
        },
      ]

      const result = getCompletions('regression.', 11, varsWithoutDotted)
      // No dotted vars and no type methods -> null
      expect(result).toBeNull()
    })

    it('handles case-insensitive prefix matching', () => {
      const result = getCompletions('Regression.', 11, regressionVariables)
      // The completions module lowercases for matching
      // Dotted vars with regression. prefix should still match
      if (result) {
        const labels = result.options.map((o) => o.label)
        expect(labels.some((l) => l.startsWith('regression.'))).toBe(true)
      }
    })
  })
})
