/**
 * useCredentialReveal - reactive credential-field reveal overlay (REQ-3.1.3.18).
 *
 * When the system credential-inputs unmask flag is on, the hook re-fetches the
 * open node's workflow and exposes the backend-revealed plaintext for the node's
 * declared credential params. It is a display overlay: it never writes to the
 * canvas store. Off / disabled / no editing test -> empty map.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'

vi.mock('@/features/tests/api/crud', () => ({
  fetchTestWorkflow: vi.fn(),
}))

import { fetchTestWorkflow } from '@/features/tests/api/crud'
import { useCredentialReveal } from '@/features/workbench/common/element-config/use-credential-reveal'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import { useMaskingSettingsStore } from '@/stores/masking-settings-store'
import { usePageBlockStore } from '@/stores/page-block-store'

const mockFetch = vi.mocked(fetchTestWorkflow)

// The node the config modal is open on: a revealed credential (plaintext), a
// non-credential plaintext, and a still-sealed value.
const REVEALED_WORKFLOW = {
  nodes: [
    {
      id: 'ssh-1',
      data: {
        config: {
          values: {
            password: 'revealed-pw-plaintext',
            host: 'node.example.com',
            private_key: 'wave:enc:v1:c3RpbGwtc2VhbGVk',
          },
        },
      },
    },
  ],
  edges: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  mockFetch.mockResolvedValue(REVEALED_WORKFLOW as never)
  useWorkflowStore.getState().reset()
  useMaskingSettingsStore.setState({
    runOutput: false,
    testVariables: false,
    sharedVariables: false,
    credentialInputs: false,
  })
  usePageBlockStore.setState({ block: null, retrying: false, retiredOwners: new Set() })
})

describe('useCredentialReveal', () => {
  it('returns an empty map when the credential-inputs flag is off', () => {
    useWorkflowStore.getState().setEditingTest('test-1', 'Test One')
    const { result } = renderHook(() => useCredentialReveal('ssh-1', true))
    expect(result.current).toEqual({})
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns an empty map when disabled (non-plugin node)', () => {
    useWorkflowStore.getState().setEditingTest('test-1', 'Test One')
    useMaskingSettingsStore.setState({ credentialInputs: true })
    const { result } = renderHook(() => useCredentialReveal('ssh-1', false))
    expect(result.current).toEqual({})
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns an empty map when there is no editing test', () => {
    useMaskingSettingsStore.setState({ credentialInputs: true })
    const { result } = renderHook(() => useCredentialReveal('ssh-1', true))
    expect(result.current).toEqual({})
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('exposes the revealed plaintext credential params when the flag is on', async () => {
    useWorkflowStore.getState().setEditingTest('test-1', 'Test One')
    useMaskingSettingsStore.setState({ credentialInputs: true })

    const { result } = renderHook(() => useCredentialReveal('ssh-1', true))

    await waitFor(() => expect(result.current.password).toBe('revealed-pw-plaintext'))
    expect(mockFetch).toHaveBeenCalledWith('test-1')
  })

  it('reveals the credential params of a Block inside a Local Function body', async () => {
    mockFetch.mockResolvedValue({
      nodes: [
        {
          id: 'fn-1',
          data: {
            localDefinition: {
              workflow: { nodes: [{ id: 'inner-ssh', data: { config: { values: { password: 'inner-pw' } } } }], edges: [] },
            },
          },
        },
      ],
      edges: [],
    } as never)
    useWorkflowStore.getState().setEditingTest('test-1', 'Test One')
    useMaskingSettingsStore.setState({ credentialInputs: true })

    const { result } = renderHook(() => useCredentialReveal('inner-ssh', true))

    await waitFor(() => expect(result.current.password).toBe('inner-pw'))
  })

  it('omits a value that is still a sealed envelope (not actually revealed)', async () => {
    useWorkflowStore.getState().setEditingTest('test-1', 'Test One')
    useMaskingSettingsStore.setState({ credentialInputs: true })

    const { result } = renderHook(() => useCredentialReveal('ssh-1', true))

    await waitFor(() => expect(result.current.password).toBe('revealed-pw-plaintext'))
    expect(result.current.private_key).toBeUndefined()
  })

  it('reveals nothing and reports the read when the fetch fails', async () => {
    mockFetch.mockRejectedValue(new Error('network'))
    useWorkflowStore.getState().setEditingTest('test-1', 'Test One')
    useMaskingSettingsStore.setState({ credentialInputs: true })

    const { result } = renderHook(() => useCredentialReveal('ssh-1', true))

    await waitFor(() => expect(usePageBlockStore.getState().block).not.toBeNull())
    expect(result.current).toEqual({})
    const block = usePageBlockStore.getState().block
    expect(block?.title).toBe('Could not load credential values')
    expect(block?.detail.message).toBe('network')
  })

  it('reveals the values and clears the report when the retry succeeds', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network'))
    mockFetch.mockResolvedValue(REVEALED_WORKFLOW as never)
    useWorkflowStore.getState().setEditingTest('test-1', 'Test One')
    useMaskingSettingsStore.setState({ credentialInputs: true })

    const { result } = renderHook(() => useCredentialReveal('ssh-1', true))
    await waitFor(() => expect(usePageBlockStore.getState().block).not.toBeNull())

    await act(async () => {
      await usePageBlockStore.getState().block!.retry()
    })

    await waitFor(() => expect(result.current.password).toBe('revealed-pw-plaintext'))
    expect(usePageBlockStore.getState().block).toBeNull()
  })

  it('clears its report when the reveal turns off', async () => {
    mockFetch.mockRejectedValue(new Error('network'))
    useWorkflowStore.getState().setEditingTest('test-1', 'Test One')
    useMaskingSettingsStore.setState({ credentialInputs: true })

    const { rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useCredentialReveal('ssh-1', enabled),
      { initialProps: { enabled: true } },
    )
    await waitFor(() => expect(usePageBlockStore.getState().block).not.toBeNull())

    await act(async () => {
      rerender({ enabled: false })
    })

    expect(usePageBlockStore.getState().block).toBeNull()
  })

  it('reports nothing when the read fails after the modal closed', async () => {
    let rejectFetch: (reason: unknown) => void = () => {}
    mockFetch.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectFetch = reject
      }) as never,
    )
    useWorkflowStore.getState().setEditingTest('test-1', 'Test One')
    useMaskingSettingsStore.setState({ credentialInputs: true })

    const { unmount } = renderHook(() => useCredentialReveal('ssh-1', true))
    unmount()
    rejectFetch(new Error('network'))
    await Promise.resolve()
    await Promise.resolve()

    expect(usePageBlockStore.getState().block).toBeNull()
  })

  it('stays empty when the open node is absent from the fetched workflow', async () => {
    // No nodes array at all: workflow.nodes ?? [] -> [] and the node lookup misses.
    mockFetch.mockResolvedValue({} as never)
    useWorkflowStore.getState().setEditingTest('test-1', 'Test One')
    useMaskingSettingsStore.setState({ credentialInputs: true })

    const { result } = renderHook(() => useCredentialReveal('ssh-1', true))

    await waitFor(() => expect(mockFetch).toHaveBeenCalled())
    expect(result.current).toEqual({})
  })

  it('ignores a workflow that resolves after the hook unmounts', async () => {
    let resolveFetch: (workflow: unknown) => void = () => {}
    mockFetch.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve
      }) as never,
    )
    useWorkflowStore.getState().setEditingTest('test-1', 'Test One')
    useMaskingSettingsStore.setState({ credentialInputs: true })

    const { result, unmount } = renderHook(() => useCredentialReveal('ssh-1', true))
    unmount()
    resolveFetch(REVEALED_WORKFLOW)
    await Promise.resolve()
    await Promise.resolve()

    expect(result.current).toEqual({})
  })
})
