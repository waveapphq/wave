/**
 * SystemVariablesTab Component Tests
 *
 * Tests for the system variables settings tab - read-only display with
 * EditDialog pattern for editing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SystemVariablesTab } from '@/features/settings/components/global-variables-tab'

// ============================================================================
// Mocks
// ============================================================================

// Mock the API
vi.mock('@/features/settings/api/global-variables/crud', () => ({
  fetchSystemVariables: vi.fn(),
  saveSystemVariables: vi.fn(),
}))
vi.mock('@/features/settings/api/global-variables/import-export', () => ({
  exportSystemVariables: vi.fn(),
  validateSystemVariablesImport: vi.fn(),
  importSystemVariables: vi.fn(),
}))

// Mock toast
const mockToastSuccess = vi.fn()
const mockToastError = vi.fn()
vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({
    success: mockToastSuccess,
    error: mockToastError,
  }),
}))

// Mock EditDialog - simplified version that renders children when open
vi.mock('@/components/ui/edit-dialog', () => ({
  EditDialog: ({
    open,
    onOpenChange,
    children,
    onSave,
    'data-testid': testId,
  }: {
    open: boolean
    onOpenChange: (open: boolean) => void
    title: string
    description?: string
    children: React.ReactNode
    onSave: () => Promise<void>
    onDiscard?: () => void
    isDirty: boolean
    saveDisabled?: boolean
    className?: string
    'data-testid'?: string
  }) =>
    open ? (
      <div data-testid={testId ?? 'edit-dialog'}>
        {children}
        <button
          data-testid="mock-edit-dialog-save"
          onClick={async () => {
            await onSave()
            onOpenChange(false)
          }}
        >
          Save
        </button>
        <button
          data-testid="mock-edit-dialog-cancel"
          onClick={() => onOpenChange(false)}
        >
          Cancel
        </button>
      </div>
    ) : null,
}))

// Mock VariableReadonlyTable
vi.mock('@/components/shared/variable-editor/variable-readonly-table', () => ({
  VariableReadonlyTable: ({ variables }: { variables: Record<string, unknown> }) => (
    <div data-testid="variable-readonly-table">
      {Object.keys(variables).map((name) => (
        <div key={name} data-testid="readonly-var-row">{name}</div>
      ))}
    </div>
  ),
}))

// The injected workbench value cell, mocked to surface the structured value
// it receives (the JSON-string edge parse) + fire a structured onChange.
vi.mock('@/features/workbench/common/variables/variable-value-cell', () => ({
  VariableValueCell: ({
    type,
    value,
    onChange,
  }: {
    type: string
    value: unknown
    onChange: (value: unknown, isTemplate: boolean) => void
  }) => (
    <div data-testid="mock-value-cell" data-type={type} data-value={JSON.stringify(value)}>
      <button data-testid="mock-cell-change" onClick={() => onChange([99], false)}>change</button>
    </div>
  ),
}))

// Mock VariableEditor - exposes onChange and onSelectionChange so tests can simulate edits and selection
vi.mock('@/components/shared/variable-editor/variable-editor', () => ({
  VariableEditor: ({
    rows,
    onChange,
    onSelectionChange,
    bulkActions,
    renderValueCell,
  }: {
    rows: Array<{ id: string; name: string; type?: string; secret?: boolean; value?: string }>
    onChange: (rows: Array<{ id: string; name: string }>) => void
    enableSelection?: boolean
    selectedIds?: Set<string>
    onSelectionChange?: (ids: Set<string>) => void
    bulkActions?: React.ReactNode
    renderValueCell?: (row: { id: string; name: string }) => React.ReactNode
  }) => (
    <div data-testid="variable-editor">
      <div data-testid="variable-editor-row-count">{rows.length}</div>
      {rows.map((row) => (
        <div key={row.id} data-testid={`editor-row-${row.id}`}>
          {renderValueCell?.(row)}
        </div>
      ))}
      <button
        data-testid="mock-editor-change"
        onClick={() => onChange([...rows, { id: 'mock-new', name: 'mock_var' }])}
      >
        Add Mock Row
      </button>
      <button
        data-testid="mock-editor-select-all"
        onClick={() => {
          if (onSelectionChange) {
            onSelectionChange(new Set(rows.map((r) => r.id)))
          }
        }}
      >
        Select All
      </button>
      {bulkActions && <div data-testid="mock-bulk-actions">{bulkActions}</div>}
    </div>
  ),
}))

// Mock ExportDialog - exposes onExport so tests can trigger the handler and
// surfaces hasSecrets so the GV export gaining the secrets picker stays asserted
vi.mock('@/components/shared/dialogs/export-dialog', () => ({
  ExportDialog: ({
    open,
    hasSecrets,
    onExport,
  }: {
    open: boolean
    onOpenChange: (open: boolean) => void
    entityIds: string[]
    entityNames: string[]
    entityLabel: string
    hasSecrets: boolean
    loading: boolean
    onExport: (opts: { format: 'yaml' | 'json'; secrets: 'mask' | 'encrypted' | 'plaintext' }) => Promise<void>
  }) =>
    open ? (
      <div data-testid="export-dialog" data-has-secrets={String(hasSecrets)}>
        <button
          data-testid="mock-export-confirm"
          onClick={() => onExport({ format: 'json', secrets: 'plaintext' })}
        >
          Confirm Export
        </button>
        <button
          data-testid="mock-export-confirm-yaml"
          onClick={() => onExport({ format: 'yaml', secrets: 'plaintext' })}
        >
          Confirm YAML Export
        </button>
      </div>
    ) : null,
}))

// Mock ImportDialog - surfaces allowedResolutions so the overwrite/skip
// restriction stays asserted
vi.mock('@/components/shared/dialogs/import-dialog', () => ({
  ImportDialog: ({
    open,
    allowedResolutions,
    onImportComplete,
  }: {
    open: boolean
    allowedResolutions?: string[]
    onImportComplete: () => void
  }) =>
    open ? (
      <div
        data-testid="import-dialog"
        data-allowed-resolutions={JSON.stringify(allowedResolutions ?? null)}
      >
        <button data-testid="mock-import-complete" onClick={onImportComplete}>
          Complete Import
        </button>
      </div>
    ) : null,
}))

vi.mock('@/lib/download-blob', () => ({
  downloadBlob: vi.fn(),
}))

// ============================================================================
// Helpers
// ============================================================================

import { fetchSystemVariables, saveSystemVariables } from '@/features/settings/api/global-variables/crud'
import { exportSystemVariables } from '@/features/settings/api/global-variables/import-export'
import { downloadBlob } from '@/lib/download-blob'

const mockFetch = fetchSystemVariables as ReturnType<typeof vi.fn>
const mockSave = saveSystemVariables as ReturnType<typeof vi.fn>
const mockExport = exportSystemVariables as ReturnType<typeof vi.fn>
const mockDownloadBlob = downloadBlob as ReturnType<typeof vi.fn>

function setupEmptyState() {
  mockFetch.mockResolvedValue({})
}

function setupWithVariables() {
  mockFetch.mockResolvedValue({
    api_url: { type: 'string' as const, value: 'https://api.example.com' },
    timeout: { type: 'integer' as const, value: 30 },
  })
}

function setupWithComplexVariable() {
  // An entity-scope array variable - the backend round-trips it VERBATIM as an
  // actual array (not a JSON string); the cell adapts it at the edge.
  mockFetch.mockResolvedValue({
    cfg: { type: 'array' as const, value: [1, 2, 3] as unknown as string, secret: false },
  })
}

// ============================================================================
// Tests
// ============================================================================

describe('SystemVariablesTab', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  // --------------------------------------------------------------------------
  // 1. Loading state
  // --------------------------------------------------------------------------
  describe('Loading State', () => {
    it('shows loading spinner while fetching', () => {
      mockFetch.mockReturnValue(new Promise(() => {})) // Never resolves

      render(<SystemVariablesTab />)

      expect(screen.getByTestId('system-variables-loading')).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // 2. Error state
  // --------------------------------------------------------------------------
  describe('Error State', () => {
    it('shows error message on fetch failure', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'))

      render(<SystemVariablesTab />)

      await waitFor(() => {
        expect(screen.getByTestId('system-variables-error')).toBeInTheDocument()
      })
      expect(screen.getByText('Network error')).toBeInTheDocument()
    })

    it('shows retry button that reloads data', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))
      const user = userEvent.setup()

      render(<SystemVariablesTab />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
      })

      // Setup success for retry
      mockFetch.mockResolvedValue({})

      await user.click(screen.getByRole('button', { name: /try again/i }))

      await waitFor(() => {
        expect(screen.getByTestId('system-variables-empty')).toBeInTheDocument()
      })
    })

    it('handles non-Error fetch rejection', async () => {
      mockFetch.mockRejectedValue('string error')

      render(<SystemVariablesTab />)

      await waitFor(() => {
        expect(screen.getByTestId('system-variables-error')).toBeInTheDocument()
      })
      expect(screen.getByText('Failed to load system variables')).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // 3. Empty state
  // --------------------------------------------------------------------------
  describe('Empty State', () => {
    it('shows empty state when no variables exist', async () => {
      setupEmptyState()

      render(<SystemVariablesTab />)

      await waitFor(() => {
        expect(screen.getByTestId('system-variables-empty')).toBeInTheDocument()
      })
      expect(screen.getByText('No system variables')).toBeInTheDocument()
    })

    it('shows "Add Variable" button in empty state', async () => {
      setupEmptyState()

      render(<SystemVariablesTab />)

      await waitFor(() => {
        expect(screen.getByTestId('system-variables-add-btn')).toBeInTheDocument()
      })
    })

    it('does NOT show "Edit Variables" button when empty', async () => {
      setupEmptyState()

      render(<SystemVariablesTab />)

      await waitFor(() => {
        expect(screen.getByTestId('system-variables-empty')).toBeInTheDocument()
      })

      expect(screen.queryByTestId('system-variables-edit-btn')).not.toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // 4. Populated (read-only) state
  // --------------------------------------------------------------------------
  describe('Populated State', () => {
    it('shows VariableReadonlyTable when variables exist', async () => {
      setupWithVariables()

      render(<SystemVariablesTab />)

      await waitFor(() => {
        expect(screen.getByTestId('variable-readonly-table')).toBeInTheDocument()
      })
    })

    it('shows "Edit Variables" button when variables exist', async () => {
      setupWithVariables()

      render(<SystemVariablesTab />)

      await waitFor(() => {
        expect(screen.getByTestId('system-variables-edit-btn')).toBeInTheDocument()
      })
    })

    it('shows header with title and subtitle', async () => {
      setupWithVariables()

      render(<SystemVariablesTab />)

      await waitFor(() => {
        expect(screen.getByText('System Variables')).toBeInTheDocument()
        expect(screen.getByText('Variables available to all tests, suites, and regressions')).toBeInTheDocument()
      })
    })

    it('shows Import button in header', async () => {
      setupWithVariables()

      render(<SystemVariablesTab />)

      await waitFor(() => {
        expect(screen.getByTestId('system-variables-import-btn')).toBeInTheDocument()
      })
    })
  })

  // --------------------------------------------------------------------------
  // 5. Edit dialog open/close
  // --------------------------------------------------------------------------
  describe('Edit Dialog', () => {
    it('opens EditDialog when clicking "Edit Variables"', async () => {
      setupWithVariables()
      const user = userEvent.setup()

      render(<SystemVariablesTab />)

      await waitFor(() => {
        expect(screen.getByTestId('system-variables-edit-btn')).toBeInTheDocument()
      })

      await user.click(screen.getByTestId('system-variables-edit-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('edit-variables-dialog')).toBeInTheDocument()
        expect(screen.getByTestId('variable-editor')).toBeInTheDocument()
      })
    })

    it('opens EditDialog with new row when clicking "Add Variable" in empty state', async () => {
      setupEmptyState()
      const user = userEvent.setup()

      render(<SystemVariablesTab />)

      await waitFor(() => {
        expect(screen.getByTestId('system-variables-add-btn')).toBeInTheDocument()
      })

      await user.click(screen.getByTestId('system-variables-add-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('edit-variables-dialog')).toBeInTheDocument()
        // Should have 1 row (the newly added empty row)
        expect(screen.getByTestId('variable-editor-row-count')).toHaveTextContent('1')
      })
    })
  })

  // --------------------------------------------------------------------------
  // 6. Save
  // --------------------------------------------------------------------------
  describe('Save', () => {
    it('calls API then refreshes variables and shows toast', async () => {
      setupWithVariables()
      mockSave.mockResolvedValue({})
      const user = userEvent.setup()

      render(<SystemVariablesTab />)

      await waitFor(() => {
        expect(screen.getByTestId('system-variables-edit-btn')).toBeInTheDocument()
      })

      // Open edit dialog
      await user.click(screen.getByTestId('system-variables-edit-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('edit-variables-dialog')).toBeInTheDocument()
      })

      // After save, fetch returns updated data
      mockFetch.mockResolvedValue({
        api_url: { type: 'string' as const, value: 'https://api.example.com' },
        timeout: { type: 'integer' as const, value: 30 },
        new_var: { type: 'string' as const, value: 'added' },
      })

      // Click save
      await user.click(screen.getByTestId('mock-edit-dialog-save'))

      await waitFor(() => {
        expect(mockSave).toHaveBeenCalled()
        expect(mockToastSuccess).toHaveBeenCalledWith('System variables saved')
      })

      // Fetch should have been called again to refresh
      expect(mockFetch).toHaveBeenCalledTimes(2) // initial + refresh
    })
  })

  // --------------------------------------------------------------------------
  // 7. Import
  // --------------------------------------------------------------------------
  describe('Import', () => {
    it('opens import dialog when clicking Import button', async () => {
      setupWithVariables()
      const user = userEvent.setup()

      render(<SystemVariablesTab />)

      await waitFor(() => {
        expect(screen.getByTestId('system-variables-import-btn')).toBeInTheDocument()
      })

      await user.click(screen.getByTestId('system-variables-import-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('import-dialog')).toBeInTheDocument()
      })
    })

    it('refreshes variables and shows toast on import complete', async () => {
      setupWithVariables()
      const user = userEvent.setup()

      render(<SystemVariablesTab />)

      await waitFor(() => {
        expect(screen.getByTestId('system-variables-import-btn')).toBeInTheDocument()
      })

      // Open import dialog
      await user.click(screen.getByTestId('system-variables-import-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('import-dialog')).toBeInTheDocument()
      })

      // Reset fetch mock to track reload
      mockFetch.mockClear()
      mockFetch.mockResolvedValue({
        imported_var: { type: 'string' as const, value: 'new' },
      })

      // Complete import
      await user.click(screen.getByTestId('mock-import-complete'))

      await waitFor(() => {
        expect(mockToastSuccess).toHaveBeenCalledWith('System variables imported')
        expect(mockFetch).toHaveBeenCalled()
      })
    })

    it('restricts conflict resolutions to overwrite and skip (no rename)', async () => {
      // Variable names are reference targets in expressions; renaming on
      // import would silently break references.
      setupWithVariables()
      const user = userEvent.setup()

      render(<SystemVariablesTab />)

      await waitFor(() => {
        expect(screen.getByTestId('system-variables-import-btn')).toBeInTheDocument()
      })
      await user.click(screen.getByTestId('system-variables-import-btn'))

      const dialog = await screen.findByTestId('import-dialog')
      expect(dialog).toHaveAttribute(
        'data-allowed-resolutions',
        JSON.stringify(['overwrite', 'skip'])
      )
    })
  })

  // --------------------------------------------------------------------------
  // 8. Bulk delete
  // --------------------------------------------------------------------------
  describe('Bulk Delete', () => {
    it('removes selected rows when clicking bulk delete', async () => {
      setupWithVariables()
      const user = userEvent.setup()

      render(<SystemVariablesTab />)

      await waitFor(() => {
        expect(screen.getByTestId('system-variables-edit-btn')).toBeInTheDocument()
      })

      // Open edit dialog
      await user.click(screen.getByTestId('system-variables-edit-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('edit-variables-dialog')).toBeInTheDocument()
      })

      // Should start with 2 rows
      expect(screen.getByTestId('variable-editor-row-count')).toHaveTextContent('2')

      // Select all rows via mock helper
      await user.click(screen.getByTestId('mock-editor-select-all'))

      // Click bulk delete
      await user.click(screen.getByTestId('bulk-delete-btn'))

      // Should now have 0 rows
      await waitFor(() => {
        expect(screen.getByTestId('variable-editor-row-count')).toHaveTextContent('0')
      })
    })
  })

  // --------------------------------------------------------------------------
  // 9. Export
  // --------------------------------------------------------------------------
  describe('Export', () => {
    it('opens export dialog and downloads the server blob via downloadBlob on confirm', async () => {
      setupWithVariables()
      const serverBlob = new Blob(['{}'], { type: 'application/json' })
      mockExport.mockResolvedValue(serverBlob)
      const user = userEvent.setup()

      render(<SystemVariablesTab />)

      await waitFor(() => {
        expect(screen.getByTestId('system-variables-edit-btn')).toBeInTheDocument()
      })

      // Open edit dialog
      await user.click(screen.getByTestId('system-variables-edit-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('edit-variables-dialog')).toBeInTheDocument()
      })

      // Click export button in bulk actions (opens export dialog)
      await user.click(screen.getByTestId('bulk-export-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('export-dialog')).toBeInTheDocument()
      })

      // Click confirm export
      await user.click(screen.getByTestId('mock-export-confirm'))

      await waitFor(() => {
        // Server-side export carries the chosen secrets mode (raw store + mode).
        expect(mockExport).toHaveBeenCalledWith('json', 'plaintext')
        expect(mockDownloadBlob).toHaveBeenCalledWith(serverBlob, 'system-variables.json')
        expect(mockToastSuccess).toHaveBeenCalledWith('System variables exported')
      })
    })

    it('downloads a yaml filename when yaml format is chosen', async () => {
      setupWithVariables()
      const serverBlob = new Blob(['variables: {}'], { type: 'application/x-yaml' })
      mockExport.mockResolvedValue(serverBlob)
      const user = userEvent.setup()

      render(<SystemVariablesTab />)

      await waitFor(() => {
        expect(screen.getByTestId('system-variables-edit-btn')).toBeInTheDocument()
      })
      await user.click(screen.getByTestId('system-variables-edit-btn'))
      await waitFor(() => {
        expect(screen.getByTestId('edit-variables-dialog')).toBeInTheDocument()
      })
      await user.click(screen.getByTestId('bulk-export-btn'))
      await waitFor(() => {
        expect(screen.getByTestId('export-dialog')).toBeInTheDocument()
      })

      await user.click(screen.getByTestId('mock-export-confirm-yaml'))

      await waitFor(() => {
        expect(mockExport).toHaveBeenCalledWith('yaml', 'plaintext')
        expect(mockDownloadBlob).toHaveBeenCalledWith(serverBlob, 'system-variables.yaml')
      })
    })

    it('offers the secrets mode picker so the collection can be exported encrypted/plaintext', async () => {
      // GV export reads the raw sealed store and applies the chosen mode, so
      // the dialog must offer the secrets picker (hasSecrets flips to true).
      mockFetch.mockResolvedValue({
        api_url: { type: 'string' as const, value: 'https://api.example.com' },
        token: { type: 'string' as const, value: '********', secret: true },
      })
      const user = userEvent.setup()

      render(<SystemVariablesTab />)

      await waitFor(() => {
        expect(screen.getByTestId('system-variables-edit-btn')).toBeInTheDocument()
      })
      await user.click(screen.getByTestId('system-variables-edit-btn'))
      await waitFor(() => {
        expect(screen.getByTestId('edit-variables-dialog')).toBeInTheDocument()
      })
      await user.click(screen.getByTestId('bulk-export-btn'))

      const dialog = await screen.findByTestId('export-dialog')
      expect(dialog).toHaveAttribute('data-has-secrets', 'true')
    })

    it('shows error toast when export fails', async () => {
      setupWithVariables()
      mockExport.mockRejectedValue(new Error('Export failed'))
      const user = userEvent.setup()

      render(<SystemVariablesTab />)

      await waitFor(() => {
        expect(screen.getByTestId('system-variables-edit-btn')).toBeInTheDocument()
      })

      // Open edit dialog
      await user.click(screen.getByTestId('system-variables-edit-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('edit-variables-dialog')).toBeInTheDocument()
      })

      // Click export button in bulk actions
      await user.click(screen.getByTestId('bulk-export-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('export-dialog')).toBeInTheDocument()
      })

      // Click confirm export
      await user.click(screen.getByTestId('mock-export-confirm'))

      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalledWith('Export failed', 'Export Failed')
      })
    })

    it('passes a non-Error export rejection through verbatim', async () => {
      setupWithVariables()
      mockExport.mockRejectedValue('string error')
      const user = userEvent.setup()

      render(<SystemVariablesTab />)

      await waitFor(() => {
        expect(screen.getByTestId('system-variables-edit-btn')).toBeInTheDocument()
      })

      // Open edit dialog
      await user.click(screen.getByTestId('system-variables-edit-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('edit-variables-dialog')).toBeInTheDocument()
      })

      // Click export button
      await user.click(screen.getByTestId('bulk-export-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('export-dialog')).toBeInTheDocument()
      })

      // Click confirm export
      await user.click(screen.getByTestId('mock-export-confirm'))

      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalledWith('string error', 'Export Failed')
      })
    })
  })

  // --------------------------------------------------------------------------
  // 10. Injected value cell + JSON-string edge round-trip
  // --------------------------------------------------------------------------
  describe('injected value cell', () => {
    it('injects renderValueCell with the parsed structured value (read edge)', async () => {
      setupWithComplexVariable()
      const user = userEvent.setup()

      render(<SystemVariablesTab />)

      await waitFor(() => {
        expect(screen.getByTestId('system-variables-edit-btn')).toBeInTheDocument()
      })
      await user.click(screen.getByTestId('system-variables-edit-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('mock-value-cell')).toBeInTheDocument()
      })
      const cell = screen.getByTestId('mock-value-cell')
      expect(cell).toHaveAttribute('data-type', 'array')
      // The backend's actual array reaches the cell structured (the edge adapts it).
      expect(cell).toHaveAttribute('data-value', '[1,2,3]')
    })

    it('round-trips a cell edit back through the JSON-string edge on save', async () => {
      setupWithComplexVariable()
      mockSave.mockResolvedValue({})
      const user = userEvent.setup()

      render(<SystemVariablesTab />)

      await waitFor(() => {
        expect(screen.getByTestId('system-variables-edit-btn')).toBeInTheDocument()
      })
      await user.click(screen.getByTestId('system-variables-edit-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('mock-cell-change')).toBeInTheDocument()
      })
      // The cell emits the structured value [99]; the consumer stores it verbatim
      // (the backend round-trips actual values, not JSON strings).
      await user.click(screen.getByTestId('mock-cell-change'))
      await user.click(screen.getByTestId('mock-edit-dialog-save'))

      await waitFor(() => {
        expect(mockSave).toHaveBeenCalledWith(
          expect.objectContaining({
            cfg: expect.objectContaining({ type: 'array', value: [99] }),
          }),
        )
      })
    })
  })
})
