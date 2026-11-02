/**
 * NodeStatusBar - dig-in glyph renders for shared Function nodes too.
 *
 * The dig-in lets the user enter the read-only inspect view from the
 * canvas the same way they enter a local Function body.
 *
 * Contract:
 *   - Function node + functionLifecycle === 'local' + showDigIn=true → glyph
 *   - Function node + functionLifecycle === 'shared' + showDigIn=true → glyph
 *   - showDigIn=false (omitted) → no glyph regardless of lifecycle
 *   - non-Function kinds → no glyph
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/features/workbench/stores/workflow-store')

interface MockState {
  hasBreakpoint?: (id: string) => boolean
  edges: Array<{ id: string; source: string; target: string }>
  nodeIssues: Map<string, Array<{ code: string; paramName?: string; message: string }>>
  pulseValidationNodeIds: Set<string>
}

const defaultState: MockState = {
  hasBreakpoint: () => false,
  edges: [],
  nodeIssues: new Map(),
  pulseValidationNodeIds: new Set(),
}

async function setupStore(state: Partial<MockState> = {}): Promise<void> {
  const { useWorkflowStore } = await import('@/features/workbench/stores/workflow-store')
  const merged: MockState = { ...defaultState, ...state }
  vi.mocked(useWorkflowStore).mockImplementation((selector: unknown) => {
    return (selector as (s: MockState) => unknown)(merged)
  })
}

describe('NodeStatusBar - dig-in glyph on shared Function (FN-LC-12..14)', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await setupStore({})
  })

  it('renders the dig-in glyph when kind="function" and functionLifecycle="shared"', async () => {
    const { NodeStatusBar } = await import(
      '@/features/workbench/common/canvas/workflow-node/node-status-bar'
    )
    render(
      <NodeStatusBar
        nodeId="fn-shared"
        kind="function"
        runState={undefined}
        isMuted={false}
        hasIssue={false}
        hasNewerVersion={false}
        functionLifecycle="shared"
        showDigIn={true}
        onDigIn={vi.fn()}
        onConfigure={vi.fn()}
        onMenuAction={vi.fn()}
      />,
    )
    expect(screen.getByTestId('node-dig-in')).toBeInTheDocument()
  })

  it('does NOT render the dig-in glyph when showDigIn is omitted (lifecycle-agnostic gate)', async () => {
    const { NodeStatusBar } = await import(
      '@/features/workbench/common/canvas/workflow-node/node-status-bar'
    )
    render(
      <NodeStatusBar
        nodeId="fn-shared"
        kind="function"
        runState={undefined}
        isMuted={false}
        hasIssue={false}
        hasNewerVersion={false}
        functionLifecycle="shared"
        onConfigure={vi.fn()}
        onMenuAction={vi.fn()}
      />,
    )
    expect(screen.queryByTestId('node-dig-in')).not.toBeInTheDocument()
  })

  it('renders the dig-in glyph for a local Function with showDigIn=true (regression check)', async () => {
    const { NodeStatusBar } = await import(
      '@/features/workbench/common/canvas/workflow-node/node-status-bar'
    )
    render(
      <NodeStatusBar
        nodeId="fn-local"
        kind="function"
        runState={undefined}
        isMuted={false}
        hasIssue={false}
        hasNewerVersion={false}
        functionLifecycle="local"
        showDigIn={true}
        onDigIn={vi.fn()}
        onConfigure={vi.fn()}
        onMenuAction={vi.fn()}
      />,
    )
    expect(screen.getByTestId('node-dig-in')).toBeInTheDocument()
  })
})
