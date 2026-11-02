/**
 * A Block sheet left open while the variable one of its outputs writes is deleted.
 *
 * The delete clears the Block's binding on the canvas; the open sheet drops it
 * too, so it shows no deleted name, reads as unchanged, and a later Save never
 * writes the deleted name back. The same holds for a Test variable at the root
 * and for a Function local inside a drilled Function body.
 */

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

import { ElementConfigModal } from '@/features/workbench/common/element-config'
import { CanvasReadOnlyProvider } from '@/features/workbench/common/canvas/read-only-context'
import { useConfigModal } from '@/features/workbench/common/canvas/workflow-canvas/use-config-modal'
import { useVariableManagement } from '@/features/workbench/live/use-variable-management'
import { useWorkflowStore, type WorkflowVariable } from '@/features/workbench/stores/workflow-store'
import type { DrillEntry } from '@/features/functions/canvas/inner-workflow'

const CSV_ID = 'csv-1'

function csvBlock(writes: string) {
  return {
    id: CSV_ID,
    type: 'workflowNode',
    position: { x: 0, y: 0 },
    data: {
      label: 'Parse rows',
      elementType: 'csv-parser',
      version: '1.0.0',
      config: {
        values: { operation: 'parse', csv_content: 'a,b' },
        outputBindings: { row_count: writes },
      },
    },
  }
}

function localFunction(local: WorkflowVariable, inner: unknown) {
  return {
    id: 'fn-a',
    type: 'workflowNode',
    position: { x: 0, y: 0 },
    data: {
      label: 'fn-a',
      nodeType: 'function',
      functionLifecycle: 'local',
      localDefinition: {
        workflow: { nodes: [inner], edges: [] },
        inputs: [],
        outputs: [],
        variables: [local],
      },
    },
  }
}

const PATH_FN_A: DrillEntry[] = [{ nodeId: 'fn-a', label: 'fn-a' }]

/** The canvas's sheet host for one plugin Block: its live element, its Save. */
function SheetHost() {
  const { configModalElement, closeConfigModal, handleConfigSave } = useConfigModal(CSV_ID)
  if (!configModalElement || configModalElement.kind === 'function') return null
  return (
    <ElementConfigModal isOpen onClose={closeConfigModal} element={configModalElement} onSave={handleConfigSave} />
  )
}

function openSheet() {
  render(
    <ReactFlowProvider>
      <CanvasReadOnlyProvider value={false}>
        <SheetHost />
      </CanvasReadOnlyProvider>
    </ReactFlowProvider>,
  )
}

function deleteVariable(id: string) {
  const { result } = renderHook(() => useVariableManagement(null, vi.fn()))
  act(() => result.current.handleVariableDelete(id))
  act(() => result.current.confirmVariableDelete())
}

const sheet = () => screen.getByTestId('element-config-sheet')
const rowCountBinding = () => within(screen.getByTestId('output-row-row_count')).getByRole('combobox')
const sheetSave = () => within(sheet()).getByRole('button', { name: 'Save' })

/** The stored `row_count` binding of the CSV Block, wherever it sits in the tree. */
function storedRowCountBinding(): string | undefined {
  const find = (nodes: unknown[]): string | undefined => {
    for (const node of nodes as Array<{ id: string; data: Record<string, unknown> }>) {
      if (node.id === CSV_ID) {
        const config = node.data.config as { outputBindings: Record<string, string> }
        return config.outputBindings.row_count
      }
      const body = node.data.localDefinition as { workflow: { nodes: unknown[] } } | undefined
      const inner = body ? find(body.workflow.nodes) : undefined
      if (inner !== undefined) return inner
    }
    return undefined
  }
  return find(useWorkflowStore.getState().nodes)
}

async function renameAndSave() {
  const user = userEvent.setup({ delay: null })
  const nameField = within(sheet()).getByDisplayValue('Parse rows')
  await user.clear(nameField)
  await user.type(nameField, 'Parse all rows')
  await user.click(sheetSave())
}

describe('A Block sheet left open while its bound variable is deleted', () => {
  beforeEach(() => {
    useWorkflowStore.getState().reset()
  })

  it('at the Test root, drops the deleted Test variable and saves without it', async () => {
    const rows: WorkflowVariable = { id: 'v-rows', name: 'rows', type: 'integer', value: 0 }
    useWorkflowStore.setState({ nodes: [csvBlock('rows')] as never, variables: [rows], drillPath: [] })
    openSheet()
    expect(rowCountBinding()).toHaveValue('rows')

    deleteVariable('v-rows')

    expect(storedRowCountBinding()).toBe('')
    expect(rowCountBinding()).toHaveValue('')
    expect(sheetSave()).toBeDisabled()
    await renameAndSave()
    expect(storedRowCountBinding() ?? '').toBe('')
  })

  it('inside a Function, drops the deleted Function local and saves without it', async () => {
    const local: WorkflowVariable = { id: 'l-bound', name: 'bound_local', type: 'integer', value: 0 }
    useWorkflowStore.setState({
      nodes: [localFunction(local, csvBlock('bound_local'))] as never,
      variables: [],
      drillPath: PATH_FN_A,
    })
    openSheet()
    expect(rowCountBinding()).toHaveValue('bound_local')

    deleteVariable('l-bound')

    expect(storedRowCountBinding()).toBe('')
    expect(rowCountBinding()).toHaveValue('')
    expect(sheetSave()).toBeDisabled()
    await renameAndSave()
    expect(storedRowCountBinding() ?? '').toBe('')
  })
})
