/**
 * Parent-side `onSubmit` contract for `FunctionLifecycleDialogs`.
 *
 * The real `PublishDialog` always submits a non-empty semver `version`, so the
 * parent's `payload.version ?? '1.0.0'` default is never exercised through the
 * live dialog. `version` is OPTIONAL in `PublishFunctionPayload`, so any caller
 * may omit it. This file stubs `PublishDialog` to drive the documented optional
 * contract (submit with no version) and asserts the parent stamps the 1.0.0
 * fallback onto the now-shared node.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'

import type { PublishDialogLocalFunction } from '@/features/functions/canvas/publish-dialog'
import type { PublishFunctionPayload } from '@/features/functions/api/types'

const createFunctionMock = vi.fn()

vi.mock('@/features/functions/api/functions-api', () => ({
  publishLocalFunction: vi.fn(),
  detachPublishedInstance: vi.fn(),
  createFunction: (...args: unknown[]) => createFunctionMock(...args),
  getFunction: vi.fn(),
  getFunctionVersion: vi.fn(),
  publishEditModeDraft: vi.fn(),
  listFunctionTags: vi.fn(async () => []),
  listFunctions: vi.fn(),
  listFunctionVersions: vi.fn(),
  validateBumps: vi.fn(),
  deleteFunction: vi.fn(),
  getDependents: vi.fn(),
  batchCreateFunctions: vi.fn(),
  batchDeleteFunctions: vi.fn(),
  exportFunction: vi.fn(),
  exportFunctionsBatch: vi.fn(),
  importFunctions: vi.fn(),
  runScopedFunction: vi.fn(),
}))

vi.mock('@/features/functions/hooks/use-function-versions', () => ({
  useFunctionVersions: () => ({ versions: [], latest: '', isLoading: false, failed: false, retry: () => {} }),
}))

// Stub the publish dialog so the parent's onSubmit can be driven with a payload
// that omits `version` (the live dialog never does this). The button mirrors the
// real dialog's submit -> onPublished sequence so handlePublished still stamps
// the node from lastPublishedVersionRef.
vi.mock('@/features/functions/canvas/publish-dialog', () => ({
  PublishDialog: ({
    onSubmit,
    onPublished,
  }: {
    onSubmit: (payload: PublishFunctionPayload) => Promise<{ function_id: string }>
    onPublished: (functionId: string) => void
    localFunction: PublishDialogLocalFunction
  }) => (
    <div role="dialog">
      <button
        type="button"
        onClick={async () => {
          const result = await onSubmit({
            name: 'No Version',
            description: '',
            tags: [],
            changelog: 'c',
            details: 'd',
            // version intentionally omitted to exercise the parent default.
          })
          onPublished(result.function_id)
        }}
      >
        Publish
      </button>
    </div>
  ),
}))

import { FunctionLifecycleDialogs } from '@/features/functions/canvas/function-lifecycle-dialogs'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'

const LOCAL_NODE = {
  id: 'fn-local',
  type: 'workflowNode' as const,
  position: { x: 0, y: 0 },
  data: {
    label: 'My Local Function',
    elementType: 'function',
    nodeType: 'function' as const,
    functionLifecycle: 'local' as const,
    localDefinition: {
      name: 'My Local Function',
      description: '',
      tags: [],
      inputs: [],
      outputs: [],
      dependencies: { functions: [], plugins: [] },
      workflow: { nodes: [], edges: [] },
    },
  },
}

beforeEach(() => {
  createFunctionMock.mockReset()
  createFunctionMock.mockResolvedValue({
    definition: {
      id: 'new-fn-1',
      name: 'No Version',
      description: '',
      tags: [],
      inputs: [],
      outputs: [],
      dependencies: { functions: [], plugins: [] },
      workflow: { nodes: [], edges: [] },
      metadata: { author: 'wave', created_at: '', updated_at: '' },
    },
    etag: '"new-etag"',
  })
  useWorkflowStore.setState({
    nodes: [],
    edges: [],
    drillPath: [],
    selectedNodeIds: [],
    selectedEdgeIds: [],
    publishDialogNodeId: null,
    makeLocalDialogNodeId: null,
    publishEditModeDialogNodeId: null,
    dropChangesDialogNodeId: null,
    editingTestId: null,
    isDirty: false,
  })
})

describe('FunctionLifecycleDialogs - onSubmit version default', () => {
  it('stamps functionVersion=1.0.0 when the submitted payload omits version', async () => {
    const user = userEvent.setup()
    act(() => {
      useWorkflowStore.setState({
        nodes: [LOCAL_NODE],
        editingTestId: null,
        isDirty: true,
        publishDialogNodeId: 'fn-local',
      })
    })
    render(<FunctionLifecycleDialogs />)
    await screen.findByRole('dialog')
    await user.click(screen.getByRole('button', { name: /publish/i }))
    await waitFor(() => {
      expect(createFunctionMock).toHaveBeenCalledTimes(1)
    })
    await waitFor(() => {
      const node = useWorkflowStore.getState().nodes.find((n) => n.id === 'fn-local')
      expect(node?.data.functionLifecycle).toBe('shared')
      expect(node?.data.functionVersion).toBe('1.0.0')
    })
  })
})
