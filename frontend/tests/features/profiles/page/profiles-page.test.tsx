/**
 * ProfilesPage Component Tests
 *
 * REQ-4.7.4: Profile management UI
 *
 * V-PROF-01: Profiles list with Type, Tags, Usage columns
 *
 * Tests for ProfilesPage component per design decisions and wireframes:
 * - PROFILE-1: Name and Actions columns sticky on horizontal scroll
 * - PROFILE-2: Full pagination (item count, page size 10/25/50/100, navigation)
 * - PROFILE-3: Single-page lists show all controls, disabled when not applicable
 * - PROFILE-4: Loading: 9 skeleton rows, varying bar widths
 * - PROFILE-5: Error: empathetic tone, "Try Again" button, red alert icon
 * - PROFILE-6: Empty: entity-specific icon, encouraging message, primary CTA
 * - PROFILE-7: Type badges showing profile type (database, ssh, http, etc.)
 * - PROFILE-8: No Status filter (profiles don't execute)
 * - PROFILE-9: No Mass Action (not applicable to profiles)
 * - PROFILE-10: No Run action (profiles are configuration, not executable)
 *
 * Page structure:
 * - Page title: "Profiles" (h1)
 * - "+ New Profile" button in header
 * - Filters row: search, type, tags
 * - Columns button (NO Mass Action per PROFILE-9)
 * - Data table with columns: Name, Type, Tags, Usage, Actions
 * - Pagination controls
 *
 * Component: frontend/src/pages/profiles.tsx
 */

import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ProfilesPage, type ProfilesPageProps, type Profile } from '@/features/profiles/page'

// ============================================================================
// Mock Data
// ============================================================================

const mockProfiles: Profile[] = [
  {
    id: 'profile-1',
    name: 'Production Database',
    type: 'database',
    description: 'Production PostgreSQL connection',
    tags: ['production', 'database'],
    usage: 5,
    config: {},
    environmentValues: { 'env-prod': { host: 'db.prod.example.com' }, 'env-staging': { host: 'db.staging.example.com' }, 'env-dev': { host: 'db.dev.example.com' } },
    environmentsCount: 3,
    totalEnvironments: 3,
    hasIncompleteEnvironments: false,
    createdAt: '2025-01-10T00:00:00Z',
    updatedAt: '2025-01-15T10:30:00Z',
  },
  {
    id: 'profile-2',
    name: 'Staging SSH',
    type: 'ssh',
    description: 'Staging server SSH access',
    tags: ['staging', 'ssh'],
    usage: 3,
    config: {},
    environmentValues: { 'env-staging': { host: 'staging.example.com' } },
    environmentsCount: 1,
    totalEnvironments: 3,
    hasIncompleteEnvironments: true,
    createdAt: '2025-01-11T00:00:00Z',
    updatedAt: '2025-01-14T09:15:00Z',
  },
  {
    id: 'profile-3',
    name: 'Development HTTP',
    type: 'http',
    description: null,
    tags: [],
    usage: 0,
    config: {},
    environmentValues: {},
    environmentsCount: 0,
    totalEnvironments: 3,
    hasIncompleteEnvironments: true,
    createdAt: '2025-01-12T00:00:00Z',
    updatedAt: '2025-01-12T00:00:00Z',
  },
  {
    id: 'profile-4',
    name: 'LDAP Directory',
    type: 'custom',
    description: 'Corporate LDAP server',
    tags: ['production'],
    usage: 2,
    config: {},
    environmentValues: { 'env-prod': { bind_dn: 'cn=admin' }, 'env-staging': { bind_dn: 'cn=admin' } },
    environmentsCount: 2,
    totalEnvironments: 3,
    hasIncompleteEnvironments: true,
    createdAt: '2025-01-13T00:00:00Z',
    updatedAt: '2025-01-13T14:00:00Z',
  },
]

const mockPageInfo = {
  currentPage: 1,
  pageSize: 10,
  totalItems: 95,
  totalPages: 10,
}

const mockFilters = {
  search: '',
  type: '',
  tags: [] as string[],
}

const mockProfileTypes = ['database', 'ssh', 'http', 'kubernetes', 'opensearch', 'custom']

const mockAllTags = ['production', 'staging', 'database', 'ssh', 'http', 'kubernetes']

// ============================================================================
// Test Utilities
// ============================================================================

function renderWithRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

function renderProfilesPage(props: Partial<ProfilesPageProps> = {}) {
  const defaultProps: ProfilesPageProps = {
    profiles: mockProfiles,
    pageInfo: mockPageInfo,
    filters: mockFilters,
    profileTypes: mockProfileTypes,
    allTags: mockAllTags,
    loading: false,
    error: undefined,
    sorting: [],
    onSortingChange: vi.fn(),
    columnVisibility: {},
    onColumnVisibilityChange: vi.fn(),
    visibleColumns: ['name', 'type', 'tags', 'environments', 'usage'],
    onNewProfile: vi.fn(),
    onEditProfile: vi.fn(),
    onDeleteProfile: vi.fn(),
    onDuplicateProfile: vi.fn(),
    onFilterChange: vi.fn(),
    onPageChange: vi.fn(),
    onPageSizeChange: vi.fn(),
    onColumnToggle: vi.fn(),
    onRetry: vi.fn(),
    ...props,
  }
  return renderWithRouter(<ProfilesPage {...defaultProps} />)
}

// ============================================================================
// Tests
// ============================================================================

