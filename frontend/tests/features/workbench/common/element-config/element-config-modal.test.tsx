/**
 * ElementConfigModal Component Tests - V-CANVAS-12 Config Modal
 *
 * Tests WAVE-specific behavior for block/plugin configuration.
 * Does NOT test: Modal focus trap, escape handling, CSS styling (library concerns).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within, act, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PLUGIN_INPUTS, PLUGIN_OUTPUTS } from '@/features/workbench/lib/node-parameters'
import { fetchTlsCapabilities } from '@/services/tls-capabilities'

// Mock profiles API for ProfileBindingModal
const mockFetchProfiles = vi.fn()
const mockFetchProfileTypeSchema = vi.fn()

vi.mock('@/features/profiles/api/crud', () => ({
  fetchProfiles: (...args: unknown[]) => mockFetchProfiles(...args),
  fetchProfileTypeSchema: (...args: unknown[]) =>
    mockFetchProfileTypeSchema(...args),
}))

// The HTTP TLS group renders the cipher-count affordance, which reads the
// cipher inventory; stub it so expanding the group makes no real request.
vi.mock('@/services/tls-capabilities', () => ({
  fetchTlsCapabilities: vi.fn().mockResolvedValue({
    ciphers: [
      { openssl: 'ECDHE-RSA-AES128-GCM-SHA256', iana: 'TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256', min_version: '1.2', max_version: '1.2' },
    ],
  }),
}))

// A Function Block's version list reads the library; each test sets the versions it needs.
const mockFunctionVersions = {
  versions: [] as Array<Record<string, unknown>>,
  latest: '',
  isLoading: false,
  failed: false,
  retry: () => {},
}
vi.mock('@/features/functions/hooks/use-function-versions', () => ({
  useFunctionVersions: () => mockFunctionVersions,
}))

// Mock VariableSetterEditor to avoid importing its complex dependencies
vi.mock('@/features/workbench/common/variables/variable-setter-editor', () => ({
  VariableSetterEditor: (props: Record<string, unknown>) => {
    const onVariablesChange = props.onVariablesChange as (vars: Record<string, unknown>) => void
    const onExpressionKeysChange = props.onExpressionKeysChange as (keys: string[]) => void
    const onTypesChange = props.onTypesChange as (types: Record<string, string>) => void
    const onValidChange = props.onValidChange as (valid: boolean) => void
    return (
      <div data-testid="variable-setter-editor">
        <button data-testid="mock-varset-change" onClick={() => onVariablesChange({ test: 'val' })}>
          Change
        </button>
        <button data-testid="mock-varset-expr-keys" onClick={() => onExpressionKeysChange(['changed_key'])}>
          ExprKeys
        </button>
        <button data-testid="mock-varset-types" onClick={() => onTypesChange({ changed: 'integer' })}>
          Types
        </button>
        <button data-testid="mock-varset-invalidate" onClick={() => onValidChange(false)}>
          Invalidate
        </button>
        <button data-testid="mock-varset-validate" onClick={() => onValidChange(true)}>
          Validate
        </button>
      </div>
    )
  },
}))

// Mock XmlQueryEditor to avoid importing its complex dependencies
vi.mock('@/features/workbench/common/editors/xml-query-editor', () => ({
  XmlQueryEditor: (props: Record<string, unknown>) => {
    const onQueriesChange = props.onQueriesChange as (q: Record<string, string>) => void
    const onExpressionFieldsChange = props.onExpressionFieldsChange as (f: string[]) => void
    const onQueryOutputTypesChange = props.onQueryOutputTypesChange as (t: Record<string, string>) => void
    const onValidChange = props.onValidChange as (v: boolean) => void
    return (
      <div data-testid="xml-query-editor">
        <span data-testid="xml-query-output-mode">{props.outputMode as string}</span>
        <button data-testid="mock-xml-query-change" onClick={() => onQueriesChange({ status: '//status/text()' })}>
          ChangeQueries
        </button>
        <button data-testid="mock-xml-expr-fields" onClick={() => onExpressionFieldsChange(['queries.status'])}>
          ExprFields
        </button>
        <button data-testid="mock-xml-types-change" onClick={() => onQueryOutputTypesChange({ status: 'string' })}>
          TypesChange
        </button>
        <button data-testid="mock-xml-invalidate" onClick={() => onValidChange(false)}>
          Invalidate
        </button>
        <button data-testid="mock-xml-validate" onClick={() => onValidChange(true)}>
          Validate
        </button>
      </div>
    )
  },
}))

// Mock JsonQueryEditor to avoid importing its complex dependencies
vi.mock('@/features/workbench/common/editors/json-query-editor', () => ({
  JsonQueryEditor: (props: Record<string, unknown>) => {
    const onQueriesChange = props.onQueriesChange as (q: Record<string, string>) => void
    const onExpressionFieldsChange = props.onExpressionFieldsChange as (f: string[]) => void
    const onQueryOutputTypesChange = props.onQueryOutputTypesChange as (t: Record<string, string>) => void
    const onValidChange = props.onValidChange as (v: boolean) => void
    return (
      <div data-testid="json-query-editor">
        <span data-testid="json-query-output-mode">{props.outputMode as string}</span>
        <button data-testid="mock-json-query-change" onClick={() => onQueriesChange({ price: '$.store.price' })}>
          ChangeQueries
        </button>
        <button data-testid="mock-json-expr-fields" onClick={() => onExpressionFieldsChange(['queries.price'])}>
          ExprFields
        </button>
        <button data-testid="mock-json-types-change" onClick={() => onQueryOutputTypesChange({ price: 'string' })}>
          TypesChange
        </button>
        <button data-testid="mock-json-invalidate" onClick={() => onValidChange(false)}>
          Invalidate
        </button>
        <button data-testid="mock-json-validate" onClick={() => onValidChange(true)}>
          Validate
        </button>
      </div>
    )
  },
}))

// Mock AssertionBuilder to avoid importing its complex dependencies (CodeMirror etc.)
const mockOnAssertionsChange = vi.fn()
const mockOnAssertValid = vi.fn()
vi.mock('@/features/workbench/common/config/assertion-builder', () => ({
  AssertionBuilder: (props: {
    assertions: unknown[]
    availableVariables: unknown[]
    onAssertionsChange: (v: unknown[]) => void
    onValidChange: (v: boolean) => void
  }) => {
    // Store callbacks so tests can trigger them
    mockOnAssertionsChange.mockImplementation(props.onAssertionsChange)
    mockOnAssertValid.mockImplementation(props.onValidChange)
    return (
      <div data-testid="assertion-builder-mock">
        <span data-testid="mock-assert-count">{props.assertions.length}</span>
        <button
          data-testid="mock-assert-change"
          onClick={() => props.onAssertionsChange([{ id: 'a1', type: 'literal', variable: 'x', value_type: 'integer', operator: 'equals', reference_value: 1, reference_is_expression: false }])}
        >
          ChangeAssertions
        </button>
        <button data-testid="mock-assert-invalidate" onClick={() => props.onValidChange(false)}>
          InvalidateAssert
        </button>
        <button data-testid="mock-assert-validate" onClick={() => props.onValidChange(true)}>
          ValidateAssert
        </button>
      </div>
    )
  },
}))

// Mock ConditionBranchEditor to avoid importing its complex dependencies
vi.mock('@/features/workbench/common/config/condition-branch-editor', () => ({
  ConditionBranchEditor: (props: {
    branches: Array<{ id: string; type: string; label: string; conditions?: unknown[] }>
    availableVariables: unknown[]
    onBranchesChange: (branches: unknown[]) => void
    onValidChange: (valid: boolean) => void
  }) => {
    return (
      <div data-testid="condition-branch-editor-mock">
        <span data-testid="mock-branch-count">{props.branches.length}</span>
        <button
          data-testid="mock-branch-change"
          onClick={() => props.onBranchesChange([
            { id: 'branch_0', type: 'if', label: '', conditions: [{ id: 'a1', type: 'literal', variable: 'x', value_type: 'integer', operator: 'equals', reference_value: 1, reference_is_expression: false }] },
            { id: 'branch_1', type: 'else', label: '' },
          ])}
        >
          ChangeBranches
        </button>
        <button data-testid="mock-branch-invalidate" onClick={() => props.onValidChange(false)}>
          InvalidateBranch
        </button>
        <button data-testid="mock-branch-validate" onClick={() => props.onValidChange(true)}>
          ValidateBranch
        </button>
      </div>
    )
  },
}))

// Mock LoopTargetSelector to avoid importing workflow store and graph traversal
vi.mock('@/features/workbench/common/element-config/loop-target-selector', () => ({
  LoopTargetSelector: (props: { nodeId: string; value: string; onChange: (v: string) => void }) => (
    <div data-testid="loop-target-selector-mock">
      <span data-testid="mock-loop-target-value">{props.value}</span>
      <button data-testid="mock-loop-target-change" onClick={() => props.onChange('loop-123')}>
        SelectLoop
      </button>
    </div>
  ),
}))

// Mock TableTransformSections to avoid importing the CodeMirror-based
// ExpressionField; the buttons let tests drive the Sorts/Filters callbacks.
vi.mock('@/features/workbench/common/config/table-transform', () => ({
  TableTransformSections: (props: {
    sorts: unknown[]
    filters: unknown[]
    hasHeader: boolean
    onSortsChange: (next: unknown[]) => void
    onFiltersChange: (next: unknown[]) => void
  }) => (
    <div data-testid="table-transform-mock" data-has-header={String(props.hasHeader)}>
      <span data-testid="table-transform-sorts-count">{props.sorts.length}</span>
      <span data-testid="table-transform-filters-count">{props.filters.length}</span>
      <button data-testid="mock-transform-sorts-change" onClick={() => props.onSortsChange(['s'])}>
        SortsChange
      </button>
      <button
        data-testid="mock-transform-filters-change"
        onClick={() => props.onFiltersChange(['f'])}
      >
        FiltersChange
      </button>
    </div>
  ),
}))

// Mock element data representing a plugin configuration
// Note: Uses http-client which has real parameters in control-parameters.ts
const mockElementData = {
  id: 'node-1',
  name: 'HTTP Client',
  elementType: 'http-client',
  version: '2.18',
  availableVersions: ['2.18', '2.17', '2.16'],
  parameters: [
    { name: 'url', type: 'string' as const, required: true, description: 'Request URL' },
    { name: 'method', type: 'string' as const, required: true, enumValues: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'], defaultValue: 'GET' },
    { name: 'headers', type: 'string' as const, required: false, description: 'Request headers (JSON object)' },
    { name: 'body', type: 'string' as const, required: false, description: 'Request body' },
    { name: 'timeout', type: 'integer' as const, required: false, defaultValue: 30000 },
  ],
  outputs: [
    { name: 'status', type: 'integer', description: 'HTTP status code' },
    { name: 'body', type: 'string', description: 'Response body' },
    { name: 'headers', type: 'map', description: 'Response headers' },
  ],
  currentValues: {
    url: 'https://api.example.com/users',
    method: 'GET',
    timeout: 30000,
  },
  outputBindings: {
    status_code: 'response_code',
    body: 'response_body',
    headers: '',
  },
}

// Mock workflow store with available variables
const mockWorkflowStore = {
  variables: [
    { name: 'endpoint', type: 'string' },
    { name: 'api_key', type: 'string' },
    { name: 'base_url', type: 'string' },
  ] as Array<{ id?: string; name: string; type: string; isSecret?: boolean }>,
  namespaceVariables: { system: [] as Array<{ name: string; type: string }>, suite: [] as Array<{ name: string; type: string }>, regression: [] as Array<{ name: string; type: string }> },
  nodes: [] as Array<{ id: string; data: Record<string, unknown> }>,
  edges: [] as Array<{ source: string; target: string; sourceHandle?: string }>,
  selectNodesInRect: vi.fn(),
  chainSelect: vi.fn(),
  handleShiftPaneClick: vi.fn(),
  setConfigSheetDirty: vi.fn(),
  drillPath: [] as Array<{ nodeId: string; label: string }>,
  pausedNodeId: null as string | null,
  setNodeSyntaxIssues: vi.fn(),
  // The canvas save handler's slice, for a sheet whose Save runs through it (SECUI-12).
  updateNode: vi.fn(),
  setEdges: vi.fn(),
  addVariable: vi.fn(),
  updateVariable: vi.fn(),
  closeConfigModal: vi.fn(),
  clearPulseValidationNodeId: vi.fn(),
  transaction: vi.fn((cb: () => void) => cb()),
  requestSecretPromotion: vi.fn(),
}

vi.mock('@/features/workbench/stores/workflow-store', () => ({
  useWorkflowStore: Object.assign(
    (selector?: (state: typeof mockWorkflowStore) => unknown) =>
      selector ? selector(mockWorkflowStore) : mockWorkflowStore,
    { getState: () => mockWorkflowStore },
  ),
}))

// PYRUN-21: Run from the Python editor. The shared "Edit value" sheet is a
// prop-reflecting stand-in so the modal's own wiring is assertable here.
vi.mock('@/features/workbench/common/variables/variable-inspect-modal/value-editor-sheet', async () => {
  const { createPortal } = await import('react-dom')
  return {
    ValueEditorSheet: ({ value, nodeId, onRun, runBusy, runAllowed, onSyntaxIssues, onClose }: any) =>
      createPortal(
        <div
          data-testid="value-editor-sheet"
          data-node-id={nodeId ?? ''}
          data-has-on-run={String(!!onRun)}
          data-run-busy={String(runBusy)}
          data-run-allowed={String(runAllowed)}
        >
          <button data-testid="sheet-run" onClick={() => onRun?.(String(value))}>Run</button>
          <button
            data-testid="sheet-syntax-issues"
            onClick={() => onSyntaxIssues?.([{ line: 4, message: "'(' was never closed" }])}
          >
            Issues
          </button>
          <button data-testid="sheet-close" onClick={onClose}>Close</button>
        </div>,
        document.body,
      ),
  }
})

const mockRepeatBlockDraft = vi.fn().mockResolvedValue(undefined)
const mockCanRunBlockDraft = vi.fn(() => true)
const mockRunState = {
  status: 'idle' as string,
  sessionId: null as string | null,
  isRunning: false,
  repeatBlockDraft: mockRepeatBlockDraft,
  canRunBlockDraft: mockCanRunBlockDraft,
}

vi.mock('@/features/workbench/hooks/use-workbench-run', () => ({
  useWorkbenchRun: () => mockRunState,
}))

vi.mock('@/hooks/use-environments', () => ({
  useEnvironments: () => ({
    environments: [{ id: 'env-1', name: 'Lab' }],
    loading: false,
    loaded: true,
    hasEnvironments: true,
    refresh: vi.fn(),
  }),
}))

// Store original variables for restoration
const originalVariables = mockWorkflowStore.variables

/** A save test changes the config first: nothing changed anywhere keeps Save disabled. */
function changeDescription() {
  fireEvent.change(screen.getByTestId('element-description-input'), { target: { value: 'changed' } })
}

/** A field holding a value asks before it switches mode (FIELD-7); take the default, leaving the box empty. */
async function confirmSwitchToDefault(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByTestId('switch-mode-clear-default'))
}

