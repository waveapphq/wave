/**
 * Assertion Builder - Tree Manipulation Helpers (interleaved format)
 */

import { literalNumberProblem } from '@/features/workbench/lib/validation/number-bounds'
import type {
  AssertionItem,
  AssertionGroup,
  LiteralAssertion,
  ExpressionAssertion,
  OperatorItem,
} from './types'
import { UNARY_OPERATORS } from './types'

/** Non-operator assertion item that can be added to a group or list */
type AssertionContent = LiteralAssertion | ExpressionAssertion | AssertionGroup

// ===========================================================================
// Shared helpers
// ===========================================================================

function andOperator(): OperatorItem {
  return { type: 'operator' as const, value: 'and' as const }
}

function hasNonOperatorItems(items: AssertionItem[]): boolean {
  return items.some((it) => it.type !== 'operator')
}

// ===========================================================================
// Core tree operations
// ===========================================================================

/**
 * Append an assertion item to a list, inserting an AND operator before it
 * if there are already assertion (non-operator) items in the list.
 */
export function appendWithOperator(
  items: AssertionItem[],
  newItem: AssertionContent,
): AssertionItem[] {
  if (hasNonOperatorItems(items)) {
    return [...items, andOperator(), newItem]
  }
  return [...items, newItem]
}

export function addToGroup(
  items: AssertionItem[],
  groupId: string,
  newItem: AssertionContent,
): AssertionItem[] {
  return items.map((item) => {
    if (item.type === 'group' && item.id === groupId) {
      return { ...item, items: appendWithOperator(item.items, newItem) }
    }
    if (item.type === 'group') {
      return { ...item, items: addToGroup(item.items, groupId, newItem) }
    }
    return item
  })
}

/**
 * Remove an assertion item at a given path, along with its adjacent operator.
 * - If it's the first item: remove item + following operator (if exists)
 * - If it's the last item: remove preceding operator + item
 * - If it's in the middle: remove preceding operator + item
 */
export function removeAtPath(items: AssertionItem[], path: number[]): AssertionItem[] {
  if (path.length === 1) {
    const idx = path[0]
    const result = [...items]
    if (idx === 0) {
      if (idx + 1 < result.length && result[idx + 1].type === 'operator') {
        result.splice(idx, 2)
      } else {
        result.splice(idx, 1)
      }
    } else if (idx - 1 >= 0 && result[idx - 1].type === 'operator') {
      result.splice(idx - 1, 2)
    } else {
      result.splice(idx, 1)
    }
    return result
  }
  return items.map((item, i) => {
    if (i === path[0] && item.type === 'group') {
      return { ...item, items: removeAtPath(item.items, path.slice(1)) }
    }
    return item
  })
}

/**
 * Remove a group by ID, along with its adjacent operator.
 */
export function removeGroupById(items: AssertionItem[], groupId: string): AssertionItem[] {
  const idx = items.findIndex((it) => it.type === 'group' && it.id === groupId)
  if (idx !== -1) return removeAtPath(items, [idx])
  return items.map((item) => {
    if (item.type === 'group') {
      return { ...item, items: removeGroupById(item.items, groupId) }
    }
    return item
  })
}

export function updateAtPath(
  items: AssertionItem[],
  path: number[],
  updated: AssertionItem,
): AssertionItem[] {
  if (path.length === 1) {
    return items.map((item, i) => (i === path[0] ? updated : item))
  }
  return items.map((item, i) => {
    if (i === path[0] && item.type === 'group') {
      return { ...item, items: updateAtPath(item.items, path.slice(1), updated) }
    }
    return item
  })
}

// ===========================================================================
// Move helpers - find neighbors
// ===========================================================================

function findAdjacentAssertionIndex(items: AssertionItem[], idx: number, direction: 'up' | 'down'): number {
  if (direction === 'up') {
    let prev = idx - 1
    while (prev >= 0 && items[prev].type === 'operator') prev--
    return prev
  }
  let next = idx + 1
  while (next < items.length && items[next].type === 'operator') next++
  /* v8 ignore next - COV-BRANCH-114 */
  return next < items.length ? next : -1
}

// ===========================================================================
// Move helpers - into neighboring group
// ===========================================================================

/** Move an item into a neighboring group (append at end) */
function moveIntoGroupAppend(items: AssertionItem[], idx: number, target: AssertionGroup): AssertionItem[] {
  const moved = items[idx]
  const result = removeAtPath(items, [idx])
  return result.map((it) => {
    if (it.type === 'group' && it.id === target.id) {
      return { ...it, items: appendWithOperator(it.items, moved as AssertionContent) }
    }
    return it
  })
}

/** Move an item into a neighboring group (prepend at start) */
function moveIntoGroupPrepend(items: AssertionItem[], idx: number, target: AssertionGroup): AssertionItem[] {
  const moved = items[idx]
  const result = removeAtPath(items, [idx])
  return result.map((it) => {
    if (it.type === 'group' && it.id === target.id) {
      const hasChildren = hasNonOperatorItems(it.items)
      return hasChildren
        ? { ...it, items: [moved, andOperator(), ...it.items] }
        : { ...it, items: [moved, ...it.items] }
    }
    return it
  })
}

// ===========================================================================
// Move helpers - flat swap
// ===========================================================================

function moveUp(items: AssertionItem[], idx: number): AssertionItem[] {
  const prevIdx = findAdjacentAssertionIndex(items, idx, 'up')
  /* v8 ignore next - COV-UNREACH-014 */
  if (prevIdx < 0) return items

  const prevItem = items[prevIdx]
  if (prevItem.type === 'group') {
    return moveIntoGroupAppend(items, idx, prevItem)
  }

  const copy = [...items]
  ;[copy[idx], copy[prevIdx]] = [copy[prevIdx], copy[idx]]
  return copy
}

