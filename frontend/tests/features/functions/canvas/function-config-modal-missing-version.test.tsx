/** A Shared Function Block pinned to a version the library no longer has, on the shared Block window. */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReactFlowProvider } from '@xyflow/react'

const useFunctionVersionsMock = vi.fn()
vi.mock('@/features/functions/hooks/use-function-versions', () => ({
  useFunctionVersions: (...args: unknown[]) => useFunctionVersionsMock(...args),
}))

vi.mock('@/features/profiles/api/crud', () => ({
  fetchProfiles: vi.fn(async () => ({
    data: [],
    pagination: { total: 0, page: 1, per_page: 100, total_pages: 1 },
  })),
}))

import { ConfigSheetHost } from '@/features/workbench/common/canvas/workflow-canvas/canvas'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'

const NODE_ID = 'fn-missing-1'
const PINNED_INPUTS = [{ name: 'x', type: 'string', required: true }]
const PINNED_OUTPUTS = [{ name: 'result', type: 'string' }]

function missingVersionBlock() {
  return {
    id: NODE_ID,
    type: 'workflowNode',
    position: { x: 0, y: 0 },
    data: {
      label: 'Greet User',
      description: 'Pinned to a version that no longer exists.',
      elementType: 'function',
      nodeType: 'function',
      functionLifecycle: 'shared',
      functionId: '00000000-0000-0000-0000-0000000000aa',
      // Pinned to v1.4.2, which the version list below does not hold.
      functionVersion: '1.4.2',
      missingVersion: true,
      resolvedInputs: PINNED_INPUTS,
      resolvedOutputs: PINNED_OUTPUTS,
      config: { values: { x: 'hello' }, outputBindings: {} },
    },
  }
}

/** Opens the Block's window the way the canvas does for an open sheet. */
function openWindow() {
  useWorkflowStore.setState({
    nodes: [missingVersionBlock()] as never,
    edges: [],
    variables: [],
    drillPath: [],
    openConfigNodeIds: [NODE_ID],
  })
  render(
    <ReactFlowProvider>
      <ConfigSheetHost nodeId={NODE_ID} cascadeIndex={0} />
    </ReactFlowProvider>,
  )
}

function storedData(): Record<string, unknown> {
  return useWorkflowStore.getState().nodes.find((n) => n.id === NODE_ID)?.data as Record<string, unknown>
}

async function pickVersion(user: ReturnType<typeof userEvent.setup>, version: RegExp) {
  await user.click(screen.getByTestId('version-dropdown-trigger'))
  await user.click(screen.getByRole('menuitemradio', { name: version }))
}

beforeEach(() => {
  useWorkflowStore.getState().reset()
  useFunctionVersionsMock.mockReset()
  useFunctionVersionsMock.mockReturnValue({
    versions: [
      { version: '2.0.0', published_at: '2026-03-01T00:00:00Z' },
      { version: '1.5.0', published_at: '2026-02-01T00:00:00Z' },
    ],
    latest: '2.0.0',
    isLoading: false,
    failed: false,
    retry: () => {},
  })
})

describe('Function Block window - missing-version banner', () => {
  it('shows the banner on the shared Block window', () => {
    openWindow()
    const sheet = screen.getByTestId('element-config-sheet')
    expect(within(sheet).getByTestId('missing-version-banner')).toBeInTheDocument()
    expect(screen.getAllByTestId(/-config-sheet$/)).toHaveLength(1)
  })

  it('renders a destructive role="alert" banner naming the missing version', () => {
    openWindow()
    const banner = screen.getByTestId('missing-version-banner')
    expect(banner).toHaveAttribute('role', 'alert')
    expect(within(banner).getByText(/Version v1\.4\.2/i)).toBeInTheDocument()
    expect(within(banner).getByText(/not available in the library/i)).toBeInTheDocument()
  })

  it('tells the user to pick an available version', () => {
    openWindow()
    const banner = screen.getByTestId('missing-version-banner')
    expect(within(banner).getByText(/pick an available version/i)).toBeInTheDocument()
  })
})

