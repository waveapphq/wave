/**
 * Variable usage of a scope - which names its Blocks and variables use.
 *
 * Module: frontend/src/features/workbench/lib/variable-usage.ts
 *
 * The live and the run page Variable Manager read one usage scan, so a row is
 * Unused only when no Block of the shown scope reads or writes the name and no
 * other variable reads it (REQ-3.1.3.6, VMGR-105).
 */

import { describe, it, expect } from 'vitest'

import { scopeBlockUsage, scopeReferencedNames } from '@/features/workbench/lib/variable-usage'

function block(id: string, data: Record<string, unknown>) {
  return { id, type: 'workflowNode', position: { x: 0, y: 0 }, data }
}

const PARSER = block('parse', {
  label: 'Parse CSV',
  elementType: 'csv-parser',
  nodeType: 'plugin',
  expressionFields: ['csv_content'],
  config: { values: { csv_content: 'region_label + api_token' }, outputBindings: { table: 'parsed_rows' } },
})

const LOG = block('log', {
  label: 'Log',
  elementType: 'log',
  nodeType: 'plugin',
  expressionFields: ['message'],
  config: { values: { message: 'log_note' } },
})

describe('scopeBlockUsage', () => {
  it('counts the Blocks that read a name and keeps the Blocks that bind an output', () => {
    const usage = scopeBlockUsage([PARSER, LOG, block('log-2', { ...LOG.data, label: 'Log again' })], [])

    expect(usage.inputRefCounts.get('region_label')).toBe(1)
    expect(usage.inputRefCounts.get('log_note')).toBe(2)
    expect(usage.outputBoundVarNames).toEqual(new Set(['parsed_rows']))
    expect(usage.outputBoundVarSources.get('parsed_rows')).toEqual(['Parse CSV'])
    expect(usage.blockWrittenNames).toEqual(new Set(['parsed_rows']))
  })

  it('names a Block with no label as an empty source and skips an unbound output', () => {
    const usage = scopeBlockUsage(
      [
        block('bare', { config: { outputBindings: { code: 'status', body: '' } } }),
        block('again', { label: 'Again', config: { outputBindings: { code: 'status' } } }),
      ],
      [],
    )

    expect(usage.outputBoundVarSources).toEqual(new Map([['status', ['', 'Again']]]))
    expect(usage.outputBoundVarNames).toEqual(new Set(['status']))
  })

  it('reads the Blocks of the drilled Function, not the root canvas', () => {
    const fn = block('fn-1', {
      label: 'Fn',
      nodeType: 'function',
      functionLifecycle: 'local',
      localDefinition: { workflow: { nodes: [LOG], edges: [] }, variables: [] },
    })

    const usage = scopeBlockUsage([PARSER, fn], [{ nodeId: 'fn-1', label: 'Fn' }])

    expect([...usage.inputRefCounts.keys()]).toEqual(['log_note'])
    expect(usage.outputBoundVarNames.size).toBe(0)
  })
})

describe('scopeReferencedNames', () => {
  it('holds every name a Block reads or writes and every name another variable reads', () => {
    const usage = scopeBlockUsage([PARSER, LOG], [])
    const rows = [
      { name: 'greeting', value: 'Hello {{ user_name }}', isTemplate: true },
      { name: 'total', value: 'base + 1', isExpression: true },
      { name: 'spare_count', value: 0 },
    ]

    expect(scopeReferencedNames(usage, rows)).toEqual(
      new Set(['region_label', 'api_token', 'log_note', 'parsed_rows', 'user_name', 'base']),
    )
  })

  it('leaves out a self-reference, the names every expression has and a source that is not text', () => {
    const rows = [
      { name: 'counter', value: 'counter + len([1]) if True else None', isExpression: true },
      { name: 'unset', value: null, isExpression: true },
    ]

    expect(scopeReferencedNames(scopeBlockUsage([], []), rows)).toEqual(new Set())
  })
})
