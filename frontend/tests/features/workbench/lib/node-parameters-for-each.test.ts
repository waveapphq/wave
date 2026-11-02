/**
 * ForEach Loop Control Parameter Definition Tests
 *
 * Tests for the ForEach loop control's input/output parameter schema.
 * Tests define the contract for for-each.ts implementation.
 */

import { describe, it, expect } from 'vitest'
import {
  CONTROL_INPUTS,
  CONTROL_OUTPUTS,
  getInputParams,
  getOutputParams,
} from '@/features/workbench/lib/node-parameters'

describe('ForEach Loop Control Parameters', () => {
  // ---------------------------------------------------------------------------
  // Registry presence
  // ---------------------------------------------------------------------------

  it('exists in CONTROL_INPUTS registry', () => {
    expect(CONTROL_INPUTS['for-each']).toBeDefined()
  })

  it('exists in CONTROL_OUTPUTS registry', () => {
    expect(CONTROL_OUTPUTS['for-each']).toBeDefined()
  })

  it('is accessible via getInputParams', () => {
    const inputs = getInputParams('for-each')
    expect(inputs).toBeDefined()
    expect(inputs!.length).toBeGreaterThan(0)
  })

  it('is accessible via getOutputParams', () => {
    const outputs = getOutputParams('for-each')
    expect(outputs).toBeDefined()
    expect(outputs!.length).toBeGreaterThan(0)
  })

  // ---------------------------------------------------------------------------
  // Input parameter count and names
  // ---------------------------------------------------------------------------

  it('has exactly 2 input parameters', () => {
    const inputs = CONTROL_INPUTS['for-each']
    expect(inputs).toHaveLength(2)
  })

  it('has input parameters in correct order (collection, timeout)', () => {
    const inputs = CONTROL_INPUTS['for-each']
    expect(inputs[0].name).toBe('collection')
    expect(inputs[1].name).toBe('timeout')
  })

  // ---------------------------------------------------------------------------
  // Collection parameter
  // ---------------------------------------------------------------------------

  describe('collection parameter', () => {
    it('has name "collection"', () => {
      const inputs = CONTROL_INPUTS['for-each']
      const collection = inputs.find((p) => p.name === 'collection')
      expect(collection).toBeDefined()
    })

    it('has label "Collection"', () => {
      const inputs = CONTROL_INPUTS['for-each']
      const collection = inputs.find((p) => p.name === 'collection')!
      expect(collection.label).toBe('Collection')
    })

    it('has type "array"', () => {
      const inputs = CONTROL_INPUTS['for-each']
      const collection = inputs.find((p) => p.name === 'collection')!
      expect(collection.type).toBe('array')
    })

    it('is required', () => {
      const inputs = CONTROL_INPUTS['for-each']
      const collection = inputs.find((p) => p.name === 'collection')!
      expect(collection.required).toBe(true)
    })

    it('has a non-empty description', () => {
      const inputs = CONTROL_INPUTS['for-each']
      const collection = inputs.find((p) => p.name === 'collection')!
      expect(collection.description).toBeTruthy()
      expect(collection.description!.length).toBeGreaterThan(0)
    })

    it('has variableRef property with allowed types', () => {
      const inputs = CONTROL_INPUTS['for-each']
      const collection = inputs.find((p) => p.name === 'collection')!
      expect((collection as any).variableRef).toBeDefined()
    })

    it('has variableRef.types containing array, map, and table', () => {
      const inputs = CONTROL_INPUTS['for-each']
      const collection = inputs.find((p) => p.name === 'collection')!
      const variableRef = (collection as any).variableRef as { types: string[] }
      expect(variableRef.types).toEqual(['array', 'map', 'table'])
    })

    it('has selectableType with array, map, table options', () => {
      const inputs = CONTROL_INPUTS['for-each']
      const collection = inputs.find((p) => p.name === 'collection')!
      const selectableType = (collection as any).selectableType as { options: string[] }
      expect(selectableType).toBeDefined()
      expect(selectableType.options).toEqual(['array', 'map', 'table'])
    })

    it('has no enumValues', () => {
      const inputs = CONTROL_INPUTS['for-each']
      const collection = inputs.find((p) => p.name === 'collection')!
      expect(collection.enumValues).toBeUndefined()
    })

    it('has no defaultValue', () => {
      const inputs = CONTROL_INPUTS['for-each']
      const collection = inputs.find((p) => p.name === 'collection')!
      expect(collection.defaultValue).toBeUndefined()
    })

    it('has no group (not in Advanced section)', () => {
      const inputs = CONTROL_INPUTS['for-each']
      const collection = inputs.find((p) => p.name === 'collection')!
      expect(collection.group).toBeUndefined()
    })

    it('has no showWhen condition', () => {
      const inputs = CONTROL_INPUTS['for-each']
      const collection = inputs.find((p) => p.name === 'collection')!
      expect(collection.showWhen).toBeUndefined()
    })

    it('does not have noExpression flag', () => {
      const inputs = CONTROL_INPUTS['for-each']
      const collection = inputs.find((p) => p.name === 'collection')!
      expect(collection.noExpression).toBeUndefined()
    })
  })

  // ---------------------------------------------------------------------------
  // Timeout parameter
  // ---------------------------------------------------------------------------

  describe('timeout parameter', () => {
    it('has name "timeout"', () => {
      const inputs = CONTROL_INPUTS['for-each']
      const timeout = inputs.find((p) => p.name === 'timeout')
      expect(timeout).toBeDefined()
    })

    it('has label "Timeout"', () => {
      const inputs = CONTROL_INPUTS['for-each']
      const timeout = inputs.find((p) => p.name === 'timeout')!
      expect(timeout.label).toBe('Timeout')
    })

    it('has type "float"', () => {
      const inputs = CONTROL_INPUTS['for-each']
      const timeout = inputs.find((p) => p.name === 'timeout')!
      expect(timeout.type).toBe('float')
    })

    it('is not required', () => {
      const inputs = CONTROL_INPUTS['for-each']
      const timeout = inputs.find((p) => p.name === 'timeout')!
      expect(timeout.required).toBe(false)
    })

    it('has a non-empty description referencing seconds', () => {
      const inputs = CONTROL_INPUTS['for-each']
      const timeout = inputs.find((p) => p.name === 'timeout')!
      expect(timeout.description).toBeTruthy()
      expect(timeout.description!.toLowerCase()).toContain('seconds')
    })

    it('has group "Advanced"', () => {
      const inputs = CONTROL_INPUTS['for-each']
      const timeout = inputs.find((p) => p.name === 'timeout')!
      expect(timeout.group).toBe('Advanced')
    })

    it('has no defaultValue', () => {
      const inputs = CONTROL_INPUTS['for-each']
      const timeout = inputs.find((p) => p.name === 'timeout')!
      expect(timeout.defaultValue).toBeUndefined()
    })

    it('does not have variableRef', () => {
      const inputs = CONTROL_INPUTS['for-each']
      const timeout = inputs.find((p) => p.name === 'timeout')!
      expect((timeout as any).variableRef).toBeUndefined()
    })

    it('has no showWhen condition', () => {
      const inputs = CONTROL_INPUTS['for-each']
      const timeout = inputs.find((p) => p.name === 'timeout')!
      expect(timeout.showWhen).toBeUndefined()
    })

    it('has no enumValues', () => {
      const inputs = CONTROL_INPUTS['for-each']
      const timeout = inputs.find((p) => p.name === 'timeout')!
      expect(timeout.enumValues).toBeUndefined()
    })
  })

  // ---------------------------------------------------------------------------
  // Output parameter count and names
  // ---------------------------------------------------------------------------

  it('has exactly 2 output parameters', () => {
    const outputs = CONTROL_OUTPUTS['for-each']
    expect(outputs).toHaveLength(2)
  })

  it('has output parameters in correct order (item, index)', () => {
    const outputs = CONTROL_OUTPUTS['for-each']
    expect(outputs[0].name).toBe('item')
    expect(outputs[1].name).toBe('index')
  })

  // ---------------------------------------------------------------------------
  // Item output parameter
  // ---------------------------------------------------------------------------

  describe('item output parameter', () => {
    it('has name "item"', () => {
      const outputs = CONTROL_OUTPUTS['for-each']
      const item = outputs.find((o) => o.name === 'item')
      expect(item).toBeDefined()
    })

    it('has label "Item"', () => {
      const outputs = CONTROL_OUTPUTS['for-each']
      const item = outputs.find((o) => o.name === 'item')!
      expect(item.label).toBe('Item')
    })

    it('has type "map" (typed envelope)', () => {
      const outputs = CONTROL_OUTPUTS['for-each']
      const item = outputs.find((o) => o.name === 'item')!
      expect(item.type).toBe('map')
    })

    it('has a non-empty description', () => {
      const outputs = CONTROL_OUTPUTS['for-each']
      const item = outputs.find((o) => o.name === 'item')!
      expect(item.description).toBeTruthy()
      expect(item.description!.length).toBeGreaterThan(0)
    })
  })

  // ---------------------------------------------------------------------------
  // Index output parameter
  // ---------------------------------------------------------------------------

  describe('index output parameter', () => {
    it('has name "index"', () => {
      const outputs = CONTROL_OUTPUTS['for-each']
      const index = outputs.find((o) => o.name === 'index')
      expect(index).toBeDefined()
    })

    it('has label "Index"', () => {
      const outputs = CONTROL_OUTPUTS['for-each']
      const index = outputs.find((o) => o.name === 'index')!
      expect(index.label).toBe('Index')
    })

    it('has type "integer" (0-based counter)', () => {
      const outputs = CONTROL_OUTPUTS['for-each']
      const index = outputs.find((o) => o.name === 'index')!
      expect(index.type).toBe('integer')
    })

    it('has a non-empty description', () => {
      const outputs = CONTROL_OUTPUTS['for-each']
      const index = outputs.find((o) => o.name === 'index')!
      expect(index.description).toBeTruthy()
      expect(index.description!.length).toBeGreaterThan(0)
    })
  })

  // ---------------------------------------------------------------------------
  // Removed old parameters (contract: old stub params should not exist)
  // ---------------------------------------------------------------------------

  describe('removed old stub parameters', () => {
    it('does not have old "variable" input parameter', () => {
      const inputs = CONTROL_INPUTS['for-each']
      const variable = inputs.find((p) => p.name === 'variable')
      expect(variable).toBeUndefined()
    })
  })

  // ---------------------------------------------------------------------------
  // Version-specific behavior
  // ---------------------------------------------------------------------------

  describe('version-specific lookups', () => {
    it('returns full parameters for production version (1.0.0)', () => {
      const inputs = getInputParams('for-each')
      expect(inputs).toBeDefined()
      expect(inputs).toHaveLength(2)

      const outputs = getOutputParams('for-each')
      expect(outputs).toBeDefined()
      expect(outputs).toHaveLength(2)
    })
  })
})
