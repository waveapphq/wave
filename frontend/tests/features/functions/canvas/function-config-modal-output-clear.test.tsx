/** A Function Block's output bindings set and cleared through the shared output picker, then saved. */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReactFlowProvider } from '@xyflow/react'

vi.mock(
  '@/features/workbench/common/element-config/outputs/output-binding-combobox',
  () => ({
    OutputBindingCombobox: ({
      value,
      onChange,
    }: {
      value: string
      onChange: (next: string) => void
    }) => (
      <div data-testid="binding-double">
        <span data-testid="binding-value">{value}</span>
        <button type="button" data-testid="binding-clear" onClick={() => onChange('')}>
          clear
        </button>
        <button type="button" data-testid="binding-set" onClick={() => onChange('next_var')}>
          set
        </button>
      </div>
    ),
  }),
)

vi.mock('@/features/profiles/api/crud', () => ({
  fetchProfiles: vi.fn(async () => ({
    data: [],
    pagination: { total: 0, page: 1, per_page: 100, total_pages: 1 },
  })),
}))

import { ConfigSheetHost } from '@/features/workbench/common/canvas/workflow-canvas/canvas'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'

const NODE_ID = 'fn-1'

function localBlock(outputs: Array<{ name: string; type: string }>, outputBindings: Record<string, string>) {
  return {
    id: NODE_ID,
    type: 'workflowNode',
    position: { x: 0, y: 0 },
    data: {
      label: 'fn',
      description: '',
      elementType: 'function',
      nodeType: 'function',
      functionLifecycle: 'local',
      localDefinition: {
        name: 'fn',
        description: '',
        inputs: [],
        outputs,
        variables: [],
        workflow: { nodes: [], edges: [] },
      },
      config: { values: {}, outputBindings },
    },
  }
}

/** Opens the Block's window the way the canvas does for an open sheet. */
function openWindow(node: ReturnType<typeof localBlock>) {
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

function storedBindings(): Record<string, string> {
  const data = useWorkflowStore.getState().nodes.find((n) => n.id === NODE_ID)?.data as Record<string, unknown>
  return (data.config as { outputBindings: Record<string, string> }).outputBindings
}

beforeEach(() => {
  useWorkflowStore.getState().reset()
})

describe('Function Block window - output binding clear and set', () => {
  it('leaves a cleared output unbound on Save and keeps the other binding', async () => {
    const user = userEvent.setup()
    openWindow(
      localBlock(
        [
          { name: 'result', type: 'string' },
          { name: 'other', type: 'string' },
        ],
        { result: 'pre_existing', other: 'keep_me' },
      ),
    )

    const values = screen.getAllByTestId('binding-value')
    expect(values.map((value) => value.textContent)).toEqual(['pre_existing', 'keep_me'])

    await user.click(screen.getAllByTestId('binding-clear')[0])
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    const bindings = storedBindings()
    expect(bindings.result ?? '').toBe('')
    expect(bindings.other).toBe('keep_me')
  })

  it('stores the binding the row reports', async () => {
    const user = userEvent.setup()
    openWindow(localBlock([{ name: 'result', type: 'string' }], {}))

    await user.click(screen.getByTestId('binding-set'))
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    expect(storedBindings().result).toBe('next_var')
  })

  it('declares the variable a new binding names, typed by its output', async () => {
    const user = userEvent.setup()
    openWindow(localBlock([{ name: 'result', type: 'string' }], {}))

    await user.click(screen.getByTestId('binding-set'))
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    const declared = useWorkflowStore.getState().variables.find((variable) => variable.name === 'next_var')
    expect(declared?.type).toBe('string')
  })
})
