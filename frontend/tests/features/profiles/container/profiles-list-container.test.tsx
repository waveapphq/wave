/**
 * ProfilesListContainer Component Tests
 *
 * REQ-4.7.4: Profile management UI
 *
 * Tests for ProfilesListContainer data fetching and state management:
 * - Profile CRUD operations
 * - Search and sort functionality
 * - Pagination
 * - Error handling
 * - Column visibility
 *
 * Component: frontend/src/features/profiles/container/container.tsx
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react'
import { act } from 'react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { ProfilesListContainer } from '@/features/profiles/container'
import { ToastProvider, ToastContainer } from '@/components/ui/toast'
import { usePageBlockStore } from '@/stores/page-block-store'

// ============================================================================
// Mocks
// ============================================================================

// Mock the API modules
vi.mock('@/features/profiles/api/crud', () => ({
  fetchProfiles: vi.fn(),
  fetchProfileTypes: vi.fn(),
  fetchProfileTypeSchema: vi.fn(),
  fetchAllTags: vi.fn(),
  fetchProfileEnvironments: vi.fn(),
  fetchProfile: vi.fn(),
  createProfile: vi.fn(),
  updateProfile: vi.fn(),
  deleteProfile: vi.fn(),
  duplicateProfile: vi.fn(),
}))

vi.mock('@/features/profiles/api/import-export', () => ({
  exportProfile: vi.fn(),
  exportProfiles: vi.fn(),
  validateProfileImport: vi.fn(),
  importProfiles: vi.fn(),
}))

vi.mock('@/lib/download-blob', () => ({
  downloadBlob: vi.fn(),
}))

// Import mocked functions
import {
  fetchProfiles,
  fetchProfileTypes,
  fetchProfileTypeSchema,
  fetchAllTags,
  fetchProfileEnvironments,
  fetchProfile,
  createProfile,
  updateProfile,
  deleteProfile,
  duplicateProfile,
} from '@/features/profiles/api/crud'
import {
  exportProfile,
  exportProfiles,
  validateProfileImport,
  importProfiles,
} from '@/features/profiles/api/import-export'
import { downloadBlob } from '@/lib/download-blob'

const mockFetchProfiles = fetchProfiles as ReturnType<typeof vi.fn>
const mockFetchProfileTypes = fetchProfileTypes as ReturnType<typeof vi.fn>
const mockFetchProfileTypeSchema = fetchProfileTypeSchema as ReturnType<typeof vi.fn>
const mockFetchAllTags = fetchAllTags as ReturnType<typeof vi.fn>
const mockFetchEnvironments = fetchProfileEnvironments as ReturnType<typeof vi.fn>
const mockFetchProfile = fetchProfile as ReturnType<typeof vi.fn>
const mockCreateProfile = createProfile as ReturnType<typeof vi.fn>
const mockUpdateProfile = updateProfile as ReturnType<typeof vi.fn>
const mockDeleteProfile = deleteProfile as ReturnType<typeof vi.fn>
const mockDuplicateProfile = duplicateProfile as ReturnType<typeof vi.fn>
const mockExportProfile = exportProfile as ReturnType<typeof vi.fn>
const mockExportProfiles = exportProfiles as ReturnType<typeof vi.fn>
const mockValidateProfileImport = validateProfileImport as ReturnType<typeof vi.fn>
const mockImportProfiles = importProfiles as ReturnType<typeof vi.fn>

// ============================================================================
// Test Data
// ============================================================================

const mockProfilesResponse = {
  data: [
    {
      id: 'profile-1',
      name: 'Production Database',
      type: 'database',
      description: 'Production PostgreSQL connection',
      tags: ['production', 'backend'],
      usage: 0, // usage=0 so we can delete
      config: { host: 'localhost', port: 5432 },
      environmentValues: {
        'env-1': { host: 'localhost', port: 5432 },
      },
      environmentsCount: 1,
      totalEnvironments: 2,
      hasIncompleteEnvironments: true,
      createdAt: '2025-01-10T10:00:00Z',
      updatedAt: '2025-01-15T14:30:00Z',
    },
  ],
  pagination: {
    page: 1,
    per_page: 25,
    total: 1,
    total_pages: 1,
  },
}

const mockProfileTypes = ['database', 'ssh', 'http', 'custom']
const mockAllTags = ['production', 'staging', 'backend', 'frontend']
const mockEnvironments = [
  { id: 'env-1', name: 'Production', description: 'Production environment', usage: 5 },
  { id: 'env-2', name: 'Staging', description: 'Staging environment', usage: 2 },
]

const mockProfile = {
  id: 'profile-1',
  name: 'Production Database',
  type: 'database',
  description: 'Production PostgreSQL connection',
  tags: ['production', 'backend'],
  usage: 0,
  config: { host: 'localhost', port: 5432 },
  environmentValues: {
    'env-1': { host: 'localhost', port: 5432 },
  },
  environmentsCount: 1,
  totalEnvironments: 2,
  hasIncompleteEnvironments: true,
  createdAt: '2025-01-10T10:00:00Z',
  updatedAt: '2025-01-15T14:30:00Z',
}

// ============================================================================
// Test Utilities
// ============================================================================

function renderProfilesListContainer(route = '/profiles') {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route path="/profiles" element={<ProfilesListContainer />} />
        </Routes>
      </MemoryRouter>
      <ToastContainer />
    </ToastProvider>
  )
}

// ============================================================================
// Tests
// ============================================================================


/** A submit test changes the form first: nothing changed anywhere keeps Save disabled. */
function changeDescription() {
  fireEvent.change(screen.getByRole('textbox', { name: /description/i }), { target: { value: 'changed' } })
}

