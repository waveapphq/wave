/**
 * InputParam variableRef Extension Tests
 *
 * Tests for the variableRef property on InputParam interface
 * and the param() factory function's support for it.
 */

import { describe, it, expect } from 'vitest'
import { param, type InputParam } from '@/features/workbench/lib/node-parameters/types'

describe('InputParam variableRef property', () => {
  it('param() factory accepts variableRef in opts', () => {
    const result = param('collection', 'Collection', 'string', true, 'Test description', {
      variableRef: { types: ['array', 'map', 'table'] },
    })
    expect(result.variableRef).toBeDefined()
    expect(result.variableRef!.types).toEqual(['array', 'map', 'table'])
  })

  it('param() factory produces InputParam with variableRef preserved', () => {
    const result: InputParam = param('test', 'Test', 'string', true, 'desc', {
      variableRef: { types: ['array'] },
    })
    expect(result.name).toBe('test')
    expect(result.label).toBe('Test')
    expect(result.type).toBe('string')
    expect(result.required).toBe(true)
    expect(result.description).toBe('desc')
    expect(result.variableRef).toEqual({ types: ['array'] })
  })

  it('param() factory without variableRef leaves it undefined', () => {
    const result = param('timeout', 'Timeout', 'float', false, 'Some timeout')
    expect(result.variableRef).toBeUndefined()
  })

  it('param() factory with empty types array', () => {
    const result = param('empty', 'Empty', 'string', false, 'desc', {
      variableRef: { types: [] },
    })
    expect(result.variableRef).toBeDefined()
    expect(result.variableRef!.types).toEqual([])
  })

  it('param() factory with variableRef alongside other opts', () => {
    const result = param('combined', 'Combined', 'string', true, 'desc', {
      variableRef: { types: ['map'] },
      group: 'Advanced',
    })
    expect(result.variableRef).toEqual({ types: ['map'] })
    expect(result.group).toBe('Advanced')
  })

  it('variableRef types can include any combination of collection types', () => {
    const withArray = param('a', 'A', 'string', true, 'desc', {
      variableRef: { types: ['array'] },
    })
    expect(withArray.variableRef!.types).toEqual(['array'])

    const withMap = param('b', 'B', 'string', true, 'desc', {
      variableRef: { types: ['map'] },
    })
    expect(withMap.variableRef!.types).toEqual(['map'])

    const withTable = param('c', 'C', 'string', true, 'desc', {
      variableRef: { types: ['table'] },
    })
    expect(withTable.variableRef!.types).toEqual(['table'])

    const withAll = param('d', 'D', 'string', true, 'desc', {
      variableRef: { types: ['array', 'map', 'table'] },
    })
    expect(withAll.variableRef!.types).toEqual(['array', 'map', 'table'])
  })
})
