/**
 * Tests for the shared per-row expression-field helpers (SHRUN-4, REQ-3.4.1.1).
 *
 * An ordered list keeps each row's value under the dotted key
 * `<param>.<i>.value` in the node's expressionFields. One helper reads those
 * row indices back out, the other rewrites them from the rows and must leave
 * every other parameter's entries in place.
 */

import { describe, it, expect } from 'vitest'

import {
  partsExprIndicesFor,
  withPartsExprIndices,
} from '@/features/workbench/lib/node-parameters/indexed-expression-fields'

describe('partsExprIndicesFor', () => {
  it('returns an empty set when there are no expression fields', () => {
    expect(partsExprIndicesFor('arguments', [])).toEqual(new Set())
  })

  it('reads every row index the parameter declares', () => {
    expect(
      partsExprIndicesFor('arguments', ['arguments.0.value', 'arguments.2.value']),
    ).toEqual(new Set([0, 2]))
  })

  it('reads a multi-digit row index as a number', () => {
    expect(partsExprIndicesFor('arguments', ['arguments.10.value'])).toEqual(new Set([10]))
  })

  it('collapses a repeated entry into one index', () => {
    expect(
      partsExprIndicesFor('arguments', ['arguments.1.value', 'arguments.1.value']),
    ).toEqual(new Set([1]))
  })

  it("ignores another parameter's row entries", () => {
    expect(
      partsExprIndicesFor('arguments', ['parts.0.value', 'arguments.1.value']),
    ).toEqual(new Set([1]))
  })

  it('ignores a parameter whose name only starts with this one', () => {
    expect(partsExprIndicesFor('arguments', ['argumentsExtra.0.value'])).toEqual(new Set())
  })

  it('ignores an entry for the parameter that is not a row value', () => {
    expect(
      partsExprIndicesFor('arguments', [
        'arguments',
        'arguments.0',
        'arguments.0.name',
        'arguments.x.value',
      ]),
    ).toEqual(new Set())
  })
})

describe('withPartsExprIndices', () => {
  it('writes one entry per given row index', () => {
    expect(withPartsExprIndices('arguments', [], [0, 2])).toEqual([
      'arguments.0.value',
      'arguments.2.value',
    ])
  })

  it('writes the entries in the given order', () => {
    expect(withPartsExprIndices('arguments', [], [2, 0])).toEqual([
      'arguments.2.value',
      'arguments.0.value',
    ])
  })

  it('replaces the entries the parameter had', () => {
    expect(
      withPartsExprIndices('arguments', ['arguments.0.value', 'arguments.1.value'], [1]),
    ).toEqual(['arguments.1.value'])
  })

  it('removes every entry of the parameter when no row is an expression', () => {
    expect(withPartsExprIndices('arguments', ['arguments.0.value'], [])).toEqual([])
  })

  it("keeps other parameters' entries in place", () => {
    expect(
      withPartsExprIndices(
        'arguments',
        ['input_vars.HOST', 'arguments.0.value', 'parts.1.value'],
        [1],
      ),
    ).toEqual(['input_vars.HOST', 'parts.1.value', 'arguments.1.value'])
  })

  it('keeps a parameter whose name only starts with this one', () => {
    expect(withPartsExprIndices('arguments', ['argumentsExtra.0.value'], [])).toEqual([
      'argumentsExtra.0.value',
    ])
  })

  it('keeps a whole-parameter entry that carries no row index', () => {
    expect(withPartsExprIndices('arguments', ['arguments'], [0])).toEqual([
      'arguments',
      'arguments.0.value',
    ])
  })

  it('drops a dotted entry of the parameter that is not a row value', () => {
    expect(withPartsExprIndices('arguments', ['arguments.0.name'], [])).toEqual([])
  })

  it('round trips through partsExprIndicesFor', () => {
    const fields = withPartsExprIndices('arguments', ['input_vars.HOST'], [0, 3])
    expect(partsExprIndicesFor('arguments', fields)).toEqual(new Set([0, 3]))
  })
})
