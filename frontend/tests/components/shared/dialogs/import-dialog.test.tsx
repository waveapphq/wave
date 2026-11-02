/**
 * ImportDialog (Shared) Component Tests
 *
 * Tests for the generic import dialog parameterized by entityLabel.
 * Replaces the test-specific import dialog with a shared version.
 *
 * Component: frontend/src/components/shared/dialogs/import-dialog.tsx
 */

import { describe, it, expect, vi } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import { ImportDialog, type ImportDialogProps } from '@/components/shared/dialogs/import-dialog'
import type { ValidateImportResult, ImportResult, ValidationItemResult } from '@/types/import-export'

const mockValidateResult: ValidateImportResult = {
  items: [
    { name: 'Item One', status: 'ok', fatal_errors: [], fixable_errors: [], warnings: [], existing_id: null },
    { name: 'Item Two', status: 'conflict', fatal_errors: [], fixable_errors: [], warnings: [], existing_id: 'existing-id' },
  ],
  total: 2,
  importable: 2,
  blocked: 0,
}

const mockImportResult: ImportResult = {
  imported: [
    { name: 'Item One', id: 'new-1', action: 'created' },
    { name: 'Item Two (2)', id: 'new-2', action: 'renamed' },
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
    entityLabel: 'Test',
    onValidate: vi.fn().mockResolvedValue(mockValidateResult),
    onImport: vi.fn().mockResolvedValue(mockImportResult),
    onImportComplete: vi.fn(),
    ...props,
  }
  return render(<ImportDialog {...defaultProps} />)
}