describe('ElementConfigModal Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Restore variables to original state
    mockWorkflowStore.variables = originalVariables
    mockWorkflowStore.nodes = []
    mockWorkflowStore.edges = []
    // Set up profiles API mocks
    mockFetchProfiles.mockResolvedValue({
      data: [
        {
          id: 'p1',
          name: 'Test API',
          type: 'http',
          description: null,
          tags: [],
          usage: 0,
          config: {},
          environmentValues: {},
          environmentsCount: 0,
          totalEnvironments: 0,
          hasIncompleteEnvironments: false,
          createdAt: '2025-01-01',
          updatedAt: '2025-01-01',
        },
      ],
      pagination: { total: 1, page: 1, per_page: 100, total_pages: 1 },
    })
    mockFetchProfileTypeSchema.mockResolvedValue({
      type: 'http',
      fields: [
        { name: 'base_url', type: 'string', required: true, secret: false },
      ],
    })
  })

  describe('Store Integration', () => {
    it('handles undefined variables from store', async () => {
      // Set variables to undefined to test the ?? [] fallback
      mockWorkflowStore.variables = undefined as unknown as typeof mockWorkflowStore.variables

      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={mockElementData}
          onSave={vi.fn()}
        />
      )

      // Component should render without error with empty variables.
      // Heading is the uniform "Edit Config" title; the
      // element name lives in the Name input field below.
      expect(screen.getByRole('heading', { name: /edit config/i })).toBeInTheDocument()
    })

    it('renders the Secrets section for a plugin block (nodeType plugin)', async () => {
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={{ ...mockElementData, nodeType: 'plugin' }}
          onSave={vi.fn()}
        />
      )
      expect(await screen.findByTestId('secrets-section-trigger')).toBeInTheDocument()
    })

    it('enriches variables with output source info from node bindings', async () => {
      // Set up a node with output bindings to test source map building
      mockWorkflowStore.nodes = [
        {
          id: 'other-node',
          data: {
            label: 'Time API',
            displayName: 'Get Current Time',
            config: {
              outputBindings: { status: 'response_code' },
            },
          },
        },
      ]
      mockWorkflowStore.variables = [
        { name: 'response_code', type: 'string' },
        { name: 'api_key', type: 'string' },
      ]

      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={mockElementData}
          onSave={vi.fn()}
        />
      )

      // Component should render - source enrichment happens in useMemo.
      // Heading is the uniform "Edit Config" title; element name moved to
      // the Name input field.
      expect(screen.getByRole('heading', { name: /edit config/i })).toBeInTheDocument()

      // Restore nodes
      mockWorkflowStore.nodes = []
    })

    it('renders when element.name is undefined (covers `?? ""` fallback in useConfigModalState)', async () => {
      // The hook seeds initial state from element.name; the ``?? ''``
      // default fires when callers pass an element without a name.
      const elementNoName = {
        ...mockElementData,
        name: undefined as unknown as string,
      }

      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={elementNoName}
          onSave={vi.fn()}
        />
      )

      // The component renders without crashing - the config sheet exists
      // even when the name fallback kicked in (DraggableSheet shell).
      expect(screen.getByTestId('element-config-sheet')).toBeInTheDocument()
    })

  })

  describe('Dialog Interactions', () => {
    it('shows confirmation dialog when pressing Escape with unsaved changes', async () => {
      // Suppress Radix Dialog animation warnings (FocusScope, Presence, DismissableLayer)
      // that fire asynchronously when the confirmation AlertDialog opens.
      // These are framework-internal state updates we cannot wrap in act().
      const consoleError = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
        const msg = typeof args[0] === 'string' ? args[0] : ''
        if (msg.includes('not wrapped in act') || msg.includes('act` scope')) return
        console.warn('[unexpected console.error]', ...args)
      })

      const user = userEvent.setup({ delay: null })
      const handleClose = vi.fn()

      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={handleClose}
          element={mockElementData}
          onSave={vi.fn()}
        />
      )

      // Make a change to trigger hasChanges via the description field.
      const descriptionInput = screen.getByTestId('element-description-input')
      await user.type(descriptionInput, 'Changed Description')

      // Press Escape - should show confirmation dialog, not close
      await user.keyboard('{Escape}')

      // Confirmation dialog should appear, onClose NOT called yet
      // Use waitFor to let Radix Dialog animations settle (FocusScope, Presence)
      await waitFor(() => {
        expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
      })
      expect(handleClose).not.toHaveBeenCalled()

      consoleError.mockRestore()
    })

    it('bypasses the unsaved-changes prompt in read-only mode', async () => {
      // In a history canvas (read-only), every input is frozen so there
      // cannot be unsaved mutations - the Escape key / close button
      // should call onClose directly. The modal's read-only short
      // circuit short-circuits the handleOpenChange bookkeeping.
      const consoleError = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
        const msg = typeof args[0] === 'string' ? args[0] : ''
        if (msg.includes('not wrapped in act') || msg.includes('act` scope')) return
        console.warn('[unexpected console.error]', ...args)
      })

      const { CanvasReadOnlyProvider } = await import(
        '@/features/workbench/common/canvas/read-only-context'
      )
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      const user = userEvent.setup({ delay: null })
      const handleClose = vi.fn()

      render(
        <CanvasReadOnlyProvider value={true}>
          <ElementConfigModal
            isOpen={true}
            onClose={handleClose}
            element={mockElementData}
            onSave={vi.fn()}
          />
        </CanvasReadOnlyProvider>,
      )

      // Escape triggers the Dialog's onOpenChange(false). Read-only
      // handleDialogOpenChange calls onClose directly without the
      // unsaved-changes prompt.
      await user.keyboard('{Escape}')
      await waitFor(() => {
        expect(handleClose).toHaveBeenCalled()
      })

      consoleError.mockRestore()
    })
  })

  describe('Element Description Input', () => {
    it('allows editing the element description', async () => {
      const user = userEvent.setup({ delay: null })

      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={mockElementData}
          onSave={vi.fn()}
        />
      )

      const descriptionInput = screen.getByTestId('element-description-input')
      await user.type(descriptionInput, 'My Custom Description')

      expect(descriptionInput).toHaveValue('My Custom Description')
    })
  })

  describe('Element Header', () => {
    it('displays the "<Name> - Edit Config" title (CANVAS-228)', async () => {
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={mockElementData}
          onSave={vi.fn()}
        />
      )

      // Per CANVAS-228 the sheet header carries "<Name> - Edit Config" so
      // several open sheets are tellable apart; the Name input below still
      // holds the editable value.
      expect(
        screen.getByRole('heading', { name: 'HTTP Client - Edit Config' }),
      ).toBeInTheDocument()
      expect(screen.getByTestId('element-name-input')).toHaveValue('HTTP Client')
    })

    it('displays current version in version selector', async () => {
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={mockElementData}
          onSave={vi.fn()}
        />
      )

      expect(screen.getByTestId('version-selector')).toHaveTextContent('2.18')
    })

    it('allows version selection from available versions', async () => {
      const user = userEvent.setup({ delay: null })

      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={mockElementData}
          onSave={vi.fn()}
        />
      )

      await user.click(screen.getByTestId('version-selector'))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: '2.17' })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: '2.16' })).toBeInTheDocument()
      })
    })
  })

  describe('Input Parameters', () => {
    it('displays all parameters from element configuration', async () => {
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={mockElementData}
          onSave={vi.fn()}
        />
      )

      // Ungrouped params are always visible
      expect(screen.getByTestId('param-row-url')).toBeInTheDocument()
      expect(screen.getByTestId('param-row-method')).toBeInTheDocument()
      expect(screen.getByTestId('param-row-headers')).toBeInTheDocument()
      // Body lives in the collapsed "Body" group; expanding it shows only the text-mode rows.
      expect(screen.queryByTestId('param-row-body')).not.toBeInTheDocument()
      fireEvent.click(screen.getByTestId('group-header-Body'))
      expect(screen.getByTestId('param-row-body')).toBeInTheDocument()
      expect(screen.queryByTestId('param-row-form_fields')).not.toBeInTheDocument()
      expect(screen.queryByTestId('param-row-file_source')).not.toBeInTheDocument()
      // timeout is in "Timeouts & Retries" group (collapsed by default)
      expect(screen.getByText('Timeouts & Retries')).toBeInTheDocument()
      expect(screen.queryByTestId('param-row-timeout')).not.toBeInTheDocument()
    })

    it('never renders a card-header summary, default or not', async () => {
      // Guard: collapsed-card live summaries removed entirely
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={{
            ...mockElementData,
            currentValues: { ...mockElementData.currentValues, retry_count: 2 },
          }}
          onSave={vi.fn()}
        />
      )

      expect(screen.queryByTestId('group-summary-Body')).not.toBeInTheDocument()
      expect(screen.queryByTestId('group-summary-Auth')).not.toBeInTheDocument()
      expect(screen.queryByTestId('group-summary-Timeouts & Retries')).not.toBeInTheDocument()
    })

    it('renders the renamed Enable Auth row when the Auth card expands', async () => {
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={mockElementData}
          onSave={vi.fn()}
        />
      )

      // Default-state Auth summary ("Off") is diff-hidden
      expect(screen.queryByTestId('group-summary-Auth')).not.toBeInTheDocument()
      fireEvent.click(screen.getByTestId('group-header-Auth'))
      const authRow = screen.getByTestId('param-row-auth_enabled')
      expect(within(authRow).getByText('Enable Auth')).toBeInTheDocument()
    })

    it('renders no TLS card footer note (group descriptions pruned)', async () => {
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={mockElementData}
          onSave={vi.fn()}
        />
      )

      expect(screen.queryByTestId('group-footer-TLS / Certificates')).not.toBeInTheDocument()
      fireEvent.click(screen.getByTestId('group-header-TLS / Certificates'))
      // Expanding TLS mounts the Cipher Suites row, which reads the inventory;
      // let that fetch settle so its state update stays wrapped in act().
      await waitFor(() => expect(fetchTlsCapabilities).toHaveBeenCalled())
      await act(async () => {})
      // The description was intentionally removed, so no footer renders.
      expect(screen.queryByTestId('group-footer-TLS / Certificates')).not.toBeInTheDocument()
    })

    it('loads current values into parameter inputs', async () => {
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={mockElementData}
          onSave={vi.fn()}
        />
      )

      // String field in literal mode renders the one value field, named by its row
      expect(screen.getByRole('textbox', { name: 'URL' })).toHaveValue('https://api.example.com/users')
      // timeout is in a collapsed group - verify the group header is present
      expect(screen.getByText('Timeouts & Retries')).toBeInTheDocument()
    })

    it('marks required parameters with asterisk', async () => {
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={mockElementData}
          onSave={vi.fn()}
        />
      )

      const urlRow = screen.getByTestId('param-row-url')
      expect(within(urlRow).getByText('*')).toBeInTheDocument()

      // headers is ungrouped and optional - no asterisk
      const headersRow = screen.getByTestId('param-row-headers')
      expect(within(headersRow).queryByText('*')).not.toBeInTheDocument()
    })

    it('renders boolean parameters as checkboxes', async () => {
      // Use custom mock with boolean parameter (elementType not in CONTROL_PARAMETERS)
      const mockWithBoolean = {
        ...mockElementData,
        elementType: 'custom-plugin',
        parameters: [
          { name: 'enabled', type: 'boolean' as const, required: false, defaultValue: true },
        ],
        outputs: [],
        currentValues: { enabled: true },
        outputBindings: {},
      }

      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={mockWithBoolean}
          onSave={vi.fn()}
        />
      )

      const enabledRow = screen.getByTestId('param-row-enabled')
      const checkbox = within(enabledRow).getByRole('checkbox')
      expect(checkbox).toBeChecked()
    })

    it('renders enum parameters as select dropdown', async () => {
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={mockElementData}
          onSave={vi.fn()}
        />
      )

      const methodRow = screen.getByTestId('param-row-method')
      expect(within(methodRow).getByRole('combobox')).toBeInTheDocument()
    })
  })

  describe('Variable Reference Autocomplete', () => {
    it('shows available workflow variables in raw expression mode', async () => {
      const user = userEvent.setup({ delay: null })

      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={mockElementData}
          onSave={vi.fn()}
        />
      )

      // Toggle URL field to expression mode first
      const urlRow = screen.getByTestId('param-row-url')
      await user.click(within(urlRow).getByTestId('expression-toggle'))
      await confirmSwitchToDefault(user)

      await waitFor(() => {
        expect(within(urlRow).getByRole('textbox')).toBeInTheDocument()
      })
      const urlInput = within(urlRow).getByRole('textbox')

      // In raw expression mode, type variable prefix directly (no ${ needed)
      await user.click(urlInput)
      await user.type(urlInput, 'e')

      // CodeMirror renders autocomplete at document.body level
      await waitFor(() => {
        const autocomplete = document.querySelector('.cm-tooltip-autocomplete')
        expect(autocomplete).toBeInTheDocument()
        expect(autocomplete?.textContent).toContain('endpoint')
      })
    })

  })

  describe('Expression Mode for Enums', () => {
    it('allows switching enum field to expression mode', async () => {
      const user = userEvent.setup({ delay: null })

      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={mockElementData}
          onSave={vi.fn()}
        />
      )

      const methodRow = screen.getByTestId('param-row-method')
      const toggle = within(methodRow).getByTestId('expression-toggle')

      await user.click(toggle)
      await confirmSwitchToDefault(user)

      await waitFor(() => {
        // Should now be a text input instead of select
        expect(within(methodRow).getByRole('textbox')).toBeInTheDocument()
        expect(within(methodRow).queryByRole('combobox')).not.toBeInTheDocument()
      })
    })

    it(
      'accepts variable reference in expression mode',
      async () => {
        const user = userEvent.setup({ delay: null })

        const { ElementConfigModal } = await import(
          '@/features/workbench/common/element-config'
        )
        render(
          <ElementConfigModal
            isOpen={true}
            onClose={vi.fn()}
            element={mockElementData}
            onSave={vi.fn()}
          />
        )

        const methodRow = screen.getByTestId('param-row-method')
        await user.click(within(methodRow).getByTestId('expression-toggle'))
        await confirmSwitchToDefault(user)

        await waitFor(() => {
          // ExpressionField (CodeMirror) renders with param-input- testid as a div
          expect(within(methodRow).getByTestId('param-input-method').tagName).toBe('DIV')
        })
      },
      15000
    )
  })

  describe('Output Variable Bindings', () => {
    it('displays output parameters with current bindings', async () => {
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={mockElementData}
          onSave={vi.fn()}
        />
      )

      const statusRow = screen.getByTestId('output-row-status_code')
      expect(within(statusRow).getByDisplayValue('response_code')).toBeInTheDocument()

      const bodyRow = screen.getByTestId('output-row-body')
      expect(within(bodyRow).getByDisplayValue('response_body')).toBeInTheDocument()
    })

    it('handles empty/null output binding values', async () => {
      const elementWithEmptyBindings = {
        ...mockElementData,
        outputBindings: {}, // No bindings - tests the ?? '' fallback
      }

      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={elementWithEmptyBindings}
          onSave={vi.fn()}
        />
      )

      // Output fields should be empty but rendered
      const statusRow = screen.getByTestId('output-row-status_code')
      expect(within(statusRow).getByRole('combobox')).toHaveValue('')
    })

  })

  describe('Validation', () => {
    it('disables Save button when required field is empty', async () => {
      // Test that missing required values disable save
      // Instead of clearing via userEvent (slow with CodeMirror), render with empty config
      const emptyElement = {
        ...mockElementData,
        currentValues: { method: 'GET' }, // URL is missing (required)
      }

      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={emptyElement}
          onSave={vi.fn()}
        />
      )

      const saveButton = screen.getByRole('button', { name: /save/i })
      // Save should be disabled when required field (url) is empty
      expect(saveButton).toBeDisabled()
    })

    it('blocks save and shows inline error when output binding has type mismatch', async () => {
      const user = userEvent.setup({ delay: null })
      const handleSave = vi.fn()

      // Variable 'response_code' is boolean but status_code output is integer
      mockWorkflowStore.variables = [
        { name: 'response_code', type: 'boolean' },
        { name: 'response_body', type: 'string' },
      ]

      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={mockElementData}
          onSave={handleSave}
        />
      )

      await user.click(screen.getByRole('button', { name: /save/i }))

      // Save should be blocked -- onSave not called
      expect(handleSave).not.toHaveBeenCalled()
      // Inline field error shown on the status_code output row
      const fieldError = screen.getByTestId('field-error-status_code')
      expect(fieldError).toBeInTheDocument()
      expect(fieldError).toHaveTextContent(/type mismatch/i)
      expect(fieldError).toHaveTextContent('response_code')
      expect(fieldError).toHaveTextContent('boolean')
    })

    it('allows save when output binding references non-existent variable', async () => {
      const user = userEvent.setup({ delay: null })
      const handleSave = vi.fn()

      // 'response_code' is not in the variables list
      mockWorkflowStore.variables = [
        { name: 'response_body', type: 'string' },
      ]

      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={mockElementData}
          onSave={handleSave}
        />
      )

      // Nothing changed anywhere keeps Save disabled.
      changeDescription()
      await user.click(screen.getByRole('button', { name: /save/i }))

      // Save should proceed - missing variables are handled by reconcile-on-load
      expect(handleSave).toHaveBeenCalled()
    })
  })

  describe('Save and Cancel', () => {
    it('calls onClose when Cancel clicked without saving', async () => {
      const user = userEvent.setup({ delay: null })
      const handleClose = vi.fn()
      const handleSave = vi.fn()

      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={handleClose}
          element={mockElementData}
          onSave={handleSave}
        />
      )

      await user.click(screen.getByRole('button', { name: /cancel/i }))

      expect(handleClose).toHaveBeenCalled()
      expect(handleSave).not.toHaveBeenCalled()
    })
  })

  describe('Footer Actions', () => {
    it('displays Changelog and Details buttons', async () => {
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={mockElementData}
          onSave={vi.fn()}
        />
      )

      expect(screen.getByRole('button', { name: /changelog/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /details/i })).toBeInTheDocument()
    })
  })


  describe('Duration Parameter Type', () => {
    it('renders NumberInput for duration integer parameter', async () => {
      const mockWithDuration = {
        ...mockElementData,
        elementType: 'delay',
        parameters: [
          { name: 'duration', type: 'integer' as const, required: true, description: 'Time to wait' },
        ],
        outputs: [],
        currentValues: { duration: 5000 },
        outputBindings: {},
      }

      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={mockWithDuration}
          onSave={vi.fn()}
        />
      )

      // Duration renders as plain integer NumberInput (no amount/unit decomposition)
      const input = screen.getByTestId('param-input-duration') as HTMLInputElement
      expect(input).toBeInTheDocument()
      expect(input.value).toBe('5000')
    })

    it('allows typing into duration integer input and saves raw value', async () => {
      const user = userEvent.setup({ delay: null })
      const handleSave = vi.fn()

      const mockWithDuration = {
        ...mockElementData,
        elementType: 'delay',
        parameters: [
          { name: 'duration', type: 'integer' as const, required: true, description: 'Wait time' },
        ],
        outputs: [],
        currentValues: {},
        outputBindings: {},
      }

      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={mockWithDuration}
          onSave={handleSave}
        />
      )

      // Type into plain integer input
      const input = screen.getByTestId('param-input-duration')
      await user.clear(input)
      await user.type(input, '5000')

      // Click save
      const saveButton = screen.getByRole('button', { name: /save/i })
      await user.click(saveButton)

      // Verify save was called with raw integer value (no ms conversion)
      expect(handleSave).toHaveBeenCalledWith(
        expect.objectContaining({
          values: expect.objectContaining({
            duration: 5000,
          }),
        })
      )
    })
  })

  describe('Expression Parameter Type', () => {
    it('renders string input for expression-type parameters', async () => {
      const mockWithExpression = {
        ...mockElementData,
        elementType: 'custom-expr',
        parameters: [
          { name: 'formula', type: 'string' as const, required: false, description: 'Expression' },
        ],
        outputs: [],
        currentValues: { formula: 'a + b' },
        outputBindings: {},
        expressionFields: ['formula'],
      }

      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={mockWithExpression}
          onSave={vi.fn()}
        />
      )

      // Expression mode: raw expression editor shows the expression value
      const input = screen.getByTestId('param-input-formula')
      expect(input).toBeInTheDocument()
      expect(input).toHaveTextContent('a + b')
    })

    it('handles undefined value for expression parameters', async () => {
      // Test expression parameter with undefined value to cover ?? '' fallback
      const mockWithUndefinedExpression = {
        ...mockElementData,
        elementType: 'custom-expr-undef',
        parameters: [
          { name: 'condition', type: 'string' as const, required: false, description: 'Condition' },
        ],
        outputs: [],
        currentValues: {}, // No value for condition - will be undefined
        outputBindings: {},
      }

      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={mockWithUndefinedExpression}
          onSave={vi.fn()}
        />
      )

      // Undefined literal value renders the one value field empty
      const editor = screen.getByRole('textbox', { name: 'condition' })
      expect(editor).toHaveValue('')
      expect(screen.queryByText('Edit…')).not.toBeInTheDocument()
    })
  })

  describe('Changelog Dialog', () => {
    it('opens changelog dialog when Changelog button is clicked', async () => {
      const user = userEvent.setup({ delay: null })

      // Use element with version history (version must match versions array)
      const mockWithVersions = {
        id: 'node-1',
        name: 'Delay Control',
        elementType: 'delay',
        version: '1.0.0',
        availableVersions: ['1.0.0', '0.0.1'],
        parameters: [],
        outputs: [],
        currentValues: {},
        outputBindings: {},
        versions: [
          {
            version: '1.0.0',
            releaseDate: '2025-01-10',
            changelog: ['Full implementation released'],
            details: 'Detailed docs here',
          },
          {
            version: '0.0.1',
            releaseDate: '2025-01-01',
            changelog: ['Placeholder version'],
            details: 'Not implemented',
          },
        ],
      }

      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={mockWithVersions}
          onSave={vi.fn()}
        />
      )

      // Click Changelog button
      const changelogBtn = screen.getByRole('button', { name: /changelog/i })
      await user.click(changelogBtn)

      // Changelog dialog should be visible (title is "{elementName} - Changelog")
      await waitFor(() => {
        expect(screen.getByText('Delay Control - Changelog')).toBeInTheDocument()
        expect(screen.getByText('Full implementation released')).toBeInTheDocument()
      })
    })

    it('shows deprecation warning with message for deprecated versions', async () => {
      const user = userEvent.setup({ delay: null })

      // Use element with a deprecated version
      const mockWithDeprecated = {
        id: 'node-1',
        name: 'Legacy Control',
        elementType: 'legacy',
        version: '1.0.0',
        availableVersions: ['1.0.0'],
        parameters: [],
        outputs: [],
        currentValues: {},
        outputBindings: {},
        versions: [
          {
            version: '1.0.0',
            releaseDate: '2025-01-10',
            changelog: ['Initial release'],
            details: 'Legacy control',
            deprecated: true,
            deprecationMessage: 'Use NewControl instead',
          },
        ],
      }

      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={mockWithDeprecated}
          onSave={vi.fn()}
        />
      )

      // Click Changelog button
      const changelogBtn = screen.getByRole('button', { name: /changelog/i })
      await user.click(changelogBtn)

      // Changelog dialog should show deprecation warning
      await waitFor(() => {
        expect(screen.getByText('Deprecated')).toBeInTheDocument()
        expect(screen.getByText('Use NewControl instead')).toBeInTheDocument()
      })
    })

    it('falls back to first version when initialVersion does not match', async () => {
      const user = userEvent.setup({ delay: null })

      // Use element where current version doesn't match any version in versions array
      // This tests the versions.find() ?? versions[0] fallback in ChangelogDialog
      const mockWithMismatchedVersion = {
        id: 'node-1',
        name: 'Test Control',
        elementType: 'test',
        version: '99.99.99', // This version is NOT in the versions array
        availableVersions: ['1.0.0', '0.0.1'],
        parameters: [],
        outputs: [],
        currentValues: {},
        outputBindings: {},
        versions: [
          {
            version: '1.0.0',
            releaseDate: '2025-01-10',
            changelog: ['Latest version changelog'],
            details: 'Latest docs',
          },
          {
            version: '0.0.1',
            releaseDate: '2025-01-01',
            changelog: ['Initial placeholder'],
            details: 'Placeholder docs',
          },
        ],
      }

      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={mockWithMismatchedVersion}
          onSave={vi.fn()}
        />
      )

      // Click Changelog button
      const changelogBtn = screen.getByRole('button', { name: /changelog/i })
      await user.click(changelogBtn)

      // Changelog dialog should fall back to first version (1.0.0)
      // and show its changelog
      await waitFor(() => {
        expect(screen.getByText('Test Control - Changelog')).toBeInTheDocument()
        // Should show 1.0.0 changelog (the fallback)
        expect(screen.getByText('Latest version changelog')).toBeInTheDocument()
      })
    })

    it('allows changing version in changelog dialog', async () => {
      const user = userEvent.setup({ delay: null })

      // Use element with multiple versions
      const mockWithMultipleVersions = {
        id: 'node-1',
        name: 'Multi Version Control',
        elementType: 'multi',
        version: '1.0.0',
        availableVersions: ['1.0.0', '0.0.1'],
        parameters: [],
        outputs: [],
        currentValues: {},
        outputBindings: {},
        versions: [
          {
            version: '1.0.0',
            releaseDate: '2025-01-10',
            changelog: ['Version 1.0.0 changes'],
            details: 'Latest docs',
          },
          {
            version: '0.0.1',
            releaseDate: '2025-01-01',
            changelog: ['Version 0.0.1 changes'],
            details: 'Initial docs',
          },
        ],
      }

      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={mockWithMultipleVersions}
          onSave={vi.fn()}
        />
      )

      // Click Changelog button to open dialog
      const changelogBtn = screen.getByRole('button', { name: /changelog/i })
      await user.click(changelogBtn)

      // Wait for dialog to open and show initial version
      await waitFor(() => {
        expect(screen.getByText('Multi Version Control - Changelog')).toBeInTheDocument()
        expect(screen.getByText('Version 1.0.0 changes')).toBeInTheDocument()
      })

      // Change version in the dropdown (inside changelog dialog)
      // The changelog dialog has its own Radix Select version selector
      const versionSelect = screen.getByRole('combobox')
      await user.click(versionSelect)
      await user.click(screen.getByRole('option', { name: '0.0.1' }))

      // Changelog should update to show 0.0.1 changes
      await waitFor(() => {
        expect(screen.getByText('Version 0.0.1 changes')).toBeInTheDocument()
      })

      // Close the changelog dialog by pressing Escape (tests onOpenChange handler)
      await user.keyboard('{Escape}')
      await waitFor(() => {
        expect(screen.queryByText('Multi Version Control - Changelog')).not.toBeInTheDocument()
      })
    }, 10_000)
  })

  describe('Details Dialog', () => {
    it('opens details dialog and renders markdown content', async () => {
      const user = userEvent.setup({ delay: null })

      // Use element with version history and details
      // Include: bold (**text**), code (`code`), bullet points (- item), plain text before formatting
      const mockWithDetails = {
        id: 'node-1',
        name: 'Delay',
        elementType: 'delay',
        version: '1.0.0', // Must match versions array
        availableVersions: ['1.0.0'],
        parameters: [],
        outputs: [],
        currentValues: {},
        outputBindings: {},
        description: 'Pause workflow execution',
        versions: [
          {
            version: '1.0.0',
            releaseDate: '2025-01-10',
            changelog: ['Full implementation'],
            // Include bullet points and text before code to cover all branches:
            // - Line 148-150: text before `code` match
            // - Line 206-211: bullet point handling
            details: '**Status:** Available\n\nThe param `duration` is the time to wait.\n\nFeatures:\n- Async execution\n- Configurable units',
          },
        ],
      }

      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={mockWithDetails}
          onSave={vi.fn()}
        />
      )

      // Click Details button
      const detailsBtn = screen.getByRole('button', { name: /details/i })
      await user.click(detailsBtn)

      // Details dialog should be visible with content (title is "ElementName - Documentation")
      await waitFor(() => {
        expect(screen.getByText('Delay - Documentation')).toBeInTheDocument()
        // Markdown bold renders as <strong>
        expect(screen.getByText('Status:')).toBeInTheDocument()
        // Bullet point content should be visible
        expect(screen.getByText('Async execution')).toBeInTheDocument()
      })

      // Close the details dialog by pressing Escape (tests onOpenChange handler)
      await user.keyboard('{Escape}')
      await waitFor(() => {
        expect(screen.queryByText('Delay - Documentation')).not.toBeInTheDocument()
      })
    })

    it('shows fallback message when no details available', async () => {
      const user = userEvent.setup({ delay: null })

      // Use element without details (empty string triggers fallback)
      const mockNoDetails = {
        id: 'node-1',
        name: 'Custom Block',
        elementType: 'custom-block',
        version: '1.0.0',
        availableVersions: ['1.0.0'],
        parameters: [],
        outputs: [],
        currentValues: {},
        outputBindings: {},
        versions: [
          {
            version: '1.0.0',
            releaseDate: '2025-01-01',
            changelog: ['Initial'],
            details: '', // Empty string triggers fallback
          },
        ],
      }

      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={mockNoDetails}
          onSave={vi.fn()}
        />
      )

      // Click Details button
      const detailsBtn = screen.getByRole('button', { name: /details/i })
      await user.click(detailsBtn)

      // Should show fallback message
      await waitFor(() => {
        expect(screen.getByText(/No detailed documentation available/)).toBeInTheDocument()
      })
    })
  })

  describe('Profile Binding', () => {
    it('displays Profiles button in footer', async () => {
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={mockElementData}
          onSave={vi.fn()}
        />
      )

      expect(
        screen.getByRole('button', { name: /profiles/i })
      ).toBeInTheDocument()
    })

    it('opens ProfileBindingModal when Profiles button is clicked', async () => {
      const user = userEvent.setup({ delay: null })

      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={mockElementData}
          onSave={vi.fn()}
        />
      )

      await user.click(screen.getByRole('button', { name: /profiles/i }))

      // ProfileBindingModal should be visible
      await waitFor(() => {
        expect(
          screen.getByRole('heading', { name: 'Profiles' })
        ).toBeInTheDocument()
        expect(screen.getByText('Bound Profiles')).toBeInTheDocument()
        expect(screen.getByText('Add Profile')).toBeInTheDocument()
      })
    })

    it('includes profileBindings in save data', async () => {
      const user = userEvent.setup({ delay: null })
      const handleSave = vi.fn()

      const elementWithProfiles = {
        ...mockElementData,
        profileBindings: [
          {
            profileId: 'p1',
            profileName: 'Test API',
            profileType: 'http',
            alias: 'api',
            fields: [{ name: 'base_url', type: 'string' }],
          },
        ],
      }

      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={elementWithProfiles}
          onSave={handleSave}
        />
      )

      // Nothing changed anywhere keeps Save disabled.
      changeDescription()
      await user.click(screen.getByRole('button', { name: /save/i }))

      expect(handleSave).toHaveBeenCalledWith(
        expect.objectContaining({
          profileBindings: [
            {
              profileId: 'p1',
              profileName: 'Test API',
              profileType: 'http',
              alias: 'api',
              fields: [{ name: 'base_url', type: 'string' }],
            },
          ],
        })
      )
    })

    it(
      'updates profileBindings when ProfileBindingModal Done is clicked',
      async () => {
        const user = userEvent.setup({ delay: null })
        const handleSave = vi.fn()

        const { ElementConfigModal } = await import(
          '@/features/workbench/common/element-config'
        )
        render(
          <ElementConfigModal
            isOpen={true}
            onClose={vi.fn()}
            element={mockElementData}
            onSave={handleSave}
          />
        )

        // Open profile modal
        await user.click(screen.getByRole('button', { name: /profiles/i }))

        await waitFor(() => {
          expect(screen.getByText('Bound Profiles')).toBeInTheDocument()
        })

        // Wait for profiles to load and add one
        await waitFor(() => {
          expect(
            screen.getByTestId('available-profile-p1')
          ).toBeInTheDocument()
        })
        await user.click(screen.getByLabelText('Add Test API'))

        // Click Done in profile modal
        await user.click(screen.getByRole('button', { name: /done/i }))

        // Profile modal should close
        await waitFor(() => {
          expect(
            screen.queryByText('Bound Profiles')
          ).not.toBeInTheDocument()
        })

        // Save and verify profile bindings are included
        await user.click(screen.getByRole('button', { name: /save/i }))

        expect(handleSave).toHaveBeenCalledWith(
          expect.objectContaining({
            profileBindings: [
              expect.objectContaining({
                profileId: 'p1',
                profileName: 'Test API',
                profileType: 'http',
                alias: 'test_api',
              }),
            ],
          })
        )
      },
      20000
    )

    it('saves empty profileBindings when no profiles are bound', async () => {
      const user = userEvent.setup({ delay: null })
      const handleSave = vi.fn()

      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={mockElementData}
          onSave={handleSave}
        />
      )

      // Nothing changed anywhere keeps Save disabled.
      changeDescription()
      await user.click(screen.getByRole('button', { name: /save/i }))

      expect(handleSave).toHaveBeenCalledWith(
        expect.objectContaining({
          profileBindings: [],
        })
      )
    })

    it('handles profileBindings with missing fields gracefully', async () => {
      const user = userEvent.setup({ delay: null })
      const handleSave = vi.fn()

      // Profile binding without fields (fields undefined)
      const elementWithLegacyBinding = {
        ...mockElementData,
        profileBindings: [
          {
            profileId: 'p1',
            profileName: 'Test API',
            profileType: 'http',
            alias: 'api',
            // fields intentionally omitted (undefined) - legacy data
          },
        ],
      }

      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={elementWithLegacyBinding}
          onSave={handleSave}
        />
      )

      // Should render without error
      // Nothing changed anywhere keeps Save disabled.
      changeDescription()
      await user.click(screen.getByRole('button', { name: /save/i }))

      expect(handleSave).toHaveBeenCalledWith(
        expect.objectContaining({
          profileBindings: [
            expect.objectContaining({
              profileId: 'p1',
              alias: 'api',
            }),
          ],
        })
      )
    })

    it('enriches autocomplete with profile field variables', async () => {
      const user = userEvent.setup({ delay: null })

      // Set up element with bound profiles that have fields
      const elementWithProfiles = {
        ...mockElementData,
        profileBindings: [
          {
            profileId: 'p1',
            profileName: 'Test API',
            profileType: 'http',
            alias: 'api',
            fields: [
              { name: 'base_url', type: 'string' },
              { name: 'api_key', type: 'string' },
            ],
          },
        ],
      }

      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={elementWithProfiles}
          onSave={vi.fn()}
        />
      )

      // Toggle URL to expression mode for raw expression autocomplete
      const urlRow = screen.getByTestId('param-row-url')
      await user.click(within(urlRow).getByTestId('expression-toggle'))
      await confirmSwitchToDefault(user)

      await waitFor(() => {
        expect(within(urlRow).getByRole('textbox')).toBeInTheDocument()
      })
      const urlInput = within(urlRow).getByRole('textbox')

      // In raw expression mode, type prefix directly (no ${ needed)
      await user.click(urlInput)
      await user.type(urlInput, 'a')

      // CodeMirror autocomplete should show alias under Profiles section,
      // but NOT show dotted field names (those appear via dot-completion)
      await waitFor(() => {
        const autocomplete = document.querySelector(
          '.cm-tooltip-autocomplete'
        )
        expect(autocomplete).toBeInTheDocument()
        // Profiles section header must appear
        expect(autocomplete?.textContent).toContain('Profiles')
        // Top-level alias must appear
        expect(autocomplete?.textContent).toContain('api')
        // Dotted field names must NOT appear in initial list
        expect(autocomplete?.textContent).not.toContain('api.base_url')
        expect(autocomplete?.textContent).not.toContain('api.api_key')
      })
    })

    it('skips profile bindings without alias in enriched variables', async () => {
      const user = userEvent.setup({ delay: null })

      // One binding with alias, one without
      const elementMixed = {
        ...mockElementData,
        profileBindings: [
          {
            profileId: 'p-no-alias',
            profileName: 'No Alias',
            profileType: 'http',
            alias: '',
            fields: [{ name: 'host', type: 'string' }],
          },
          {
            profileId: 'p-has-alias',
            profileName: 'Has Alias',
            profileType: 'http',
            alias: 'srv',
            fields: [{ name: 'url', type: 'string' }],
          },
        ],
      }

      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={elementMixed}
          onSave={vi.fn()}
        />
      )

      // Toggle URL to expression mode for raw expression autocomplete
      const urlRow = screen.getByTestId('param-row-url')
      await user.click(within(urlRow).getByTestId('expression-toggle'))
      await confirmSwitchToDefault(user)

      await waitFor(() => {
        expect(within(urlRow).getByRole('textbox')).toBeInTheDocument()
      })
      const urlInput = within(urlRow).getByRole('textbox')
      await user.click(urlInput)
      await user.type(urlInput, 's')

      await waitFor(() => {
        const autocomplete = document.querySelector('.cm-tooltip-autocomplete')
        expect(autocomplete).toBeInTheDocument()
        // Only alias 'srv' should appear, dotted names hidden from initial list
        expect(autocomplete?.textContent).toContain('srv')
        expect(autocomplete?.textContent).not.toContain('srv.url')
        expect(autocomplete?.textContent).not.toContain('.host')
      })
    })

    it('shows profile field completions when typing alias with dot', async () => {
      const user = userEvent.setup({ delay: null })

      const elementWithProfiles = {
        ...mockElementData,
        profileBindings: [
          {
            profileId: 'p1',
            profileName: 'Time Server',
            profileType: 'http',
            alias: 'time_server',
            fields: [
              { name: 'host', type: 'string' },
              { name: 'port', type: 'integer' },
            ],
          },
        ],
      }

      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={elementWithProfiles}
          onSave={vi.fn()}
        />
      )

      // Toggle URL to expression mode, then type alias with dot
      const urlRow = screen.getByTestId('param-row-url')
      await user.click(within(urlRow).getByTestId('expression-toggle'))
      await confirmSwitchToDefault(user)

      await waitFor(() => {
        expect(within(urlRow).getByRole('textbox')).toBeInTheDocument()
      })
      const urlInput = within(urlRow).getByRole('textbox')
      await user.click(urlInput)
      await user.type(urlInput, 'time_server.')

      // Should show dotted profile field completions, not methods
      await waitFor(() => {
        const autocomplete = document.querySelector(
          '.cm-tooltip-autocomplete'
        )
        expect(autocomplete).toBeInTheDocument()
        expect(autocomplete?.textContent).toContain('time_server.host')
        expect(autocomplete?.textContent).toContain('time_server.port')
      })
    })
  })

  describe('Dialog Resize', () => {
    it('resizes dialog width on drag', async () => {
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={mockElementData}
          onSave={vi.fn()}
        />
      )

      const handle = screen.getByTestId('dialog-resize-handle')
      // The shell is a DraggableSheet (no Radix dialog role); the
      // shared resize drives the sheet's inline width.
      const sheetRoot = screen.getByTestId('element-config-sheet')

      expect(sheetRoot.style.width).toBe('672px')

      await act(async () => {
        fireEvent.mouseDown(handle, { clientX: 800 })
      })
      await act(async () => {
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 850 }))
      })
      expect(sheetRoot.style.width).toBe('772px')

      await act(async () => {
        document.dispatchEvent(new MouseEvent('mouseup'))
      })

      // After mouseup, further moves should not resize
      await act(async () => {
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 900 }))
      })
      expect(sheetRoot.style.width).toBe('772px')
    })

    it('clamps width to minimum 520px', async () => {
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={mockElementData}
          onSave={vi.fn()}
        />
      )

      const handle = screen.getByTestId('dialog-resize-handle')
      const sheetRoot = screen.getByTestId('element-config-sheet')

      await act(async () => {
        fireEvent.mouseDown(handle, { clientX: 800 })
      })
      await act(async () => {
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 400 }))
      })
      expect(sheetRoot.style.width).toBe('520px')

      await act(async () => {
        document.dispatchEvent(new MouseEvent('mouseup'))
      })
    })

    it('clamps width to maximum 1200px', async () => {
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={mockElementData}
          onSave={vi.fn()}
        />
      )

      const handle = screen.getByTestId('dialog-resize-handle')
      const sheetRoot = screen.getByTestId('element-config-sheet')

      await act(async () => {
        fireEvent.mouseDown(handle, { clientX: 800 })
      })
      await act(async () => {
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 1500 }))
      })
      expect(sheetRoot.style.width).toBe('1200px')

      await act(async () => {
        document.dispatchEvent(new MouseEvent('mouseup'))
      })
    })
  })

  describe('Log Plugin Configuration (REQ-3.4.1.17)', () => {
    const mockLogElement = {
      id: 'node-log',
      name: 'Log',
      elementType: 'log',
      version: '1.0.0',
      availableVersions: ['1.0.0'],
      parameters: PLUGIN_INPUTS['log'],
      outputs: [],
      currentValues: { message: 'Hello World', level: 'INFO' },
      outputBindings: {},
    }

    it('displays message parameter as required', async () => {
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={mockLogElement}
          onSave={vi.fn()}
        />
      )

      const messageRow = screen.getByTestId('param-row-message')
      expect(within(messageRow).getByText('*')).toBeInTheDocument()
    })

    it('displays level parameter as enum dropdown', async () => {
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={mockLogElement}
          onSave={vi.fn()}
        />
      )

      const levelRow = screen.getByTestId('param-row-level')
      expect(within(levelRow).getByRole('combobox')).toBeInTheDocument()
    })

    it('shows no output parameters section when outputs are empty', async () => {
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={mockLogElement}
          onSave={vi.fn()}
        />
      )

      expect(screen.queryByText('Output Variables')).not.toBeInTheDocument()
    })
  })

  describe('Variable Setter Integration', () => {
    const mockVariableSetterElement = {
      id: 'node-varset-1',
      name: 'Var Setter',
      elementType: 'variable-setter',
      version: '1.0.0',
      availableVersions: ['1.0.0'],
      parameters: [
        { name: 'variables', type: 'map' as const, required: true },
      ],
      outputs: [],
      currentValues: { variables: {} },
      outputBindings: {},
    }

    it('renders VariableSetterEditor instead of ParameterTable for variable-setter elementType', async () => {
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={mockVariableSetterElement}
          onSave={vi.fn()}
        />
      )

      // VariableSetterEditor should be rendered (mocked)
      expect(screen.getByTestId('variable-setter-editor')).toBeInTheDocument()
      // Generic ParameterTable input rows should NOT be present
      expect(screen.queryByTestId('param-row-variables')).not.toBeInTheDocument()
    })

    it('includes variableExpressionKeys and variableTypes in save data', async () => {
      const user = userEvent.setup({ delay: null })
      const handleSave = vi.fn()

      const elementWithVarSetData = {
        ...mockVariableSetterElement,
        variableExpressionKeys: ['computed_val'],
        variableTypes: { my_var: 'string', computed_val: 'integer' },
      }

      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={elementWithVarSetData}
          onSave={handleSave}
        />
      )

      // Nothing changed anywhere keeps Save disabled.
      changeDescription()
      await user.click(screen.getByRole('button', { name: /save/i }))

      expect(handleSave).toHaveBeenCalledWith(
        expect.objectContaining({
          variableExpressionKeys: ['computed_val'],
          variableTypes: { my_var: 'string', computed_val: 'integer' },
        })
      )
    })

    it('does not include variableExpressionKeys or variableTypes for non-variable-setter elements', async () => {
      const user = userEvent.setup({ delay: null })
      const handleSave = vi.fn()

      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={mockElementData}
          onSave={handleSave}
        />
      )

      // Nothing changed anywhere keeps Save disabled.
      changeDescription()
      await user.click(screen.getByRole('button', { name: /save/i }))

      expect(handleSave).toHaveBeenCalledTimes(1)
      const saveData = handleSave.mock.calls[0][0]
      expect(saveData).not.toHaveProperty('variableExpressionKeys')
      expect(saveData).not.toHaveProperty('variableTypes')
    })

    it('updates variables state when VariableSetterEditor fires onVariablesChange', async () => {
      const user = userEvent.setup({ delay: null })
      const handleSave = vi.fn()

      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={mockVariableSetterElement}
          onSave={handleSave}
        />
      )

      // Click the mock change button to trigger onVariablesChange
      await user.click(screen.getByTestId('mock-varset-change'))

      // Save and verify the variables value was updated
      await user.click(screen.getByRole('button', { name: /save/i }))

      expect(handleSave).toHaveBeenCalledWith(
        expect.objectContaining({
          values: expect.objectContaining({
            variables: { test: 'val' },
          }),
        })
      )
    })

    it('detects hasChanges when variableExpressionKeys differ from element state', async () => {
      const user = userEvent.setup({ delay: null })

      const elementWithExprKeys = {
        ...mockVariableSetterElement,
        variableExpressionKeys: [],
        variableTypes: {},
      }

      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={elementWithExprKeys}
          onSave={vi.fn()}
        />
      )

      // Click the mock button to change expression keys
      await user.click(screen.getByTestId('mock-varset-expr-keys'))

      // The save button should now be enabled (hasChanges = true due to line 533)
      await waitFor(() => {
        const saveButton = screen.getByRole('button', { name: /save/i })
        expect(saveButton).not.toBeDisabled()
      })
    })

    it('detects hasChanges when variableTypes differ from element state', async () => {
      const user = userEvent.setup({ delay: null })

      const elementWithTypes = {
        ...mockVariableSetterElement,
        variableExpressionKeys: [],
        variableTypes: {},
      }

      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={elementWithTypes}
          onSave={vi.fn()}
        />
      )

      // Click the mock button to change types
      await user.click(screen.getByTestId('mock-varset-types'))

      // The save button should now be enabled (hasChanges = true due to line 534)
      await waitFor(() => {
        const saveButton = screen.getByRole('button', { name: /save/i })
        expect(saveButton).not.toBeDisabled()
      })
    })

    it('disables save button when variable setter has validation errors', async () => {
      const user = userEvent.setup({ delay: null })

      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={mockVariableSetterElement}
          onSave={vi.fn()}
        />
      )

      // Trigger onValidChange(false) via the mock button
      await user.click(screen.getByTestId('mock-varset-invalidate'))

      // Save button should be disabled when varSetterValid is false
      const saveButton = screen.getByRole('button', { name: /save/i })
      expect(saveButton).toBeDisabled()
    })

    it('re-enables save button when variable setter validation passes again', async () => {
      const user = userEvent.setup({ delay: null })

      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={mockVariableSetterElement}
          onSave={vi.fn()}
        />
      )

      // Invalidate then re-validate
      // Nothing changed anywhere keeps Save disabled.
      changeDescription()
      await user.click(screen.getByTestId('mock-varset-invalidate'))
      expect(screen.getByRole('button', { name: /save/i })).toBeDisabled()

      await user.click(screen.getByTestId('mock-varset-validate'))
      expect(screen.getByRole('button', { name: /save/i })).not.toBeDisabled()
    })

    it('passes empty object when values.variables is undefined', async () => {
      const elementWithNoVariables = {
        ...mockVariableSetterElement,
        currentValues: {}, // No 'variables' key at all
      }

      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={elementWithNoVariables}
          onSave={vi.fn()}
        />
      )

      // Should still render VariableSetterEditor (the ?? {} fallback on line 682)
      expect(screen.getByTestId('variable-setter-editor')).toBeInTheDocument()
    })
  })

  describe('XML Parser Integration', () => {
    const mockXmlParserElement = {
      id: 'node-xml-1',
      name: 'XML Parser',
      elementType: 'xml-parser',
      version: '1.0.0',
      availableVersions: ['1.0.0'],
      parameters: PLUGIN_INPUTS['xml-parser'],
      outputs: PLUGIN_OUTPUTS['xml-parser'],
      currentValues: {
        xml_content: '<root><item>test</item></root>',
        output_mode: 'combined',
        queries: { status: '//item/text()' },
      },
      outputBindings: {},
    }

    it('renders XmlQueryEditor for xml-parser elementType', async () => {
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={mockXmlParserElement}
          onSave={vi.fn()}
        />
      )

      // XmlQueryEditor should be rendered (mocked)
      expect(screen.getByTestId('xml-query-editor')).toBeInTheDocument()
      // queries and query_output_types should NOT appear as regular parameter rows
      expect(screen.queryByTestId('param-row-queries')).not.toBeInTheDocument()
      expect(screen.queryByTestId('param-row-query_output_types')).not.toBeInTheDocument()
    })

    it('keeps xml_content in the Input Parameters table but moves output_mode out (VMGR-92)', async () => {
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={mockXmlParserElement}
          onSave={vi.fn()}
        />
      )

      // xml_content stays in the Input Parameters table...
      expect(screen.getByTestId('param-row-xml_content')).toBeInTheDocument()
      // ...but output_mode is not a parameter row (VMGR-92: it is the
      // Output Mode radio section).
      expect(screen.queryByTestId('param-row-output_mode')).not.toBeInTheDocument()
      // Namespaces is auto-extracted from XML, not a user-facing parameter
      expect(screen.queryByTestId('param-row-namespaces')).not.toBeInTheDocument()
    })

    it('renders the Output Mode radio section with Combined/Individual (VMGR-92)', async () => {
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={mockXmlParserElement}
          onSave={vi.fn()}
        />
      )

      expect(screen.getByText('Output Mode')).toBeInTheDocument()
      expect(screen.getByRole('radio', { name: /combined/i })).toBeInTheDocument()
      expect(screen.getByRole('radio', { name: /individual/i })).toBeInTheDocument()
    })

    it('switching the Output Mode radio to Individual drives results + query mode (VMGR-92)', async () => {
      const user = userEvent.setup({ delay: null })
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={mockXmlParserElement}
          onSave={vi.fn()}
        />
      )

      // Combined by default: results binding shown, query editor in combined mode.
      expect(screen.getByTestId('output-row-results')).toBeInTheDocument()
      expect(screen.getByTestId('xml-query-output-mode')).toHaveTextContent('combined')

      await user.click(screen.getByRole('radio', { name: /individual/i }))

      // Individual: results binding hidden, query editor switches to individual mode.
      expect(screen.queryByTestId('output-row-results')).not.toBeInTheDocument()
      expect(screen.getByTestId('xml-query-output-mode')).toHaveTextContent('individual')
    })

    it('passes output_mode to XmlQueryEditor', async () => {
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={mockXmlParserElement}
          onSave={vi.fn()}
        />
      )

      expect(screen.getByTestId('xml-query-output-mode')).toHaveTextContent('combined')
    })

    it('disables save when XmlQueryEditor reports invalid', async () => {
      const user = userEvent.setup({ delay: null })
      const handleSave = vi.fn()

      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={mockXmlParserElement}
          onSave={handleSave}
        />
      )

      // Invalidate via mock button
      await user.click(screen.getByTestId('mock-xml-invalidate'))

      const saveBtn = screen.getByRole('button', { name: /save/i })
      expect(saveBtn).toBeDisabled()
    })

    it('re-enables save when XmlQueryEditor reports valid again', async () => {
      const user = userEvent.setup({ delay: null })
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={mockXmlParserElement}
          onSave={vi.fn()}
        />
      )

      // Invalidate then validate
      // Nothing changed anywhere keeps Save disabled.
      changeDescription()
      await user.click(screen.getByTestId('mock-xml-invalidate'))
      expect(screen.getByRole('button', { name: /save/i })).toBeDisabled()

      await user.click(screen.getByTestId('mock-xml-validate'))
      expect(screen.getByRole('button', { name: /save/i })).toBeEnabled()
    })

    it('renders output variables section with success, errors, results in combined mode', async () => {
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={mockXmlParserElement}
          onSave={vi.fn()}
        />
      )

      expect(screen.getByTestId('output-row-success')).toBeInTheDocument()
      expect(screen.getByTestId('output-row-errors')).toBeInTheDocument()
      expect(screen.getByTestId('output-row-results')).toBeInTheDocument()
    })

    it('hides results and shows query outputs in individual mode', async () => {
      const individualElement = {
        ...mockXmlParserElement,
        currentValues: {
          ...mockXmlParserElement.currentValues,
          output_mode: 'individual',
          queries: { price: '//price/text()', qty: '//qty/text()' },
          query_output_types: { price: 'float', qty: 'integer' },
        },
      }
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={individualElement}
          onSave={vi.fn()}
        />
      )

      // Fixed outputs: success and errors still visible
      expect(screen.getByTestId('output-row-success')).toBeInTheDocument()
      expect(screen.getByTestId('output-row-errors')).toBeInTheDocument()
      // results should NOT be visible in individual mode
      expect(screen.queryByTestId('output-row-results')).not.toBeInTheDocument()
      // Query editor should be rendered under output variables section (individual mode)
      expect(screen.getByTestId('xml-query-editor')).toBeInTheDocument()
    })

    it('individual mode auto-creates output bindings for query aliases on save', async () => {
      const onSave = vi.fn()
      const individualElement = {
        ...mockXmlParserElement,
        currentValues: {
          ...mockXmlParserElement.currentValues,
          xml_content: '<root/>',
          output_mode: 'individual',
          queries: { price: '//price/text()', qty: '//qty/text()' },
          query_output_types: { price: 'float', qty: 'integer' },
        },
      }
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={individualElement}
          onSave={onSave}
        />
      )

      // Mark query editor valid so save is enabled
      await act(async () => {
        fireEvent.click(screen.getByTestId('mock-xml-validate'))
      })

      // Click save
      await act(async () => {
        // Nothing changed anywhere keeps Save disabled.
        changeDescription()
        fireEvent.click(screen.getByRole('button', { name: 'Save' }))
      })

      expect(onSave).toHaveBeenCalledTimes(1)
      const saveData = onSave.mock.calls[0][0]
      // Query aliases should be self-bound as output bindings
      expect(saveData.outputBindings.price).toBe('price')
      expect(saveData.outputBindings.qty).toBe('qty')
      // Query aliases should have their types in outputTypes
      expect(saveData.outputTypes.price).toBe('float')
      expect(saveData.outputTypes.qty).toBe('integer')
      // Fixed outputs should still be present
      expect(saveData.outputTypes.success).toBe('boolean')
      expect(saveData.outputTypes.errors).toBe('array')
    })

    it('individual mode save cleans up stale query alias bindings', async () => {
      const onSave = vi.fn()
      const individualElement = {
        ...mockXmlParserElement,
        currentValues: {
          ...mockXmlParserElement.currentValues,
          xml_content: '<root/>',
          output_mode: 'individual',
          queries: { price: '//price/text()' },
          query_output_types: { price: 'float' },
        },
        // Simulate stale binding from a previously deleted query alias
        outputBindings: { old_deleted_query: 'old_deleted_query', success: 'my_success' },
      }
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={individualElement}
          onSave={onSave}
        />
      )

      await act(async () => {
        fireEvent.click(screen.getByTestId('mock-xml-validate'))
      })
      await act(async () => {
        // Nothing changed anywhere keeps Save disabled.
        changeDescription()
        fireEvent.click(screen.getByRole('button', { name: 'Save' }))
      })

      expect(onSave).toHaveBeenCalledTimes(1)
      const saveData = onSave.mock.calls[0][0]
      // Stale binding should be cleaned up
      expect(saveData.outputBindings.old_deleted_query).toBeUndefined()
      // Fixed output binding preserved
      expect(saveData.outputBindings.success).toBe('my_success')
      // Current query alias is self-bound
      expect(saveData.outputBindings.price).toBe('price')
    })

    it('individual mode expression query forces string type in outputTypes', async () => {
      const onSave = vi.fn()
      const individualElement = {
        ...mockXmlParserElement,
        currentValues: {
          ...mockXmlParserElement.currentValues,
          xml_content: '<root/>',
          output_mode: 'individual',
          queries: { price: '//price/text()' },
          query_output_types: { price: 'float' },
        },
        expressionFields: ['queries.price'],
      }
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={individualElement}
          onSave={onSave}
        />
      )

      await act(async () => {
        fireEvent.click(screen.getByTestId('mock-xml-validate'))
      })
      await act(async () => {
        // Nothing changed anywhere keeps Save disabled.
        changeDescription()
        fireEvent.click(screen.getByRole('button', { name: 'Save' }))
      })

      expect(onSave).toHaveBeenCalledTimes(1)
      const saveData = onSave.mock.calls[0][0]
      // Expression query should force string type regardless of query_output_types
      expect(saveData.outputTypes.price).toBe('string')
    })

    it('renders combined mode when output_mode is not set', async () => {
      const noModeElement = {
        ...mockXmlParserElement,
        currentValues: {
          queries: { status: '//item/text()' },
          // No output_mode, no xml_content, no query_output_types - all use ?? defaults
        },
      }
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={noModeElement}
          onSave={vi.fn()}
        />
      )

      // Should render as combined mode (default) with XmlQueryEditor
      expect(screen.getByTestId('xml-query-editor')).toBeInTheDocument()
      expect(screen.getByTestId('xml-query-output-mode')).toHaveTextContent('combined')
      // results output should be visible in combined mode
      expect(screen.getByTestId('output-row-results')).toBeInTheDocument()
    })

    it('individual mode query without explicit type defaults to string', async () => {
      const onSave = vi.fn()
      const individualElement = {
        ...mockXmlParserElement,
        currentValues: {
          ...mockXmlParserElement.currentValues,
          xml_content: '<root/>',
          output_mode: 'individual',
          queries: { status: '//status/text()' },
          // No query_output_types at all
        },
      }
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={individualElement}
          onSave={onSave}
        />
      )

      await act(async () => {
        fireEvent.click(screen.getByTestId('mock-xml-validate'))
      })
      await act(async () => {
        // Nothing changed anywhere keeps Save disabled.
        changeDescription()
        fireEvent.click(screen.getByRole('button', { name: 'Save' }))
      })

      expect(onSave).toHaveBeenCalledTimes(1)
      const saveData = onSave.mock.calls[0][0]
      // No explicit type means defaults to 'string'
      expect(saveData.outputTypes.status).toBe('string')
    })

    it('combined mode XmlQueryEditor callbacks update values state', async () => {
      const user = userEvent.setup({ delay: null })
      const onSave = vi.fn()
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={mockXmlParserElement}
          onSave={onSave}
        />
      )

      // Click mock buttons to invoke the callbacks (combined mode)
      await user.click(screen.getByTestId('mock-xml-query-change'))
      await user.click(screen.getByTestId('mock-xml-types-change'))
      await user.click(screen.getByTestId('mock-xml-validate'))
      await user.click(screen.getByRole('button', { name: 'Save' }))

      expect(onSave).toHaveBeenCalledTimes(1)
      const savedValues = onSave.mock.calls[0][0].values
      expect(savedValues.queries).toEqual({ status: '//status/text()' })
      expect(savedValues.query_output_types).toEqual({ status: 'string' })
    })

    it('individual mode XmlQueryEditor callbacks update values state', async () => {
      const user = userEvent.setup({ delay: null })
      const onSave = vi.fn()
      const individualElement = {
        ...mockXmlParserElement,
        currentValues: {
          ...mockXmlParserElement.currentValues,
          output_mode: 'individual',
          queries: { price: '//price/text()' },
          query_output_types: { price: 'float' },
        },
      }
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={individualElement}
          onSave={onSave}
        />
      )

      // Click mock buttons to invoke the callbacks (individual mode)
      await user.click(screen.getByTestId('mock-xml-query-change'))
      await user.click(screen.getByTestId('mock-xml-types-change'))
      await user.click(screen.getByTestId('mock-xml-validate'))
      await user.click(screen.getByRole('button', { name: 'Save' }))

      expect(onSave).toHaveBeenCalledTimes(1)
      const savedValues = onSave.mock.calls[0][0].values
      expect(savedValues.queries).toEqual({ status: '//status/text()' })
      expect(savedValues.query_output_types).toEqual({ status: 'string' })
    })

    it('renders combined mode with undefined queries and xml_content', async () => {
      // Trigger ?? fallbacks on lines 790 (queries ?? {}) and 794 (xml_content ?? '')
      const minimalElement = {
        ...mockXmlParserElement,
        currentValues: {
          output_mode: 'combined',
          // queries, xml_content, query_output_types are all missing
        },
      }
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={minimalElement}
          onSave={vi.fn()}
        />
      )

      expect(screen.getByTestId('xml-query-editor')).toBeInTheDocument()
    })

    it('renders individual mode with undefined queries and xml_content', async () => {
      // Trigger ?? fallbacks on lines 769 (queries ?? {}) and 773 (xml_content ?? '')
      const minimalIndividual = {
        ...mockXmlParserElement,
        currentValues: {
          output_mode: 'individual',
          // queries, xml_content, query_output_types are all missing
        },
      }
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={minimalIndividual}
          onSave={vi.fn()}
        />
      )

      expect(screen.getByTestId('xml-query-editor')).toBeInTheDocument()
    })

    it('stores the Output Mode the section shows, combined, and binds no query alias as in combined mode', async () => {
      const onSave = vi.fn()
      const noModeElement = {
        ...mockXmlParserElement,
        currentValues: {
          xml_content: '<root/>',
          queries: { status: '//item/text()' },
        },
      }
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={noModeElement}
          onSave={onSave}
        />
      )

      await act(async () => {
        fireEvent.click(screen.getByTestId('mock-xml-validate'))
      })
      await act(async () => {
        // Nothing changed anywhere keeps Save disabled.
        changeDescription()
        fireEvent.click(screen.getByRole('button', { name: 'Save' }))
      })

      expect(onSave).toHaveBeenCalledTimes(1)
      const saveData = onSave.mock.calls[0][0]
      // A shown choice stores the value it displays (FIELD-8).
      expect(saveData.values.output_mode).toBe('combined')
      expect(saveData.outputBindings.status).toBeUndefined()
    })

    it('shows the expression toggle on xml_content parameter (expression allowed)', async () => {
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={mockXmlParserElement}
          onSave={vi.fn()}
        />
      )

      // xml_content row should exist
      const xmlContentRow = screen.getByTestId('param-row-xml_content')
      expect(xmlContentRow).toBeInTheDocument()
      // noExpression removed -> the {} expression toggle is present.
      const toggleWithinRow = xmlContentRow.querySelector('[data-testid="expression-toggle"]')
      expect(toggleWithinRow).toBeInTheDocument()
    })
  })

  describe('JSON Parser Integration', () => {
    const mockJsonParserElement = {
      id: 'node-json-1',
      name: 'JSON Parser',
      elementType: 'json-parser',
      version: '1.0.0',
      availableVersions: ['1.0.0'],
      parameters: PLUGIN_INPUTS['json-parser'],
      outputs: PLUGIN_OUTPUTS['json-parser'],
      currentValues: {
        json_content: '{"store":{"price":9.99}}',
        output_mode: 'combined',
        queries: { price: '$.store.price' },
      },
      outputBindings: {},
    }

    it('renders JsonQueryEditor for json-parser elementType', async () => {
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={mockJsonParserElement}
          onSave={vi.fn()}
        />
      )

      // JsonQueryEditor should be rendered (mocked)
      expect(screen.getByTestId('json-query-editor')).toBeInTheDocument()
      // queries and query_output_types should NOT appear as regular parameter rows
      expect(screen.queryByTestId('param-row-queries')).not.toBeInTheDocument()
      expect(screen.queryByTestId('param-row-query_output_types')).not.toBeInTheDocument()
    })

    it('keeps json_content in the Input Parameters table but moves output_mode out (VMGR-92)', async () => {
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={mockJsonParserElement}
          onSave={vi.fn()}
        />
      )

      // json_content stays in the Input Parameters table...
      expect(screen.getByTestId('param-row-json_content')).toBeInTheDocument()
      // ...but output_mode is not a parameter row (VMGR-92: it is the
      // Output Mode radio section).
      expect(screen.queryByTestId('param-row-output_mode')).not.toBeInTheDocument()
    })

    it('renders the Output Mode radio section with Combined/Individual (VMGR-92)', async () => {
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={mockJsonParserElement}
          onSave={vi.fn()}
        />
      )

      expect(screen.getByText('Output Mode')).toBeInTheDocument()
      expect(screen.getByRole('radio', { name: /combined/i })).toBeInTheDocument()
      expect(screen.getByRole('radio', { name: /individual/i })).toBeInTheDocument()
    })

    it('passes output_mode to JsonQueryEditor', async () => {
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={mockJsonParserElement}
          onSave={vi.fn()}
        />
      )

      expect(screen.getByTestId('json-query-output-mode')).toHaveTextContent('combined')
    })

    it('disables save when JsonQueryEditor reports invalid', async () => {
      const user = userEvent.setup({ delay: null })
      const handleSave = vi.fn()

      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={mockJsonParserElement}
          onSave={handleSave}
        />
      )

      // Invalidate via mock button
      await user.click(screen.getByTestId('mock-json-invalidate'))

      const saveBtn = screen.getByRole('button', { name: /save/i })
      expect(saveBtn).toBeDisabled()
    })

    it('re-enables save when JsonQueryEditor reports valid again', async () => {
      const user = userEvent.setup({ delay: null })
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={mockJsonParserElement}
          onSave={vi.fn()}
        />
      )

      // Invalidate then validate
      // Nothing changed anywhere keeps Save disabled.
      changeDescription()
      await user.click(screen.getByTestId('mock-json-invalidate'))
      expect(screen.getByRole('button', { name: /save/i })).toBeDisabled()

      await user.click(screen.getByTestId('mock-json-validate'))
      expect(screen.getByRole('button', { name: /save/i })).toBeEnabled()
    })

    it('renders output variables section with success, errors, results in combined mode', async () => {
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={mockJsonParserElement}
          onSave={vi.fn()}
        />
      )

      expect(screen.getByTestId('output-row-success')).toBeInTheDocument()
      expect(screen.getByTestId('output-row-errors')).toBeInTheDocument()
      expect(screen.getByTestId('output-row-results')).toBeInTheDocument()
    })

    it('hides results and shows query outputs in individual mode', async () => {
      const individualElement = {
        ...mockJsonParserElement,
        currentValues: {
          ...mockJsonParserElement.currentValues,
          output_mode: 'individual',
          queries: { price: '$.store.price', qty: '$.store.qty' },
          query_output_types: { price: 'float', qty: 'integer' },
        },
      }
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={individualElement}
          onSave={vi.fn()}
        />
      )

      // Fixed outputs: success and errors still visible
      expect(screen.getByTestId('output-row-success')).toBeInTheDocument()
      expect(screen.getByTestId('output-row-errors')).toBeInTheDocument()
      // results should NOT be visible in individual mode
      expect(screen.queryByTestId('output-row-results')).not.toBeInTheDocument()
      // Query editor should be rendered under output variables section (individual mode)
      expect(screen.getByTestId('json-query-editor')).toBeInTheDocument()
    })

    it('individual mode auto-creates output bindings for query aliases on save', async () => {
      const onSave = vi.fn()
      const individualElement = {
        ...mockJsonParserElement,
        currentValues: {
          ...mockJsonParserElement.currentValues,
          json_content: '{}',
          output_mode: 'individual',
          queries: { price: '$.store.price', qty: '$.store.qty' },
          query_output_types: { price: 'float', qty: 'integer' },
        },
      }
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={individualElement}
          onSave={onSave}
        />
      )

      // Mark query editor valid so save is enabled
      await act(async () => {
        fireEvent.click(screen.getByTestId('mock-json-validate'))
      })

      // Click save
      await act(async () => {
        // Nothing changed anywhere keeps Save disabled.
        changeDescription()
        fireEvent.click(screen.getByRole('button', { name: 'Save' }))
      })

      expect(onSave).toHaveBeenCalledTimes(1)
      const saveData = onSave.mock.calls[0][0]
      // Query aliases should be self-bound as output bindings
      expect(saveData.outputBindings.price).toBe('price')
      expect(saveData.outputBindings.qty).toBe('qty')
      // Query aliases should have their types in outputTypes
      expect(saveData.outputTypes.price).toBe('float')
      expect(saveData.outputTypes.qty).toBe('integer')
      // Fixed outputs should still be present
      expect(saveData.outputTypes.success).toBe('boolean')
      expect(saveData.outputTypes.errors).toBe('array')
    })

    it('individual mode save cleans up stale query alias bindings', async () => {
      const onSave = vi.fn()
      const individualElement = {
        ...mockJsonParserElement,
        currentValues: {
          ...mockJsonParserElement.currentValues,
          json_content: '{}',
          output_mode: 'individual',
          queries: { price: '$.store.price' },
          query_output_types: { price: 'float' },
        },
        // Simulate stale binding from a previously deleted query alias
        outputBindings: { old_deleted_query: 'old_deleted_query', success: 'my_success' },
      }
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={individualElement}
          onSave={onSave}
        />
      )

      await act(async () => {
        fireEvent.click(screen.getByTestId('mock-json-validate'))
      })
      await act(async () => {
        // Nothing changed anywhere keeps Save disabled.
        changeDescription()
        fireEvent.click(screen.getByRole('button', { name: 'Save' }))
      })

      expect(onSave).toHaveBeenCalledTimes(1)
      const saveData = onSave.mock.calls[0][0]
      // Stale binding should be cleaned up
      expect(saveData.outputBindings.old_deleted_query).toBeUndefined()
      // Fixed output binding preserved
      expect(saveData.outputBindings.success).toBe('my_success')
      // Current query alias is self-bound
      expect(saveData.outputBindings.price).toBe('price')
    })

    it('individual mode expression query forces string type in outputTypes', async () => {
      const onSave = vi.fn()
      const individualElement = {
        ...mockJsonParserElement,
        currentValues: {
          ...mockJsonParserElement.currentValues,
          json_content: '{}',
          output_mode: 'individual',
          queries: { price: '$.store.price' },
          query_output_types: { price: 'float' },
        },
        expressionFields: ['queries.price'],
      }
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={individualElement}
          onSave={onSave}
        />
      )

      await act(async () => {
        fireEvent.click(screen.getByTestId('mock-json-validate'))
      })
      await act(async () => {
        // Nothing changed anywhere keeps Save disabled.
        changeDescription()
        fireEvent.click(screen.getByRole('button', { name: 'Save' }))
      })

      expect(onSave).toHaveBeenCalledTimes(1)
      const saveData = onSave.mock.calls[0][0]
      // Expression query should force string type regardless of query_output_types
      expect(saveData.outputTypes.price).toBe('string')
    })

    it('renders combined mode when output_mode is not set', async () => {
      const noModeElement = {
        ...mockJsonParserElement,
        currentValues: {
          queries: { price: '$.store.price' },
          // No output_mode, no json_content, no query_output_types - all use ?? defaults
        },
      }
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={noModeElement}
          onSave={vi.fn()}
        />
      )

      // Should render as combined mode (default) with JsonQueryEditor
      expect(screen.getByTestId('json-query-editor')).toBeInTheDocument()
      expect(screen.getByTestId('json-query-output-mode')).toHaveTextContent('combined')
      // results output should be visible in combined mode
      expect(screen.getByTestId('output-row-results')).toBeInTheDocument()
    })

    it('individual mode query without explicit type defaults to string', async () => {
      const onSave = vi.fn()
      const individualElement = {
        ...mockJsonParserElement,
        currentValues: {
          ...mockJsonParserElement.currentValues,
          json_content: '{}',
          output_mode: 'individual',
          queries: { status: '$.status' },
          // No query_output_types at all
        },
      }
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={individualElement}
          onSave={onSave}
        />
      )

      await act(async () => {
        fireEvent.click(screen.getByTestId('mock-json-validate'))
      })
      await act(async () => {
        // Nothing changed anywhere keeps Save disabled.
        changeDescription()
        fireEvent.click(screen.getByRole('button', { name: 'Save' }))
      })

      expect(onSave).toHaveBeenCalledTimes(1)
      const saveData = onSave.mock.calls[0][0]
      // No explicit type means defaults to 'string'
      expect(saveData.outputTypes.status).toBe('string')
    })

    it('combined mode JsonQueryEditor callbacks update values state', async () => {
      const user = userEvent.setup({ delay: null })
      const onSave = vi.fn()
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={mockJsonParserElement}
          onSave={onSave}
        />
      )

      // Click mock buttons to invoke the callbacks (combined mode)
      await user.click(screen.getByTestId('mock-json-query-change'))
      await user.click(screen.getByTestId('mock-json-types-change'))
      await user.click(screen.getByTestId('mock-json-validate'))
      await user.click(screen.getByRole('button', { name: 'Save' }))

      expect(onSave).toHaveBeenCalledTimes(1)
      const savedValues = onSave.mock.calls[0][0].values
      expect(savedValues.queries).toEqual({ price: '$.store.price' })
      expect(savedValues.query_output_types).toEqual({ price: 'string' })
    })

    it('individual mode JsonQueryEditor callbacks update values state', async () => {
      const user = userEvent.setup({ delay: null })
      const onSave = vi.fn()
      const individualElement = {
        ...mockJsonParserElement,
        currentValues: {
          ...mockJsonParserElement.currentValues,
          output_mode: 'individual',
          queries: { price: '$.store.price' },
          query_output_types: { price: 'float' },
        },
      }
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={individualElement}
          onSave={onSave}
        />
      )

      // Click mock buttons to invoke the callbacks (individual mode)
      await user.click(screen.getByTestId('mock-json-query-change'))
      await user.click(screen.getByTestId('mock-json-types-change'))
      await user.click(screen.getByTestId('mock-json-validate'))
      await user.click(screen.getByRole('button', { name: 'Save' }))

      expect(onSave).toHaveBeenCalledTimes(1)
      const savedValues = onSave.mock.calls[0][0].values
      expect(savedValues.queries).toEqual({ price: '$.store.price' })
      expect(savedValues.query_output_types).toEqual({ price: 'string' })
    })

    it('renders combined mode with undefined queries and json_content', async () => {
      const minimalElement = {
        ...mockJsonParserElement,
        currentValues: {
          output_mode: 'combined',
          // queries, json_content, query_output_types are all missing
        },
      }
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={minimalElement}
          onSave={vi.fn()}
        />
      )

      expect(screen.getByTestId('json-query-editor')).toBeInTheDocument()
    })

    it('renders individual mode with undefined queries and json_content', async () => {
      const minimalIndividual = {
        ...mockJsonParserElement,
        currentValues: {
          output_mode: 'individual',
          // queries, json_content, query_output_types are all missing
        },
      }
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={minimalIndividual}
          onSave={vi.fn()}
        />
      )

      expect(screen.getByTestId('json-query-editor')).toBeInTheDocument()
    })

    it('stores the Output Mode the section shows, combined, and binds no query alias as in combined mode', async () => {
      const onSave = vi.fn()
      const noModeElement = {
        ...mockJsonParserElement,
        currentValues: {
          json_content: '{}',
          queries: { price: '$.store.price' },
        },
      }
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={noModeElement}
          onSave={onSave}
        />
      )

      await act(async () => {
        fireEvent.click(screen.getByTestId('mock-json-validate'))
      })
      await act(async () => {
        // Nothing changed anywhere keeps Save disabled.
        changeDescription()
        fireEvent.click(screen.getByRole('button', { name: 'Save' }))
      })

      expect(onSave).toHaveBeenCalledTimes(1)
      const saveData = onSave.mock.calls[0][0]
      // A shown choice stores the value it displays (FIELD-8).
      expect(saveData.values.output_mode).toBe('combined')
      expect(saveData.outputBindings.price).toBeUndefined()
    })

    it('shows the expression toggle on json_content parameter (expression allowed)', async () => {
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={mockJsonParserElement}
          onSave={vi.fn()}
        />
      )

      // json_content row should exist
      const jsonContentRow = screen.getByTestId('param-row-json_content')
      expect(jsonContentRow).toBeInTheDocument()
      // noExpression removed -> the {} expression toggle is present.
      const toggleWithinRow = jsonContentRow.querySelector('[data-testid="expression-toggle"]')
      expect(toggleWithinRow).toBeInTheDocument()
    })
  })

  // =========================================================================
  // Assert Control Integration
  // =========================================================================
  describe('Assert Control', () => {
    const mockAssertElement = {
      id: 'node-assert-1',
      name: 'Assert',
      elementType: 'assert',
      version: '1.0',
      availableVersions: ['1.0'],
      parameters: [],
      outputs: [
        { name: 'passed', type: 'boolean', description: 'Whether all assertions passed' },
      ],
      currentValues: {
        assertions: [],
        mode: 'split',
      },
      outputBindings: {},
    }

    it('renders AssertionBuilder for assert element type', async () => {
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={mockAssertElement}
          onSave={vi.fn()}
        />
      )

      // AssertionBuilder mock should be rendered
      expect(screen.getByTestId('assertion-builder-mock')).toBeInTheDocument()
    })

    it('renders branching mode radio group for assert element', async () => {
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={mockAssertElement}
          onSave={vi.fn()}
        />
      )

      // Branching Mode heading and radio options should be present
      expect(screen.getByText('Branching Mode')).toBeInTheDocument()
      expect(screen.getByLabelText('Single')).toBeInTheDocument()
      expect(screen.getByLabelText('Split')).toBeInTheDocument()
    })

    it('includes assertions and mode in saved values', async () => {
      const user = userEvent.setup()
      const onSave = vi.fn()
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={mockAssertElement}
          onSave={onSave}
        />
      )

      // Change assertions via mock button
      await user.click(screen.getByTestId('mock-assert-change'))

      // Click Save
      const saveBtn = screen.getByRole('button', { name: /save/i })
      await user.click(saveBtn)

      expect(onSave).toHaveBeenCalled()
      const savedData = onSave.mock.calls[0][0]
      // Assertions should be included in the saved values
      expect(savedData.values.assertions).toBeDefined()
      expect(savedData.values.mode).toBeDefined()
    })

    it('detects unsaved changes when assertions differ from element state', async () => {
      // Suppress Radix animation warnings (same pattern as existing unsaved test)
      vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
        const msg = typeof args[0] === 'string' ? args[0] : ''
        if (msg.includes('not wrapped in act') || msg.includes('act` scope')) return
        console.warn('[unexpected console.error]', ...args)
      })

      const user = userEvent.setup({ delay: null })
      const handleClose = vi.fn()
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={handleClose}
          element={mockAssertElement}
          onSave={vi.fn()}
        />
      )

      // Change assertions via mock button to create unsaved changes
      await user.click(screen.getByTestId('mock-assert-change'))

      // Also change mode via radio to ensure mode comparison path is hit
      await user.click(screen.getByLabelText('Single'))

      // Click Cancel - should NOT call onClose directly (unsaved changes detected)
      await user.click(screen.getByRole('button', { name: 'Cancel' }))

      // hasChanges triggered the unsaved dialog, so onClose was NOT called directly
      expect(handleClose).not.toHaveBeenCalled()
    })

    it('changes branching mode via radio group', async () => {
      const user = userEvent.setup()
      const onSave = vi.fn()
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={mockAssertElement}
          onSave={onSave}
        />
      )

      // Default mode is 'split' - change to 'single'
      await user.click(screen.getByLabelText('Single'))

      // Save to verify mode is included
      const saveBtn = screen.getByRole('button', { name: /save/i })
      await user.click(saveBtn)

      expect(onSave).toHaveBeenCalled()
      const savedData = onSave.mock.calls[0][0]
      expect(savedData.values.mode).toBe('single')
    })

    it('disables save when AssertionBuilder reports invalid (line 533: isAssert && !assertValid)', async () => {
      const user = userEvent.setup()
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={mockAssertElement}
          onSave={vi.fn()}
        />
      )

      // First make a change so Save is enabled (assertions differ from empty state)
      await user.click(screen.getByTestId('mock-assert-change'))

      // Now invalidate the assert builder
      await user.click(screen.getByTestId('mock-assert-invalidate'))

      // Save button should be disabled because assertValid is false
      const saveBtn = screen.getByRole('button', { name: /save/i })
      expect(saveBtn).toBeDisabled()
    })

    it('detects hasChanges when currentValues has no assertions field (triggers ?? [] fallback, line 589)', async () => {
      // Suppress Radix animation warnings
      vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
        const msg = typeof args[0] === 'string' ? args[0] : ''
        if (msg.includes('not wrapped in act') || msg.includes('act` scope')) return
        console.warn('[unexpected console.error]', ...args)
      })

      const user = userEvent.setup({ delay: null })
      const handleClose = vi.fn()
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      // currentValues has no assertions key - element.currentValues.assertions is undefined
      // This triggers the `?? []` fallback on line 589
      const elementWithoutAssertions = {
        ...mockAssertElement,
        currentValues: { mode: 'split' }, // no assertions key
      }
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={handleClose}
          element={elementWithoutAssertions}
          onSave={vi.fn()}
        />
      )

      // Change assertions so they differ from the undefined/[] default
      await user.click(screen.getByTestId('mock-assert-change'))

      // Clicking Cancel should trigger unsaved changes dialog
      await user.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(handleClose).not.toHaveBeenCalled()
    })

    it('detects hasChanges when currentValues has no mode field (triggers ?? split fallback, line 590)', async () => {
      // Suppress Radix animation warnings
      vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
        const msg = typeof args[0] === 'string' ? args[0] : ''
        if (msg.includes('not wrapped in act') || msg.includes('act` scope')) return
        console.warn('[unexpected console.error]', ...args)
      })

      const user = userEvent.setup({ delay: null })
      const handleClose = vi.fn()
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      // currentValues has no mode key - element.currentValues.mode is undefined
      // This triggers the `?? 'split'` fallback on line 590
      const elementWithoutMode = {
        ...mockAssertElement,
        currentValues: { assertions: [] }, // no mode key
      }
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={handleClose}
          element={elementWithoutMode}
          onSave={vi.fn()}
        />
      )

      // Change mode to 'single' - differs from the undefined ?? 'split' default
      await user.click(screen.getByLabelText('Single'))

      // Clicking Cancel should trigger unsaved changes dialog
      await user.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(handleClose).not.toHaveBeenCalled()
    })

    it('renders Fail Current Scope checkbox for assert element', async () => {
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={mockAssertElement}
          onSave={vi.fn()}
        />
      )

      expect(screen.getByRole('checkbox', { name: 'Fail Current Scope' })).toBeInTheDocument()
    })

    it('includes fail_current_scope in saved values', async () => {
      const user = userEvent.setup()
      const onSave = vi.fn()
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={mockAssertElement}
          onSave={onSave}
        />
      )

      // Toggle fail_current_scope checkbox on via the Radix checkbox role
      const checkbox = screen.getByRole('checkbox', { name: 'Fail Current Scope' })
      await user.click(checkbox)

      // Save should be enabled since fail_current_scope changed
      const saveBtn = screen.getByRole('button', { name: /save/i })
      expect(saveBtn).not.toBeDisabled()
      await user.click(saveBtn)

      expect(onSave).toHaveBeenCalled()
      const savedData = onSave.mock.calls[0][0]
      expect(savedData.values.fail_current_scope).toBe(true)
    })

    it('detects hasChanges when fail_current_scope differs from element state', async () => {
      vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
        const msg = typeof args[0] === 'string' ? args[0] : ''
        if (msg.includes('not wrapped in act') || msg.includes('act` scope')) return
        console.warn('[unexpected console.error]', ...args)
      })

      const user = userEvent.setup({ delay: null })
      const handleClose = vi.fn()
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={handleClose}
          element={mockAssertElement}
          onSave={vi.fn()}
        />
      )

      // Toggle fail_current_scope checkbox via Radix role
      const checkbox = screen.getByRole('checkbox', { name: 'Fail Current Scope' })
      await user.click(checkbox)

      // Clicking Cancel should trigger unsaved changes dialog
      await user.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(handleClose).not.toHaveBeenCalled()
    })
  })

  // =========================================================================
  // If/Else Control Integration
  // =========================================================================
  describe('If/Else Control', () => {
    const mockIfElseElement = {
      id: 'node-ifelse-1',
      name: 'If/Else',
      elementType: 'if-else',
      version: '1.0',
      availableVersions: ['1.0'],
      parameters: [],
      outputs: [],
      currentValues: {
        branches: [],
      },
      outputBindings: {},
    }

    it('renders ConditionBranchEditor for if-else element type', async () => {
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={mockIfElseElement}
          onSave={vi.fn()}
        />
      )

      // ConditionBranchEditor mock should be rendered
      expect(screen.getByTestId('condition-branch-editor-mock')).toBeInTheDocument()
    })

    it('filters branches parameter from display parameters', async () => {
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={mockIfElseElement}
          onSave={vi.fn()}
        />
      )

      // The 'branches' parameter should be filtered out - ConditionBranchEditor handles it
      // The condition-branch-editor-mock should be present instead of a regular parameter row
      expect(screen.getByTestId('condition-branch-editor-mock')).toBeInTheDocument()
    })

    it('includes branches in saved values', async () => {
      const user = userEvent.setup()
      const onSave = vi.fn()
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={mockIfElseElement}
          onSave={onSave}
        />
      )

      // Change branches via mock button
      await user.click(screen.getByTestId('mock-branch-change'))

      // Click Save
      const saveBtn = screen.getByRole('button', { name: /save/i })
      await user.click(saveBtn)

      expect(onSave).toHaveBeenCalled()
      const savedData = onSave.mock.calls[0][0]
      // Branches should be included in the saved values
      expect(savedData.values.branches).toBeDefined()
      expect(savedData.values.branches).toHaveLength(2)
    })

    it('detects unsaved changes when branches differ from element state', async () => {
      // Suppress Radix animation warnings
      vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
        const msg = typeof args[0] === 'string' ? args[0] : ''
        if (msg.includes('not wrapped in act') || msg.includes('act` scope')) return
        console.warn('[unexpected console.error]', ...args)
      })

      const user = userEvent.setup({ delay: null })
      const handleClose = vi.fn()
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={handleClose}
          element={mockIfElseElement}
          onSave={vi.fn()}
        />
      )

      // Change branches via mock button to create unsaved changes
      await user.click(screen.getByTestId('mock-branch-change'))

      // Click Cancel - should show unsaved changes dialog
      await user.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(handleClose).not.toHaveBeenCalled()
    })

    it('disables save when ConditionBranchEditor reports invalid', async () => {
      const user = userEvent.setup()
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={mockIfElseElement}
          onSave={vi.fn()}
        />
      )

      // First make a change so save would be enabled
      await user.click(screen.getByTestId('mock-branch-change'))

      // Now invalidate via the mock button
      await user.click(screen.getByTestId('mock-branch-invalidate'))

      // Save button should be disabled because ifElseValid is false
      const saveBtn = screen.getByRole('button', { name: /save/i })
      expect(saveBtn).toBeDisabled()
    })

    it('detects hasChanges when currentValues has no branches field (triggers ?? [] fallback)', async () => {
      // Suppress Radix animation warnings
      vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
        const msg = typeof args[0] === 'string' ? args[0] : ''
        if (msg.includes('not wrapped in act') || msg.includes('act` scope')) return
        console.warn('[unexpected console.error]', ...args)
      })

      const user = userEvent.setup({ delay: null })
      const handleClose = vi.fn()
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      // currentValues has no branches key
      const elementWithoutBranches = {
        ...mockIfElseElement,
        currentValues: {}, // no branches key
      }
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={handleClose}
          element={elementWithoutBranches}
          onSave={vi.fn()}
        />
      )

      // Change branches to create unsaved changes
      await user.click(screen.getByTestId('mock-branch-change'))

      // Clicking Cancel should trigger unsaved changes dialog
      await user.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(handleClose).not.toHaveBeenCalled()
    })
  })

  // =========================================================================
  describe('While Loop Control', () => {
    const mockWhileElement = {
      id: 'node-while-1',
      name: 'While Loop',
      elementType: 'while',
      version: '1.0',
      availableVersions: ['1.0'],
      parameters: [
        { name: 'mode', type: 'string' as const, label: 'Mode', required: true, defaultValue: 'while-do', enumValues: ['while-do', 'do-while'] },
      ],
      outputs: [
        { name: 'index', type: 'integer' as const, description: '0-based iteration counter' },
      ],
      currentValues: {
        conditions: [],
        mode: 'while-do',
      },
      outputBindings: {},
    }

    it('renders AssertionBuilder for while element type', async () => {
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={mockWhileElement}
          onSave={vi.fn()}
        />
      )

      expect(screen.getByTestId('assertion-builder-mock')).toBeInTheDocument()
    })

    it('includes conditions in saved values', async () => {
      const user = userEvent.setup()
      const onSave = vi.fn()
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={mockWhileElement}
          onSave={onSave}
        />
      )

      // Change conditions via mock AssertionBuilder button
      await user.click(screen.getByTestId('mock-assert-change'))

      // Click Save
      const saveBtn = screen.getByRole('button', { name: /save/i })
      await user.click(saveBtn)

      expect(onSave).toHaveBeenCalled()
      const savedData = onSave.mock.calls[0][0]
      expect(savedData.values.conditions).toBeDefined()
    })

    it('detects unsaved changes when conditions differ', async () => {
      vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
        const msg = typeof args[0] === 'string' ? args[0] : ''
        if (msg.includes('not wrapped in act') || msg.includes('act` scope')) return
        console.warn('[unexpected console.error]', ...args)
      })

      const user = userEvent.setup({ delay: null })
      const handleClose = vi.fn()
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={handleClose}
          element={mockWhileElement}
          onSave={vi.fn()}
        />
      )

      // Change conditions via mock button
      await user.click(screen.getByTestId('mock-assert-change'))

      // Clicking Cancel should trigger unsaved changes dialog
      await user.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(handleClose).not.toHaveBeenCalled()
    })

    it('detects hasChanges when currentValues has no conditions field (triggers ?? [] fallback)', async () => {
      vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
        const msg = typeof args[0] === 'string' ? args[0] : ''
        if (msg.includes('not wrapped in act') || msg.includes('act` scope')) return
        console.warn('[unexpected console.error]', ...args)
      })

      const user = userEvent.setup({ delay: null })
      const handleClose = vi.fn()
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      const elementWithoutConditions = {
        ...mockWhileElement,
        currentValues: {}, // no conditions key
      }
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={handleClose}
          element={elementWithoutConditions}
          onSave={vi.fn()}
        />
      )

      // Change conditions to create unsaved changes
      await user.click(screen.getByTestId('mock-assert-change'))

      // Clicking Cancel should trigger unsaved changes dialog
      await user.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(handleClose).not.toHaveBeenCalled()
    })

    it('disables save when While conditions are invalid', async () => {
      const user = userEvent.setup()
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={mockWhileElement}
          onSave={vi.fn()}
        />
      )

      // Make a change so Save would be enabled
      await user.click(screen.getByTestId('mock-assert-change'))

      // Invalidate via While conditions validation
      await user.click(screen.getByTestId('mock-assert-invalidate'))

      const saveBtn = screen.getByRole('button', { name: /save/i })
      expect(saveBtn).toBeDisabled()
    })
  })

  describe('Break/Continue - LoopTargetSelector', () => {
    const mockBreakElement = {
      id: 'brk-1',
      name: 'Break',
      elementType: 'break',
      version: '1.0.0',
      availableVersions: ['1.0.0'],
      parameters: [
        { name: 'target_loop', label: 'Target Loop', type: 'string' as const, required: true, description: 'Which loop to break out of' },
      ],
      outputParameters: [],
      outputs: [],
      config: { target_loop: '' },
      currentValues: {},
      outputBindings: {},
      profileBindings: [],
      nodeType: 'control',
      expressionFields: [],
      templateFields: [],
    }

    it('renders LoopTargetSelector for break element type', async () => {
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={mockBreakElement}
          onSave={vi.fn()}
        />
      )
      expect(screen.getByTestId('loop-target-selector-mock')).toBeInTheDocument()
    })

    it('renders LoopTargetSelector with empty value when target_loop is undefined', async () => {
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      const elementWithNoTarget = { ...mockBreakElement, config: {} }
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={elementWithNoTarget}
          onSave={vi.fn()}
        />
      )
      expect(screen.getByTestId('mock-loop-target-value')).toHaveTextContent('')
    })
  })
  /**
   * Shell Script and Shell Exec run on the WAVE server, so inside a Remote
   * Execution body they keep Browse on their path rows (SHRUN-1, SHRUN-17,
   * TDATA-8). Shell Script also carries the variable export table (SHRUN-6).
   *
   * REQ-3.4.1.3, REQ-3.4.3.2
   */
  describe('Local blocks inside a Remote Execution body', () => {
    const shellScriptElement = {
      id: 'node-shell-script',
      name: 'Shell Script',
      elementType: 'shell-script',
      version: '1.0.0',
      availableVersions: ['1.0.0'],
      parameters: PLUGIN_INPUTS['shell-script'],
      outputs: PLUGIN_OUTPUTS['shell-script'],
      currentValues: { script: 'echo hi' },
      outputBindings: {},
    }

    const shellExecElement = {
      ...shellScriptElement,
      id: 'node-shell-exec',
      name: 'Shell Exec',
      elementType: 'shell-exec',
      parameters: PLUGIN_INPUTS['shell-exec'],
      outputs: PLUGIN_OUTPUTS['shell-exec'],
      currentValues: { command: 'ls -1' },
    }

    const fileIoElement = {
      ...shellScriptElement,
      id: 'node-file-io',
      name: 'File I/O',
      elementType: 'file-io',
      parameters: PLUGIN_INPUTS['file-io'],
      outputs: PLUGIN_OUTPUTS['file-io'],
      currentValues: {},
    }

    /** Puts the element in a Remote Execution container's body sub-flow. */
    function seedRemoteBody(elementId: string) {
      mockWorkflowStore.nodes = [
        { id: 'remote-1', data: { elementType: 'remote-execution' } },
      ]
      mockWorkflowStore.edges = [
        { source: 'remote-1', target: elementId, sourceHandle: 'body' },
      ]
    }

    async function renderElement(element: Record<string, unknown>) {
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      return render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={element as never}
          onSave={vi.fn()}
        />
      )
    }

    /** The export table's header row, found by its own first heading. */
    function exportHeaderRow(): HTMLElement {
      const heading = screen.getByRole('columnheader', { name: 'Script Variable' })
      const headerRow = heading.closest('tr')
      expect(headerRow).not.toBeNull()
      return headerRow as HTMLElement
    }

    it('keeps Browse on the Shell Script Working Directory row inside a Remote Execution body', async () => {
      seedRemoteBody('node-shell-script')
      await renderElement(shellScriptElement)

      fireEvent.click(screen.getByTestId('group-header-Execution'))

      expect(screen.getByTestId('param-row-working_dir')).toBeInTheDocument()
      expect(screen.getByTestId('param-browse-working_dir')).toBeInTheDocument()
    })

    it('hides Browse on the path row of a block that runs on the execution host', async () => {
      seedRemoteBody('node-file-io')
      await renderElement(fileIoElement)

      expect(screen.getByTestId('param-row-path')).toBeInTheDocument()
      expect(screen.queryByTestId('param-browse-path')).not.toBeInTheDocument()
    })

    it('hides Browse on the path row of a host block in a drilled Function body called from a body', async () => {
      mockWorkflowStore.nodes = [
        { id: 'remote-1', data: { elementType: 'remote-execution' } },
        {
          id: 'fn-1',
          data: {
            elementType: 'function',
            nodeType: 'function',
            localDefinition: { workflow: { nodes: [{ id: 'node-file-io', data: { elementType: 'file-io' } }], edges: [] } },
          },
        },
      ]
      mockWorkflowStore.edges = [{ source: 'remote-1', target: 'fn-1', sourceHandle: 'body' }]
      mockWorkflowStore.drillPath = [{ nodeId: 'fn-1', label: 'fn-1' }]
      try {
        await renderElement(fileIoElement)

        expect(screen.getByTestId('param-row-path')).toBeInTheDocument()
        expect(screen.queryByTestId('param-browse-path')).not.toBeInTheDocument()
      } finally {
        mockWorkflowStore.drillPath = []
      }
    })

    it('shows the export table header and its add control for a Shell Script with no exports', async () => {
      await renderElement(shellScriptElement)

      const header = within(exportHeaderRow())
      expect(header.getByRole('columnheader', { name: 'Script Variable' })).toBeInTheDocument()
      expect(header.getByRole('columnheader', { name: 'Type' })).toBeInTheDocument()
      expect(header.getByRole('columnheader', { name: 'Secret' })).toBeInTheDocument()
      expect(header.getByRole('columnheader', { name: 'WAVE Variable' })).toBeInTheDocument()

      const add = screen.getByTestId('output-list-add')
      expect(add).toHaveAccessibleName('Add variable export')
      const lastFixedRow = screen.getByTestId('output-row-success')
      expect(
        lastFixedRow.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy()
    })

    it('keeps the variable exports out of the Shell Script input parameters', async () => {
      await renderElement(shellScriptElement)

      expect(screen.queryByTestId('param-row-script_variables')).not.toBeInTheDocument()
    })

    it('gives Shell Exec no export table header and no add control', async () => {
      await renderElement(shellExecElement)

      expect(screen.getByTestId('output-row-stdout')).toBeInTheDocument()
      expect(
        screen.queryByRole('columnheader', { name: 'Script Variable' })
      ).not.toBeInTheDocument()
      expect(screen.queryByTestId('output-list-add')).not.toBeInTheDocument()
    })
  })

  /**
   * The HTTP block's Proxy row reads "Remote host's settings" inside a Remote
   * Execution body, so a Save there stores nothing for it, like a hidden row (HTTP-13, SHELL-10).
   *
   * REQ-4.7.14, REQ-4.7.16
   */
  describe('HTTP block saved inside a Remote Execution body', () => {
    const httpElement = {
      id: 'node-http',
      name: 'HTTP Client',
      elementType: 'http-client',
      version: '1.0.0',
      availableVersions: ['1.0.0'],
      parameters: PLUGIN_INPUTS['http-client'],
      outputs: PLUGIN_OUTPUTS['http-client'],
      currentValues: { url: 'https://api.corp.example/health', proxy_mode: 'off' },
      outputBindings: {},
    }

    async function renameAndSave(onSave: ReturnType<typeof vi.fn>) {
      const user = userEvent.setup({ delay: null })
      const { ElementConfigModal } = await import('@/features/workbench/common/element-config')
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={httpElement as never}
          onSave={onSave}
        />
      )
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
      await user.type(screen.getByTestId('element-name-input'), ' 2')
      await user.click(screen.getByRole('button', { name: 'Save' }))
      expect(onSave).toHaveBeenCalledTimes(1)
      return onSave.mock.calls[0][0] as { name: string; values: Record<string, unknown> }
    }

    it('stores no Proxy choice when the dialog is saved there', async () => {
      mockWorkflowStore.nodes = [{ id: 'remote-1', data: { elementType: 'remote-execution' } }]
      mockWorkflowStore.edges = [{ source: 'remote-1', target: 'node-http', sourceHandle: 'body' }]

      const saved = await renameAndSave(vi.fn())

      expect(saved.name).toBe('HTTP Client 2')
      expect(saved.values).not.toHaveProperty('proxy_mode')
      expect(saved.values.url).toBe('https://api.corp.example/health')
    })

    it('keeps the stored Proxy choice when the dialog is saved on the WAVE host', async () => {
      const saved = await renameAndSave(vi.fn())

      expect(saved.values.proxy_mode).toBe('off')
    })
  })
})

