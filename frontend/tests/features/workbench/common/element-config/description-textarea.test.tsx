/**
 * ElementConfigModal description textarea tests.
 *
 * Contract:
 * - The per-instance "Name" field is replaced by the project's shared `DescriptionField`.
 * - Label: "Description".
 * - Placeholder: "Optional. Short description of what this block does in this test."
 * - The textarea accepts multiline input.
 * - The textarea enforces maxLength=64 client-side.
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

const PLACEHOLDER = 'Optional. Short description of what this block does in this test.'

describe('ElementConfigModal description field', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders a Description label (replacing the previous Name label)', async () => {
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

    // Label is "Description" (not "Name")
    expect(screen.getByText('Description')).toBeInTheDocument()
  })

  it('renders a textarea for description (multiline) - not a single-line input', async () => {
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

    const field = screen.getByTestId('element-description-input')
    expect(field.tagName.toLowerCase()).toBe('textarea')
  })

  it('enforces maxLength=64 on the description textarea', async () => {
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

    expect(screen.getByTestId('element-description-input')).toHaveAttribute('maxLength', '64')
  })

  it('uses the placeholder text', async () => {
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

    expect(screen.getByPlaceholderText(PLACEHOLDER)).toBeInTheDocument()
  })

  it('accepts multiline input (newline preserved in value)', async () => {
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

    const textarea = screen.getByTestId('element-description-input') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'line one\nline two' } })
    expect(textarea.value).toBe('line one\nline two')
  })

  it('uses the existing description as the initial value (renamed from displayName)', async () => {
    const { ElementConfigModal } = await import(
      '@/features/workbench/common/element-config'
    )
    render(
      <ElementConfigModal
        isOpen
        onClose={vi.fn()}
        element={{ ...mockElementData, description: 'Probe gateway' }}
        onSave={vi.fn()}
      />,
    )

    const textarea = screen.getByTestId('element-description-input') as HTMLTextAreaElement
    expect(textarea.value).toBe('Probe gateway')
  })

  it('shows the muted character counter once value crosses 80% of maxLength (>=52/64)', async () => {
    const { ElementConfigModal } = await import(
      '@/features/workbench/common/element-config'
    )
    const longDesc = 'a'.repeat(55) // 55/64 = 86%, in the muted band (>=80%, <100%)
    render(
      <ElementConfigModal
        isOpen
        onClose={vi.fn()}
        element={{ ...mockElementData, description: longDesc }}
        onSave={vi.fn()}
      />,
    )

    const counter = screen.getByTestId('element-description-input-counter')
    expect(counter).toHaveTextContent('55/64')
    expect(counter).toHaveAttribute('data-state', 'muted')
  })

  it('counter flips to destructive at maxLength (64/64)', async () => {
    const { ElementConfigModal } = await import(
      '@/features/workbench/common/element-config'
    )
    const maxDesc = 'a'.repeat(64)
    render(
      <ElementConfigModal
        isOpen
        onClose={vi.fn()}
        element={{ ...mockElementData, description: maxDesc }}
        onSave={vi.fn()}
      />,
    )

    const counter = screen.getByTestId('element-description-input-counter')
    expect(counter).toHaveTextContent('64/64')
    expect(counter).toHaveAttribute('data-state', 'destructive')
  })

  it('Enter inside the description textarea is swallowed (does not bubble to ancestor handlers)', async () => {
    const { ElementConfigModal } = await import(
      '@/features/workbench/common/element-config'
    )
    const ancestorSpy = vi.fn()
    render(
      <div onKeyDown={ancestorSpy}>
        <ElementConfigModal
          isOpen
          onClose={vi.fn()}
          element={mockElementData}
          onSave={vi.fn()}
        />
      </div>,
    )

    const textarea = screen.getByTestId('element-description-input') as HTMLTextAreaElement
    fireEvent.keyDown(textarea, { key: 'Enter' })
    fireEvent.keyDown(textarea, { key: ' ' })
    // Both Enter and Space stopPropagation, so the ancestor never sees them.
    expect(ancestorSpy).not.toHaveBeenCalled()
  })

  it('gives the Name and Description fields a name attribute', async () => {
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

    expect(screen.getByTestId('element-name-input')).toHaveAttribute('name', 'block-name')
    expect(screen.getByTestId('element-description-input')).toHaveAttribute(
      'name',
      'block-description',
    )
  })
})
