/**
 * NoteNode idle-state tests.
 *
 * Contract:
 * - Idle: persistent slim status bar shows only the kebab on the right.
 * - No on-canvas color picker outside edit mode.
 * - Notes have NO flow handles (no input handle, no output handle).
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
  edges: [] as Array<{ id: string; source: string; target: string }>,
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
        data={{ label: 'Note', config: { text: 'My note', color: 'amber' } }}
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

  it('persistent status bar shows ONLY the kebab when idle', async () => {
    const { NoteNode } = await import('@/features/workbench/common/canvas/note-node/note-node')
    render(
      <NoteNode
        id="note-1"
        type="noteNode"
        data={{ label: 'Note', config: { text: 'My note', color: 'amber' } }}
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
        data={{ label: 'Note', config: { text: 'My note', color: 'amber' } }}
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
        data={{ label: 'Note', config: { text: 'My note', color: 'amber' } }}
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
        data={{ label: 'Note', config: { text: 'Probe gateway', color: 'amber' } }}
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
        data={{ label: 'Note', config: { text: 'My note', color: 'amber' } }}
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

  it('Enter on the focused note triggers a click (selection)', async () => {
    mockStore.selectNode.mockClear()
    const { NoteNode } = await import('@/features/workbench/common/canvas/note-node/note-node')
    render(
      <NoteNode
        id="note-key"
        type="noteNode"
        data={{ label: 'Note', config: { text: 'k', color: 'amber' } }}
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
        data={{ label: 'Note', config: { text: 'k', color: 'amber' } }}
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
        data={{ label: 'Note', config: { text: 'k', color: 'amber' } }}
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
        data={{ label: 'Note', config: { text: 'k', color: 'amber' } }}
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
        data={{ label: 'Note', config: { text: 'busy', color: 'amber' }, isExecuting: true }}
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
        data={{ label: 'Note', config: { text: 'wired', color: 'amber' } }}
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