describe('Function Block window - missing-version dropdown trigger', () => {
  it('renders the trigger with a red border and ring', () => {
    openWindow()
    const trigger = screen.getByTestId('version-dropdown-trigger')
    expect(trigger.className).toMatch(/border-red-(500|600)/)
    expect(trigger.className).toMatch(/ring-red-/)
  })

  it('renders the pinned version struck through on the trigger', () => {
    openWindow()
    const trigger = screen.getByTestId('version-dropdown-trigger')
    expect(within(trigger).getByText(/1\.4\.2/).className).toMatch(/line-through/)
  })

  it('renders a destructive "Missing" chip next to the pinned version', () => {
    openWindow()
    const trigger = screen.getByTestId('version-dropdown-trigger')
    expect(within(trigger).getByText(/missing/i)).toBeInTheDocument()
  })
})

describe('Function Block window - missing-version dropdown menu', () => {
  it('lists only the available versions, not the missing pinned one', async () => {
    const user = userEvent.setup()
    openWindow()
    await user.click(screen.getByTestId('version-dropdown-trigger'))
    expect(screen.getByRole('menuitemradio', { name: /2\.0\.0/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitemradio', { name: /1\.5\.0/ })).toBeInTheDocument()
    expect(screen.queryByRole('menuitemradio', { name: /1\.4\.2/ })).toBeNull()
  })
})

describe('Function Block window - picking an available version clears the missing state', () => {
  it('removes the banner and the Missing chip once an available version is picked', async () => {
    const user = userEvent.setup()
    openWindow()
    expect(screen.getByTestId('missing-version-banner')).toBeInTheDocument()

    await pickVersion(user, /2\.0\.0/)

    expect(screen.queryByTestId('missing-version-banner')).toBeNull()
    const trigger = screen.getByTestId('version-dropdown-trigger')
    expect(within(trigger).queryByText(/missing/i)).toBeNull()
    expect(within(trigger).getByText(/2\.0\.0/).className).not.toMatch(/line-through/)
  })
})

describe('Function Block window - missing-version Save stores the pin', () => {
  it('stores the picked version on Save', async () => {
    const user = userEvent.setup()
    openWindow()
    await pickVersion(user, /2\.0\.0/)
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    expect(storedData().functionVersion).toBe('2.0.0')
  })

  it('stores missingVersion false and the picked version contract once an available version is picked', async () => {
    // Each version descriptor carries its own contract, which the Save stamps on the Block.
    useFunctionVersionsMock.mockReturnValue({
      versions: [
        {
          version: '2.0.0',
          published_at: '2026-03-01T00:00:00Z',
          inputs: [{ name: 'x', type: 'string', required: true, description: '' }],
          outputs: [{ name: 'valid', type: 'boolean', description: '' }],
        },
        { version: '1.5.0', published_at: '2026-02-01T00:00:00Z' },
      ],
      latest: '2.0.0',
      isLoading: false,
      failed: false,
      retry: () => {},
    })
    const user = userEvent.setup()
    openWindow()
    await pickVersion(user, /2\.0\.0/)
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    const data = storedData()
    expect(data.functionVersion).toBe('2.0.0')
    expect(data.missingVersion).toBe(false)
    expect(data.resolvedInputs).toEqual([{ name: 'x', type: 'string', required: true, description: '' }])
    expect(data.resolvedOutputs).toEqual([{ name: 'valid', type: 'boolean', description: '' }])
  })

  it('stores missingVersion true and keeps the pinned contract when Save leaves the pin on the missing version', async () => {
    const user = userEvent.setup()
    openWindow()
    // The missing-version state enables Save with no edit, so Save keeps the broken pin.
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    const data = storedData()
    expect(data.functionVersion).toBe('1.4.2')
    expect(data.missingVersion).toBe(true)
    expect(data.resolvedInputs).toEqual(PINNED_INPUTS)
    expect(data.resolvedOutputs).toEqual(PINNED_OUTPUTS)
  })
})
