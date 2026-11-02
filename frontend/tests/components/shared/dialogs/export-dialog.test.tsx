/**
 * ExportDialog (Shared) Component Tests
 *
 * Tests for the generic export dialog parameterized by entityLabel and hasSecrets.
 * Replaces the test-specific export dialog with a shared version.
 *
 * Component: frontend/src/components/shared/dialogs/export-dialog.tsx
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ExportDialog, type ExportDialogProps } from '@/components/shared/dialogs/export-dialog'

function renderExportDialog(props: Partial<ExportDialogProps> = {}) {
  const defaultProps: ExportDialogProps = {
    open: true,
    onOpenChange: vi.fn(),
    entityIds: ['entity-1'],
    entityNames: ['My Entity'],
    entityLabel: 'Test',
    onExport: vi.fn(),
    hasSecrets: true,
    ...props,
  }
  return render(<ExportDialog {...defaultProps} />)
}

describe('ExportDialog (Shared)', () => {
  describe('Single Entity Export', () => {
    it('shows "Export {entityLabel}" title for single entity', () => {
      renderExportDialog({ entityIds: ['e-1'], entityLabel: 'Test' })
      expect(screen.getByText('Export Test')).toBeInTheDocument()
    })

    it('shows entity name in description', () => {
      renderExportDialog({ entityIds: ['e-1'], entityNames: ['Login Flow Test'] })
      expect(screen.getByText('Login Flow Test')).toBeInTheDocument()
    })

    it('shows "Download" button text', () => {
      renderExportDialog({ entityIds: ['e-1'] })
      expect(screen.getByTestId('export-button')).toHaveTextContent('Download')
    })

    it('uses correct entityLabel for Environment', () => {
      renderExportDialog({ entityIds: ['e-1'], entityLabel: 'Environment' })
      expect(screen.getByText('Export Environment')).toBeInTheDocument()
    })

    it('uses correct entityLabel for Profile', () => {
      renderExportDialog({ entityIds: ['e-1'], entityLabel: 'Profile' })
      expect(screen.getByText('Export Profile')).toBeInTheDocument()
    })
  })

  describe('Bulk Export', () => {
    it('shows count in title for multiple entities', () => {
      renderExportDialog({ entityIds: ['e1', 'e2', 'e3'], entityNames: ['A', 'B', 'C'], entityLabel: 'Test' })
      expect(screen.getByText('Export 3 Tests')).toBeInTheDocument()
    })

    it('shows "Download ZIP" button text', () => {
      renderExportDialog({ entityIds: ['e1', 'e2'], entityNames: ['A', 'B'] })
      expect(screen.getByTestId('export-button')).toHaveTextContent('Download ZIP')
    })

    it('pluralizes entityLabel correctly for environments', () => {
      renderExportDialog({ entityIds: ['e1', 'e2'], entityNames: ['A', 'B'], entityLabel: 'Environment' })
      expect(screen.getByText('Export 2 Environments')).toBeInTheDocument()
    })

    it('pluralizes entityLabel correctly for profiles', () => {
      renderExportDialog({ entityIds: ['e1', 'e2'], entityNames: ['A', 'B'], entityLabel: 'Profile' })
      expect(screen.getByText('Export 2 Profiles')).toBeInTheDocument()
    })
  })

  describe('Format Selection', () => {
    it('defaults to YAML format', () => {
      renderExportDialog()
      expect(screen.getByTestId('format-yaml')).toHaveAttribute('data-state', 'checked')
    })

    it('allows selecting JSON format', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderExportDialog()
      await user.click(screen.getByTestId('format-json'))
      expect(screen.getByTestId('format-json')).toHaveAttribute('data-state', 'checked')
    })
  })

  describe('Default Format Prop', () => {
    it('preselects JSON when defaultFormat is json', () => {
      renderExportDialog({ defaultFormat: 'json' })
      expect(screen.getByTestId('format-json')).toHaveAttribute('data-state', 'checked')
      expect(screen.getByTestId('format-yaml')).toHaveAttribute('data-state', 'unchecked')
    })

    it('exports with the json default without user interaction', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleExport = vi.fn()

      renderExportDialog({ defaultFormat: 'json', hasSecrets: false, onExport: handleExport })
      await user.click(screen.getByTestId('export-button'))

      expect(handleExport).toHaveBeenCalledWith({ format: 'json', secrets: 'mask' })
    })

    it('still allows switching away from the json default', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleExport = vi.fn()

      renderExportDialog({ defaultFormat: 'json', onExport: handleExport })
      await user.click(screen.getByTestId('format-yaml'))
      await user.click(screen.getByTestId('export-button'))

      expect(handleExport).toHaveBeenCalledWith({ format: 'yaml', secrets: 'mask' })
    })

    it('keeps YAML preselected when defaultFormat is omitted', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleExport = vi.fn()

      renderExportDialog({ onExport: handleExport })
      expect(screen.getByTestId('format-yaml')).toHaveAttribute('data-state', 'checked')
      await user.click(screen.getByTestId('export-button'))

      expect(handleExport).toHaveBeenCalledWith({ format: 'yaml', secrets: 'mask' })
    })

    it('accepts an explicit yaml defaultFormat', () => {
      renderExportDialog({ defaultFormat: 'yaml' })
      expect(screen.getByTestId('format-yaml')).toHaveAttribute('data-state', 'checked')
    })
  })

  describe('Secrets Mode Picker', () => {
    it('secrets mode picker is shown when hasSecrets is true (default)', () => {
      renderExportDialog({ hasSecrets: true })
      expect(screen.getByTestId('secrets-mode-picker')).toBeInTheDocument()
    })

    it('mask mode is selected by default', () => {
      renderExportDialog({ hasSecrets: true })
      expect(screen.getByTestId('secrets-mode-mask')).toHaveAttribute('data-state', 'checked')
    })

    it('shows the "Secret values" group label', () => {
      renderExportDialog({ hasSecrets: true })
      expect(screen.getByText('Secret values')).toBeInTheDocument()
    })

    it('reveals the amber plaintext warning when Decrypt is chosen', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderExportDialog({ hasSecrets: true })
      expect(screen.queryByTestId('secrets-plaintext-warning')).not.toBeInTheDocument()

      await user.click(screen.getByTestId('secrets-mode-plaintext'))
      expect(screen.getByTestId('secrets-plaintext-warning')).toHaveTextContent(
        'Secrets will be written in plain text. Handle the exported file securely.',
      )
    })

    it('hides the picker when hasSecrets is false', () => {
      renderExportDialog({ hasSecrets: false })
      expect(screen.queryByTestId('secrets-mode-picker')).not.toBeInTheDocument()
    })

    it('defaults hasSecrets to true when not provided', () => {
      const props: Partial<ExportDialogProps> = {
        open: true,
        onOpenChange: vi.fn(),
        entityIds: ['e-1'],
        entityNames: ['Name'],
        entityLabel: 'Test',
        onExport: vi.fn(),
      }
      render(<ExportDialog {...(props as ExportDialogProps)} />)
      expect(screen.getByTestId('secrets-mode-picker')).toBeInTheDocument()
    })
  })

  describe('Environment Mode', () => {
    it('does not show the secrets picker when entityLabel is Environment and hasSecrets is false', () => {
      renderExportDialog({ entityLabel: 'Environment', hasSecrets: false })
      expect(screen.queryByTestId('secrets-mode-picker')).not.toBeInTheDocument()
      expect(screen.queryByText('Secret values')).not.toBeInTheDocument()
    })
  })

  describe('Callbacks', () => {
    it('calls onExport with the default mask mode when hasSecrets', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleExport = vi.fn()

      renderExportDialog({ onExport: handleExport, hasSecrets: true })
      await user.click(screen.getByTestId('export-button'))

      expect(handleExport).toHaveBeenCalledWith({ format: 'yaml', secrets: 'mask' })
    })

    it('calls onExport with the chosen secrets mode', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleExport = vi.fn()

      renderExportDialog({ onExport: handleExport, hasSecrets: true })
      await user.click(screen.getByTestId('secrets-mode-encrypted'))
      await user.click(screen.getByTestId('export-button'))

      expect(handleExport).toHaveBeenCalledWith({ format: 'yaml', secrets: 'encrypted' })
    })

    it('still emits mask when hasSecrets is false', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleExport = vi.fn()

      renderExportDialog({ onExport: handleExport, hasSecrets: false })
      await user.click(screen.getByTestId('export-button'))

      expect(handleExport).toHaveBeenCalledWith({ format: 'yaml', secrets: 'mask' })
    })

    it('calls onOpenChange(false) when Cancel clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleOpenChange = vi.fn()

      renderExportDialog({ onOpenChange: handleOpenChange })
      await user.click(screen.getByText('Cancel'))

      expect(handleOpenChange).toHaveBeenCalledWith(false)
    })

    it('shows loading state during export', () => {
      renderExportDialog({ loading: true })
      expect(screen.getByTestId('export-button')).toHaveTextContent('Exporting…')
      expect(screen.getByTestId('export-button')).toBeDisabled()
    })
  })
})
