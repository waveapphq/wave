/**
 * Unit tests for ``derivePausedElementType``.
 *
 * The helper normalizes the engine's raw ``elementType`` field into the
 * canonical synonyms the backend's element-type sets use (``switch-case``
 * -> ``switch``, the then-egress container name; ``assert`` + mode ->
 * ``assert-split`` / ``assert-single``). Tests lock in:
 *   - null pausedNodeId -> null (toolbar disables Skip Block by absence)
 *   - missing node in nodes -> null
 *   - missing elementType -> null
 *   - switch-case normalization
 *   - assert split/single normalization
 *   - non-special elementTypes pass through verbatim
 */

import { describe, it, expect } from 'vitest'
import { derivePausedElementType } from '@/features/workbench/lib/paused-element-type'

describe('derivePausedElementType', () => {
  it('returns null when pausedNodeId is null', () => {
    expect(derivePausedElementType(null, [])).toBeNull()
  })

  it('returns null when pausedNodeId is not found in nodes', () => {
    expect(
      derivePausedElementType('missing', [
        { id: 'other', data: { elementType: 'log' } },
      ]),
    ).toBeNull()
  })

  it('returns null when the node has no elementType', () => {
    expect(
      derivePausedElementType('n1', [{ id: 'n1', data: {} }]),
    ).toBeNull()
  })

  it('returns null when the node has no data', () => {
    expect(derivePausedElementType('n1', [{ id: 'n1' }])).toBeNull()
  })

  it('normalizes switch-case to switch', () => {
    expect(
      derivePausedElementType('n1', [
        { id: 'n1', data: { elementType: 'switch-case' } },
      ]),
    ).toBe('switch')
  })

  // Guard: Parallel is a container with one fall-through path, so it must not
  // join the diverging set that the Paused Toolbar refuses Skip Block on.
  it('passes parallel through unchanged', () => {
    expect(
      derivePausedElementType('n1', [{ id: 'n1', data: { elementType: 'parallel' } }]),
    ).toBe('parallel')
  })

  it('normalizes assert + mode=split to assert-split', () => {
    expect(
      derivePausedElementType('n1', [
        {
          id: 'n1',
          data: {
            elementType: 'assert',
            config: { values: { mode: 'split' } },
          },
        },
      ]),
    ).toBe('assert-split')
  })

  it('normalizes assert + mode=single to assert-single', () => {
    expect(
      derivePausedElementType('n1', [
        {
          id: 'n1',
          data: {
            elementType: 'assert',
            config: { values: { mode: 'single' } },
          },
        },
      ]),
    ).toBe('assert-single')
  })

  it('normalizes assert without explicit mode to assert-single', () => {
    expect(
      derivePausedElementType('n1', [
        { id: 'n1', data: { elementType: 'assert' } },
      ]),
    ).toBe('assert-single')
  })

  it('passes if-else through verbatim (already canonical)', () => {
    expect(
      derivePausedElementType('n1', [
        { id: 'n1', data: { elementType: 'if-else' } },
      ]),
    ).toBe('if-else')
  })

  it('passes leaf plugin element types through verbatim', () => {
    expect(
      derivePausedElementType('n1', [
        { id: 'n1', data: { elementType: 'log' } },
      ]),
    ).toBe('log')
  })

  it('passes for/while/parallel control types through verbatim', () => {
    for (const elementType of ['for', 'while', 'parallel', 'try-catch-finally']) {
      expect(
        derivePausedElementType('n1', [{ id: 'n1', data: { elementType } }]),
      ).toBe(elementType)
    }
  })
})
