/**
 * ValidationErrorDialog Tests
 *
 * Tests for the two-variant validation error dialog:
 * - Fatal: Cannot load test, Close only
 * - Fixable: Issues found, Fix All + Close
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { ValidationErrorDialog } from '@/features/workbench/common/canvas/dialogs/validation-error-dialog'
import type { ValidationError } from '@/features/workbench/common/canvas/dialogs/validation-error-dialog'

const fatalErrors: ValidationError[] = [
  {
    path: 'workflow',
    code: 'MISSING_WORKFLOW',
    message: 'Test has no workflow defined',
    severity: 'error',
  },
  {
    path: 'workflow.nodes',
    code: 'INVALID_NODES',
    message: 'Workflow nodes must be a list',
    severity: 'error',
  },
]

const fixableErrors: ValidationError[] = [
  {
    path: 'workflow.nodes[0].type',
    node_id: 'end-node',
    code: 'INVALID_NODE_TYPE',
    message: "Unknown node type 'end'. Valid types: workflowNode",
    severity: 'error',
    fix_action: 'Remove node and connected edges',
  },
  {
    path: 'workflow.nodes[1].data.label',
    node_id: 'http-1',
    node_label: 'HTTP Request',
    element_type: 'http-client',
    code: 'MISSING_LABEL',
    message: 'Node is missing a label',
    severity: 'error',
    fix_action: 'Generate a name from the block type',
  },
  {
    path: 'workflow.edges[0]',
    node_id: 'edge-1',
    code: 'DANGLING_EDGE',
    message: "Edge references missing node 'deleted-node'",
    severity: 'error',
    fix_action: 'Remove edge',
  },
]

describe('ValidationErrorDialog', () => {
  describe('fatal variant', () => {
    it('does not render when isOpen is false', () => {
      render(
        <ValidationErrorDialog
          isOpen={false}
          fatal={true}
          errors={fatalErrors}
          onClose={vi.fn()}
        />
      )

      expect(screen.queryByTestId('validation-error-dialog')).not.toBeInTheDocument()
    })

    it('renders fatal title and description', () => {
      render(
        <ValidationErrorDialog
          isOpen={true}
          fatal={true}
          errors={fatalErrors}
          onClose={vi.fn()}
        />
      )

      expect(screen.getByText('Cannot Load Test')).toBeInTheDocument()
      expect(
        screen.getByText('This test has fatal structural errors that prevent loading.')
      ).toBeInTheDocument()
    })

    it('renders error list with all fatal errors', () => {
      render(
        <ValidationErrorDialog
          isOpen={true}
          fatal={true}
          errors={fatalErrors}
          onClose={vi.fn()}
        />
      )

      expect(screen.getByText('Test has no workflow defined')).toBeInTheDocument()
      expect(screen.getByText('Workflow nodes must be a list')).toBeInTheDocument()
      // Error codes shown in brackets
      expect(screen.getByText('[MISSING_WORKFLOW]')).toBeInTheDocument()
      expect(screen.getByText('[INVALID_NODES]')).toBeInTheDocument()
    })

    it('renders Close button only (no Fix All)', () => {
      render(
        <ValidationErrorDialog
          isOpen={true}
          fatal={true}
          errors={fatalErrors}
          onClose={vi.fn()}
        />
      )

      expect(screen.getByTestId('validation-close-btn')).toBeInTheDocument()
      expect(screen.queryByTestId('validation-fix-all-btn')).not.toBeInTheDocument()
    })

    it('fires onClose when Close button is clicked', async () => {
      const onClose = vi.fn()
      render(
        <ValidationErrorDialog
          isOpen={true}
          fatal={true}
          errors={fatalErrors}
          onClose={onClose}
        />
      )

      await userEvent.click(screen.getByTestId('validation-close-btn'))
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('renders Delete Test button when onDeleteTest is provided', () => {
      render(
        <ValidationErrorDialog
          isOpen={true}
          fatal={true}
          errors={fatalErrors}
          onClose={vi.fn()}
          onDeleteTest={vi.fn()}
        />
      )

      expect(screen.getByTestId('validation-delete-test-btn')).toBeInTheDocument()
      expect(screen.getByText('Delete Test')).toBeInTheDocument()
    })

    it('fires onDeleteTest when Delete Test button is clicked', async () => {
      const onDeleteTest = vi.fn()
      render(
        <ValidationErrorDialog
          isOpen={true}
          fatal={true}
          errors={fatalErrors}
          onClose={vi.fn()}
          onDeleteTest={onDeleteTest}
        />
      )

      await userEvent.click(screen.getByTestId('validation-delete-test-btn'))
      expect(onDeleteTest).toHaveBeenCalledTimes(1)
    })

    it('does not render Delete Test button when onDeleteTest is not provided', () => {
      render(
        <ValidationErrorDialog
          isOpen={true}
          fatal={true}
          errors={fatalErrors}
          onClose={vi.fn()}
        />
      )

      expect(screen.queryByTestId('validation-delete-test-btn')).not.toBeInTheDocument()
    })
  })

  describe('fixable variant', () => {
    it('does not render when isOpen is false', () => {
      render(
        <ValidationErrorDialog
          isOpen={false}
          fatal={false}
          errors={fixableErrors}
          onClose={vi.fn()}
          onFixAll={vi.fn()}
        />
      )

      expect(screen.queryByTestId('validation-error-dialog')).not.toBeInTheDocument()
    })

    it('renders fixable title and description', () => {
      render(
        <ValidationErrorDialog
          isOpen={true}
          fatal={false}
          errors={fixableErrors}
          onClose={vi.fn()}
          onFixAll={vi.fn()}
        />
      )

      expect(screen.getByText('Test Issues Found')).toBeInTheDocument()
      expect(screen.getByTestId('validation-error-count')).toHaveTextContent('3')
      expect(screen.getByText(/can be automatically fixed/)).toBeInTheDocument()
    })

    it('renders singular text for single error', () => {
      render(
        <ValidationErrorDialog
          isOpen={true}
          fatal={false}
          errors={[fixableErrors[0]]}
          onClose={vi.fn()}
          onFixAll={vi.fn()}
        />
      )

      expect(screen.getByTestId('validation-error-count')).toHaveTextContent('1')
      expect(screen.getByText(/can be automatically fixed/)).toBeInTheDocument()
    })

    it('renders two-column table with Issue and Fix headers', () => {
      render(
        <ValidationErrorDialog
          isOpen={true}
          fatal={false}
          errors={fixableErrors}
          onClose={vi.fn()}
          onFixAll={vi.fn()}
        />
      )

      expect(screen.getByText('Issue')).toBeInTheDocument()
      expect(screen.getByText('Fix')).toBeInTheDocument()
    })

    it('renders error messages and fix actions in table rows', () => {
      render(
        <ValidationErrorDialog
          isOpen={true}
          fatal={false}
          errors={fixableErrors}
          onClose={vi.fn()}
          onFixAll={vi.fn()}
        />
      )

      // Error messages
      expect(screen.getByText(/Unknown node type 'end'/)).toBeInTheDocument()
      expect(screen.getByText('Node is missing a label')).toBeInTheDocument()

      // Fix actions
      expect(screen.getByText('Remove node and connected edges')).toBeInTheDocument()
      expect(screen.getByText('Generate a name from the block type')).toBeInTheDocument()
      expect(screen.getByText('Remove edge')).toBeInTheDocument()
    })

    it('shows node label prefix in issue column when present', () => {
      render(
        <ValidationErrorDialog
          isOpen={true}
          fatal={false}
          errors={fixableErrors}
          onClose={vi.fn()}
          onFixAll={vi.fn()}
        />
      )

      // The labeled error renders its node label as a clickable leaf.
      expect(screen.getByRole('button', { name: 'HTTP Request' })).toBeInTheDocument()
    })

    it('shows dash for errors without fix_action', () => {
      const errorsNoFix: ValidationError[] = [
        {
          path: 'workflow.nodes[0]',
          code: 'SOME_ERROR',
          message: 'Something is wrong',
          severity: 'error',
        },
      ]

      render(
        <ValidationErrorDialog
          isOpen={true}
          fatal={false}
          errors={errorsNoFix}
          onClose={vi.fn()}
          onFixAll={vi.fn()}
        />
      )

      // The Fix column cell shows the dash; the path-row separator also uses
      // "-", so scope the assertion to the Fix cell.
      expect(screen.getByRole('cell', { name: '-' })).toBeInTheDocument()
    })

    it('renders both Fix All and Close buttons', () => {
      render(
        <ValidationErrorDialog
          isOpen={true}
          fatal={false}
          errors={fixableErrors}
          onClose={vi.fn()}
          onFixAll={vi.fn()}
        />
      )

      expect(screen.getByTestId('validation-close-btn')).toBeInTheDocument()
      expect(screen.getByTestId('validation-fix-all-btn')).toBeInTheDocument()
    })

    it('fires onClose when Close button is clicked', async () => {
      const onClose = vi.fn()
      render(
        <ValidationErrorDialog
          isOpen={true}
          fatal={false}
          errors={fixableErrors}
          onClose={onClose}
          onFixAll={vi.fn()}
        />
      )

      await userEvent.click(screen.getByTestId('validation-close-btn'))
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('fires onFixAll when Fix All button is clicked', async () => {
      const onFixAll = vi.fn()
      render(
        <ValidationErrorDialog
          isOpen={true}
          fatal={false}
          errors={fixableErrors}
          onClose={vi.fn()}
          onFixAll={onFixAll}
        />
      )

      await userEvent.click(screen.getByTestId('validation-fix-all-btn'))
      expect(onFixAll).toHaveBeenCalledTimes(1)
    })

    it('disables buttons and shows loading state when isFixing is true', () => {
      render(
        <ValidationErrorDialog
          isOpen={true}
          fatal={false}
          errors={fixableErrors}
          onClose={vi.fn()}
          onFixAll={vi.fn()}
          isFixing={true}
        />
      )

      const closeBtn = screen.getByTestId('validation-close-btn')
      const fixAllBtn = screen.getByTestId('validation-fix-all-btn')

      expect(closeBtn).toBeDisabled()
      expect(fixAllBtn).toBeDisabled()
      expect(fixAllBtn).toHaveAttribute('aria-busy', 'true')
    })

    it('does not render Fix All button when onFixAll is not provided', () => {
      render(
        <ValidationErrorDialog
          isOpen={true}
          fatal={false}
          errors={fixableErrors}
          onClose={vi.fn()}
        />
      )

      expect(screen.getByTestId('validation-close-btn')).toBeInTheDocument()
      expect(screen.queryByTestId('validation-fix-all-btn')).not.toBeInTheDocument()
    })

    it('renders empty table gracefully when no errors', () => {
      render(
        <ValidationErrorDialog
          isOpen={true}
          fatal={false}
          errors={[]}
          onClose={vi.fn()}
          onFixAll={vi.fn()}
        />
      )

      expect(screen.getByText('Test Issues Found')).toBeInTheDocument()
      expect(screen.getByTestId('validation-error-count')).toHaveTextContent('0')
    })
  })

  // Invariant: "Fix All" appears only when at least one row has a real Fix.
  // A test whose only issues are content problems (no BE fix_action) must NOT
  // claim auto-fixability nor offer Fix All - every Fix cell is "-".
  describe('Fix All consistency with fixable rows', () => {
    const contentOnlyErrors: ValidationError[] = [
      {
        path: 'p1',
        node_label: 'Log_1',
        code: 'REQUIRED_PARAM_MISSING',
        message: "Required parameter 'message' is missing",
        severity: 'error',
      },
      {
        path: 'p2',
        node_label: 'Setter_1',
        code: 'FUNCTION_SCOPE_UNDEFINED',
        message: "Variable 'subtotal' is not defined in this Function's scope",
        severity: 'error',
      },
      {
        path: 'p3',
        node_label: 'ValidateUser',
        code: 'MISSING_FUNCTION_VERSION',
        message: 'Pinned version 2.0.0 is no longer available in the library',
        severity: 'error',
      },
    ]

    it('hides Fix All and shows the manual-resolution headline when nothing is auto-fixable', () => {
      render(
        <ValidationErrorDialog
          isOpen={true}
          fatal={false}
          errors={contentOnlyErrors}
          onClose={vi.fn()}
          onFixAll={vi.fn()}
        />
      )

      // Even though onFixAll is wired, every row is "-", so no button.
      expect(screen.queryByTestId('validation-fix-all-btn')).not.toBeInTheDocument()
      expect(screen.queryByText(/can be automatically fixed/)).not.toBeInTheDocument()
      expect(screen.getByText(/must be resolved manually/)).toBeInTheDocument()
      expect(screen.getByTestId('validation-error-count')).toHaveTextContent('3')
      // All three Fix cells render the dash.
      expect(screen.getAllByRole('cell', { name: '-' })).toHaveLength(3)
    })

    it('shows Fix All and an "N of M" headline when only some issues are auto-fixable', () => {
      const mixedErrors: ValidationError[] = [
        contentOnlyErrors[0],
        contentOnlyErrors[2],
        {
          path: 'edges[0]',
          node_id: 'edge-1',
          code: 'DANGLING_EDGE',
          message: "Edge references missing node 'gone'",
          severity: 'error',
          fix_action: 'Remove dangling edge',
        },
      ]

      render(
        <ValidationErrorDialog
          isOpen={true}
          fatal={false}
          errors={mixedErrors}
          onClose={vi.fn()}
          onFixAll={vi.fn()}
        />
      )

      expect(screen.getByTestId('validation-fix-all-btn')).toBeInTheDocument()
      // Headline counts the fixable subset: "1 of 3 ... can be automatically fixed".
      expect(screen.getByTestId('validation-error-count')).toHaveTextContent('1')
      expect(screen.getByText(/of 3 item\(s\) can be automatically fixed/)).toBeInTheDocument()
      // The one fixable row shows its action; the two content rows show "-".
      expect(screen.getByText('Remove dangling edge')).toBeInTheDocument()
      expect(screen.getAllByRole('cell', { name: '-' })).toHaveLength(2)
    })
  })

  describe('save variant (mode="save")', () => {
    const saveErrors: ValidationError[] = [
      {
        path: 'nodes[0].data.config.values.url',
        node_id: 'n1',
        node_label: 'HTTP Request',
        element_type: 'http-client',
        code: 'REQUIRED_PARAM_MISSING',
        message: "Required parameter 'url' is missing",
        severity: 'error',
      },
      {
        path: 'nodes[1].data.config.values.duration',
        node_id: 'n2',
        node_label: 'Delay',
        element_type: 'delay',
        code: 'REQUIRED_PARAM_MISSING',
        message: "Required parameter 'duration' is missing",
        severity: 'error',
      },
    ]

    it('renders save-mode title and description', () => {
      render(
        <ValidationErrorDialog
          isOpen={true}
          fatal={false}
          errors={saveErrors}
          onClose={vi.fn()}
          mode="save"
        />
      )

      expect(screen.getByText('Cannot Save Test')).toBeInTheDocument()
      expect(screen.getByTestId('validation-error-count')).toHaveTextContent('2')
      expect(screen.getByText(/must be resolved before saving/)).toBeInTheDocument()
    })

    it('renders singular text for single error', () => {
      render(
        <ValidationErrorDialog
          isOpen={true}
          fatal={false}
          errors={[saveErrors[0]]}
          onClose={vi.fn()}
          mode="save"
        />
      )

      expect(screen.getByTestId('validation-error-count')).toHaveTextContent('1')
      expect(screen.getByText(/must be resolved before saving/)).toBeInTheDocument()
    })

    it('renders single-column table without Fix column', () => {
      render(
        <ValidationErrorDialog
          isOpen={true}
          fatal={false}
          errors={saveErrors}
          onClose={vi.fn()}
          mode="save"
        />
      )

      expect(screen.getByText('Issue')).toBeInTheDocument()
      expect(screen.queryByText('Fix')).not.toBeInTheDocument()
    })

    it('shows node label prefix and error messages', () => {
      render(
        <ValidationErrorDialog
          isOpen={true}
          fatal={false}
          errors={saveErrors}
          onClose={vi.fn()}
          mode="save"
        />
      )

      expect(screen.getByRole('button', { name: 'HTTP Request' })).toBeInTheDocument()
      expect(screen.getByText("Required parameter 'url' is missing")).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Delay' })).toBeInTheDocument()
      expect(screen.getByText("Required parameter 'duration' is missing")).toBeInTheDocument()
    })

    it('renders Close button only (no Fix All)', () => {
      render(
        <ValidationErrorDialog
          isOpen={true}
          fatal={false}
          errors={saveErrors}
          onClose={vi.fn()}
          mode="save"
        />
      )

      expect(screen.getByTestId('validation-close-btn')).toBeInTheDocument()
      expect(screen.queryByTestId('validation-fix-all-btn')).not.toBeInTheDocument()
    })

    it('renders Fix All when onFixAll is provided (save mode adds vars inline)', () => {
      render(
        <ValidationErrorDialog
          isOpen={true}
          fatal={false}
          errors={saveErrors}
          onClose={vi.fn()}
          onFixAll={vi.fn()}
          mode="save"
        />
      )

      expect(screen.getByTestId('validation-fix-all-btn')).toBeInTheDocument()
    })

    it('fires onClose when Close button is clicked', async () => {
      const onClose = vi.fn()
      render(
        <ValidationErrorDialog
          isOpen={true}
          fatal={false}
          errors={saveErrors}
          onClose={onClose}
          mode="save"
        />
      )

      await userEvent.click(screen.getByTestId('validation-close-btn'))
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('uses error icon instead of warning icon', () => {
      render(
        <ValidationErrorDialog
          isOpen={true}
          fatal={false}
          errors={saveErrors}
          onClose={vi.fn()}
          mode="save"
        />
      )

      // Save mode uses XCircle (error), not AlertTriangle (warning)
      // Dialog renders in a portal, so query from document.body
      expect(document.body.querySelector('.text-error')).toBeInTheDocument()
      expect(document.body.querySelector('.text-warning')).not.toBeInTheDocument()
    })
  })
})
