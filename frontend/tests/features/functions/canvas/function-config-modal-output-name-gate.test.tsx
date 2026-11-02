/** A Function Block output bound to a name the run can never write shows why and holds Save, as on any Block. */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReactFlowProvider } from '@xyflow/react'

vi.mock('@/features/profiles/api/crud', () => ({
  fetchProfiles: vi.fn(async () => ({
    data: [],
    pagination: { total: 0, page: 1, per_page: 100, total_pages: 1 },
  })),
}))

import { ConfigSheetHost } from '@/features/workbench/common/canvas/workflow-canvas/canvas'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'

const NODE_ID = 'fn-gate-1'

function localBlock(outputBindings: Record<string, string>) {
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
        outputs: [{ name: 'result', type: 'string' }],
        variables: [],
        workflow: { nodes: [], edges: [] },
      },
      config: { values: {}, outputBindings },
    },
  }
}

/** Opens the Block's window the way the canvas does for an open sheet. */
function openWindow(outputBindings: Record<string, string> = {}) {
  useWorkflowStore.setState({
    nodes: [localBlock(outputBindings)] as never,
    edges: [],
    variables: [{ id: 'v-pods', name: 'pods', type: 'string', value: '' }],
    drillPath: [],
    openConfigNodeIds: [NODE_ID],
  })
  render(
    <ReactFlowProvider>
      <ConfigSheetHost nodeId={NODE_ID} cascadeIndex={0} />
    </ReactFlowProvider>,
  )
}

function storedConfig(): Record<string, unknown> {
  const data = useWorkflowStore.getState().nodes.find((n) => n.id === NODE_ID)?.data as Record<string, unknown>
  return data.config as Record<string, unknown>
}

const resultBinding = () => within(screen.getByTestId('output-row-result')).getByRole('combobox')

beforeEach(() => {
  useWorkflowStore.getState().reset()
})

describe('Function Block window - output binding name gate', () => {
  it('shows the gate on the shared Block window', async () => {
    const user = userEvent.setup({ delay: null })
    openWindow()
    await user.type(resultBinding(), 'k8s-')
    const sheet = screen.getByTestId('element-config-sheet')
    expect(within(sheet).getByTestId('field-error-result')).toBeVisible()
  })

  it('shows the reason under the row and disables Save while the name is invalid', async () => {
    const user = userEvent.setup({ delay: null })
    openWindow()

    const combobox = resultBinding()
    await user.click(combobox)
    await user.type(combobox, 'k8s-')

    const fieldError = screen.getByTestId('field-error-result')
    expect(fieldError).toBeVisible()
    expect(fieldError).toHaveAttribute('role', 'alert')
    expect(fieldError).toHaveTextContent(
      /^'k8s-' is not a valid variable name \(use letters, digits, underscores; must not start with a digit\)$/,
    )
    expect(combobox).toHaveAttribute('aria-describedby', fieldError.id)

    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled()
  })

  it('clears the message and enables Save again the moment the name becomes valid', async () => {
    const user = userEvent.setup({ delay: null })
    openWindow()

    const combobox = resultBinding()
    await user.click(combobox)
    await user.type(combobox, 'k8s-')
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled()

    await user.keyboard('{Backspace}')

    expect(screen.queryByTestId('field-error-result')).not.toBeInTheDocument()
    expect(combobox).not.toHaveAttribute('aria-describedby')
    expect(screen.getByRole('button', { name: /^save$/i })).not.toBeDisabled()
  })
})

describe('Function Block window - the unsaved-changes prompt honors the same gate', () => {
  it('refuses Save in the prompt while the name is invalid, and Close still closes', async () => {
    const user = userEvent.setup({ delay: null })
    openWindow()

    await user.type(resultBinding(), 'k8s-')
    await user.click(screen.getByRole('button', { name: /^cancel$/i }))

    const prompt = screen.getByRole('dialog')
    expect(within(prompt).getByRole('button', { name: /^save$/i })).toBeDisabled()

    const close = within(prompt).getByTestId('unsaved-close')
    expect(close).toHaveTextContent(/^Close$/)
    await user.click(close)
    expect(storedConfig()).toEqual({ values: {}, outputBindings: {} })
    expect(useWorkflowStore.getState().openConfigNodeIds).toEqual([])
  })

  it('saves from the prompt when the binding name is valid', async () => {
    const user = userEvent.setup({ delay: null })
    openWindow({ result: 'pods' })

    await user.type(screen.getByTestId('element-description-input'), 'edited')
    await user.click(screen.getByRole('button', { name: /^cancel$/i }))

    const prompt = screen.getByRole('dialog')
    const save = within(prompt).getByRole('button', { name: /^save$/i })
    expect(save).not.toBeDisabled()

    await user.click(save)
    expect(storedConfig().outputBindings).toEqual({ result: 'pods' })
  })
})