function moveDown(items: AssertionItem[], idx: number): AssertionItem[] {
  const nextIdx = findAdjacentAssertionIndex(items, idx, 'down')
  /* v8 ignore next - COV-UNREACH-015 */
  if (nextIdx < 0) return items

  const nextItem = items[nextIdx]
  if (nextItem.type === 'group') {
    return moveIntoGroupPrepend(items, idx, nextItem)
  }

  const copy = [...items]
  ;[copy[idx], copy[nextIdx]] = [copy[nextIdx], copy[idx]]
  return copy
}

// ===========================================================================
// Move helpers - boundary escape (pop out of group)
// ===========================================================================

function popOutAboveGroup(items: AssertionItem[], groupIdx: number, childIdx: number): AssertionItem[] {
  const group = items[groupIdx] as AssertionGroup
  const moved = group.items[childIdx]
  const newGroupItems = removeAtPath(group.items, [childIdx])
  const result = [...items]
  result[groupIdx] = { ...group, items: newGroupItems }

  const needsOperator =
    hasNonOperatorItems(result.slice(0, groupIdx)) ||
    hasNonOperatorItems(newGroupItems)

  if (needsOperator) {
    result.splice(groupIdx, 0, moved, andOperator())
  } else {
    result.splice(groupIdx, 0, moved)
  }
  return result
}

function popOutBelowGroup(items: AssertionItem[], groupIdx: number, childIdx: number): AssertionItem[] {
  const group = items[groupIdx] as AssertionGroup
  const moved = group.items[childIdx]
  const newGroupItems = removeAtPath(group.items, [childIdx])
  const result = [...items]
  result[groupIdx] = { ...group, items: newGroupItems }

  const needsOperator =
    hasNonOperatorItems(result.slice(groupIdx + 1)) ||
    hasNonOperatorItems(newGroupItems)

  if (needsOperator) {
    result.splice(groupIdx + 1, 0, andOperator(), moved)
  } else {
    result.splice(groupIdx + 1, 0, moved)
  }
  return result
}

// ===========================================================================
// Main move function
// ===========================================================================

/**
 * Move an assertion item up or down in the interleaved list.
 * Swaps the assertion with the next/previous assertion, keeping operators in place.
 */
export function moveAtPath(
  items: AssertionItem[],
  path: number[],
  direction: 'up' | 'down',
): AssertionItem[] {
  // Flat-level move
  if (path.length === 1) {
    return direction === 'up' ? moveUp(items, path[0]) : moveDown(items, path[0])
  }

  // Recursing into a group - check for boundary escape
  const groupIdx = path[0]
  const group = items[groupIdx]
  /* v8 ignore next - COV-UNREACH-016 */
  if (group.type !== 'group') return items

  const childIdx = path[1]

  // Find assertion indices within the group to determine if at boundary
  const assertionIndices = group.items
    .map((it, i) => it.type === 'operator' ? -1 : i)
    .filter((i) => i >= 0)
  const childPositionInAssertions = assertionIndices.indexOf(childIdx)
  const isAtTop = childPositionInAssertions === 0
  const isAtBottom = childPositionInAssertions === assertionIndices.length - 1

  // Moving up from top of group -> pop out above the group
  if (path.length === 2 && direction === 'up' && isAtTop) {
    return popOutAboveGroup(items, groupIdx, childIdx)
  }

  // Moving down from bottom of group -> pop out below the group
  if (path.length === 2 && direction === 'down' && isAtBottom) {
    return popOutBelowGroup(items, groupIdx, childIdx)
  }

  // Normal within-group movement
  return items.map((item, i) => {
    if (i === path[0] && item.type === 'group') {
      return { ...item, items: moveAtPath(item.items, path.slice(1), direction) }
    }
    return item
  })
}

/** A row the author fills in - the AND/OR connectors are not rows. */
type AssertionRow = Exclude<AssertionItem, OperatorItem>

/** The number type a literal row's compare-to value is held to, as the server reads it, or null. */
function comparedNumberType(row: LiteralAssertion): 'integer' | 'float' | null {
  if (row.reference_is_expression || UNARY_OPERATORS.has(row.operator)) return null
  if (row.value_type === 'integer' || row.value_type === 'float') return row.value_type
  return row.value_type === 'array' && row.operator === 'length_equals' ? 'integer' : null
}

/** The message for a literal compare-to value that is no number of its row's type (REQ-3.1.3.14), or null. */
export function compareToProblem(row: LiteralAssertion): string | null {
  const type = comparedNumberType(row)
  return type === null ? null : literalNumberProblem(type, row.reference_value, false)
}

/** True when a row carries everything it needs to evaluate: a literal needs a
 *  variable and a compare-to value of its type, an expression needs text, a group
 *  needs at least one complete row. */
export function isAssertionComplete(row: AssertionRow): boolean {
  switch (row.type) {
    case 'literal':
      return row.variable.trim().length > 0 && compareToProblem(row) === null
    case 'expression':
      return row.expression.trim().length > 0
    case 'group':
      return areAssertionsComplete(row.items)
  }
}

/** True when the list holds at least one row and every row is complete. */
export function areAssertionsComplete(items: AssertionItem[]): boolean {
  const rows = items.filter((it): it is AssertionRow => it.type !== 'operator')
  return rows.length > 0 && rows.every(isAssertionComplete)
}

/** True when no literal row, at any group depth, holds a compare-to value its type refuses. */
export function compareToValuesValid(items: AssertionItem[]): boolean {
  return items.every((item) => {
    if (item.type === 'literal') return compareToProblem(item) === null
    return item.type !== 'group' || compareToValuesValid(item.items)
  })
}