describe('ImportDialog (Shared)', () => {
  describe('Upload Step', () => {
    it('shows drop zone', () => {
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
      const file = new File(['content'], 'my-items.yaml', { type: 'application/x-yaml' })
      const input = screen.getByTestId('file-input')
      await user.upload(input, file)

      expect(screen.getByText('my-items.yaml')).toBeInTheDocument()
    })

    it('Validate button is disabled without file', () => {
      renderImportDialog()
      expect(screen.getByTestId('validate-button')).toBeDisabled()
    })

    it('Validate button is enabled with file', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderImportDialog()
      const file = new File(['content'], 'data.yaml', { type: 'application/x-yaml' })
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
      const file = new File(['content'], 'data.yaml')
      await user.upload(screen.getByTestId('file-input'), file)
      await user.click(screen.getByTestId('validate-button'))

      expect(screen.getByTestId('validate-button')).toHaveTextContent('Validating…')

      await act(async () => {
        resolveValidation(mockValidateResult)
      })
    })

    it('shows correct title using entityLabel', () => {
      renderImportDialog({ entityLabel: 'Environment' })
      expect(screen.getByText('Import Environments')).toBeInTheDocument()
    })

    it('shows correct title for profiles', () => {
      renderImportDialog({ entityLabel: 'Profile' })
      expect(screen.getByText('Import Profiles')).toBeInTheDocument()
    })

    it('shows correct title for tests', () => {
      renderImportDialog({ entityLabel: 'Test' })
      expect(screen.getByText('Import Tests')).toBeInTheDocument()
    })
  })

  describe('Review Step', () => {
    async function goToReviewStep(props: Partial<ImportDialogProps> = {}) {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderImportDialog(props)
      const file = new File(['content'], 'data.yaml')
      await user.upload(screen.getByTestId('file-input'), file)
      await user.click(screen.getByTestId('validate-button'))

      await waitFor(() => expect(screen.getByTestId('review-step')).toBeInTheDocument())
      return user
    }

    it('shows per-item validation results', async () => {
      await goToReviewStep()
      expect(screen.getByTestId('item-result-Item One')).toBeInTheDocument()
      expect(screen.getByTestId('item-result-Item Two')).toBeInTheDocument()
    })

    it('shows item names', async () => {
      await goToReviewStep()
      expect(screen.getByText('Item One')).toBeInTheDocument()
      expect(screen.getByText('Item Two')).toBeInTheDocument()
    })

    it('shows conflict resolution dropdown for conflicts', async () => {
      await goToReviewStep()
      expect(screen.getByTestId('resolution-Item Two')).toBeInTheDocument()
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

    it('shows fatal status for blocked items', async () => {
      const fatalResult: ValidateImportResult = {
        items: [
          { name: 'Bad Item', status: 'fatal', fatal_errors: [{ code: 'INVALID_FORMAT', message: 'Invalid format' }], fixable_errors: [], warnings: [], existing_id: null },
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
        items: [
          { name: 'Fix Item', status: 'fixable', fatal_errors: [], fixable_errors: [{ code: 'MISSING_FIELD', message: 'Missing field' }], warnings: [], existing_id: null },
        ],
        total: 1,
        importable: 1,
        blocked: 0,
      }
      await goToReviewStep({ onValidate: vi.fn().mockResolvedValue(fixableResult) })
      expect(screen.getByText('Will auto-fix')).toBeInTheDocument()
    })

    it('disables Import when all items are blocked', async () => {
      const allBlocked: ValidateImportResult = {
        items: [
          { name: 'Bad', status: 'fatal', fatal_errors: [{ code: 'X', message: 'Y' }], fixable_errors: [], warnings: [], existing_id: null },
        ],
        total: 1,
        importable: 0,
        blocked: 1,
      }
      await goToReviewStep({ onValidate: vi.fn().mockResolvedValue(allBlocked) })
      expect(screen.getByTestId('import-button')).toBeDisabled()
    })
  })

  // The review row surfaces WHICH axis collided (name / id / both)
  // as a muted sublabel under the name. Driven by the optional conflict_reason
  // field added to ValidationItemResult.
  describe('Conflict Reason Sublabel', () => {
    type ConflictReason = 'name' | 'id' | 'both'
    type ReviewItem = ValidationItemResult & { conflict_reason?: ConflictReason }

    function makeItem(overrides: Partial<ReviewItem> & { name: string }): ReviewItem {
      return {
        status: 'conflict',
        fatal_errors: [],
        fixable_errors: [],
        warnings: [],
        existing_id: 'existing-id',
        ...overrides,
      }
    }

    function resultWith(items: ReviewItem[]): ValidateImportResult {
      const importable = items.filter((item) => item.status !== 'fatal').length
      return { items, total: items.length, importable, blocked: items.length - importable }
    }

    async function goToReview(items: ReviewItem[]) {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const onImport = vi.fn().mockResolvedValue(mockImportResult)
      renderImportDialog({
        onValidate: vi.fn().mockResolvedValue(resultWith(items)),
        onImport,
      })
      const file = new File(['content'], 'data.yaml')
      await user.upload(screen.getByTestId('file-input'), file)
      await user.click(screen.getByTestId('validate-button'))
      await waitFor(() => expect(screen.getByTestId('review-step')).toBeInTheDocument())
      return { user, onImport }
    }

    it('renders the name-conflict sublabel', async () => {
      await goToReview([makeItem({ name: 'Greeter', conflict_reason: 'name' })])
      const row = within(screen.getByTestId('item-result-Greeter'))
      expect(row.getByText('Name already in use')).toBeInTheDocument()
    })

    it('renders the id-collision sublabel', async () => {
      await goToReview([makeItem({ name: 'Newcomer', conflict_reason: 'id' })])
      const row = within(screen.getByTestId('item-result-Newcomer'))
      expect(row.getByText('ID already in library')).toBeInTheDocument()
    })

    it('renders the name-and-id sublabel', async () => {
      await goToReview([makeItem({ name: 'Twin', conflict_reason: 'both' })])
      const row = within(screen.getByTestId('item-result-Twin'))
      expect(row.getByText('Name and ID already in library')).toBeInTheDocument()
    })

    it('id-collision row still shows the resolution dropdown', async () => {
      await goToReview([makeItem({ name: 'Newcomer', conflict_reason: 'id' })])
      expect(screen.getByTestId('resolution-Newcomer')).toBeInTheDocument()
    })

    it('renders no sublabel for a conflict without a conflict_reason', async () => {
      await goToReview([makeItem({ name: 'Plain', conflict_reason: undefined })])
      expect(screen.queryByText(/already in (use|library)/i)).not.toBeInTheDocument()
    })

    it('renders no sublabel on an ok row', async () => {
      await goToReview([makeItem({ name: 'Clean', status: 'ok', existing_id: null })])
      expect(screen.queryByText(/already in (use|library)/i)).not.toBeInTheDocument()
    })

    it('renders no sublabel on a blocked row and keeps the Blocked text', async () => {
      await goToReview([
        makeItem({
          name: 'Bad',
          status: 'fatal',
          fatal_errors: [{ code: 'X', message: 'Y' }],
          existing_id: null,
        }),
      ])
      expect(screen.queryByText(/already in (use|library)/i)).not.toBeInTheDocument()
      expect(screen.getByText('Blocked')).toBeInTheDocument()
    })

    it('still posts the chosen resolution for an id collision', async () => {
      const { user, onImport } = await goToReview([
        makeItem({ name: 'Newcomer', conflict_reason: 'id' }),
      ])
      await user.click(screen.getByTestId('resolution-Newcomer'))
      await waitFor(() => {
        expect(screen.getByRole('option', { name: /Overwrite/i })).toBeInTheDocument()
      })
      await user.click(screen.getByRole('option', { name: /Overwrite/i }))
      await user.click(screen.getByTestId('import-button'))
      await waitFor(() => {
        expect(onImport).toHaveBeenCalledWith(
          expect.any(File),
          expect.objectContaining({ Newcomer: 'overwrite' })
        )
      })
    })
  })

  // The dialog renders each item's warnings[] as amber sublabels under the name
  // (same slot as the conflict-reason sublabel). Surfaces FOREIGN_ENCRYPTED_SECRET
  // and MASKED_SECRET warnings.
  describe('Secret Warning Sublabel', () => {
    const FOREIGN_MESSAGE =
      "Secret 'api_key' is encrypted by another WAVE instance and cannot be decrypted here; re-enter it after import"

    function makeItem(overrides: Partial<ValidationItemResult> & { name: string }): ValidationItemResult {
      return {
        status: 'ok',
        fatal_errors: [],
        fixable_errors: [],
        warnings: [],
        existing_id: null,
        ...overrides,
      }
    }

    function resultWith(items: ValidationItemResult[]): ValidateImportResult {
      const importable = items.filter((item) => item.status !== 'fatal').length
      return { items, total: items.length, importable, blocked: items.length - importable }
    }

    async function goToReview(items: ValidationItemResult[]) {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      renderImportDialog({ onValidate: vi.fn().mockResolvedValue(resultWith(items)) })
      const file = new File(['content'], 'data.yaml')
      await user.upload(screen.getByTestId('file-input'), file)
      await user.click(screen.getByTestId('validate-button'))
      await waitFor(() => expect(screen.getByTestId('review-step')).toBeInTheDocument())
      return user
    }

    it('renders a warning sublabel with the message text', async () => {
      await goToReview([
        makeItem({
          name: 'Foreign',
          warnings: [{ code: 'FOREIGN_ENCRYPTED_SECRET', message: FOREIGN_MESSAGE }],
        }),
      ])
      const row = within(screen.getByTestId('item-result-Foreign'))
      expect(row.getByTestId('import-item-warning')).toHaveTextContent(FOREIGN_MESSAGE)
    })

    it('renders one sublabel per warning', async () => {
      await goToReview([
        makeItem({
          name: 'Multi',
          warnings: [
            { code: 'FOREIGN_ENCRYPTED_SECRET', message: FOREIGN_MESSAGE },
            { code: 'MASKED_SECRET', message: "Variable 'other' contains a masked value" },
          ],
        }),
      ])
      const row = within(screen.getByTestId('item-result-Multi'))
      expect(row.getAllByTestId('import-item-warning')).toHaveLength(2)
    })

    it('renders no warning sublabel when the item has no warnings', async () => {
      await goToReview([makeItem({ name: 'Clean' })])
      expect(screen.queryByTestId('import-item-warning')).not.toBeInTheDocument()
    })
  })

  describe('Allowed Resolutions', () => {
    const conflictItem: ValidationItemResult = {
      name: 'api_url',
      status: 'conflict',
      fatal_errors: [],
      fixable_errors: [],
      warnings: [],
      existing_id: 'api_url',
    }

    const conflictResult: ValidateImportResult = {
      items: [conflictItem],
      total: 1,
      importable: 1,
      blocked: 0,
    }

    async function goToReview(props: Partial<ImportDialogProps> = {}) {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const onImport = vi.fn().mockResolvedValue(mockImportResult)
      renderImportDialog({
        onValidate: vi.fn().mockResolvedValue(conflictResult),
        onImport,
        ...props,
      })
      const file = new File(['content'], 'data.yaml')
      await user.upload(screen.getByTestId('file-input'), file)
      await user.click(screen.getByTestId('validate-button'))
      await waitFor(() => expect(screen.getByTestId('review-step')).toBeInTheDocument())
      return { user, onImport }
    }

    it('offers all three resolutions when the prop is omitted', async () => {
      const { user } = await goToReview()
      await user.click(screen.getByTestId('resolution-api_url'))

      await waitFor(() => {
        expect(screen.getByRole('option', { name: /Auto-rename/i })).toBeInTheDocument()
      })
      expect(screen.getByRole('option', { name: /Overwrite/i })).toBeInTheDocument()
      expect(screen.getByRole('option', { name: /Skip/i })).toBeInTheDocument()
    })

    it('keeps rename as the initial resolution when the prop is omitted', async () => {
      const { user, onImport } = await goToReview()
      await user.click(screen.getByTestId('import-button'))

      await waitFor(() => {
        expect(onImport).toHaveBeenCalledWith(
          expect.any(File),
          expect.objectContaining({ api_url: 'rename' })
        )
      })
    })

    it('renders only the allowed resolutions in the select', async () => {
      const { user } = await goToReview({ allowedResolutions: ['overwrite', 'skip'] })
      await user.click(screen.getByTestId('resolution-api_url'))

      await waitFor(() => {
        expect(screen.getByRole('option', { name: /Overwrite/i })).toBeInTheDocument()
      })
      expect(screen.getByRole('option', { name: /Skip/i })).toBeInTheDocument()
      expect(screen.queryByRole('option', { name: /Auto-rename/i })).not.toBeInTheDocument()
    })

    it('initializes conflicts to the first allowed resolution', async () => {
      const { user, onImport } = await goToReview({ allowedResolutions: ['overwrite', 'skip'] })
      expect(screen.getByTestId('resolution-api_url')).toHaveTextContent('Overwrite')

      await user.click(screen.getByTestId('import-button'))

      await waitFor(() => {
        expect(onImport).toHaveBeenCalledWith(
          expect.any(File),
          expect.objectContaining({ api_url: 'overwrite' })
        )
      })
    })

    it('honors the order of allowedResolutions for the initial value', async () => {
      await goToReview({ allowedResolutions: ['skip', 'overwrite'] })
      expect(screen.getByTestId('resolution-api_url')).toHaveTextContent('Skip')
    })

    it('posts a manually chosen allowed resolution', async () => {
      const { user, onImport } = await goToReview({ allowedResolutions: ['overwrite', 'skip'] })
      await user.click(screen.getByTestId('resolution-api_url'))
      await waitFor(() => {
        expect(screen.getByRole('option', { name: /Skip/i })).toBeInTheDocument()
      })
      await user.click(screen.getByRole('option', { name: /Skip/i }))
      await user.click(screen.getByTestId('import-button'))

      await waitFor(() => {
        expect(onImport).toHaveBeenCalledWith(
          expect.any(File),
          expect.objectContaining({ api_url: 'skip' })
        )
      })
    })
  })

  describe('Drag and Drop', () => {
    function fireDragOver(target: Element) {
      act(() => {
        const evt = new Event('dragover', { bubbles: true, cancelable: true })
        Object.defineProperty(evt, 'dataTransfer', { value: { dropEffect: '' } })
        target.dispatchEvent(evt)
      })
    }

    function fireDragLeave(target: Element, relatedTarget: Element | null) {
      act(() => {
        const evt = new Event('dragleave', { bubbles: true })
        Object.defineProperty(evt, 'relatedTarget', { value: relatedTarget })
        target.dispatchEvent(evt)
      })
    }

    function fireDrop(target: Element, files: File[]) {
      act(() => {
        const evt = new Event('drop', { bubbles: true, cancelable: true })
        Object.defineProperty(evt, 'dataTransfer', { value: { files } })
        target.dispatchEvent(evt)
      })
    }

    it('sets dragOver on dragover event over drop zone', () => {
      renderImportDialog()
      const dropZone = screen.getByTestId('drop-zone')
      const childEl = dropZone.querySelector('p')!

      fireDragOver(childEl)

      // The drop zone should have the active border class
      expect(dropZone.className).toContain('border-primary')
      expect(dropZone.className).toContain('bg-primary/5')
    })

    it('clears dragOver on dragleave event leaving drop zone', () => {
      renderImportDialog()
      const dropZone = screen.getByTestId('drop-zone')
      const childEl = dropZone.querySelector('p')!

      // First trigger dragover inside
      fireDragOver(childEl)
      expect(dropZone.className).toContain('bg-primary/5')

      // Then dragleave with relatedTarget outside
      fireDragLeave(dropZone, document.body)

      // dragOver state should be cleared
      expect(dropZone.className).not.toContain('bg-primary/5')
    })

    it('handles file drop on drop zone', () => {
      renderImportDialog()
      const dropZone = screen.getByTestId('drop-zone')
      const childEl = dropZone.querySelector('p')!

      const file = new File(['content'], 'dropped.yaml', { type: 'application/x-yaml' })
      fireDrop(childEl, [file])

      // File name should appear
      expect(screen.getByText('dropped.yaml')).toBeInTheDocument()
    })

    it('ignores drop outside drop zone', () => {
      renderImportDialog()

      const file = new File(['content'], 'outside.yaml', { type: 'application/x-yaml' })
      fireDrop(document.body, [file])

      // File name should NOT appear
      expect(screen.queryByText('outside.yaml')).not.toBeInTheDocument()
    })

    it('clears dragOver when dragover occurs outside drop zone', () => {
      renderImportDialog()
      const dropZone = screen.getByTestId('drop-zone')
      const childEl = dropZone.querySelector('p')!

      // First dragover inside
      fireDragOver(childEl)
      expect(dropZone.className).toContain('bg-primary/5')

      // Then dragover outside (on body, which bubbles to window)
      fireDragOver(document.body)

      expect(dropZone.className).not.toContain('bg-primary/5')
    })
  })

  describe('Shared Drop Zone', () => {
    it('renders the upload step through the shared drop zone in its default layout', () => {
      renderImportDialog()
      expect(screen.getByTestId('drop-zone')).toHaveAttribute('data-layout', 'default')
    })

    it('keeps the drop zone a button named by its prompt', () => {
      renderImportDialog()
      expect(screen.getByRole('button', { name: /Click or drop file here/ })).toBe(
        screen.getByTestId('drop-zone')
      )
    })

    it('keeps the file-input test id on the input with the import accept list', () => {
      renderImportDialog()
      const input = screen.getByTestId('file-input')
      expect(input).toHaveAttribute('type', 'file')
      expect(input).toHaveAttribute('accept', '.yaml,.yml,.json,.zip')
    })

    it('opens the file picker when Enter is pressed on the drop zone', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderImportDialog()
      const opened = vi.fn()
      screen.getByTestId('file-input').addEventListener('click', opened)
      screen.getByTestId('drop-zone').focus()
      await user.keyboard('{Enter}')

      expect(opened).toHaveBeenCalledTimes(1)
    })

    it('enables Validate after a file is dropped on the zone', () => {
      renderImportDialog()
      const prompt = within(screen.getByTestId('drop-zone')).getByText('Click or drop file here')

      act(() => {
        const evt = new Event('drop', { bubbles: true, cancelable: true })
        Object.defineProperty(evt, 'dataTransfer', {
          value: { files: [new File(['content'], 'dropped.yaml')] },
        })
        prompt.dispatchEvent(evt)
      })

      expect(within(screen.getByTestId('drop-zone')).getByText('dropped.yaml')).toBeInTheDocument()
      expect(screen.getByTestId('validate-button')).toBeEnabled()
    })

    it('still shows the chosen file name after stepping back from review', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderImportDialog()
      await user.upload(screen.getByTestId('file-input'), new File(['content'], 'kept.yaml'))
      await user.click(screen.getByTestId('validate-button'))
      await waitFor(() => expect(screen.getByTestId('review-step')).toBeInTheDocument())
      await user.click(screen.getByTestId('back-button'))

      expect(within(screen.getByTestId('drop-zone')).getByText('kept.yaml')).toBeInTheDocument()
      expect(screen.getByTestId('validate-button')).toBeEnabled()
    })
  })

  describe('Conflict Resolution', () => {
    it('changes conflict resolution for an item', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleImport = vi.fn().mockResolvedValue(mockImportResult)

      renderImportDialog({ onImport: handleImport })
      const file = new File(['content'], 'data.yaml')
      await user.upload(screen.getByTestId('file-input'), file)
      await user.click(screen.getByTestId('validate-button'))

      const { waitFor } = await import('@testing-library/react')
      await waitFor(() => expect(screen.getByTestId('review-step')).toBeInTheDocument())

      // Click the resolution dropdown for the conflict item
      const resolutionTrigger = screen.getByTestId('resolution-Item Two')
      await user.click(resolutionTrigger)

      // Wait for options to appear and select overwrite
      await waitFor(() => {
        expect(screen.getByRole('option', { name: /Overwrite/i })).toBeInTheDocument()
      })
      await user.click(screen.getByRole('option', { name: /Overwrite/i }))

      // Now import
      await user.click(screen.getByTestId('import-button'))

      await waitFor(() => {
        expect(handleImport).toHaveBeenCalledWith(
          expect.any(File),
          expect.objectContaining({ 'Item Two': 'overwrite' })
        )
      })
    })
  })

  describe('Error Handling', () => {
    it('handles validation error gracefully', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      const failingValidate = vi.fn().mockRejectedValue(new Error('Server said no'))
      renderImportDialog({ onValidate: failingValidate })

      const file = new File(['content'], 'data.yaml')
      await user.upload(screen.getByTestId('file-input'), file)
      await user.click(screen.getByTestId('validate-button'))

      // Should remain on upload step (not crash)
      await waitFor(() => {
        expect(screen.getByTestId('validate-button')).toHaveTextContent('Validate')
      })
      expect(screen.getByTestId('drop-zone')).toBeInTheDocument()
      expect(await screen.findByTestId('import-dialog-error')).toHaveTextContent('Server said no')
    })

    it('names a validation rejection that is not an Error', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      const failingValidate = vi.fn().mockRejectedValue('offline')
      renderImportDialog({ onValidate: failingValidate })

      const file = new File(['content'], 'data.yaml')
      await user.upload(screen.getByTestId('file-input'), file)
      await user.click(screen.getByTestId('validate-button'))

      expect(await screen.findByTestId('import-dialog-error')).toHaveTextContent(
        'Validation failed'
      )
    })

    it('clears the reported failure when the file is validated again', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      const onValidate = vi
        .fn()
        .mockRejectedValueOnce(new Error('Server said no'))
        .mockResolvedValue(mockValidateResult)
      renderImportDialog({ onValidate })

      const file = new File(['content'], 'data.yaml')
      await user.upload(screen.getByTestId('file-input'), file)
      await user.click(screen.getByTestId('validate-button'))
      expect(await screen.findByTestId('import-dialog-error')).toBeInTheDocument()

      await user.click(screen.getByTestId('validate-button'))
      await waitFor(() => expect(screen.getByTestId('review-step')).toBeInTheDocument())
      expect(screen.queryByTestId('import-dialog-error')).not.toBeInTheDocument()
    })

    it('handles import error gracefully', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      const failingImport = vi.fn().mockRejectedValue(new Error('Disk is full'))
      renderImportDialog({ onImport: failingImport })

      const file = new File(['content'], 'data.yaml')
      await user.upload(screen.getByTestId('file-input'), file)
      await user.click(screen.getByTestId('validate-button'))

      await waitFor(() => expect(screen.getByTestId('review-step')).toBeInTheDocument())

      await user.click(screen.getByTestId('import-button'))

      // Should remain on review step (not crash), button should return to normal
      await waitFor(() => {
        expect(screen.getByTestId('import-button')).toHaveTextContent('Import')
      })
      expect(await screen.findByTestId('import-dialog-error')).toHaveTextContent('Disk is full')
    })

    it('drops the reported failure when the user steps back to upload', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      const failingImport = vi.fn().mockRejectedValue(new Error('Disk is full'))
      renderImportDialog({ onImport: failingImport })

      const file = new File(['content'], 'data.yaml')
      await user.upload(screen.getByTestId('file-input'), file)
      await user.click(screen.getByTestId('validate-button'))
      await waitFor(() => expect(screen.getByTestId('review-step')).toBeInTheDocument())
      await user.click(screen.getByTestId('import-button'))
      expect(await screen.findByTestId('import-dialog-error')).toBeInTheDocument()

      await user.click(screen.getByTestId('back-button'))
      expect(screen.queryByTestId('import-dialog-error')).not.toBeInTheDocument()
    })
  })

  describe('End-to-End', () => {
    it('calls onImport with file and resolutions', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleImport = vi.fn().mockResolvedValue(mockImportResult)
      const handleComplete = vi.fn()

      renderImportDialog({ onImport: handleImport, onImportComplete: handleComplete })
      const file = new File(['content'], 'data.yaml')
      await user.upload(screen.getByTestId('file-input'), file)
      await user.click(screen.getByTestId('validate-button'))
      await waitFor(() => expect(screen.getByTestId('review-step')).toBeInTheDocument())
      await user.click(screen.getByTestId('import-button'))

      await waitFor(() => {
        expect(handleImport).toHaveBeenCalled()
      })
    })

    it('calls onImportComplete after successful import', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleComplete = vi.fn()

      renderImportDialog({ onImportComplete: handleComplete })
      const file = new File(['content'], 'data.yaml')
      await user.upload(screen.getByTestId('file-input'), file)
      await user.click(screen.getByTestId('validate-button'))
      await waitFor(() => expect(screen.getByTestId('review-step')).toBeInTheDocument())
      await user.click(screen.getByTestId('import-button'))

      await waitFor(() => {
        expect(handleComplete).toHaveBeenCalledWith(mockImportResult)
      })
    })
  })
})
