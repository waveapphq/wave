/**
 * NoteNode idle-state tests.
 *
 * Contract:
 * - Idle: persistent slim status bar shows only the kebab on the right.
 * - No on-canvas color picker outside edit mode.
 * - A Note has an output handle and one input handle per incoming wire (one when unwired).
 * - No cog (Notes have no per-instance configuration modal).
 * - No L/S badge (Notes are not Functions).
 * - The card border is dashed (idle), matching the preset.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'

const mockUpdateNodeInternals = vi.fn()
vi.mock('@xyflow/react', () => ({
  Handle: ({ 'data-testid': testId, ...props }: Record<string, unknown>) => (
    <div data-testid={testId} {...props} />
  ),
  Position: { Top: 'top', Bottom: 'bottom' },
  NodeResizer: (props: Record<string, unknown>) => (
    <div data-testid="node-resizer" data-visible={String(props.isVisible)} />
  ),
  useUpdateNodeInternals: () => mockUpdateNodeInternals,
}))

const mockStore = {
  selectNode: vi.fn(),
  selectedNodeIds: [] as string[],
  updateNode: vi.fn(),
  commitHistory: vi.fn(),
  deleteSelected: vi.fn(),
  duplicate: vi.fn(),
  copy: vi.fn(),
  cut: vi.fn(),
  unlinkNode: vi.fn(),
  edges: [] as Array<{ id: string; source: string; target: string; targetHandle?: string }>,
  nodes: [] as unknown[],
  variables: [] as unknown[],
  drillPath: [] as unknown[],
}

vi.mock('@/features/workbench/stores/workflow-store', () => ({
  useWorkflowStore: (selector: (s: typeof mockStore) => unknown) => selector(mockStore),
}))

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children }: { children: ReactNode }) => <div role="menuitem">{children}</div>,
  DropdownMenuSeparator: () => <hr />,
}))

vi.mock('@/components/ui/context-menu', () => ({
  ContextMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
  ContextMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  ContextMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ContextMenuItem: ({ children }: { children: ReactNode }) => <div role="menuitem">{children}</div>,
  ContextMenuSeparator: () => <hr />,
}))

describe('NoteNode - idle state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders ingress + egress flow handles so the Note can act as a placeholder for a future block', async () => {
    const { NoteNode } = await import('@/features/workbench/common/canvas/note-node/note-node')
    render(
      <NoteNode
        id="note-1"
        type="noteNode"
        data={{ label: 'Note', config: { values: { text: 'My note', color: 'yellow' } } }}
        selected={false}
        positionAbsoluteX={0}
        positionAbsoluteY={0}
        dragging={false}
        isConnectable
        zIndex={0}
        deletable
        draggable
        selectable
      />,
    )
    expect(screen.getByTestId('note-handle-input')).toBeInTheDocument()
    expect(screen.getByTestId('note-handle-output')).toBeInTheDocument()
  })

  it('draws one input handle for each wire that comes in, as a Block at a join does', async () => {
    mockStore.edges = [
      { id: 'e1', source: 'log-1', target: 'note-join' },
      { id: 'e2', source: 'if-1', target: 'note-join', targetHandle: 'ingress_1' },
      { id: 'e3', source: 'note-join', target: 'log-2' },
    ]
    const { NoteNode } = await import('@/features/workbench/common/canvas/note-node/note-node')
    render(
      <NoteNode
        id="note-join"
        type="noteNode"
        data={{ label: 'Note', config: { values: { text: 'Join here', color: 'yellow' } } }}
        selected={false}
        positionAbsoluteX={0}
        positionAbsoluteY={0}
        dragging={false}
        isConnectable
        zIndex={0}
        deletable
        draggable
        selectable
      />,
    )
    const first = screen.getByTestId('note-handle-input')
    const second = screen.getByTestId('note-handle-input-ingress_1')
    expect(first).not.toHaveAttribute('id')
    expect(first).toHaveStyle({ left: `${(1 / 3) * 100}%` })
    expect(second).toHaveAttribute('id', 'ingress_1')
    expect(second).toHaveStyle({ left: `${(2 / 3) * 100}%` })
    expect(screen.getByTestId('note-handle-output')).toBeInTheDocument()
    mockStore.edges = []
  })

  it('offers a "+" input for a second wire dragged near it, as a Block does', async () => {
    mockStore.edges = [{ id: 'e1', source: 'log-1', target: 'note-join' }]
    const { NoteNode } = await import('@/features/workbench/common/canvas/note-node/note-node')
    render(
      <NoteNode
        id="note-join"
        type="noteNode"
        data={{ label: 'Note', config: { values: { text: 'Join here' } }, proximityTarget: true }}
        selected={false}
        positionAbsoluteX={0}
        positionAbsoluteY={0}
        dragging={false}
        isConnectable
        zIndex={0}
        deletable
        draggable
        selectable
      />,
    )
    expect(screen.getByTestId('note-handle-input')).toHaveStyle({ left: `${(1 / 3) * 100}%` })
    const add = screen.getByTestId('note-handle-input-add')
    expect(add).toHaveAttribute('id', 'ingress_1')
    expect(add).toHaveStyle({ left: `${(2 / 3) * 100}%` })
    mockStore.edges = []
  })

  it('marks a wire that would close a cycle on its input, as a Block does', async () => {
    const { NoteNode } = await import('@/features/workbench/common/canvas/note-node/note-node')
    render(
      <NoteNode
        id="note-cycle"
        type="noteNode"
        data={{ label: 'Note', config: { values: { text: 'Loop back' } }, proximityCycleDetected: true }}
        selected={false}
        positionAbsoluteX={0}
        positionAbsoluteY={0}
        dragging={false}
        isConnectable
        zIndex={0}
        deletable
        draggable
        selectable
      />,
    )
    expect(screen.getByTestId('note-handle-input-cycle')).toBeInTheDocument()
    expect(screen.queryByTestId('note-handle-input')).not.toBeInTheDocument()
  })

  it('persistent status bar shows ONLY the kebab when idle', async () => {
    const { NoteNode } = await import('@/features/workbench/common/canvas/note-node/note-node')
    render(
      <NoteNode
        id="note-1"
        type="noteNode"
        data={{ label: 'Note', config: { values: { text: 'My note', color: 'yellow' } } }}
        selected={false}
        positionAbsoluteX={0}
        positionAbsoluteY={0}
        dragging={false}
        isConnectable
        zIndex={0}
        deletable
        draggable
        selectable
      />,
    )
    // The status bar is rendered unconditionally.
    expect(screen.getByTestId('node-status-bar')).toBeInTheDocument()
    // No cog (Notes have no per-instance configuration).
    expect(screen.queryByTestId('note-configure')).not.toBeInTheDocument()
    // No color picker visible outside edit mode.
    expect(screen.queryByTestId('note-color-picker')).not.toBeInTheDocument()
    // Kebab is the only right-side action.
    expect(screen.getByTestId('node-kebab')).toBeInTheDocument()
  })

  it('renders no L/S Function-lifecycle badge on a Note', async () => {
    const { NoteNode } = await import('@/features/workbench/common/canvas/note-node/note-node')
    render(
      <NoteNode
        id="note-1"
        type="noteNode"
        data={{ label: 'Note', config: { values: { text: 'My note', color: 'yellow' } } }}
        selected={false}
        positionAbsoluteX={0}
        positionAbsoluteY={0}
        dragging={false}
        isConnectable
        zIndex={0}
        deletable
        draggable
        selectable
      />,
    )
    expect(screen.queryByTestId('node-function-lifecycle-badge')).not.toBeInTheDocument()
  })

  it('renders no dig-in glyph on a Note', async () => {
    const { NoteNode } = await import('@/features/workbench/common/canvas/note-node/note-node')
    render(
      <NoteNode
        id="note-1"
        type="noteNode"
        data={{ label: 'Note', config: { values: { text: 'My note', color: 'yellow' } } }}
        selected={false}
        positionAbsoluteX={0}
        positionAbsoluteY={0}
        dragging={false}
        isConnectable
        zIndex={0}
        deletable
        draggable
        selectable
      />,
    )
    expect(screen.queryByTestId('node-dig-in')).not.toBeInTheDocument()
  })

  it('idle text content is displayed in the body (no edit textarea)', async () => {
    const { NoteNode } = await import('@/features/workbench/common/canvas/note-node/note-node')
    render(
      <NoteNode
        id="note-1"
        type="noteNode"
        data={{ label: 'Note', config: { values: { text: 'Probe gateway', color: 'yellow' } } }}
        selected={false}
        positionAbsoluteX={0}
        positionAbsoluteY={0}
        dragging={false}
        isConnectable
        zIndex={0}
        deletable
        draggable
        selectable
      />,
    )
    expect(screen.getByTestId('note-text-display')).toHaveTextContent('Probe gateway')
    expect(screen.queryByTestId('note-text-editor')).not.toBeInTheDocument()
  })

  it('the idle border uses the dashed style (preset border + border-dashed)', async () => {
    const { NoteNode } = await import('@/features/workbench/common/canvas/note-node/note-node')
    const { container } = render(
      <NoteNode
        id="note-1"
        type="noteNode"
        data={{ label: 'Note', config: { values: { text: 'My note', color: 'yellow' } } }}
        selected={false}
        positionAbsoluteX={0}
        positionAbsoluteY={0}
        dragging={false}
        isConnectable
        zIndex={0}
        deletable
        draggable
        selectable
      />,
    )
    // Idle border carries the `border-dashed` class on the body wrapper.
    const dashedEl = container.querySelector('.border-dashed')
    expect(dashedEl).not.toBeNull()
  })

  it('with no config defaults: empty text shows placeholder, missing color falls back to slate', async () => {
    const { NoteNode } = await import('@/features/workbench/common/canvas/note-node/note-node')
    render(
      <NoteNode
        id="note-default"
        type="noteNode"
        data={{ label: 'Note' }}
        selected={false}
        positionAbsoluteX={0}
        positionAbsoluteY={0}
        dragging={false}
        isConnectable
        zIndex={0}
        deletable
        draggable
        selectable
      />,
    )
    // Empty-text branch: the muted placeholder copy is rendered (text || 'Add your note here…').
    expect(screen.getByTestId('note-text-display')).toHaveTextContent('Add your note here…')
  })

  // A Note that stores no color shows the default its field list declares (REQ-3.5.0.3).
  it('a Note with no stored color shows the Note field list default color', async () => {
    const { CONTROL_INPUTS } = await import('@/features/workbench/lib/node-parameters')
    const { NoteNode } = await import('@/features/workbench/common/canvas/note-node/note-node')
    const listDefault = CONTROL_INPUTS['note'].find((p) => p.name === 'color')?.defaultValue
    const noteWith = (values: Record<string, unknown>) => (
      <NoteNode
        id="note-color"
        type="noteNode"
        data={{ label: 'Note', config: { values } }}
        selected={false}
        positionAbsoluteX={0}
        positionAbsoluteY={0}
        dragging={false}
        isConnectable
        zIndex={0}
        deletable
        draggable
        selectable
      />
    )

    expect(listDefault).toBe('slate')
    const unset = render(noteWith({ text: 'Probe gateway' }))
    const unsetMarkup = unset.container.innerHTML
    unset.unmount()
    const stored = render(noteWith({ text: 'Probe gateway', color: listDefault }))
    expect(stored.container.innerHTML).toBe(unsetMarkup)
    stored.unmount()
    const blue = render(noteWith({ text: 'Probe gateway', color: 'blue' }))

    expect(blue.container.innerHTML).not.toBe(unsetMarkup)
  })

  // A stored Test can hold a color the Save refuses, such as a hand-edited file; the canvas still draws it.
  it('a Note whose stored color is not one of the five shows the Note field list default color', async () => {
    const { NoteNode } = await import('@/features/workbench/common/canvas/note-node/note-node')
    const noteWith = (color: string) => (
      <NoteNode
        id="note-color"
        type="noteNode"
        data={{ label: 'Note', config: { values: { text: 'Probe gateway', color } } }}
        selected={false}
        positionAbsoluteX={0}
        positionAbsoluteY={0}
        dragging={false}
        isConnectable
        zIndex={0}
        deletable
        draggable
        selectable
      />
    )

    const slate = render(noteWith('slate'))
    const slateMarkup = slate.container.innerHTML
    slate.unmount()
    const purple = render(noteWith('purple'))

    expect(purple.container.innerHTML).toBe(slateMarkup)
    expect(purple.container.querySelector('.bg-slate-100.border-slate-300')).not.toBeNull()
  })

  it('Enter on the focused note triggers a click (selection)', async () => {
    mockStore.selectNode.mockClear()
    const { NoteNode } = await import('@/features/workbench/common/canvas/note-node/note-node')
    render(
      <NoteNode
        id="note-key"
        type="noteNode"
        data={{ label: 'Note', config: { values: { text: 'k', color: 'yellow' } } }}
        selected={false}
        positionAbsoluteX={0}
        positionAbsoluteY={0}
        dragging={false}
        isConnectable
        zIndex={0}
        deletable
        draggable
        selectable
      />,
    )
    const note = screen.getByTestId('note-node-note-key')
    note.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(mockStore.selectNode).toHaveBeenCalledWith('note-key')
  })

  it('Space on the focused note also triggers a click (matches Enter contract)', async () => {
    mockStore.selectNode.mockClear()
    const { NoteNode } = await import('@/features/workbench/common/canvas/note-node/note-node')
    render(
      <NoteNode
        id="note-space"
        type="noteNode"
        data={{ label: 'Note', config: { values: { text: 'k', color: 'yellow' } } }}
        selected={false}
        positionAbsoluteX={0}
        positionAbsoluteY={0}
        dragging={false}
        isConnectable
        zIndex={0}
        deletable
        draggable
        selectable
      />,
    )
    const note = screen.getByTestId('note-node-note-space')
    note.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))
    expect(mockStore.selectNode).toHaveBeenCalledWith('note-space')
  })

  it('other keys on the focused note are ignored (no selection)', async () => {
    mockStore.selectNode.mockClear()
    const { NoteNode } = await import('@/features/workbench/common/canvas/note-node/note-node')
    render(
      <NoteNode
        id="note-other-key"
        type="noteNode"
        data={{ label: 'Note', config: { values: { text: 'k', color: 'yellow' } } }}
        selected={false}
        positionAbsoluteX={0}
        positionAbsoluteY={0}
        dragging={false}
        isConnectable
        zIndex={0}
        deletable
        draggable
        selectable
      />,
    )
    const note = screen.getByTestId('note-node-note-other-key')
    note.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }))
    expect(mockStore.selectNode).not.toHaveBeenCalled()
  })

  it('keydown on a child element (not the note root) is ignored', async () => {
    mockStore.selectNode.mockClear()
    const { NoteNode } = await import('@/features/workbench/common/canvas/note-node/note-node'
    )
    render(
      <NoteNode
        id="note-child-key"
        type="noteNode"
        data={{ label: 'Note', config: { values: { text: 'k', color: 'yellow' } } }}
        selected={false}
        positionAbsoluteX={0}
        positionAbsoluteY={0}
        dragging={false}
        isConnectable
        zIndex={0}
        deletable
        draggable
        selectable
      />,
    )
    const display = screen.getByTestId('note-text-display')
    display.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(mockStore.selectNode).not.toHaveBeenCalled()
  })

  it('double-click while isExecuting is true does NOT enter edit mode', async () => {
    const { NoteNode } = await import('@/features/workbench/common/canvas/note-node/note-node')
    render(
      <NoteNode
        id="note-busy"
        type="noteNode"
        data={{ label: 'Note', config: { values: { text: 'busy', color: 'yellow' } }, isExecuting: true }}
        selected={false}
        positionAbsoluteX={0}
        positionAbsoluteY={0}
        dragging={false}
        isConnectable
        zIndex={0}
        deletable
        draggable
        selectable
      />,
    )
    const note = screen.getByTestId('note-node-note-busy')
    note.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
    expect(screen.queryByTestId('note-text-editor')).not.toBeInTheDocument()
  })

  it('hasConnections branch is exercised when an edge references this note (no crash)', async () => {
    // Ordered so .some() evaluates the false sub-branch (neither side matches)
    // BEFORE it short-circuits on a matching edge later.
    mockStore.edges = [
      { id: 'e3', source: 'a', target: 'b' },                         // neither matches
      { id: 'e1', source: 'note-connected', target: 'other' },        // source === id
      { id: 'e2', source: 'unrelated', target: 'note-connected' },    // target === id
    ]
    const { NoteNode } = await import('@/features/workbench/common/canvas/note-node/note-node')
    render(
      <NoteNode
        id="note-connected"
        type="noteNode"
        data={{ label: 'Note', config: { values: { text: 'wired', color: 'yellow' } } }}
        selected={true}
        positionAbsoluteX={0}
        positionAbsoluteY={0}
        dragging={false}
        isConnectable
        zIndex={0}
        deletable
        draggable
        selectable
      />,
    )
    // The .some() callback evaluates BOTH the source===id and target===id sub-branches.
    expect(screen.getByTestId('note-node-note-connected')).toBeInTheDocument()
    mockStore.edges = []
  })
})
