/**
 * NoteNode action handler tests.
 *
 * Covers the handleAction switch (duplicate, copy, cut, unlink, delete) and
 * handleColorChange in note-node.tsx by dispatching menu-item clicks through
 * a Dropdown mock that wires onSelect into the onClick handler.
 *
 * Also covers ctrl/meta-click for additive selection and the contextmenu
 * handler when the note is not selected.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
  selectedNodeIds: ['note-1'] as string[],
  updateNode: vi.fn(),
  commitHistory: vi.fn(),
  deleteSelected: vi.fn(),
  duplicate: vi.fn(),
  copy: vi.fn(),
  cut: vi.fn(),
  unlinkNode: vi.fn(),
  edges: [{ id: 'e1', source: 'note-1', target: 'other' }] as Array<{ id: string; source: string; target: string }>,
}

vi.mock('@/features/workbench/stores/workflow-store', () => ({
  useWorkflowStore: (selector: (s: typeof mockStore) => unknown) => selector(mockStore),
}))

// Forward onSelect to onClick so clicking the menu item in jsdom fires the handler.
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onSelect, ...rest }: { children: ReactNode; onSelect?: (e: Event) => void } & Record<string, unknown>) => (
    <div role="menuitem" onClick={(e) => onSelect?.(e as unknown as Event)} {...rest}>{children}</div>
  ),
  DropdownMenuSeparator: () => <hr />,
}))

vi.mock('@/components/ui/context-menu', () => ({
  ContextMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
  ContextMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  ContextMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ContextMenuItem: ({ children, onSelect, ...rest }: { children: ReactNode; onSelect?: (e: Event) => void } & Record<string, unknown>) => (
    <div role="menuitem" onClick={(e) => onSelect?.(e as unknown as Event)} {...rest}>{children}</div>
  ),
  ContextMenuSeparator: () => <hr />,
}))

async function mountNote(opts: { selected?: boolean; text?: string } = {}) {
  const { NoteNode } = await import('@/features/workbench/common/canvas/note-node/note-node')
  return render(
    <NoteNode
      id="note-1"
      type="noteNode"
      data={{ label: 'Note', config: { text: opts.text ?? 'My note', color: 'amber' } }}
      selected={opts.selected ?? true}
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
}

describe('NoteNode - kebab actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('Duplicate selects the node then triggers duplicate()', async () => {
    const user = userEvent.setup()
    await mountNote()
    await user.click(screen.getByTestId('note-action-duplicate'))
    expect(mockStore.selectNode).toHaveBeenCalledWith('note-1')
    expect(mockStore.duplicate).toHaveBeenCalledTimes(1)
  })

  it('Copy selects the node then triggers copy()', async () => {
    const user = userEvent.setup()
    await mountNote()
    await user.click(screen.getByTestId('note-action-copy'))
    expect(mockStore.selectNode).toHaveBeenCalledWith('note-1')
    expect(mockStore.copy).toHaveBeenCalledTimes(1)
  })

  it('Cut selects the node then triggers cut()', async () => {
    const user = userEvent.setup()
    await mountNote()
    await user.click(screen.getByTestId('note-action-cut'))
    expect(mockStore.selectNode).toHaveBeenCalledWith('note-1')
    expect(mockStore.cut).toHaveBeenCalledTimes(1)
  })

  it('Unlink calls unlinkNode(id)', async () => {
    const user = userEvent.setup()
    await mountNote()
    await user.click(screen.getByTestId('note-action-unlink'))
    expect(mockStore.unlinkNode).toHaveBeenCalledWith('note-1')
  })

  it('Delete selects then calls deleteSelected() on next animation frame', async () => {
    const rafs: FrameRequestCallback[] = []
    const rafSpy = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
      rafs.push(cb)
      return rafs.length
    })
    const user = userEvent.setup()
    await mountNote()
    await user.click(screen.getByTestId('note-action-delete'))
    expect(mockStore.selectNode).toHaveBeenCalledWith('note-1')
    // deleteSelected runs inside the rAF callback.
    act(() => { rafs.forEach((cb) => cb(0)) })
    expect(mockStore.deleteSelected).toHaveBeenCalledTimes(1)
    rafSpy.mockRestore()
  })
})

describe('NoteNode - color change', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('handleColorChange writes through updateNode + commits history', async () => {
    const user = userEvent.setup()
    await mountNote({ selected: true })
    // Enter edit mode to show the color picker.
    fireEvent.doubleClick(screen.getByTestId('note-node-note-1'))

    // The color swatches are buttons with data-testid="note-color-<name>".
    const blueSwatch = await screen.findByTestId('note-color-blue')
    await user.click(blueSwatch)

    expect(mockStore.updateNode).toHaveBeenCalledTimes(1)
    const [updatedId, payload] = mockStore.updateNode.mock.calls[0]
    expect(updatedId).toBe('note-1')
    expect(payload.data.config.color).toBe('blue')
    expect(mockStore.commitHistory).toHaveBeenCalledWith('Change note color')
  })
})

describe('NoteNode - selection + context menu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('ctrl-click adds the note to the existing selection', async () => {
    await mountNote({ selected: false })
    const note = screen.getByTestId('note-node-note-1')
    fireEvent.click(note, { ctrlKey: true })
    expect(mockStore.selectNode).toHaveBeenCalledWith('note-1', { addToSelection: true })
  })

  it('contextmenu on an unselected note selects it (so the menu acts on it)', async () => {
    await mountNote({ selected: false })
    const note = screen.getByTestId('note-node-note-1')
    fireEvent.contextMenu(note)
    expect(mockStore.selectNode).toHaveBeenCalledWith('note-1')
  })

  it('contextmenu while editing is suppressed (no selection change, default prevented)', async () => {
    await mountNote({ selected: true })
    // Enter edit mode first.
    fireEvent.doubleClick(screen.getByTestId('note-node-note-1'))
    mockStore.selectNode.mockClear()

    const note = screen.getByTestId('note-node-note-1')
    const evt = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    note.dispatchEvent(evt)
    expect(evt.defaultPrevented).toBe(true)
    expect(mockStore.selectNode).not.toHaveBeenCalled()
  })
})
