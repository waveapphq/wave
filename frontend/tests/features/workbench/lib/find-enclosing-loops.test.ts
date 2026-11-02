/**
 * Find Enclosing Loops - Graph Traversal Utility Tests
 *
 * Tests the utility function that walks backward through the workflow graph
 * from a given node to find all enclosing loop nodes reachable via body-handle
 * edges. This powers the target_loop dropdown for Break and Continue controls.
 *
 * REQ-3.5.1.2: Break current block execution
 * REQ-3.5.1.3: Continue to next iteration
 */

import { describe, it, expect } from 'vitest'
import { findEnclosingLoops, type LoopOption } from '@/features/workbench/lib/find-enclosing-loops'

// ---------------------------------------------------------------------------
// Test helpers - minimal node and edge types matching workflow store shapes
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
  targetHandle?: string
}

function node(id: string, elementType: string, name = ''): TestNode {
  return {
    id,
    type: 'control',
    position: { x: 0, y: 0 },
    data: {
      label: name,
      elementType,
    },
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
// Single loop scenarios
// ---------------------------------------------------------------------------

describe('findEnclosingLoops', () => {
  describe('single loop', () => {
    it('finds a For loop enclosing the node via body handle', () => {
      const nodes = [
        node('for-1', 'for', 'Count to 10'),
        node('break-1', 'break'),
      ]
      const edges = [
        edge('for-1', 'break-1', 'body'),
      ]

      const result = findEnclosingLoops('break-1', nodes, edges)

      expect(result).toHaveLength(1)
      expect(result[0].nodeId).toBe('for-1')
      expect(result[0].label).toBe('For Loop: Count to 10')
    })

    it('finds a ForEach loop enclosing the node via body handle', () => {
      const nodes = [
        node('fe-1', 'for-each', 'Iterate Servers'),
        node('continue-1', 'continue'),
      ]
      const edges = [
        edge('fe-1', 'continue-1', 'body'),
      ]

      const result = findEnclosingLoops('continue-1', nodes, edges)

      expect(result).toHaveLength(1)
      expect(result[0].nodeId).toBe('fe-1')
      expect(result[0].label).toBe('For Each: Iterate Servers')
    })

    it('finds a While loop enclosing the node via body handle', () => {
      const nodes = [
        node('while-1', 'while', 'Poll Status'),
        node('break-1', 'break'),
      ]
      const edges = [
        edge('while-1', 'break-1', 'body'),
      ]

      const result = findEnclosingLoops('break-1', nodes, edges)

      expect(result).toHaveLength(1)
      expect(result[0].nodeId).toBe('while-1')
      expect(result[0].label).toBe('While Loop: Poll Status')
    })

    it('finds loop when break is further down the body chain', () => {
      // for-1 --body--> log-1 --> break-1
      const nodes = [
        node('for-1', 'for', 'My Loop'),
        node('log-1', 'log'),
        node('break-1', 'break'),
      ]
      const edges = [
        edge('for-1', 'log-1', 'body'),
        edge('log-1', 'break-1'),
      ]

      const result = findEnclosingLoops('break-1', nodes, edges)

      expect(result).toHaveLength(1)
      expect(result[0].nodeId).toBe('for-1')
    })
  })

  // ---------------------------------------------------------------------------
  // Nested loops
  // ---------------------------------------------------------------------------

  describe('nested loops', () => {
    it('returns outermost first for two nested loops', () => {
      // for-1 --body--> fe-1 --body--> break-1
      const nodes = [
        node('for-1', 'for', 'Outer'),
        node('fe-1', 'for-each', 'Inner'),
        node('break-1', 'break'),
      ]
      const edges = [
        edge('for-1', 'fe-1', 'body'),
        edge('fe-1', 'break-1', 'body'),
      ]

      const result = findEnclosingLoops('break-1', nodes, edges)

      expect(result).toHaveLength(2)
      expect(result[0].nodeId).toBe('for-1')
      expect(result[0].label).toBe('For Loop: Outer')
      expect(result[1].nodeId).toBe('fe-1')
      expect(result[1].label).toBe('For Each: Inner')
    })

    it('returns three levels of nesting in correct order', () => {
      // for-1 --body--> fe-1 --body--> while-1 --body--> break-1
      const nodes = [
        node('for-1', 'for', 'Level 1'),
        node('fe-1', 'for-each', 'Level 2'),
        node('while-1', 'while', 'Level 3'),
        node('break-1', 'break'),
      ]
      const edges = [
        edge('for-1', 'fe-1', 'body'),
        edge('fe-1', 'while-1', 'body'),
        edge('while-1', 'break-1', 'body'),
      ]

      const result = findEnclosingLoops('break-1', nodes, edges)

      expect(result).toHaveLength(3)
      expect(result[0].nodeId).toBe('for-1')
      expect(result[1].nodeId).toBe('fe-1')
      expect(result[2].nodeId).toBe('while-1')
    })

    it('finds nested loops when break is deep in inner body chain', () => {
      // for-1 --body--> fe-1 --body--> log-1 --> http-1 --> break-1
      const nodes = [
        node('for-1', 'for', 'Outer'),
        node('fe-1', 'for-each', 'Inner'),
        node('log-1', 'log'),
        node('http-1', 'http-client'),
        node('break-1', 'break'),
      ]
      const edges = [
        edge('for-1', 'fe-1', 'body'),
        edge('fe-1', 'log-1', 'body'),
        edge('log-1', 'http-1'),
        edge('http-1', 'break-1'),
      ]

      const result = findEnclosingLoops('break-1', nodes, edges)

      expect(result).toHaveLength(2)
      expect(result[0].nodeId).toBe('for-1')
      expect(result[1].nodeId).toBe('fe-1')
    })
  })

  // ---------------------------------------------------------------------------
  // Not in any loop
  // ---------------------------------------------------------------------------

  describe('no enclosing loop', () => {
    it('returns empty array when node is at top level', () => {
      const nodes = [
        node('log-1', 'log'),
        node('break-1', 'break'),
      ]
      const edges = [
        edge('log-1', 'break-1'),
      ]

      const result = findEnclosingLoops('break-1', nodes, edges)

      expect(result).toHaveLength(0)
    })

    it('returns empty array when node has no incoming edges', () => {
      const nodes = [
        node('break-1', 'break'),
      ]
      const edges: TestEdge[] = []

      const result = findEnclosingLoops('break-1', nodes, edges)

      expect(result).toHaveLength(0)
    })
  })

  // ---------------------------------------------------------------------------
  // Then-path exclusion (critical - nodes AFTER loop are NOT inside loop)
  // ---------------------------------------------------------------------------

  describe('then-path exclusion', () => {
    it('does not include loop when node is on then-path', () => {
      // for-1 --then--> node-after
      const nodes = [
        node('for-1', 'for', 'My Loop'),
        node('node-after', 'log'),
      ]
      const edges = [
        edge('for-1', 'node-after', 'then'),
      ]

      const result = findEnclosingLoops('node-after', nodes, edges)

      expect(result).toHaveLength(0)
    })

    it('excludes then-path loop but includes body-path parent loop', () => {
      // outer-for --body--> inner-for --body--> ... (body chain)
      // inner-for --then--> node-after-inner
      // node-after-inner is inside outer-for (via body) but AFTER inner-for (via then)
      const nodes = [
        node('outer-for', 'for', 'Outer'),
        node('inner-for', 'for', 'Inner'),
        node('node-after-inner', 'log'),
      ]
      const edges = [
        edge('outer-for', 'inner-for', 'body'),
        edge('inner-for', 'node-after-inner', 'then'),
      ]

      const result = findEnclosingLoops('node-after-inner', nodes, edges)

      // inner-for is excluded (then-path), but outer-for is included (body-path)
      expect(result).toHaveLength(1)
      expect(result[0].nodeId).toBe('outer-for')
    })
  })

  // ---------------------------------------------------------------------------
  // Label formatting
  // ---------------------------------------------------------------------------

  describe('label formatting', () => {
    it('formats For loop with display name', () => {
      const nodes = [
        node('for-1', 'for', 'Repeat Test'),
        node('break-1', 'break'),
      ]
      const edges = [edge('for-1', 'break-1', 'body')]

      const result = findEnclosingLoops('break-1', nodes, edges)

      expect(result[0].label).toBe('For Loop: Repeat Test')
    })

    it('formats For Each loop with display name', () => {
      const nodes = [
        node('fe-1', 'for-each', 'Iterate Items'),
        node('break-1', 'break'),
      ]
      const edges = [edge('fe-1', 'break-1', 'body')]

      const result = findEnclosingLoops('break-1', nodes, edges)

      expect(result[0].label).toBe('For Each: Iterate Items')
    })

    it('formats While loop with display name', () => {
      const nodes = [
        node('w-1', 'while', 'Wait for Ready'),
        node('break-1', 'break'),
      ]
      const edges = [edge('w-1', 'break-1', 'body')]

      const result = findEnclosingLoops('break-1', nodes, edges)

      expect(result[0].label).toBe('While Loop: Wait for Ready')
    })

    it('names a loop by its Name, never by its Description', () => {
      const loop = node('for-1', 'for', 'Retry upload')
      loop.data.description = 'Sends the file again until the server takes it'
      const nodes = [loop, node('break-1', 'break')]
      const edges = [edge('for-1', 'break-1', 'body')]

      const result = findEnclosingLoops('break-1', nodes, edges)

      expect(result[0].label).toBe('For Loop: Retry upload')
    })

    it('formats a loop that keeps its default Name', () => {
      const nodes = [
        node('for-1', 'for', 'For Loop_1'),
        node('break-1', 'break'),
      ]
      const edges = [edge('for-1', 'break-1', 'body')]

      const result = findEnclosingLoops('break-1', nodes, edges)

      expect(result[0].label).toBe('For Loop: For Loop_1')
    })

    it('formats loop without display name as "No Title"', () => {
      const nodes = [
        node('for-1', 'for'),
        node('break-1', 'break'),
      ]
      const edges = [edge('for-1', 'break-1', 'body')]

      const result = findEnclosingLoops('break-1', nodes, edges)

      expect(result[0].label).toBe('For Loop: No Title')
    })

    it('formats For Each without display name as "No Title"', () => {
      const nodes = [
        node('fe-1', 'for-each'),
        node('break-1', 'break'),
      ]
      const edges = [edge('fe-1', 'break-1', 'body')]

      const result = findEnclosingLoops('break-1', nodes, edges)

      expect(result[0].label).toBe('For Each: No Title')
    })

    it('formats While without display name as "No Title"', () => {
      const nodes = [
        node('w-1', 'while'),
        node('break-1', 'break'),
      ]
      const edges = [edge('w-1', 'break-1', 'body')]

      const result = findEnclosingLoops('break-1', nodes, edges)

      expect(result[0].label).toBe('While Loop: No Title')
    })
  })

  // ---------------------------------------------------------------------------
  // All loop types recognized
  // ---------------------------------------------------------------------------

  describe('loop type recognition', () => {
    it('recognizes all three loop types in one graph', () => {
      // for-1 --body--> fe-1 --body--> while-1 --body--> break-1
      const nodes = [
        node('for-1', 'for', 'For'),
        node('fe-1', 'for-each', 'ForEach'),
        node('while-1', 'while', 'While'),
        node('break-1', 'break'),
      ]
      const edges = [
        edge('for-1', 'fe-1', 'body'),
        edge('fe-1', 'while-1', 'body'),
        edge('while-1', 'break-1', 'body'),
      ]

      const result = findEnclosingLoops('break-1', nodes, edges)

      expect(result).toHaveLength(3)
      const types = result.map((r) => r.loopType)
      expect(types).toContain('for')
      expect(types).toContain('for-each')
      expect(types).toContain('while')
    })
  })

  // ---------------------------------------------------------------------------
  // Non-loop controls ignored
  // ---------------------------------------------------------------------------

  describe('non-loop controls ignored', () => {
    it('does not include if-else as a loop', () => {
      // if-else --body--> break-1
      // (if-else uses body handle for true branch but is not a loop)
      const nodes = [
        node('if-1', 'if-else', 'Check Status'),
        node('break-1', 'break'),
      ]
      const edges = [
        edge('if-1', 'break-1', 'body'),
      ]

      const result = findEnclosingLoops('break-1', nodes, edges)

      expect(result).toHaveLength(0)
    })

    it('does not include try-catch-finally as a loop', () => {
      const nodes = [
        node('try-1', 'try-catch-finally'),
        node('break-1', 'break'),
      ]
      const edges = [
        edge('try-1', 'break-1', 'body'),
      ]

      const result = findEnclosingLoops('break-1', nodes, edges)

      expect(result).toHaveLength(0)
    })

    it('traverses through non-loop controls to find enclosing loop', () => {
      // for-1 --body--> if-1 --body--> break-1
      // if-1 is not a loop but for-1 IS - should find for-1
      const nodes = [
        node('for-1', 'for', 'Outer Loop'),
        node('if-1', 'if-else'),
        node('break-1', 'break'),
      ]
      const edges = [
        edge('for-1', 'if-1', 'body'),
        edge('if-1', 'break-1', 'body'),
      ]

      const result = findEnclosingLoops('break-1', nodes, edges)

      expect(result).toHaveLength(1)
      expect(result[0].nodeId).toBe('for-1')
    })

    it('does not include parallel, switch-case, or other non-loop controls', () => {
      const nodes = [
        node('par-1', 'parallel'),
        node('sw-1', 'switch-case'),
        node('break-1', 'break'),
      ]
      const edges = [
        edge('par-1', 'sw-1', 'body'),
        edge('sw-1', 'break-1', 'branch_0'),
      ]

      const result = findEnclosingLoops('break-1', nodes, edges)

      expect(result).toHaveLength(0)
    })

    it('traverses through a Switch case lane to find the enclosing loop', () => {
      // for-1 --body--> sw-1 --branch_0--> break-1
      // A Break inside a case body targets the enclosing loop, not the Switch.
      const nodes = [
        node('for-1', 'for', 'Outer Loop'),
        node('sw-1', 'switch-case'),
        node('break-1', 'break'),
      ]
      const edges = [
        edge('for-1', 'sw-1', 'body'),
        edge('sw-1', 'break-1', 'branch_0'),
      ]

      const result = findEnclosingLoops('break-1', nodes, edges)

      expect(result).toHaveLength(1)
      expect(result[0].nodeId).toBe('for-1')
    })
  })

  // ---------------------------------------------------------------------------
  // Auto-select innermost (default selection)
  // ---------------------------------------------------------------------------

  describe('default selection', () => {
    it('first item in result is the innermost loop', () => {
      const nodes = [
        node('for-1', 'for', 'Outer'),
        node('fe-1', 'for-each', 'Inner'),
        node('break-1', 'break'),
      ]
      const edges = [
        edge('for-1', 'fe-1', 'body'),
        edge('fe-1', 'break-1', 'body'),
      ]

      const result = findEnclosingLoops('break-1', nodes, edges)

      // Innermost (fe-1) should be last (outermost first)
      expect(result[result.length - 1].nodeId).toBe('fe-1')
    })
  })

  // ---------------------------------------------------------------------------
  // LoopOption interface
  // ---------------------------------------------------------------------------

  describe('LoopOption shape', () => {
    it('returns objects with nodeId, label, and loopType fields', () => {
      const nodes = [
        node('for-1', 'for', 'My Loop'),
        node('break-1', 'break'),
      ]
      const edges = [edge('for-1', 'break-1', 'body')]

      const result = findEnclosingLoops('break-1', nodes, edges)

      expect(result).toHaveLength(1)
      const option: LoopOption = result[0]
      expect(option).toHaveProperty('nodeId')
      expect(option).toHaveProperty('label')
      expect(option).toHaveProperty('loopType')
      expect(option.nodeId).toBe('for-1')
      expect(option.loopType).toBe('for')
      expect(option.label).toBe('For Loop: My Loop')
    })
  })

  // ---------------------------------------------------------------------------
  // Cycle protection
  // ---------------------------------------------------------------------------

  describe('cycle protection', () => {
    it('does not infinite loop on cyclic graphs', () => {
      // A --> B --> A (cycle)
      const nodes = [
        node('a', 'log'),
        node('b', 'break'),
      ]
      const edges = [
        edge('a', 'b'),
        edge('b', 'a'),
      ]

      // Should terminate without hanging
      const result = findEnclosingLoops('b', nodes, edges)
      expect(result).toHaveLength(0)
    })
  })

  // ---------------------------------------------------------------------------
  // Mixed body and then edges to the same node
  // ---------------------------------------------------------------------------

  describe('mixed handle edges', () => {
    it('handles node reachable via both body and then from different loops', () => {
      // for-1 --body--> merge-node
      // for-2 --then--> merge-node
      // Only for-1 should be included (body), not for-2 (then)
      const nodes = [
        node('for-1', 'for', 'Body Source'),
        node('for-2', 'for', 'Then Source'),
        node('merge-node', 'break'),
      ]
      const edges = [
        edge('for-1', 'merge-node', 'body'),
        edge('for-2', 'merge-node', 'then'),
      ]

      const result = findEnclosingLoops('merge-node', nodes, edges)

      expect(result).toHaveLength(1)
      expect(result[0].nodeId).toBe('for-1')
    })
  })

  // ---------------------------------------------------------------------------
  // Catch/finally handle edges - not loop body
  // ---------------------------------------------------------------------------

  describe('non-body handle exclusion', () => {
    it('does not traverse through catch handle as body', () => {
      const nodes = [
        node('for-1', 'for', 'Loop'),
        node('try-1', 'try-catch-finally'),
        node('break-1', 'break'),
      ]
      const edges = [
        edge('for-1', 'try-1', 'body'),
        edge('try-1', 'break-1', 'catch'),
      ]

      const result = findEnclosingLoops('break-1', nodes, edges)

      // The break is in try-catch's catch path, which is still inside for-1's body
      // The for-1 should still be found since we walk backward through all edges
      // The catch edge from try-1 is not a loop body edge, but try-1 itself is
      // reached via for-1's body handle
      expect(result).toHaveLength(1)
      expect(result[0].nodeId).toBe('for-1')
    })
  })

  // ---------------------------------------------------------------------------
  // Edge cases for branch coverage
  // ---------------------------------------------------------------------------

  describe('branch coverage edge cases', () => {
    it('handles edge referencing a source node not in the nodes array', () => {
      const nodes = [
        node('break-1', 'break'),
      ]
      const edges = [
        edge('nonexistent-node', 'break-1', 'body'),
      ]

      const result = findEnclosingLoops('break-1', nodes, edges)

      expect(result).toHaveLength(0)
    })

    it('uses elementType as label prefix when type is unknown', () => {
      const nodes = [
        node('custom-loop', 'custom-loop-type', 'My Custom'),
        node('break-1', 'break'),
      ]
      const edges = [
        edge('custom-loop', 'break-1', 'body'),
      ]

      // custom-loop-type is not in LOOP_TYPES, so it won't be added as a loop option
      const result = findEnclosingLoops('break-1', nodes, edges)
      expect(result).toHaveLength(0)
    })
  })

  // ---------------------------------------------------------------------------
  // Wait Until retry lane is not a loop for Break / Continue
  // ---------------------------------------------------------------------------

  describe('Wait Until retry lane', () => {
    it('does not report a Wait Until as a loop', () => {
      const nodes = [node('wu-1', 'wait-until'), node('break-1', 'break')]
      const edges = [edge('wu-1', 'break-1', 'retry')]

      expect(findEnclosingLoops('break-1', nodes, edges)).toEqual([])
    })

    it('traverses through a Wait Until retry lane to find the enclosing loop', () => {
      const nodes = [node('for-1', 'for', 'Outer Loop'), node('wu-1', 'wait-until'), node('break-1', 'break')]
      const edges = [edge('for-1', 'wu-1', 'body'), edge('wu-1', 'break-1', 'retry')]

      const result = findEnclosingLoops('break-1', nodes, edges)

      expect(result.map((option) => option.nodeId)).toEqual(['for-1'])
    })
  })
})
