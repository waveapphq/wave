/**
 * Loop Target Validation Tests
 *
 * Tests the validation logic for Break/Continue target_loop parameter.
 * Validates that the target references an existing loop node that is
 * an enclosing ancestor of the break/continue node.
 *
 * REQ-3.5.1.2: Break current block execution
 * REQ-3.5.1.3: Continue to next iteration
 */

import { describe, it, expect } from 'vitest'
import { validateLoopTarget, type LoopTargetValidationResult } from '@/features/workbench/lib/validate-loop-target'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

interface TestNode {
  id: string
  type: string
  position: { x: number; y: number }
  data: {
    label: string
    elementType?: string
    description?: string
  }
}

interface TestEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string
}

function node(id: string, elementType: string, description?: string): TestNode {
  return {
    id,
    type: 'control',
    position: { x: 0, y: 0 },
    data: { label: elementType, elementType, description },
  }
}

function edge(source: string, target: string, sourceHandle?: string): TestEdge {
  return {
    id: `${source}-${target}-${sourceHandle ?? 'default'}`,
    source,
    target,
    sourceHandle,
  }
}

// ---------------------------------------------------------------------------
// Valid target_loop
// ---------------------------------------------------------------------------

describe('validateLoopTarget', () => {
  describe('valid targets', () => {
    it('passes when target_loop references an enclosing loop', () => {
      const nodes = [
        node('for-1', 'for', 'My Loop'),
        node('break-1', 'break'),
      ]
      const edges = [
        edge('for-1', 'break-1', 'body'),
      ]

      const result = validateLoopTarget('break-1', 'for-1', nodes, edges)

      expect(result.valid).toBe(true)
      expect(result.error).toBeUndefined()
    })

    it('passes when targeting outer loop in nested scenario', () => {
      const nodes = [
        node('for-1', 'for', 'Outer'),
        node('fe-1', 'for-each', 'Inner'),
        node('break-1', 'break'),
      ]
      const edges = [
        edge('for-1', 'fe-1', 'body'),
        edge('fe-1', 'break-1', 'body'),
      ]

      const result = validateLoopTarget('break-1', 'for-1', nodes, edges)

      expect(result.valid).toBe(true)
    })

    it('passes when targeting innermost loop', () => {
      const nodes = [
        node('for-1', 'for', 'Outer'),
        node('fe-1', 'for-each', 'Inner'),
        node('continue-1', 'continue'),
      ]
      const edges = [
        edge('for-1', 'fe-1', 'body'),
        edge('fe-1', 'continue-1', 'body'),
      ]

      const result = validateLoopTarget('continue-1', 'fe-1', nodes, edges)

      expect(result.valid).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // Empty target_loop
  // ---------------------------------------------------------------------------

  describe('empty target', () => {
    it('fails when target_loop is empty string', () => {
      const nodes = [
        node('for-1', 'for', 'My Loop'),
        node('break-1', 'break'),
      ]
      const edges = [
        edge('for-1', 'break-1', 'body'),
      ]

      const result = validateLoopTarget('break-1', '', nodes, edges)

      expect(result.valid).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.error!.length).toBeGreaterThan(0)
    })

    it('fails when target_loop is undefined', () => {
      const nodes = [
        node('for-1', 'for'),
        node('break-1', 'break'),
      ]
      const edges = [
        edge('for-1', 'break-1', 'body'),
      ]

      const result = validateLoopTarget('break-1', undefined as unknown as string, nodes, edges)

      expect(result.valid).toBe(false)
      expect(result.error).toBeDefined()
    })
  })

  // ---------------------------------------------------------------------------
  // Non-existent node reference
  // ---------------------------------------------------------------------------

  describe('non-existent target', () => {
    it('fails when target_loop references a non-existent node ID', () => {
      const nodes = [
        node('for-1', 'for', 'My Loop'),
        node('break-1', 'break'),
      ]
      const edges = [
        edge('for-1', 'break-1', 'body'),
      ]

      const result = validateLoopTarget('break-1', 'nonexistent-node', nodes, edges)

      expect(result.valid).toBe(false)
      expect(result.error).toBeDefined()
    })
  })

  // ---------------------------------------------------------------------------
  // Not an enclosing loop
  // ---------------------------------------------------------------------------

  describe('not an enclosing loop', () => {
    it('fails when target is a loop but not an ancestor of the node', () => {
      // for-1 (body) --> log-1, for-2 (body) --> break-1
      // break-1 targets for-1 which is NOT its enclosing loop
      const nodes = [
        node('for-1', 'for', 'Other Loop'),
        node('log-1', 'log'),
        node('for-2', 'for', 'My Loop'),
        node('break-1', 'break'),
      ]
      const edges = [
        edge('for-1', 'log-1', 'body'),
        edge('for-2', 'break-1', 'body'),
      ]

      const result = validateLoopTarget('break-1', 'for-1', nodes, edges)

      expect(result.valid).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('fails when target exists but is not a loop type', () => {
      const nodes = [
        node('if-1', 'if-else'),
        node('break-1', 'break'),
      ]
      const edges = [
        edge('if-1', 'break-1', 'body'),
      ]

      const result = validateLoopTarget('break-1', 'if-1', nodes, edges)

      expect(result.valid).toBe(false)
      expect(result.error).toBeDefined()
    })
  })

  // ---------------------------------------------------------------------------
  // Outside any loop
  // ---------------------------------------------------------------------------

  describe('outside any loop', () => {
    it('fails when break is not inside any loop', () => {
      const nodes = [
        node('log-1', 'log'),
        node('break-1', 'break'),
      ]
      const edges = [
        edge('log-1', 'break-1'),
      ]

      // Even if we provide some target, there are no enclosing loops
      const result = validateLoopTarget('break-1', 'some-target', nodes, edges)

      expect(result.valid).toBe(false)
      expect(result.error).toBe('Block is not inside any loop')
    })
  })

  // ---------------------------------------------------------------------------
  // Return type shape
  // ---------------------------------------------------------------------------

  describe('result shape', () => {
    it('returns LoopTargetValidationResult with valid and optional error', () => {
      const nodes = [
        node('for-1', 'for'),
        node('break-1', 'break'),
      ]
      const edges = [edge('for-1', 'break-1', 'body')]

      const result: LoopTargetValidationResult = validateLoopTarget('break-1', 'for-1', nodes, edges)

      expect(result).toHaveProperty('valid')
      expect(typeof result.valid).toBe('boolean')
    })
  })
})