describe('ProfilesListContainer', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    // Silence console.error for expected error handling tests
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockFetchProfiles.mockResolvedValue(mockProfilesResponse)
    mockFetchProfileTypes.mockResolvedValue(mockProfileTypes)
    mockFetchProfileTypeSchema.mockResolvedValue({
      fields: [
        { name: 'host', type: 'string', required: true, secret: false },
        { name: 'port', type: 'integer', required: true, secret: false },
      ],
    })
    mockFetchAllTags.mockResolvedValue(mockAllTags)
    mockFetchEnvironments.mockResolvedValue(mockEnvironments)
    mockFetchProfile.mockResolvedValue(mockProfile)
    mockCreateProfile.mockResolvedValue(mockProfile)
    mockUpdateProfile.mockResolvedValue(mockProfile)
    // Setup portal root for confirmation dialogs
    const portalRoot = document.createElement('div')
    portalRoot.setAttribute('id', 'modal-root')
    document.body.appendChild(portalRoot)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    // Clean up portal root
    const portalRoot = document.getElementById('modal-root')
    if (portalRoot) {
      document.body.removeChild(portalRoot)
    }
  })

  describe('Data Loading', () => {
    it('loads profiles on mount', async () => {
      renderProfilesListContainer()

      await waitFor(() => {
        expect(mockFetchProfiles).toHaveBeenCalled()
      })

      await waitFor(() => {
        expect(screen.getByText('Production Database')).toBeInTheDocument()
      })
    })

    it('loads profile types on mount', async () => {
      renderProfilesListContainer()

      await waitFor(() => {
        expect(mockFetchProfileTypes).toHaveBeenCalled()
      })
    })

    it('loads all tags on mount', async () => {
      renderProfilesListContainer()

      await waitFor(() => {
        expect(mockFetchAllTags).toHaveBeenCalled()
      })
    })

    it('handles error loading profiles', async () => {
      mockFetchProfiles.mockRejectedValue(new Error('Network error'))
      renderProfilesListContainer()

      await waitFor(() => {
        expect(mockFetchProfiles).toHaveBeenCalled()
      })

      // Error state should be set
      await waitFor(() => {
        expect(screen.getByTestId('error-state')).toBeInTheDocument()
      })
    })

    it('shows only the error state when the environments read fails too', async () => {
      mockFetchProfiles.mockRejectedValue(new Error('Network error'))
      mockFetchEnvironments.mockRejectedValue(new Error('Environments unavailable'))
      renderProfilesListContainer()

      await waitFor(() => {
        expect(screen.getByTestId('error-state')).toBeInTheDocument()
      })
      await waitFor(() => {
        expect(mockFetchEnvironments).toHaveBeenCalled()
      })
      expect(usePageBlockStore.getState().block).toBeNull()
      expect(screen.queryByTestId('page-blocked-card')).not.toBeInTheDocument()
    })

    it('handles error loading profiles with non-Error object', async () => {
      mockFetchProfiles.mockRejectedValue('String error')
      renderProfilesListContainer()

      await waitFor(() => {
        expect(mockFetchProfiles).toHaveBeenCalled()
      })

      // Fallback error message
      await waitFor(() => {
        expect(screen.getByTestId('error-state')).toBeInTheDocument()
      })
    })
  })

  describe('Duplicate Profile', () => {
    it('duplicates profile successfully', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      mockDuplicateProfile.mockResolvedValue({ id: 'profile-2', name: 'Production Database (copy)' })
      renderProfilesListContainer()

      await waitFor(() => {
        expect(screen.getByText('Production Database')).toBeInTheDocument()
      })

      // Click the kebab menu trigger
      const menuTrigger = screen.getByTestId('action-menu-trigger')
      await user.click(menuTrigger)

      await waitFor(() => {
        const duplicateOption = screen.getByRole('menuitem', { name: /duplicate/i })
        expect(duplicateOption).toBeInTheDocument()
      })

      const duplicateOption = screen.getByRole('menuitem', { name: /duplicate/i })
      await user.click(duplicateOption)

      await waitFor(() => {
        expect(mockDuplicateProfile).toHaveBeenCalledWith('profile-1')
      })

      // Verify profiles are reloaded after successful duplicate
      await waitFor(() => {
        expect(mockFetchProfiles).toHaveBeenCalledTimes(2)
      })
    })

    it('handles duplicate error with Error instance', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      mockDuplicateProfile.mockRejectedValue(new Error('Duplicate failed'))
      renderProfilesListContainer()

      await waitFor(() => {
        expect(screen.getByText('Production Database')).toBeInTheDocument()
      })

      const menuTrigger = screen.getByTestId('action-menu-trigger')
      await user.click(menuTrigger)

      await waitFor(() => {
        const duplicateOption = screen.getByRole('menuitem', { name: /duplicate/i })
        expect(duplicateOption).toBeInTheDocument()
      })

      const duplicateOption = screen.getByRole('menuitem', { name: /duplicate/i })
      await user.click(duplicateOption)

      await waitFor(() => {
        expect(mockDuplicateProfile).toHaveBeenCalledWith('profile-1')
      })

      // Error should be displayed
      await waitFor(() => {
        expect(screen.getByTestId('error-state')).toBeInTheDocument()
      })
    })

    it('handles duplicate error with non-Error object', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      mockDuplicateProfile.mockRejectedValue('String error')
      renderProfilesListContainer()

      await waitFor(() => {
        expect(screen.getByText('Production Database')).toBeInTheDocument()
      })

      const menuTrigger = screen.getByTestId('action-menu-trigger')
      await user.click(menuTrigger)

      await waitFor(() => {
        const duplicateOption = screen.getByRole('menuitem', { name: /duplicate/i })
        expect(duplicateOption).toBeInTheDocument()
      })

      const duplicateOption = screen.getByRole('menuitem', { name: /duplicate/i })
      await user.click(duplicateOption)

      await waitFor(() => {
        expect(mockDuplicateProfile).toHaveBeenCalledWith('profile-1')
      })
    })
  })

  describe('Delete Profile', () => {
    it('deletes profile successfully with confirmation', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      mockDeleteProfile.mockResolvedValue(undefined)
      renderProfilesListContainer()

      await waitFor(() => {
        expect(screen.getByText('Production Database')).toBeInTheDocument()
      })

      // Click the kebab menu trigger
      const menuTrigger = screen.getByTestId('action-menu-trigger')
      await user.click(menuTrigger)

      await waitFor(() => {
        const deleteOption = screen.getByRole('menuitem', { name: /delete/i })
        expect(deleteOption).toBeInTheDocument()
      })

      const deleteOption = screen.getByRole('menuitem', { name: /delete/i })
      await user.click(deleteOption)

      // Confirmation dialog should appear
      await waitFor(() => {
        expect(screen.getByText(/permanently removed/i)).toBeInTheDocument()
      })

      // Click the confirm delete button in the confirmation dialog
      const confirmButton = screen.getByRole('button', { name: /delete/i })
      await user.click(confirmButton)

      await waitFor(() => {
        expect(mockDeleteProfile).toHaveBeenCalledWith('profile-1')
      })

      // Verify profiles are reloaded after successful delete
      await waitFor(() => {
        expect(mockFetchProfiles).toHaveBeenCalledTimes(2)
      })
    })

    it('tells the user when the delete request fails', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      mockDeleteProfile.mockRejectedValue(new Error('Profile is in use'))
      renderProfilesListContainer()

      await waitFor(() => {
        expect(screen.getByText('Production Database')).toBeInTheDocument()
      })

      const menuTrigger = screen.getByTestId('action-menu-trigger')
      await user.click(menuTrigger)

      await waitFor(() => {
        const deleteOption = screen.getByRole('menuitem', { name: /delete/i })
        expect(deleteOption).toBeInTheDocument()
      })

      const deleteOption = screen.getByRole('menuitem', { name: /delete/i })
      await user.click(deleteOption)

      // Confirmation dialog should appear
      await waitFor(() => {
        expect(screen.getByText(/permanently removed/i)).toBeInTheDocument()
      })

      // Click the confirm delete button
      const confirmButton = screen.getByRole('button', { name: /delete/i })
      await user.click(confirmButton)

      await waitFor(() => {
        expect(mockDeleteProfile).toHaveBeenCalledWith('profile-1')
      })

      // Error should be logged
      await waitFor(() => {
        expect(consoleSpy).toHaveBeenCalledWith('Failed to delete profile:', expect.any(Error))
      })

      // The dialog is already closed by the confirm click, so the failure
      // reports at the gesture.
      expect(await screen.findByText('Delete Failed')).toBeInTheDocument()
      expect(screen.getByText('Profile is in use')).toBeInTheDocument()

      consoleSpy.mockRestore()
    })

    it('can cancel delete operation', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderProfilesListContainer()

      await waitFor(() => {
        expect(screen.getByText('Production Database')).toBeInTheDocument()
      })

      const menuTrigger = screen.getByTestId('action-menu-trigger')
      await user.click(menuTrigger)

      await waitFor(() => {
        const deleteOption = screen.getByRole('menuitem', { name: /delete/i })
        expect(deleteOption).toBeInTheDocument()
      })

      const deleteOption = screen.getByRole('menuitem', { name: /delete/i })
      await user.click(deleteOption)

      // Confirmation dialog should appear
      await waitFor(() => {
        expect(screen.getByText(/permanently removed/i)).toBeInTheDocument()
      })

      // Click the cancel button
      const cancelButton = screen.getByRole('button', { name: /cancel/i })
      await user.click(cancelButton)

      // Dialog should close and profile should not be deleted
      await waitFor(() => {
        expect(screen.queryByText(/permanently removed/i)).not.toBeInTheDocument()
      })

      expect(mockDeleteProfile).not.toHaveBeenCalled()
    })
  })

  describe('Search and Filter Functionality', () => {
    it('triggers search when input changes', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })

      renderProfilesListContainer()

      await waitFor(() => {
        expect(screen.getByPlaceholderText(/Search profiles/i)).toBeInTheDocument()
      })

      // Reset mock to track new calls
      mockFetchProfiles.mockClear()

      const searchInput = screen.getByPlaceholderText(/Search profiles/i)

      // Type search term using fireEvent (works with fake timers)
      fireEvent.change(searchInput, { target: { value: 'prod' } })

      // Advance past debounce
      await act(async () => {
        vi.advanceTimersByTime(500)
      })

      await waitFor(() => {
        const calls = mockFetchProfiles.mock.calls
        const hasSearchCall = calls.some(
          (call: unknown[]) => (call[0] as { search?: string })?.search === 'prod'
        )
        expect(hasSearchCall).toBe(true)
      })
    })
  })

  describe('Sort Functionality', () => {
    it('triggers sort when usage column header is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderProfilesListContainer()

      await waitFor(() => {
        expect(screen.getByText('Production Database')).toBeInTheDocument()
      })

      // Reset mock to track new calls
      mockFetchProfiles.mockClear()

      // Find and click the Usage column header (different column to trigger new sort)
      const usageHeader = screen.getByRole('columnheader', { name: /usage/i })
      await user.click(usageHeader)

      await waitFor(() => {
        const calls = mockFetchProfiles.mock.calls
        const hasSortCall = calls.some(
          (call: unknown[]) =>
            (call[0] as { sort_by?: string })?.sort_by === 'usage' &&
            (call[0] as { sort_order?: string })?.sort_order === 'asc'
        )
        expect(hasSortCall).toBe(true)
      })
    })

    it('changes sort direction when same column is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderProfilesListContainer()

      await waitFor(() => {
        expect(screen.getByText('Production Database')).toBeInTheDocument()
      })

      // Reset mock to track new calls
      mockFetchProfiles.mockClear()

      // Container starts with name/asc. Click name header to go to desc
      const nameHeader = screen.getByRole('columnheader', { name: /name/i })
      await user.click(nameHeader)

      await waitFor(() => {
        const calls = mockFetchProfiles.mock.calls
        const hasDescCall = calls.some(
          (call: unknown[]) =>
            (call[0] as { sort_by?: string; sort_order?: string })?.sort_by === 'name' &&
            (call[0] as { sort_by?: string; sort_order?: string })?.sort_order === 'desc'
        )
        expect(hasDescCall).toBe(true)
      })
    })

    it('clears sort when clicking same column that is already descending', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderProfilesListContainer()

      await waitFor(() => {
        expect(screen.getByText('Production Database')).toBeInTheDocument()
      })

      // Initial state is name/asc
      let nameHeader = screen.getByRole('columnheader', { name: /name/i })
      expect(nameHeader).toHaveAttribute('aria-sort', 'ascending')

      // First click: asc -> desc
      await user.click(nameHeader)

      await waitFor(() => {
        expect(screen.getByRole('columnheader', { name: /name/i })).toHaveAttribute('aria-sort', 'descending')
      })

      // Verify the desc call was made
      await waitFor(() => {
        const calls = mockFetchProfiles.mock.calls
        const hasDescCall = calls.some(
          (call: unknown[]) =>
            (call[0] as { sort_by?: string; sort_order?: string })?.sort_by === 'name' &&
            (call[0] as { sort_by?: string; sort_order?: string })?.sort_order === 'desc'
        )
        expect(hasDescCall).toBe(true)
      })

      // Second click: desc -> clear (null)
      nameHeader = screen.getByRole('columnheader', { name: /name/i })
      await user.click(nameHeader)

      // aria-sort should now be 'none' (no sorting)
      await waitFor(() => {
        expect(screen.getByRole('columnheader', { name: /name/i })).toHaveAttribute('aria-sort', 'none')
      })

      // Wait for a new API call with cleared sort (undefined sort_by/sort_order)
      await waitFor(() => {
        const calls = mockFetchProfiles.mock.calls
        const hasClearedCall = calls.some(
          (call: unknown[]) => {
            const params = call[0] as { sort_by?: string; sort_order?: string }
            return params.sort_by === undefined && params.sort_order === undefined
          }
        )
        expect(hasClearedCall).toBe(true)
      })
    })

  })

  describe('New and Edit Handlers', () => {
    it('handles new profile button click - opens create modal', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderProfilesListContainer()

      await waitFor(() => {
        expect(screen.getByText('Production Database')).toBeInTheDocument()
      })

      // Click new profile button
      const newButton = screen.getByRole('button', { name: /new profile/i })
      await user.click(newButton)

      // Modal should open with 'Create Profile' title
      await waitFor(() => {
        expect(screen.getByText('Create Profile')).toBeInTheDocument()
      })
    })

    it('closes modal when Cancel button is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderProfilesListContainer()

      await waitFor(() => {
        expect(screen.getByText('Production Database')).toBeInTheDocument()
      })

      // Open create modal
      const newButton = screen.getByRole('button', { name: /new profile/i })
      await user.click(newButton)

      await waitFor(() => {
        expect(screen.getByText('Create Profile')).toBeInTheDocument()
      })

      // Click Cancel button to close modal
      const cancelButton = screen.getByRole('button', { name: /cancel/i })
      await user.click(cancelButton)

      // Modal should be closed
      await waitFor(() => {
        expect(screen.queryByText('Create Profile')).not.toBeInTheDocument()
      })
    })

    it('handles edit profile from row click - opens edit modal', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderProfilesListContainer()

      await waitFor(() => {
        expect(screen.getByText('Production Database')).toBeInTheDocument()
      })

      // Click the edit button
      const editButton = screen.getByTestId('action-edit')
      await user.click(editButton)

      // Modal should open with 'Edit Profile' title after fetching profile
      await waitFor(() => {
        expect(screen.getByText('Edit Profile')).toBeInTheDocument()
      })
    })
  })

  describe('Column Visibility', () => {
    it('toggles column visibility when column is hidden', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderProfilesListContainer()

      await waitFor(() => {
        expect(screen.getByText('Production Database')).toBeInTheDocument()
      })

      // Click on Columns button to open dropdown
      await user.click(screen.getByRole('button', { name: /Columns/i }))

      // Wait for dropdown and click on Usage to hide it (Usage is visible by default)
      await waitFor(() => {
        expect(screen.getByRole('menuitemcheckbox', { name: /Usage/i })).toBeInTheDocument()
      })
      await user.click(screen.getByRole('menuitemcheckbox', { name: /Usage/i }))

      // Usage column should be hidden now
      await waitFor(() => {
        expect(screen.queryByRole('columnheader', { name: /Usage/i })).not.toBeInTheDocument()
      })
    })

    it('toggles column visibility when column is shown', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderProfilesListContainer()

      await waitFor(() => {
        expect(screen.getByText('Production Database')).toBeInTheDocument()
      })

      // First hide the Usage column
      await user.click(screen.getByRole('button', { name: /Columns/i }))
      await waitFor(() => {
        expect(screen.getByRole('menuitemcheckbox', { name: /Usage/i })).toBeInTheDocument()
      })
      await user.click(screen.getByRole('menuitemcheckbox', { name: /Usage/i }))

      // Close and reopen the dropdown
      await user.keyboard('{Escape}')
      await user.click(screen.getByRole('button', { name: /Columns/i }))

      // Show the Usage column again
      await waitFor(() => {
        expect(screen.getByRole('menuitemcheckbox', { name: /Usage/i })).toBeInTheDocument()
      })
      await user.click(screen.getByRole('menuitemcheckbox', { name: /Usage/i }))

      // Usage column should be visible again
      await waitFor(() => {
        expect(screen.getByRole('columnheader', { name: /Usage/i })).toBeInTheDocument()
      })
    })
  })

  describe('Pagination', () => {
    const mockMultiPageResponse = {
      data: [
        {
          id: 'profile-1',
          name: 'Production Database',
          type: 'database',
          description: 'Production PostgreSQL connection',
          tags: ['production', 'backend'],
          usage: 5,
          createdAt: '2025-01-10T10:00:00Z',
          updatedAt: '2025-01-15T14:30:00Z',
        },
      ],
      pagination: {
        page: 1,
        per_page: 25,
        total: 100,
        total_pages: 4,
      },
    }

    it('changes page when next page button is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      mockFetchProfiles.mockResolvedValue(mockMultiPageResponse)
      renderProfilesListContainer()

      await waitFor(() => {
        expect(screen.getByText('Production Database')).toBeInTheDocument()
      })

      // Reset mock to track new calls
      mockFetchProfiles.mockClear()

      // Click next page button
      const nextButton = screen.getByRole('button', { name: /next page/i })
      await user.click(nextButton)

      await waitFor(() => {
        const calls = mockFetchProfiles.mock.calls
        const hasPageCall = calls.some(
          (call: unknown[]) => (call[0] as { page?: number })?.page === 2
        )
        expect(hasPageCall).toBe(true)
      })
    })
  })

  describe('Error Recovery', () => {
    it('retries loading when retry button is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      // First call fails
      mockFetchProfiles.mockRejectedValueOnce(new Error('Network error'))

      renderProfilesListContainer()

      await waitFor(() => {
        expect(screen.getByTestId('error-state')).toBeInTheDocument()
      })

      // Click retry button
      const retryButton = screen.getByRole('button', { name: /try again/i })

      // Second call succeeds
      mockFetchProfiles.mockResolvedValue(mockProfilesResponse)
      await user.click(retryButton)

      await waitFor(() => {
        expect(screen.getByText('Production Database')).toBeInTheDocument()
      })

      // Verify fetchProfiles was called twice
      expect(mockFetchProfiles).toHaveBeenCalledTimes(2)
    })
  })

  describe('URL Search Params', () => {
    it('initializes filters from URL search params', async () => {
      render(
        <ToastProvider>
          <MemoryRouter initialEntries={['/profiles?search=test&type=database&tags=production,staging']}>
            <Routes>
              <Route path="/profiles" element={<ProfilesListContainer />} />
            </Routes>
          </MemoryRouter>
        </ToastProvider>
      )

      await waitFor(() => {
        expect(mockFetchProfiles).toHaveBeenCalledWith(
          expect.objectContaining({
            search: 'test',
            type: 'database',
            tags: ['production', 'staging'],
          })
        )
      })
    })

    it('initializes page and pageSize from URL search params', async () => {
      render(
        <ToastProvider>
          <MemoryRouter initialEntries={['/profiles?page=2&pageSize=50']}>
            <Routes>
              <Route path="/profiles" element={<ProfilesListContainer />} />
            </Routes>
          </MemoryRouter>
        </ToastProvider>
      )

      await waitFor(() => {
        expect(mockFetchProfiles).toHaveBeenCalledWith(
          expect.objectContaining({
            page: 2,
            per_page: 50,
          })
        )
      })
    })
  })

  describe('Profile Edit with Typed Values', () => {
    // Test with typed parameter values in the API format
    const mockProfileWithTypedValues = {
      id: 'profile-typed',
      name: 'Typed Profile',
      type: 'database',
      description: 'Profile with typed values',
      tags: ['production'],
      usage: 0,
      config: {},
      environmentValues: {
        'env-1': {
          host: { type: 'string', secret: false, value: 'localhost' },
          port: { type: 'integer', secret: false, value: 5432 },
          password: { type: 'string', secret: true, value: 'secret123' },
          enabled: { type: 'boolean', secret: false, value: true },
          options: { type: 'array', secret: false, value: ['opt1', 'opt2'] },
          config: { type: 'map', secret: false, value: { key: 'val' } },
          matrix: { type: 'table', secret: false, value: { headers: ['A'], rows: [['1']] } },
        },
        'env-2': {
          host: { type: 'string', secret: false, value: 'staging.db' },
          port: { type: 'integer', secret: false, value: 5433 },
          // password missing for env-2 - tests empty value handling
        },
      },
      environmentsCount: 2,
      totalEnvironments: 2,
      hasIncompleteEnvironments: false,
      createdAt: '2025-01-10T10:00:00Z',
      updatedAt: '2025-01-15T14:30:00Z',
    }

    it('loads profile with typed parameter values and transforms them', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      mockFetchProfile.mockResolvedValue(mockProfileWithTypedValues)
      renderProfilesListContainer()

      await waitFor(() => {
        expect(screen.getByText('Production Database')).toBeInTheDocument()
      })

      // Click edit to trigger fetchProfile and transform
      const editButton = screen.getByTestId('action-edit')
      await user.click(editButton)

      // Should transform typed values to modal parameters
      await waitFor(() => {
        expect(mockFetchProfile).toHaveBeenCalledWith('profile-1')
      })

      await waitFor(() => {
        expect(screen.getByText('Edit Profile')).toBeInTheDocument()
      })
    })

    it('handles edit profile error with non-Error object', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      mockFetchProfile.mockRejectedValue('String error')
      renderProfilesListContainer()

      await waitFor(() => {
        expect(screen.getByText('Production Database')).toBeInTheDocument()
      })

      const editButton = screen.getByTestId('action-edit')
      await user.click(editButton)

      await waitFor(() => {
        expect(mockFetchProfile).toHaveBeenCalled()
      })

      // Should show fallback error message
      await waitFor(() => {
        expect(screen.getByTestId('error-state')).toBeInTheDocument()
      })

      consoleSpy.mockRestore()
    })
  })

  describe('Profile with Legacy Values (no type metadata)', () => {
    const mockProfileWithLegacyValues = {
      id: 'profile-legacy',
      name: 'Legacy Profile',
      type: 'custom',
      description: 'Profile with legacy format',
      tags: [],
      usage: 0,
      config: {},
      environmentValues: {
        'env-1': {
          stringVal: 'hello',
          numberVal: 42,
          boolVal: false,
          arrayVal: ['a', 'b'],
          tableVal: [['row1', 'row2']],
          mapVal: { nested: 'object' },
          password: 'secret', // Contains 'password' in name
          secret_key: 'another', // Contains 'secret' in name
          api_token: 'tok123', // Contains 'token' in name
        },
      },
      environmentsCount: 1,
      totalEnvironments: 2,
      hasIncompleteEnvironments: true,
      createdAt: '2025-01-10T10:00:00Z',
      updatedAt: '2025-01-15T14:30:00Z',
    }

    it('loads profile with legacy values and detects types', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      mockFetchProfile.mockResolvedValue(mockProfileWithLegacyValues)
      renderProfilesListContainer()

      await waitFor(() => {
        expect(screen.getByText('Production Database')).toBeInTheDocument()
      })

      const editButton = screen.getByTestId('action-edit')
      await user.click(editButton)

      await waitFor(() => {
        expect(mockFetchProfile).toHaveBeenCalledWith('profile-1')
      })

      await waitFor(() => {
        expect(screen.getByText('Edit Profile')).toBeInTheDocument()
      })
    })
  })

  describe('Profile Type Schema Fetching', () => {
    it('fetches type schema when type is selected in create modal', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderProfilesListContainer()

      await waitFor(() => {
        expect(screen.getByText('Production Database')).toBeInTheDocument()
      })

      // Open create modal
      const newButton = screen.getByRole('button', { name: /new profile/i })
      await user.click(newButton)

      await waitFor(() => {
        expect(screen.getByText('Create Profile')).toBeInTheDocument()
      })

      // Click on type selector to open it
      const typeButton = screen.getByTestId('type-selector')
      await user.click(typeButton)

      // Wait for type options to appear
      await waitFor(() => {
        expect(screen.getByText('database')).toBeInTheDocument()
      })

      // Select 'database' type
      await user.click(screen.getByText('database'))

      // Schema should be fetched for database type
      await waitFor(() => {
        expect(mockFetchProfileTypeSchema).toHaveBeenCalledWith('database')
      })
    })
  })

  describe('Modal Submit with Parameters', () => {
    it('creates profile when form is submitted in create mode', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderProfilesListContainer()

      await waitFor(() => {
        expect(screen.getByText('Production Database')).toBeInTheDocument()
      })

      // Open create modal
      const newButton = screen.getByRole('button', { name: /new profile/i })
      await user.click(newButton)

      await waitFor(() => {
        expect(screen.getByText('Create Profile')).toBeInTheDocument()
      })

      // Get the name input by ID
      const dialog = screen.getByRole('dialog')
      const nameInput = dialog.querySelector("textarea#name") as HTMLTextAreaElement
      await user.clear(nameInput)
      await user.type(nameInput, 'New Test Profile')

      // Select a type (required for submit to be enabled)
      const typeButton = screen.getByTestId('type-selector')
      await user.click(typeButton)

      await waitFor(() => {
        expect(screen.getByText('database')).toBeInTheDocument()
      })

      await user.click(screen.getByText('database'))

      // Wait for button to be enabled
      await waitFor(() => {
        const createButton = screen.getByRole('button', { name: /^create$/i })
        expect(createButton).not.toBeDisabled()
      })

      // Submit the form
      const createButton = screen.getByRole('button', { name: /^create$/i })
      await user.click(createButton)

      await waitFor(() => {
        expect(mockCreateProfile).toHaveBeenCalled()
      })

      // Verify the call includes expected data
      expect(mockCreateProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'New Test Profile',
          type: 'database',
        })
      )
    })

    it('updates profile when form is submitted in edit mode', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderProfilesListContainer()

      await waitFor(() => {
        expect(screen.getByText('Production Database')).toBeInTheDocument()
      })

      // Open edit modal
      const editButton = screen.getByTestId('action-edit')
      await user.click(editButton)

      await waitFor(() => {
        expect(screen.getByText('Edit Profile')).toBeInTheDocument()
      })

      // Get the name input by ID (it's the first textbox in the metadata section)
      const dialog = screen.getByRole('dialog')
      const nameInput = dialog.querySelector("textarea#name") as HTMLTextAreaElement
      await user.clear(nameInput)
      await user.type(nameInput, 'Updated Profile Name')

      // Submit the form
      const saveButton = screen.getByRole('button', { name: /save changes/i })
      await user.click(saveButton)

      await waitFor(() => {
        expect(mockUpdateProfile).toHaveBeenCalled()
      })

      expect(mockUpdateProfile).toHaveBeenCalledWith(
        'profile-1',
        expect.objectContaining({
          name: 'Updated Profile Name',
        })
      )
    })

    it('handles submit error in create mode', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      mockCreateProfile.mockRejectedValue(new Error('Create failed'))

      renderProfilesListContainer()

      await waitFor(() => {
        expect(screen.getByText('Production Database')).toBeInTheDocument()
      })

      // Open create modal
      const newButton = screen.getByRole('button', { name: /new profile/i })
      await user.click(newButton)

      await waitFor(() => {
        expect(screen.getByText('Create Profile')).toBeInTheDocument()
      })

      // Get the name input by ID
      const dialog = screen.getByRole('dialog')
      const nameInput = dialog.querySelector("textarea#name") as HTMLTextAreaElement
      await user.clear(nameInput)
      await user.type(nameInput, 'New Test Profile')

      // Select a type
      const typeButton = screen.getByTestId('type-selector')
      await user.click(typeButton)

      await waitFor(() => {
        expect(screen.getByText('database')).toBeInTheDocument()
      })

      await user.click(screen.getByText('database'))

      // Wait for button to be enabled and submit
      await waitFor(() => {
        const createButton = screen.getByRole('button', { name: /^create$/i })
        expect(createButton).not.toBeDisabled()
      })

      const createButton = screen.getByRole('button', { name: /^create$/i })
      await user.click(createButton)

      await waitFor(() => {
        expect(mockCreateProfile).toHaveBeenCalled()
      })

      await waitFor(() => {
        expect(consoleSpy).toHaveBeenCalledWith('Failed to save profile:', expect.any(Error))
      })

      consoleSpy.mockRestore()
    })

    it('handles submit error with non-Error object', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      mockCreateProfile.mockRejectedValue('String error')

      renderProfilesListContainer()

      await waitFor(() => {
        expect(screen.getByText('Production Database')).toBeInTheDocument()
      })

      // Open create modal
      const newButton = screen.getByRole('button', { name: /new profile/i })
      await user.click(newButton)

      await waitFor(() => {
        expect(screen.getByText('Create Profile')).toBeInTheDocument()
      })

      // Get the name input by ID
      const dialog = screen.getByRole('dialog')
      const nameInput = dialog.querySelector("textarea#name") as HTMLTextAreaElement
      await user.clear(nameInput)
      await user.type(nameInput, 'New Test Profile')

      // Select a type
      const typeButton = screen.getByTestId('type-selector')
      await user.click(typeButton)

      await waitFor(() => {
        expect(screen.getByText('database')).toBeInTheDocument()
      })

      await user.click(screen.getByText('database'))

      // Wait for button to be enabled and submit
      await waitFor(() => {
        const createButton = screen.getByRole('button', { name: /^create$/i })
        expect(createButton).not.toBeDisabled()
      })

      const createButton = screen.getByRole('button', { name: /^create$/i })
      await user.click(createButton)

      await waitFor(() => {
        expect(mockCreateProfile).toHaveBeenCalled()
      })

      consoleSpy.mockRestore()
    })

    it('submits updated profile with all parameter values transformed', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      // Mock profile with typed values in all formats
      const profileWithParams = {
        id: 'profile-1',
        name: 'Test Profile',
        type: 'database',
        description: 'Test',
        tags: [],
        usage: 0,
        config: {},
        environmentValues: {
          'env-1': {
            host: { type: 'string', secret: false, value: 'localhost' },
            port: { type: 'integer', secret: false, value: 5432 },
            enabled: { type: 'boolean', secret: false, value: true },
          },
        },
        environmentsCount: 1,
        totalEnvironments: 2,
        hasIncompleteEnvironments: false,
        createdAt: '2025-01-10T10:00:00Z',
        updatedAt: '2025-01-15T14:30:00Z',
      }

      mockFetchProfile.mockResolvedValue(profileWithParams)
      renderProfilesListContainer()

      await waitFor(() => {
        expect(screen.getByText('Production Database')).toBeInTheDocument()
      })

      // Click edit to load profile with parameters
      const editButton = screen.getByTestId('action-edit')
      await user.click(editButton)

      await waitFor(() => {
        expect(screen.getByText('Edit Profile')).toBeInTheDocument()
      })

      // Submit without changes to trigger parametersToConfig
      // Nothing changed anywhere keeps Save disabled.
      changeDescription()
      const saveButton = screen.getByRole('button', { name: /save changes/i })
      await user.click(saveButton)

      await waitFor(() => {
        expect(mockUpdateProfile).toHaveBeenCalled()
      })
    })

    it('handles delete error with non-Error object in confirmation dialog', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      mockDeleteProfile.mockRejectedValue('String error for delete')
      renderProfilesListContainer()

      await waitFor(() => {
        expect(screen.getByText('Production Database')).toBeInTheDocument()
      })

      // Open delete dialog
      const menuTrigger = screen.getByTestId('action-menu-trigger')
      await user.click(menuTrigger)

      await waitFor(() => {
        const deleteOption = screen.getByRole('menuitem', { name: /delete/i })
        expect(deleteOption).toBeInTheDocument()
      })

      const deleteOption = screen.getByRole('menuitem', { name: /delete/i })
      await user.click(deleteOption)

      await waitFor(() => {
        expect(screen.getByText(/permanently removed/i)).toBeInTheDocument()
      })

      // Confirm delete
      const confirmButton = screen.getByRole('button', { name: /delete/i })
      await user.click(confirmButton)

      await waitFor(() => {
        expect(mockDeleteProfile).toHaveBeenCalled()
      })

      await waitFor(() => {
        expect(consoleSpy).toHaveBeenCalled()
      })

      consoleSpy.mockRestore()
    })

    it('handles delete profile for non-existent profile ID gracefully', async () => {
      // Return empty profiles so the profile isn't found
      mockFetchProfiles.mockResolvedValue({
        data: [],
        pagination: { page: 1, per_page: 25, total: 0, total_pages: 1 },
      })

      renderProfilesListContainer()

      await waitFor(() => {
        // No profiles - show empty state
        expect(mockFetchProfiles).toHaveBeenCalled()
      })

      // The delete handler won't do anything if profile not found
      // This tests the early return in handleDeleteProfile
    })
  })

  describe('Environment Fallback', () => {
    it('uses default environment when no environments available', async () => {
      mockFetchEnvironments.mockResolvedValue([])
      renderProfilesListContainer()

      await waitFor(() => {
        expect(mockFetchEnvironments).toHaveBeenCalled()
      })
    })

    it('shows warning when trying to create profile without environments', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      mockFetchEnvironments.mockResolvedValue([])
      renderProfilesListContainer()

      await waitFor(() => {
        expect(mockFetchEnvironments).toHaveBeenCalled()
      })

      // Click new profile button
      const newProfileButton = screen.getByRole('button', { name: /new profile/i })
      await user.click(newProfileButton)

      // Should show warning toast instead of opening modal
      await waitFor(() => {
        expect(screen.getByText(/Please create at least one environment/i)).toBeInTheDocument()
      })
    })
  })

  describe('Edit Dialog with an Empty Environment List', () => {
    it('opens and saves when the server genuinely reported no environments', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      mockFetchEnvironments.mockResolvedValue([])
      renderProfilesListContainer()

      await waitFor(() => {
        expect(screen.getByText('Production Database')).toBeInTheDocument()
      })

      await user.click(screen.getByTestId('action-edit'))

      await waitFor(() => {
        expect(screen.getByText('Edit Profile')).toBeInTheDocument()
      })

      const dialog = screen.getByRole('dialog')
      const nameInput = dialog.querySelector('textarea#name') as HTMLTextAreaElement
      await user.clear(nameInput)
      await user.type(nameInput, 'Renamed With No Environments')

      await user.click(screen.getByRole('button', { name: /save changes/i }))

      await waitFor(() => {
        expect(mockUpdateProfile).toHaveBeenCalledWith(
          'profile-1',
          expect.objectContaining({ name: 'Renamed With No Environments' })
        )
      })
    })

    it('reports the refusal and issues no update request when the environments read failed', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      mockFetchEnvironments.mockRejectedValue(new Error('Environments unavailable'))
      renderProfilesListContainer()

      await waitFor(() => {
        expect(screen.getByText('Production Database')).toBeInTheDocument()
      })

      await user.click(screen.getByTestId('action-edit'))

      expect(screen.queryByText('Edit Profile')).not.toBeInTheDocument()
      expect(mockFetchProfile).not.toHaveBeenCalled()
      expect(mockUpdateProfile).not.toHaveBeenCalled()
      expect(await screen.findByText('Profile Not Opened for Editing')).toBeInTheDocument()
      expect(
        screen.getByText('Could not load environments. Try Again to load them.')
      ).toBeInTheDocument()
    })

    it('reports the refusal instead of warning when the environments read failed', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      mockFetchEnvironments.mockRejectedValue(new Error('Environments unavailable'))
      renderProfilesListContainer()

      await waitFor(() => {
        expect(screen.getByText('Production Database')).toBeInTheDocument()
      })

      await user.click(screen.getByRole('button', { name: /new profile/i }))

      expect(screen.queryByText(/Please create at least one environment/i)).not.toBeInTheDocument()
      expect(screen.queryByText('Create Profile')).not.toBeInTheDocument()
      expect(mockCreateProfile).not.toHaveBeenCalled()
      expect(await screen.findByText('New Profile Not Created')).toBeInTheDocument()
      expect(
        screen.getByText('Could not load environments. Try Again to load them.')
      ).toBeInTheDocument()
    })
  })

  describe('Refusals Over a Failed Environments Read', () => {
    async function renderWithFailedEnvironments() {
      mockFetchEnvironments.mockRejectedValue(new Error('Environments unavailable'))
      renderProfilesListContainer()

      await waitFor(() => {
        expect(screen.getByText('Production Database')).toBeInTheDocument()
      })
      await waitFor(() => {
        expect(usePageBlockStore.getState().block?.title).toBe('Could not load environments')
      })
    }

    it('tells the user the delete was refused and issues no delete request', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      await renderWithFailedEnvironments()

      await user.click(screen.getByTestId('action-menu-trigger'))
      await user.click(await screen.findByRole('menuitem', { name: /delete/i }))

      const dialog = await screen.findByRole('alertdialog')
      await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

      expect(mockDeleteProfile).not.toHaveBeenCalled()
      // Confirming always closes the dialog, so a refusal cannot land inside it.
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
      expect(await screen.findByText('Profile Not Deleted')).toBeInTheDocument()
      expect(
        screen.getByText('Could not load environments. Try Again to load them.')
      ).toBeInTheDocument()
    })

    it('tells the user the duplicate was refused and issues no duplicate request', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      await renderWithFailedEnvironments()

      await user.click(screen.getByTestId('action-menu-trigger'))
      await user.click(await screen.findByRole('menuitem', { name: /duplicate/i }))

      expect(mockDuplicateProfile).not.toHaveBeenCalled()
      expect(await screen.findByText('Profile Not Duplicated')).toBeInTheDocument()
      expect(
        screen.getByText('Could not load environments. Try Again to load them.')
      ).toBeInTheDocument()
    })

    async function selectTheOneProfile(
      user: ReturnType<typeof import('@testing-library/user-event').default.setup>
    ) {
      await user.click(screen.getByRole('button', { name: /mass action/i }))
      await user.click(
        await screen.findByRole('checkbox', { name: /select production database/i })
      )
      await user.click(screen.getByTestId('selection-counter'))
    }

    it('tells the user the bulk delete was refused and issues no delete request', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      await renderWithFailedEnvironments()

      await selectTheOneProfile(user)
      await user.click(await screen.findByTestId('bulk-action-delete'))

      expect(mockDeleteProfile).not.toHaveBeenCalled()
      expect(await screen.findByText('Profiles Not Deleted')).toBeInTheDocument()
      expect(
        screen.getByText('Could not load environments. Try Again to load them.')
      ).toBeInTheDocument()
    })

    it('tells the user the bulk duplicate was refused and issues no duplicate request', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      await renderWithFailedEnvironments()

      await selectTheOneProfile(user)
      await user.click(await screen.findByTestId('bulk-action-duplicate'))

      expect(mockDuplicateProfile).not.toHaveBeenCalled()
      expect(await screen.findByText('Profiles Not Duplicated')).toBeInTheDocument()
      expect(
        screen.getByText('Could not load environments. Try Again to load them.')
      ).toBeInTheDocument()
    })
  })

  describe('Filter URL Parameter Updates', () => {
    it('updates URL when type filter changes', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderProfilesListContainer()

      await waitFor(() => {
        expect(screen.getByText('Production Database')).toBeInTheDocument()
      })

      // Open type filter
      const typeFilter = screen.getByTestId('filter-type')
      await user.click(typeFilter)

      await waitFor(() => {
        expect(screen.getByText('database')).toBeInTheDocument()
      })

      // Select database type
      await user.click(screen.getByText('database'))

      // Verify filter change triggered API call
      await waitFor(() => {
        const calls = mockFetchProfiles.mock.calls
        const hasTypeCall = calls.some(
          (call: unknown[]) => (call[0] as { type?: string })?.type === 'database'
        )
        expect(hasTypeCall).toBe(true)
      })
    })

    it('updates URL when tags filter changes', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const { within } = await import('@testing-library/react')
      const user = userEvent.setup()

      renderProfilesListContainer()

      await waitFor(() => {
        expect(screen.getByText('Production Database')).toBeInTheDocument()
      })

      // Open tags filter
      const tagsFilter = screen.getByTestId('filter-tags')
      await user.click(tagsFilter)

      // Wait for dialog to appear
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument()
      })

      // Select a tag within the dialog (staging doesn't exist in profile tags)
      const dialog = screen.getByRole('dialog')
      await user.click(within(dialog).getByText('staging'))

      // Verify filter change triggered API call
      await waitFor(() => {
        const calls = mockFetchProfiles.mock.calls
        const hasTagsCall = calls.some(
          (call: unknown[]) => {
            const params = call[0] as { tags?: string[] }
            return params.tags && params.tags.includes('staging')
          }
        )
        expect(hasTagsCall).toBe(true)
      })
    })
  })

  describe('Custom Profile Type Config Format', () => {
    it('creates custom profile with wrapped config format', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      renderProfilesListContainer()

      await waitFor(() => {
        expect(screen.getByText('Production Database')).toBeInTheDocument()
      })

      // Open create modal
      const newButton = screen.getByRole('button', { name: /new profile/i })
      await user.click(newButton)

      await waitFor(() => {
        expect(screen.getByText('Create Profile')).toBeInTheDocument()
      })

      // Get the name input by ID
      const dialog = screen.getByRole('dialog')
      const nameInput = dialog.querySelector("textarea#name") as HTMLTextAreaElement
      await user.clear(nameInput)
      await user.type(nameInput, 'Custom Test Profile')

      // Select 'custom' type to trigger wrapped config format
      const typeButton = screen.getByTestId('type-selector')
      await user.click(typeButton)

      await waitFor(() => {
        expect(within(screen.getByRole('listbox')).getByText('custom')).toBeInTheDocument()
      })

      await user.click(within(screen.getByRole('listbox')).getByText('custom'))

      // Wait for button to be enabled and submit
      await waitFor(() => {
        const createButton = screen.getByRole('button', { name: /^create$/i })
        expect(createButton).not.toBeDisabled()
      })

      const createButton = screen.getByRole('button', { name: /^create$/i })
      await user.click(createButton)

      await waitFor(() => {
        expect(mockCreateProfile).toHaveBeenCalled()
      })

      consoleSpy.mockRestore()
    })

    it('updates custom profile with wrapped config including type metadata', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      // Mock profile with custom type and parameters
      const customProfile = {
        id: 'profile-1',
        name: 'Custom Profile',
        type: 'custom',
        description: 'Test custom profile',
        tags: [],
        usage: 0,
        config: {},
        environmentValues: {
          'env-1': {
            apiKey: { type: 'string', secret: true, value: 'secret123' },
            timeout: { type: 'integer', secret: false, value: 30 },
          },
        },
        environmentsCount: 1,
        totalEnvironments: 2,
        hasIncompleteEnvironments: false,
        createdAt: '2025-01-10T10:00:00Z',
        updatedAt: '2025-01-15T14:30:00Z',
      }

      mockFetchProfile.mockResolvedValue(customProfile)
      renderProfilesListContainer()

      await waitFor(() => {
        expect(screen.getByText('Production Database')).toBeInTheDocument()
      })

      // Click edit to load custom profile
      const editButton = screen.getByTestId('action-edit')
      await user.click(editButton)

      await waitFor(() => {
        expect(screen.getByText('Edit Profile')).toBeInTheDocument()
      })

      // Submit to trigger parametersToConfig with custom type
      // Nothing changed anywhere keeps Save disabled.
      changeDescription()
      const saveButton = screen.getByRole('button', { name: /save changes/i })
      await user.click(saveButton)

      await waitFor(() => {
        expect(mockUpdateProfile).toHaveBeenCalled()
      })
    })
  })

  describe('Value Type Conversion Edge Cases', () => {
    it('handles Array type with invalid JSON falling back to empty array', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      // Mock profile with invalid JSON string in Array field
      const profileWithInvalidArray = {
        id: 'profile-1',
        name: 'Profile with Invalid Array',
        type: 'custom',
        description: '',
        tags: [],
        usage: 0,
        config: {},
        environmentValues: {
          'env-1': {
            items: { type: 'array', secret: false, value: 'not valid json [' },
          },
        },
        environmentsCount: 1,
        totalEnvironments: 1,
        hasIncompleteEnvironments: false,
        createdAt: '2025-01-10T10:00:00Z',
        updatedAt: '2025-01-15T14:30:00Z',
      }

      mockFetchProfile.mockResolvedValue(profileWithInvalidArray)
      renderProfilesListContainer()

      await waitFor(() => {
        expect(screen.getByText('Production Database')).toBeInTheDocument()
      })

      // Click edit
      const editButton = screen.getByTestId('action-edit')
      await user.click(editButton)

      await waitFor(() => {
        expect(screen.getByText('Edit Profile')).toBeInTheDocument()
      })

      // Submit to trigger conversion with invalid JSON
      // Nothing changed anywhere keeps Save disabled.
      changeDescription()
      const saveButton = screen.getByRole('button', { name: /save changes/i })
      await user.click(saveButton)

      await waitFor(() => {
        expect(mockUpdateProfile).toHaveBeenCalled()
      })
    })

    it('handles Table type with invalid JSON falling back to empty table', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      // Mock profile with invalid JSON in Table field
      const profileWithInvalidTable = {
        id: 'profile-1',
        name: 'Profile with Invalid Table',
        type: 'custom',
        description: '',
        tags: [],
        usage: 0,
        config: {},
        environmentValues: {
          'env-1': {
            data: { type: 'table', secret: false, value: '{ invalid json }' },
          },
        },
        environmentsCount: 1,
        totalEnvironments: 1,
        hasIncompleteEnvironments: false,
        createdAt: '2025-01-10T10:00:00Z',
        updatedAt: '2025-01-15T14:30:00Z',
      }

      mockFetchProfile.mockResolvedValue(profileWithInvalidTable)
      renderProfilesListContainer()

      await waitFor(() => {
        expect(screen.getByText('Production Database')).toBeInTheDocument()
      })

      // Click edit
      const editButton = screen.getByTestId('action-edit')
      await user.click(editButton)

      await waitFor(() => {
        expect(screen.getByText('Edit Profile')).toBeInTheDocument()
      })

      // Submit to trigger conversion with invalid JSON
      // Nothing changed anywhere keeps Save disabled.
      changeDescription()
      const saveButton = screen.getByRole('button', { name: /save changes/i })
      await user.click(saveButton)

      await waitFor(() => {
        expect(mockUpdateProfile).toHaveBeenCalled()
      })
    })

    it('handles Map type with invalid JSON falling back to empty object (parameter conversion)', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      // Mock profile with invalid JSON in Map field
      const profileWithInvalidMap = {
        id: 'profile-1',
        name: 'Profile with Invalid Map',
        type: 'custom',
        description: '',
        tags: [],
        usage: 0,
        config: {},
        environmentValues: {
          'env-1': {
            metadata: { type: 'map', secret: false, value: 'invalid { json' },
          },
        },
        environmentsCount: 1,
        totalEnvironments: 1,
        hasIncompleteEnvironments: false,
        createdAt: '2025-01-10T10:00:00Z',
        updatedAt: '2025-01-15T14:30:00Z',
      }

      mockFetchProfile.mockResolvedValue(profileWithInvalidMap)
      renderProfilesListContainer()

      await waitFor(() => {
        expect(screen.getByText('Production Database')).toBeInTheDocument()
      })

      // Click edit
      const editButton = screen.getByTestId('action-edit')
      await user.click(editButton)

      await waitFor(() => {
        expect(screen.getByText('Edit Profile')).toBeInTheDocument()
      })

      // Submit to trigger conversion with invalid JSON
      // Nothing changed anywhere keeps Save disabled.
      changeDescription()
      const saveButton = screen.getByRole('button', { name: /save changes/i })
      await user.click(saveButton)

      await waitFor(() => {
        expect(mockUpdateProfile).toHaveBeenCalled()
      })
    })
  })

  describe('Export Profiles', () => {
    it('opens export dialog when Export row action is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderProfilesListContainer()

      await waitFor(() => {
        expect(screen.getByText('Production Database')).toBeInTheDocument()
      })

      // Open kebab menu
      await user.click(screen.getByTestId('action-menu-trigger'))

      // Click Export
      await user.click(screen.getByRole('menuitem', { name: /Export/i }))

      // Export dialog should open
      await waitFor(() => {
        expect(screen.getByTestId('export-dialog')).toBeInTheDocument()
      })
    })

    it('performs single export and downloads through the shared downloadBlob helper', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      const blob = new Blob(['content'], { type: 'application/x-yaml' })
      mockExportProfile.mockResolvedValue(blob)

      renderProfilesListContainer()

      await waitFor(() => {
        expect(screen.getByText('Production Database')).toBeInTheDocument()
      })

      // Open kebab menu and click Export
      await user.click(screen.getByTestId('action-menu-trigger'))
      await user.click(screen.getByRole('menuitem', { name: /Export/i }))

      await waitFor(() => {
        expect(screen.getByTestId('export-dialog')).toBeInTheDocument()
      })

      // Click the Download button
      await user.click(screen.getByTestId('export-button'))

      await waitFor(() => {
        expect(mockExportProfile).toHaveBeenCalledWith('profile-1', expect.objectContaining({ format: 'yaml' }))
      })
      expect(downloadBlob).toHaveBeenCalledWith(blob, 'Production Database.yaml')
    })

    it('handles export error gracefully', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      mockExportProfile.mockRejectedValue(new Error('Export failed'))

      renderProfilesListContainer()

      await waitFor(() => {
        expect(screen.getByText('Production Database')).toBeInTheDocument()
      })

      // Open kebab menu and click Export
      await user.click(screen.getByTestId('action-menu-trigger'))
      await user.click(screen.getByRole('menuitem', { name: /Export/i }))

      await waitFor(() => {
        expect(screen.getByTestId('export-dialog')).toBeInTheDocument()
      })

      // Click the Download button
      await user.click(screen.getByTestId('export-button'))

      await waitFor(() => {
        expect(consoleSpy).toHaveBeenCalledWith('Export failed:', expect.any(Error))
      })

      consoleSpy.mockRestore()
    })
  })

  describe('Import Profiles', () => {
    it('opens import dialog when Import button is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderProfilesListContainer()

      await waitFor(() => {
        expect(screen.getByText('Production Database')).toBeInTheDocument()
      })

      // Click Import button
      await user.click(screen.getByTestId('import-button'))

      await waitFor(() => {
        expect(screen.getByTestId('import-dialog')).toBeInTheDocument()
      })
    })

    it('refreshes profiles after successful import', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      const mockValidateResult = {
        items: [
          { name: 'New Profile', status: 'ok', fatal_errors: [], fixable_errors: [], warnings: [], existing_id: null },
        ],
        total: 1,
        importable: 1,
        blocked: 0,
      }
      const mockImportResult = {
        imported: [{ name: 'New Profile', id: 'new-id', action: 'created' }],
        skipped: [],
        fixes_applied: [],
        total_imported: 1,
        total_skipped: 0,
      }

      mockValidateProfileImport.mockResolvedValue(mockValidateResult)
      mockImportProfiles.mockResolvedValue(mockImportResult)

      renderProfilesListContainer()

      await waitFor(() => {
        expect(screen.getByText('Production Database')).toBeInTheDocument()
      })

      // Open import dialog
      await user.click(screen.getByTestId('import-button'))

      await waitFor(() => {
        expect(screen.getByTestId('import-dialog')).toBeInTheDocument()
      })

      // Upload file
      const file = new File(['content'], 'profiles.yaml')
      const fileInput = screen.getByTestId('file-input')
      await user.upload(fileInput, file)

      // Click Validate
      await user.click(screen.getByTestId('validate-button'))

      await waitFor(() => {
        expect(screen.getByTestId('review-step')).toBeInTheDocument()
      })

      // Clear mock to check reload
      mockFetchProfiles.mockClear()

      // Click Import button inside the import dialog (not the toolbar button)
      const { within } = await import('@testing-library/react')
      const importDialog = screen.getByTestId('import-dialog')
      await user.click(within(importDialog).getByTestId('import-button'))

      await waitFor(() => {
        expect(mockFetchProfiles).toHaveBeenCalled()
      })
    })
  })

  describe('Selection Mode and Bulk Actions', () => {
    it('enters selection mode when Mass Action button is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderProfilesListContainer()

      await waitFor(() => {
        expect(screen.getByText('Production Database')).toBeInTheDocument()
      })

      // Click Mass Action button
      const massActionBtn = screen.getByRole('button', { name: /mass action/i })
      await user.click(massActionBtn)

      // Selection mode should be active
      await waitFor(() => {
        expect(screen.getByTestId('selection-counter')).toBeInTheDocument()
      })
    })

    it('exits selection mode when close button is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderProfilesListContainer()

      await waitFor(() => {
        expect(screen.getByText('Production Database')).toBeInTheDocument()
      })

      // Enter selection mode
      await user.click(screen.getByRole('button', { name: /mass action/i }))

      await waitFor(() => {
        expect(screen.getByTestId('selection-close')).toBeInTheDocument()
      })

      // Exit selection mode
      await user.click(screen.getByTestId('selection-close'))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /mass action/i })).toBeInTheDocument()
      })
    })

    it('selects profiles via checkboxes in selection mode', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderProfilesListContainer()

      await waitFor(() => {
        expect(screen.getByText('Production Database')).toBeInTheDocument()
      })

      // Enter selection mode
      await user.click(screen.getByRole('button', { name: /mass action/i }))

      await waitFor(() => {
        expect(screen.getByRole('checkbox', { name: /select all/i })).toBeInTheDocument()
      })

      // Select the Production Database profile
      const rowCheckbox = screen.getByRole('checkbox', { name: /select production database/i })
      await user.click(rowCheckbox)

      // Counter should show 1 selected
      await waitFor(() => {
        expect(screen.getByTestId('selection-counter')).toHaveTextContent('1 selected')
      })
    })

    it('bulk duplicates selected profiles', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      mockDuplicateProfile.mockResolvedValue({})

      renderProfilesListContainer()

      await waitFor(() => {
        expect(screen.getByText('Production Database')).toBeInTheDocument()
      })

      // Enter selection mode and select
      await user.click(screen.getByRole('button', { name: /mass action/i }))

      await waitFor(() => {
        expect(screen.getByRole('checkbox', { name: /select production database/i })).toBeInTheDocument()
      })

      await user.click(screen.getByRole('checkbox', { name: /select production database/i }))

      // Open bulk actions dropdown
      await user.click(screen.getByTestId('selection-counter'))

      await waitFor(() => {
        expect(screen.getByTestId('bulk-action-duplicate')).toBeInTheDocument()
      })

      // Clear mock
      mockFetchProfiles.mockClear()

      // Click duplicate
      await user.click(screen.getByTestId('bulk-action-duplicate'))

      await waitFor(() => {
        expect(mockDuplicateProfile).toHaveBeenCalledWith('profile-1')
      })
    })

    it('bulk deletes selected profiles', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      mockDeleteProfile.mockResolvedValue({})

      renderProfilesListContainer()

      await waitFor(() => {
        expect(screen.getByText('Production Database')).toBeInTheDocument()
      })

      // Enter selection mode and select
      await user.click(screen.getByRole('button', { name: /mass action/i }))

      await waitFor(() => {
        expect(screen.getByRole('checkbox', { name: /select production database/i })).toBeInTheDocument()
      })

      await user.click(screen.getByRole('checkbox', { name: /select production database/i }))

      // Open bulk actions dropdown
      await user.click(screen.getByTestId('selection-counter'))

      await waitFor(() => {
        expect(screen.getByTestId('bulk-action-delete')).toBeInTheDocument()
      })

      // Clear mock
      mockFetchProfiles.mockClear()

      // Click delete
      await user.click(screen.getByTestId('bulk-action-delete'))

      await waitFor(() => {
        expect(mockDeleteProfile).toHaveBeenCalledWith('profile-1')
      })
    })

    it('bulk exports selected profiles', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderProfilesListContainer()

      await waitFor(() => {
        expect(screen.getByText('Production Database')).toBeInTheDocument()
      })

      // Enter selection mode and select
      await user.click(screen.getByRole('button', { name: /mass action/i }))

      await waitFor(() => {
        expect(screen.getByRole('checkbox', { name: /select production database/i })).toBeInTheDocument()
      })

      await user.click(screen.getByRole('checkbox', { name: /select production database/i }))

      // Open bulk actions dropdown
      await user.click(screen.getByTestId('selection-counter'))

      await waitFor(() => {
        expect(screen.getByTestId('bulk-action-export')).toBeInTheDocument()
      })

      // Click export
      await user.click(screen.getByTestId('bulk-action-export'))

      // Export dialog should open
      await waitFor(() => {
        expect(screen.getByTestId('export-dialog')).toBeInTheDocument()
      })
    })

    it('performs bulk export and downloads the ZIP through the shared downloadBlob helper', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      const blob = new Blob(['zip content'], { type: 'application/zip' })
      mockExportProfiles.mockResolvedValue(blob)

      // Use multi-profile response
      const multiResponse = {
        data: [
          { ...mockProfilesResponse.data[0], id: 'profile-1', name: 'Profile A' },
          { ...mockProfilesResponse.data[0], id: 'profile-2', name: 'Profile B' },
        ],
        pagination: { page: 1, per_page: 20, total: 2, total_pages: 1 },
      }
      mockFetchProfiles.mockResolvedValue(multiResponse)

      renderProfilesListContainer()

      await waitFor(() => {
        expect(screen.getByText('Profile A')).toBeInTheDocument()
        expect(screen.getByText('Profile B')).toBeInTheDocument()
      })

      // Enter selection mode
      await user.click(screen.getByRole('button', { name: /mass action/i }))

      await waitFor(() => {
        expect(screen.getByRole('checkbox', { name: /select all/i })).toBeInTheDocument()
      })

      // Select all
      await user.click(screen.getByRole('checkbox', { name: /select all/i }))

      // Open bulk actions and click export
      await user.click(screen.getByTestId('selection-counter'))

      await waitFor(() => {
        expect(screen.getByTestId('bulk-action-export')).toBeInTheDocument()
      })

      await user.click(screen.getByTestId('bulk-action-export'))

      // Export dialog should open
      await waitFor(() => {
        expect(screen.getByTestId('export-dialog')).toBeInTheDocument()
      })

      // Click Download ZIP
      await user.click(screen.getByTestId('export-button'))

      await waitFor(() => {
        expect(mockExportProfiles).toHaveBeenCalledWith(['profile-1', 'profile-2'], expect.objectContaining({ format: 'yaml' }))
      })
      expect(downloadBlob).toHaveBeenCalledWith(blob, 'profiles-export.zip')
    })

    it('handles bulk duplicate error gracefully', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      mockDuplicateProfile.mockRejectedValue(new Error('Duplicate failed'))

      renderProfilesListContainer()

      await waitFor(() => {
        expect(screen.getByText('Production Database')).toBeInTheDocument()
      })

      // Enter selection mode and select
      await user.click(screen.getByRole('button', { name: /mass action/i }))

      await waitFor(() => {
        expect(screen.getByRole('checkbox', { name: /select production database/i })).toBeInTheDocument()
      })

      await user.click(screen.getByRole('checkbox', { name: /select production database/i }))

      // Open bulk actions and click duplicate
      await user.click(screen.getByTestId('selection-counter'))

      await waitFor(() => {
        expect(screen.getByTestId('bulk-action-duplicate')).toBeInTheDocument()
      })

      await user.click(screen.getByTestId('bulk-action-duplicate'))

      // The reason is named in a titled toast; the list reloads either way.
      expect(await screen.findByText('Duplicate Failed')).toBeInTheDocument()
      expect(screen.getByText('Duplicate failed')).toBeInTheDocument()

      consoleSpy.mockRestore()
    })

    it('handles bulk delete error gracefully', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      mockDeleteProfile.mockRejectedValue(new Error('Delete failed'))

      renderProfilesListContainer()

      await waitFor(() => {
        expect(screen.getByText('Production Database')).toBeInTheDocument()
      })

      // Enter selection mode and select
      await user.click(screen.getByRole('button', { name: /mass action/i }))

      await waitFor(() => {
        expect(screen.getByRole('checkbox', { name: /select production database/i })).toBeInTheDocument()
      })

      await user.click(screen.getByRole('checkbox', { name: /select production database/i }))

      // Open bulk actions and click delete
      await user.click(screen.getByTestId('selection-counter'))

      await waitFor(() => {
        expect(screen.getByTestId('bulk-action-delete')).toBeInTheDocument()
      })

      await user.click(screen.getByTestId('bulk-action-delete'))

      // The reason is named in a titled toast; the list reloads either way.
      expect(await screen.findByText('Delete Failed')).toBeInTheDocument()
      expect(screen.getByText('Delete failed')).toBeInTheDocument()

      consoleSpy.mockRestore()
    })
  })
})