describe('ElementConfigModal - DraggableSheet shell (CANVAS-227..230)', () => {
  function suppressActWarnings() {
    return vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      const msg = typeof args[0] === 'string' ? args[0] : ''
      if (msg.includes('not wrapped in act') || msg.includes('act` scope')) return
      console.warn('[unexpected console.error]', ...args)
    })
  }

  it('renders as a non-blocking sheet with no Radix dialog shell', async () => {
    const { ElementConfigModal } = await import(
      '@/features/workbench/common/element-config'
    )
    render(
      <ElementConfigModal
        isOpen={true}
        onClose={vi.fn()}
        element={mockElementData}
        onSave={vi.fn()}
      />
    )

    expect(screen.getByTestId('element-config-sheet')).toBeInTheDocument()
    // The shell itself is a DraggableSheet region; only the NESTED dialogs
    // (Changelog, Details, Profiles, Unsaved changes) stay Radix Dialogs and
    // none of them is open here.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('live-follows the Name field in the sheet title', async () => {
    const user = userEvent.setup({ delay: null })
    const { ElementConfigModal } = await import(
      '@/features/workbench/common/element-config'
    )
    render(
      <ElementConfigModal
        isOpen={true}
        onClose={vi.fn()}
        element={mockElementData}
        onSave={vi.fn()}
      />
    )

    const nameInput = screen.getByTestId('element-name-input')
    await user.clear(nameInput)
    await user.type(nameInput, 'Renamed Step')

    expect(
      screen.getByRole('heading', { name: 'Renamed Step - Edit Config' }),
    ).toBeInTheDocument()
  })

  it('falls back to the element-type label when the Name field is empty', async () => {
    const user = userEvent.setup({ delay: null })
    const { ElementConfigModal } = await import(
      '@/features/workbench/common/element-config'
    )
    render(
      <ElementConfigModal
        isOpen={true}
        onClose={vi.fn()}
        element={mockElementData}
        onSave={vi.fn()}
      />
    )

    await user.clear(screen.getByTestId('element-name-input'))

    // mockElementData.elementType is 'http-client', whose palette display
    // label is 'HTTP'.
    expect(
      screen.getByRole('heading', { name: 'HTTP - Edit Config' }),
    ).toBeInTheDocument()
  })

  it('falls back to the control label, then the raw type, for non-plugin elements', async () => {
    const { ElementConfigModal } = await import(
      '@/features/workbench/common/element-config'
    )
    const { unmount } = render(
      <ElementConfigModal
        isOpen={true}
        onClose={vi.fn()}
        element={{ ...mockElementData, elementType: 'delay', name: '' }}
        onSave={vi.fn()}
      />
    )
    expect(
      screen.getByRole('heading', { name: 'Delay - Edit Config' }),
    ).toBeInTheDocument()
    unmount()

    render(
      <ElementConfigModal
        isOpen={true}
        onClose={vi.fn()}
        element={{ ...mockElementData, elementType: 'mystery-type', name: '' }}
        onSave={vi.fn()}
      />
    )
    expect(
      screen.getByRole('heading', { name: 'mystery-type - Edit Config' }),
    ).toBeInTheDocument()
  })

  it('renders an X close affordance in the sheet header', async () => {
    const { ElementConfigModal } = await import(
      '@/features/workbench/common/element-config'
    )
    render(
      <ElementConfigModal
        isOpen={true}
        onClose={vi.fn()}
        element={mockElementData}
        onSave={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: /^close$/i })).toBeInTheDocument()
  })

  it('X closes directly when there are no unsaved changes', async () => {
    const user = userEvent.setup({ delay: null })
    const handleClose = vi.fn()
    const { ElementConfigModal } = await import(
      '@/features/workbench/common/element-config'
    )
    render(
      <ElementConfigModal
        isOpen={true}
        onClose={handleClose}
        element={mockElementData}
        onSave={vi.fn()}
      />
    )

    await user.click(screen.getByRole('button', { name: /^close$/i }))

    expect(handleClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument()
  })

  it('X routes through the unsaved-changes guard when dirty', async () => {
    const consoleError = suppressActWarnings()
    const user = userEvent.setup({ delay: null })
    const handleClose = vi.fn()
    const { ElementConfigModal } = await import(
      '@/features/workbench/common/element-config'
    )
    render(
      <ElementConfigModal
        isOpen={true}
        onClose={handleClose}
        element={mockElementData}
        onSave={vi.fn()}
      />
    )

    await user.type(
      screen.getByTestId('element-description-input'),
      'Changed Description',
    )
    await user.click(screen.getByRole('button', { name: /^close$/i }))

    await waitFor(() => {
      expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
    })
    expect(handleClose).not.toHaveBeenCalled()

    consoleError.mockRestore()
  })

  it('defers Escape to an open nested dialog instead of closing the sheet', async () => {
    const consoleError = suppressActWarnings()
    const user = userEvent.setup({ delay: null })
    const handleClose = vi.fn()
    const { ElementConfigModal } = await import(
      '@/features/workbench/common/element-config'
    )
    render(
      <ElementConfigModal
        isOpen={true}
        onClose={handleClose}
        element={mockElementData}
        onSave={vi.fn()}
      />
    )

    // Dirty the sheet, then open the Unsaved changes prompt via X. While the
    // (Radix) prompt is up it owns Escape - the sheet must not also close.
    await user.type(
      screen.getByTestId('element-description-input'),
      'Changed Description',
    )
    await user.click(screen.getByRole('button', { name: /^close$/i }))
    await waitFor(() => {
      expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
    })

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(handleClose).not.toHaveBeenCalled()

    consoleError.mockRestore()
  })

  // Scope read-only: sheets persist across drill; out-of-scope sheets
  // (and any sheet on a read-only canvas) freeze via the per-sheet provider.
  it('shows the READ-ONLY pill when the sheet is read-only and hides it when editable', async () => {
    const { CanvasReadOnlyProvider } = await import(
      '@/features/workbench/common/canvas/read-only-context'
    )
    const { ElementConfigModal } = await import(
      '@/features/workbench/common/element-config'
    )
    const { rerender } = render(
      <CanvasReadOnlyProvider value={false}>
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={mockElementData}
          onSave={vi.fn()}
        />
      </CanvasReadOnlyProvider>
    )
    expect(
      screen.queryByTestId('element-config-read-only-pill'),
    ).not.toBeInTheDocument()

    rerender(
      <CanvasReadOnlyProvider value={true}>
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={mockElementData}
          onSave={vi.fn()}
        />
      </CanvasReadOnlyProvider>
    )
    expect(
      screen.getByTestId('element-config-read-only-pill'),
    ).toBeInTheDocument()
  })

  it('keeps the unsaved guard when the sheet turned read-only with edits, without offering Save', async () => {
    const consoleError = suppressActWarnings()
    const user = userEvent.setup({ delay: null })
    const handleClose = vi.fn()
    const { CanvasReadOnlyProvider } = await import(
      '@/features/workbench/common/canvas/read-only-context'
    )
    const { ElementConfigModal } = await import(
      '@/features/workbench/common/element-config'
    )
    const { rerender } = render(
      <CanvasReadOnlyProvider value={false}>
        <ElementConfigModal
          isOpen={true}
          onClose={handleClose}
          element={mockElementData}
          onSave={vi.fn()}
        />
      </CanvasReadOnlyProvider>
    )
    await user.type(
      screen.getByTestId('element-description-input'),
      'Changed Description',
    )

    // Scope flip: same sheet, now read-only (e.g. user drilled away).
    rerender(
      <CanvasReadOnlyProvider value={true}>
        <ElementConfigModal
          isOpen={true}
          onClose={handleClose}
          element={mockElementData}
          onSave={vi.fn()}
        />
      </CanvasReadOnlyProvider>
    )

    const header = screen.getByTestId('element-config-sheet-drag-handle')
    await user.click(within(header).getByRole('button', { name: /^close$/i }))

    await waitFor(() => {
      expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
    })
    expect(handleClose).not.toHaveBeenCalled()

    const dialog = screen.getByRole('dialog')
    expect(
      within(dialog).queryByRole('button', { name: /^save$/i }),
    ).not.toBeInTheDocument()

    const close = within(dialog).getByTestId('unsaved-close')
    expect(close).toHaveTextContent(/^Close$/)
    await user.click(close)
    expect(handleClose).toHaveBeenCalledTimes(1)

    consoleError.mockRestore()
  })

  it('saves the edited values from the unsaved-changes prompt', async () => {
    const consoleError = suppressActWarnings()
    const user = userEvent.setup({ delay: null })
    const handleSave = vi.fn()
    const { ElementConfigModal } = await import(
      '@/features/workbench/common/element-config'
    )
    render(
      <ElementConfigModal
        isOpen={true}
        onClose={vi.fn()}
        element={mockElementData}
        onSave={handleSave}
      />
    )
    await user.type(
      screen.getByTestId('element-description-input'),
      'Changed Description',
    )
    await user.click(screen.getByRole('button', { name: /^close$/i }))
    await waitFor(() => {
      expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
    })

    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /^save$/i }))
    expect(handleSave).toHaveBeenCalledTimes(1)
    expect(handleSave).toHaveBeenCalledWith(
      expect.objectContaining({ id: mockElementData.id }),
    )

    consoleError.mockRestore()
  })

  describe('Transform section gating', () => {
    const csvElement = {
      id: 'node-csv',
      name: 'CSV Parser',
      elementType: 'csv-parser',
      nodeType: 'plugin',
      version: '1.0.0',
      availableVersions: ['1.0.0'],
      parameters: [],
      outputs: [],
      currentValues: {} as Record<string, unknown>,
      outputBindings: {},
    }

    const excelElement = { ...csvElement, id: 'node-excel', name: 'Excel', elementType: 'excel-parser' }

    /** The section is schema-driven: it follows a visible `sorts` param,
     *  never a hardcoded element id. */
    async function renderElement(element: Record<string, unknown>) {
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      return render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={element as never}
          onSave={vi.fn()}
        />
      )
    }

    it('renders the Transform sections for the Excel element in read mode', async () => {
      await renderElement({ ...excelElement, currentValues: { operation: 'read' } })

      expect(await screen.findByTestId('table-transform-mock')).toBeInTheDocument()
    })

    it('renders the Transform sections for the Excel element by default (read)', async () => {
      await renderElement({ ...excelElement, currentValues: {} })

      expect(await screen.findByTestId('table-transform-mock')).toBeInTheDocument()
    })

    it('threads the Excel read sorts and filters into the sections', async () => {
      await renderElement({
        ...excelElement,
        currentValues: {
          operation: 'read',
          sorts: [{ id: 's1' }, { id: 's2' }],
          filters: [{ id: 'f1' }],
          has_header: false,
        },
      })

      const mock = await screen.findByTestId('table-transform-mock')
      expect(within(mock).getByTestId('table-transform-sorts-count')).toHaveTextContent('2')
      expect(within(mock).getByTestId('table-transform-filters-count')).toHaveTextContent('1')
      expect(mock).toHaveAttribute('data-has-header', 'false')
    })

    it('renders the Transform sections for the Excel element in write mode', async () => {
      await renderElement({ ...excelElement, currentValues: { operation: 'write' } })

      expect(await screen.findByTestId('table-transform-mock')).toBeInTheDocument()
    })

    it('references columns by name for an Excel write, which has no header-row input', async () => {
      await renderElement({ ...excelElement, currentValues: { operation: 'write' } })

      const mock = await screen.findByTestId('table-transform-mock')
      expect(mock).toHaveAttribute('data-has-header', 'true')
    })

    it('hides the Transform sections for an element whose schema has no sorts param', async () => {
      await renderElement({
        ...csvElement,
        id: 'node-log',
        name: 'Log',
        elementType: 'log',
        currentValues: { message: 'hello' },
      })

      expect(await screen.findByRole('heading', { name: /edit config/i })).toBeInTheDocument()
      expect(screen.queryByTestId('table-transform-mock')).not.toBeInTheDocument()
    })

    it('renders the Transform sections in parse mode with the configured sorts and filters', async () => {
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={{
            ...csvElement,
            currentValues: {
              operation: 'parse',
              sorts: [{ id: 's1' }],
              filters: [{ id: 'f1' }],
              has_header: false,
            },
          }}
          onSave={vi.fn()}
        />
      )

      const mock = await screen.findByTestId('table-transform-mock')
      expect(within(mock).getByTestId('table-transform-sorts-count')).toHaveTextContent('1')
      expect(within(mock).getByTestId('table-transform-filters-count')).toHaveTextContent('1')
      expect(mock).toHaveAttribute('data-has-header', 'false')
    })

    it('defaults empty sorts/filters and header, and threads edits back into the config', async () => {
      const user = userEvent.setup()
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={{ ...csvElement, currentValues: {} }}
          onSave={vi.fn()}
        />
      )

      const mock = await screen.findByTestId('table-transform-mock')
      expect(within(mock).getByTestId('table-transform-sorts-count')).toHaveTextContent('0')
      expect(within(mock).getByTestId('table-transform-filters-count')).toHaveTextContent('0')
      expect(mock).toHaveAttribute('data-has-header', 'true')

      await user.click(screen.getByTestId('mock-transform-sorts-change'))
      await waitFor(() =>
        expect(screen.getByTestId('table-transform-sorts-count')).toHaveTextContent('1'),
      )

      await user.click(screen.getByTestId('mock-transform-filters-change'))
      await waitFor(() =>
        expect(screen.getByTestId('table-transform-filters-count')).toHaveTextContent('1'),
      )
    })

    it('renders the Transform sections in serialize mode, to shape the table on the way out', async () => {
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={{ ...csvElement, currentValues: { operation: 'serialize' } }}
          onSave={vi.fn()}
        />
      )

      expect(await screen.findByTestId('table-transform-mock')).toBeInTheDocument()
    })

    it('references columns by name in serialize mode even when the header row is not written', async () => {
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      render(
        <ElementConfigModal
          isOpen={true}
          onClose={vi.fn()}
          element={{
            ...csvElement,
            currentValues: { operation: 'serialize', has_header: false },
          }}
          onSave={vi.fn()}
        />
      )

      // The source is a bound table, which always carries column names; the
      // header checkbox only decides whether that row is written out.
      const mock = await screen.findByTestId('table-transform-mock')
      expect(mock).toHaveAttribute('data-has-header', 'true')
    })
  })
})

