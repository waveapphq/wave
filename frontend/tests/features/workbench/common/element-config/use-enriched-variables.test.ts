/**
 * Tests for useEnrichedVariables hook.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useEnrichedVariables } from '@/features/workbench/common/element-config/use-enriched-variables'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'

beforeEach(() => {
  useWorkflowStore.getState().reset()
})

describe('useEnrichedVariables', () => {
  it('returns store variables with output source enrichment', () => {
    useWorkflowStore.getState().setVariables([
      { id: 'v1', name: 'endpoint', value: 'http://test', type: 'string' },
    ])

    const { result } = renderHook(() => useEnrichedVariables([]))

    expect(result.current.some((v) => v.name === 'endpoint')).toBe(true)
  })

  it('names the block that writes a variable by its Name, never by its Description', () => {
    useWorkflowStore.getState().setVariables([
      { id: 'v1', name: 'rows', value: '', type: 'string' },
    ])
    useWorkflowStore.getState().setNodes([
      {
        id: 'n1',
        type: 'workflowNode',
        position: { x: 0, y: 0 },
        data: {
          label: 'Load rows',
          description: 'Loads the seed rows before the checks run',
          elementType: 'log',
          nodeType: 'plugin',
          config: { values: {}, profileBindings: [], outputBindings: { message: 'rows' } },
        },
      },
    ])

    const { result } = renderHook(() => useEnrichedVariables([]))

    expect(result.current.find((v) => v.name === 'rows')!.source).toBe('Load rows')
  })

  it('includes namespace dotted entries for system-scope variables from namespace store', () => {
    useWorkflowStore.getState().setVariables([
      { id: 'v1', name: 'my_var', value: 'test', type: 'string' },
    ])
    useWorkflowStore.getState().setNamespaceVariables('system', [
      { name: 'api_host', type: 'string' },
      { name: 'timeout', type: 'integer' },
    ])

    const { result } = renderHook(() => useEnrichedVariables([]))

    // Original flat variables
    expect(result.current.some((v) => v.name === 'my_var')).toBe(true)

    // Namespace top-level entry
    const systemEntry = result.current.find((v) => v.name === 'system')
    expect(systemEntry).toBeDefined()
    expect(systemEntry!.type).toBe('object')
    expect(systemEntry!.source).toBe('System Variables')

    // Namespace dotted entries
    const dottedHost = result.current.find((v) => v.name === 'system.api_host')
    expect(dottedHost).toBeDefined()
    expect(dottedHost!.type).toBe('string')
    expect(dottedHost!.source).toBe('System Variables')

    const dottedTimeout = result.current.find((v) => v.name === 'system.timeout')
    expect(dottedTimeout).toBeDefined()
    expect(dottedTimeout!.type).toBe('integer')
  })

  it('does not add namespace entries when no system variables exist', () => {
    useWorkflowStore.getState().setVariables([
      { id: 'v1', name: 'my_var', value: 'test', type: 'string' },
    ])

    const { result } = renderHook(() => useEnrichedVariables([]))

    expect(result.current.some((v) => v.name === 'system')).toBe(false)
    expect(result.current.some((v) => v.name.startsWith('system.'))).toBe(false)
  })

  it('includes namespace dotted entries for suite-scope variables from namespace store', () => {
    useWorkflowStore.getState().setVariables([
      { id: 'v1', name: 'my_var', value: 'test', type: 'string' },
    ])
    useWorkflowStore.getState().setNamespaceVariables('suite', [
      { name: 'base_url', type: 'string', sources: ['Auth Suite'] },
      { name: 'timeout', type: 'integer', sources: ['Auth Suite', 'API Suite'] },
    ])

    const { result } = renderHook(() => useEnrichedVariables([]))

    // Original flat variables
    expect(result.current.some((v) => v.name === 'my_var')).toBe(true)

    // Suite namespace top-level entry
    const suiteEntry = result.current.find((v) => v.name === 'suite')
    expect(suiteEntry).toBeDefined()
    expect(suiteEntry!.type).toBe('object')

    // Suite namespace dotted entries
    const dottedUrl = result.current.find((v) => v.name === 'suite.base_url')
    expect(dottedUrl).toBeDefined()
    expect(dottedUrl!.type).toBe('string')
    expect(dottedUrl!.source).toBe('Suite')

    const dottedTimeout = result.current.find((v) => v.name === 'suite.timeout')
    expect(dottedTimeout).toBeDefined()
    expect(dottedTimeout!.type).toBe('integer')
    expect(dottedTimeout!.source).toBe('Suite')
  })

  it('does not add suite namespace entries when no suite variables exist', () => {
    useWorkflowStore.getState().setVariables([
      { id: 'v1', name: 'my_var', value: 'test', type: 'string' },
    ])

    const { result } = renderHook(() => useEnrichedVariables([]))

    expect(result.current.some((v) => v.name === 'suite')).toBe(false)
    expect(result.current.some((v) => v.name.startsWith('suite.'))).toBe(false)
  })

  it('includes namespace dotted entries for regression-scope variables from namespace store', () => {
    useWorkflowStore.getState().setVariables([
      { id: 'v1', name: 'my_var', value: 'test', type: 'string' },
    ])
    useWorkflowStore.getState().setNamespaceVariables('regression', [
      { name: 'env_name', type: 'string', sources: ['Smoke Regression'] },
      { name: 'max_parallel', type: 'integer', sources: ['Smoke Regression'] },
    ])

    const { result } = renderHook(() => useEnrichedVariables([]))

    // Original flat variables
    expect(result.current.some((v) => v.name === 'my_var')).toBe(true)

    // Regression namespace top-level entry
    const regressionEntry = result.current.find((v) => v.name === 'regression')
    expect(regressionEntry).toBeDefined()
    expect(regressionEntry!.type).toBe('object')

    // Regression namespace dotted entries
    const dottedEnv = result.current.find((v) => v.name === 'regression.env_name')
    expect(dottedEnv).toBeDefined()
    expect(dottedEnv!.type).toBe('string')
    expect(dottedEnv!.source).toBe('Regression')

    const dottedParallel = result.current.find((v) => v.name === 'regression.max_parallel')
    expect(dottedParallel).toBeDefined()
    expect(dottedParallel!.type).toBe('integer')
    expect(dottedParallel!.source).toBe('Regression')
  })

  it('does not add regression namespace entries when no regression variables exist', () => {
    useWorkflowStore.getState().setVariables([
      { id: 'v1', name: 'my_var', value: 'test', type: 'string' },
    ])

    const { result } = renderHook(() => useEnrichedVariables([]))

    expect(result.current.some((v) => v.name === 'regression')).toBe(false)
    expect(result.current.some((v) => v.name.startsWith('regression.'))).toBe(false)
  })

  it('merges profile bindings with namespace entries', () => {
    useWorkflowStore.getState().setNamespaceVariables('system', [
      { name: 'host', type: 'string' },
    ])

    const { result } = renderHook(() =>
      useEnrichedVariables([
        {
          profileId: 'p1',
          profileName: 'My Server',
          profileType: 'http',
          alias: 'srv',
          fields: [{ name: 'url', type: 'string' }],
        },
      ])
    )

    // Profile entries
    expect(result.current.some((v) => v.name === 'srv')).toBe(true)
    expect(result.current.some((v) => v.name === 'srv.url')).toBe(true)

    // System namespace entries
    expect(result.current.some((v) => v.name === 'system')).toBe(true)
    expect(result.current.some((v) => v.name === 'system.host')).toBe(true)
  })

  // Inside a drilled-in Function autocomplete surfaces only the Function's declared
  // inputs / outputs / locals; root variables and namespace vars stay hidden.
  describe('inside a drilled-in Function', () => {
    it('returns declared inputs, outputs, and locals from the active Function', () => {
      useWorkflowStore.getState().setVariables([
        { id: 'root-1', name: 'root_var', value: 'x', type: 'string' },
      ])
      useWorkflowStore.getState().setNamespaceVariables('system', [
        { name: 'host', type: 'string' },
      ])
      useWorkflowStore.getState().setNodes([
        {
          id: 'fn-1',
          type: 'workflowNode',
          position: { x: 0, y: 0 },
          data: {
            label: 'Function_1',
            elementType: 'function',
            nodeType: 'function',
            functionLifecycle: 'local',
            localDefinition: {
              workflow: { nodes: [], edges: [] },
              inputs: [{ name: 'fn_input', type: 'string', default: 'hello' }],
              outputs: [{ name: 'fn_output', type: 'integer' }],
              variables: [{ id: 'inner-1', name: 'tmp', value: 'y', type: 'string' }],
            },
          },
        },
      ])
      useWorkflowStore.getState().pushDrill('fn-1')

      const { result } = renderHook(() => useEnrichedVariables([]))

      const names = result.current.map((v) => v.name)
      expect(names).toContain('fn_input')
      expect(names).toContain('fn_output')
      expect(names).toContain('tmp')
      // Root and namespace entries must NOT leak into the Function scope.
      expect(names).not.toContain('root_var')
      expect(names).not.toContain('system')
      expect(names).not.toContain('system.host')
    })

    it('names the Block inside the Function that writes a local as its source', () => {
      useWorkflowStore.getState().setNodes([
        {
          id: 'fn-1',
          type: 'workflowNode',
          position: { x: 0, y: 0 },
          data: {
            label: 'Function_1',
            elementType: 'function',
            nodeType: 'function',
            functionLifecycle: 'local',
            localDefinition: {
              workflow: {
                nodes: [
                  {
                    id: 'inner-log',
                    type: 'workflowNode',
                    position: { x: 0, y: 0 },
                    data: {
                      label: 'Load rows',
                      elementType: 'log',
                      nodeType: 'plugin',
                      config: { values: {}, profileBindings: [], outputBindings: { message: 'rows' } },
                    },
                  },
                ],
                edges: [],
              },
              inputs: [],
              outputs: [],
              variables: [{ id: 'inner-1', name: 'rows', value: null, type: 'string' }],
            },
          },
        },
      ])
      useWorkflowStore.getState().pushDrill('fn-1')

      const { result } = renderHook(() => useEnrichedVariables([]))

      const rows = result.current.find((v) => v.name === 'rows')
      expect(rows?.source).toBe('Load rows')
      expect(rows?.isOutputBinding).toBe(true)
    })

    it('offers a profile alias bound on another Block inside the Function', () => {
      useWorkflowStore.getState().setNodes([
        {
          id: 'fn-1',
          type: 'workflowNode',
          position: { x: 0, y: 0 },
          data: {
            label: 'Function_1',
            elementType: 'function',
            nodeType: 'function',
            functionLifecycle: 'local',
            localDefinition: {
              workflow: {
                nodes: [
                  {
                    id: 'inner-sql',
                    type: 'workflowNode',
                    position: { x: 0, y: 0 },
                    data: {
                      label: 'Query users',
                      elementType: 'sql-client',
                      nodeType: 'plugin',
                      config: {
                        values: {},
                        profileBindings: [{ profileId: 'p1', profileName: 'Main DB', alias: 'db', bindings: {} }],
                      },
                    },
                  },
                ],
                edges: [],
              },
              inputs: [{ name: 'fn_input', type: 'string' }],
              outputs: [],
              variables: [],
            },
          },
        },
      ])
      useWorkflowStore.getState().pushDrill('fn-1')

      const { result } = renderHook(() => useEnrichedVariables([]))

      const names = result.current.map((v) => v.name)
      expect(names).toContain('fn_input')
      expect(names).toContain('db')
    })

    it('takes an alias the open Block binds itself from its own binding, and keeps the others', () => {
      const innerSql = (alias: string) => ({
        id: `inner-${alias}`,
        type: 'workflowNode' as const,
        position: { x: 0, y: 0 },
        data: {
          label: `Query ${alias}`,
          elementType: 'sql-client',
          nodeType: 'plugin' as const,
          config: { values: {}, profileBindings: [{ profileId: `p-${alias}`, profileName: 'Main DB', alias, bindings: {} }] },
        },
      })
      useWorkflowStore.getState().setNodes([
        {
          id: 'fn-1',
          type: 'workflowNode',
          position: { x: 0, y: 0 },
          data: {
            label: 'Function_1',
            elementType: 'function',
            nodeType: 'function',
            functionLifecycle: 'local',
            localDefinition: {
              workflow: { nodes: [innerSql('db'), innerSql('cache')], edges: [] },
              inputs: [],
              outputs: [],
              variables: [],
            },
          },
        },
      ])
      useWorkflowStore.getState().pushDrill('fn-1')

      const own = [{ profileId: 'p-own', profileName: 'Own DB', alias: 'db', bindings: {}, fields: [{ name: 'host' }] }]
      const { result } = renderHook(() => useEnrichedVariables(own as never))

      const db = result.current.filter((v) => v.name === 'db')
      expect(db).toHaveLength(1)
      expect(db[0].id).toBe('profile-p-own')
      expect(result.current.map((v) => v.name)).toEqual(expect.arrayContaining(['cache', 'db.host']))
    })

    it('returns empty list if the drill path points at a missing node', () => {
      useWorkflowStore.getState().setNodes([
        {
          id: 'placeholder',
          type: 'workflowNode',
          position: { x: 0, y: 0 },
          data: {
            label: 'Placeholder',
            elementType: 'function',
            nodeType: 'function',
            functionLifecycle: 'local',
            localDefinition: {
              workflow: { nodes: [], edges: [] },
              inputs: [],
              outputs: [],
              variables: [],
            },
          },
        },
      ])
      useWorkflowStore.getState().pushDrill('placeholder')
      // Remove the node out from under the drill stack so walkActiveSubtree
      // degrades to the root tree and the hook falls back to an empty list.
      useWorkflowStore.setState({ nodes: [] })

      const { result } = renderHook(() => useEnrichedVariables([]))

      expect(result.current).toEqual([])
    })

    it('returns empty list when a drill entry is a non-Function node (walkActiveSubtree throws)', () => {
      useWorkflowStore.setState({
        nodes: [
          { id: 'plug-1', type: 'workflowNode', position: { x: 0, y: 0 }, data: { label: 'Log', nodeType: 'plugin', elementType: 'log' } },
        ] as unknown as never,
        drillPath: [{ nodeId: 'plug-1', label: 'Log' }],
      })

      const { result } = renderHook(() => useEnrichedVariables([]))

      expect(result.current).toEqual([])
    })

    it('uses [] fallbacks when the Function localDefinition has no inputs/outputs keys', () => {
      // Defensive: partial Function fixtures may omit the inputs and outputs
      // arrays entirely. The hook must still return the locals without
      // crashing on `inputs.map`.
      useWorkflowStore.getState().setNodes([
        {
          id: 'fn-sparse',
          type: 'workflowNode',
          position: { x: 0, y: 0 },
          data: {
            label: 'Sparse',
            elementType: 'function',
            nodeType: 'function',
            functionLifecycle: 'local',
            localDefinition: {
              workflow: { nodes: [], edges: [] },
              variables: [
                { id: 'inner-1', name: 'tmp', value: 'y', type: 'string' },
              ],
            } as unknown as never,
          },
        },
      ])
      useWorkflowStore.getState().pushDrill('fn-sparse')

      const { result } = renderHook(() => useEnrichedVariables([]))

      const names = result.current.map((v) => v.name)
      expect(names).toEqual(['tmp'])
    })
  })
})
