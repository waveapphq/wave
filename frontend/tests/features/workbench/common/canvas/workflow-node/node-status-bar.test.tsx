/**
 * Tests for NodeStatusBar - the persistent bar at the bottom of every element-node card.
 *
 * Contract:
 * - Bar renders UNCONDITIONALLY (selection does not toggle it).
 * - Left cluster: alert badge -> L/S Function-lifecycle badge -> run-state badge (DOM order).
 * - Right cluster: ver-update arrow -> cog -> kebab -> dig-in (DOM order).
 * - Run-state badges are mutually exclusive (PASS / FAIL / SKIP / RUN / PAUSED / DISABLED).
 * - L/S and dig-in slots are hidden for plugin/control nodes (Function only).
 * - Slim variant collapses the left cluster; idle = kebab-only right side.
 *
 * These tests target the NodeStatusBar unit. Integration with WorkflowNode is covered
 * elsewhere; here we exercise the props contract and the rendered DOM order.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'

import { CanvasReadOnlyProvider } from '@/features/workbench/common/canvas/read-only-context'
import { NodeStatusBar as NodeStatusBarStatic } from '@/features/workbench/common/canvas/workflow-node/node-status-bar'

vi.mock('@/features/workbench/stores/workflow-store')

interface MockState {
  hasBreakpoint?: (id: string) => boolean
  edges: Array<{ id: string; source: string; target: string }>
  nodeIssues: Map<string, Array<{ code: string; paramName?: string; message: string }>>
  pulseValidationNodeIds: Set<string>
  digInPendingNodeId?: string | null
}

const defaultState: MockState = {
  hasBreakpoint: () => false,
  edges: [],
  nodeIssues: new Map(),
  pulseValidationNodeIds: new Set(),
  digInPendingNodeId: null,
}

async function setupStore(state: Partial<MockState>): Promise<void> {
  const { useWorkflowStore } = await import('@/features/workbench/stores/workflow-store')
  const merged: MockState = { ...defaultState, ...state }
  vi.mocked(useWorkflowStore).mockImplementation((selector: unknown) => {
    return (selector as (s: MockState) => unknown)(merged)
  })
}

describe('NodeStatusBar - persistent rendering', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await setupStore({})
  })

  it('renders the status bar when the node is not selected', async () => {
    const { NodeStatusBar } = await import('@/features/workbench/common/canvas/workflow-node/node-status-bar')
    render(
      <NodeStatusBar
        nodeId="n1"
        kind="plugin"
        runState={undefined}
        isMuted={false}
        hasIssue={false}
        hasNewerVersion={false}
        onConfigure={vi.fn()}
        onMenuAction={vi.fn()}
      />,
    )
    expect(screen.getByTestId('node-status-bar')).toBeInTheDocument()
  })

  it('renders the status bar when the node is selected (no toggle on selection)', async () => {
    const { NodeStatusBar } = await import('@/features/workbench/common/canvas/workflow-node/node-status-bar')
    const { rerender } = render(
      <NodeStatusBar
        nodeId="n1"
        kind="plugin"
        runState={undefined}
        isMuted={false}
        hasIssue={false}
        hasNewerVersion={false}
        onConfigure={vi.fn()}
        onMenuAction={vi.fn()}
      />,
    )
    expect(screen.getByTestId('node-status-bar')).toBeInTheDocument()
    // Re-render with no prop signaling selection - the bar must still be present.
    rerender(
      <NodeStatusBar
        nodeId="n1"
        kind="plugin"
        runState={undefined}
        isMuted={false}
        hasIssue={false}
        hasNewerVersion={false}
        onConfigure={vi.fn()}
        onMenuAction={vi.fn()}
      />,
    )
    expect(screen.getByTestId('node-status-bar')).toBeInTheDocument()
  })
})

describe('NodeStatusBar - left cluster badge order', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await setupStore({})
  })

  it('renders alert badge first when hasIssue is true', async () => {
    await setupStore({
      nodeIssues: new Map([
        ['n1', [{ code: 'REQUIRED_PARAM_MISSING', paramName: 'url', message: 'missing url' }]],
      ]),
    })
    const { NodeStatusBar } = await import('@/features/workbench/common/canvas/workflow-node/node-status-bar')
    render(
      <NodeStatusBar
        nodeId="n1"
        kind="plugin"
        runState="fail"
        isMuted={false}
        hasIssue={true}
        hasNewerVersion={false}
        onConfigure={vi.fn()}
        onMenuAction={vi.fn()}
      />,
    )
    const leftCluster = screen.getByTestId('node-status-bar-left')
    const children = Array.from(leftCluster.children) as HTMLElement[]
    expect(children[0].getAttribute('data-testid')).toBe('node-validation-alert')
    // FAIL badge follows alert
    expect(children[children.length - 1].getAttribute('data-testid')).toBe('node-run-state-badge')
  })

  it('omits L/S badge for plugin nodes', async () => {
    const { NodeStatusBar } = await import('@/features/workbench/common/canvas/workflow-node/node-status-bar')
    render(
      <NodeStatusBar
        nodeId="n1"
        kind="plugin"
        runState={undefined}
        isMuted={false}
        hasIssue={false}
        hasNewerVersion={false}
        onConfigure={vi.fn()}
        onMenuAction={vi.fn()}
      />,
    )
    expect(screen.queryByTestId('node-function-lifecycle-badge')).not.toBeInTheDocument()
  })

  it('omits L/S badge for control nodes', async () => {
    const { NodeStatusBar } = await import('@/features/workbench/common/canvas/workflow-node/node-status-bar')
    render(
      <NodeStatusBar
        nodeId="n1"
        kind="control"
        runState={undefined}
        isMuted={false}
        hasIssue={false}
        hasNewerVersion={false}
        onConfigure={vi.fn()}
        onMenuAction={vi.fn()}
      />,
    )
    expect(screen.queryByTestId('node-function-lifecycle-badge')).not.toBeInTheDocument()
  })

  it('renders L badge for function node with functionLifecycle="local"', async () => {
    const { NodeStatusBar } = await import('@/features/workbench/common/canvas/workflow-node/node-status-bar')
    render(
      <NodeStatusBar
        nodeId="n1"
        kind="function"
        functionLifecycle="local"
        runState={undefined}
        isMuted={false}
        hasIssue={false}
        hasNewerVersion={false}
        onConfigure={vi.fn()}
        onMenuAction={vi.fn()}
      />,
    )
    const badge = screen.getByTestId('node-function-lifecycle-badge')
    expect(badge).toHaveAttribute('data-state', 'local')
    expect(badge).toHaveTextContent('L')
  })

  it('renders S badge for function node with functionLifecycle="shared"', async () => {
    const { NodeStatusBar } = await import('@/features/workbench/common/canvas/workflow-node/node-status-bar')
    render(
      <NodeStatusBar
        nodeId="n1"
        kind="function"
        functionLifecycle="shared"
        runState={undefined}
        isMuted={false}
        hasIssue={false}
        hasNewerVersion={false}
        onConfigure={vi.fn()}
        onMenuAction={vi.fn()}
      />,
    )
    const badge = screen.getByTestId('node-function-lifecycle-badge')
    expect(badge).toHaveAttribute('data-state', 'shared')
    expect(badge).toHaveTextContent('S')
  })

  it('omits L/S badge for function node when functionLifecycle is undefined', async () => {
    const { NodeStatusBar } = await import('@/features/workbench/common/canvas/workflow-node/node-status-bar')
    render(
      <NodeStatusBar
        nodeId="n1"
        kind="function"
        runState={undefined}
        isMuted={false}
        hasIssue={false}
        hasNewerVersion={false}
        onConfigure={vi.fn()}
        onMenuAction={vi.fn()}
      />,
    )
    expect(screen.queryByTestId('node-function-lifecycle-badge')).not.toBeInTheDocument()
  })

  it('renders only one run-state badge at a time (mutual exclusivity)', async () => {
    const { NodeStatusBar } = await import('@/features/workbench/common/canvas/workflow-node/node-status-bar')
    render(
      <NodeStatusBar
        nodeId="n1"
        kind="plugin"
        runState="pass"
        isMuted={false}
        hasIssue={false}
        hasNewerVersion={false}
        onConfigure={vi.fn()}
        onMenuAction={vi.fn()}
      />,
    )
    const badges = screen.getAllByTestId('node-run-state-badge')
    expect(badges).toHaveLength(1)
    expect(badges[0]).toHaveAttribute('data-state', 'pass')
  })

  it('renders no run-state badge when runState is undefined', async () => {
    const { NodeStatusBar } = await import('@/features/workbench/common/canvas/workflow-node/node-status-bar')
    render(
      <NodeStatusBar
        nodeId="n1"
        kind="plugin"
        runState={undefined}
        isMuted={false}
        hasIssue={false}
        hasNewerVersion={false}
        onConfigure={vi.fn()}
        onMenuAction={vi.fn()}
      />,
    )
    expect(screen.queryByTestId('node-run-state-badge')).not.toBeInTheDocument()
  })
})

describe('NodeStatusBar - right cluster action order', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await setupStore({})
  })

  it('renders actions in order: ver-arrow -> cog -> kebab', async () => {
    const { NodeStatusBar } = await import('@/features/workbench/common/canvas/workflow-node/node-status-bar')
    render(
      <NodeStatusBar
        nodeId="n1"
        kind="plugin"
        runState={undefined}
        isMuted={false}
        hasIssue={false}
        hasNewerVersion={true}
        onConfigure={vi.fn()}
        onMenuAction={vi.fn()}
      />,
    )
    const rightCluster = screen.getByTestId('node-status-bar-right')
    const children = Array.from(rightCluster.children) as HTMLElement[]
    const order = children.map((c) => c.getAttribute('data-testid'))
    expect(order).toEqual(['version-update-indicator', 'node-configure', 'node-kebab'])
  })

  it('hides ver-arrow when no newer version is available', async () => {
    const { NodeStatusBar } = await import('@/features/workbench/common/canvas/workflow-node/node-status-bar')
    render(
      <NodeStatusBar
        nodeId="n1"
        kind="plugin"
        runState={undefined}
        isMuted={false}
        hasIssue={false}
        hasNewerVersion={false}
        onConfigure={vi.fn()}
        onMenuAction={vi.fn()}
      />,
    )
    expect(screen.queryByTestId('version-update-indicator')).not.toBeInTheDocument()
  })

  it('hides dig-in glyph for plugin and control nodes', async () => {
    const { NodeStatusBar } = await import('@/features/workbench/common/canvas/workflow-node/node-status-bar')
    render(
      <NodeStatusBar
        nodeId="n1"
        kind="plugin"
        runState={undefined}
        isMuted={false}
        hasIssue={false}
        hasNewerVersion={false}
        onConfigure={vi.fn()}
        onMenuAction={vi.fn()}
      />,
    )
    expect(screen.queryByTestId('node-dig-in')).not.toBeInTheDocument()
  })

  it('renders dig-in glyph for function node when showDigIn is true', async () => {
    const { NodeStatusBar } = await import('@/features/workbench/common/canvas/workflow-node/node-status-bar')
    render(
      <NodeStatusBar
        nodeId="n1"
        kind="function"
        runState={undefined}
        isMuted={false}
        hasIssue={false}
        hasNewerVersion={false}
        showDigIn={true}
        onDigIn={vi.fn()}
        onConfigure={vi.fn()}
        onMenuAction={vi.fn()}
      />,
    )
    expect(screen.getByTestId('node-dig-in')).toBeInTheDocument()
  })

  it('calls onDigIn when the dig-in glyph is clicked', async () => {
    const onDigIn = vi.fn()
    const { NodeStatusBar } = await import('@/features/workbench/common/canvas/workflow-node/node-status-bar')
    const { default: userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()
    render(
      <NodeStatusBar
        nodeId="n1"
        kind="function"
        runState={undefined}
        isMuted={false}
        hasIssue={false}
        hasNewerVersion={false}
        showDigIn={true}
        onDigIn={onDigIn}
        onConfigure={vi.fn()}
        onMenuAction={vi.fn()}
      />,
    )
    await user.click(screen.getByTestId('node-dig-in'))
    expect(onDigIn).toHaveBeenCalledTimes(1)
  })

  it('hides dig-in glyph for function node when showDigIn is false', async () => {
    const { NodeStatusBar } = await import('@/features/workbench/common/canvas/workflow-node/node-status-bar')
    render(
      <NodeStatusBar
        nodeId="n1"
        kind="function"
        runState={undefined}
        isMuted={false}
        hasIssue={false}
        hasNewerVersion={false}
        showDigIn={false}
        onConfigure={vi.fn()}
        onMenuAction={vi.fn()}
      />,
    )
    expect(screen.queryByTestId('node-dig-in')).not.toBeInTheDocument()
  })

  it('calls onConfigure when the cog is clicked', async () => {
    const onConfigure = vi.fn()
    const { NodeStatusBar } = await import('@/features/workbench/common/canvas/workflow-node/node-status-bar')
    const { default: userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()
    render(
      <NodeStatusBar
        nodeId="n1"
        kind="plugin"
        runState={undefined}
        isMuted={false}
        hasIssue={false}
        hasNewerVersion={false}
        onConfigure={onConfigure}
        onMenuAction={vi.fn()}
      />,
    )
    await user.click(screen.getByTestId('node-configure'))
    expect(onConfigure).toHaveBeenCalledTimes(1)
  })
})

describe('NodeStatusBar - slim variant (Note)', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await setupStore({})
  })

  it('renders only the kebab on the right when slim is true', async () => {
    const { NodeStatusBar } = await import('@/features/workbench/common/canvas/workflow-node/node-status-bar')
    render(
      <NodeStatusBar
        nodeId="note-1"
        kind="plugin"
        runState={undefined}
        isMuted={false}
        hasIssue={false}
        hasNewerVersion={false}
        onConfigure={vi.fn()}
        onMenuAction={vi.fn()}
        slim
      />,
    )
    const rightCluster = screen.getByTestId('node-status-bar-right')
    const buttons = within(rightCluster).getAllByRole('button', { hidden: true })
    // Only the kebab is rendered as an interactive role=button in slim variant
    expect(buttons.length).toBeLessThanOrEqual(1)
    expect(screen.queryByTestId('node-configure')).not.toBeInTheDocument()
  })

  it('left cluster is empty in slim variant (no badges)', async () => {
    const { NodeStatusBar } = await import('@/features/workbench/common/canvas/workflow-node/node-status-bar')
    render(
      <NodeStatusBar
        nodeId="note-1"
        kind="plugin"
        runState={undefined}
        isMuted={false}
        hasIssue={false}
        hasNewerVersion={false}
        onConfigure={vi.fn()}
        onMenuAction={vi.fn()}
        slim
      />,
    )
    const leftCluster = screen.getByTestId('node-status-bar-left')
    expect(leftCluster).toBeEmptyDOMElement()
  })
})

describe('NodeStatusBar - run-state visuals', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await setupStore({})
  })

  const states = ['pass', 'fail', 'skip', 'warn', 'run', 'paused', 'stopped', 'disabled'] as const
  for (const state of states) {
    it(`renders the ${state} badge with the correct data-state`, async () => {
      const { NodeStatusBar } = await import('@/features/workbench/common/canvas/workflow-node/node-status-bar')
      render(
        <NodeStatusBar
          nodeId="n1"
          kind="plugin"
          runState={state}
          isMuted={false}
          hasIssue={false}
          hasNewerVersion={false}
          onConfigure={vi.fn()}
          onMenuAction={vi.fn()}
        />,
      )
      const badge = screen.getByTestId('node-run-state-badge')
      expect(badge).toHaveAttribute('data-state', state)
    })
  }
})

describe('NodeStatusBar - left cluster spacing', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await setupStore({})
  })

  it('renders nothing on the left when no issues, no L/S, no run state', async () => {
    const { NodeStatusBar } = await import('@/features/workbench/common/canvas/workflow-node/node-status-bar')
    render(
      <NodeStatusBar
        nodeId="n1"
        kind="plugin"
        runState={undefined}
        isMuted={false}
        hasIssue={false}
        hasNewerVersion={false}
        onConfigure={vi.fn()}
        onMenuAction={vi.fn()}
      />,
    )
    expect(screen.getByTestId('node-status-bar-left')).toBeEmptyDOMElement()
  })
})

describe('NodeStatusBar - dig-in pending', () => {
  it('shows a spinner + aria-busy on the dig-in glyph while the node is dig-in pending', async () => {
    await setupStore({ digInPendingNodeId: 'n1' })
    const { NodeStatusBar } = await import('@/features/workbench/common/canvas/workflow-node/node-status-bar')
    render(
      <NodeStatusBar
        nodeId="n1"
        kind="function"
        functionLifecycle="shared"
        showDigIn
        onConfigure={vi.fn()}
        onMenuAction={vi.fn()}
        onDigIn={vi.fn()}
      />,
    )
    const digIn = screen.getByTestId('node-dig-in')
    expect(digIn).toHaveAttribute('aria-busy', 'true')
    expect(digIn.querySelector('svg.animate-spin')).not.toBeNull()
  })
})

describe('NodeStatusBar - kebab during execution vs read-only scope', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await setupStore({})
  })

  const baseMenuState = {
    hasBreakpoint: false,
    disabled: false,
    skipped: false,
    hasConnections: true,
  }

  function renderInLockedCanvas(isExecuting: boolean) {
    // value=true mirrors the canvas interaction-lock (read-only scope OR executing).
    // Static import (shared module graph with the provider) so the context propagates.
    render(
      <CanvasReadOnlyProvider value={true}>
        <NodeStatusBarStatic
          nodeId="n1"
          kind="plugin"
          runState={undefined}
          isMuted={false}
          hasIssue={false}
          hasNewerVersion={false}
          menuState={{ ...baseMenuState, isExecuting }}
          onConfigure={vi.fn()}
          onMenuAction={vi.fn()}
        />
      </CanvasReadOnlyProvider>,
    )
  }

  it('keeps the kebab during execution so breakpoints can still be toggled', () => {
    renderInLockedCanvas(true)
    expect(screen.getByTestId('node-kebab')).toBeInTheDocument()
  })

  it('hides the kebab in a truly read-only scope (idle, not executing)', () => {
    renderInLockedCanvas(false)
    expect(screen.queryByTestId('node-kebab')).not.toBeInTheDocument()
  })
})

/**
 * Action-cluster tooltips (CANVAS-238..240).
 *
 * Each of the three buttons names itself on hover and shows how to reach it
 * from the keyboard - or, for the kebab, the gesture that opens it. The
 * tooltip is supplementary, so the accessible name stays and must agree.
 */