describe('ElementConfigModal - Run from the Python editor (PYRUN-21)', () => {
  const pythonElement = {
    id: 'node-py',
    name: 'Python',
    elementType: 'python',
    version: '1.0.0',
    availableVersions: ['1.0.0'],
    parameters: [],
    outputs: [],
    currentValues: { script_type: 'source', script: 'print(1)' },
    outputBindings: {},
  }

  const mockAdHocDispatch = vi.fn()
  const mockSelectEnvironment = vi.fn()
  // The run carries the whole unsaved config; the editor's script runs as Source.
  const EDITOR_RUN_DRAFT = expect.objectContaining({
    config: expect.objectContaining({
      values: expect.objectContaining({ script: 'print(1)', script_type: 'source' }),
    }),
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkflowStore.variables = originalVariables
    mockWorkflowStore.nodes = []
    mockWorkflowStore.edges = []
    mockWorkflowStore.pausedNodeId = null
    mockRunState.status = 'idle'
    mockRunState.sessionId = null
    mockRunState.isRunning = false
    mockCanRunBlockDraft.mockReturnValue(true)
    mockRepeatBlockDraft.mockResolvedValue(undefined)
    mockFetchProfiles.mockResolvedValue({
      data: [],
      pagination: { total: 0, page: 1, per_page: 100, total_pages: 1 },
    })
    mockFetchProfileTypeSchema.mockResolvedValue({ type: 'http', fields: [] })
  })

  async function openEditor(
    element: unknown,
    paramName: string,
    {
      adHocOffered = true,
      selectedEnvironment,
    }: { adHocOffered?: boolean; selectedEnvironment?: string | null } = {},
  ) {
    const { ElementConfigModal } = await import(
      '@/features/workbench/common/element-config'
    )
    const { AdHocActionsProvider } = await import(
      '@/features/workbench/common/canvas/adhoc-actions-context'
    )
    await act(async () => {
      render(
        <AdHocActionsProvider
          dispatch={mockAdHocDispatch}
          offered={adHocOffered}
          environment={
            selectedEnvironment === undefined
              ? undefined
              : { selected: selectedEnvironment, select: mockSelectEnvironment }
          }
        >
          <ElementConfigModal
            isOpen={true}
            onClose={vi.fn()}
            element={element as typeof mockElementData}
            onSave={vi.fn()}
          />
        </AdHocActionsProvider>
      )
    })
    await act(async () => {
      fireEvent.click(screen.getByTestId(`param-expand-${paramName}`))
    })
    return screen.getByTestId('value-editor-sheet')
  }

  function pauseHere() {
    mockRunState.status = 'paused'
    mockRunState.sessionId = 'session-py'
    mockRunState.isRunning = true
    mockWorkflowStore.pausedNodeId = 'node-py'
  }

  it('supplies Run to the script body of a python block', async () => {
    const sheet = await openEditor(pythonElement, 'script')

    expect(sheet).toHaveAttribute('data-has-on-run', 'true')
    expect(sheet).toHaveAttribute('data-run-allowed', 'true')
  })

  it('supplies no Run to a block that is not python', async () => {
    const sheet = await openEditor(mockElementData, 'url')

    expect(sheet).toHaveAttribute('data-has-on-run', 'false')
  })

  it('runs this block against the selected Environment without asking for one', async () => {
    await openEditor(pythonElement, 'script', { selectedEnvironment: 'env-2' })

    await act(async () => {
      fireEvent.click(screen.getByTestId('sheet-run'))
    })

    expect(screen.queryByTestId('env-selection-dialog')).not.toBeInTheDocument()
    expect(mockAdHocDispatch).toHaveBeenCalledExactlyOnceWith('run-current', 'node-py', {
      environmentId: 'env-2',
      blockDraft: EDITOR_RUN_DRAFT,
    })
    expect(mockSelectEnvironment).not.toHaveBeenCalled()
    expect(mockRepeatBlockDraft).not.toHaveBeenCalled()
  })

  it('asks for an Environment when none is selected', async () => {
    await openEditor(pythonElement, 'script', { selectedEnvironment: null })

    await act(async () => {
      fireEvent.click(screen.getByTestId('sheet-run'))
    })

    expect(screen.getByTestId('env-selection-dialog')).toBeInTheDocument()
    expect(mockAdHocDispatch).not.toHaveBeenCalled()
    expect(mockRepeatBlockDraft).not.toHaveBeenCalled()
  })

  it('runs only this block, as Run Current with the editor draft, once an Environment is chosen', async () => {
    await openEditor(pythonElement, 'script', { selectedEnvironment: null })

    await act(async () => {
      fireEvent.click(screen.getByTestId('sheet-run'))
    })
    await act(async () => {
      fireEvent.click(screen.getByTestId('env-dialog-env-1'))
    })
    await act(async () => {
      fireEvent.click(screen.getByTestId('env-dialog-confirm'))
    })

    expect(mockAdHocDispatch).toHaveBeenCalledExactlyOnceWith('run-current', 'node-py', {
      environmentId: 'env-1',
      blockDraft: EDITOR_RUN_DRAFT,
    })
    expect(mockSelectEnvironment).toHaveBeenCalledExactlyOnceWith('env-1')
    expect(mockRepeatBlockDraft).not.toHaveBeenCalled()
    expect(screen.queryByTestId('env-selection-dialog')).not.toBeInTheDocument()
  })

  it('asks for an Environment where the canvas offers no Environment selection', async () => {
    await openEditor(pythonElement, 'script')

    await act(async () => {
      fireEvent.click(screen.getByTestId('sheet-run'))
    })
    expect(screen.getByTestId('env-selection-dialog')).toBeInTheDocument()
    expect(mockAdHocDispatch).not.toHaveBeenCalled()

    await act(async () => {
      fireEvent.click(screen.getByTestId('env-dialog-env-1'))
    })
    await act(async () => {
      fireEvent.click(screen.getByTestId('env-dialog-confirm'))
    })

    expect(mockAdHocDispatch).toHaveBeenCalledExactlyOnceWith('run-current', 'node-py', {
      environmentId: 'env-1',
      blockDraft: EDITOR_RUN_DRAFT,
    })
  })

  it('disables Run where the canvas cannot start a run of this block', async () => {
    const sheet = await openEditor(pythonElement, 'script', { adHocOffered: false })

    expect(sheet).toHaveAttribute('data-run-allowed', 'false')
  })

  it('disables Run while a run is in progress', async () => {
    mockCanRunBlockDraft.mockReturnValue(false)
    const sheet = await openEditor(pythonElement, 'script')

    expect(sheet).toHaveAttribute('data-run-allowed', 'false')
  })

  it('names the block the editor belongs to', async () => {
    const sheet = await openEditor(pythonElement, 'script')

    expect(sheet).toHaveAttribute('data-node-id', 'node-py')
  })

  it("routes the interpreter's verdict to the block's syntax issues", async () => {
    await openEditor(pythonElement, 'script')

    await act(async () => {
      fireEvent.click(screen.getByTestId('sheet-syntax-issues'))
    })

    expect(mockWorkflowStore.setNodeSyntaxIssues).toHaveBeenCalledWith('node-py', [
      { line: 4, message: "'(' was never closed" },
    ])
  })

  it('repeats the paused block without asking for an Environment', async () => {
    pauseHere()

    await openEditor(pythonElement, 'script', { selectedEnvironment: null })

    await act(async () => {
      fireEvent.click(screen.getByTestId('sheet-run'))
    })

    expect(screen.queryByTestId('env-selection-dialog')).not.toBeInTheDocument()
    expect(mockRepeatBlockDraft).toHaveBeenCalledExactlyOnceWith('node-py', 'script', 'print(1)')
    expect(mockAdHocDispatch).not.toHaveBeenCalled()
  })

  it('allows the repeat while paused at this block even where no run can start', async () => {
    pauseHere()

    const sheet = await openEditor(pythonElement, 'script', { adHocOffered: false })

    expect(sheet).toHaveAttribute('data-run-allowed', 'true')
  })

  it('survives a repeat the workbench refuses', async () => {
    pauseHere()
    mockRepeatBlockDraft.mockRejectedValue(new Error('Session is not paused'))
    await openEditor(pythonElement, 'script')

    await act(async () => {
      fireEvent.click(screen.getByTestId('sheet-run'))
    })

    expect(mockRepeatBlockDraft).toHaveBeenCalled()
    expect(screen.getByTestId('value-editor-sheet')).toBeInTheDocument()
  })

  // PYRUN-21: a run in flight makes the sheet read-only, including every row of
  // it; the one thing that stays live is the already-open script editor of the
  // block the session is paused at.
  describe('the read-only sheet while a run holds the canvas', () => {
    async function renderFrozen() {
      const { CanvasReadOnlyProvider } = await import(
        '@/features/workbench/common/canvas/read-only-context'
      )
      const { ElementConfigModal } = await import(
        '@/features/workbench/common/element-config'
      )
      const { AdHocActionsProvider } = await import(
        '@/features/workbench/common/canvas/adhoc-actions-context'
      )
      await act(async () => {
        render(
          <CanvasReadOnlyProvider value={true}>
            <AdHocActionsProvider dispatch={mockAdHocDispatch} offered={true}>
              <ElementConfigModal
                isOpen={true}
                onClose={vi.fn()}
                element={pythonElement as unknown as typeof mockElementData}
                onSave={vi.fn()}
              />
            </AdHocActionsProvider>
          </CanvasReadOnlyProvider>
        )
      })
    }

    it('freezes the Script body row, as it freezes every row', async () => {
      pauseHere()
      await renderFrozen()

      expect(screen.getByRole('textbox', { name: 'Script' })).toBeDisabled()
    })

    it('freezes every other row of that same block', async () => {
      pauseHere()
      await renderFrozen()

      expect(screen.getByRole('textbox', { name: 'Interpreter' })).toBeDisabled()
      expect(screen.getByTestId('element-description-input')).toBeDisabled()
    })

    it('freezes the Script body row while the session is paused at another block', async () => {
      pauseHere()
      mockWorkflowStore.pausedNodeId = 'node-other'
      await renderFrozen()

      expect(screen.getByRole('textbox', { name: 'Script' })).toBeDisabled()
    })

    it('freezes the Script body row while the run is merely in flight', async () => {
      mockRunState.status = 'running'
      mockRunState.sessionId = 'session-py'
      mockRunState.isRunning = true
      await renderFrozen()

      expect(screen.getByRole('textbox', { name: 'Script' })).toBeDisabled()
    })
  })
})

