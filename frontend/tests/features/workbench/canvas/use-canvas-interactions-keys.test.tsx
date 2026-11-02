/**
 * Selected-block keyboard actions on the canvas.
 *
 * Enter opens the selected block's config sheet - the same path a double-click
 * takes, including the raise-instead-of-duplicate rule and the ten-sheet cap.
 * Ctrl+Enter drills into a selected Function, Shared as well as Local. Both act
 * only on a single selection.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'

const mockScreenToFlowPosition = vi.fn((p: { x: number; y: number }) => p)

vi.mock('@xyflow/react', () => ({
  useReactFlow: () => ({ screenToFlowPosition: mockScreenToFlowPosition }),
  applyNodeChanges: (_c: unknown, nodes: unknown) => nodes,
  applyEdgeChanges: (_c: unknown, edges: unknown) => edges,
}))

interface MockNode {
  id: string
  type: string
  position: { x: number; y: number }
  data: Record<string, unknown>
}

interface MockState {
  nodes: MockNode[]
  edges: unknown[]
  variables: unknown[]
  drillPath: unknown[]
  selectedNodeIds: string[]
  selectedEdgeIds: string[]
  openConfigNodeIds: string[]
  setNodes: ReturnType<typeof vi.fn>
  setEdges: ReturnType<typeof vi.fn>
  setViewport: ReturnType<typeof vi.fn>
  setSelectedEdges: ReturnType<typeof vi.fn>
  setSelectedNodes: ReturnType<typeof vi.fn>
  clearSelection: ReturnType<typeof vi.fn>
  requestDeleteSelected: ReturnType<typeof vi.fn>
  disconnectSelected: ReturnType<typeof vi.fn>
  chainSelect: ReturnType<typeof vi.fn>
  openConfigModal: ReturnType<typeof vi.fn>
  startDragOperation: ReturnType<typeof vi.fn>
  endDragOperation: ReturnType<typeof vi.fn>
  pushSharedDrill: ReturnType<typeof vi.fn>
  requestDrill: ReturnType<typeof vi.fn>
  setDigInPending: ReturnType<typeof vi.fn>
  clearDigInPending: ReturnType<typeof vi.fn>
  digInPendingNodeId: string | null
}

const mockState: MockState = {
  nodes: [],
  edges: [],
  variables: [],
  drillPath: [],
  selectedNodeIds: [],
  selectedEdgeIds: [],
  openConfigNodeIds: [],
  setNodes: vi.fn(),
  setEdges: vi.fn(),
  setViewport: vi.fn(),
  setSelectedEdges: vi.fn(),
  setSelectedNodes: vi.fn(),
  clearSelection: vi.fn(),
  requestDeleteSelected: vi.fn(),
  disconnectSelected: vi.fn(),
  chainSelect: vi.fn(),
  openConfigModal: vi.fn(),
  startDragOperation: vi.fn(),
  endDragOperation: vi.fn(),
  pushSharedDrill: vi.fn(),
  // A dirty sheet defers the drill; here it runs straight through.
  requestDrill: vi.fn((run: () => void) => run()),
  setDigInPending: vi.fn(),
  clearDigInPending: vi.fn(),
  digInPendingNodeId: null,
}

vi.mock('@/features/workbench/stores/workflow-store', () => ({
  MAX_OPEN_CONFIG_SHEETS: 10,
  useWorkflowStore: Object.assign(
    (selector: (state: MockState) => unknown) => selector(mockState),
    { getState: () => mockState },
  ),
  useWorkflowStoreInstance: () => ({ getState: () => mockState }),
}))

const mockGetFunctionVersion = vi.fn(async () => ({
  definition: { workflow: { nodes: [], edges: [] }, inputs: [], outputs: [] },
}))
vi.mock('@/features/functions/api/functions-api', () => ({
  getFunction: vi.fn(),
  getFunctionVersion: (...args: unknown[]) => mockGetFunctionVersion(...(args as [])),
}))

vi.mock('@/features/functions/canvas/inner-workflow', () => ({
  walkActiveSubtree: () => ({ nodes: mockState.nodes, edges: mockState.edges }),
}))

const mockPushDrill = vi.fn()
vi.mock('@/features/functions/canvas/use-drill-handler', () => ({
  useDrillHandler: () => ({ pushDrill: mockPushDrill }),
}))

const mockRefocus = vi.fn((_id: string) => false)
vi.mock('@/features/workbench/common/canvas/config-sheet-focus', () => ({
  refocusOpenConfigSheet: (id: string) => mockRefocus(id),
}))

const mockToastError = vi.fn()

import { ToastContext } from '@/components/ui/toast'
import { useCanvasInteractions } from '@/features/workbench/common/canvas/workflow-canvas/use-canvas-interactions'

function block(id: string, overrides: Partial<MockNode> = {}): MockNode {
  return {
    id,
    type: 'workflowNode',
    position: { x: 0, y: 0 },
    data: { label: id, nodeType: 'plugin' },
    ...overrides,
  }
}

function fn(id: string, lifecycle: 'local' | 'shared'): MockNode {
  return block(id, {
    data: {
      label: id,
      nodeType: 'function',
      functionLifecycle: lifecycle,
      functionId: `lib-${id}`,
      functionVersion: '1.0.0',
    },
  })
}

function wrapper({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <ToastContext.Provider
      value={
        {
          error: mockToastError,
          success: vi.fn(),
          info: vi.fn(),
          warning: vi.fn(),
        } as never
      }
    >
      {children}
    </ToastContext.Provider>
  )
}

function setup(isExecuting = false) {
  const rendered = renderHook(
    () =>
      useCanvasInteractions({
        isExecuting,
        reactFlowWrapperRef: { current: document.createElement('div') },
      }),
    { wrapper },
  )
  return rendered.result
}

interface KeyOptions {
  ctrlKey?: boolean
  metaKey?: boolean
  tagName?: string
  isContentEditable?: boolean
}

function keyEvent(key: string, options: KeyOptions = {}) {
  return {
    key,
    ctrlKey: options.ctrlKey ?? false,
    metaKey: options.metaKey ?? false,
    target: {
      tagName: options.tagName ?? 'DIV',
      isContentEditable: options.isContentEditable ?? false,
    },
    preventDefault: vi.fn(),
  } as unknown as React.KeyboardEvent
}

beforeEach(() => {
  vi.clearAllMocks()
  mockRefocus.mockReturnValue(false)
  Object.assign(mockState, {
    nodes: [],
    edges: [],
    selectedNodeIds: [],
    selectedEdgeIds: [],
    openConfigNodeIds: [],
  })
})

describe('Enter opens the selected block config', () => {
  it('opens the config sheet for one selected block', () => {
    mockState.nodes = [block('a')]
    mockState.selectedNodeIds = ['a']
    const result = setup()

    result.current.handleKeyDown(keyEvent('Enter'))

    expect(mockState.openConfigModal).toHaveBeenCalledWith('a')
  })

  it('raises an already-open sheet instead of opening a second', () => {
    mockState.nodes = [block('a')]
    mockState.selectedNodeIds = ['a']
    mockRefocus.mockReturnValue(true)
    const result = setup()

    result.current.handleKeyDown(keyEvent('Enter'))

    expect(mockRefocus).toHaveBeenCalledWith('a')
    expect(mockState.openConfigModal).not.toHaveBeenCalled()
  })

  it('refuses past the ten-sheet cap with the existing toast', () => {
    mockState.nodes = [block('a')]
    mockState.selectedNodeIds = ['a']
    mockState.openConfigNodeIds = Array.from({ length: 10 }, (_, i) => `open-${i}`)
    const result = setup()

    result.current.handleKeyDown(keyEvent('Enter'))

    expect(mockToastError).toHaveBeenCalledWith('10 config sheets open. Close one to open another.')
    expect(mockState.openConfigModal).not.toHaveBeenCalled()
  })

  it('does nothing with no selection', () => {
    const result = setup()

    result.current.handleKeyDown(keyEvent('Enter'))

    expect(mockState.openConfigModal).not.toHaveBeenCalled()
  })

  it('does nothing with more than one block selected', () => {
    mockState.nodes = [block('a'), block('b')]
    mockState.selectedNodeIds = ['a', 'b']
    const result = setup()

    result.current.handleKeyDown(keyEvent('Enter'))

    expect(mockState.openConfigModal).not.toHaveBeenCalled()
  })

  it('does nothing for a Note block', () => {
    mockState.nodes = [block('n1', { type: 'noteNode' })]
    mockState.selectedNodeIds = ['n1']
    const result = setup()

    result.current.handleKeyDown(keyEvent('Enter'))

    expect(mockState.openConfigModal).not.toHaveBeenCalled()
  })

  it('does nothing for the Start block', () => {
    mockState.nodes = [block('start-node', { type: 'startNode' })]
    mockState.selectedNodeIds = ['start-node']
    const result = setup()

    result.current.handleKeyDown(keyEvent('Enter'))

    expect(mockState.openConfigModal).not.toHaveBeenCalled()
  })

  it('does nothing when the selected id is not on the active canvas', () => {
    mockState.nodes = [block('a')]
    mockState.selectedNodeIds = ['ghost']
    const result = setup()

    result.current.handleKeyDown(keyEvent('Enter'))

    expect(mockState.openConfigModal).not.toHaveBeenCalled()
  })

  it('does nothing while the canvas is executing', () => {
    mockState.nodes = [block('a')]
    mockState.selectedNodeIds = ['a']
    const result = setup(true)

    result.current.handleKeyDown(keyEvent('Enter'))

    expect(mockState.openConfigModal).not.toHaveBeenCalled()
  })

  it('does nothing while typing in a text field', () => {
    mockState.nodes = [block('a')]
    mockState.selectedNodeIds = ['a']
    const result = setup()

    result.current.handleKeyDown(keyEvent('Enter', { tagName: 'INPUT' }))

    expect(mockState.openConfigModal).not.toHaveBeenCalled()
  })

  it('does nothing while typing in a code editor', () => {
    mockState.nodes = [block('a')]
    mockState.selectedNodeIds = ['a']
    const result = setup()

    result.current.handleKeyDown(keyEvent('Enter', { isContentEditable: true }))

    expect(mockState.openConfigModal).not.toHaveBeenCalled()
  })
})

describe('Ctrl+Enter opens the selected Function', () => {
  it('drills into a Local Function', () => {
    mockState.nodes = [fn('f1', 'local')]
    mockState.selectedNodeIds = ['f1']
    const result = setup()

    result.current.handleKeyDown(keyEvent('Enter', { ctrlKey: true }))

    expect(mockPushDrill).toHaveBeenCalledWith('f1')
  })

  it('resolves a Shared Function body before drilling into it', async () => {
    mockState.nodes = [fn('f1', 'shared')]
    mockState.selectedNodeIds = ['f1']
    const result = setup()

    result.current.handleKeyDown(keyEvent('Enter', { ctrlKey: true }))

    // A Shared instance carries no body: it is fetched, then drilled into.
    // Drilling by id alone reaches nothing.
    expect(mockState.requestDrill).toHaveBeenCalled()
    expect(mockGetFunctionVersion).toHaveBeenCalledWith('lib-f1', '1.0.0')
    await vi.waitFor(() => expect(mockState.pushSharedDrill).toHaveBeenCalled())
    expect(mockPushDrill).not.toHaveBeenCalled()
  })

  it('drills on Cmd+Enter for macOS keyboards', () => {
    mockState.nodes = [fn('f1', 'local')]
    mockState.selectedNodeIds = ['f1']
    const result = setup()

    result.current.handleKeyDown(keyEvent('Enter', { metaKey: true }))

    expect(mockPushDrill).toHaveBeenCalledWith('f1')
  })

  it('does not open a config sheet as well', () => {
    mockState.nodes = [fn('f1', 'local')]
    mockState.selectedNodeIds = ['f1']
    const result = setup()

    result.current.handleKeyDown(keyEvent('Enter', { ctrlKey: true }))

    expect(mockState.openConfigModal).not.toHaveBeenCalled()
  })

  it('does nothing on a plain block', () => {
    mockState.nodes = [block('a')]
    mockState.selectedNodeIds = ['a']
    const result = setup()

    result.current.handleKeyDown(keyEvent('Enter', { ctrlKey: true }))

    expect(mockPushDrill).not.toHaveBeenCalled()
  })

  it('does nothing with more than one block selected', () => {
    mockState.nodes = [fn('f1', 'local'), fn('f2', 'shared')]
    mockState.selectedNodeIds = ['f1', 'f2']
    const result = setup()

    result.current.handleKeyDown(keyEvent('Enter', { ctrlKey: true }))

    expect(mockPushDrill).not.toHaveBeenCalled()
  })

  it('does nothing with no selection', () => {
    const result = setup()

    result.current.handleKeyDown(keyEvent('Enter', { ctrlKey: true }))

    expect(mockPushDrill).not.toHaveBeenCalled()
  })
})

describe('existing selection keys are untouched', () => {
  it('Delete still requests deletion of the selection', () => {
    mockState.nodes = [block('a')]
    mockState.selectedNodeIds = ['a']
    const result = setup()

    result.current.handleKeyDown(keyEvent('Delete'))

    expect(mockState.requestDeleteSelected).toHaveBeenCalled()
  })

  it('Backspace still disconnects the selection', () => {
    mockState.nodes = [block('a')]
    mockState.selectedNodeIds = ['a']
    const result = setup()

    result.current.handleKeyDown(keyEvent('Backspace'))

    expect(mockState.disconnectSelected).toHaveBeenCalled()
  })
})