describe('NodeStatusBar - action tooltips', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await setupStore({})
  })

  function popup(): HTMLElement | null {
    return document.querySelector('[data-slot="tooltip-content"]')
  }

  function reveal(testId: string): void {
    act(() => {
      fireEvent.focus(screen.getByTestId(testId))
    })
  }

  function renderBar(): void {
    render(
      <NodeStatusBarStatic
        nodeId="n1"
        kind="function"
        functionLifecycle="shared"
        showDigIn
        onConfigure={vi.fn()}
        onMenuAction={vi.fn()}
        onDigIn={vi.fn()}
        menuState={undefined}
      />,
    )
  }

  it('names the cog Configure and shows the Enter key', () => {
    renderBar()

    reveal('node-configure')

    expect(popup()).toHaveTextContent('Configure')
    expect(popup()).toHaveTextContent('Enter')
    expect(screen.getByTestId('node-configure')).toHaveAttribute('aria-label', 'Configure')
  })

  it('anchors the cog tooltip below the button', () => {
    renderBar()

    reveal('node-configure')

    expect(popup()).toHaveAttribute('data-side', 'bottom')
  })

  it('names the kebab More options and shows the pointer gesture', () => {
    renderBar()

    reveal('node-kebab')

    expect(popup()).toHaveTextContent('More options')
    expect(popup()).toHaveTextContent(/right-click/i)
    expect(screen.getByTestId('node-kebab')).toHaveAttribute('aria-label', 'More options')
  })

  it('names the dig-in control Open and shows the Ctrl+Enter key', () => {
    renderBar()

    reveal('node-dig-in')

    expect(popup()).toHaveTextContent('Open')
    expect(popup()).toHaveTextContent(/enter/i)
  })

  it('keeps the key badges out of the accessible name', () => {
    renderBar()

    reveal('node-configure')

    expect(popup()?.querySelector('[data-slot="kbd"]')).toHaveAttribute('aria-hidden', 'true')
  })

  it('drops the browser title popup from the version arrow', () => {
    render(
      <NodeStatusBarStatic
        nodeId="n1"
        kind="function"
        hasNewerVersion
        onConfigure={vi.fn()}
        onMenuAction={vi.fn()}
      />,
    )

    const indicator = screen.getByTestId('version-update-indicator')
    expect(indicator).not.toHaveAttribute('title')
    expect(indicator).toHaveAttribute('aria-label', 'Newer version available')
  })

  it('shows the version arrow hint through the shared tooltip', () => {
    render(
      <NodeStatusBarStatic
        nodeId="n1"
        kind="function"
        hasNewerVersion
        onConfigure={vi.fn()}
        onMenuAction={vi.fn()}
      />,
    )

    reveal('version-update-indicator')

    expect(popup()).toHaveTextContent('Newer version available')
  })
})
