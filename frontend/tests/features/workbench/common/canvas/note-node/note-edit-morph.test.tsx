/**
 * NoteNode edit-mode chrome morph tests.
 *
 * Design: Note Control.
 * - Double-click enters edit mode.
 * - The persistent slim status bar morphs to `[color picker]` (left) + `[accept] [cancel]` (right).
 * - Body border switches from dashed amber to a solid blue 2 px outline.
 * - Accept commits the edit and returns to idle (kebab-only bar).
 * - Cancel returns to idle without committing.
 * - Esc cancels and returns to idle.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
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

async function mountNote(text = 'My note') {
  const { NoteNode } = await import('@/features/workbench/common/canvas/note-node/note-node')
  return render(
    <NoteNode
      id="note-1"
      type="noteNode"
      data={{ label: 'Note', config: { text, color: 'amber' } }}
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
}

describe('NoteNode - edit-mode chrome morph', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('double-click enters edit mode and replaces text display with a textarea', async () => {
    await mountNote('Probe gateway')
    const note = screen.getByTestId('note-node-note-1')
    fireEvent.doubleClick(note)
    await waitFor(() => {
      expect(screen.getByTestId('note-text-editor')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('note-text-display')).not.toBeInTheDocument()
  })

  it('in edit mode, the slim status bar morphs to [color] (left) + [accept] [cancel] (right)', async () => {
    await mountNote('Probe gateway')
    fireEvent.doubleClick(screen.getByTestId('note-node-note-1'))
    await waitFor(() => {
      expect(screen.getByTestId('note-text-editor')).toBeInTheDocument()
    })

    // Left: color picker
    expect(screen.getByTestId('note-color-picker')).toBeInTheDocument()
    // Right: accept + cancel
    expect(screen.getByTestId('note-edit-accept')).toBeInTheDocument()
    expect(screen.getByTestId('note-edit-cancel')).toBeInTheDocument()
    // No kebab in edit mode
    expect(screen.queryByTestId('node-kebab')).not.toBeInTheDocument()
  })

  it('the body border switches to solid blue (2 px) in edit mode', async () => {
    const { container } = await mountNote('Probe gateway')
    fireEvent.doubleClick(screen.getByTestId('note-node-note-1'))
    await waitFor(() => {
      expect(screen.getByTestId('note-text-editor')).toBeInTheDocument()
    })
    // A border-blue-500 OR similar token-based class is present on the body wrapper.
    const blueEl = container.querySelector('.border-blue-500, [data-edit-border="true"]')
    expect(blueEl).not.toBeNull()
  })

  it('Accept commits the edit, returns to idle, and the kebab is back', async () => {
    const user = userEvent.setup()
    await mountNote('Probe gateway')
    fireEvent.doubleClick(screen.getByTestId('note-node-note-1'))
    await waitFor(() => {
      expect(screen.getByTestId('note-text-editor')).toBeInTheDocument()
    })

    const textarea = screen.getByTestId('note-text-editor') as HTMLTextAreaElement
    await user.clear(textarea)
    await user.type(textarea, 'Updated text')

    await user.click(screen.getByTestId('note-edit-accept'))

    await waitFor(() => {
      expect(screen.queryByTestId('note-text-editor')).not.toBeInTheDocument()
    })
    expect(screen.getByTestId('node-kebab')).toBeInTheDocument()
    expect(mockStore.updateNode).toHaveBeenCalled()
  })

  it('Cancel returns to idle without committing the edit', async () => {
    const user = userEvent.setup()
    await mountNote('Probe gateway')
    fireEvent.doubleClick(screen.getByTestId('note-node-note-1'))
    await waitFor(() => {
      expect(screen.getByTestId('note-text-editor')).toBeInTheDocument()
    })

    const textarea = screen.getByTestId('note-text-editor') as HTMLTextAreaElement
    await user.type(textarea, ' edits')

    await user.click(screen.getByTestId('note-edit-cancel'))

    await waitFor(() => {
      expect(screen.queryByTestId('note-text-editor')).not.toBeInTheDocument()
    })
    expect(mockStore.updateNode).not.toHaveBeenCalled()
  })

  it('Escape cancels and returns to idle without committing', async () => {
    await mountNote('Probe gateway')
    fireEvent.doubleClick(screen.getByTestId('note-node-note-1'))
    await waitFor(() => {
      expect(screen.getByTestId('note-text-editor')).toBeInTheDocument()
    })

    const textarea = screen.getByTestId('note-text-editor')
    fireEvent.keyDown(textarea, { key: 'Escape' })

    await waitFor(() => {
      expect(screen.queryByTestId('note-text-editor')).not.toBeInTheDocument()
    })
    expect(mockStore.updateNode).not.toHaveBeenCalled()
  })
})
