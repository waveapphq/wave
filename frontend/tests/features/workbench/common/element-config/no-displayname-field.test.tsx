/**
 * Negative DOM tests for ElementConfigModal.
 *
 * There is no ``displayName`` field; an editable canvas-label "Name" row
 * mirrors the Function modal.
 *
 * No ``displayName`` in the save payload, no "Give this
 * element a descriptive name to identify it in your workflow" helper text.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const mockWorkflowStore = {
  variables: [] as Array<{ name: string; type: string }>,
  namespaceVariables: { system: [], suite: [], regression: [] } as Record<string, Array<{ name: string; type: string }>>,
  nodes: [] as Array<{ id: string; data: Record<string, unknown> }>,
  edges: [] as Array<{ id: string; source: string; target: string }>,
  drillPath: [] as Array<{ nodeId: string; label: string }>,
  selectNodesInRect: vi.fn(),
  chainSelect: vi.fn(),
  handleShiftPaneClick: vi.fn(),
  setConfigSheetDirty: vi.fn(),
}

vi.mock('@/features/workbench/stores/workflow-store', () => ({
  useWorkflowStore: (selector?: (state: typeof mockWorkflowStore) => unknown) =>
    selector ? selector(mockWorkflowStore) : mockWorkflowStore,
}))

vi.mock('@/features/profiles/api/crud', () => ({
  fetchProfiles: vi.fn().mockResolvedValue({ data: [], pagination: { total: 0, page: 1, per_page: 100, total_pages: 0 } }),
  fetchProfileTypeSchema: vi.fn().mockResolvedValue({ type: 'http', fields: [] }),
}))

vi.mock('@/features/workbench/common/variables/variable-setter-editor', () => ({
  VariableSetterEditor: () => <div data-testid="variable-setter-editor" />,
}))
vi.mock('@/features/workbench/common/editors/xml-query-editor', () => ({
  XmlQueryEditor: () => <div data-testid="xml-query-editor" />,
}))
vi.mock('@/features/workbench/common/editors/json-query-editor', () => ({
  JsonQueryEditor: () => <div data-testid="json-query-editor" />,
}))
vi.mock('@/features/workbench/common/config/assertion-builder', () => ({
  AssertionBuilder: () => <div data-testid="assertion-builder" />,
}))
vi.mock('@/features/workbench/common/config/condition-branch-editor', () => ({
  ConditionBranchEditor: () => <div data-testid="condition-branch-editor-mock" />,
}))
vi.mock('@/features/workbench/common/element-config/loop-target-selector', () => ({
  LoopTargetSelector: () => <div data-testid="loop-target-selector-mock" />,
}))

vi.mock('@/features/workbench/lib/node-parameters', () => ({
  blockInputParams: () => [],
  blockOutputParams: () => [],
  getGroupMeta: () => undefined,
  getSecretMaskFields: () => [],
}))

const mockElementData = {
  id: 'node-1',
  name: 'HTTP Client',
  elementType: 'http-client',
  version: '2.18',
  availableVersions: ['2.18'],
  parameters: [],
  outputs: [],
  currentValues: {},
  outputBindings: {},
}

describe('ElementConfigModal - no displayName field (negative DOM)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the canvas-label "Name" field bound to the block label', async () => {
    const { ElementConfigModal } = await import(
      '@/features/workbench/common/element-config'
    )
    render(
      <ElementConfigModal
        isOpen
        onClose={vi.fn()}
        element={mockElementData}
        onSave={vi.fn()}
      />,
    )

    // The modal has an editable Name row (capped at
    // MAX_BLOCK_NAME_LENGTH) so the plugin/control modal mirrors the
    // Function modal layout. Confirm the row is wired to the element name.
    const input = screen.getByTestId('element-name-input') as HTMLTextAreaElement
    expect(input).toBeInTheDocument()
    expect(input).toHaveValue('HTTP Client')
  })

  it('does not render the legacy "Give this element a descriptive name" helper text', async () => {
    const { ElementConfigModal } = await import(
      '@/features/workbench/common/element-config'
    )
    render(
      <ElementConfigModal
        isOpen
        onClose={vi.fn()}
        element={mockElementData}
        onSave={vi.fn()}
      />,
    )

    expect(
      screen.queryByText(/Give this element a descriptive name to identify it in your workflow/i),
    ).not.toBeInTheDocument()
  })

  it('save payload does not carry a `displayName` field anymore', async () => {
    const onSave = vi.fn()
    const { ElementConfigModal } = await import(
      '@/features/workbench/common/element-config'
    )
    render(
      <ElementConfigModal
        isOpen
        onClose={vi.fn()}
        element={mockElementData}
        onSave={onSave}
      />,
    )

    const textarea = screen.getByTestId('element-description-input') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'Probe gateway' } })
    fireEvent.click(screen.getByText('Save'))

    expect(onSave).toHaveBeenCalled()
    const payload = onSave.mock.calls[0][0]
    expect(payload).not.toHaveProperty('displayName')
    expect(payload).toHaveProperty('description', 'Probe gateway')
  })
})
