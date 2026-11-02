/** A Shared Function Block in edit mode, opened in the shared Block window with its lifecycle chrome (CANVAS-207). */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReactFlowProvider } from '@xyflow/react'

vi.mock('@/features/functions/hooks/use-function-versions', () => ({
  useFunctionVersions: () => ({
    versions: [
      { version: '2.0.0', published_at: '2026-03-01', changelog: '', details: '', description: '', tags: [] },
      { version: '1.0.0', published_at: '2026-02-01', changelog: '', details: '', description: '', tags: [] },
    ],
    latest: '2.0.0',
    isLoading: false,
    failed: false,
    retry: () => {},
  }),
}))

vi.mock('@/features/profiles/api/crud', () => ({
  fetchProfiles: vi.fn(async () => ({
    data: [],
    pagination: { total: 0, page: 1, per_page: 100, total_pages: 1 },
  })),
}))

import { ConfigSheetHost } from '@/features/workbench/common/canvas/workflow-canvas/canvas'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'

const NODE_ID = 'fn-edit-1'
const FUNCTION_ID = '00000000-0000-0000-0000-0000000000aa'
const INPUTS = [{ name: 'x', type: 'string', required: true }]
const OUTPUTS = [{ name: 'result', type: 'string' }]

function editModeBlock(outputBindings: Record<string, string> = {}) {
  return {
    id: NODE_ID,
    type: 'workflowNode',
    position: { x: 0, y: 0 },
    data: {
      label: 'Greet User',
      description: 'Existing description',
      elementType: 'function',
      nodeType: 'function',
      functionLifecycle: 'shared',
      functionId: FUNCTION_ID,
      functionVersion: '1.0.0',
      editMode: true,
      upstreamLink: { functionId: FUNCTION_ID, sourceVersion: '1.0.0' },
      draft: {
        name: 'Greet User',
        description: 'Library description',
        tags: [],
        inputs: INPUTS,
        outputs: OUTPUTS,
        dependencies: { functions: [], plugins: [] },
        workflow: { nodes: [], edges: [] },
      },
      resolvedInputs: INPUTS,
      resolvedOutputs: OUTPUTS,
      config: { values: { x: 'hello' }, outputBindings },
    },
  }
}

/** Opens the Block's window the way the canvas does for an open sheet. */
function openWindow(node = editModeBlock()) {
  useWorkflowStore.setState({
    nodes: [node] as never,
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

beforeEach(() => {
  useWorkflowStore.getState().reset()
})

describe('Function Block window - edit mode on the shared Block window', () => {
  it('opens the shared Block window, not a Function-only window', () => {
    openWindow()
    expect(screen.getByTestId('element-config-sheet')).toBeInTheDocument()
    expect(screen.getAllByTestId(/-config-sheet$/)).toHaveLength(1)
  })

  it('does not render the lifecycle badge inside the window (CANVAS-208, CANVAS-209)', () => {
    openWindow()
    expect(screen.queryByTestId('function-lifecycle-badge')).toBeNull()
    expect(screen.queryByTestId('edit-mode-mark')).toBeNull()
  })
})

describe('Function Block window - edit mode hides the library actions', () => {
  it('does not render a Publish button in the footer', () => {
    openWindow()
    expect(screen.queryByRole('button', { name: /^publish$/i })).toBeNull()
  })

  it('does not render a Drop changes button in the footer', () => {
    openWindow()
    expect(screen.queryByRole('button', { name: /drop changes/i })).toBeNull()
  })

  it('does not render the Changelog or Details buttons', () => {
    openWindow()
    expect(screen.queryByRole('button', { name: /changelog/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /details/i })).toBeNull()
  })

  it('renders the Cancel and Save footer buttons', () => {
    openWindow()
    expect(screen.getByRole('button', { name: /^cancel$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^save$/i })).toBeInTheDocument()
  })
})

describe('Function Block window - edit mode locks the version list', () => {
  it('disables the version dropdown trigger', () => {
    openWindow()
    expect(screen.getByTestId('version-dropdown-trigger')).toBeDisabled()
  })
})

describe('Function Block window - edit mode keeps the description on the Block', () => {
  it("stores the edited description on the Block and leaves the draft's description alone", async () => {
    const user = userEvent.setup()
    openWindow()
    const description = screen.getByTestId('element-description-input')
    await user.clear(description)
    await user.type(description, 'New description for this Block')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    expect(storedData().description).toBe('New description for this Block')
    expect((storedData().draft as Record<string, unknown>).description).toBe('Library description')
  })

  it("clears an emptied description from the Block and leaves the draft's description alone", async () => {
    const user = userEvent.setup()
    openWindow()
    await user.clear(screen.getByTestId('element-description-input'))
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    expect(storedData().description).toBeUndefined()
    expect((storedData().draft as Record<string, unknown>).description).toBe('Library description')
  })
})

describe('Function Block window - edit mode honors the output binding gate', () => {
  it('disables Save while an output binding name is invalid', async () => {
    const user = userEvent.setup()
    openWindow()
    // Edit mode waives the nothing-changed rule, so Save starts enabled.
    const save = screen.getByRole('button', { name: /^save$/i })
    expect(save).not.toBeDisabled()

    const row = screen.getByTestId('output-row-result')
    await user.type(within(row).getByRole('combobox'), 'k8s-')

    expect(screen.getByTestId('field-error-result')).toBeVisible()
    expect(save).toBeDisabled()
    expect(useWorkflowStore.getState().openConfigNodeIds).toEqual([NODE_ID])
  })

  it('saves an edit-mode Block whose binding name is valid', async () => {
    const user = userEvent.setup()
    openWindow(editModeBlock({ result: 'pods' }))
    const save = screen.getByRole('button', { name: /^save$/i })
    expect(save).not.toBeDisabled()

    await user.click(save)

    const config = storedData().config as Record<string, unknown>
    expect(config.outputBindings).toEqual({ result: 'pods' })
    expect(useWorkflowStore.getState().openConfigNodeIds).toEqual([])
  })
})
