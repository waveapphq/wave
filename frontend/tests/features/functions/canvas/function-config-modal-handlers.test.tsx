/** The Function Block window's own handlers on the shared Block window: shell close rules and the footer dialogs. */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReactFlowProvider } from '@xyflow/react'

// Dialog double: its close and outside-click handlers are reachable through plain buttons.
vi.mock('@/components/ui/dialog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui/dialog')>()
  return {
    ...actual,
    Dialog: ({
      open,
      onOpenChange,
      children,
    }: {
      open: boolean
      onOpenChange?: (open: boolean) => void
      children: React.ReactNode
    }) =>
      open ? (
        // aria-modal lets hasOpenModalDialog() see the double as a modal dialog.
        <div role="dialog" aria-modal="true">
          <button
            type="button"
            data-testid="shell-request-close"
            onClick={() => onOpenChange?.(false)}
          >
            request-close
          </button>
          <button
            type="button"
            data-testid="shell-request-open"
            onClick={() => onOpenChange?.(true)}
          >
            request-open
          </button>
          {children}
        </div>
      ) : null,
    DialogContent: ({
      children,
      onPointerDownOutside,
      onInteractOutside,
    }: {
      children: React.ReactNode
      onPointerDownOutside?: (e: { preventDefault: () => void }) => void
      onInteractOutside?: (e: { preventDefault: () => void }) => void
    }) => (
      <div data-testid="dialog-content">
        <button
          type="button"
          data-testid="content-pointer-outside"
          onClick={() => onPointerDownOutside?.({ preventDefault: vi.fn() })}
        >
          pointer-outside
        </button>
        <button
          type="button"
          data-testid="content-interact-outside"
          onClick={() => onInteractOutside?.({ preventDefault: vi.fn() })}
        >
          interact-outside
        </button>
        {children}
      </div>
    ),
    // Layout-only parts read the replaced Radix root, so they render as plain wrappers.
    DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
    DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  }
})

// Child-dialog doubles: surface onClose / onDone as buttons (only while open).
vi.mock(
  '@/features/workbench/common/element-config/dialogs/profile-binding-modal',
  () => ({
    ProfileBindingModal: ({
      isOpen,
      onClose,
      onDone,
    }: {
      isOpen: boolean
      onClose: () => void
      onDone: (b: unknown[]) => void
    }) =>
      isOpen ? (
        <div data-testid="profile-modal">
          <button type="button" data-testid="profile-close" onClick={onClose}>
            close
          </button>
          <button
            type="button"
            data-testid="profile-done"
            onClick={() => {
              onDone([])
              onClose()
            }}
          >
            done
          </button>
        </div>
      ) : null,
  }),
)

vi.mock(
  '@/features/workbench/common/element-config/dialogs/changelog-dialog',
  () => ({
    ChangelogDialog: ({
      isOpen,
      onClose,
    }: {
      isOpen: boolean
      onClose: () => void
    }) =>
      isOpen ? (
        <div data-testid="changelog-modal">
          <button type="button" data-testid="changelog-close" onClick={onClose}>
            close
          </button>
        </div>
      ) : null,
  }),
)

vi.mock(
  '@/features/workbench/common/element-config/dialogs/details-dialog',
  () => ({
    DetailsDialog: ({
      isOpen,
      onClose,
    }: {
      isOpen: boolean
      onClose: () => void
    }) =>
      isOpen ? (
        <div data-testid="details-modal">
          <button type="button" data-testid="details-close" onClick={onClose}>
            close
          </button>
        </div>
      ) : null,
  }),
)

// Version metadata so the Published footer (Changelog / Details) renders.
vi.mock('@/features/functions/hooks/use-function-versions', () => ({
  useFunctionVersions: (functionId: string) => ({
    versions: functionId
      ? [
          {
            version: '1.0.0',
            published_at: '2026-01-01',
            changelog: 'a line',
            details: 'some details',
            description: 'desc',
            tags: [],
          },
        ]
      : [],
    latest: functionId ? '1.0.0' : '',
    isLoading: false,
    failed: false,
    retry: () => {},
  }),
}))

vi.mock('@/features/profiles/api/crud', () => ({
  fetchProfiles: vi.fn(async () => ({
    data: [],
    pagination: { total: 0, page: 1, per_page: 100, total_pages: 1 },
  })),
}))

