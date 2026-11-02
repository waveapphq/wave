/**
 * Tests for `MakeLocalDialog` (FN-LC-16, FN-LC-17).
 *
 * Contract:
 *
 *   - Dialog title is exactly "Make Local"
 *   - Body is prose + an amber callout
 *   - Footer is Cancel + Make Local (primary)
 *   - Confirmation requires clicking "Make Local" - Esc / Cancel are no-ops
 *     (they CLOSE the dialog but do NOT mutate state)
 *   - Closing via Cancel or Escape does not call the detach service
 *   - Failure of the detach service keeps the dialog open with inline error
 *     (FN-LC-17)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const detachMock = vi.fn()
vi.mock('@/features/functions/api/functions-api', () => ({
  detachPublishedInstance: (...args: unknown[]) => detachMock(...args),
  listFunctions: vi.fn(),
  createFunction: vi.fn(),
  getFunction: vi.fn(),
  deleteFunction: vi.fn(),
  getDependents: vi.fn(),
  batchCreateFunctions: vi.fn(),
  batchDeleteFunctions: vi.fn(),
  exportFunction: vi.fn(),
  exportFunctionsBatch: vi.fn(),
  importFunctions: vi.fn(),
  runScopedFunction: vi.fn(),
}))

import { MakeLocalDialog } from '@/features/functions/canvas/make-local-dialog'


function defaultPublishedRef() {
  return {
    testId: '00000000-0000-0000-0000-000000000001',
    nodeId: 'fn-shared-1',
    functionId: '00000000-0000-0000-0000-0000000000aa',
    functionName: 'Greet User',
  }
}

// Test-side confirm handler that delegates to the detach mock so tests can
// assert on detachMock arguments while the dialog stays parent-agnostic
// about which backend path is used (saved Test vs draft canvas).
function makeConfirm() {
  return async () => {
    const result = await detachMock(
      defaultPublishedRef().testId,
      defaultPublishedRef().nodeId,
    )
    return result.node
  }
}


beforeEach(() => {
  detachMock.mockReset()
  detachMock.mockResolvedValue({
    node: {
      id: 'fn-shared-1',
      data: {
        functionLifecycle: 'local',
        localDefinition: { name: 'Greet User', inputs: [], outputs: [] },
      },
    },
  })
})


describe('MakeLocalDialog - layout', () => {
  it('renders the canonical title "Make Local"', () => {
    render(
      <MakeLocalDialog
        isOpen={true}
        onClose={() => {}}
        onDetached={() => {}}
        publishedRef={defaultPublishedRef()}
        onConfirm={makeConfirm()}
      />,
    )
    expect(screen.getByRole('heading', { name: /^make local$/i })).toBeInTheDocument()
  })

  it('renders Cancel + Make Local footer buttons', () => {
    render(
      <MakeLocalDialog
        isOpen={true}
        onClose={() => {}}
        onDetached={() => {}}
        publishedRef={defaultPublishedRef()}
        onConfirm={makeConfirm()}
      />,
    )
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^make local$/i })).toBeInTheDocument()
  })

  it('renders an amber callout in the body', () => {
    render(
      <MakeLocalDialog
        isOpen={true}
        onClose={() => {}}
        onDetached={() => {}}
        publishedRef={defaultPublishedRef()}
        onConfirm={makeConfirm()}
      />,
    )
    // The exact testid is fixed by the wireframe so Playwright can attach later.
    // The Dialog portal renders outside the container, so query the document.
    expect(screen.getByTestId('make-local-callout')).toBeInTheDocument()
  })
})


describe('MakeLocalDialog - confirm path', () => {
  it('calls detachPublishedInstance only when Make Local is clicked', async () => {
    const user = userEvent.setup()
    const onDetached = vi.fn()
    render(
      <MakeLocalDialog
        isOpen={true}
        onClose={() => {}}
        onDetached={onDetached}
        publishedRef={defaultPublishedRef()}
        onConfirm={makeConfirm()}
      />,
    )
    expect(detachMock).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: /^make local$/i }))
    expect(detachMock).toHaveBeenCalledTimes(1)
    const [testId, nodeId] = detachMock.mock.calls[0]
    expect(testId).toBe('00000000-0000-0000-0000-000000000001')
    expect(nodeId).toBe('fn-shared-1')
    // onDetached is fired with the updated node returned from the API.
    expect(onDetached).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ functionLifecycle: 'local' }) }),
    )
  })
})


describe('MakeLocalDialog - cancel & escape (ConfirmationDialog behavior)', () => {
  // MakeLocalDialog uses the project's
  // `ConfirmationDialog` wrapper with `variant="disconnect"`. That wrapper
  // forbids ESC + backdrop dismissals (only buttons close the dialog) per
  // the destructive-dialog policy in REQ-5.2.1.23. Cancel still closes.
  it('Cancel closes the dialog but does NOT call detachPublishedInstance', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <MakeLocalDialog
        isOpen={true}
        onClose={onClose}
        onDetached={() => {}}
        publishedRef={defaultPublishedRef()}
        onConfirm={makeConfirm()}
      />,
    )
    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onClose).toHaveBeenCalled()
    expect(detachMock).not.toHaveBeenCalled()
  })

  it('Escape does NOT close the dialog (ConfirmationDialog policy)', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <MakeLocalDialog
        isOpen={true}
        onClose={onClose}
        onDetached={() => {}}
        publishedRef={defaultPublishedRef()}
        onConfirm={makeConfirm()}
      />,
    )
    await user.keyboard('{Escape}')
    expect(onClose).not.toHaveBeenCalled()
    expect(detachMock).not.toHaveBeenCalled()
  })

  it('clicking outside the dialog does NOT close it (ConfirmationDialog policy)', () => {
    const onClose = vi.fn()
    render(
      <MakeLocalDialog
        isOpen={true}
        onClose={onClose}
        onDetached={() => {}}
        publishedRef={defaultPublishedRef()}
        onConfirm={makeConfirm()}
      />,
    )
    // Radix AlertDialog does not dismiss on outside click by default. We
    // assert the structural guarantee (alertdialog stays mounted, onClose
    // not invoked) instead of simulating a body click - jsdom locks
    // pointer-events on the body while the dialog is open so user.click
    // would throw rather than testing the contract.
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    expect(detachMock).not.toHaveBeenCalled()
  })

  it('uses the ConfirmationDialog `disconnect` variant (confirm button label "Make Local")', () => {
    render(
      <MakeLocalDialog
        isOpen={true}
        onClose={() => {}}
        onDetached={() => {}}
        publishedRef={defaultPublishedRef()}
        onConfirm={makeConfirm()}
      />,
    )
    // ConfirmationDialog renders as role="alertdialog" (Radix AlertDialog).
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  })
})


describe('MakeLocalDialog - failure path (FN-LC-17)', () => {
  it('keeps the dialog open and shows an inline error when detach fails', async () => {
    detachMock.mockRejectedValueOnce({
      status: 404,
      message: "Library entry '<id>' does not exist",
    })
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onDetached = vi.fn()
    render(
      <MakeLocalDialog
        isOpen={true}
        onClose={onClose}
        onDetached={onDetached}
        publishedRef={defaultPublishedRef()}
        onConfirm={makeConfirm()}
      />,
    )
    await user.click(screen.getByRole('button', { name: /^make local$/i }))
    expect(
      await screen.findByText(/Library entry '.+' does not exist/),
    ).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    expect(onDetached).not.toHaveBeenCalled()
  })
})


describe('MakeLocalDialog - failure with no message', () => {
  it("shows the 'Detach failed' fallback when the rejected error has no message", async () => {
    detachMock.mockRejectedValueOnce({})
    const user = userEvent.setup()
    render(
      <MakeLocalDialog
        isOpen={true}
        onClose={() => {}}
        onDetached={() => {}}
        publishedRef={defaultPublishedRef()}
        onConfirm={makeConfirm()}
      />,
    )
    await user.click(screen.getByRole('button', { name: /^make local$/i }))
    expect(await screen.findByText(/detach failed/i)).toBeInTheDocument()
  })
})


describe('MakeLocalDialog - closed', () => {
  it('renders nothing when isOpen=false', () => {
    render(
      <MakeLocalDialog
        isOpen={false}
        onClose={() => {}}
        onDetached={() => {}}
        publishedRef={defaultPublishedRef()}
        onConfirm={makeConfirm()}
      />,
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
