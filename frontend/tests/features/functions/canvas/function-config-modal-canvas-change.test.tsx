/** A Function Block's window left open while the canvas changes: edited fields keep the edit, the rest follow the Block. */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, renderHook, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReactFlowProvider } from '@xyflow/react'

vi.mock('@/features/profiles/api/crud', () => ({
  fetchProfiles: vi.fn(async () => ({
    data: [],
    pagination: { total: 0, page: 1, per_page: 100, total_pages: 1 },
  })),
}))

vi.mock('@/features/workbench/hooks/use-variable-updates', () => ({
  useVariableUpdates: () => ({ values: new Map(), recentlyChangedPaths: new Set(), forget: vi.fn() }),
}))

vi.mock('@/features/workbench/api/workbench', () => ({
  workbenchApi: { setVariableOverride: vi.fn() },
}))

vi.mock('@/components/ui/toast', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/ui/toast')>()),
  useToast: () => ({ error: vi.fn(), success: vi.fn() }),
}))

import { ConfigSheetHost } from '@/features/workbench/common/canvas/workflow-canvas/canvas'
import { useVariableManagement } from '@/features/workbench/live/use-variable-management'
import { useWorkflowStore, type WorkflowVariable } from '@/features/workbench/stores/workflow-store'

const FN_ID = 'fn-a'

const functionBlock = {
  id: FN_ID,
  type: 'workflowNode',
  position: { x: 0, y: 0 },
  data: {
    label: 'fn_a',
    nodeType: 'function',
    functionLifecycle: 'local',
    config: { values: {}, outputBindings: { result: 'total' } },
    localDefinition: {
      workflow: { nodes: [], edges: [] },
      inputs: [],
      outputs: [{ name: 'result', type: 'string' }],
      variables: [],
    },
  },
}

const otherBlock = {
  id: 'other',
  type: 'workflowNode',
  position: { x: 200, y: 0 },
  data: { label: 'Other', elementType: 'log', version: '1.0.0', config: { values: {} } },
}

const total: WorkflowVariable = { id: 'v-total', name: 'total', type: 'string', value: '' }

/** Opens the Block's window the way the canvas does for an open sheet. */
function openSheet() {
  render(
    <ReactFlowProvider>
      <ConfigSheetHost nodeId={FN_ID} cascadeIndex={0} />
    </ReactFlowProvider>,
  )
}

/** Writes the other Block on the canvas, as a selection click or an edit of it does. */
function changeOtherBlock(change: Record<string, unknown>) {
  act(() => {
    const { nodes, setNodes } = useWorkflowStore.getState()
    setNodes(nodes.map((node) => (node.id === 'other' ? { ...node, ...change } : node)) as never, { skipDirty: true })
  })
}

async function typeName(text: string) {
  const user = userEvent.setup({ delay: null })
  const field = screen.getByDisplayValue('fn_a')
  await user.clear(field)
  await user.type(field, text)
}

const sheet = () => screen.getByTestId('element-config-sheet')
const resultBinding = () => within(screen.getByTestId('output-row-result')).getByRole('combobox')

describe('A Function Block sheet left open while the canvas changes', () => {
  beforeEach(() => {
    useWorkflowStore.getState().reset()
    useWorkflowStore.setState({ nodes: [functionBlock, otherBlock] as never, variables: [total], drillPath: [] })
  })

  it('keeps a typed Name when another Block is selected', async () => {
    openSheet()
    await typeName('renamed_fn')

    changeOtherBlock({ selected: true })

    expect(within(sheet()).getByDisplayValue('renamed_fn')).toBeInTheDocument()
  })

  it('keeps a typed Name when another Block changes', async () => {
    openSheet()
    await typeName('renamed_fn')

    changeOtherBlock({ data: { ...otherBlock.data, label: 'Other renamed' } })

    expect(within(sheet()).getByDisplayValue('renamed_fn')).toBeInTheDocument()
  })

  it('keeps a typed Name and clears the untouched binding to a deleted variable', async () => {
    openSheet()
    await typeName('renamed_fn')
    expect(resultBinding()).toHaveValue('total')

    const { result } = renderHook(() => useVariableManagement(null, vi.fn()))
    act(() => result.current.handleVariableDelete('v-total'))
    act(() => result.current.confirmVariableDelete())

    expect(within(sheet()).getByDisplayValue('renamed_fn')).toBeInTheDocument()
    expect(resultBinding()).toHaveValue('')
  })
})
