/**
 * Tests for `getNextSequencedName` and `getNextFunctionInstanceName`.
 *
 * Naming rule (universal across plugins / controls / Functions):
 *   - First instance with a given base name uses the base unchanged.
 *   - Subsequent instances pick the lowest unused `_N` suffix.
 *   - Collision check is canvas-wide (no type predicate by default), so a
 *     plugin "Log" and a Function "Log" step on each other.
 */

import { describe, it, expect } from 'vitest'

import {
  getNextFunctionInstanceName,
  getNextSequencedName,
} from '@/features/functions/lib/naming'

type NodeLike = {
  id: string
  data: {
    label: string
    nodeType?: string
    functionLifecycle?: string
  }
}

function fnNode(id: string, label: string, lifecycle: 'local' | 'shared' = 'local'): NodeLike {
  return {
    id,
    data: {
      label,
      nodeType: 'function',
      functionLifecycle: lifecycle,
    },
  }
}

function pluginNode(id: string, label: string): NodeLike {
  return { id, data: { label, nodeType: 'plugin' } }
}


describe('getNextSequencedName (universal naming rule)', () => {
  it('returns the bare base when no sibling uses it', () => {
    expect(getNextSequencedName([], 'Log')).toBe('Log')
  })

  it('returns the bare base when no node label matches', () => {
    const nodes: NodeLike[] = [pluginNode('a', 'Shell Script'), pluginNode('b', 'Http')]
    expect(getNextSequencedName(nodes, 'Log')).toBe('Log')
  })

  it('returns base_1 when only the bare base is taken', () => {
    expect(getNextSequencedName([pluginNode('a', 'Log')], 'Log')).toBe('Log_1')
  })

  it('returns base_2 when base + base_1 are both taken', () => {
    const nodes = [pluginNode('a', 'Log'), pluginNode('b', 'Log_1')]
    expect(getNextSequencedName(nodes, 'Log')).toBe('Log_2')
  })

  it('skips taken integers and returns the lowest free suffix', () => {
    const nodes = [
      pluginNode('a', 'Log'),
      pluginNode('b', 'Log_1'),
      pluginNode('c', 'Log_3'),
    ]
    expect(getNextSequencedName(nodes, 'Log')).toBe('Log_2')
  })

  it('checks collisions canvas-wide (plugin "Log" blocks Function "Log")', () => {
    const nodes = [pluginNode('a', 'fetch_user')]
    expect(getNextSequencedName(nodes, 'fetch_user')).toBe('fetch_user_1')
  })

  it('honors an explicit predicate when callers want a narrower sibling set', () => {
    // Callers can opt-in to a narrower sibling-set; here only plugin nodes
    // count, so a Function labeled "Log" does NOT block.
    const nodes = [fnNode('a', 'Log')]
    expect(
      getNextSequencedName(nodes, 'Log', (n) => n.data.nodeType === 'plugin'),
    ).toBe('Log')
  })

  it('is case-sensitive on the base', () => {
    const nodes = [pluginNode('a', 'log'), pluginNode('b', 'LOG_1')]
    expect(getNextSequencedName(nodes, 'Log')).toBe('Log')
  })

  it('ignores user-renamed labels that drift off-pattern', () => {
    const nodes = [pluginNode('a', 'MyLogger'), pluginNode('b', 'Log_2x')]
    expect(getNextSequencedName(nodes, 'Log')).toBe('Log')
  })

  it('supports library-style names with underscores and digits in the base', () => {
    const nodes = [fnNode('a', 'fetch_user'), fnNode('b', 'fetch_user_1')]
    expect(getNextSequencedName(nodes, 'fetch_user')).toBe('fetch_user_2')
  })
})


describe('getNextFunctionInstanceName (Local Function convenience)', () => {
  it('returns the bare "Function" when there are no Function nodes', () => {
    expect(getNextFunctionInstanceName([])).toBe('Function')
  })

  it('returns Function when no existing node uses it', () => {
    const nodes: NodeLike[] = [
      pluginNode('a', 'Shell Script'),
      { id: 'n2', data: { label: 'If', nodeType: 'control' } },
    ]
    expect(getNextFunctionInstanceName(nodes)).toBe('Function')
  })

  it('returns Function_1 when "Function" is taken', () => {
    const nodes: NodeLike[] = [fnNode('a', 'Function')]
    expect(getNextFunctionInstanceName(nodes)).toBe('Function_1')
  })

  it('returns Function_2 when Function + Function_1 are both taken', () => {
    const nodes = [fnNode('a', 'Function'), fnNode('b', 'Function_1')]
    expect(getNextFunctionInstanceName(nodes)).toBe('Function_2')
  })

  it('skips taken integers and returns the lowest free Function_N', () => {
    const nodes = [
      fnNode('a', 'Function'),
      fnNode('b', 'Function_1'),
      fnNode('c', 'Function_3'),
    ]
    expect(getNextFunctionInstanceName(nodes)).toBe('Function_2')
  })

  it('counts shared Function instances as siblings the counter must skip', () => {
    const nodes: NodeLike[] = [fnNode('a', 'Function', 'shared')]
    expect(getNextFunctionInstanceName(nodes)).toBe('Function_1')
  })

  it('canvas-wide collision: a plugin labeled "Function" blocks too', () => {
    const nodes: NodeLike[] = [pluginNode('a', 'Function')]
    expect(getNextFunctionInstanceName(nodes)).toBe('Function_1')
  })

  it('ignores user-renamed Function labels that do not match the pattern', () => {
    const nodes: NodeLike[] = [
      fnNode('a', 'MyHelper'),
      fnNode('b', 'parse_csv'),
    ]
    expect(getNextFunctionInstanceName(nodes)).toBe('Function')
  })
})
