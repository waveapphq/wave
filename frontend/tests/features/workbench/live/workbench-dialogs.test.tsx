/**
 * Tests for WorkbenchDialogs - the dialog cluster rendered by the workbench
 * container. Covers the inline edit-mode close nag (the heavy child dialogs are
 * stubbed so the test isolates the nag's Escape/backdrop dismissal).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@/features/workbench/common/test-form', () => ({ TestFormDialog: () => null }))
vi.mock('@/features/workbench/common/canvas/dialogs/close-confirm-dialog', () => ({
  CloseConfirmDialog: () => null,
}))
vi.mock('@/features/workbench/common/canvas/dialogs/switch-test-dialog', () => ({
  SwitchTestConfirmDialog: () => null,
}))
const validationDialogProps = vi.fn()
vi.mock('@/features/workbench/common/canvas/dialogs/validation-error-dialog', () => ({
  ValidationErrorDialog: (props: { onFixAll?: () => void; onDeleteTest?: () => void }) => {
    validationDialogProps(props)
    return null
  },
}))
vi.mock('@/components/ui/confirmation-dialog', () => ({ ConfirmationDialog: () => null }))

import { WorkbenchDialogs } from '@/features/workbench/live/workbench-dialogs'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import { useDeletedTestStore } from '@/features/workbench/stores/deleted-test-store'

type Props = Parameters<typeof WorkbenchDialogs>[0]

function makeProps(overrides: Partial<Props> = {}): Props {
  return {
    showSaveDialog: false,
    onCloseSaveDialog: vi.fn(),
    onSaveTest: vi.fn().mockResolvedValue(undefined),
    saveMode: 'edit',
    showCloseConfirmDialog: false,
    onCloseConfirmDialog: vi.fn(),
    onSaveAndClose: vi.fn().mockResolvedValue(undefined),
    onDiscardAndClose: vi.fn(),
    onDiscardAndStay: vi.fn().mockResolvedValue(undefined),
    isSaving: false,
    isDirty: false,
    executionActive: false,
    sessionArtifactCount: 0,
    uploadCount: 0,
    showResetConfirmDialog: false,
    onCancelResetConfirm: vi.fn(),
    onConfirmReset: vi.fn(),
    showEditModeNag: false,
    onCloseEditModeNag: vi.fn(),
    showFunctionViewLeaveNotice: false,
    onAcknowledgeFunctionViewLeave: vi.fn(),
    onCancelFunctionViewLeave: vi.fn(),
    showSwitchTestDialog: false,
    currentTestName: null,
    onViewPendingWorkflow: vi.fn(),
    onSaveAndSwitch: vi.fn().mockResolvedValue(undefined),
    onDiscardAndSwitch: vi.fn(),
    isRunning: false,
    pendingDeleteVarId: null,
    pendingDeleteVarName: '',
    pendingDeleteDescription: '',
    onCloseDeleteVar: vi.fn(),
    onConfirmDeleteVar: vi.fn(),
    editingTestId: null,
    editingTestName: null,
    showEditMetadataDialog: false,
    onCloseEditMetadata: vi.fn(),
    onSaveMetadata: vi.fn().mockResolvedValue(undefined),
    deletedTestInfo: null,
    onDismissDeletedTest: vi.fn(),
    showValidationErrorDialog: false,
    validationFatal: false,
    validationErrors: [],
    validationMode: 'save',
    isFixingTest: false,
    onValidationClose: vi.fn(),
    ...overrides,
  }
}

describe('WorkbenchDialogs - validation dialog actions', () => {
  function lastValidationProps(): { onFixAll?: () => void; onDeleteTest?: () => void } {
    const calls = validationDialogProps.mock.calls
    return calls[calls.length - 1][0] as { onFixAll?: () => void; onDeleteTest?: () => void }
  }

  it('starts Fix All and the fatal delete, and leaves each to report itself', async () => {
    const onFixAll = vi.fn().mockRejectedValue(new Error('fix failed'))
    const onDeleteFatalTest = vi.fn().mockRejectedValue(new Error('delete failed'))
    render(<WorkbenchDialogs {...makeProps({ onFixAll, onDeleteFatalTest })} />)

    const props = lastValidationProps()
    props.onFixAll?.()
    props.onDeleteTest?.()

    expect(onFixAll).toHaveBeenCalled()
    expect(onDeleteFatalTest).toHaveBeenCalled()
    await Promise.resolve()
  })

  it('offers neither action when the container did not supply it', () => {
    render(<WorkbenchDialogs {...makeProps()} />)

    const props = lastValidationProps()
    expect(props.onFixAll).toBeUndefined()
    expect(props.onDeleteTest).toBeUndefined()
  })
})

describe('WorkbenchDialogs - edit-mode close nag', () => {
  it('dismisses the nag via Escape, calling onCloseEditModeNag', async () => {
    const user = userEvent.setup()
    const onCloseEditModeNag = vi.fn()
    render(<WorkbenchDialogs {...makeProps({ showEditModeNag: true, onCloseEditModeNag })} />)

    expect(screen.getByTestId('edit-mode-nag-modal')).toBeInTheDocument()
    await user.keyboard('{Escape}')

    expect(onCloseEditModeNag).toHaveBeenCalled()
  })
})

describe('WorkbenchDialogs - library View leave notice', () => {
  it('says the draft is dropped and passes OK on', async () => {
    const user = userEvent.setup()
    const onAcknowledgeFunctionViewLeave = vi.fn()
    render(
      <WorkbenchDialogs
        {...makeProps({ showFunctionViewLeaveNotice: true, onAcknowledgeFunctionViewLeave })}
      />,
    )

    const notice = screen.getByTestId('function-view-leave-notice')
    expect(within(notice).getByText('Function still in edit mode')).toBeInTheDocument()
    expect(notice).toHaveTextContent("Leaving the View drops this Function's unpublished draft.")
    expect(screen.queryByTestId('edit-mode-nag-modal')).not.toBeInTheDocument()
    await user.click(within(notice).getByRole('button', { name: 'OK' }))

    expect(onAcknowledgeFunctionViewLeave).toHaveBeenCalledOnce()
  })

  it('treats Escape as cancel, so a stray key never drops the draft', async () => {
    const user = userEvent.setup()
    const onAcknowledgeFunctionViewLeave = vi.fn()
    const onCancelFunctionViewLeave = vi.fn()
    render(
      <WorkbenchDialogs
        {...makeProps({
          showFunctionViewLeaveNotice: true,
          onAcknowledgeFunctionViewLeave,
          onCancelFunctionViewLeave,
        })}
      />,
    )

    await user.keyboard('{Escape}')

    expect(onCancelFunctionViewLeave).toHaveBeenCalledOnce()
    expect(onAcknowledgeFunctionViewLeave).not.toHaveBeenCalled()
  })
})

describe('WorkbenchDialogs - deleted test dialog', () => {
  const deletedTestInfo = { testId: 'test-42', testName: 'Payment smoke' }
  const DRAFT_KEY = 'wave-workbench-draft'

  /** A canvas holding one block, open on the test the dialog names. */
  function seedOpenTest(): void {
    useWorkflowStore.getState().reset()
    useDeletedTestStore.getState().clear()
    useDeletedTestStore.getState().raise(deletedTestInfo)
    useWorkflowStore.getState().setEditingTest('test-42', 'Payment smoke')
    useWorkflowStore.getState().setNodes([
      { id: 'n1', type: 'workflowNode', position: { x: 0, y: 0 }, data: {} },
    ] as Parameters<ReturnType<typeof useWorkflowStore.getState>['setNodes']>[0])
    localStorage.setItem(DRAFT_KEY, '{"nodes":[],"edges":[]}')
  }

  beforeEach(() => {
    seedOpenTest()
  })

  afterEach(() => {
    localStorage.removeItem(DRAFT_KEY)
  })

  it('names the test and says it is gone from the server and what Close does', () => {
    render(<WorkbenchDialogs {...makeProps({ deletedTestInfo, isDirty: false })} />)

    const modal = within(screen.getByTestId('deleted-test-modal'))
    expect(modal.getByRole('heading', { name: 'Test not found' })).toBeInTheDocument()
    expect(modal.getByText(/"Payment smoke"/)).toBeInTheDocument()
    expect(modal.getByText(/is no longer on the server/)).toBeInTheDocument()
    expect(modal.getByText(/Close clears the canvas and starts a new draft/)).toBeInTheDocument()
  })

  it('offers Close as its only action on a clean canvas', async () => {
    const user = userEvent.setup()
    const onDismissDeletedTest = vi.fn()
    render(
      <WorkbenchDialogs
        {...makeProps({ deletedTestInfo, onDismissDeletedTest, isDirty: false })}
      />,
    )

    const buttons = within(screen.getByTestId('deleted-test-modal')).getAllByRole('button')
    expect(buttons).toHaveLength(1)
    expect(buttons[0]).toHaveTextContent('Close')

    await user.click(buttons[0])
    expect(onDismissDeletedTest).toHaveBeenCalled()
  })

  it('says the work on the canvas is lost, and names the button for what it does', async () => {
    const user = userEvent.setup()
    const onDismissDeletedTest = vi.fn()
    render(
      <WorkbenchDialogs
        {...makeProps({ deletedTestInfo, onDismissDeletedTest, isDirty: true })}
      />,
    )

    const modal = within(screen.getByTestId('deleted-test-modal'))
    expect(
      modal.getByText(/your changes cannot be saved to it\. Discarding them clears the canvas/),
    ).toBeInTheDocument()
    expect(
      modal.getByText(/Discarding them clears the canvas and starts a new draft/),
    ).toBeInTheDocument()

    const buttons = modal.getAllByRole('button')
    expect(buttons).toHaveLength(2)
    expect(buttons[0]).toHaveTextContent('Keep on canvas')
    expect(buttons[0]).toHaveClass('btn-secondary')
    expect(buttons[1]).toHaveTextContent('Discard changes')
    expect(buttons[1]).toHaveClass('btn-danger')

    await user.click(buttons[1])
    expect(onDismissDeletedTest).toHaveBeenCalled()
  })

  it('keeps the work on the canvas and drops only the test identity', async () => {
    const user = userEvent.setup()
    const onDismissDeletedTest = vi.fn()
    render(
      <WorkbenchDialogs
        {...makeProps({ deletedTestInfo, onDismissDeletedTest, isDirty: true })}
      />,
    )

    const modal = within(screen.getByTestId('deleted-test-modal'))
    await user.click(modal.getByRole('button', { name: 'Keep on canvas' }))

    const state = useWorkflowStore.getState()
    expect(useDeletedTestStore.getState().info).toBeNull()
    expect(state.nodes).toHaveLength(1)
    expect(state.isDirty).toBe(true)
    expect(state.editingTestId).toBeNull()
    expect(localStorage.getItem(DRAFT_KEY)).toBe('{"nodes":[],"edges":[]}')
    expect(onDismissDeletedTest).not.toHaveBeenCalled()
  })

  it('takes Keep on canvas when the user presses Escape, never the discard', async () => {
    const user = userEvent.setup()
    const onDismissDeletedTest = vi.fn()
    render(
      <WorkbenchDialogs
        {...makeProps({ deletedTestInfo, onDismissDeletedTest, isDirty: true })}
      />,
    )

    await user.keyboard('{Escape}')

    const state = useWorkflowStore.getState()
    expect(useDeletedTestStore.getState().info).toBeNull()
    expect(state.nodes).toHaveLength(1)
    expect(state.editingTestId).toBeNull()
    expect(onDismissDeletedTest).not.toHaveBeenCalled()
  })

  it('ignores Escape on a clean canvas, where the only action clears the canvas', async () => {
    const user = userEvent.setup()
    const onDismissDeletedTest = vi.fn()
    render(
      <WorkbenchDialogs
        {...makeProps({ deletedTestInfo, onDismissDeletedTest, isDirty: false })}
      />,
    )

    await user.keyboard('{Escape}')

    expect(screen.getByTestId('deleted-test-modal')).toBeInTheDocument()
    expect(useDeletedTestStore.getState().info).toEqual(deletedTestInfo)
    expect(useWorkflowStore.getState().editingTestId).toBe('test-42')
    expect(onDismissDeletedTest).not.toHaveBeenCalled()
  })

  it('reads without a name when the canvas never had one', () => {
    render(
      <WorkbenchDialogs
        {...makeProps({ deletedTestInfo: { testId: 'test-42', testName: null }, isDirty: false })}
      />,
    )

    const modal = within(screen.getByTestId('deleted-test-modal'))
    expect(modal.getByText(/^The test is no longer on the server\./)).toBeInTheDocument()
  })
})
