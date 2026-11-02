/**
 * Tests for WorkflowNode edit-mode source-version resolution.
 *
 * The Shared-Function edit-mode badge surfaces the version the draft was
 * snapshotted from. That version is resolved with a fallback: the upstream
 * link's `sourceVersion` takes precedence, otherwise the instance's pinned
 * `functionVersion` is used. Both sides of that fallback are exercised here.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'

const mockWorkflowStore = {
  selectedNodeIds: [] as string[],
  skippedNodeIds: [] as string[],
  nodeIssues: new Map() as Map<string, unknown[]>,
  pulseValidationNodeIds: new Set() as Set<string>,
  edges: [] as Array<{ id: string; source: string; target: string }>,
  nodes: [] as Array<{ id: string; data: { elementType?: string } }>,
  selectNode: vi.fn(),
  openConfigModal: vi.fn(),
  hasBreakpoint: vi.fn().mockReturnValue(false),
  deleteSelected: vi.fn(),
  duplicate: vi.fn(),
  copy: vi.fn(),
  cut: vi.fn(),
  toggleBreakpoint: vi.fn(),
  toggleDisable: vi.fn(),
  toggleSkip: vi.fn(),
  unlinkNode: vi.fn(),
  setNodes: vi.fn(),
  breakpoints: new Set<string>(),
  pausedNodeId: null as string | null,
  drillPath: [] as Array<{ nodeId: string; label: string }>,
  variables: [] as Array<{ id: string; name: string; value: unknown; type: string }>,
  pushDrill: vi.fn(),
  popDrillOne: vi.fn(),
  popDrillTo: vi.fn(),
  clearDrill: vi.fn(),
}

// Canvas nodes report a failed Function-body read through the toast; these
// specs render nodes without the app shell that provides one.
vi.mock('@/components/ui/toast', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui/toast')>()
  const { use } = await import('react')
  const fallback = { error: vi.fn() }
  return { ...actual, useToast: () => use(actual.ToastContext) ?? fallback }
})

vi.mock('@/features/workbench/stores/workflow-store', () => ({
  useWorkflowStore: (selector?: (state: typeof mockWorkflowStore) => unknown) =>
    selector ? selector(mockWorkflowStore) : mockWorkflowStore,
}))

vi.mock('@/features/workbench/stores/execution-store', () => ({
  useBlockExecutionStatus: () => undefined,
  useBlockResultSkipped: () => false,
}))

vi.mock('@/features/functions/api/functions-api', async (orig) => {
  const actual = await orig<typeof import('@/features/functions/api/functions-api')>()
  return { ...actual, getFunction: vi.fn(), getFunctionVersion: vi.fn() }
})

function renderWithReactFlow(ui: React.ReactElement) {
  return render(<ReactFlowProvider>{ui}</ReactFlowProvider>)
}

describe('WorkflowNode - edit-mode source version resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses upstreamLink.sourceVersion when present', async () => {
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(
      <WorkflowNode
        id="fn1"
        data={
          {
            label: 'SharedFn',
            elementType: 'function',
            nodeType: 'function',
            functionLifecycle: 'shared',
            editMode: true,
            upstreamLink: { sourceVersion: '2.0.0' },
            functionVersion: '9.9.9',
          } as never
        }
      />,
    )
    expect(screen.getByTestId('edit-mode-mark-wrapper')).toHaveAttribute(
      'aria-label',
      'Function in edit mode - may differ from published v2.0.0.',
    )
  })

  it('falls back to functionVersion when upstreamLink has no sourceVersion', async () => {
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(
      <WorkflowNode
        id="fn2"
        data={
          {
            label: 'SharedFn',
            elementType: 'function',
            nodeType: 'function',
            functionLifecycle: 'shared',
            editMode: true,
            functionVersion: '3.1.0',
          } as never
        }
      />,
    )
    expect(screen.getByTestId('edit-mode-mark-wrapper')).toHaveAttribute(
      'aria-label',
      'Function in edit mode - may differ from published v3.1.0.',
    )
  })
})

describe('WorkflowNode - accessible name', () => {
  it('names the body button after the block, as a block', async () => {
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(
      <WorkflowNode
        id="http-named"
        data={
          {
            label: 'HTTP',
            elementType: 'http-client',
            nodeType: 'plugin',
            version: '1.0.0',
            config: { values: {} },
          } as never
        }
      />,
    )
    expect(screen.getByTestId('workflow-node-body-http-named')).toHaveAttribute(
      'aria-label',
      'HTTP block',
    )
  })
})

describe('WorkflowNode - secret reveal badge (REQ-3.1.3.5)', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    const { useMaskingSettingsStore } = await import('@/stores/masking-settings-store')
    act(() => useMaskingSettingsStore.getState().set({ runOutput: false }))
  })

  afterEach(async () => {
    const { useMaskingSettingsStore } = await import('@/stores/masking-settings-store')
    act(() => useMaskingSettingsStore.getState().set({ runOutput: false }))
  })

  async function setSystemRunOutput(on: boolean): Promise<void> {
    const { useMaskingSettingsStore } = await import('@/stores/masking-settings-store')
    act(() => useMaskingSettingsStore.getState().set({ runOutput: on }))
  }

  it('shows the amber "unsecured" badge when a plugin block is set to Always reveal', async () => {
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(
      <WorkflowNode
        id="http-reveal"
        data={
          {
            label: 'HTTP',
            elementType: 'http-client',
            nodeType: 'plugin',
            version: '1.0.0',
            config: { values: {}, secret_masking: 'reveal' },
          } as never
        }
      />,
    )
    const badge = screen.getByTestId('node-reveal-alert')
    expect(badge).toBeInTheDocument()
    expect(badge.getAttribute('aria-label')).toBe(
      'Secrets revealed - shown in cleartext in run logs and reports',
    )
  })

  it('shows no reveal badge when a plugin block keeps the system (masked) default', async () => {
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(
      <WorkflowNode
        id="http-masked"
        data={
          {
            label: 'HTTP',
            elementType: 'http-client',
            nodeType: 'plugin',
            version: '1.0.0',
            config: { values: {}, secret_masking: 'mask' },
          } as never
        }
      />,
    )
    expect(screen.queryByTestId('node-reveal-alert')).not.toBeInTheDocument()
  })

  it('shows no reveal badge on a system-default block while system reveal is ON', async () => {
    await setSystemRunOutput(true)
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(
      <WorkflowNode
        id="http-system"
        data={
          {
            label: 'HTTP',
            elementType: 'http-client',
            nodeType: 'plugin',
            version: '1.0.0',
            config: { values: {}, secret_masking: 'system' },
          } as never
        }
      />,
    )
    // System-wide reveal is signaled by the settings banner, not per-block
    // badges - no block is anomalous when everything reveals.
    expect(screen.queryByTestId('node-reveal-alert')).not.toBeInTheDocument()
  })

  it('shows no reveal badge on an always-reveal block while system reveal is ON', async () => {
    await setSystemRunOutput(true)
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(
      <WorkflowNode
        id="http-reveal-sys-on"
        data={
          {
            label: 'HTTP',
            elementType: 'http-client',
            nodeType: 'plugin',
            version: '1.0.0',
            config: { values: {}, secret_masking: 'reveal' },
          } as never
        }
      />,
    )
    expect(screen.queryByTestId('node-reveal-alert')).not.toBeInTheDocument()
  })
})
