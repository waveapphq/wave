/**
 * Tests for the frontend expression cycle detector.
 *
 * The detector mirrors the backend's set_entity_variables cycle gate so the
 * scalar variable edit dialog and the create variable dialog can surface
 * the cycle path inline before the user discovers it at test save or
 * runtime. Format and normalization must match the backend exactly.
 */

import { describe, it, expect } from 'vitest'
import {
  detectExpressionCycle,
  type VariableLike,
} from '@/features/workbench/live/expression-cycle-detector'

function expr(name: string, expression: string): VariableLike {
  return { name, value: expression, isExpression: true }
}

function literal(name: string, value: unknown): VariableLike {
  return { name, value, isExpression: false }
}

describe('detectExpressionCycle', () => {
  describe('no-cycle paths', () => {
    it('returns null for an empty list', () => {
      expect(detectExpressionCycle([])).toBeNull()
    })

    it('returns null when no variables are computed', () => {
      expect(
        detectExpressionCycle([
          literal('a', 1),
          literal('b', 'hello'),
        ]),
      ).toBeNull()
    })

    it('returns null for a chain of expressions with no cycle', () => {
      // c -> b -> a (literal)
      expect(
        detectExpressionCycle([
          literal('a', 1),
          expr('b', 'a + 1'),
          expr('c', 'b + 1'),
        ]),
      ).toBeNull()
    })

    it('returns null for diamond dependencies', () => {
      // a depends on b and c; b and c both depend on d (literal)
      expect(
        detectExpressionCycle([
          literal('d', 1),
          expr('b', 'd + 1'),
          expr('c', 'd + 2'),
          expr('a', 'b + c'),
        ]),
      ).toBeNull()
    })

    it('ignores Python builtins', () => {
      // len(items) references items (a real var) and len (a builtin)
      expect(
        detectExpressionCycle([
          literal('items', [1, 2, 3]),
          expr('count', 'len(items)'),
        ]),
      ).toBeNull()
    })

    it('ignores the sandbox table types', () => {
      expect(detectExpressionCycle([expr('t', "Table(['k'])"), expr('n', 't.row_count()')])).toBeNull()
    })

    it('ignores Python keywords (True, False, None, and, or, not)', () => {
      expect(
        detectExpressionCycle([
          literal('flag', true),
          expr('result', 'flag and not False'),
        ]),
      ).toBeNull()
    })

    it('skips expression-flagged variables whose value is not a string', () => {
      // A variable flagged as expression but with a non-string value cannot
      // form an identifier graph; it is inert from the detector's view.
      expect(
        detectExpressionCycle([
          { name: 'a', value: 42, isExpression: true },
        ]),
      ).toBeNull()
    })

    it('skips non-expression variables even when their value text looks like an expression', () => {
      // The literal variable's "a + 1" value is just text; detector must not
      // parse it as an expression.
      expect(
        detectExpressionCycle([
          literal('a', 1),
          { name: 'b', value: 'a + 1', isExpression: false },
        ]),
      ).toBeNull()
    })

    it('treats a reference to a literal variable as not contributing to the cycle graph', () => {
      // b is computed; a is literal. b depends on a but a is not in the
      // computed set, so no edge is added for a.
      expect(
        detectExpressionCycle([
          literal('a', 1),
          expr('b', 'a + 1'),
        ]),
      ).toBeNull()
    })
  })

  describe('cycle detection', () => {
    it('detects a direct self-reference', () => {
      expect(
        detectExpressionCycle([
          expr('a', 'a + 1'),
        ]),
      ).toBe("Circular reference detected for variable 'a': a -> a")
    })

    it('detects a cycle through a variable named like a builtin the sandbox leaves out', () => {
      expect(detectExpressionCycle([expr('id', 'total + 1'), expr('total', 'id * 2')])).toBe(
        "Circular reference detected for variable 'id': id -> total -> id",
      )
    })

    it('detects a two-variable cycle', () => {
      expect(
        detectExpressionCycle([
          expr('a', 'b + 1'),
          expr('b', 'a + 1'),
        ]),
      ).toBe("Circular reference detected for variable 'a': a -> b -> a")
    })

    it('detects a three-variable cycle', () => {
      expect(
        detectExpressionCycle([
          expr('a', 'b + 1'),
          expr('b', 'c + 1'),
          expr('c', 'a + 1'),
        ]),
      ).toBe("Circular reference detected for variable 'a': a -> b -> c -> a")
    })
  })

  describe('cycle path normalization', () => {
    it('normalizes the cycle to start at the lexicographically smallest variable regardless of dict order', () => {
      // Three-variable cycle entered from c first (DFS would discover the
      // cycle starting at c), but the message must start at a.
      expect(
        detectExpressionCycle([
          expr('c', 'a + 1'),
          expr('b', 'c + 1'),
          expr('a', 'b + 1'),
        ]),
      ).toBe("Circular reference detected for variable 'a': a -> b -> c -> a")
    })

    it('normalizes a two-variable cycle to start at a even when b is first in the list', () => {
      expect(
        detectExpressionCycle([
          expr('b', 'a + 1'),
          expr('a', 'b + 1'),
        ]),
      ).toBe("Circular reference detected for variable 'a': a -> b -> a")
    })
  })

  describe('partial graph edge cases', () => {
    it('returns null when only one of two cyclic variables is in the input list', () => {
      // c references missing var "z"; z is not in the computed set; no edge
      // added; no cycle.
      expect(
        detectExpressionCycle([
          expr('c', 'z + 1'),
        ]),
      ).toBeNull()
    })

    it('returns null when a computed variable references a builtin chain only', () => {
      expect(
        detectExpressionCycle([
          expr('a', 'len(str(int(1)))'),
        ]),
      ).toBeNull()
    })

    it('detects a self-reference even when other unrelated variables are present', () => {
      expect(
        detectExpressionCycle([
          literal('safe', 1),
          expr('cycle', 'cycle + 1'),
          literal('also_safe', 'hello'),
        ]),
      ).toBe("Circular reference detected for variable 'cycle': cycle -> cycle")
    })

    it('detects only the first cycle when multiple disjoint cycles exist', () => {
      // Two disjoint two-cycles. The detector returns one cycle (the one
      // hit first by DFS). Either result is valid; both must surface as
      // a cycle.
      const result = detectExpressionCycle([
        expr('a', 'b + 1'),
        expr('b', 'a + 1'),
        expr('c', 'd + 1'),
        expr('d', 'c + 1'),
      ])
      expect(result).not.toBeNull()
      expect(result).toMatch(/^Circular reference detected for variable '(a|c)':/)
    })

    it('skips visited nodes from prior DFS roots when scanning from a chain entry point', () => {
      // c -> b (literal); a (literal). Visiting c first marks c, b visited.
      // The next loop iteration over deps.keys() (a) hits the visited branch
      // when a is already-visited because DFS reached it. To force this:
      // build a cycle reachable from multiple entry points so DFS visits
      // some nodes early and the outer loop must skip them.
      // a -> b -> c -> a, plus disjoint d -> a is a chain entering the cycle.
      const result = detectExpressionCycle([
        expr('a', 'b + 1'),
        expr('b', 'c + 1'),
        expr('c', 'a + 1'),
        expr('d', 'a + 1'),
      ])
      expect(result).toBe(
        "Circular reference detected for variable 'a': a -> b -> c -> a",
      )
    })

    it('returns null when the outer DFS loop encounters already-visited nodes from prior chain traversal', () => {
      // a -> b chain where DFS from a visits a, then b. The outer findCycle
      // loop then encounters b as a deps key but it is already visited; the
      // continue branch must fire and the function returns null because no
      // cycle exists.
      // To make this work, b must be a key in deps (i.e., computed) but
      // its expression must not reference any other computed var (so its
      // deps set is empty). a references b; b references a literal.
      const result = detectExpressionCycle([
        expr('a', 'b + 1'),
        expr('b', '1 + 2'), // b is computed but references no other computed var
      ])
      expect(result).toBeNull()
    })
  })
})
