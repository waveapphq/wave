/**
 * ValidationErrorDialog mode-per-trigger tests.
 *
 * Five rows in the state-to-UI table; one test case each:
 * | mode    | fatal | Title             | Buttons                |
 * | save    | false | Cannot Save Test  | Close                  |
 * | run     | false | Cannot Run Test   | Close                  |
 * | debug   | false | Cannot Debug Test | Close                  |
 * | load    | true  | Cannot Load Test  | Close, Delete Test     |
 * | load    | false | Test Issues Found | Close, Fix All (when >=1 issue is auto-fixable) |
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

import { ValidationErrorDialog } from '@/features/workbench/common/canvas/dialogs/validation-error-dialog'
import type { ValidationError } from '@/features/workbench/common/canvas/dialogs/validation-error-dialog'

const oneError: ValidationError[] = [
  {
    path: 'workflow.nodes[0].data.config.values.url',
    node_id: 'http-1',
    node_label: 'HTTP Call',
    element_type: 'http-client',
    code: 'REQUIRED_PARAM_MISSING',
    message: "Required parameter 'url' is missing",
    severity: 'error',
  },
]

const fatalErrors: ValidationError[] = [
  {
    path: 'workflow',
    code: 'MISSING_WORKFLOW',
    message: 'Test has no workflow defined',
    severity: 'error',
  },
]

// An auto-fixable issue (carries a BE fix_action) - the only case where the
// load non-fatal dialog offers Fix All.
const fixableLoadError: ValidationError[] = [
  {
    path: 'workflow.edges[0]',
    node_id: 'edge-1',
    code: 'DANGLING_EDGE',
    message: "Edge references missing node 'gone'",
    severity: 'error',
    fix_action: 'Remove dangling edge',
  },
]

describe('ValidationErrorDialog mode-per-trigger', () => {
  it('mode=save shows "Cannot Save Test" with Close only', () => {
    render(
      <ValidationErrorDialog
        isOpen
        fatal={false}
        errors={oneError}
        mode="save"
        onClose={vi.fn()}
      />
    )
    expect(screen.getByText('Cannot Save Test')).toBeInTheDocument()
    expect(screen.getByTestId('validation-close-btn')).toBeInTheDocument()
    expect(screen.queryByTestId('validation-fix-all-btn')).not.toBeInTheDocument()
    expect(screen.queryByTestId('validation-delete-test-btn')).not.toBeInTheDocument()
  })

  it('mode=run shows "Cannot Run Test" with Close only', () => {
    render(
      <ValidationErrorDialog
        isOpen
        fatal={false}
        errors={oneError}
        mode="run"
        onClose={vi.fn()}
      />
    )
    expect(screen.getByText('Cannot Run Test')).toBeInTheDocument()
    expect(screen.getByTestId('validation-close-btn')).toBeInTheDocument()
    expect(screen.queryByTestId('validation-fix-all-btn')).not.toBeInTheDocument()
    expect(screen.queryByTestId('validation-delete-test-btn')).not.toBeInTheDocument()
  })

  it('mode=debug shows "Cannot Debug Test" with Close only', () => {
    render(
      <ValidationErrorDialog
        isOpen
        fatal={false}
        errors={oneError}
        mode="debug"
        onClose={vi.fn()}
      />
    )
    expect(screen.getByText('Cannot Debug Test')).toBeInTheDocument()
    expect(screen.getByTestId('validation-close-btn')).toBeInTheDocument()
    expect(screen.queryByTestId('validation-fix-all-btn')).not.toBeInTheDocument()
    expect(screen.queryByTestId('validation-delete-test-btn')).not.toBeInTheDocument()
  })

  it('mode=load + fatal=true shows "Cannot Load Test" with Close and Delete Test', () => {
    render(
      <ValidationErrorDialog
        isOpen
        fatal={true}
        errors={fatalErrors}
        mode="load"
        onClose={vi.fn()}
        onDeleteTest={vi.fn()}
      />
    )
    expect(screen.getByText('Cannot Load Test')).toBeInTheDocument()
    expect(screen.getByTestId('validation-close-btn')).toBeInTheDocument()
    expect(screen.getByTestId('validation-delete-test-btn')).toBeInTheDocument()
    expect(screen.queryByTestId('validation-fix-all-btn')).not.toBeInTheDocument()
  })

  it('mode=load + fatal=false shows "Test Issues Found" with Close and Fix All (fixable issue present)', () => {
    render(
      <ValidationErrorDialog
        isOpen
        fatal={false}
        errors={fixableLoadError}
        mode="load"
        onClose={vi.fn()}
        onFixAll={vi.fn()}
      />
    )
    expect(screen.getByText('Test Issues Found')).toBeInTheDocument()
    expect(screen.getByTestId('validation-close-btn')).toBeInTheDocument()
    expect(screen.getByTestId('validation-fix-all-btn')).toBeInTheDocument()
    expect(screen.queryByTestId('validation-delete-test-btn')).not.toBeInTheDocument()
  })

  describe('issue table per mode', () => {
    it('save/run/debug render a single-column issue table (no Fix column)', () => {
      const { rerender } = render(
        <ValidationErrorDialog isOpen fatal={false} errors={oneError} mode="save" onClose={vi.fn()} />
      )
      // The single-column variant should render the Issue header but NOT the Fix header.
      expect(screen.getByText(/^Issue$/)).toBeInTheDocument()
      expect(screen.queryByText(/^Fix$/)).not.toBeInTheDocument()

      for (const mode of ['run', 'debug'] as const) {
        rerender(
          <ValidationErrorDialog isOpen fatal={false} errors={oneError} mode={mode} onClose={vi.fn()} />
        )
        expect(screen.getByText(/^Issue$/)).toBeInTheDocument()
        expect(screen.queryByText(/^Fix$/)).not.toBeInTheDocument()
      }
    })

    it('load + fatal=false renders a two-column issue table (Issue + Fix)', () => {
      render(
        <ValidationErrorDialog
          isOpen
          fatal={false}
          errors={oneError}
          mode="load"
          onClose={vi.fn()}
          onFixAll={vi.fn()}
        />
      )
      expect(screen.getByText(/^Issue$/)).toBeInTheDocument()
      expect(screen.getByText(/^Fix$/)).toBeInTheDocument()
    })
  })
})