type ElementConfigModalComponent =
  typeof import('@/features/workbench/common/element-config').ElementConfigModal
type CanvasSheetHook =
  typeof import('@/features/workbench/common/canvas/workflow-canvas/use-config-modal').useConfigModal

/** A plugin sheet whose Save runs through the canvas save handler, as the canvas hosts it. */
function CanvasHostedSheet({
  Modal,
  useSheet,
  element,
}: Readonly<{ Modal: ElementConfigModalComponent; useSheet: CanvasSheetHook; element: typeof mockElementData }>) {
  const { handleConfigSave } = useSheet(element.id)
  return <Modal isOpen={true} onClose={vi.fn()} element={element} onSave={handleConfigSave} />
}

describe('ElementConfigModal - Save warning before a plain variable turns secret (SECUI-12, REQ-4.5.20)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkflowStore.drillPath = []
    mockWorkflowStore.edges = []
    mockWorkflowStore.nodes = [{
      id: mockElementData.id,
      data: {
        label: mockElementData.name,
        elementType: mockElementData.elementType,
        version: mockElementData.version,
        config: {
          values: mockElementData.currentValues,
          outputBindings: mockElementData.outputBindings,
        },
      },
    }]
  })

  afterEach(() => {
    mockWorkflowStore.variables = originalVariables
    mockWorkflowStore.nodes = []
  })

  async function renderCanvasHostedSheet() {
    const { ReactFlowProvider } = await import('@xyflow/react')
    const { ElementConfigModal } = await import('@/features/workbench/common/element-config')
    const { useConfigModal } = await import(
      '@/features/workbench/common/canvas/workflow-canvas/use-config-modal'
    )
    render(
      <ReactFlowProvider>
        <CanvasHostedSheet Modal={ElementConfigModal} useSheet={useConfigModal} element={mockElementData} />
      </ReactFlowProvider>
    )
  }

  async function tickBodySecretAndSave() {
    const user = userEvent.setup({ delay: null })
    const secret = screen.getByTestId('output-secret-body')
    expect(secret).not.toBeChecked()
    await user.click(secret)
    expect(secret).toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Save' }))
  }

  it('Save with an existing plain variable bound to a Secret output opens the warning and saves nothing', async () => {
    mockWorkflowStore.variables = [
      { id: 'var-body', name: 'response_body', type: 'string', isSecret: false },
    ]
    await renderCanvasHostedSheet()

    await tickBodySecretAndSave()

    expect(mockWorkflowStore.requestSecretPromotion).toHaveBeenCalledTimes(1)
    expect(mockWorkflowStore.requestSecretPromotion).toHaveBeenCalledWith(
      ['response_body'],
      expect.any(Function),
    )
    expect(mockWorkflowStore.updateNode).not.toHaveBeenCalled()
    expect(mockWorkflowStore.updateVariable).not.toHaveBeenCalled()
    expect(mockWorkflowStore.closeConfigModal).not.toHaveBeenCalled()
    expect(screen.getByTestId('element-config-sheet')).toBeInTheDocument()
  })

  it('Save with an already-secret variable bound to a Secret output saves at once with no warning', async () => {
    mockWorkflowStore.variables = [
      { id: 'var-body', name: 'response_body', type: 'string', isSecret: true },
    ]
    await renderCanvasHostedSheet()

    await tickBodySecretAndSave()

    expect(mockWorkflowStore.requestSecretPromotion).not.toHaveBeenCalled()
    expect(mockWorkflowStore.updateNode).toHaveBeenCalledWith(mockElementData.id, expect.anything())
    expect(mockWorkflowStore.closeConfigModal).toHaveBeenCalledWith(mockElementData.id)
  })
})

