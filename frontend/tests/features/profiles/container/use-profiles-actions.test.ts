/**
 * Tests for useProfilesActions - profile CRUD modal action hook.
 *
 * REQ-4.7.4: handleModalSubmit must forward the description to the API
 * on BOTH create and update, including an empty / cleared description (sent as
 * '', never dropped to undefined), so editing - or clearing - a description
 * persists.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const createProfile = vi.fn()
const updateProfile = vi.fn()
const fetchProfile = vi.fn()
const deleteProfile = vi.fn()
const duplicateProfile = vi.fn()
const fetchProfileTypeSchema = vi.fn()

vi.mock('@/features/profiles/api/crud', () => ({
  createProfile: (...args: unknown[]) => createProfile(...args),
  updateProfile: (...args: unknown[]) => updateProfile(...args),
  fetchProfile: (...args: unknown[]) => fetchProfile(...args),
  deleteProfile: (...args: unknown[]) => deleteProfile(...args),
  duplicateProfile: (...args: unknown[]) => duplicateProfile(...args),
  fetchProfileTypeSchema: (...args: unknown[]) => fetchProfileTypeSchema(...args),
}))

const warning = vi.fn()
const toastError = vi.fn()

vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({
    warning: (...args: unknown[]) => warning(...args),
    success: vi.fn(),
    error: (...args: unknown[]) => toastError(...args),
    info: vi.fn(),
  }),
}))

const ENVIRONMENTS_UNAVAILABLE_TOAST = 'Could not load environments. Try Again to load them.'

import { useProfilesActions } from '@/features/profiles/container/use-profiles-actions'
import type { ProfileFormData } from '@/features/profiles/components/profile-form-modal'
import type { Profile, Environment } from '@/features/profiles/api/types'

const ENVIRONMENTS: Environment[] = [
  { id: 'env-1', name: 'dev', description: null, tags: [], usage: 0 },
]

function makeFormData(overrides: Partial<ProfileFormData> = {}): ProfileFormData {
  return {
    name: 'My Profile',
    type: 'custom',
    description: 'A description',
    tags: [],
    parameters: [],
    ...overrides,
  }
}

function makeApiProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: 'profile-1',
    name: 'My Profile',
    type: 'custom',
    description: 'old description',
    tags: [],
    usage: 0,
    config: {},
    environmentValues: {},
    environmentsCount: 0,
    totalEnvironments: 1,
    hasIncompleteEnvironments: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

interface ActionsProps {
  profiles?: Profile[]
  environments?: Environment[]
  environmentsFailed?: boolean
}

function renderActions(initialProps: ActionsProps = {}) {
  const loadData = vi.fn().mockResolvedValue(undefined)
  const setError = vi.fn()
  const view = renderHook(
    (props: ActionsProps) =>
      useProfilesActions(
        props.profiles ?? [],
        props.environments ?? ENVIRONMENTS,
        props.environmentsFailed ?? false,
        loadData,
        setError,
      ),
    { initialProps },
  )
  return { ...view, loadData, setError }
}

describe('useProfilesActions - handleModalSubmit description', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createProfile.mockResolvedValue(undefined)
    updateProfile.mockResolvedValue(undefined)
    fetchProfile.mockResolvedValue(makeApiProfile())
  })

  it('sends a non-empty description on create', async () => {
    const { result } = renderActions()
    await act(async () => {
      await result.current.handleModalSubmit(makeFormData({ description: 'Prod DB' }))
    })
    expect(createProfile).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'Prod DB' }),
    )
  })

  it('sends an empty (cleared) description on create as "", not undefined', async () => {
    const { result } = renderActions()
    await act(async () => {
      await result.current.handleModalSubmit(makeFormData({ description: '' }))
    })
    expect(createProfile).toHaveBeenCalledTimes(1)
    expect(createProfile.mock.calls[0][0]).toHaveProperty('description', '')
  })

  it('sends a non-empty description on update', async () => {
    const { result } = renderActions()
    await act(async () => {
      await result.current.handleEditProfile('profile-1')
    })
    await act(async () => {
      await result.current.handleModalSubmit(makeFormData({ description: 'Updated docs' }))
    })
    expect(updateProfile).toHaveBeenCalledWith(
      'profile-1',
      expect.objectContaining({ description: 'Updated docs' }),
    )
  })

  it('sends an empty (cleared) description on update as "", not undefined', async () => {
    const { result } = renderActions()
    await act(async () => {
      await result.current.handleEditProfile('profile-1')
    })
    await act(async () => {
      await result.current.handleModalSubmit(makeFormData({ description: '' }))
    })
    expect(updateProfile).toHaveBeenCalledTimes(1)
    expect(updateProfile.mock.calls[0][1]).toHaveProperty('description', '')
  })
})

// An unprovided field (K8SPROF-6) is stored as null, so its row type comes from the profile type.
describe('useProfilesActions - handleEditProfile types an unprovided field by its schema', () => {
  const databaseProfile = makeApiProfile({
    type: 'database',
    environmentValues: { 'env-1': { host: 'db.local', port: null } },
  })

  function editingParameter(result: { current: ReturnType<typeof useProfilesActions> }, name: string) {
    return result.current.editingProfile?.parameters.find((p) => p.name === name)
  }

  beforeEach(() => {
    vi.clearAllMocks()
    fetchProfile.mockResolvedValue(databaseProfile)
  })

  it('opens an unprovided number as the type its schema declares', async () => {
    fetchProfileTypeSchema.mockResolvedValue({
      type: 'database',
      fields: [
        { name: 'host', type: 'string', required: false, secret: false },
        { name: 'port', type: 'integer', required: false, secret: false, minimum: 1, maximum: 65535 },
      ],
    })
    const { result } = renderActions()
    await act(async () => {
      await result.current.handleEditProfile('profile-1')
    })
    expect(fetchProfileTypeSchema).toHaveBeenCalledWith('database')
    expect(result.current.modalOpen).toBe(true)
    expect(editingParameter(result, 'port')).toMatchObject({ type: 'integer', values: { 'env-1': '' } })
    expect(editingParameter(result, 'host')).toMatchObject({ type: 'string', values: { 'env-1': 'db.local' } })
  })

  it('still opens when the schema cannot be read', async () => {
    fetchProfileTypeSchema.mockRejectedValue(new Error('schema unavailable'))
    const { result } = renderActions()
    await act(async () => {
      await result.current.handleEditProfile('profile-1')
    })
    expect(result.current.modalOpen).toBe(true)
    expect(editingParameter(result, 'port')).toMatchObject({ type: 'string', values: { 'env-1': '' } })
  })

  it('reads no schema for a custom profile', async () => {
    fetchProfile.mockResolvedValue(makeApiProfile())
    const { result } = renderActions()
    await act(async () => {
      await result.current.handleEditProfile('profile-1')
    })
    expect(fetchProfileTypeSchema).not.toHaveBeenCalled()
    expect(result.current.modalOpen).toBe(true)
  })
})

describe('useProfilesActions - environments that are genuinely empty', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchProfile.mockResolvedValue(makeApiProfile())
  })

  it('warns instead of opening the create modal', () => {
    const { result } = renderActions({ environments: [] })
    act(() => {
      result.current.handleNewProfile()
    })
    expect(warning).toHaveBeenCalledWith(
      'Please create at least one environment in Settings before creating profiles.',
      'No Environments',
    )
    expect(result.current.modalOpen).toBe(false)
  })

  it('still opens the edit modal', async () => {
    const { result } = renderActions({ environments: [] })
    await act(async () => {
      await result.current.handleEditProfile('profile-1')
    })
    expect(fetchProfile).toHaveBeenCalledWith('profile-1')
    expect(result.current.modalOpen).toBe(true)
  })

  it('still saves from the edit modal', async () => {
    const { result } = renderActions({ environments: [] })
    await act(async () => {
      await result.current.handleEditProfile('profile-1')
    })
    await act(async () => {
      await result.current.handleModalSubmit(makeFormData())
    })
    expect(updateProfile).toHaveBeenCalledTimes(1)
  })
})

describe('useProfilesActions - environments that failed to load', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createProfile.mockResolvedValue(undefined)
    updateProfile.mockResolvedValue(undefined)
    fetchProfile.mockResolvedValue(makeApiProfile())
  })

  it('reports the refusal instead of opening the create modal or warning about missing environments', () => {
    const { result } = renderActions({ environments: [], environmentsFailed: true })
    act(() => {
      result.current.handleNewProfile()
    })
    expect(warning).not.toHaveBeenCalled()
    expect(result.current.modalOpen).toBe(false)
    expect(toastError).toHaveBeenCalledWith(
      ENVIRONMENTS_UNAVAILABLE_TOAST,
      'New Profile Not Created',
    )
  })

  it('reports the refusal instead of opening the edit modal, and does not fetch the profile', async () => {
    const { result } = renderActions({ environments: [], environmentsFailed: true })
    await act(async () => {
      await result.current.handleEditProfile('profile-1')
    })
    expect(fetchProfile).not.toHaveBeenCalled()
    expect(result.current.modalOpen).toBe(false)
    expect(toastError).toHaveBeenCalledWith(ENVIRONMENTS_UNAVAILABLE_TOAST, 'Profile Not Opened for Editing')
  })

  it('refuses to create and issues no write request', async () => {
    const { result } = renderActions({ environments: [], environmentsFailed: true })
    await act(async () => {
      await result.current.handleModalSubmit(makeFormData())
    })
    expect(createProfile).not.toHaveBeenCalled()
    expect(result.current.modalError).toBe(
      'Could not load environments. Try Again to load them, then save.',
    )
  })

  it('refuses to update an already open modal and issues no write request', async () => {
    const { result, rerender } = renderActions()
    await act(async () => {
      await result.current.handleEditProfile('profile-1')
    })
    expect(result.current.modalOpen).toBe(true)

    rerender({ environments: [], environmentsFailed: true })
    await act(async () => {
      await result.current.handleModalSubmit(makeFormData({ name: 'Wiped Name' }))
    })

    expect(updateProfile).not.toHaveBeenCalled()
    expect(result.current.modalError).toBe(
      'Could not load environments. Try Again to load them, then save.',
    )
    expect(result.current.modalOpen).toBe(true)
  })

  // Dialogs portal outside the inert region, so an already open one outlives the block.
  // Confirming closes the dialog, so the refusal is reported at the gesture instead.
  it('refuses to delete from an already open dialog, reports it, and issues no delete request', async () => {
    const profile = makeApiProfile()
    const { result, rerender } = renderActions({ profiles: [profile] })
    act(() => {
      result.current.handleDeleteProfile(profile.id)
    })
    expect(result.current.deleteDialogOpen).toBe(true)

    rerender({ profiles: [profile], environments: [], environmentsFailed: true })
    await act(async () => {
      await result.current.handleConfirmDelete()
    })

    expect(deleteProfile).not.toHaveBeenCalled()
    expect(toastError).toHaveBeenCalledWith(ENVIRONMENTS_UNAVAILABLE_TOAST, 'Profile Not Deleted')
  })

  it('refuses to duplicate, reports it, and issues no write request', async () => {
    const { result } = renderActions({ environments: [], environmentsFailed: true })
    await act(async () => {
      await result.current.handleDuplicateProfile('profile-1')
    })
    expect(duplicateProfile).not.toHaveBeenCalled()
    expect(toastError).toHaveBeenCalledWith(
      ENVIRONMENTS_UNAVAILABLE_TOAST,
      'Profile Not Duplicated',
    )
  })
})
