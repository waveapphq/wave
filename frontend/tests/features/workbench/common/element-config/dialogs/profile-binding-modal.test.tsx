/**
 * ProfileBindingModal Tests
 *
 * Tests for the profile binding management sheet used in element configuration.
 * Design Reference: PROFILE-11 through PROFILE-26
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ProfileBinding } from '@/features/workbench/common/element-config/dialogs/profile-binding-modal'
import { parentChildren } from '../../../../../utils/child-editor-parent'

// Mock profiles API
const mockFetchProfiles = vi.fn()

vi.mock('@/features/profiles/api/crud', () => ({
  fetchProfiles: (...args: unknown[]) => mockFetchProfiles(...args),
}))

const mockProfiles = [
  {
    id: 'p1',
    name: 'Production API',
    type: 'http',
    description: 'Prod API',
    tags: [],
    usage: 5,
    config: { base_url: 'https://api.example.com' },
    environmentValues: { env1: { api_key: 'xxx' } },
    environmentsCount: 1,
    totalEnvironments: 1,
    hasIncompleteEnvironments: false,
    createdAt: '2025-01-01',
    updatedAt: '2025-01-01',
  },
  {
    id: 'p2',
    name: 'Dev Database',
    type: 'database',
    description: 'Dev DB',
    tags: [],
    usage: 3,
    config: {},
    environmentValues: {},
    environmentsCount: 1,
    totalEnvironments: 1,
    hasIncompleteEnvironments: false,
    createdAt: '2025-01-01',
    updatedAt: '2025-01-01',
  },
  {
    id: 'p3',
    name: 'SSH Gateway',
    type: 'ssh',
    description: 'SSH access',
    tags: [],
    usage: 1,
    config: {},
    environmentValues: {},
    environmentsCount: 1,
    totalEnvironments: 1,
    hasIncompleteEnvironments: false,
    createdAt: '2025-01-01',
    updatedAt: '2025-01-01',
  },
]

/**
 * Wait for the ProfileBindingModal's async loadData to complete.
 * Prevents act(...) warnings from pending state updates after test ends.
 */
async function waitForLoad() {
  await waitFor(() => {
    expect(
      screen.queryByTestId('profiles-loading')
    ).not.toBeInTheDocument()
  })
}

