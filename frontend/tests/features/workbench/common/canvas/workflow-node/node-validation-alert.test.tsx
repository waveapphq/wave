/**
 * Tests for NodeValidationAlert.
 *
 * Renders an AlertTriangle badge top-left, just outside the node body, when
 * the node has issues. Adds the `animate-validation-icon-pulse` class when
 * the node id is in `pulseValidationNodeIds`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

import { NodeValidationAlert } from '@/features/workbench/common/canvas/workflow-node/node-validation-alert'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'

const REVEAL_LABEL = 'Secrets revealed - shown in cleartext in run logs and reports'
const REQUIRED_ISSUE: MockIssue[] = [
  { code: 'REQUIRED_PARAM_MISSING', severity: 'error', paramName: 'url', message: 'Required parameter url is missing' },
]

vi.mock('@/features/workbench/stores/workflow-store')

type MockIssue = {
  code: string
  severity: 'error' | 'warning'
  paramName?: string
  message: string
}

interface MockState {
  nodeIssues: Map<string, MockIssue[]>
  pulseValidationNodeIds: Set<string>
}

function setupStore(state: MockState) {
  vi.mocked(useWorkflowStore).mockImplementation((selector: unknown) => {
    return (selector as (s: MockState) => unknown)(state)
  })
}

describe('NodeValidationAlert', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders nothing when nodeIssues does not contain the node id', () => {
    setupStore({
      nodeIssues: new Map(),
      pulseValidationNodeIds: new Set(),
    })
    render(<NodeValidationAlert nodeId="node-1" pulse={false} />)
    expect(screen.queryByLabelText(/configuration incomplete/i)).not.toBeInTheDocument()
  })

  it('renders the alert icon when nodeIssues has the node id', () => {
    setupStore({
      nodeIssues: new Map([
        ['node-1', [{ code: 'REQUIRED_PARAM_MISSING', severity: 'error', paramName: 'url', message: 'Required parameter url is missing' }]],
      ]),
      pulseValidationNodeIds: new Set(),
    })
    render(<NodeValidationAlert nodeId="node-1" pulse={false} />)
    expect(screen.getByLabelText(/configuration incomplete/i)).toBeInTheDocument()
  })

  it('does not apply the pulse class when pulse=false', () => {
    setupStore({
      nodeIssues: new Map([
        ['node-1', [{ code: 'REQUIRED_PARAM_MISSING', severity: 'error', paramName: 'url', message: 'Required parameter url is missing' }]],
      ]),
      pulseValidationNodeIds: new Set(),
    })
    const { container } = render(<NodeValidationAlert nodeId="node-1" pulse={false} />)
    const animated = container.querySelector('.animate-validation-icon-pulse')
    expect(animated).toBeNull()
  })

  it('applies the pulse class when pulse=true', () => {
    setupStore({
      nodeIssues: new Map([
        ['node-1', [{ code: 'REQUIRED_PARAM_MISSING', severity: 'error', paramName: 'url', message: 'Required parameter url is missing' }]],
      ]),
      pulseValidationNodeIds: new Set(['node-1']),
    })
    const { container } = render(<NodeValidationAlert nodeId="node-1" pulse={true} />)
    const animated = container.querySelector('.animate-validation-icon-pulse')
    expect(animated).not.toBeNull()
  })

  it('renders as an inline badge inside the status bar left cluster (no corner positioning)', () => {
    setupStore({
      nodeIssues: new Map([
        ['node-1', [{ code: 'REQUIRED_PARAM_MISSING', severity: 'error', paramName: 'url', message: 'Required parameter url is missing' }]],
      ]),
      pulseValidationNodeIds: new Set(),
    })
    const { container } = render(<NodeValidationAlert nodeId="node-1" pulse={false} />)
    const wrapper = container.firstElementChild as HTMLElement | null
    expect(wrapper).not.toBeNull()
    expect(wrapper!.className).toContain('inline-flex')
    expect(wrapper!.className).not.toContain('absolute')
  })

  it('renders the badge even when an issue lacks labelable identifiers (defensive)', () => {
    setupStore({
      nodeIssues: new Map([
        // Defensive case: an issue with neither paramName nor code (shouldn't
        // happen in practice but the component must not crash).
        ['node-1', [{ code: '', severity: 'error', message: 'unknown issue' } as MockIssue]],
      ]),
      pulseValidationNodeIds: new Set(),
    })
    const { container } = render(<NodeValidationAlert nodeId="node-1" pulse={false} />)
    // The badge surface uses aria-label as the alt text; the per-issue body
    // is delivered through the ConditionalTooltip wrapper on hover.
    const badge = container.querySelector('[data-testid="node-validation-alert"]') as HTMLElement | null
    expect(badge).not.toBeNull()
    expect(badge!.getAttribute('aria-label')).toBe('Configuration incomplete')
  })

  it('shows the per-issue message list in the hover tooltip', async () => {
    const userEvent = (await import('@testing-library/user-event')).default
    setupStore({
      nodeIssues: new Map([
        [
          'node-1',
          [
            { code: 'REQUIRED_PARAM_MISSING', severity: 'error', paramName: 'url', message: 'Required parameter url is missing' },
            { code: 'REQUIRED_PARAM_EMPTY', severity: 'error', paramName: 'method', message: 'Required parameter method is empty' },
          ],
        ],
      ]),
      pulseValidationNodeIds: new Set(),
    })
    const user = userEvent.setup()
    const { container } = render(<NodeValidationAlert nodeId="node-1" pulse={false} />)
    const badge = container.querySelector('[data-testid="node-validation-alert"]') as HTMLElement
    await user.hover(badge)
    // Both per-issue messages must surface in the rendered tooltip body so the
    // user can see WHICH parameter is failing without opening the dialog.
    const { findAllByText } = await import('@testing-library/react')
    const urlMatches = await findAllByText(document.body, /Required parameter url is missing/)
    expect(urlMatches.length).toBeGreaterThan(0)
    const methodMatches = await findAllByText(document.body, /Required parameter method is empty/)
    expect(methodMatches.length).toBeGreaterThan(0)
  })

  it('falls back to the issue index in the list key when paramName is absent', async () => {
    const userEvent = (await import('@testing-library/user-event')).default
    setupStore({
      nodeIssues: new Map([
        [
          'node-1',
          [
            // No paramName -> the list key must fall back to the array index.
            { code: 'INVALID_OUTPUT_BINDING_TYPE', severity: 'error', message: 'Output binding type is invalid' },
          ],
        ],
      ]),
      pulseValidationNodeIds: new Set(),
    })
    const user = userEvent.setup()
    const { container } = render(<NodeValidationAlert nodeId="node-1" pulse={false} />)
    const badge = container.querySelector('[data-testid="node-validation-alert"]') as HTMLElement
    await user.hover(badge)
    const { findAllByText } = await import('@testing-library/react')
    const matches = await findAllByText(document.body, /Output binding type is invalid/)
    expect(matches.length).toBeGreaterThan(0)
  })

  // The canvas "unsecured" amber badge reuses the validation-alert
  // slot; it shows only when the node is effective-revealing AND has no issues.
  // The red misconfiguration triangle supersedes it (red wins).
  describe('reveal (amber) badge', () => {
    it('renders the amber reveal badge when revealing and there are no issues', () => {
      setupStore({ nodeIssues: new Map(), pulseValidationNodeIds: new Set() })
      render(<NodeValidationAlert nodeId="node-1" pulse={false} revealing={true} />)
      const badge = screen.getByTestId('node-reveal-alert')
      expect(badge).toBeInTheDocument()
      expect(badge.getAttribute('aria-label')).toBe(REVEAL_LABEL)
    })

    it('renders nothing when not revealing and there are no issues', () => {
      setupStore({ nodeIssues: new Map(), pulseValidationNodeIds: new Set() })
      render(<NodeValidationAlert nodeId="node-1" pulse={false} revealing={false} />)
      expect(screen.queryByTestId('node-reveal-alert')).not.toBeInTheDocument()
      expect(screen.queryByTestId('node-validation-alert')).not.toBeInTheDocument()
    })

    it('shows the reveal explanation in the hover tooltip', async () => {
      const userEvent = (await import('@testing-library/user-event')).default
      setupStore({ nodeIssues: new Map(), pulseValidationNodeIds: new Set() })
      const user = userEvent.setup()
      const { container } = render(
        <NodeValidationAlert nodeId="node-1" pulse={false} revealing={true} />,
      )
      const badge = container.querySelector('[data-testid="node-reveal-alert"]') as HTMLElement
      await user.hover(badge)
      const { findAllByText } = await import('@testing-library/react')
      const matches = await findAllByText(document.body, /Secrets revealed/)
      expect(matches.length).toBeGreaterThan(0)
    })

    it('red misconfiguration triangle wins when the node has issues AND is revealing', () => {
      setupStore({
        nodeIssues: new Map([['node-1', REQUIRED_ISSUE]]),
        pulseValidationNodeIds: new Set(),
      })
      render(<NodeValidationAlert nodeId="node-1" pulse={false} revealing={true} />)
      expect(screen.getByTestId('node-validation-alert')).toBeInTheDocument()
      expect(screen.queryByTestId('node-reveal-alert')).not.toBeInTheDocument()
    })

    it('shows the red badge (not amber) for an issue-only node', () => {
      setupStore({
        nodeIssues: new Map([['node-1', REQUIRED_ISSUE]]),
        pulseValidationNodeIds: new Set(),
      })
      render(<NodeValidationAlert nodeId="node-1" pulse={false} revealing={false} />)
      expect(screen.getByLabelText(/configuration incomplete/i)).toBeInTheDocument()
      expect(screen.queryByTestId('node-reveal-alert')).not.toBeInTheDocument()
    })
  })
})

// PYRUN-14: a warning never marks the block invalid; only an error issue does.
describe('NodeValidationAlert - issue severity', () => {
  const WARNING_ISSUE: MockIssue = {
    code: 'OUTPUT_LIST_NAME',
    severity: 'warning',
    message: "Script never sets 'COUNT'",
  }
  const ERROR_ISSUE: MockIssue = {
    code: 'REQUIRED_PARAM_MISSING',
    severity: 'error',
    message: 'Script has a syntax error on line 3',
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows no invalid badge when every issue is a warning', () => {
    setupStore({
      nodeIssues: new Map([['node-1', [WARNING_ISSUE]]]),
      pulseValidationNodeIds: new Set(),
    })
    render(<NodeValidationAlert nodeId="node-1" pulse={false} />)
    expect(screen.queryByTestId('node-validation-alert')).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/configuration incomplete/i)).not.toBeInTheDocument()
  })

  it('shows the invalid badge when an issue is an error', () => {
    setupStore({
      nodeIssues: new Map([['node-1', [ERROR_ISSUE]]]),
      pulseValidationNodeIds: new Set(),
    })
    render(<NodeValidationAlert nodeId="node-1" pulse={false} />)
    expect(screen.getByTestId('node-validation-alert')).toBeInTheDocument()
  })

  it('lists the warning beside the error when the block carries both', async () => {
    const userEvent = (await import('@testing-library/user-event')).default
    setupStore({
      nodeIssues: new Map([['node-1', [ERROR_ISSUE, WARNING_ISSUE]]]),
      pulseValidationNodeIds: new Set(),
    })
    const user = userEvent.setup()
    const { container } = render(<NodeValidationAlert nodeId="node-1" pulse={false} />)
    const badge = container.querySelector('[data-testid="node-validation-alert"]') as HTMLElement
    await user.hover(badge)

    const { findAllByText } = await import('@testing-library/react')
    expect((await findAllByText(document.body, ERROR_ISSUE.message)).length).toBeGreaterThan(0)
    expect((await findAllByText(document.body, WARNING_ISSUE.message)).length).toBeGreaterThan(0)
  })
})