/** A Function Block in the one Block window: chrome in the slots, rows from its definition, the shared Save gate (CANVAS-207, REQ-3.1.2.4). */
describe('ElementConfigModal - a Function Block (CANVAS-207)', () => {
  const FUNCTION_ID = '00000000-0000-0000-0000-0000000000f1'
  const INPUTS = [
    { name: 'region', type: 'string', required: false, default: 'eu-west', description: 'Target region' },
    { name: 'count', type: 'integer', required: true },
  ]
  const OUTPUTS = [{ name: 'result', type: 'string' }]
  const PINNED_INPUTS = [{ name: 'pinned_input', type: 'string', required: false }]

  function libraryVersion(version: string, inputs: unknown[]) {
    return {
      version,
      published_at: '2026-01-01',
      changelog: 'First release',
      details: 'Release details',
      description: '',
      tags: [],
      inputs,
      outputs: OUTPUTS,
    }
  }

  function localFunctionNode(config: Record<string, unknown> = { values: { count: 3 } }) {
    return {
      id: 'fn-node-1',
      data: {
        label: 'enrich_user',
        elementType: 'function',
        nodeType: 'function',
        functionLifecycle: 'local',
        localDefinition: {
          name: 'enrich_user',
          workflow: { nodes: [], edges: [] },
          inputs: INPUTS,
          outputs: OUTPUTS,
        },
        config,
      },
    }
  }

  function sharedFunctionNode(data: Record<string, unknown> = {}) {
    return {
      id: 'fn-node-1',
      data: {
        label: 'fetch_user',
        elementType: 'function',
        nodeType: 'function',
        functionLifecycle: 'shared',
        functionId: FUNCTION_ID,
        functionVersion: '1.0.0',
        originalLibraryName: 'fetch_user',
        resolvedInputs: PINNED_INPUTS,
        resolvedOutputs: OUTPUTS,
        config: { values: {} },
        ...data,
      },
    }
  }

  /** Opens the Block's window the way the canvas does for an open sheet. */
  async function openFunctionBlock(node: { id: string; data: Record<string, unknown> }): Promise<HTMLElement> {
    mockWorkflowStore.nodes = [node]
    const { ReactFlowProvider } = await import('@xyflow/react')
    const { ConfigSheetHost } = await import('@/features/workbench/common/canvas/workflow-canvas/canvas')
    render(
      <ReactFlowProvider>
        <ConfigSheetHost nodeId={node.id} cascadeIndex={0} />
      </ReactFlowProvider>
    )
    return screen.getByTestId('element-config-sheet')
  }

  function sheetSave(sheet: HTMLElement): HTMLElement {
    return within(sheet).getByRole('button', { name: 'Save' })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkflowStore.drillPath = []
    mockWorkflowStore.edges = []
    mockFunctionVersions.versions = []
    mockFunctionVersions.latest = ''
  })

  afterEach(() => {
    mockWorkflowStore.nodes = []
    mockFunctionVersions.versions = []
    mockFunctionVersions.latest = ''
  })

  describe('window and header', () => {
    it('opens a Local Function Block in the one Block window, titled with its name', async () => {
      const sheet = await openFunctionBlock(localFunctionNode())

      expect(screen.getAllByTestId(/-config-sheet$/)).toHaveLength(1)
      expect(within(sheet).getByRole('heading', { name: 'enrich_user - Edit Config' })).toBeInTheDocument()
    })

    it('titles a Function Block whose Name is emptied with the word Function', async () => {
      const sheet = await openFunctionBlock(localFunctionNode())

      fireEvent.change(within(sheet).getByTestId('function-name-input'), { target: { value: '' } })

      expect(within(sheet).getByRole('heading', { name: 'Function - Edit Config' })).toBeInTheDocument()
    })

    it('puts the Function Name field in the name slot in place of the Block name field', async () => {
      const sheet = await openFunctionBlock(localFunctionNode())

      expect(within(sheet).getByLabelText('Function name')).toHaveValue('enrich_user')
      expect(within(sheet).queryByTestId('element-name-input')).toBeNull()
    })
  })

  describe('rows from the Function definition', () => {
    it('draws one row per declared input and output of a Local Function Block', async () => {
      const sheet = await openFunctionBlock(localFunctionNode())

      expect(within(sheet).getAllByTestId(/^param-row-/).map((row) => row.dataset.testid)).toEqual([
        'param-row-region',
        'param-row-count',
      ])
      expect(within(sheet).getByTestId('output-row-result')).toBeInTheDocument()
    })

    it('draws the rows of a Shared Function Block in edit mode from its draft', async () => {
      mockFunctionVersions.versions = [libraryVersion('1.0.0', PINNED_INPUTS)]
      mockFunctionVersions.latest = '1.0.0'
      const sheet = await openFunctionBlock(
        sharedFunctionNode({
          editMode: true,
          upstreamLink: { functionId: FUNCTION_ID, sourceVersion: '1.0.0' },
          draft: {
            name: 'fetch_user',
            inputs: [{ name: 'draft_input', type: 'string', required: false }],
            outputs: OUTPUTS,
            workflow: { nodes: [], edges: [] },
          },
        })
      )

      expect(within(sheet).getByTestId('param-row-draft_input')).toBeInTheDocument()
      expect(within(sheet).queryByTestId('param-row-pinned_input')).toBeNull()
    })

    it('draws the rows of a Shared Function Block from its pinned version, never the latest one', async () => {
      mockFunctionVersions.versions = [
        libraryVersion('2.0.0', [{ name: 'latest_input', type: 'string', required: false }]),
        libraryVersion('1.0.0', PINNED_INPUTS),
      ]
      mockFunctionVersions.latest = '2.0.0'
      const sheet = await openFunctionBlock(sharedFunctionNode())

      expect(within(sheet).getByTestId('param-row-pinned_input')).toBeInTheDocument()
      expect(within(sheet).queryByTestId('param-row-latest_input')).toBeNull()
    })
  })

  describe('lifecycle chrome', () => {
    it('shows the library chrome of a Shared Function Block: From library link, version list, Changelog, Details and Profiles', async () => {
      mockFunctionVersions.versions = [libraryVersion('1.0.0', PINNED_INPUTS)]
      mockFunctionVersions.latest = '1.0.0'
      const sheet = await openFunctionBlock(sharedFunctionNode())

      expect(within(sheet).getByTestId('function-from-library-link')).toHaveTextContent(/^From library: fetch_user$/)
      expect(within(sheet).getByTestId('version-dropdown-trigger')).toBeInTheDocument()
      expect(within(sheet).queryByTestId('version-selector')).toBeNull()
      expect(within(sheet).getByTestId('function-changelog-button')).toBeInTheDocument()
      expect(within(sheet).getByTestId('function-details-button')).toBeInTheDocument()
      expect(within(sheet).getByRole('button', { name: 'Profiles' })).toBeInTheDocument()
      expect(within(sheet).getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
      expect(sheetSave(sheet)).toBeInTheDocument()
    })

    it('shows the missing-version banner when the pinned version is gone from the library', async () => {
      mockFunctionVersions.versions = [libraryVersion('1.0.0', PINNED_INPUTS)]
      mockFunctionVersions.latest = '1.0.0'
      const sheet = await openFunctionBlock(sharedFunctionNode({ functionVersion: '0.9.0', missingVersion: true }))

      expect(within(sheet).getByTestId('missing-version-banner')).toHaveTextContent(
        /^Version v0\.9\.0 is not available in the library\. Pick an available version from the dropdown\.$/
      )
    })

    it('gives a Local Function Block no library actions and no version list', async () => {
      const sheet = await openFunctionBlock(localFunctionNode())

      expect(within(sheet).queryByRole('button', { name: /changelog/i })).toBeNull()
      expect(within(sheet).queryByRole('button', { name: /details/i })).toBeNull()
      expect(within(sheet).queryByTestId('version-selector')).toBeNull()
      expect(within(sheet).queryByTestId('version-dropdown-trigger')).toBeNull()
      expect(within(sheet).getByRole('button', { name: 'Profiles' })).toBeInTheDocument()
      expect(within(sheet).getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
      expect(sheetSave(sheet)).toBeInTheDocument()
    })
  })

  describe('shared Save gate, change check and description cap', () => {
    it('keeps Save disabled until something changes', async () => {
      const sheet = await openFunctionBlock(localFunctionNode())
      expect(sheetSave(sheet)).toBeDisabled()

      changeDescription()

      expect(sheetSave(sheet)).toBeEnabled()
    })

    it('holds Save while a Required input has no value, and says the settings have errors', async () => {
      const sheet = await openFunctionBlock(localFunctionNode({ values: {} }))

      changeDescription()

      expect(within(sheet).getByTestId('param-error-count')).toHaveTextContent(/^count is required$/)
      expect(sheetSave(sheet)).toBeDisabled()
      expect(within(sheet).getByTestId('save-blocked-note')).toHaveTextContent(
        /^Save is disabled: the settings have errors$/
      )
    })

    it('caps the Description at 64 characters, like every Block', async () => {
      const sheet = await openFunctionBlock(localFunctionNode())

      expect(within(sheet).getByTestId('element-description-input')).toHaveAttribute('maxlength', '64')
    })

    it('saves through the shared Block save: the values the Block holds, and no input bindings', async () => {
      const sheet = await openFunctionBlock(localFunctionNode())

      changeDescription()
      fireEvent.click(sheetSave(sheet))

      expect(mockWorkflowStore.updateNode).toHaveBeenCalledTimes(1)
      const [nodeId, patch] = mockWorkflowStore.updateNode.mock.calls[0] as [
        string,
        { data: Record<string, unknown> & { config: Record<string, unknown> } },
      ]
      expect(nodeId).toBe('fn-node-1')
      expect(patch.data.description).toBe('changed')
      expect(patch.data.config.values).toEqual({ count: 3 })
      expect(patch.data).not.toHaveProperty('inputBindings')
      expect(mockWorkflowStore.closeConfigModal).toHaveBeenCalledWith('fn-node-1')
    })
  })
})

// An {x} entry left blank has no default to fall back on (FIELD-13).
describe('ElementConfigModal - a blank {x} entry names itself under its row and holds the Save', () => {
  const ENTRY_ELEMENT = {
    ...mockElementData,
    elementType: 'entry-probe',
    parameters: [
      { name: 'headers', label: 'Headers', type: 'map' as const, required: false },
      { name: 'arguments', label: 'Arguments', type: 'array' as const, required: false },
    ],
    outputs: [],
    outputBindings: {},
  }

  async function openEntries(currentValues: Record<string, unknown>, expressionFields: string[]) {
    const { ElementConfigModal } = await import('@/features/workbench/common/element-config')
    render(
      <ElementConfigModal
        isOpen={true}
        onClose={vi.fn()}
        element={{ ...ENTRY_ELEMENT, currentValues, expressionFields }}
        onSave={vi.fn()}
      />
    )
    return screen.getByTestId('element-config-sheet')
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("shows the map entry's message under the Headers row and keeps Save disabled with the note", async () => {
    const sheet = await openEntries({ headers: { 'X-Id': '', Accept: 'application/json' } }, ['headers.X-Id'])

    changeDescription()

    const row = within(sheet).getByTestId('param-row-headers')
    expect(within(row).getByTestId('param-error-headers')).toHaveTextContent(/^'X-Id' in 'headers' is required$/)
    expect(within(sheet).getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(within(sheet).getByTestId('save-blocked-note')).toHaveTextContent(
      /^Save is disabled: the settings have errors$/
    )
  })

  it("shows the list row's message, counted from 1, under the Arguments row and keeps Save disabled with the note", async () => {
    const sheet = await openEntries({ arguments: [{ value: 'a' }, { value: '  ' }] }, ['arguments.1.value'])

    changeDescription()

    const row = within(sheet).getByTestId('param-row-arguments')
    expect(within(row).getByTestId('param-error-arguments')).toHaveTextContent(/^Row 2 in 'arguments' is required$/)
    expect(within(sheet).getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(within(sheet).getByTestId('save-blocked-note')).toHaveTextContent(
      /^Save is disabled: the settings have errors$/
    )
  })

  it('shows no entry message and lets Save through once every {x} entry holds an expression', async () => {
    const sheet = await openEntries(
      { headers: { 'X-Id': 'trace_id()' }, arguments: [{ value: 'a' }, { value: 'run_id' }] },
      ['headers.X-Id', 'arguments.1.value'],
    )

    changeDescription()

    expect(within(sheet).queryByTestId('param-error-headers')).not.toBeInTheDocument()
    expect(within(sheet).queryByTestId('param-error-arguments')).not.toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: 'Save' })).toBeEnabled()
    expect(within(sheet).queryByTestId('save-blocked-note')).not.toBeInTheDocument()
  })
})