describe('ProfilesPage', () => {
  describe('Page Structure', () => {
    it('renders page container with correct testid', () => {
      renderProfilesPage()
      expect(screen.getByTestId('profiles-page')).toBeInTheDocument()
    })

    it('renders page title "Profiles" as h1', () => {
      renderProfilesPage()
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Profiles')
    })

    it('page title is visible', () => {
      renderProfilesPage()
      expect(screen.getByRole('heading', { name: 'Profiles' })).toBeVisible()
    })

    it('renders "+ New Profile" button in header', () => {
      renderProfilesPage()
      const newButton = screen.getByRole('button', { name: /New Profile/i })
      expect(newButton).toBeVisible()
      expect(newButton).toBeEnabled()
    })

    it('renders filters section', () => {
      renderProfilesPage()
      expect(screen.getByTestId('filters-section')).toBeInTheDocument()
    })

    it('renders profiles table', () => {
      renderProfilesPage()
      expect(screen.getByTestId('profiles-table')).toBeInTheDocument()
    })

    it('renders pagination controls', () => {
      renderProfilesPage()
      expect(screen.getByTestId('pagination')).toBeInTheDocument()
    })
  })

  describe('Header Actions', () => {
    it('calls onNewProfile when "+ New Profile" button is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleNewProfile = vi.fn()

      renderProfilesPage({ onNewProfile: handleNewProfile })
      await user.click(screen.getByRole('button', { name: /New Profile/i }))

      expect(handleNewProfile).toHaveBeenCalledTimes(1)
    })
  })

  describe('Filters Section', () => {
    it('renders search input with correct placeholder', () => {
      renderProfilesPage()
      const searchInput = screen.getByPlaceholderText(/Search profiles/i)
      expect(searchInput).toBeVisible()
    })

    it('renders type filter dropdown', () => {
      renderProfilesPage()
      expect(screen.getByTestId('filter-type')).toBeVisible()
    })

    it('renders tags filter', () => {
      renderProfilesPage()
      expect(screen.getByTestId('filter-tags')).toBeVisible()
    })

    it('renders Columns button', () => {
      renderProfilesPage()
      expect(screen.getByRole('button', { name: /Columns/i })).toBeVisible()
    })

    it('does NOT render Status filter (PROFILE-8: profiles do not execute)', () => {
      renderProfilesPage()
      expect(screen.queryByTestId('filter-status')).not.toBeInTheDocument()
    })

    it('does NOT render Mass Action button (PROFILE-9)', () => {
      renderProfilesPage()
      expect(screen.queryByRole('button', { name: /Mass Action/i })).not.toBeInTheDocument()
    })

    it('calls onFilterChange when search changes', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleFilterChange = vi.fn()

      renderProfilesPage({ onFilterChange: handleFilterChange })
      const searchInput = screen.getByPlaceholderText(/Search profiles/i)
      await user.type(searchInput, 'production')

      // Wait for debounce with waitFor
      const { waitFor } = await import('@testing-library/react')
      await waitFor(() => {
        expect(handleFilterChange).toHaveBeenCalled()
      }, { timeout: 500 })
    })
  })

  describe('Table Structure', () => {
    it('renders table with correct columns', () => {
      renderProfilesPage()
      const table = screen.getByTestId('profiles-table')

      expect(within(table).getByRole('columnheader', { name: /Name/i })).toBeInTheDocument()
      expect(within(table).getByRole('columnheader', { name: /Type/i })).toBeInTheDocument()
      expect(within(table).getByRole('columnheader', { name: /Tags/i })).toBeInTheDocument()
      expect(within(table).getByRole('columnheader', { name: /Usage/i })).toBeInTheDocument()
      expect(within(table).getByRole('columnheader', { name: /Actions/i })).toBeInTheDocument()
    })

    it('does NOT render Status column (PROFILE-8)', () => {
      renderProfilesPage()
      const table = screen.getByTestId('profiles-table')
      expect(within(table).queryByRole('columnheader', { name: /^Status$/i })).not.toBeInTheDocument()
    })

    it('renders profile rows with correct data', () => {
      renderProfilesPage()
      const rows = screen.getAllByTestId('profile-row')
      expect(rows).toHaveLength(4)

      const firstRow = rows[0]
      expect(within(firstRow).getByTestId('profile-name')).toHaveTextContent('Production Database')
      expect(within(firstRow).getByTestId('profile-type')).toHaveTextContent('database')
    })

    it('displays correct type for each profile (PROFILE-7)', () => {
      renderProfilesPage()
      const rows = screen.getAllByTestId('profile-row')

      // First row: database
      expect(within(rows[0]).getByTestId('profile-type')).toHaveTextContent('database')
      // Second row: ssh
      expect(within(rows[1]).getByTestId('profile-type')).toHaveTextContent('ssh')
      // Third row: http
      expect(within(rows[2]).getByTestId('profile-type')).toHaveTextContent('http')
      // Fourth row: custom
      expect(within(rows[3]).getByTestId('profile-type')).toHaveTextContent('custom')
    })

    it('displays usage count for each profile', () => {
      renderProfilesPage()
      const rows = screen.getAllByTestId('profile-row')

      expect(within(rows[0]).getByTestId('profile-usage')).toHaveTextContent('5 tests')
      expect(within(rows[1]).getByTestId('profile-usage')).toHaveTextContent('3 tests')
      expect(within(rows[2]).getByTestId('profile-usage')).toHaveTextContent('0 tests')
    })

    it('displays usage as singular "test" for usage = 1', () => {
      const profilesWithOne = [{ ...mockProfiles[0], usage: 1 }]
      renderProfilesPage({ profiles: profilesWithOne })
      const row = screen.getByTestId('profile-row')
      expect(within(row).getByTestId('profile-usage')).toHaveTextContent('1 test')
    })

    it('displays tags as badges', () => {
      renderProfilesPage()
      const rows = screen.getAllByTestId('profile-row')
      const firstRow = rows[0]

      expect(within(firstRow).getByText('production')).toBeInTheDocument()
      expect(within(firstRow).getByText('database')).toBeInTheDocument()
    })

    it('displays no tags for profiles without tags', () => {
      renderProfilesPage()
      const rows = screen.getAllByTestId('profile-row')
      const thirdRow = rows[2] // Development HTTP has no tags
      const tagsCell = within(thirdRow).getByTestId('profile-tags')
      expect(tagsCell).toHaveTextContent('') // Empty or dash
    })

    it('displays environments count with plural form', () => {
      renderProfilesPage()
      const rows = screen.getAllByTestId('profile-row')
      // First row has 3 environments defined (no warning)
      const firstRow = rows[0]
      expect(within(firstRow).getByTestId('profile-environments')).toHaveTextContent('3 envs')
    })

    it('displays environments count with singular form when 1 env', () => {
      renderProfilesPage()
      const rows = screen.getAllByTestId('profile-row')
      // Second row has 1 environment (with warning)
      const secondRow = rows[1]
      expect(within(secondRow).getByTestId('profile-environments')).toHaveTextContent('1 env')
    })

    it('displays warning icon when profile has incomplete environments', () => {
      renderProfilesPage()
      const rows = screen.getAllByTestId('profile-row')
      // Second row has hasIncompleteEnvironments: true
      const secondRow = rows[1]
      expect(within(secondRow).getByTestId('environments-warning-icon')).toBeInTheDocument()
    })

    it('does not display warning icon when all environments are configured', () => {
      renderProfilesPage()
      const rows = screen.getAllByTestId('profile-row')
      // First row has hasIncompleteEnvironments: false
      const firstRow = rows[0]
      expect(within(firstRow).queryByTestId('environments-warning-icon')).not.toBeInTheDocument()
    })

    it('displays "0 envs" with warning for profiles with no environment values', () => {
      renderProfilesPage()
      const rows = screen.getAllByTestId('profile-row')
      // Third row has 0 environments
      const thirdRow = rows[2]
      expect(within(thirdRow).getByTestId('profile-environments')).toHaveTextContent('0 envs')
      expect(within(thirdRow).getByTestId('environments-warning-icon')).toBeInTheDocument()
    })
  })

  describe('Row Actions', () => {
    it('renders Edit button for each row', () => {
      renderProfilesPage()
      const rows = screen.getAllByTestId('profile-row')

      rows.forEach((row) => {
        expect(within(row).getByTestId('action-edit')).toBeInTheDocument()
      })
    })

    it('does NOT render Run button (PROFILE-10: profiles are not executable)', () => {
      renderProfilesPage()
      const rows = screen.getAllByTestId('profile-row')

      rows.forEach((row) => {
        expect(within(row).queryByTestId('action-run')).not.toBeInTheDocument()
      })
    })

    it('renders overflow menu trigger for each row', () => {
      renderProfilesPage()
      const rows = screen.getAllByTestId('profile-row')

      rows.forEach((row) => {
        expect(within(row).getByTestId('action-menu-trigger')).toBeInTheDocument()
      })
    })

    it('calls onEditProfile when Edit button is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleEditProfile = vi.fn()

      renderProfilesPage({ onEditProfile: handleEditProfile })
      const firstRow = screen.getAllByTestId('profile-row')[0]
      await user.click(within(firstRow).getByTestId('action-edit'))

      expect(handleEditProfile).toHaveBeenCalledWith('profile-1')
    })

    it('opens action menu when trigger is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderProfilesPage()
      const firstRow = screen.getAllByTestId('profile-row')[0]
      await user.click(within(firstRow).getByTestId('action-menu-trigger'))

      // Menu should show Duplicate, Delete options (no Edit - it's a separate button)
      expect(screen.getByRole('menuitem', { name: /Duplicate/i })).toBeVisible()
      expect(screen.getByRole('menuitem', { name: /Delete/i })).toBeVisible()
    })

    it('calls onDuplicateProfile when Duplicate is selected', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleDuplicateProfile = vi.fn()

      renderProfilesPage({ onDuplicateProfile: handleDuplicateProfile })
      const firstRow = screen.getAllByTestId('profile-row')[0]
      await user.click(within(firstRow).getByTestId('action-menu-trigger'))
      await user.click(screen.getByRole('menuitem', { name: /Duplicate/i }))

      expect(handleDuplicateProfile).toHaveBeenCalledWith('profile-1')
    })

    it('calls onDeleteProfile when Delete is selected for profile with usage = 0', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleDeleteProfile = vi.fn()

      renderProfilesPage({ onDeleteProfile: handleDeleteProfile })
      const thirdRow = screen.getAllByTestId('profile-row')[2] // usage = 0
      await user.click(within(thirdRow).getByTestId('action-menu-trigger'))
      await user.click(screen.getByRole('menuitem', { name: /Delete/i }))

      expect(handleDeleteProfile).toHaveBeenCalledWith('profile-3')
    })

    it('Delete is disabled when profile has usage > 0', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderProfilesPage()
      const firstRow = screen.getAllByTestId('profile-row')[0] // usage = 5
      await user.click(within(firstRow).getByTestId('action-menu-trigger'))

      const deleteItem = screen.getByRole('menuitem', { name: /Delete/i })
      expect(deleteItem).toHaveAttribute('aria-disabled', 'true')
    })

    it('Delete has tooltip explaining why disabled when usage > 0', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderProfilesPage()
      const firstRow = screen.getAllByTestId('profile-row')[0] // usage = 5
      await user.click(within(firstRow).getByTestId('action-menu-trigger'))

      const deleteItem = screen.getByRole('menuitem', { name: /Delete/i })
      // SHELL-7a: the reason comes from the shared tooltip, not a browser popup.
      expect(deleteItem).not.toHaveAttribute('title')
      fireEvent.focus(deleteItem.querySelector('.inline-flex') as HTMLElement)
      expect(document.querySelector('[data-slot="tooltip-content"]')?.textContent).toMatch(
        /in use|referenced/i,
      )
    })
  })

  describe('Pagination (PROFILE-2)', () => {
    it('displays item count "Showing X-Y of Z"', () => {
      renderProfilesPage()
      const pagination = screen.getByTestId('pagination')
      const itemCount = within(pagination).getByTestId('pagination-item-count')
      expect(itemCount).toHaveTextContent(/Showing 1-10 of 95/i)
    })

    it('displays page size selector with options 10, 25, 50, 100', () => {
      renderProfilesPage()
      const pagination = screen.getByTestId('pagination')
      const pageSizeSelector = within(pagination).getByTestId('page-size-selector')
      expect(pageSizeSelector).toBeVisible()
    })

    it('displays page navigation', () => {
      renderProfilesPage()
      const pagination = screen.getByTestId('pagination')
      const navigation = within(pagination).getByTestId('pagination-navigation')
      expect(navigation).toBeVisible()
    })

    it('disables previous button on first page', () => {
      renderProfilesPage({ pageInfo: { ...mockPageInfo, currentPage: 1 } })
      const prevButton = screen.getByRole('button', { name: /previous/i })
      expect(prevButton).toBeDisabled()
    })

    it('disables next button on last page', () => {
      renderProfilesPage({ pageInfo: { ...mockPageInfo, currentPage: 10 } })
      const nextButton = screen.getByRole('button', { name: /next/i })
      expect(nextButton).toBeDisabled()
    })

    it('calls onPageChange when next page is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handlePageChange = vi.fn()

      renderProfilesPage({ onPageChange: handlePageChange })
      await user.click(screen.getByRole('button', { name: /next/i }))

      expect(handlePageChange).toHaveBeenCalledWith(2)
    })

    it('calls onPageChange when previous page is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handlePageChange = vi.fn()

      renderProfilesPage({
        pageInfo: { ...mockPageInfo, currentPage: 5 },
        onPageChange: handlePageChange,
      })
      await user.click(screen.getByRole('button', { name: /previous/i }))

      expect(handlePageChange).toHaveBeenCalledWith(4)
    })

    it('calls onPageSizeChange when page size is changed', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handlePageSizeChange = vi.fn()

      renderProfilesPage({ onPageSizeChange: handlePageSizeChange })

      // Open the page size selector
      await user.click(screen.getByTestId('page-size-selector'))

      // Wait for dropdown to appear and select 25
      const { waitFor } = await import('@testing-library/react')
      await waitFor(() => {
        expect(screen.getByRole('option', { name: '25' })).toBeVisible()
      })
      await user.click(screen.getByRole('option', { name: '25' }))

      expect(handlePageSizeChange).toHaveBeenCalledWith(25)
    })

    it('displays first and last page buttons', () => {
      renderProfilesPage()
      const pagination = screen.getByTestId('pagination')
      expect(within(pagination).getByRole('button', { name: /first/i })).toBeInTheDocument()
      expect(within(pagination).getByRole('button', { name: /last/i })).toBeInTheDocument()
    })

    it('disables first button on first page', () => {
      renderProfilesPage({ pageInfo: { ...mockPageInfo, currentPage: 1 } })
      expect(screen.getByRole('button', { name: /first/i })).toBeDisabled()
    })

    it('disables last button on last page', () => {
      renderProfilesPage({ pageInfo: { ...mockPageInfo, currentPage: 10 } })
      expect(screen.getByRole('button', { name: /last/i })).toBeDisabled()
    })

    it('calls onPageChange with 1 when first button is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handlePageChange = vi.fn()

      renderProfilesPage({ pageInfo: { ...mockPageInfo, currentPage: 5 }, onPageChange: handlePageChange })
      await user.click(screen.getByRole('button', { name: /first/i }))

      expect(handlePageChange).toHaveBeenCalledWith(1)
    })

    it('calls onPageChange with totalPages when last button is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handlePageChange = vi.fn()

      renderProfilesPage({ pageInfo: { ...mockPageInfo, currentPage: 5 }, onPageChange: handlePageChange })
      await user.click(screen.getByRole('button', { name: /last/i }))

      expect(handlePageChange).toHaveBeenCalledWith(10)
    })
  })

  describe('Pagination - Single Page (PROFILE-3)', () => {
    it('shows all pagination controls even for single page', () => {
      const singlePageInfo = { currentPage: 1, pageSize: 10, totalItems: 5, totalPages: 1 }
      renderProfilesPage({ pageInfo: singlePageInfo })

      const pagination = screen.getByTestId('pagination')
      expect(within(pagination).getByTestId('pagination-item-count')).toBeVisible()
      expect(within(pagination).getByTestId('page-size-selector')).toBeVisible()
      expect(within(pagination).getByTestId('pagination-navigation')).toBeVisible()
    })

    it('disables both prev and next on single page', () => {
      const singlePageInfo = { currentPage: 1, pageSize: 10, totalItems: 5, totalPages: 1 }
      renderProfilesPage({ pageInfo: singlePageInfo })

      expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled()
      expect(screen.getByRole('button', { name: /next/i })).toBeDisabled()
    })
  })

  describe('Loading State (PROFILE-4)', () => {
    it('displays 9 skeleton rows when loading', () => {
      renderProfilesPage({ loading: true, profiles: [] })
      const skeletonRows = screen.getAllByTestId('skeleton-row')
      expect(skeletonRows).toHaveLength(9)
    })

    it('keeps the rows while a later read is out', () => {
      renderProfilesPage({ loading: true })
      const profileRows = screen.queryAllByTestId('profile-row')
      expect(profileRows).not.toHaveLength(0)
    })

    it('sets aria-busy on page when loading', () => {
      renderProfilesPage({ loading: true, profiles: [] })
      expect(screen.getByTestId('profiles-page')).toHaveAttribute('aria-busy', 'true')
    })

    it('shows skeleton pagination when loading', () => {
      renderProfilesPage({ loading: true })
      expect(screen.getByTestId('pagination')).toBeInTheDocument()
    })

    it('keeps search enabled during loading to preserve focus', () => {
      renderProfilesPage({ loading: true })
      const searchInput = screen.getByPlaceholderText(/Search profiles/i)
      expect(searchInput).not.toBeDisabled()
    })
  })

  describe('Error State (PROFILE-5)', () => {
    it('displays error message with empathetic tone', () => {
      renderProfilesPage({ error: 'Unable to load profiles' })
      const errorTitle = screen.getByTestId('error-state-title')
      expect(errorTitle).toBeInTheDocument()
      expect(errorTitle).toHaveTextContent(/Unable to load/i)
    })

    it('displays "Try Again" button', () => {
      renderProfilesPage({ error: 'Unable to load profiles' })
      expect(screen.getByRole('button', { name: /Try Again/i })).toBeVisible()
    })

    it('displays red alert icon', () => {
      renderProfilesPage({ error: 'Unable to load profiles' })
      const alertIcon = screen.getByTestId('error-state-icon')
      expect(alertIcon).toBeVisible()
      expect(alertIcon).toHaveClass('text-error')
    })

    it('calls onRetry when "Try Again" is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleRetry = vi.fn()

      renderProfilesPage({ error: 'Unable to load profiles', onRetry: handleRetry })
      await user.click(screen.getByRole('button', { name: /Try Again/i }))

      expect(handleRetry).toHaveBeenCalledTimes(1)
    })

    it('hides table when error occurs', () => {
      renderProfilesPage({ error: 'Unable to load profiles' })
      expect(screen.queryByTestId('profiles-table')).not.toBeInTheDocument()
    })
  })

  describe('Empty State (PROFILE-6)', () => {
    it('displays empty state when no profiles', () => {
      renderProfilesPage({ profiles: [] })
      expect(screen.getByTestId('empty-state')).toBeInTheDocument()
    })

    it('handles zero totalItems in pagination calculation', () => {
      renderProfilesPage({
        profiles: [],
        pageInfo: { ...mockPageInfo, totalItems: 0, totalPages: 0 },
      })
      // Should still render the page without error
      expect(screen.getByTestId('profiles-page')).toBeInTheDocument()
    })

    it('displays entity-specific icon (profile/user icon)', () => {
      renderProfilesPage({ profiles: [] })
      expect(screen.getByTestId('empty-state-icon')).toBeVisible()
    })

    it('displays "No profiles yet" title', () => {
      renderProfilesPage({ profiles: [] })
      const title = screen.getByTestId('empty-state-title')
      expect(title).toHaveTextContent(/No profiles yet/i)
    })

    it('displays encouraging description', () => {
      renderProfilesPage({ profiles: [] })
      const description = screen.getByTestId('empty-state-description')
      expect(description).toBeVisible()
    })

    it('displays primary CTA "Create Your First Profile"', () => {
      renderProfilesPage({ profiles: [] })
      const ctaButton = screen.getByRole('button', { name: /Create Your First Profile/i })
      expect(ctaButton).toBeVisible()
      expect(ctaButton).toHaveClass('btn-primary')
    })

    it('calls onNewProfile when CTA is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleNewProfile = vi.fn()

      renderProfilesPage({ profiles: [], onNewProfile: handleNewProfile })
      await user.click(screen.getByRole('button', { name: /Create Your First Profile/i }))

      expect(handleNewProfile).toHaveBeenCalledTimes(1)
    })

    it('still shows page header in empty state', () => {
      renderProfilesPage({ profiles: [] })
      expect(screen.getByRole('heading', { name: 'Profiles' })).toBeVisible()
      expect(screen.getByRole('button', { name: /New Profile/i })).toBeVisible()
    })

    it('shows filters but no Mass Action in empty state (PROFILE-9)', () => {
      renderProfilesPage({ profiles: [] })
      expect(screen.getByTestId('filters-section')).toBeVisible()
      expect(screen.getByRole('button', { name: /Columns/i })).toBeVisible()
      expect(screen.queryByRole('button', { name: /Mass Action/i })).not.toBeInTheDocument()
    })

    it('displays "No matching profiles found" when empty with active filters', () => {
      renderProfilesPage({
        profiles: [],
        filters: { search: 'nonexistent', type: '', tags: [] },
      })
      expect(screen.getByTestId('no-results-state-title')).toHaveTextContent(/No matching profiles found/i)
    })

    it('displays Clear Filters button when empty with active filters', () => {
      renderProfilesPage({
        profiles: [],
        filters: { search: 'nonexistent', type: '', tags: [] },
      })
      const noResultsState = screen.getByTestId('no-results-state')
      expect(within(noResultsState).getByRole('button', { name: /Clear Filters/i })).toBeInTheDocument()
    })

    it('calls onFilterChange with cleared filters when Clear Filters is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleFilterChange = vi.fn()

      renderProfilesPage({
        profiles: [],
        filters: { search: 'nonexistent', type: 'database', tags: ['tag-1'] },
        onFilterChange: handleFilterChange,
      })

      const noResultsState = screen.getByTestId('no-results-state')
      const clearFiltersButton = within(noResultsState).getByRole('button', { name: /Clear Filters/i })
      await user.click(clearFiltersButton)

      expect(handleFilterChange).toHaveBeenCalledWith({
        search: '',
        type: '',
        tags: [],
      })
    })
  })

  describe('Type Badges (PROFILE-7)', () => {
    it('database type has correct styling', () => {
      renderProfilesPage()
      const firstRow = screen.getAllByTestId('profile-row')[0]
      const typeBadge = within(firstRow).getByTestId('profile-type')
      expect(typeBadge).toHaveTextContent('database')
      expect(typeBadge).toHaveClass('badge')
    })

    it('ssh type has correct styling', () => {
      renderProfilesPage()
      const sshRow = screen.getAllByTestId('profile-row')[1]
      const typeBadge = within(sshRow).getByTestId('profile-type')
      expect(typeBadge).toHaveTextContent('ssh')
    })

    it('http type has correct styling', () => {
      renderProfilesPage()
      const httpRow = screen.getAllByTestId('profile-row')[2]
      const typeBadge = within(httpRow).getByTestId('profile-type')
      expect(typeBadge).toHaveTextContent('http')
    })
  })

  describe('Accessibility', () => {
    it('page has main landmark when wrapped in layout', () => {
      renderWithRouter(
        <main>
          <ProfilesPage
            profiles={mockProfiles}
            pageInfo={mockPageInfo}
            filters={mockFilters}
            profileTypes={mockProfileTypes}
            allTags={mockAllTags}
            sorting={[]}
            onSortingChange={vi.fn()}
            columnVisibility={{}}
            onColumnVisibilityChange={vi.fn()}
            visibleColumns={['name', 'type', 'tags', 'environments', 'usage']}
            onNewProfile={vi.fn()}
            onEditProfile={vi.fn()}
            onDeleteProfile={vi.fn()}
            onDuplicateProfile={vi.fn()}
            onFilterChange={vi.fn()}
            onPageChange={vi.fn()}
            onPageSizeChange={vi.fn()}
            onColumnToggle={vi.fn()}
            onRetry={vi.fn()}
          />
        </main>
      )
      expect(screen.getByRole('main')).toBeInTheDocument()
    })

    it('page title is accessible', () => {
      renderProfilesPage()
      expect(screen.getByRole('heading', { level: 1, name: 'Profiles' })).toBeInTheDocument()
    })

    it('table has accessible role', () => {
      renderProfilesPage()
      expect(screen.getByRole('table')).toBeInTheDocument()
    })

    it('table has aria-label', () => {
      renderProfilesPage()
      expect(screen.getByRole('table')).toHaveAttribute('aria-label', 'Profiles')
    })

    it('loading state has aria-busy', () => {
      renderProfilesPage({ loading: true, profiles: [] })
      expect(screen.getByTestId('profiles-page')).toHaveAttribute('aria-busy', 'true')
    })
  })

  describe('Custom ClassName', () => {
    it('accepts additional className', () => {
      const { container } = renderProfilesPage({ className: 'custom-profiles-page' })
      expect(container.querySelector('.custom-profiles-page')).toBeInTheDocument()
    })
  })

  describe('Table Sorting and Row Interaction', () => {
    it('calls onEditProfile when row is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleEditProfile = vi.fn()

      renderProfilesPage({ onEditProfile: handleEditProfile })
      const firstRow = screen.getAllByTestId('profile-row')[0]

      // Click on the row (not the action buttons)
      await user.click(within(firstRow).getByTestId('profile-name'))

      expect(handleEditProfile).toHaveBeenCalledWith('profile-1')
    })

    it('calls onEditProfile when name button is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleEditProfile = vi.fn()

      renderProfilesPage({ onEditProfile: handleEditProfile })
      const firstName = screen.getAllByTestId('profile-name')[0]

      await user.click(firstName)

      expect(handleEditProfile).toHaveBeenCalledWith('profile-1')
    })

    it('handles column sort via ProfilesTable', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleSort = vi.fn()

      renderProfilesPage({ onSortingChange:handleSort })

      // Click on sortable column header
      const nameHeader = screen.getByRole('columnheader', { name: /Name/i })
      await user.click(nameHeader)

      expect(handleSort).toHaveBeenCalled()
    })

    it('handles name column sort via Enter key', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleSort = vi.fn()

      renderProfilesPage({ onSortingChange:handleSort })

      const nameHeader = screen.getByRole('columnheader', { name: /Name/i })
      nameHeader.focus()
      await user.keyboard('{Enter}')

      expect(handleSort).toHaveBeenCalled()
    })

    it('handles name column sort via Space key', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleSort = vi.fn()

      renderProfilesPage({ onSortingChange:handleSort })

      const nameHeader = screen.getByRole('columnheader', { name: /Name/i })
      nameHeader.focus()
      await user.keyboard(' ')

      expect(handleSort).toHaveBeenCalled()
    })

    it('handles type column sort via click', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleSort = vi.fn()

      renderProfilesPage({ onSortingChange:handleSort })

      const typeHeader = screen.getByRole('columnheader', { name: /Type/i })
      await user.click(typeHeader)

      expect(handleSort).toHaveBeenCalled()
    })

    it('handles type column sort via Enter key', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleSort = vi.fn()

      renderProfilesPage({ onSortingChange:handleSort })

      const typeHeader = screen.getByRole('columnheader', { name: /Type/i })
      typeHeader.focus()
      await user.keyboard('{Enter}')

      expect(handleSort).toHaveBeenCalled()
    })

    it('handles type column sort via Space key', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleSort = vi.fn()

      renderProfilesPage({ onSortingChange:handleSort })

      const typeHeader = screen.getByRole('columnheader', { name: /Type/i })
      typeHeader.focus()
      await user.keyboard(' ')

      expect(handleSort).toHaveBeenCalled()
    })

    it('shows ascending sort icon when type column is sorted ascending', () => {
      renderProfilesPage({ sorting: [{ id: 'type', desc: false }] })

      const typeHeader = screen.getByRole('columnheader', { name: /Type/i })
      expect(typeHeader.querySelector('.lucide-chevron-up')).toBeInTheDocument()
    })

    it('shows descending sort icon when type column is sorted descending', () => {
      renderProfilesPage({ sorting: [{ id: 'type', desc: true }] })

      const typeHeader = screen.getByRole('columnheader', { name: /Type/i })
      expect(typeHeader.querySelector('.lucide-chevron-down')).toBeInTheDocument()
    })

    it('shows ascending sort icon when column is sorted ascending', () => {
      renderProfilesPage({ sorting: [{ id: 'name', desc: false }] })

      const nameHeader = screen.getByRole('columnheader', { name: /Name/i })
      expect(nameHeader.querySelector('.lucide-chevron-up')).toBeInTheDocument()
    })

    it('shows descending sort icon when column is sorted descending', () => {
      renderProfilesPage({ sorting: [{ id: 'name', desc: true }] })

      const nameHeader = screen.getByRole('columnheader', { name: /Name/i })
      expect(nameHeader.querySelector('.lucide-chevron-down')).toBeInTheDocument()
    })

    it('does not show sort icon on unsorted columns', () => {
      renderProfilesPage({ sorting: [{ id: 'name', desc: false }] })

      const typeHeader = screen.getByRole('columnheader', { name: /Type/i })
      expect(typeHeader.querySelector('.lucide-chevron-up')).not.toBeInTheDocument()
      expect(typeHeader.querySelector('.lucide-chevron-down')).not.toBeInTheDocument()
    })

    it('column header has aria-sort="ascending" when sorted ascending', () => {
      renderProfilesPage({ sorting: [{ id: 'name', desc: false }] })

      const nameHeader = screen.getByRole('columnheader', { name: /Name/i })
      expect(nameHeader).toHaveAttribute('aria-sort', 'ascending')
    })

    it('column header has aria-sort="descending" when sorted descending', () => {
      renderProfilesPage({ sorting: [{ id: 'name', desc: true }] })

      const nameHeader = screen.getByRole('columnheader', { name: /Name/i })
      expect(nameHeader).toHaveAttribute('aria-sort', 'descending')
    })

    it('column header has aria-sort="none" when not sorted', () => {
      renderProfilesPage({ sorting: [] })

      const nameHeader = screen.getByRole('columnheader', { name: /Name/i })
      expect(nameHeader).toHaveAttribute('aria-sort', 'none')
    })

    it('handles usage column sort via click', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleSort = vi.fn()

      renderProfilesPage({ onSortingChange:handleSort })

      // Click on usage column header
      const usageHeader = screen.getByRole('columnheader', { name: /Usage/i })
      await user.click(usageHeader)

      expect(handleSort).toHaveBeenCalled()
    })

    it('handles usage column sort via Enter key', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleSort = vi.fn()

      renderProfilesPage({ onSortingChange:handleSort })

      // Focus and press Enter on usage column header
      const usageHeader = screen.getByRole('columnheader', { name: /Usage/i })
      usageHeader.focus()
      await user.keyboard('{Enter}')

      expect(handleSort).toHaveBeenCalled()
    })

    it('handles usage column sort via Space key', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleSort = vi.fn()

      renderProfilesPage({ onSortingChange:handleSort })

      // Focus and press Space on usage column header
      const usageHeader = screen.getByRole('columnheader', { name: /Usage/i })
      usageHeader.focus()
      await user.keyboard(' ')

      expect(handleSort).toHaveBeenCalled()
    })

    it('shows ascending sort icon when usage column is sorted ascending', () => {
      renderProfilesPage({ sorting: [{ id: 'usage', desc: false }] })

      const usageHeader = screen.getByRole('columnheader', { name: /Usage/i })
      expect(usageHeader.querySelector('.lucide-chevron-up')).toBeInTheDocument()
    })

    it('shows descending sort icon when usage column is sorted descending', () => {
      renderProfilesPage({ sorting: [{ id: 'usage', desc: true }] })

      const usageHeader = screen.getByRole('columnheader', { name: /Usage/i })
      expect(usageHeader.querySelector('.lucide-chevron-down')).toBeInTheDocument()
    })

    it('handles tags column sort via click', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleSort = vi.fn()

      renderProfilesPage({ onSortingChange:handleSort })

      const tagsHeader = screen.getByRole('columnheader', { name: /Tags/i })
      await user.click(tagsHeader)

      expect(handleSort).toHaveBeenCalled()
    })

    it('handles tags column sort via Enter key', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleSort = vi.fn()

      renderProfilesPage({ onSortingChange:handleSort })

      // Focus and press Enter on tags column header
      const tagsHeader = screen.getByRole('columnheader', { name: /Tags/i })
      tagsHeader.focus()
      await user.keyboard('{Enter}')

      expect(handleSort).toHaveBeenCalled()
    })

    it('handles tags column sort via Space key', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleSort = vi.fn()

      renderProfilesPage({ onSortingChange:handleSort })

      // Focus and press Space on tags column header
      const tagsHeader = screen.getByRole('columnheader', { name: /Tags/i })
      tagsHeader.focus()
      await user.keyboard(' ')

      expect(handleSort).toHaveBeenCalled()
    })

    it('shows ascending sort icon when tags column is sorted ascending', () => {
      renderProfilesPage({ sorting: [{ id: 'tags', desc: false }] })

      const tagsHeader = screen.getByRole('columnheader', { name: /Tags/i })
      expect(tagsHeader.querySelector('.lucide-chevron-up')).toBeInTheDocument()
    })

    it('shows descending sort icon when tags column is sorted descending', () => {
      renderProfilesPage({ sorting: [{ id: 'tags', desc: true }] })

      const tagsHeader = screen.getByRole('columnheader', { name: /Tags/i })
      expect(tagsHeader.querySelector('.lucide-chevron-down')).toBeInTheDocument()
    })

    it('handles environments column sort via click', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleSort = vi.fn()

      renderProfilesPage({ onSortingChange:handleSort })

      const envHeader = screen.getByRole('columnheader', { name: /Environments/i })
      await user.click(envHeader)

      expect(handleSort).toHaveBeenCalled()
    })

    it('handles environments column sort via Enter key', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleSort = vi.fn()

      renderProfilesPage({ onSortingChange:handleSort })

      // Focus and press Enter on environments column header
      const envHeader = screen.getByRole('columnheader', { name: /Environments/i })
      envHeader.focus()
      await user.keyboard('{Enter}')

      expect(handleSort).toHaveBeenCalled()
    })

    it('handles environments column sort via Space key', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleSort = vi.fn()

      renderProfilesPage({ onSortingChange:handleSort })

      // Focus and press Space on environments column header
      const envHeader = screen.getByRole('columnheader', { name: /Environments/i })
      envHeader.focus()
      await user.keyboard(' ')

      expect(handleSort).toHaveBeenCalled()
    })

    it('shows ascending sort icon when environments column is sorted ascending', () => {
      renderProfilesPage({ sorting: [{ id: 'environments', desc: false }] })

      const envHeader = screen.getByRole('columnheader', { name: /Environments/i })
      expect(envHeader.querySelector('.lucide-chevron-up')).toBeInTheDocument()
    })

    it('shows descending sort icon when environments column is sorted descending', () => {
      renderProfilesPage({ sorting: [{ id: 'environments', desc: true }] })

      const envHeader = screen.getByRole('columnheader', { name: /Environments/i })
      expect(envHeader.querySelector('.lucide-chevron-down')).toBeInTheDocument()
    })

    it('handles column visibility toggle via Columns button', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleColumnToggle = vi.fn()

      renderProfilesPage({ onColumnToggle: handleColumnToggle })

      // Click on Columns button to open dropdown
      await user.click(screen.getByRole('button', { name: /Columns/i }))

      // Click on a column checkbox to toggle visibility
      const { waitFor } = await import('@testing-library/react')
      await waitFor(() => {
        expect(screen.getByRole('menuitemcheckbox', { name: /Type/i })).toBeInTheDocument()
      })
      await user.click(screen.getByRole('menuitemcheckbox', { name: /Type/i }))

      expect(handleColumnToggle).toHaveBeenCalledWith('type', expect.any(Boolean))
    })
  })

  describe('Viewport-Filling Layout', () => {
    it('page container fills viewport height with h-full overflow-hidden', () => {
      renderProfilesPage()
      const page = screen.getByTestId('profiles-page')
      expect(page).toHaveClass('h-full')
      expect(page).toHaveClass('overflow-hidden')
    })

    it('pagination is anchored at bottom with flex-shrink-0', () => {
      renderProfilesPage()
      const pagination = screen.getByTestId('pagination')
      expect(pagination).toHaveClass('flex-shrink-0')
    })

    it('loading state page container has viewport-filling classes', () => {
      renderProfilesPage({ loading: true })
      const page = screen.getByTestId('profiles-page')
      expect(page).toHaveClass('h-full')
      expect(page).toHaveClass('overflow-hidden')
    })

    it('error state page container has viewport-filling classes', () => {
      renderProfilesPage({ error: 'Unable to load profiles' })
      const page = screen.getByTestId('profiles-page')
      expect(page).toHaveClass('h-full')
      expect(page).toHaveClass('overflow-hidden')
    })

    it('empty state page container has viewport-filling classes', () => {
      renderProfilesPage({ profiles: [] })
      const page = screen.getByTestId('profiles-page')
      expect(page).toHaveClass('h-full')
      expect(page).toHaveClass('overflow-hidden')
    })
  })

  describe('Selection Mode', () => {
    it('renders select-all checkbox in header when selectionModeActive', () => {
      renderProfilesPage({
        enableSelection: true,
        selectedIds: [],
        onRowSelectionChange: vi.fn(),
      })
      expect(screen.getByRole('checkbox', { name: /select all/i })).toBeInTheDocument()
    })

    it('does not render select-all checkbox when selectionModeActive is false', () => {
      renderProfilesPage({ enableSelection: false })
      expect(screen.queryByRole('checkbox', { name: /select all/i })).not.toBeInTheDocument()
    })

    it('renders per-row checkboxes when selectionModeActive', () => {
      renderProfilesPage({
        enableSelection: true,
        selectedIds: [],
        onRowSelectionChange: vi.fn(),
      })
      // 1 select-all + 4 profile row checkboxes
      const checkboxes = screen.getAllByRole('checkbox', { name: /select /i })
      expect(checkboxes.length).toBe(5)
    })

    it('select-all selects all profile IDs', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleSelectionChange = vi.fn()

      renderProfilesPage({
        enableSelection: true,
        selectedIds: [],
        onRowSelectionChange: handleSelectionChange,
      })
      const selectAll = screen.getByRole('checkbox', { name: /select all/i })
      await user.click(selectAll)

      // TanStack Table calls onRowSelectionChange with a function updater
      expect(handleSelectionChange).toHaveBeenCalled()
    })

    it('select-all deselects all when all are selected', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleSelectionChange = vi.fn()

      renderProfilesPage({
        enableSelection: true,
        selectedIds: ['profile-1', 'profile-2', 'profile-3', 'profile-4'],
        rowSelection: { 'profile-1': true, 'profile-2': true, 'profile-3': true, 'profile-4': true },
        onRowSelectionChange: handleSelectionChange,
      })
      const selectAll = screen.getByRole('checkbox', { name: /select all/i })
      await user.click(selectAll)

      expect(handleSelectionChange).toHaveBeenCalled()
    })

    it('row checkbox selects individual profile', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleSelectionChange = vi.fn()

      renderProfilesPage({
        enableSelection: true,
        selectedIds: [],
        onRowSelectionChange: handleSelectionChange,
      })
      const rowCheckboxes = screen.getAllByRole('checkbox', { name: /select /i })
      await user.click(rowCheckboxes[0])

      expect(handleSelectionChange).toHaveBeenCalled()
    })

    it('row checkbox deselects individual profile', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleSelectionChange = vi.fn()

      renderProfilesPage({
        enableSelection: true,
        selectedIds: ['profile-1', 'profile-2'],
        rowSelection: { 'profile-1': true, 'profile-2': true },
        onRowSelectionChange: handleSelectionChange,
      })
      const rowCheckbox = screen.getAllByRole('checkbox', { name: /select /i })[0]
      await user.click(rowCheckbox)

      expect(handleSelectionChange).toHaveBeenCalled()
    })
  })
})