import { ConfigSheetHost } from '@/features/workbench/common/canvas/workflow-canvas/canvas'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'

const NODE_ID = 'fn-handlers-1'

function publishedBlock() {
  return {
    id: NODE_ID,
    type: 'workflowNode',
    position: { x: 0, y: 0 },
    data: {
      label: 'published_function',
      description: 'Library function',
      elementType: 'function',
      nodeType: 'function',
      functionLifecycle: 'shared',
      functionId: '00000000-0000-0000-0000-000000000001',
      functionVersion: '1.0.0',
      originalLibraryName: 'fetch_user',
      resolvedInputs: [{ name: 'n', type: 'integer', required: true }],
      resolvedOutputs: [{ name: 'doubled', type: 'integer' }],
      config: { values: { n: 2 }, outputBindings: {} },
    },
  }
}

/** Opens the Block's window the way the canvas does for an open sheet. */
function openWindow() {
  useWorkflowStore.setState({
    nodes: [publishedBlock()] as never,
    edges: [],
    variables: [],
    drillPath: [],
    openConfigNodeIds: [NODE_ID],
  })
  render(
    <ReactFlowProvider>
      <ConfigSheetHost nodeId={NODE_ID} cascadeIndex={0} />
    </ReactFlowProvider>,
  )
}

const openSheets = () => useWorkflowStore.getState().openConfigNodeIds

beforeEach(() => {
  useWorkflowStore.getState().reset()
})

// Escape closes the front-most sheet, a nested dialog owns Escape, a click outside never closes (CANVAS-227, CANVAS-228).
describe('Function Block window - shell handlers', () => {
  it('opens on the shared Block window', () => {
    openWindow()
    expect(screen.getByTestId('element-config-sheet')).toBeInTheDocument()
    expect(screen.getAllByTestId(/-config-sheet$/)).toHaveLength(1)
  })

  it('closes on Escape when the window is clean', () => {
    openWindow()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(openSheets()).toEqual([])
  })

  it('defers Escape to an open nested dialog instead of closing the window', async () => {
    const user = userEvent.setup()
    openWindow()
    // A change, then Cancel, puts the Unsaved changes dialog up; Escape belongs to it.
    await user.type(screen.getByTestId('element-description-input'), 'edited')
    await user.click(screen.getByRole('button', { name: /^cancel$/i }))
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(openSheets()).toEqual([NODE_ID])
  })

  it('does not close on pointer-down or click outside the window', () => {
    openWindow()
    fireEvent.pointerDown(document.body)
    fireEvent.click(document.body)
    expect(openSheets()).toEqual([NODE_ID])
  })
})

describe('Function Block window - footer dialog open and close', () => {
  it('opens the Details dialog from the footer button and closes it', async () => {
    const user = userEvent.setup()
    openWindow()
    expect(screen.queryByTestId('details-modal')).toBeNull()
    await user.click(screen.getByTestId('function-details-button'))
    expect(screen.getByTestId('details-modal')).toBeInTheDocument()
    await user.click(screen.getByTestId('details-close'))
    expect(screen.queryByTestId('details-modal')).toBeNull()
  })

  it('opens the Changelog dialog from the footer button and closes it', async () => {
    const user = userEvent.setup()
    openWindow()
    await user.click(screen.getByTestId('function-changelog-button'))
    expect(screen.getByTestId('changelog-modal')).toBeInTheDocument()
    await user.click(screen.getByTestId('changelog-close'))
    expect(screen.queryByTestId('changelog-modal')).toBeNull()
  })

  it('opens the Profiles sheet and closes it through both Done and close', async () => {
    const user = userEvent.setup()
    openWindow()
    await user.click(screen.getByRole('button', { name: /^profiles$/i }))
    expect(screen.getByTestId('profile-modal')).toBeInTheDocument()
    await user.click(screen.getByTestId('profile-done'))
    expect(screen.queryByTestId('profile-modal')).toBeNull()
    await user.click(screen.getByRole('button', { name: /^profiles$/i }))
    await user.click(screen.getByTestId('profile-close'))
    expect(screen.queryByTestId('profile-modal')).toBeNull()
  })
})