describe('ProfileBindingModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchProfiles.mockResolvedValue({
      data: mockProfiles,
      pagination: { total: 3, page: 1, per_page: 100, total_pages: 1 },
    })
  })

  describe('Rendering', () => {
    it('renders modal with title and description', async () => {
      const { ProfileBindingModal } = await import(
        '@/features/workbench/common/element-config/dialogs/profile-binding-modal'
      )
      render(
        <ProfileBindingModal
          isOpen={true}
          onClose={vi.fn()}
          bindings={[]}
          onDone={vi.fn()}
        />
      )

      expect(
        screen.getByRole('heading', { name: 'Profiles' })
      ).toBeInTheDocument()
      expect(screen.getByText('Bound Profiles')).toBeInTheDocument()
      expect(screen.getByText('Add Profile')).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: /done/i })
      ).toBeInTheDocument()

      await waitForLoad()
    })

    it('renders bound profiles with aliases', async () => {
      const bindings = [
        {
          profileId: 'p1',
          profileName: 'Production API',
          profileType: 'http',
          alias: 'api',
          fields: [{ name: 'base_url', type: 'string' }],
        },
      ]

      const { ProfileBindingModal } = await import(
        '@/features/workbench/common/element-config/dialogs/profile-binding-modal'
      )
      render(
        <ProfileBindingModal
          isOpen={true}
          onClose={vi.fn()}
          bindings={bindings}
          onDone={vi.fn()}
        />
      )

      expect(screen.getByTestId('bound-profile-p1')).toBeInTheDocument()
      expect(screen.getByText('Production API')).toBeInTheDocument()
      expect(screen.getByTestId('alias-input-p1')).toHaveValue('api')

      await waitForLoad()
    })

    it('shows empty state when no profiles are bound', async () => {
      const { ProfileBindingModal } = await import(
        '@/features/workbench/common/element-config/dialogs/profile-binding-modal'
      )
      render(
        <ProfileBindingModal
          isOpen={true}
          onClose={vi.fn()}
          bindings={[]}
          onDone={vi.fn()}
        />
      )

      expect(screen.getByText('No profiles bound')).toBeInTheDocument()

      await waitForLoad()
    })
  })

  describe('Available Profiles', () => {
    it('fetches and displays available profiles', async () => {
      const { ProfileBindingModal } = await import(
        '@/features/workbench/common/element-config/dialogs/profile-binding-modal'
      )
      render(
        <ProfileBindingModal
          isOpen={true}
          onClose={vi.fn()}
          bindings={[]}
          onDone={vi.fn()}
        />
      )

      await waitFor(() => {
        expect(
          screen.getByTestId('available-profile-p1')
        ).toBeInTheDocument()
        expect(
          screen.getByTestId('available-profile-p2')
        ).toBeInTheDocument()
        expect(
          screen.getByTestId('available-profile-p3')
        ).toBeInTheDocument()
      })
    })

    it('shows profile type next to name in available list', async () => {
      const { ProfileBindingModal } = await import(
        '@/features/workbench/common/element-config/dialogs/profile-binding-modal'
      )
      render(
        <ProfileBindingModal
          isOpen={true}
          onClose={vi.fn()}
          bindings={[]}
          onDone={vi.fn()}
        />
      )

      await waitFor(() => {
        const row = screen.getByTestId('available-profile-p1')
        expect(within(row).getByText('Production API')).toBeInTheDocument()
        expect(within(row).getByText('http')).toBeInTheDocument()
      })
    })

    it('excludes already-bound profiles from available list', async () => {
      const bindings = [
        {
          profileId: 'p1',
          profileName: 'Production API',
          profileType: 'http',
          alias: 'api',
          fields: [],
        },
      ]

      const { ProfileBindingModal } = await import(
        '@/features/workbench/common/element-config/dialogs/profile-binding-modal'
      )
      render(
        <ProfileBindingModal
          isOpen={true}
          onClose={vi.fn()}
          bindings={bindings}
          onDone={vi.fn()}
        />
      )

      await waitFor(() => {
        expect(
          screen.queryByTestId('available-profile-p1')
        ).not.toBeInTheDocument()
        expect(
          screen.getByTestId('available-profile-p2')
        ).toBeInTheDocument()
        expect(
          screen.getByTestId('available-profile-p3')
        ).toBeInTheDocument()
      })
    })

    it('filters available profiles by search query on name', async () => {
      const user = userEvent.setup({ delay: null })

      const { ProfileBindingModal } = await import(
        '@/features/workbench/common/element-config/dialogs/profile-binding-modal'
      )
      render(
        <ProfileBindingModal
          isOpen={true}
          onClose={vi.fn()}
          bindings={[]}
          onDone={vi.fn()}
        />
      )

      await waitFor(() => {
        expect(
          screen.getByTestId('available-profile-p1')
        ).toBeInTheDocument()
      })

      const searchInput = screen.getByTestId('profile-search')
      await user.type(searchInput, 'gateway')

      expect(
        screen.queryByTestId('available-profile-p1')
      ).not.toBeInTheDocument()
      expect(
        screen.queryByTestId('available-profile-p2')
      ).not.toBeInTheDocument()
      expect(
        screen.getByTestId('available-profile-p3')
      ).toBeInTheDocument()
    })

    it('filters available profiles by search query on type', async () => {
      const user = userEvent.setup({ delay: null })

      const { ProfileBindingModal } = await import(
        '@/features/workbench/common/element-config/dialogs/profile-binding-modal'
      )
      render(
        <ProfileBindingModal
          isOpen={true}
          onClose={vi.fn()}
          bindings={[]}
          onDone={vi.fn()}
        />
      )

      await waitFor(() => {
        expect(
          screen.getByTestId('available-profile-p1')
        ).toBeInTheDocument()
      })

      const searchInput = screen.getByTestId('profile-search')
      await user.type(searchInput, 'database')

      expect(
        screen.queryByTestId('available-profile-p1')
      ).not.toBeInTheDocument()
      expect(
        screen.getByTestId('available-profile-p2')
      ).toBeInTheDocument()
      expect(
        screen.queryByTestId('available-profile-p3')
      ).not.toBeInTheDocument()
    })

    it('shows empty message when all profiles are bound', async () => {
      const bindings = [
        {
          profileId: 'p1',
          profileName: 'Production API',
          profileType: 'http',
          alias: 'api',
          fields: [],
        },
        {
          profileId: 'p2',
          profileName: 'Dev Database',
          profileType: 'database',
          alias: 'db',
          fields: [],
        },
        {
          profileId: 'p3',
          profileName: 'SSH Gateway',
          profileType: 'ssh',
          alias: 'ssh',
          fields: [],
        },
      ]

      const { ProfileBindingModal } = await import(
        '@/features/workbench/common/element-config/dialogs/profile-binding-modal'
      )
      render(
        <ProfileBindingModal
          isOpen={true}
          onClose={vi.fn()}
          bindings={bindings}
          onDone={vi.fn()}
        />
      )

      await waitFor(() => {
        expect(
          screen.getByText('No profiles available')
        ).toBeInTheDocument()
      })
    })
  })

  describe('Adding Profiles', () => {
    it('adds a profile with generated alias when clicking add button', async () => {
      const user = userEvent.setup({ delay: null })

      const { ProfileBindingModal } = await import(
        '@/features/workbench/common/element-config/dialogs/profile-binding-modal'
      )
      render(
        <ProfileBindingModal
          isOpen={true}
          onClose={vi.fn()}
          bindings={[]}
          onDone={vi.fn()}
        />
      )

      await waitFor(() => {
        expect(
          screen.getByTestId('available-profile-p1')
        ).toBeInTheDocument()
      })

      // Click add button for Production API
      await user.click(screen.getByLabelText('Add Production API'))

      // Should appear in bound section with generated alias
      expect(screen.getByTestId('bound-profile-p1')).toBeInTheDocument()
      expect(screen.getByTestId('alias-input-p1')).toHaveValue(
        'production_api'
      )
      // Should be removed from available list
      expect(
        screen.queryByTestId('available-profile-p1')
      ).not.toBeInTheDocument()
    })

    it('populates fields from profile config and environment data', async () => {
      const user = userEvent.setup({ delay: null })
      const handleDone = vi.fn()

      const { ProfileBindingModal } = await import(
        '@/features/workbench/common/element-config/dialogs/profile-binding-modal'
      )
      render(
        <ProfileBindingModal
          isOpen={true}
          onClose={vi.fn()}
          bindings={[]}
          onDone={handleDone}
        />
      )

      await waitFor(() => {
        expect(
          screen.getByTestId('available-profile-p1')
        ).toBeInTheDocument()
      })

      // Add Production API (has config.base_url and environmentValues.env1.api_key)
      await user.click(screen.getByLabelText('Add Production API'))

      // Click Done and verify fields are derived from actual data
      await user.click(screen.getByRole('button', { name: /done/i }))

      expect(handleDone).toHaveBeenCalledWith([
        expect.objectContaining({
          profileId: 'p1',
          profileType: 'http',
          fields: expect.arrayContaining([
            { name: 'base_url', type: 'string' },
            { name: 'api_key', type: 'string' },
          ]),
        }),
      ])
    })
  })

  describe('Editing Aliases', () => {
    it('allows editing the alias of a bound profile without affecting others', async () => {
      const user = userEvent.setup({ delay: null })
      const bindings = [
        {
          profileId: 'p1',
          profileName: 'Production API',
          profileType: 'http',
          alias: 'api',
          fields: [],
        },
        {
          profileId: 'p2',
          profileName: 'Dev Database',
          profileType: 'database',
          alias: 'db',
          fields: [],
        },
      ]

      const { ProfileBindingModal } = await import(
        '@/features/workbench/common/element-config/dialogs/profile-binding-modal'
      )
      render(
        <ProfileBindingModal
          isOpen={true}
          onClose={vi.fn()}
          bindings={bindings}
          onDone={vi.fn()}
        />
      )

      await waitForLoad()

      const aliasInput = screen.getByTestId('alias-input-p1')
      await user.clear(aliasInput)
      await user.type(aliasInput, 'prod')

      expect(aliasInput).toHaveValue('prod')
      // Other binding unchanged
      expect(screen.getByTestId('alias-input-p2')).toHaveValue('db')
    })

    it('includes edited alias in Done callback', async () => {
      const user = userEvent.setup({ delay: null })
      const handleDone = vi.fn()
      const bindings = [
        {
          profileId: 'p1',
          profileName: 'Production API',
          profileType: 'http',
          alias: 'api',
          fields: [{ name: 'base_url', type: 'string' }],
        },
      ]

      const { ProfileBindingModal } = await import(
        '@/features/workbench/common/element-config/dialogs/profile-binding-modal'
      )
      render(
        <ProfileBindingModal
          isOpen={true}
          onClose={vi.fn()}
          bindings={bindings}
          onDone={handleDone}
        />
      )

      await waitForLoad()

      const aliasInput = screen.getByTestId('alias-input-p1')
      await user.clear(aliasInput)
      await user.type(aliasInput, 'prod_api')

      await user.click(screen.getByRole('button', { name: /done/i }))

      expect(handleDone).toHaveBeenCalledWith([
        expect.objectContaining({
          profileId: 'p1',
          alias: 'prod_api',
        }),
      ])
    })
  })

  describe('Alias Validation', () => {
    async function renderWith(
      bindings: ProfileBinding[],
      availableVariables: Array<{ id: string; name: string; type: string; value: unknown; source?: string }> = [],
      handleDone = vi.fn(),
    ) {
      const { ProfileBindingModal } = await import(
        '@/features/workbench/common/element-config/dialogs/profile-binding-modal'
      )
      render(
        <ProfileBindingModal
          isOpen
          onClose={vi.fn()}
          bindings={bindings}
          availableVariables={availableVariables}
          onDone={handleDone}
        />
      )
      await waitForLoad()
      return handleDone
    }

    it('rejects an alias that is not a valid Python identifier', async () => {
      const user = userEvent.setup({ delay: null })
      const handleDone = await renderWith([
        { profileId: 'p1', profileName: 'P', profileType: 'custom', alias: 'ok', fields: [] },
      ])

      const input = screen.getByTestId('alias-input-p1')
      await user.clear(input)
      await user.type(input, '1bad')

      expect(input).toHaveAttribute('aria-invalid', 'true')
      expect(screen.getByTestId('alias-error-p1')).toBeInTheDocument()
      expect(screen.getByTestId('profile-binding-done')).toBeDisabled()

      await user.click(screen.getByTestId('profile-binding-done'))
      expect(handleDone).not.toHaveBeenCalled()
    })

    it('rejects a Python keyword as an alias', async () => {
      const user = userEvent.setup({ delay: null })
      await renderWith([
        { profileId: 'p1', profileName: 'P', profileType: 'custom', alias: 'ok', fields: [] },
      ])

      const input = screen.getByTestId('alias-input-p1')
      await user.clear(input)
      await user.type(input, 'class')

      expect(screen.getByTestId('alias-error-p1')).toHaveTextContent(/keyword/i)
    })

    it('rejects an alias that conflicts with an existing variable', async () => {
      const user = userEvent.setup({ delay: null })
      await renderWith(
        [{ profileId: 'p1', profileName: 'P', profileType: 'custom', alias: 'unique', fields: [] }],
        [{ id: 'v1', name: 'taken', type: 'string', value: '' }],
      )

      const input = screen.getByTestId('alias-input-p1')
      await user.clear(input)
      await user.type(input, 'taken')

      expect(screen.getByTestId('alias-error-p1')).toHaveTextContent(/conflicts/i)
    })

    it('ignores dotted namespace entries when checking variable conflicts', async () => {
      const user = userEvent.setup({ delay: null })
      await renderWith(
        [{ profileId: 'p1', profileName: 'P', profileType: 'custom', alias: 'host', fields: [] }],
        // 'system.host' is a dotted namespace entry - must not collide with alias 'host'.
        [{ id: 'v1', name: 'system.host', type: 'string', value: '', source: 'System' }],
      )

      const input = screen.getByTestId('alias-input-p1')
      await user.clear(input)
      await user.type(input, 'host')

      // No conflict error should appear for the dotted entry.
      expect(screen.queryByTestId('alias-error-p1')).not.toBeInTheDocument()
    })

    it('does not flag conflict against another profile alias variable', async () => {
      const user = userEvent.setup({ delay: null })
      await renderWith(
        [{ profileId: 'p1', profileName: 'P', profileType: 'custom', alias: 'fresh', fields: [] }],
        [{ id: 'v1', name: 'other_alias', type: 'map', value: null, source: 'Profile: other' }],
      )

      const input = screen.getByTestId('alias-input-p1')
      await user.clear(input)
      await user.type(input, 'other_alias')

      // Profile-sourced "variables" represent other aliases - they collide via the
      // duplicate-alias check inside this modal, not via cross-namespace.
      const errorEl = screen.queryByTestId('alias-error-p1')
      // Either no error, or the error is about something else (not "conflicts with existing variable")
      if (errorEl) {
        expect(errorEl.textContent).not.toMatch(/conflicts with an existing variable/i)
      }
    })

    it('rejects two bound profiles using the same alias', async () => {
      const user = userEvent.setup({ delay: null })
      await renderWith([
        { profileId: 'p1', profileName: 'A', profileType: 'custom', alias: 'shared', fields: [] },
        { profileId: 'p2', profileName: 'B', profileType: 'custom', alias: 'unique', fields: [] },
      ])

      const input2 = screen.getByTestId('alias-input-p2')
      await user.clear(input2)
      await user.type(input2, 'shared')

      expect(screen.getByTestId('alias-error-p1')).toHaveTextContent(/another bound profile/i)
      expect(screen.getByTestId('alias-error-p2')).toHaveTextContent(/another bound profile/i)
      expect(screen.getByTestId('profile-binding-done')).toBeDisabled()
    })
  })

  describe('Removing Profiles', () => {
    it('removes a bound profile when clicking remove button', async () => {
      const user = userEvent.setup({ delay: null })
      const bindings = [
        {
          profileId: 'p1',
          profileName: 'Production API',
          profileType: 'http',
          alias: 'api',
          fields: [],
        },
      ]

      const { ProfileBindingModal } = await import(
        '@/features/workbench/common/element-config/dialogs/profile-binding-modal'
      )
      render(
        <ProfileBindingModal
          isOpen={true}
          onClose={vi.fn()}
          bindings={bindings}
          onDone={vi.fn()}
        />
      )

      await waitForLoad()

      await user.click(screen.getByLabelText('Remove Production API'))

      expect(
        screen.queryByTestId('bound-profile-p1')
      ).not.toBeInTheDocument()
      expect(screen.getByText('No profiles bound')).toBeInTheDocument()
    })

    it('returns removed profile to available list', async () => {
      const user = userEvent.setup({ delay: null })
      const bindings = [
        {
          profileId: 'p1',
          profileName: 'Production API',
          profileType: 'http',
          alias: 'api',
          fields: [],
        },
      ]

      const { ProfileBindingModal } = await import(
        '@/features/workbench/common/element-config/dialogs/profile-binding-modal'
      )
      render(
        <ProfileBindingModal
          isOpen={true}
          onClose={vi.fn()}
          bindings={bindings}
          onDone={vi.fn()}
        />
      )

      // Wait for profiles to load
      await waitFor(() => {
        expect(
          screen.getByTestId('available-profile-p2')
        ).toBeInTheDocument()
      })

      // p1 should not be in available (it's bound)
      expect(
        screen.queryByTestId('available-profile-p1')
      ).not.toBeInTheDocument()

      // Remove p1
      await user.click(screen.getByLabelText('Remove Production API'))

      // p1 should now appear in available
      expect(
        screen.getByTestId('available-profile-p1')
      ).toBeInTheDocument()
    })
  })

  describe('Done and Close', () => {
    it('calls onDone with updated bindings when Done is clicked', async () => {
      const user = userEvent.setup({ delay: null })
      const handleDone = vi.fn()
      const bindings = [
        {
          profileId: 'p1',
          profileName: 'Production API',
          profileType: 'http',
          alias: 'api',
          fields: [{ name: 'base_url', type: 'string' }],
        },
      ]

      const { ProfileBindingModal } = await import(
        '@/features/workbench/common/element-config/dialogs/profile-binding-modal'
      )
      render(
        <ProfileBindingModal
          isOpen={true}
          onClose={vi.fn()}
          bindings={bindings}
          onDone={handleDone}
        />
      )

      await waitForLoad()

      await user.click(screen.getByRole('button', { name: /done/i }))

      expect(handleDone).toHaveBeenCalledWith([
        {
          profileId: 'p1',
          profileName: 'Production API',
          profileType: 'http',
          alias: 'api',
          fields: [{ name: 'base_url', type: 'string' }],
        },
      ])
    })

    it('calls onClose when the sheet is closed via escape', async () => {
      const user = userEvent.setup({ delay: null })
      const handleClose = vi.fn()

      const { ProfileBindingModal } = await import(
        '@/features/workbench/common/element-config/dialogs/profile-binding-modal'
      )
      render(
        <ProfileBindingModal
          isOpen={true}
          onClose={handleClose}
          bindings={[]}
          onDone={vi.fn()}
        />
      )

      await waitForLoad()

      await user.keyboard('{Escape}')

      expect(handleClose).toHaveBeenCalledTimes(1)
    })

    it('calls onClose when the header close button is clicked', async () => {
      const user = userEvent.setup({ delay: null })
      const handleClose = vi.fn()

      const { ProfileBindingModal } = await import(
        '@/features/workbench/common/element-config/dialogs/profile-binding-modal'
      )
      render(
        <ProfileBindingModal
          isOpen={true}
          onClose={handleClose}
          bindings={[]}
          onDone={vi.fn()}
        />
      )

      await waitForLoad()

      await user.click(screen.getByRole('button', { name: 'Close' }))

      expect(handleClose).toHaveBeenCalledTimes(1)
    })

    it('calls onClose when Cancel button is clicked', async () => {
      const user = userEvent.setup({ delay: null })
      const handleClose = vi.fn()

      const { ProfileBindingModal } = await import(
        '@/features/workbench/common/element-config/dialogs/profile-binding-modal'
      )
      render(
        <ProfileBindingModal
          isOpen={true}
          onClose={handleClose}
          bindings={[]}
          onDone={vi.fn()}
        />
      )

      await waitForLoad()

      await user.click(screen.getByRole('button', { name: /cancel/i }))

      expect(handleClose).toHaveBeenCalled()
    })
  })

  describe('Loading and Error States', () => {
    it('shows loading state while fetching profiles', async () => {
      // Never resolves - shows loading
      mockFetchProfiles.mockReturnValue(new Promise(() => {}))

      const { ProfileBindingModal } = await import(
        '@/features/workbench/common/element-config/dialogs/profile-binding-modal'
      )
      render(
        <ProfileBindingModal
          isOpen={true}
          onClose={vi.fn()}
          bindings={[]}
          onDone={vi.fn()}
        />
      )

      expect(screen.getByTestId('profiles-loading')).toBeInTheDocument()
      expect(screen.getByText('Loading…')).toBeInTheDocument()
    })

    it('shows error state when profile fetch fails', async () => {
      mockFetchProfiles.mockRejectedValue(new Error('Network error'))

      const { ProfileBindingModal } = await import(
        '@/features/workbench/common/element-config/dialogs/profile-binding-modal'
      )
      render(
        <ProfileBindingModal
          isOpen={true}
          onClose={vi.fn()}
          bindings={[]}
          onDone={vi.fn()}
        />
      )

      await waitFor(() => {
        expect(screen.getByTestId('profiles-error')).toBeInTheDocument()
        expect(
          screen.getByText('Failed to load profiles')
        ).toBeInTheDocument()
      })
    })

    it('returns empty fields for profile with no config or environment data', async () => {
      const user = userEvent.setup({ delay: null })
      const handleDone = vi.fn()

      const { ProfileBindingModal } = await import(
        '@/features/workbench/common/element-config/dialogs/profile-binding-modal'
      )
      render(
        <ProfileBindingModal
          isOpen={true}
          onClose={vi.fn()}
          bindings={[]}
          onDone={handleDone}
        />
      )

      await waitFor(() => {
        expect(
          screen.getByTestId('available-profile-p2')
        ).toBeInTheDocument()
      })

      // Add Dev Database which has empty config and environmentValues
      await user.click(screen.getByLabelText('Add Dev Database'))

      await user.click(screen.getByRole('button', { name: /done/i }))

      expect(handleDone).toHaveBeenCalledWith([
        expect.objectContaining({
          profileId: 'p2',
          fields: [], // Empty because profile has no config or env data
        }),
      ])
    })
  })

  describe('the parent the Profiles sheet was opened from', () => {
    const BOUND: ProfileBinding[] = [
      {
        profileId: 'p1',
        profileName: 'Production API',
        profileType: 'http',
        alias: 'api',
        fields: [{ name: 'base_url', type: 'string' }],
      },
    ]

    // Modules reset between tests, so the stand-in parent is imported with the sheet.
    async function renderInParent(isOpen = true) {
      const onDone = vi.fn()
      const onClose = vi.fn()
      const { ProfileBindingModal } = await import(
        '@/features/workbench/common/element-config/dialogs/profile-binding-modal'
      )
      const { ChildEditorParent, applyParentChildren } = await import(
        '../../../../../utils/child-editor-parent'
      )
      const view = render(
        <ChildEditorParent>
          <ProfileBindingModal isOpen={isOpen} onClose={onClose} bindings={BOUND} onDone={onDone} />
        </ChildEditorParent>,
      )
      if (isOpen) await waitForLoad()
      return { onDone, onClose, rerender: view.rerender, ProfileBindingModal, ChildEditorParent, applyParentChildren }
    }

    it('closes once Done has handed the bindings back', async () => {
      const user = userEvent.setup({ delay: null })
      const { onDone, onClose } = await renderInParent()

      await user.click(screen.getByTestId('profile-binding-done'))

      expect(onDone).toHaveBeenCalledExactlyOnceWith(BOUND)
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('reports nothing while closed', async () => {
      await renderInParent(false)
      expect(parentChildren()).toEqual([])
    })

    it('reports Profiles with no changes while the bindings are untouched', async () => {
      await renderInParent()
      expect(parentChildren()).toEqual([{ label: 'Profiles', hasChanges: false, cannotBeSaved: false }])
    })

    it('reports changes once an alias is edited', async () => {
      const user = userEvent.setup({ delay: null })
      await renderInParent()
      await user.type(screen.getByTestId('alias-input-p1'), 'x')
      expect(parentChildren()).toEqual([{ label: 'Profiles', hasChanges: true, cannotBeSaved: false }])
    })

    it('reports changes it cannot save while an alias is invalid', async () => {
      const user = userEvent.setup({ delay: null })
      await renderInParent()
      await user.clear(screen.getByTestId('alias-input-p1'))
      expect(parentChildren()).toEqual([{ label: 'Profiles', hasChanges: true, cannotBeSaved: true }])
    })

    it('drops out of the parent once it closes', async () => {
      const { rerender, ProfileBindingModal, ChildEditorParent } = await renderInParent()
      rerender(
        <ChildEditorParent>
          <ProfileBindingModal isOpen={false} onClose={vi.fn()} bindings={BOUND} onDone={vi.fn()} />
        </ChildEditorParent>,
      )
      expect(parentChildren()).toEqual([])
    })

    it('lets the parent write the bindings without closing', async () => {
      const user = userEvent.setup({ delay: null })
      const { onDone, onClose, applyParentChildren } = await renderInParent()
      await user.type(screen.getByTestId('alias-input-p1'), 'x')

      act(() => applyParentChildren())

      expect(onDone).toHaveBeenCalledExactlyOnceWith([{ ...BOUND[0], alias: 'apix' }])
      expect(onClose).not.toHaveBeenCalled()
    })
  })

  describe('generateAlias', () => {
    it('converts name to lowercase with underscores', async () => {
      const { generateAlias } = await import(
        '@/features/workbench/common/element-config/dialogs/profile-binding-modal'
      )
      expect(generateAlias('Production API')).toBe('production_api')
      expect(generateAlias('Dev Database')).toBe('dev_database')
      expect(generateAlias('SSH Gateway')).toBe('ssh_gateway')
    })

    it('strips non-alphanumeric characters', async () => {
      const { generateAlias } = await import(
        '@/features/workbench/common/element-config/dialogs/profile-binding-modal'
      )
      expect(generateAlias('My-API (v2)')).toBe('myapi_v2')
      expect(generateAlias('test@profile#1')).toBe('testprofile1')
    })

    it('handles multiple consecutive spaces', async () => {
      const { generateAlias } = await import(
        '@/features/workbench/common/element-config/dialogs/profile-binding-modal'
      )
      expect(generateAlias('Some   Spaced   Name')).toBe('some_spaced_name')
    })
  })
})
