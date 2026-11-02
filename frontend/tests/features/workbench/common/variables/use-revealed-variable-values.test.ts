/**
 * useRevealedVariableValues - reactive secret-variable reveal overlay (REQ-3.1.3.17).
 *
 * When the test-variables unmask flag is on, the hook re-fetches the current test
 * and exposes the backend-revealed plaintext for its secret variables. Display
 * overlay only: never writes the workflow store. Off / no editing test -> empty map.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'

vi.mock('@/features/tests/api/crud', () => ({
  fetchTest: vi.fn(),
  fetchTestWorkflow: vi.fn(),
}))

import { fetchTest, fetchTestWorkflow } from '@/features/tests/api/crud'
import {
  useRevealedVariableValues,
  applyRevealedValues,
} from '@/features/workbench/common/variables/use-revealed-variable-values'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import { scopedVariableKey } from '@/features/workbench/lib/variable-scope-key'
import { useMaskingSettingsStore } from '@/stores/masking-settings-store'
import { usePageBlockStore } from '@/stores/page-block-store'
import type { Variable } from '@/features/workbench/common/variables/variable-manager-content/types'

const mockFetch = vi.mocked(fetchTest)
const mockFetchWorkflow = vi.mocked(fetchTestWorkflow)

// A revealed secret variable (plaintext, no `masked`), a non-secret, and a
// still-masked secret (the reveal did not apply to it).
const REVEALED_DETAIL = {
  variables: {
    vault_key: { value: 'unlock-passphrase-secret', type: 'string', secret: true },
    deploy_key: { value: '-----BEGIN-----', type: 'string' },
    still_masked: { value: '********', type: 'string', secret: true, masked: true },
  },
}

beforeEach(() => {
  vi.clearAllMocks()
  mockFetch.mockResolvedValue(REVEALED_DETAIL as never)
  mockFetchWorkflow.mockResolvedValue({ nodes: [], edges: [] } as never)
  useWorkflowStore.getState().reset()
  useMaskingSettingsStore.setState({
    runOutput: false,
    testVariables: false,
    sharedVariables: false,
    credentialInputs: false,
  })
  usePageBlockStore.setState({ block: null, retrying: false, retiredOwners: new Set() })
})

describe('useRevealedVariableValues', () => {
  it('returns an empty map when the test-variables flag is off', () => {
    useWorkflowStore.getState().setEditingTest('test-1', 'Test One')
    const { result } = renderHook(() => useRevealedVariableValues())
    expect(result.current.values).toEqual({})
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns an empty map when there is no editing test', () => {
    useMaskingSettingsStore.setState({ testVariables: true })
    const { result } = renderHook(() => useRevealedVariableValues())
    expect(result.current.values).toEqual({})
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('exposes revealed plaintext for secret variables when the flag is on', async () => {
    useWorkflowStore.getState().setEditingTest('test-1', 'Test One')
    useMaskingSettingsStore.setState({ testVariables: true })

    const { result } = renderHook(() => useRevealedVariableValues())

    await waitFor(() => expect(result.current.values.vault_key).toBe('unlock-passphrase-secret'))
    expect(mockFetch).toHaveBeenCalledWith('test-1')
  })

  it('omits non-secret variables and still-masked secrets', async () => {
    useWorkflowStore.getState().setEditingTest('test-1', 'Test One')
    useMaskingSettingsStore.setState({ testVariables: true })

    const { result } = renderHook(() => useRevealedVariableValues())

    await waitFor(() => expect(result.current.values.vault_key).toBe('unlock-passphrase-secret'))
    expect(result.current.values.deploy_key).toBeUndefined()
    expect(result.current.values.still_masked).toBeUndefined()
  })

  it('tolerates a detail with no variables field', async () => {
    mockFetch.mockResolvedValue({} as never)
    useWorkflowStore.getState().setEditingTest('test-1', 'Test One')
    useMaskingSettingsStore.setState({ testVariables: true })

    const { result } = renderHook(() => useRevealedVariableValues())

    await waitFor(() => expect(mockFetch).toHaveBeenCalled())
    expect(result.current.values).toEqual({})
  })

  it('reveals nothing and reports the read when the fetch fails', async () => {
    mockFetch.mockRejectedValue(new Error('network'))
    useWorkflowStore.getState().setEditingTest('test-1', 'Test One')
    useMaskingSettingsStore.setState({ testVariables: true })

    const { result } = renderHook(() => useRevealedVariableValues())

    await waitFor(() => expect(usePageBlockStore.getState().block).not.toBeNull())
    expect(result.current.values).toEqual({})
    const block = usePageBlockStore.getState().block
    expect(block?.title).toBe('Could not load variable values')
    expect(block?.detail.message).toBe('network')
  })

  it('reveals the values and clears the report when the retry succeeds', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network'))
    mockFetch.mockResolvedValue(REVEALED_DETAIL as never)
    useWorkflowStore.getState().setEditingTest('test-1', 'Test One')
    useMaskingSettingsStore.setState({ testVariables: true })

    const { result } = renderHook(() => useRevealedVariableValues())
    await waitFor(() => expect(usePageBlockStore.getState().block).not.toBeNull())

    await act(async () => {
      await usePageBlockStore.getState().block!.retry()
    })

    await waitFor(() => expect(result.current.values.vault_key).toBe('unlock-passphrase-secret'))
    expect(usePageBlockStore.getState().block).toBeNull()
  })

  it('clears its report when the reveal turns off', async () => {
    mockFetch.mockRejectedValue(new Error('network'))
    useWorkflowStore.getState().setEditingTest('test-1', 'Test One')
    useMaskingSettingsStore.setState({ testVariables: true })

    renderHook(() => useRevealedVariableValues())
    await waitFor(() => expect(usePageBlockStore.getState().block).not.toBeNull())

    await act(async () => {
      useMaskingSettingsStore.setState({ testVariables: false })
    })

    expect(usePageBlockStore.getState().block).toBeNull()
  })

  it('reports nothing when the read fails after the panel closed', async () => {
    let rejectFetch: (reason: unknown) => void = () => {}
    mockFetch.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectFetch = reject
      }) as never,
    )
    useWorkflowStore.getState().setEditingTest('test-1', 'Test One')
    useMaskingSettingsStore.setState({ testVariables: true })

    const { unmount } = renderHook(() => useRevealedVariableValues())
    unmount()
    rejectFetch(new Error('network'))
    await Promise.resolve()
    await Promise.resolve()

    expect(usePageBlockStore.getState().block).toBeNull()
  })

  it('stays empty when the fetched test carries no variables', async () => {
    // detail.variables ?? {} -> {} when the payload omits variables entirely.
    mockFetch.mockResolvedValue({} as never)
    useWorkflowStore.getState().setEditingTest('test-1', 'Test One')
    useMaskingSettingsStore.setState({ testVariables: true })

    const { result } = renderHook(() => useRevealedVariableValues())

    await waitFor(() => expect(mockFetch).toHaveBeenCalled())
    expect(result.current.values).toEqual({})
  })

  it('ignores a test that resolves after the hook unmounts', async () => {
    let resolveFetch: (detail: unknown) => void = () => {}
    mockFetch.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve
      }) as never,
    )
    useWorkflowStore.getState().setEditingTest('test-1', 'Test One')
    useMaskingSettingsStore.setState({ testVariables: true })

    const { result, unmount } = renderHook(() => useRevealedVariableValues())
    unmount()
    resolveFetch(REVEALED_DETAIL)
    await Promise.resolve()
    await Promise.resolve()

    expect(result.current.values).toEqual({})
  })
})

describe('useRevealedVariableValues - whether the reveal has answered', () => {
  function deferDetail() {
    let resolve: (detail: unknown) => void = () => {}
    mockFetch.mockReturnValueOnce(new Promise((r) => (resolve = r)) as never)
    return (detail: unknown) => resolve(detail)
  }

  it('has its answer at once when the reveal is off', () => {
    useWorkflowStore.getState().setEditingTest('test-1', 'Test One')
    const { result } = renderHook(() => useRevealedVariableValues())
    expect(result.current.settled).toBe(true)
  })

  it('has its answer at once when there is no editing test', () => {
    useMaskingSettingsStore.setState({ testVariables: true })
    const { result } = renderHook(() => useRevealedVariableValues())
    expect(result.current.settled).toBe(true)
  })

  it('has no answer until its read returns', async () => {
    const resolveDetail = deferDetail()
    useWorkflowStore.getState().setEditingTest('test-1', 'Test One')
    useMaskingSettingsStore.setState({ testVariables: true })

    const { result } = renderHook(() => useRevealedVariableValues())
    expect(result.current.settled).toBe(false)

    await act(async () => resolveDetail(REVEALED_DETAIL))

    await waitFor(() => expect(result.current.settled).toBe(true))
    expect(result.current.values.vault_key).toBe('unlock-passphrase-secret')
  })

  it('has no answer while its read failed, and has it once the retry returns', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network'))
    useWorkflowStore.getState().setEditingTest('test-1', 'Test One')
    useMaskingSettingsStore.setState({ testVariables: true })

    const { result } = renderHook(() => useRevealedVariableValues())
    await waitFor(() => expect(usePageBlockStore.getState().block).not.toBeNull())
    expect(result.current.settled).toBe(false)

    await act(async () => {
      await usePageBlockStore.getState().block!.retry()
    })

    expect(result.current.settled).toBe(true)
  })

  it('asks again when the reveal turns off and back on', async () => {
    useWorkflowStore.getState().setEditingTest('test-1', 'Test One')
    useMaskingSettingsStore.setState({ testVariables: true })
    const { result } = renderHook(() => useRevealedVariableValues())
    await waitFor(() => expect(result.current.settled).toBe(true))

    act(() => {
      useMaskingSettingsStore.setState({ testVariables: false })
    })
    expect(result.current.settled).toBe(true)
    expect(result.current.values).toEqual({})

    const resolveDetail = deferDetail()
    act(() => {
      useMaskingSettingsStore.setState({ testVariables: true })
    })
    expect(result.current.settled).toBe(false)

    await act(async () => resolveDetail(REVEALED_DETAIL))

    await waitFor(() => expect(result.current.settled).toBe(true))
    expect(result.current.values.vault_key).toBe('unlock-passphrase-secret')
  })

  it('has no answer for another Test until that Test\'s own read returns', async () => {
    useWorkflowStore.getState().setEditingTest('test-1', 'Test One')
    useMaskingSettingsStore.setState({ testVariables: true })
    const { result } = renderHook(() => useRevealedVariableValues())
    await waitFor(() => expect(result.current.settled).toBe(true))

    const resolveDetail = deferDetail()
    act(() => {
      useWorkflowStore.getState().setEditingTest('test-2', 'Test Two')
    })
    expect(result.current.settled).toBe(false)

    await act(async () => resolveDetail(REVEALED_DETAIL))

    await waitFor(() => expect(result.current.settled).toBe(true))
    expect(mockFetch).toHaveBeenLastCalledWith('test-2')
  })
})

describe('useRevealedVariableValues - Function secrets follow the Test rule', () => {
  it('reveals a secret local and output of a Local Function the workflow read returns in the clear, keyed by scope', async () => {
    mockFetchWorkflow.mockResolvedValue({
      nodes: [
        {
          id: 'fn-1',
          data: {
            nodeType: 'function',
            functionLifecycle: 'local',
            localDefinition: {
              workflow: { nodes: [], edges: [] },
              inputs: [],
              outputs: [{ name: 'out_s', type: 'string', secret: true, default: 'o-plain' }],
              variables: [
                { id: 'l1', name: 'tok', type: 'string', isSecret: true, value: 'l-plain' },
                { id: 'l2', name: 'masked', type: 'string', isSecret: true, value: '********' },
                { id: 'l3', name: 'plain', type: 'string', value: 'p' },
              ],
            },
          },
        },
      ],
      edges: [],
    } as never)
    useWorkflowStore.getState().setEditingTest('test-1', 'Test One')
    useMaskingSettingsStore.setState({ testVariables: true })

    const { result } = renderHook(() => useRevealedVariableValues())

    await waitFor(() => expect(result.current.values[scopedVariableKey('tok', ['fn-1'])]).toBe('l-plain'))
    expect(result.current.values[scopedVariableKey('out_s', ['fn-1'])]).toBe('o-plain')
    expect(result.current.values[scopedVariableKey('masked', ['fn-1'])]).toBeUndefined()
    expect(result.current.values[scopedVariableKey('plain', ['fn-1'])]).toBeUndefined()
    expect(result.current.values.vault_key).toBe('unlock-passphrase-secret')
  })

  it('reveals the secret output of a Local Function that declares no local variables', async () => {
    mockFetchWorkflow.mockResolvedValue({
      nodes: [
        {
          id: 'fn-1',
          data: {
            nodeType: 'function',
            functionLifecycle: 'local',
            localDefinition: { outputs: [{ name: 'out_s', type: 'string', secret: true, default: 'o-plain' }] },
          },
        },
      ],
      edges: [],
    } as never)
    useWorkflowStore.getState().setEditingTest('test-1', 'Test One')
    useMaskingSettingsStore.setState({ testVariables: true })

    const { result } = renderHook(() => useRevealedVariableValues())

    await waitFor(() => expect(result.current.values[scopedVariableKey('out_s', ['fn-1'])]).toBe('o-plain'))
  })

  it('overlays only the rows of the scope the revealed value belongs to', () => {
    const local = { id: 'l1', name: 'tok', type: 'string', value: '********', isSecret: true } as Variable
    const revealed = { [scopedVariableKey('tok', ['fn-1'])]: 'l-plain', tok: 'root-plain' }
    expect(applyRevealedValues([local], revealed, ['fn-1'])[0].value).toBe('l-plain')
    expect(applyRevealedValues([local], revealed, [])[0].value).toBe('root-plain')
  })
})

describe('applyRevealedValues', () => {
  const secretVar = { id: 'v1', name: 'vault_key', type: 'string', value: '********', isSecret: true } as Variable
  const plainVar = { id: 'v2', name: 'deploy_key', type: 'string', value: 'x', isSecret: false } as Variable

  it('returns the input array unchanged when there is nothing revealed', () => {
    const input = [secretVar, plainVar]
    expect(applyRevealedValues(input, {}, [])).toBe(input)
  })

  it('overlays the revealed value onto a matching secret variable', () => {
    const [out] = applyRevealedValues([secretVar], { vault_key: 'unlock-passphrase-secret' }, [])
    expect(out.value).toBe('unlock-passphrase-secret')
  })

  it('leaves a non-secret variable and unmatched secrets untouched', () => {
    const out = applyRevealedValues([plainVar], { deploy_key: 'should-not-apply' }, [])
    expect(out[0].value).toBe('x')
  })
})
