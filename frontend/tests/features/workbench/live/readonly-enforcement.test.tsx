/**
 * Read-only enforcement in a drilled-in Shared (library-View or in-Test inspect)
 * scope (REQ-3.1.2.2).
 *
 * Two layers must block structural edits when the active drill scope is
 * read-only (a published Shared the user has NOT entered edit mode on):
 *
 *   1. LiveVariableManager propagates the read-only scope (from useReadOnlyCanvas)
 *      into VariableManagerContent so the +Add affordance is hidden - even when
 *      the caller passes readOnly=false.
 *   2. useVariableManagement guards handleCreateParameter / handleAddVariableClick
 *      so they no-op in a read-only scope (defense in depth).
 *
 * LiveVariableManager passes the drilled-Shared scope flag to content, and the
 * create handlers check the scope.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, renderHook, act } from '@testing-library/react'
import { useVariableManagement } from '@/features/workbench/live/use-variable-management'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'

// Read-only scope: both signals report true so the guard finds it whichever it reads.
vi.mock('@/features/workbench/common/canvas/use-readonly-canvas', () => ({
  useReadOnlyCanvas: () => true,
  useIsDrilledIntoShared: () => true,
  useDrilledSharedInfo: () => null,
}))

// Capture the props VariableManagerContent receives from LiveVariableManager.
let capturedContentProps: Record<string, unknown> = {}
vi.mock('@/features/workbench/common/variables/variable-manager-content/content', () => ({
  VariableManagerContent: (props: Record<string, unknown>) => {
    capturedContentProps = props
    return <div data-testid="variable-manager-content-mock" />
  },
}))
vi.mock('@/features/workbench/common/variables/variable-manager-panel', () => ({
  VariableManagerPanel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

// use-variable-management collaborators.
vi.mock('@/features/workbench/stores/workflow-store')
vi.mock('@/features/workbench/hooks/use-variable-updates', () => ({
  useVariableUpdates: () => ({ values: new Map(), recentlyChangedPaths: new Set() }),
}))
vi.mock('@/features/functions/canvas/use-function-scope', () => ({
  useFunctionScope: () => ({ insideFunction: true }),
}))
vi.mock('@/components/ui/toast', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/ui/toast')>()),
  useToast: () => ({ error: vi.fn() }),
}))

import { LiveVariableManager } from '@/features/workbench/live/variable-manager'

// ---------------------------------------------------------------------------
// Store mock for the hook (read-only scope drilled into a Shared)
// ---------------------------------------------------------------------------
function makeStore() {
  return {
    nodes: [],
    variables: [],
    namespaceVariables: { system: [], suite: [], regression: [] },
    drillPath: [{ nodeId: 'shared-root', label: 'Greet' }],
    addVariable: vi.fn(),
    updateVariable: vi.fn(),
    removeVariable: vi.fn(),
    setNodes: vi.fn(),
    renameVariable: vi.fn().mockReturnValue({ success: true }),
    transaction: vi.fn((cb: () => void) => cb()),
    getActiveVariables: vi.fn().mockReturnValue([]),
    getSavedVariables: vi.fn().mockReturnValue([]),
    getSavedNodes: vi.fn().mockReturnValue([]),
    addInputParam: vi.fn(),
    addOutputParam: vi.fn(),
    removeInputParam: vi.fn(),
    removeOutputParam: vi.fn(),
    updateInputParam: vi.fn().mockReturnValue({ success: true }),
    updateOutputParam: vi.fn().mockReturnValue({ success: true }),
    // Read to gate structural edits.
    isCurrentScopeReadOnly: vi.fn().mockReturnValue(true),
  }
}

let store: ReturnType<typeof makeStore>

function setupStore() {
  store = makeStore()
  vi.mocked(useWorkflowStore).mockImplementation((selector: unknown) =>
    (selector as (s: typeof store) => unknown)(store),
  )
  ;(useWorkflowStore as unknown as { getState: () => typeof store }).getState = () => store
}

const noopRegister = vi.fn()
function renderVarManagement() {
  return renderHook(() => useVariableManagement(null, noopRegister))
}

beforeEach(() => {
  vi.clearAllMocks()
  capturedContentProps = {}
  setupStore()
})

// ---------------------------------------------------------------------------
// 1. Affordance: LiveVariableManager forwards the read-only scope to content
// ---------------------------------------------------------------------------
describe('read-only enforcement - affordance propagation', () => {
  it('forces readOnly=true into VariableManagerContent in a read-only scope', () => {
    // The caller passes readOnly=false; the drilled-Shared scope must still
    // render the panel read-only (hiding the +Add affordance).
    const props = {
      collapsed: false,
      onCollapsedChange: vi.fn(),
      readOnly: false,
    } as unknown as Parameters<typeof LiveVariableManager>[0]

    render(<LiveVariableManager {...props} />)

    expect(capturedContentProps.readOnly).toBe(true)
  })

  it('keeps the Current edit handler in a read-only scope (REQ-3.1.2.10)', () => {
    const onVariableCurrentEdit = vi.fn()
    const props = {
      collapsed: false,
      onCollapsedChange: vi.fn(),
      readOnly: false,
      onVariableCurrentEdit,
    } as unknown as Parameters<typeof LiveVariableManager>[0]

    render(<LiveVariableManager {...props} />)

    expect(capturedContentProps.onVariableCurrentEdit).toBe(onVariableCurrentEdit)
  })
})

// ---------------------------------------------------------------------------
// 2. Logic: create handlers no-op in a read-only scope
// ---------------------------------------------------------------------------
describe('read-only enforcement - create handlers no-op', () => {
  it('does not add an input parameter from handleCreateParameter', () => {
    const { result } = renderVarManagement()

    let outcome: { success: boolean; error?: string } | undefined
    act(() => {
      outcome = result.current.handleCreateParameter('input', {
        name: 'new_input',
        type: 'string',
        value: '',
        required: false,
      })
    })

    expect(store.addInputParam).not.toHaveBeenCalled()
    expect(outcome?.success).toBe(false)
  })

  it('does not add an output parameter from handleCreateParameter', () => {
    const { result } = renderVarManagement()

    act(() => {
      result.current.handleCreateParameter('output', {
        name: 'new_output',
        type: 'string',
        value: '',
      })
    })

    expect(store.addOutputParam).not.toHaveBeenCalled()
  })
})
