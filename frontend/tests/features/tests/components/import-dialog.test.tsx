/**
 * ImportDialog (Tests) Adapter Tests
 *
 * Tests for the test-specific import dialog adapter that wraps the
 * shared ImportDialog. Verifies that test-specific API types are
 * correctly mapped to/from the shared generic types.
 *
 * Component: frontend/src/components/tests/import-dialog.tsx
 */

import { describe, it, expect, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { ImportDialog, type ImportDialogProps } from '@/features/tests/components/import-dialog'
import type { ValidateImportResult, ImportResult } from '@/features/tests/api/types'

const mockValidateResult: ValidateImportResult = {
  tests: [
    { name: 'Test One', status: 'ok', fatal_errors: [], fixable_errors: [], warnings: [], existing_test_id: null },
    { name: 'Test Two', status: 'conflict', fatal_errors: [], fixable_errors: [], warnings: [], existing_test_id: 'existing-id' },
  ],
  total: 2,
  importable: 2,
  blocked: 0,
}

const mockImportResult: ImportResult = {
  imported: [
    { name: 'Test One', id: 'new-1', action: 'created' },
    { name: 'Test Two (2)', id: 'new-2', action: 'renamed' },
  ],
  skipped: [],
  fixes_applied: [],
  total_imported: 2,
  total_skipped: 0,
}

function renderImportDialog(props: Partial<ImportDialogProps> = {}) {
  const defaultProps: ImportDialogProps = {
    open: true,
    onOpenChange: vi.fn(),
    onValidate: vi.fn().mockResolvedValue(mockValidateResult),
    onImport: vi.fn().mockResolvedValue(mockImportResult),
    onImportComplete: vi.fn(),
    ...props,
  }
  return render(<ImportDialog {...defaultProps} />)
}

describe('ImportDialog (Tests Adapter)', () => {
  describe('Delegation to shared dialog', () => {
    it('renders the shared import dialog with Test entity label', () => {
      renderImportDialog()
      expect(screen.getByText('Import Tests')).toBeInTheDocument()
    })

    it('shows drop zone from shared dialog', () => {
      renderImportDialog()
      expect(screen.getByTestId('drop-zone')).toBeInTheDocument()
    })

    it('shows accepted file types', () => {
      renderImportDialog()
      expect(screen.getByText('.yaml, .json, or .zip')).toBeInTheDocument()
    })

    it('shows file name after selection', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderImportDialog()
      const file = new File(['content'], 'my-tests.yaml', { type: 'application/x-yaml' })
      const input = screen.getByTestId('file-input')
      await user.upload(input, file)

      expect(screen.getByText('my-tests.yaml')).toBeInTheDocument()
    })

    it('Validate button is disabled without file', () => {
      renderImportDialog()
      expect(screen.getByTestId('validate-button')).toBeDisabled()
    })

    it('Validate button is enabled with file', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderImportDialog()
      const file = new File(['content'], 'test.yaml', { type: 'application/x-yaml' })
      await user.upload(screen.getByTestId('file-input'), file)

      expect(screen.getByTestId('validate-button')).toBeEnabled()
    })

    it('shows loading state during validation', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      let resolveValidation!: (value: ValidateImportResult) => void
      const slowValidate = new Promise<ValidateImportResult>((resolve) => {
        resolveValidation = resolve
      })

      renderImportDialog({ onValidate: vi.fn().mockReturnValue(slowValidate) })
      const file = new File(['content'], 'test.yaml')
      await user.upload(screen.getByTestId('file-input'), file)
      await user.click(screen.getByTestId('validate-button'))

      expect(screen.getByTestId('validate-button')).toHaveTextContent('Validating…')

      await act(async () => {
        resolveValidation(mockValidateResult)
      })
    })
  })

  describe('Type mapping - validation results', () => {
    async function goToReviewStep(props: Partial<ImportDialogProps> = {}) {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderImportDialog(props)
      const file = new File(['content'], 'test.yaml')
      await user.upload(screen.getByTestId('file-input'), file)
      await user.click(screen.getByTestId('validate-button'))

      await waitFor(() => expect(screen.getByTestId('review-step')).toBeInTheDocument())
      return user
    }

    it('maps test-specific .tests array to shared .items display', async () => {
      await goToReviewStep()
      // The shared dialog renders items with item-result-{name} test IDs
      expect(screen.getByTestId('item-result-Test One')).toBeInTheDocument()
      expect(screen.getByTestId('item-result-Test Two')).toBeInTheDocument()
    })

    it('displays test names correctly after type mapping', async () => {
      await goToReviewStep()
      expect(screen.getByText('Test One')).toBeInTheDocument()
      expect(screen.getByText('Test Two')).toBeInTheDocument()
    })

    it('shows conflict resolution dropdown for conflicts', async () => {
      await goToReviewStep()
      expect(screen.getByTestId('resolution-Test Two')).toBeInTheDocument()
    })

    it('shows import summary', async () => {
      await goToReviewStep()
      expect(screen.getByTestId('import-summary')).toHaveTextContent('2 importable, 0 blocked')
    })

    it('shows Import button', async () => {
      await goToReviewStep()
      expect(screen.getByTestId('import-button')).toBeInTheDocument()
    })

    it('shows Back button', async () => {
      await goToReviewStep()
      expect(screen.getByTestId('back-button')).toBeInTheDocument()
    })

    it('Back button returns to upload step', async () => {
      const user = await goToReviewStep()
      await user.click(screen.getByTestId('back-button'))
      expect(screen.getByTestId('drop-zone')).toBeInTheDocument()
    })

    it('shows fatal status for blocked tests', async () => {
      const fatalResult: ValidateImportResult = {
        tests: [
          { name: 'Bad Test', status: 'fatal', fatal_errors: [{ code: 'MISSING_WORKFLOW', message: 'No workflow' }], fixable_errors: [], warnings: [], existing_test_id: null },
        ],
        total: 1,
        importable: 0,
        blocked: 1,
      }
      await goToReviewStep({ onValidate: vi.fn().mockResolvedValue(fatalResult) })
      expect(screen.getByText('Blocked')).toBeInTheDocument()
    })

    it('shows fixable status', async () => {
      const fixableResult: ValidateImportResult = {
        tests: [
          { name: 'Fix Test', status: 'fixable', fatal_errors: [], fixable_errors: [{ code: 'MISSING_POSITION', message: 'Position' }], warnings: [], existing_test_id: null },
        ],
        total: 1,
        importable: 1,
        blocked: 0,
      }
      await goToReviewStep({ onValidate: vi.fn().mockResolvedValue(fixableResult) })
      expect(screen.getByText('Will auto-fix')).toBeInTheDocument()
    })

    it('disables Import when all tests are blocked', async () => {
      const allBlocked: ValidateImportResult = {
        tests: [
          { name: 'Bad', status: 'fatal', fatal_errors: [{ code: 'X', message: 'Y' }], fixable_errors: [], warnings: [], existing_test_id: null },
        ],
        total: 1,
        importable: 0,
        blocked: 1,
      }
      await goToReviewStep({ onValidate: vi.fn().mockResolvedValue(allBlocked) })
      expect(screen.getByTestId('import-button')).toBeDisabled()
    })
  })

  describe('Type mapping - import results', () => {
    it('calls onImport with file and resolutions', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleImport = vi.fn().mockResolvedValue(mockImportResult)
      const handleComplete = vi.fn()

      renderImportDialog({ onImport: handleImport, onImportComplete: handleComplete })
      const file = new File(['content'], 'test.yaml')
      await user.upload(screen.getByTestId('file-input'), file)
      await user.click(screen.getByTestId('validate-button'))
      await waitFor(() => expect(screen.getByTestId('review-step')).toBeInTheDocument())
      await user.click(screen.getByTestId('import-button'))

      await waitFor(() => {
        expect(handleImport).toHaveBeenCalled()
      })
    })

    it('calls onImportComplete with test-specific result after successful import', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleComplete = vi.fn()

      renderImportDialog({ onImportComplete: handleComplete })
      const file = new File(['content'], 'test.yaml')
      await user.upload(screen.getByTestId('file-input'), file)
      await user.click(screen.getByTestId('validate-button'))
      await waitFor(() => expect(screen.getByTestId('review-step')).toBeInTheDocument())
      await user.click(screen.getByTestId('import-button'))

      await waitFor(() => {
        expect(handleComplete).toHaveBeenCalledWith(
          expect.objectContaining({
            imported: expect.arrayContaining([
              expect.objectContaining({ name: 'Test One', id: 'new-1', action: 'created' }),
            ]),
            total_imported: 2,
            total_skipped: 0,
          })
        )
      })
    })
  })
})
