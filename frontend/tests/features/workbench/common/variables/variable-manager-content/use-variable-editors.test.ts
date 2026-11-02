/**
 * useVariableEditors - the row delete handler and the name check a variable window runs.
 *
 * The name check reads the names of the window's own scope: the Test variables at the root, or
 * the inputs, outputs and locals of one Function (one namespace), never the scope the panel shows.
 *
 * REQ-3.1.3.11: Variable watching UI panel
 * REQ-3.1.3.1: Variable scoping with namespace-based access
 * REQ-3.1.2.4: Function validation before save
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'

import { useVariableEditors } from '@/features/workbench/common/variables/variable-manager-content/use-variable-editors'
import type { Variable } from '@/features/workbench/common/variables/variable-manager-content/types'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'

type DrillPath = Array<{ nodeId: string; label: string }>

const ROOT: DrillPath = []
const PATH_A: DrillPath = [{ nodeId: 'fn-a', label: 'Function_A' }]
const PATH_B: DrillPath = [{ nodeId: 'fn-b', label: 'Function_B' }]
const ADD_WINDOW_ID = '__create__'

const ROOT_VARIABLES = [{ id: 'root-1', name: 'root_var', type: 'string', value: 'r' }]
const LOCAL_A = { id: 'loc-a', name: 'loc_n', type: 'integer', value: 1 }
const LOCAL_B = { id: 'loc-b', name: 'only_b', type: 'string', value: 'b' }

function localFunction(
  id: string,
  label: string,
  body: { inputs?: Array<{ name: string; type: string }>; outputs?: Array<{ name: string; type: string }>; variables?: unknown[] },
) {
  return {
    id,
    type: 'workflowNode',
    position: { x: 0, y: 0 },
    data: {
      label,
      nodeType: 'function',
      functionLifecycle: 'local',
      localDefinition: {
        workflow: { nodes: [], edges: [] },
        inputs: body.inputs ?? [],
        outputs: body.outputs ?? [],
        variables: body.variables ?? [],
      },
    },
  }
}

const FUNCTION_A = localFunction('fn-a', 'Function_A', {
  inputs: [{ name: 'region', type: 'string' }],
  outputs: [{ name: 'result', type: 'string' }],
  variables: [LOCAL_A],
})
const FUNCTION_B = localFunction('fn-b', 'Function_B', { variables: [LOCAL_B] })

/** The rows the panel shows for a scope, as the live container builds them. */
const SHOWN_ROWS: Record<'root' | 'a' | 'b', Variable[]> = {
  root: [{ id: 'root-1', name: 'root_var', type: 'string', value: 'r' }],
  a: [
    { id: 'param:input:region', name: 'region', type: 'string', value: null },
    { id: 'param:output:result', name: 'result', type: 'string', value: null },
    { id: 'loc-a', name: 'loc_n', type: 'integer', value: 1 },
  ],
  b: [{ id: 'loc-b', name: 'only_b', type: 'string', value: 'b' }],
}

function showScope(drillPath: DrillPath) {
  act(() => {
    useWorkflowStore.setState({
      nodes: [FUNCTION_A, FUNCTION_B] as never,
      edges: [] as never,
      variables: ROOT_VARIABLES as never,
      drillPath,
    })
  })
}

function renderEditors(shown: Variable[], onVariableDelete?: (id: string) => void) {
  return renderHook(() => useVariableEditors({ variables: shown, onVariableDelete }))
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  act(() => {
    useWorkflowStore.setState({ nodes: [] as never, edges: [] as never, variables: [] as never, drillPath: [] })
  })
})

describe("useVariableEditors - the name check reads the window's own scope", () => {
  it('refuses a Test variable name in a Test-root window while a Function is shown', () => {
    showScope(PATH_B)
    const { result } = renderEditors(SHOWN_ROWS.b)

    expect(result.current.checkNameExists('root_var', ADD_WINDOW_ID, ROOT)).toBe(true)
  })

  it('accepts in a Test-root window a name only the shown Function uses', () => {
    showScope(PATH_B)
    const { result } = renderEditors(SHOWN_ROWS.b)

    expect(result.current.checkNameExists('only_b', ADD_WINDOW_ID, ROOT)).toBe(false)
  })

  it.each(['region', 'result', 'loc_n'])(
    'refuses %s in a window of the Function that declares it while another Function is shown',
    (name) => {
      showScope(PATH_B)
      const { result } = renderEditors(SHOWN_ROWS.b)

      expect(result.current.checkNameExists(name, ADD_WINDOW_ID, PATH_A)).toBe(true)
    },
  )

  it('accepts in a Function window a name free there but taken in the shown scope', () => {
    showScope(PATH_B)
    const { result } = renderEditors(SHOWN_ROWS.b)

    expect(result.current.checkNameExists('only_b', ADD_WINDOW_ID, PATH_A)).toBe(false)
  })

  it('accepts in a Function window the name of a Test variable (a Function shadows the Test)', () => {
    showScope(PATH_A)
    const { result } = renderEditors(SHOWN_ROWS.a)

    expect(result.current.checkNameExists('root_var', ADD_WINDOW_ID, PATH_A)).toBe(false)
  })

  it('reads the shown Test root when the window names no scope', () => {
    showScope(ROOT)
    const { result } = renderEditors(SHOWN_ROWS.root)

    expect(result.current.checkNameExists('root_var', ADD_WINDOW_ID, undefined)).toBe(true)
    expect(result.current.checkNameExists('loc_n', ADD_WINDOW_ID, undefined)).toBe(false)
  })

  it('accepts the saved name of the Test variable an Edit window edits', () => {
    showScope(ROOT)
    const { result } = renderEditors(SHOWN_ROWS.root)

    expect(result.current.checkNameExists('root_var', 'root-1', ROOT)).toBe(false)
  })

  it.each([
    ['loc_n', 'loc-a'],
    ['region', 'param:input:region'],
    ['result', 'param:output:result'],
  ])('accepts the saved name %s of the Function variable an Edit window edits', (name, id) => {
    showScope(PATH_A)
    const { result } = renderEditors(SHOWN_ROWS.a)

    expect(result.current.checkNameExists(name, id, PATH_A)).toBe(false)
  })

  it('refuses in an Edit window a name another input, output or local of its Function uses', () => {
    showScope(PATH_A)
    const { result } = renderEditors(SHOWN_ROWS.a)

    expect(result.current.checkNameExists('region', 'loc-a', PATH_A)).toBe(true)
    expect(result.current.checkNameExists('loc_n', 'param:output:result', PATH_A)).toBe(true)
  })
})

describe('useVariableEditors - row delete', () => {
  it('hands the row id to the delete handler', () => {
    const onVariableDelete = vi.fn()
    const { result } = renderEditors(SHOWN_ROWS.root, onVariableDelete)

    result.current.handleDelete('root-1')

    expect(onVariableDelete).toHaveBeenCalledTimes(1)
    expect(onVariableDelete).toHaveBeenCalledWith('root-1')
  })

  it('does nothing when the panel has no delete handler', () => {
    const { result } = renderEditors(SHOWN_ROWS.root)

    expect(() => result.current.handleDelete('root-1')).not.toThrow()
  })
})
