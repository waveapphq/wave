/**
 * ExecutionsRowActions Component Tests
 *
 * REQ-5.2.1.40: Execution history screen
 * REQ-5.2.1.23: Confirmation dialogs for destructive actions
 *
 * Tests for row-level actions in the executions DataTable:
 * - View button: always visible
 * - Export button: always visible
 * - Stop button: only for running executions
 * - Delete button: only for terminal executions
 * - ConfirmationDialog behavior for Stop and Delete
 *
 * Module: frontend/src/features/executions/components/executions-row-actions.tsx
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ExecutionsRowActions, type ExecutionsRowActionsProps } from '@/features/executions/components/executions-row-actions'
import type { Execution } from '@/features/executions/api/types'

// ============================================================================
// Mock Data
// ============================================================================

function createExecution(overrides: Partial<Execution> = {}): Execution {
  return {
    id: 'exec-1',
    name: 'Login Test',
    type: 'test',
    status: 'passed',
    triggeredBy: 'John Doe',
    startedAt: '2025-01-15T10:30:00Z',
    completedAt: '2025-01-15T10:32:34Z',
    duration: 154,
    durationFormatted: '2m 34s',
    entityId: 'test-123',
    ...overrides,
  }
}

function renderRowActions(props: Partial<ExecutionsRowActionsProps> = {}) {
  const defaultProps: ExecutionsRowActionsProps = {
    execution: createExecution(),
    onView: vi.fn(),
    onRerun: vi.fn(),
    onStop: vi.fn(),
    onDelete: vi.fn(),
    onExport: vi.fn(),
    ...props,
  }
  return { ...render(<ExecutionsRowActions {...defaultProps} />), props: defaultProps }
}

// ============================================================================
// Tests
// ============================================================================

describe('ExecutionsRowActions', () => {
  describe('View button', () => {
    it('always renders with data-testid="row-action-view"', () => {
      renderRowActions()
      expect(screen.getByTestId('row-action-view')).toBeInTheDocument()
    })

    it('calls onView(execution.id) when clicked', async () => {
      const user = userEvent.setup()
      const onView = vi.fn()
      renderRowActions({ onView })

      await user.click(screen.getByTestId('row-action-view'))
      expect(onView).toHaveBeenCalledWith('exec-1')
    })
  })

  describe('Export action', () => {
    it('renders for terminal executions', () => {
      renderRowActions({ execution: createExecution({ status: 'passed' }) })
      expect(screen.getByTestId('row-action-export')).toBeInTheDocument()
    })

    it('renders for running executions', () => {
      renderRowActions({ execution: createExecution({ status: 'running' }) })
      expect(screen.getByTestId('row-action-export')).toBeInTheDocument()
    })

    it('calls onExport(execution.id) when clicked', async () => {
      const user = userEvent.setup()
      const onExport = vi.fn()
      renderRowActions({
        execution: createExecution({ id: 'exec-export', status: 'passed' }),
        onExport,
      })

      await user.click(screen.getByTestId('row-action-export'))
      expect(onExport).toHaveBeenCalledWith('exec-export')
    })

    it('labels the affordance with the execution name', () => {
      renderRowActions({ execution: createExecution({ name: 'Login Test' }) })
      expect(screen.getByTestId('row-action-export')).toHaveAccessibleName('Export Login Test')
    })
  })

  describe('Stop button', () => {
    it('renders ONLY when execution.status === "running"', () => {
      renderRowActions({ execution: createExecution({ status: 'running' }) })
      expect(screen.getByTestId('row-action-stop')).toBeInTheDocument()
    })

    it('does NOT render for passed status', () => {
      renderRowActions({ execution: createExecution({ status: 'passed' }) })
      expect(screen.queryByTestId('row-action-stop')).not.toBeInTheDocument()
    })

    it('does NOT render for failed status', () => {
      renderRowActions({ execution: createExecution({ status: 'failed' }) })
      expect(screen.queryByTestId('row-action-stop')).not.toBeInTheDocument()
    })

    it('does NOT render for stopped status', () => {
      renderRowActions({ execution: createExecution({ status: 'stopped' }) })
      expect(screen.queryByTestId('row-action-stop')).not.toBeInTheDocument()
    })

    it('opens ConfirmationDialog with variant="discard" on click', async () => {
      const user = userEvent.setup()
      renderRowActions({ execution: createExecution({ status: 'running' }) })

      await user.click(screen.getByTestId('row-action-stop'))

      const dialog = screen.getByRole('alertdialog')
      expect(dialog).toBeInTheDocument()
    })

    it('confirming Stop dialog calls onStop(execution.id)', async () => {
      const user = userEvent.setup()
      const onStop = vi.fn()
      renderRowActions({
        execution: createExecution({ id: 'exec-running', status: 'running', name: 'Running Test' }),
        onStop,
      })

      await user.click(screen.getByTestId('row-action-stop'))

      const dialog = screen.getByRole('alertdialog')
      const stopButton = within(dialog).getByRole('button', { name: /stop|discard/i })
      await user.click(stopButton)

      expect(onStop).toHaveBeenCalledWith('exec-running')
    })

    it('canceling Stop dialog does NOT call onStop', async () => {
      const user = userEvent.setup()
      const onStop = vi.fn()
      renderRowActions({
        execution: createExecution({ status: 'running' }),
        onStop,
      })

      await user.click(screen.getByTestId('row-action-stop'))

      const dialog = screen.getByRole('alertdialog')
      await user.click(within(dialog).getByRole('button', { name: /cancel/i }))

      expect(onStop).not.toHaveBeenCalled()
    })
  })

  describe('Delete button', () => {
    it('renders ONLY for terminal status passed', () => {
      renderRowActions({ execution: createExecution({ status: 'passed' }) })
      expect(screen.getByTestId('row-action-delete')).toBeInTheDocument()
    })

    it('renders for terminal status failed', () => {
      renderRowActions({ execution: createExecution({ status: 'failed' }) })
      expect(screen.getByTestId('row-action-delete')).toBeInTheDocument()
    })

    it('renders for terminal status stopped', () => {
      renderRowActions({ execution: createExecution({ status: 'stopped' }) })
      expect(screen.getByTestId('row-action-delete')).toBeInTheDocument()
    })

    it('renders Delete + Re-run for terminal status skipped (a finished execution)', () => {
      renderRowActions({ execution: createExecution({ status: 'skipped' }) })
      expect(screen.getByTestId('row-action-delete')).toBeInTheDocument()
      expect(screen.getByTestId('row-action-rerun')).toBeInTheDocument()
    })

    it('does NOT render for running status', () => {
      renderRowActions({ execution: createExecution({ status: 'running' }) })
      expect(screen.queryByTestId('row-action-delete')).not.toBeInTheDocument()
    })

    it('opens ConfirmationDialog with variant="delete" on click', async () => {
      const user = userEvent.setup()
      renderRowActions({ execution: createExecution({ status: 'passed' }) })

      await user.click(screen.getByTestId('row-action-delete'))

      const dialog = screen.getByRole('alertdialog')
      expect(dialog).toBeInTheDocument()
      // Deleting an execution cascades to its artifacts + reports; the confirmation must warn.
      expect(dialog).toHaveTextContent(/artifacts and reports/i)
    })

    it('confirming Delete dialog calls onDelete(execution.id)', async () => {
      const user = userEvent.setup()
      const onDelete = vi.fn()
      renderRowActions({
        execution: createExecution({ id: 'exec-done', status: 'passed', name: 'Done Test' }),
        onDelete,
      })

      await user.click(screen.getByTestId('row-action-delete'))

      const dialog = screen.getByRole('alertdialog')
      const deleteButton = within(dialog).getByRole('button', { name: /delete/i })
      await user.click(deleteButton)

      expect(onDelete).toHaveBeenCalledWith('exec-done')
    })

    it('canceling Delete dialog does NOT call onDelete', async () => {
      const user = userEvent.setup()
      const onDelete = vi.fn()
      renderRowActions({
        execution: createExecution({ status: 'failed' }),
        onDelete,
      })

      await user.click(screen.getByTestId('row-action-delete'))

      const dialog = screen.getByRole('alertdialog')
      await user.click(within(dialog).getByRole('button', { name: /cancel/i }))

      expect(onDelete).not.toHaveBeenCalled()
    })
  })
})
