/**
 * Tests for save-utils shared utilities
 *
 * Verifies buildVariablesPayload (variable filtering and transformation)
 * and handleSaveError (422 validation details,
 * and console.warn fallback).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildVariablesPayload, handleSaveError, resyncSealedNodeSecrets, sanitizeEdgesForSave, sanitizeNodesForSave } from '@/features/workbench/live/save-utils'
import type { EdgeType, NodeType, WorkflowVariable } from '@/features/workbench/stores/workflow-store'
import type { SaveErrorHandlers, ToastHandle } from '@/features/workbench/live/save-utils'
import { usePageBlockStore } from '@/stores/page-block-store'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import { useDeletedTestStore } from '@/features/workbench/stores/deleted-test-store'

const { mockFetchTestWorkflow } = vi.hoisted(() => ({ mockFetchTestWorkflow: vi.fn() }))
vi.mock('@/features/tests/api/crud', () => ({
  fetchTestWorkflow: mockFetchTestWorkflow,
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeVariable(overrides: Partial<WorkflowVariable> & { name: string }): WorkflowVariable {
  return {
    id: overrides.id ?? `id-${overrides.name}`,
    value: overrides.value ?? '',
    type: overrides.type ?? 'string',
    isExpression: overrides.isExpression,
    isTemplate: overrides.isTemplate,
    isSecret: overrides.isSecret,
    name: overrides.name,
  }
}

function makeToast(): ToastHandle {
  return { error: vi.fn() }
}

function makeHandlers(): SaveErrorHandlers {
  return {
    setValidationErrors: vi.fn(),
    setValidationFatal: vi.fn(),
    setValidationMode: vi.fn(),
    setShowValidationErrorDialog: vi.fn(),
  }
}

// ---------------------------------------------------------------------------
// Tests: buildVariablesPayload
// ---------------------------------------------------------------------------

describe('buildVariablesPayload - element types (REQ-3.1.3.19)', () => {
  it('stores the element types of an array / map literal with a value', () => {
    const result = buildVariablesPayload([
      { id: 'm', name: 'm', type: 'map', value: { n: '16' }, elementTypes: { n: 'integer' } },
      { id: 'a', name: 'a', type: 'array', value: ['1.0'], elementTypes: ['float'] },
    ])
    expect(result.m).toEqual({ type: 'map', value: { n: '16' }, elementTypes: { n: 'integer' } })
    expect(result.a).toEqual({ type: 'array', value: ['1.0'], elementTypes: ['float'] })
  })

  it('drops element types from an unset value, an expression and a scalar', () => {
    const result = buildVariablesPayload([
      { id: 'u', name: 'u', type: 'map', elementTypes: { n: 'integer' } },
      { id: 'e', name: 'e', type: 'map', value: 'src', isExpression: true, elementTypes: {} },
      { id: 's', name: 's', type: 'string', value: 'x', elementTypes: ['integer'] },
      { id: 'n', name: 'n', type: 'map', value: {} },
    ])
    expect(result.u).toEqual({ type: 'map' })
    expect(result.e).toEqual({ type: 'map', value: 'src', isExpression: true })
    expect(result.s).toEqual({ type: 'string', value: 'x' })
    expect(result.n).toEqual({ type: 'map', value: {} })
  })
})

describe('buildVariablesPayload', () => {
  it('returns an empty record when no variables are provided', () => {
    const result = buildVariablesPayload([])
    expect(result).toEqual({})
  })

  it('includes all variables in payload', () => {
    const variables: WorkflowVariable[] = [
      makeVariable({ name: 'testVar', value: 'hello' }),
      makeVariable({ name: 'anotherVar', value: 'world' }),
    ]

    const result = buildVariablesPayload(variables)

    expect(result).toHaveProperty('testVar')
    expect(result).toHaveProperty('anotherVar')
  })

  it('maps variable value and type correctly', () => {
    const variables: WorkflowVariable[] = [
      makeVariable({ name: 'host', value: 'localhost', type: 'string' }),
      makeVariable({ name: 'count', value: 42, type: 'integer' }),
    ]

    const result = buildVariablesPayload(variables)

    expect(result.host).toEqual({ value: 'localhost', type: 'string' })
    expect(result.count).toEqual({ value: 42, type: 'integer' })
  })

  it('includes isExpression flag when true', () => {
    const variables: WorkflowVariable[] = [
      makeVariable({ name: 'expr', value: 'a + b', type: 'string', isExpression: true }),
    ]

    const result = buildVariablesPayload(variables)

    expect(result.expr).toEqual({ value: 'a + b', type: 'string', isExpression: true })
  })

  it('omits isExpression when false or undefined', () => {
    const variables: WorkflowVariable[] = [
      makeVariable({ name: 'plain', value: 'val', isExpression: false }),
      makeVariable({ name: 'noFlag', value: 'val2' }),
    ]

    const result = buildVariablesPayload(variables)

    expect(result.plain).toEqual({ value: 'val', type: 'string' })
    expect(result.plain).not.toHaveProperty('isExpression')
    expect(result.noFlag).toEqual({ value: 'val2', type: 'string' })
    expect(result.noFlag).not.toHaveProperty('isExpression')
  })

  it('includes isTemplate flag when true (round-trip persistence)', () => {
    const variables: WorkflowVariable[] = [
      makeVariable({ name: 'greeting', value: 'Hi {{user}}', type: 'string', isTemplate: true }),
    ]

    const result = buildVariablesPayload(variables)

    expect(result.greeting).toEqual({ value: 'Hi {{user}}', type: 'string', isTemplate: true })
  })

  it('omits isTemplate when false or undefined', () => {
    const variables: WorkflowVariable[] = [
      makeVariable({ name: 'plain', value: 'val' }),
    ]

    const result = buildVariablesPayload(variables)

    expect(result.plain).not.toHaveProperty('isTemplate')
  })

  it('translates isSecret to the backend "secret" field on save', () => {
    const variables: WorkflowVariable[] = [
      makeVariable({ name: 'apiKey', value: 'sssh', type: 'string', isSecret: true }),
    ]

    const result = buildVariablesPayload(variables)

    expect(result.apiKey).toEqual({ value: 'sssh', type: 'string', secret: true })
  })

  it('omits the "secret" field when isSecret is false or undefined', () => {
    const variables: WorkflowVariable[] = [
      makeVariable({ name: 'plain', value: 'val', isSecret: false }),
      makeVariable({ name: 'noFlag', value: 'val2' }),
    ]

    const result = buildVariablesPayload(variables)

    expect(result.plain).not.toHaveProperty('secret')
    expect(result.noFlag).not.toHaveProperty('secret')
  })

  it('omits the value key entirely for an unset variable', () => {
    const variables: WorkflowVariable[] = [
      { id: 'v1', name: 'k8s_session', type: 'string' },
    ]

    const result = buildVariablesPayload(variables)

    expect(result.k8s_session).toEqual({ type: 'string' })
    expect('value' in result.k8s_session).toBe(false)
  })

  it('omits the value key for an unset secret but keeps the secret flag', () => {
    const variables: WorkflowVariable[] = [
      { id: 'v1', name: 'k8s_session', type: 'string', isSecret: true },
    ]

    const result = buildVariablesPayload(variables)

    expect(result.k8s_session).toEqual({ type: 'string', secret: true })
    expect('value' in result.k8s_session).toBe(false)
  })

  it('writes an explicit empty string as a value', () => {
    const variables: WorkflowVariable[] = [makeVariable({ name: 'blank', value: '' })]

    const result = buildVariablesPayload(variables)

    expect(result.blank).toEqual({ value: '', type: 'string' })
    expect('value' in result.blank).toBe(true)
  })

  it('handles multiple test-scoped variables', () => {
    const variables: WorkflowVariable[] = [
      makeVariable({ name: 'a', value: 1, type: 'integer' }),
      makeVariable({ name: 'b', value: true, type: 'boolean' }),
      makeVariable({ name: 'c', value: [1, 2], type: 'array', isExpression: true }),
    ]

    const result = buildVariablesPayload(variables)

    expect(Object.keys(result)).toHaveLength(3)
    expect(result.a).toEqual({ value: 1, type: 'integer' })
    expect(result.b).toEqual({ value: true, type: 'boolean' })
    expect(result.c).toEqual({ value: [1, 2], type: 'array', isExpression: true })
  })
})

// ---------------------------------------------------------------------------
// Tests: resyncSealedNodeSecrets (post-save secret re-sync, REQ-3.1.3.18)
// ---------------------------------------------------------------------------

describe('resyncSealedNodeSecrets', () => {
  const SEALED = 'wave:enc:v1:c2VhbGVk'

  type ResyncNode = { id: string; position: { x: number; y: number }; data: Record<string, unknown> }
  const setNodes = vi.fn<(nodes: ResyncNode[], opts?: { skipDirty?: boolean }) => void>()

  function storeNode(id: string, values: Record<string, unknown>): ResyncNode {
    return { id, position: { x: 1, y: 2 }, data: { label: id, config: { values } } }
  }

  beforeEach(() => {
    mockFetchTestWorkflow.mockReset()
    setNodes.mockReset()
    usePageBlockStore.setState({ block: null, retrying: false })
  })

  it('patches a just-sealed credential value into the matching node without dirtying', async () => {
    mockFetchTestWorkflow.mockResolvedValue({
      nodes: [{ id: 'n1', data: { config: { values: { password: SEALED, host: 'h' } } } }],
    })

    await resyncSealedNodeSecrets('t1', [storeNode('n1', { password: 'plaintext', host: 'h' })], setNodes)

    expect(mockFetchTestWorkflow).toHaveBeenCalledWith('t1')
    expect(setNodes).toHaveBeenCalledTimes(1)
    const [patched, opts] = setNodes.mock.calls[0]
    expect(opts).toEqual({ skipDirty: true })
    expect((patched[0].data.config as { values: Record<string, unknown> }).values.password).toBe(SEALED)
    // Non-credential value and position are preserved untouched.
    expect((patched[0].data.config as { values: Record<string, unknown> }).values.host).toBe('h')
    expect(patched[0].position).toEqual({ x: 1, y: 2 })
  })

  it('patches a sealed credential of a Block inside a Local Function body, at any depth', async () => {
    const body = (nodes: unknown[]) => ({ workflow: { nodes, edges: [] }, inputs: [], outputs: [], variables: [] })
    mockFetchTestWorkflow.mockResolvedValue({
      nodes: [
        {
          id: 'fn-1',
          data: {
            localDefinition: body([
              { id: 'inner', data: { config: { values: { password: SEALED } } } },
              { id: 'fn-2', data: { localDefinition: body([{ id: 'deep', data: { config: { values: { token: SEALED } } } }]) } },
            ]),
          },
        },
      ],
    })
    const deep = storeNode('deep', { token: 'typed-2' })
    const inner = storeNode('inner', { password: 'typed-1' })
    const nested = { ...storeNode('fn-2', {}), data: { label: 'fn-2', localDefinition: body([deep]) } }
    const outer = { ...storeNode('fn-1', {}), data: { label: 'fn-1', localDefinition: body([inner, nested]) } }
    const root = storeNode('root', { host: 'h' })
    const untouched = { ...storeNode('fn-3', {}), data: { label: 'fn-3', localDefinition: body([storeNode('plain', { x: '1' })]) } }

    await resyncSealedNodeSecrets('t1', [outer, root, untouched], setNodes)

    expect(setNodes).toHaveBeenCalledTimes(1)
    const [patched] = setNodes.mock.calls[0]
    const innerNodes = (patched[0].data.localDefinition as { workflow: { nodes: ResyncNode[] } }).workflow.nodes
    expect((innerNodes[0].data.config as { values: Record<string, unknown> }).values.password).toBe(SEALED)
    const deepNodes = (innerNodes[1].data.localDefinition as { workflow: { nodes: ResyncNode[] } }).workflow.nodes
    expect((deepNodes[0].data.config as { values: Record<string, unknown> }).values.token).toBe(SEALED)
    expect(patched[1]).toBe(root)
    expect(patched[2]).toBe(untouched)
  })

  it('patches a sealed map credential in, so a saved Secret masks without a reload', async () => {
    mockFetchTestWorkflow.mockResolvedValue({
      nodes: [{ id: 'n1', data: { config: { values: { secret_data: { canary: SEALED } } } } }],
    })

    await resyncSealedNodeSecrets(
      't1',
      [storeNode('n1', { secret_data: { canary: 'plaintext' } })],
      setNodes,
    )

    const [patched] = setNodes.mock.calls[0]
    expect((patched[0].data.config as { values: Record<string, unknown> }).values.secret_data).toEqual({
      canary: SEALED,
    })
  })

  it('is a no-op when the store already holds the same sealed map', async () => {
    mockFetchTestWorkflow.mockResolvedValue({
      nodes: [{ id: 'n1', data: { config: { values: { secret_data: { canary: SEALED } } } } }],
    })

    await resyncSealedNodeSecrets('t1', [storeNode('n1', { secret_data: { canary: SEALED } })], setNodes)

    expect(setNodes).not.toHaveBeenCalled()
  })

  it('patches a sealed map whose key set changed', async () => {
    mockFetchTestWorkflow.mockResolvedValue({
      nodes: [{ id: 'n1', data: { config: { values: { secret_data: { a: SEALED, b: SEALED } } } } }],
    })

    await resyncSealedNodeSecrets('t1', [storeNode('n1', { secret_data: { a: SEALED } })], setNodes)

    const [patched] = setNodes.mock.calls[0]
    expect((patched[0].data.config as { values: Record<string, unknown> }).values.secret_data).toEqual({
      a: SEALED,
      b: SEALED,
    })
  })

  it("patches a Variable Setter's sealed variables map", async () => {
    mockFetchTestWorkflow.mockResolvedValue({
      nodes: [{ id: 'n1', data: { config: { values: { variables: { api_key: SEALED } } } } }],
    })

    await resyncSealedNodeSecrets(
      't1',
      [storeNode('n1', { variables: { api_key: 'plaintext' } })],
      setNodes,
    )

    const [patched, opts] = setNodes.mock.calls[0]
    expect(opts).toEqual({ skipDirty: true })
    const values = (patched[0].data.config as { values: Record<string, unknown> }).values
    expect(values.variables).toEqual({ api_key: SEALED })
  })

  it('is a no-op when the store value already equals the sealed envelope', async () => {
    mockFetchTestWorkflow.mockResolvedValue({
      nodes: [{ id: 'n1', data: { config: { values: { password: SEALED } } } }],
    })

    await resyncSealedNodeSecrets('t1', [storeNode('n1', { password: SEALED })], setNodes)

    expect(setNodes).not.toHaveBeenCalled()
  })

  it('ignores non-sealed values (plaintext hosts, expression variable refs)', async () => {
    mockFetchTestWorkflow.mockResolvedValue({
      nodes: [{ id: 'n1', data: { config: { values: { host: 'node-1', private_key: 'deploy_key' } } } }],
    })

    await resyncSealedNodeSecrets('t1', [storeNode('n1', { host: 'node-1', private_key: 'deploy_key' })], setNodes)

    expect(setNodes).not.toHaveBeenCalled()
  })

  it('patches only nodes carrying a sealed value and keeps the rest by reference', async () => {
    mockFetchTestWorkflow.mockResolvedValue({
      nodes: [
        { id: 'n1', data: { config: { values: { password: SEALED } } } },
        { id: 'n2', data: { config: { values: { cmd: 'ls' } } } },
      ],
    })
    const n2 = storeNode('n2', { cmd: 'ls' })

    await resyncSealedNodeSecrets('t1', [storeNode('n1', { password: 'pw' }), n2], setNodes)

    const [patched] = setNodes.mock.calls[0]
    expect((patched[0].data.config as { values: Record<string, unknown> }).values.password).toBe(SEALED)
    expect(patched[1]).toBe(n2)
  })

  it('does not patch when no store node matches a sealed workflow node', async () => {
    mockFetchTestWorkflow.mockResolvedValue({
      nodes: [{ id: 'other', data: { config: { values: { password: SEALED } } } }],
    })

    await resyncSealedNodeSecrets('t1', [storeNode('n1', { password: 'pw' })], setNodes)

    expect(setNodes).not.toHaveBeenCalled()
  })

  it('defaults a store node with no config to an empty value map before patching', async () => {
    mockFetchTestWorkflow.mockResolvedValue({
      nodes: [{ id: 'n1', data: { config: { values: { password: SEALED } } } }],
    })
    const nodeNoConfig: ResyncNode = { id: 'n1', position: { x: 0, y: 0 }, data: { label: 'n1' } }

    await resyncSealedNodeSecrets('t1', [nodeNoConfig], setNodes)

    const [patched] = setNodes.mock.calls[0]
    expect((patched[0].data.config as { values: Record<string, unknown> }).values.password).toBe(SEALED)
  })

  it('skips workflow nodes with no config values and a workflow with no nodes array', async () => {
    mockFetchTestWorkflow.mockResolvedValue({ nodes: [{ id: 'n1', data: {} }, { id: 'n2' }] })
    await resyncSealedNodeSecrets('t1', [storeNode('n1', { host: 'h' })], setNodes)
    expect(setNodes).not.toHaveBeenCalled()

    mockFetchTestWorkflow.mockResolvedValue({})
    await resyncSealedNodeSecrets('t1', [storeNode('n1', { password: 'pw' })], setNodes)
    expect(setNodes).not.toHaveBeenCalled()
  })

  it('reports a failed read and leaves the store untouched', async () => {
    mockFetchTestWorkflow.mockRejectedValue(new Error('network'))

    await resyncSealedNodeSecrets('t1', [storeNode('n1', { password: 'pw' })], setNodes)

    expect(setNodes).not.toHaveBeenCalled()
    const block = usePageBlockStore.getState().block
    expect(block?.title).toBe('Could not load saved test')
    expect(block?.detail.message).toBe('network')
  })

  it('clears its report when a later read succeeds', async () => {
    mockFetchTestWorkflow.mockRejectedValueOnce(new Error('network'))
    await resyncSealedNodeSecrets('t1', [storeNode('n1', { password: 'pw' })], setNodes)
    expect(usePageBlockStore.getState().block).not.toBeNull()

    mockFetchTestWorkflow.mockResolvedValue({
      nodes: [{ id: 'n1', data: { config: { values: { password: SEALED } } } }],
    })
    await resyncSealedNodeSecrets('t1', [storeNode('n1', { password: 'pw' })], setNodes)

    expect(usePageBlockStore.getState().block).toBeNull()
  })

  it('re-runs only the failed read on retry and then masks the canvas', async () => {
    mockFetchTestWorkflow.mockRejectedValueOnce(new Error('network'))
    await resyncSealedNodeSecrets('t1', [storeNode('n1', { password: 'pw' })], setNodes)

    mockFetchTestWorkflow.mockResolvedValue({
      nodes: [{ id: 'n1', data: { config: { values: { password: SEALED } } } }],
    })
    await usePageBlockStore.getState().block!.retry()

    expect(usePageBlockStore.getState().block).toBeNull()
    const [patched] = setNodes.mock.calls[0]
    expect((patched[0].data.config as { values: Record<string, unknown> }).values.password).toBe(SEALED)
  })

  it('keeps the report with the newest reason when the retry fails again', async () => {
    mockFetchTestWorkflow.mockRejectedValueOnce(new Error('network'))
    await resyncSealedNodeSecrets('t1', [storeNode('n1', { password: 'pw' })], setNodes)

    mockFetchTestWorkflow.mockRejectedValueOnce(new Error('still down'))
    await expect(usePageBlockStore.getState().block!.retry()).rejects.toThrow('still down')

    expect(usePageBlockStore.getState().block?.detail.message).toBe('still down')
    expect(setNodes).not.toHaveBeenCalled()
  })

  // Issue 1: a Variable Setter's secrets live nested in config.values.variables,
  // so the resync must patch that map too (else a saved setter secret shows
  // plaintext until a full page reload).
  it('patches a just-sealed Variable Setter secret in the nested variables map', async () => {
    mockFetchTestWorkflow.mockResolvedValue({
      nodes: [
        {
          id: 'vs1',
          data: { config: { values: { variables: { greeting: 'hi', db_password: SEALED } } } },
        },
      ],
    })

    await resyncSealedNodeSecrets(
      't1',
      [storeNode('vs1', { variables: { greeting: 'hi', db_password: 'plaintext' } })],
      setNodes,
    )

    expect(setNodes).toHaveBeenCalledTimes(1)
    const [patched, opts] = setNodes.mock.calls[0]
    expect(opts).toEqual({ skipDirty: true })
    const vars = (patched[0].data.config as { values: { variables: Record<string, unknown> } }).values
      .variables
    expect(vars.db_password).toBe(SEALED)
    // The non-secret entry in the same map is preserved.
    expect(vars.greeting).toBe('hi')
  })

  it('is a no-op when a nested setter secret already equals the sealed envelope', async () => {
    mockFetchTestWorkflow.mockResolvedValue({
      nodes: [{ id: 'vs1', data: { config: { values: { variables: { db_password: SEALED } } } } }],
    })

    await resyncSealedNodeSecrets(
      't1',
      [storeNode('vs1', { variables: { db_password: SEALED } })],
      setNodes,
    )

    expect(setNodes).not.toHaveBeenCalled()
  })

  it('seeds an empty variables map when the store node lacks one', async () => {
    mockFetchTestWorkflow.mockResolvedValue({
      nodes: [{ id: 'vs1', data: { config: { values: { variables: { db_password: SEALED } } } } }],
    })

    // Store node has config.values but no `variables` key yet.
    await resyncSealedNodeSecrets('t1', [storeNode('vs1', { other: 'x' })], setNodes)

    const [patched] = setNodes.mock.calls[0]
    const values = (patched[0].data.config as { values: { variables: Record<string, unknown> } }).values
    expect(values.variables.db_password).toBe(SEALED)
  })
})

// ---------------------------------------------------------------------------
// Tests: handleSaveError
// ---------------------------------------------------------------------------

describe('handleSaveError', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    useDeletedTestStore.setState({ info: null })
    useWorkflowStore.setState({ editingTestId: null, editingTestName: null })
  })

  describe('the open test is gone from the server', () => {
    it('raises the not-found dialog instead of the toast, and writes nothing to the console', () => {
      useWorkflowStore.setState({ editingTestId: 'test-7', editingTestName: 'Payment smoke' })
      const toast = makeToast()
      const handlers = makeHandlers()

      handleSaveError({ status: 404, message: "Test with ID 'test-7' not found" }, toast, handlers)

      expect(useDeletedTestStore.getState().info).toEqual({
        testId: 'test-7',
        testName: 'Payment smoke',
      })
      expect(toast.error).not.toHaveBeenCalled()
      expect(consoleSpy).not.toHaveBeenCalled()
      expect(handlers.setShowValidationErrorDialog).not.toHaveBeenCalled()
    })

    it('reports an unnamed canvas with a null name', () => {
      useWorkflowStore.setState({ editingTestId: 'test-7', editingTestName: null })

      handleSaveError({ status: 404 }, makeToast())

      expect(useDeletedTestStore.getState().info).toEqual({ testId: 'test-7', testName: null })
    })

    it('keeps the toast for a 404 that is not the open test', () => {
      const toast = makeToast()
      const err = { status: 404, message: 'Suite not found' }

      handleSaveError(err, toast)

      expect(useDeletedTestStore.getState().info).toBeNull()
      expect(toast.error).toHaveBeenCalledWith('Suite not found', 'Save Failed')
      expect(consoleSpy).toHaveBeenCalledWith('Direct save failed:', err)
    })

    it('keeps the toast for every other failure while a test is open', () => {
      useWorkflowStore.setState({ editingTestId: 'test-7', editingTestName: 'Payment smoke' })
      const toast = makeToast()
      const err = { status: 500, message: 'Internal server error' }

      handleSaveError(err, toast)

      expect(useDeletedTestStore.getState().info).toBeNull()
      expect(toast.error).toHaveBeenCalledWith('Internal server error', 'Save Failed')
      expect(consoleSpy).toHaveBeenCalledWith('Direct save failed:', err)
    })
  })

  describe('422 validation details error', () => {
    it('maps details to validation errors and sets UI state', () => {
      const toast = makeToast()
      const handlers = makeHandlers()
      const err = {
        status: 422,
        details: [
          { path: 'nodes.0', node_id: 'n1', node_label: 'Shell Script', element_type: 'block', code: 'MISSING_PARAM', message: 'Missing param' },
          { path: 'nodes.1', node_id: 'n2', code: 'BAD_VALUE', message: 'Bad value' },
        ],
      }

      handleSaveError(err, toast, handlers)

      expect(handlers.setValidationErrors).toHaveBeenCalledWith([
        {
          path: 'nodes.0',
          node_id: 'n1',
          node_label: 'Shell Script',
          element_type: 'block',
          code: 'MISSING_PARAM',
          message: 'Missing param',
          severity: 'error',
        },
        {
          path: 'nodes.1',
          node_id: 'n2',
          node_label: undefined,
          element_type: undefined,
          code: 'BAD_VALUE',
          message: 'Bad value',
          severity: 'error',
        },
      ])
      expect(handlers.setValidationFatal).toHaveBeenCalledWith(false)
      expect(handlers.setValidationMode).toHaveBeenCalledWith('save')
      expect(handlers.setShowValidationErrorDialog).toHaveBeenCalledWith(true)
    })

    it("keeps the backend's fix action, so Fix All declares the type it names", () => {
      const handlers = makeHandlers()
      const err = {
        status: 422,
        details: [
          {
            path: 'variables.pause_ms',
            node_id: 'delay-1',
            code: 'UNDECLARED_VARIABLE',
            message: "Variable 'pause_ms' is used in 1 block(s) but not declared in variable manager",
            fix_action: 'Add variable to manager (type: integer)',
          },
        ],
      }

      handleSaveError(err, makeToast(), handlers)

      expect(handlers.setValidationErrors).toHaveBeenCalledWith([
        expect.objectContaining({
          path: 'variables.pause_ms',
          code: 'UNDECLARED_VARIABLE',
          fix_action: 'Add variable to manager (type: integer)',
        }),
      ])
    })

    it('uses default values for missing path, code, message', () => {
      const handlers = makeHandlers()
      const err = {
        status: 422,
        details: [{}],
      }

      handleSaveError(err, makeToast(), handlers)

      expect(handlers.setValidationErrors).toHaveBeenCalledWith([
        expect.objectContaining({
          path: '',
          code: 'UNKNOWN',
          message: 'Unknown validation error',
          severity: 'error',
        }),
      ])
    })

    it('skips validation handling when no handlers provided', () => {
      const err = {
        status: 422,
        details: [{ path: 'x', code: 'ERR', message: 'msg' }],
      }

      handleSaveError(err, makeToast())

      // Without handlers, falls through to console.warn
      expect(consoleSpy).toHaveBeenCalledWith('Direct save failed:', err)
    })
  })

  describe('fallback error handling', () => {
    it('reports non-422 errors on a toast and logs with the default label', () => {
      const toast = makeToast()
      const err = new Error('Network error')

      handleSaveError(err, toast)

      expect(toast.error).toHaveBeenCalledWith('Network error', 'Save Failed')
      expect(consoleSpy).toHaveBeenCalledWith('Direct save failed:', err)
    })

    it('logs with custom label when provided', () => {
      const toast = makeToast()
      const err = new Error('Server error')

      handleSaveError(err, toast, undefined, 'Save before run failed:')

      expect(toast.error).toHaveBeenCalledWith('Server error', 'Save Failed')
      expect(consoleSpy).toHaveBeenCalledWith('Save before run failed:', err)
    })

    it('reports 422 errors without details or code', () => {
      const toast = makeToast()
      const err = { status: 422 }

      handleSaveError(err, toast)

      expect(toast.error).toHaveBeenCalledWith('Request failed', 'Save Failed')
      expect(consoleSpy).toHaveBeenCalledWith('Direct save failed:', err)
    })

    it('reports 422 errors with an empty details array', () => {
      const toast = makeToast()
      const err = { status: 422, details: [] }

      handleSaveError(err, toast, makeHandlers())

      expect(toast.error).toHaveBeenCalledWith('Request failed', 'Save Failed')
      expect(consoleSpy).toHaveBeenCalledWith('Direct save failed:', err)
    })

    it('reports a 422 carrying details when no validation handlers are supplied', () => {
      const toast = makeToast()
      const err = {
        status: 422,
        details: [{ path: 'x', code: 'ERR', message: 'msg' }],
        message: 'Validation failed',
      }

      handleSaveError(err, toast)

      expect(toast.error).toHaveBeenCalledWith('Validation failed', 'Save Failed')
    })
  })
})

// ---------------------------------------------------------------------------
// Tests: sanitizeNodesForSave
// ---------------------------------------------------------------------------

describe('sanitizeNodesForSave', () => {
  function makeNode(overrides: Partial<NodeType> & { id: string }): NodeType {
    return {
      id: overrides.id,
      type: overrides.type ?? 'workflowNode',
      position: overrides.position ?? { x: 0, y: 0 },
      data: overrides.data ?? { label: `node-${overrides.id}` },
      ...(overrides.width !== undefined ? { width: overrides.width } : {}),
      ...(overrides.height !== undefined ? { height: overrides.height } : {}),
    }
  }

  it('strips top-level `selected` from each node', () => {
    const nodes: NodeType[] = [
      { ...makeNode({ id: 'a' }), selected: true } as NodeType & { selected?: boolean },
      { ...makeNode({ id: 'b' }), selected: false } as NodeType & { selected?: boolean },
    ]

    const result = sanitizeNodesForSave(nodes)

    expect(result).toHaveLength(2)
    expect(result[0]).not.toHaveProperty('selected')
    expect(result[1]).not.toHaveProperty('selected')
  })

  it('strips top-level `dragging` from each node', () => {
    const nodes: NodeType[] = [
      { ...makeNode({ id: 'a' }), dragging: true } as NodeType & { dragging?: boolean },
      { ...makeNode({ id: 'b' }), dragging: false } as NodeType & { dragging?: boolean },
    ]

    const result = sanitizeNodesForSave(nodes)

    expect(result).toHaveLength(2)
    expect(result[0]).not.toHaveProperty('dragging')
    expect(result[1]).not.toHaveProperty('dragging')
  })

  it('strips `hasNewerVersion` from each node.data', () => {
    const nodes: NodeType[] = [
      makeNode({ id: 'a', data: { label: 'A', version: '1.0', hasNewerVersion: true } }),
      makeNode({ id: 'b', data: { label: 'B', version: '2.0', hasNewerVersion: false } }),
    ]

    const result = sanitizeNodesForSave(nodes)

    expect(result[0].data).not.toHaveProperty('hasNewerVersion')
    expect(result[1].data).not.toHaveProperty('hasNewerVersion')
  })

  it('preserves all other top-level node fields', () => {
    const node: NodeType = makeNode({
      id: 'n1',
      type: 'workflowNode',
      position: { x: 100, y: 200 },
      width: 240,
      height: 80,
      data: { label: 'Shell Script' },
    })
    const polluted = { ...node, selected: true } as NodeType & { selected?: boolean }

    const [result] = sanitizeNodesForSave([polluted])

    expect(result.id).toBe('n1')
    expect(result.type).toBe('workflowNode')
    expect(result.position).toEqual({ x: 100, y: 200 })
    expect(result.width).toBe(240)
    expect(result.height).toBe(80)
  })

  it('preserves all other node.data fields when stripping hasNewerVersion', () => {
    const node = makeNode({
      id: 'n1',
      data: {
        label: 'Shell Script',
        elementType: 'shell-script',
        nodeType: 'plugin',
        config: { values: { cmd: 'ls' } },
        description: 'My Shell Script',
        version: '1.0',
        hasNewerVersion: true,
        disabled: false,
        expressionFields: ['cmd'],
        templateFields: [],
        variableExpressionKeys: [],
        variableTypes: {},
      },
    })

    const [result] = sanitizeNodesForSave([node])

    expect(result.data).toEqual({
      label: 'Shell Script',
      elementType: 'shell-script',
      nodeType: 'plugin',
      config: { values: { cmd: 'ls' } },
      description: 'My Shell Script',
      version: '1.0',
      disabled: false,
      expressionFields: ['cmd'],
      templateFields: [],
      variableExpressionKeys: [],
      variableTypes: {},
    })
  })

  it('returns nodes unchanged when neither field is present', () => {
    const nodes: NodeType[] = [
      makeNode({ id: 'a', data: { label: 'A', version: '1.0' } }),
      makeNode({ id: 'b', data: { label: 'B' } }),
    ]

    const result = sanitizeNodesForSave(nodes)

    expect(result[0]).toEqual(nodes[0])
    expect(result[1]).toEqual(nodes[1])
  })

  it('does not mutate the input nodes', () => {
    const original = { ...makeNode({ id: 'a', data: { label: 'A', hasNewerVersion: true } }), selected: true, dragging: false } as NodeType & { selected?: boolean; dragging?: boolean }
    const snapshot = JSON.parse(JSON.stringify(original))

    sanitizeNodesForSave([original])

    expect(original).toEqual(snapshot)
    expect(original.selected).toBe(true)
    expect(original.dragging).toBe(false)
    expect(original.data.hasNewerVersion).toBe(true)
  })

  it('returns empty array for empty input', () => {
    expect(sanitizeNodesForSave([])).toEqual([])
  })

  // The user can drill into a published Function for inspection. The
  // drill machinery injects the library body as the shared node's
  // `localDefinition` transiently so the standard subtree walk can render
  // it. That injection must NEVER round-trip to the persisted spec - shared
  // nodes save with only `functionId` + `functionLifecycle: 'shared'`.
  it('strips localDefinition from shared (published) Function nodes', () => {
    // Cast the data through `unknown` because the workflow-store NodeType
    // describes only what the live canvas needs (no `name` on localDefinition);
    // shared nodes carry a transient library body whose shape we don't care
    // about here - the assertion is the FIELD is stripped wholesale.
    const node = makeNode({
      id: 'fn-shared',
      data: {
        label: 'FetchUser',
        elementType: 'function',
        nodeType: 'function',
        functionLifecycle: 'shared',
        functionId: 'lib-1',
        localDefinition: {
          workflow: { nodes: [], edges: [] },
          inputs: [],
          outputs: [],
          variables: [],
        },
      } as unknown as NodeType['data'],
    })

    const [result] = sanitizeNodesForSave([node])

    expect(result.data).not.toHaveProperty('localDefinition')
    expect(result.data).toMatchObject({
      label: 'FetchUser',
      elementType: 'function',
      nodeType: 'function',
      functionLifecycle: 'shared',
      functionId: 'lib-1',
    })
  })

  // Local Functions persist their inline body, so localDefinition MUST
  // survive sanitization.
  it('preserves localDefinition on local Function nodes', () => {
    const localDef = {
      workflow: { nodes: [], edges: [] },
      inputs: [{ name: 'x', type: 'string' }],
      outputs: [{ name: 'y', type: 'string' }],
      variables: [],
    } as unknown as NodeType['data']['localDefinition']
    const node = makeNode({
      id: 'fn-local',
      data: {
        label: 'MyLocal',
        elementType: 'function',
        nodeType: 'function',
        functionLifecycle: 'local',
        localDefinition: localDef,
      },
    })

    const [result] = sanitizeNodesForSave([node])

    expect(result.data.localDefinition).toEqual(localDef)
  })

  // Plain plugin/control nodes never carry a localDefinition, but if a buggy
  // upstream path produced one we should still preserve it (sanitize is for
  // shared-function injection only, not blanket stripping).
  it('preserves localDefinition on non-shared, non-function nodes', () => {
    const node = makeNode({
      id: 'plugin-shell-script',
      data: {
        label: 'Shell Script',
        elementType: 'shell-script',
        nodeType: 'plugin',
        localDefinition: { workflow: { nodes: [], edges: [] }, inputs: [], outputs: [] },
      } as unknown as NodeType['data'],
    })

    const [result] = sanitizeNodesForSave([node])

    expect(result.data).toHaveProperty('localDefinition')
  })
})

// ---------------------------------------------------------------------------
// Tests: sanitizeEdgesForSave
// ---------------------------------------------------------------------------

describe('sanitizeEdgesForSave', () => {
  function makeEdge(overrides: Partial<EdgeType> & { id: string }): EdgeType {
    return {
      id: overrides.id,
      source: overrides.source ?? 's',
      target: overrides.target ?? 't',
      ...(overrides.sourceHandle !== undefined ? { sourceHandle: overrides.sourceHandle } : {}),
      ...(overrides.targetHandle !== undefined ? { targetHandle: overrides.targetHandle } : {}),
      ...(overrides.animated !== undefined ? { animated: overrides.animated } : {}),
      ...(overrides.label !== undefined ? { label: overrides.label } : {}),
      ...(overrides.type !== undefined ? { type: overrides.type } : {}),
    }
  }

  it('strips top-level `selected` from each edge', () => {
    const edges: EdgeType[] = [
      { ...makeEdge({ id: 'e1' }), selected: true } as EdgeType & { selected?: boolean },
      { ...makeEdge({ id: 'e2' }), selected: false } as EdgeType & { selected?: boolean },
    ]

    const result = sanitizeEdgesForSave(edges)

    expect(result).toHaveLength(2)
    expect(result[0]).not.toHaveProperty('selected')
    expect(result[1]).not.toHaveProperty('selected')
  })

  it('preserves all other edge fields', () => {
    const edge: EdgeType = makeEdge({
      id: 'e1',
      source: 'n1',
      target: 'n2',
      sourceHandle: 'out',
      targetHandle: 'in',
      animated: true,
      label: 'success',
      type: 'smoothstep',
    })
    const polluted = { ...edge, selected: true } as EdgeType & { selected?: boolean }

    const [result] = sanitizeEdgesForSave([polluted])

    expect(result).toEqual(edge)
  })

  it('returns edges unchanged when `selected` is absent', () => {
    const edges: EdgeType[] = [
      makeEdge({ id: 'e1', source: 'a', target: 'b' }),
      makeEdge({ id: 'e2', source: 'b', target: 'c', label: 'x' }),
    ]

    const result = sanitizeEdgesForSave(edges)

    expect(result[0]).toEqual(edges[0])
    expect(result[1]).toEqual(edges[1])
  })

  it('does not mutate the input edges', () => {
    const original = { ...makeEdge({ id: 'e1' }), selected: true } as EdgeType & { selected?: boolean }
    const snapshot = JSON.parse(JSON.stringify(original))

    sanitizeEdgesForSave([original])

    expect(original).toEqual(snapshot)
    expect(original.selected).toBe(true)
  })

  it('returns empty array for empty input', () => {
    expect(sanitizeEdgesForSave([])).toEqual([])
  })
})


describe('sanitizeNodesForSave - Shared edit-mode draft capture', () => {
  const sharedNode = (data: Record<string, unknown>) => ({
    id: 's1',
    type: 'workflowNode',
    position: { x: 0, y: 0 },
    data: { label: 'FetchUser', nodeType: 'function', functionLifecycle: 'shared', ...data },
  })

  it('captures localDefinition into draft for a Shared instance in edit mode', () => {
    const node = sharedNode({
      editMode: true,
      localDefinition: {
        workflow: { nodes: [{ id: 'inner' }], edges: [] },
        inputs: [{ name: 'x' }],
        outputs: [{ name: 'y' }],
        dependencies: { functions: ['f'], plugins: [] },
      },
    })
    const [result] = sanitizeNodesForSave([node] as unknown as NodeType[])
    const draft = (result.data as Record<string, unknown>).draft as Record<string, unknown>
    expect(result.data).not.toHaveProperty('localDefinition')
    expect(draft.workflow).toEqual({ nodes: [{ id: 'inner' }], edges: [] })
    expect(draft.inputs).toEqual([{ name: 'x' }])
    expect(draft.outputs).toEqual([{ name: 'y' }])
    expect(draft.dependencies).toEqual({ functions: ['f'], plugins: [] })
  })

  it('falls back to a prior draft when localDefinition fields are absent', () => {
    const node = sharedNode({
      editMode: true,
      draft: {
        workflow: { nodes: [{ id: 'prev' }], edges: [] },
        inputs: [{ name: 'pi' }],
        outputs: [{ name: 'po' }],
        dependencies: { functions: ['pd'], plugins: [] },
      },
      localDefinition: {},
    })
    const [result] = sanitizeNodesForSave([node] as unknown as NodeType[])
    const draft = (result.data as Record<string, unknown>).draft as Record<string, unknown>
    expect(draft.workflow).toEqual({ nodes: [{ id: 'prev' }], edges: [] })
    expect(draft.inputs).toEqual([{ name: 'pi' }])
    expect(draft.dependencies).toEqual({ functions: ['pd'], plugins: [] })
  })

  it('uses defaults when neither localDefinition fields nor a prior draft exist', () => {
    const node = sharedNode({ editMode: true, localDefinition: {} })
    const [result] = sanitizeNodesForSave([node] as unknown as NodeType[])
    const draft = (result.data as Record<string, unknown>).draft as Record<string, unknown>
    expect(draft.workflow).toEqual({ nodes: [], edges: [] })
    expect(draft.inputs).toEqual([])
    expect(draft.outputs).toEqual([])
    expect(draft.dependencies).toEqual({ functions: [], plugins: [] })
  })

  it('does not build a draft for a Shared instance not in edit mode', () => {
    const node = sharedNode({ localDefinition: { workflow: { nodes: [], edges: [] } } })
    const [result] = sanitizeNodesForSave([node] as unknown as NodeType[])
    expect(result.data).not.toHaveProperty('localDefinition')
    expect(result.data).not.toHaveProperty('draft')
  })

  it('keeps localDefinition for a non-Shared (Local) Function node', () => {
    const local = {
      id: 'fn-local',
      type: 'workflowNode',
      position: { x: 0, y: 0 },
      data: {
        label: 'Local',
        nodeType: 'function',
        functionLifecycle: 'local',
        localDefinition: { workflow: { nodes: [], edges: [] } },
      },
    }
    const [result] = sanitizeNodesForSave([local] as unknown as NodeType[])
    expect(result.data).toHaveProperty('localDefinition')
  })
})

// ---------------------------------------------------------------------------
// Deep canonicalization: sanitizeNodesForSave delegates to the
// shared recursive transform so persisted payloads fold/strip at ALL depths.
// ---------------------------------------------------------------------------

describe('sanitizeNodesForSave - deep fold/strip', () => {
  interface DeepNode {
    id: string
    type: string
    position: { x: number; y: number }
    data: Record<string, unknown>
    selected?: boolean
    dragging?: boolean
  }

  function deepLog(id: string, extra: Partial<DeepNode> = {}): DeepNode {
    return {
      id,
      type: 'workflowNode',
      position: { x: 0, y: 0 },
      data: { label: id, nodeType: 'plugin' },
      ...extra,
    }
  }

  function deepBody(nodes: DeepNode[]): Record<string, unknown> {
    return { workflow: { nodes, edges: [] }, inputs: [], outputs: [], variables: [] }
  }

  function deepLocalFn(id: string, inner: DeepNode[]): DeepNode {
    return {
      id,
      type: 'workflowNode',
      position: { x: 0, y: 0 },
      data: {
        label: id,
        nodeType: 'function',
        functionLifecycle: 'local',
        localDefinition: deepBody(inner),
      },
    }
  }

  function deepSharedFn(
    id: string,
    opts: { editMode?: boolean; stampedNodes?: DeepNode[]; draftNodes?: DeepNode[] } = {},
  ): DeepNode {
    const data: Record<string, unknown> = {
      label: id,
      nodeType: 'function',
      functionLifecycle: 'shared',
      functionId: `lib-${id}`,
      functionVersion: '1.0.0',
    }
    if (opts.editMode) {
      data.editMode = true
      data.upstreamLink = { functionId: `lib-${id}`, sourceVersion: '1.0.0' }
      data.draft = {
        name: id,
        inputs: [],
        outputs: [],
        dependencies: { functions: [], plugins: [] },
        workflow: { nodes: opts.draftNodes ?? [], edges: [] },
      }
    }
    if (opts.stampedNodes) data.localDefinition = deepBody(opts.stampedNodes)
    return { id, type: 'workflowNode', position: { x: 0, y: 0 }, data }
  }

  function innerOf(node: DeepNode | undefined, field: 'localDefinition' | 'draft'): DeepNode[] {
    const def = node?.data[field] as { workflow?: { nodes?: DeepNode[] } } | undefined
    return def?.workflow?.nodes ?? []
  }

  it('folds a nested edit-mode Shared (inside a local parent) into its draft', () => {
    const nested = deepSharedFn('s2', {
      editMode: true,
      stampedNodes: [deepLog('deep-edit')],
      draftNodes: [deepLog('stale')],
    })
    const [result] = sanitizeNodesForSave([
      deepLocalFn('outer', [nested]),
    ] as unknown as NodeType[]) as unknown as DeepNode[]

    const inner = innerOf(result, 'localDefinition').find((n) => n.id === 's2')
    expect(inner?.data).not.toHaveProperty('localDefinition')
    expect(innerOf(inner, 'draft').map((n) => n.id)).toEqual(['deep-edit'])
  })

  it('strips the transient body of a nested non-edit Shared', () => {
    const nested = deepSharedFn('s2', { stampedNodes: [deepLog('viewed')] })
    const [result] = sanitizeNodesForSave([
      deepLocalFn('outer', [nested]),
    ] as unknown as NodeType[]) as unknown as DeepNode[]

    const inner = innerOf(result, 'localDefinition').find((n) => n.id === 's2')
    expect(inner?.data).not.toHaveProperty('localDefinition')
  })

  it('strips selection/drag residue and hasNewerVersion at depth', () => {
    const residue = deepLog('inner', { selected: true, dragging: true })
    residue.data.hasNewerVersion = true
    const [result] = sanitizeNodesForSave([
      deepLocalFn('outer', [residue]),
    ] as unknown as NodeType[]) as unknown as DeepNode[]

    const inner = innerOf(result, 'localDefinition')[0]
    expect(inner).not.toHaveProperty('selected')
    expect(inner).not.toHaveProperty('dragging')
    expect(inner.data).not.toHaveProperty('hasNewerVersion')
  })

  it('folds an edit-mode Shared nested inside another edit-mode Shared (depth 3)', () => {
    const innermost = deepSharedFn('s3', {
      editMode: true,
      stampedNodes: [deepLog('deepest-edit')],
    })
    const middle = deepSharedFn('s2', { editMode: true, stampedNodes: [innermost] })
    const [result] = sanitizeNodesForSave([
      deepLocalFn('outer', [middle]),
    ] as unknown as NodeType[]) as unknown as DeepNode[]

    const mid = innerOf(result, 'localDefinition').find((n) => n.id === 's2')
    expect(mid?.data).not.toHaveProperty('localDefinition')
    const deepest = innerOf(mid, 'draft').find((n) => n.id === 's3')
    expect(deepest?.data).not.toHaveProperty('localDefinition')
    expect(innerOf(deepest, 'draft').map((n) => n.id)).toEqual(['deepest-edit'])
  })
})
