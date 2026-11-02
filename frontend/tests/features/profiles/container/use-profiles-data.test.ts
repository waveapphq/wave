/**
 * useProfilesData load outcomes: the profile list is the only primary read, so
 * the profile types, the tag list and the environments each block the page on
 * their own instead of being reported as empty.
 *
 * Every argument passed to the hook is a stable module reference - an unstable
 * filters/setPageInfo identity would re-create `loadData` every render and trip
 * the hook's load effect into an update loop.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'

vi.mock('@/features/profiles/api/crud', () => ({
  fetchProfiles: vi.fn(),
  fetchProfileTypes: vi.fn(),
  fetchAllTags: vi.fn(),
  fetchProfileEnvironments: vi.fn(),
}))

import {
  fetchProfiles,
  fetchProfileTypes,
  fetchAllTags,
  fetchProfileEnvironments,
} from '@/features/profiles/api/crud'
import { useProfilesData } from '@/features/profiles/container/use-profiles-data'
import { usePageBlockStore, type PageBlock } from '@/stores/page-block-store'
import type { Environment, Profile } from '@/features/profiles/api/types'
import type { Filters } from '@/features/profiles/components/profiles-filters'
import type { PageInfo } from '@/components/shared/tables/table-utils'

const mockFetchProfiles = vi.mocked(fetchProfiles)
const mockFetchProfileTypes = vi.mocked(fetchProfileTypes)
const mockFetchAllTags = vi.mocked(fetchAllTags)
const mockFetchEnvironments = vi.mocked(fetchProfileEnvironments)

const PAGE: PageInfo = { currentPage: 1, pageSize: 25, totalItems: 0, totalPages: 0 }
const NO_FILTERS: Filters = { search: '', type: '', tags: [] }
const SET_PAGE = vi.fn()

const PROFILE: Profile = {
  id: 'profile-1',
  name: 'Production Database',
  type: 'database',
  description: null,
  tags: [],
  usage: 0,
  config: {},
  environmentValues: {},
  environmentsCount: 0,
  totalEnvironments: 1,
  hasIncompleteEnvironments: false,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}

const ENVIRONMENTS: Environment[] = [
  { id: 'env-1', name: 'Production', description: null, tags: [], usage: 0 },
]

const OTHER_ENVIRONMENTS: Environment[] = [
  { id: 'env-2', name: 'Staging', description: null, tags: [], usage: 0 },
]

function profilesOk() {
  return {
    data: [PROFILE],
    pagination: { page: 1, per_page: 25, total: 1, total_pages: 1 },
  }
}

function envFailure(message: string) {
  return Object.assign(new Error(message), {
    method: 'GET',
    path: '/environments/names',
    status: 500,
    statusText: 'Internal Server Error',
    durationMs: 12,
    requestId: 'req-1',
    occurredAt: '2026-08-10T15:42:09.000Z',
  })
}

function readFailure(message: string, path: string) {
  return Object.assign(new Error(message), {
    method: 'GET',
    path,
    status: 503,
    statusText: 'Service Unavailable',
  })
}

function renderData() {
  return renderHook(() => useProfilesData(PAGE, SET_PAGE, NO_FILTERS, null, null))
}

function currentBlock(): PageBlock {
  const { block } = usePageBlockStore.getState()
  if (!block) throw new Error('expected the page to be blocked')
  return block
}

beforeEach(() => {
  vi.clearAllMocks()
  usePageBlockStore.setState({ block: null, retrying: false })
  mockFetchProfiles.mockResolvedValue(profilesOk())
  mockFetchProfileTypes.mockResolvedValue(['database'])
  mockFetchAllTags.mockResolvedValue(['production'])
  mockFetchEnvironments.mockResolvedValue(ENVIRONMENTS)
})

describe('useProfilesData - every read succeeds', () => {
  it('sets profiles, types, tags and environments', async () => {
    const { result } = renderData()

    await waitFor(() => expect(result.current.profiles).toHaveLength(1))
    expect(result.current.profileTypes).toEqual(['database'])
    expect(result.current.allTags).toEqual(['production'])
    expect(result.current.environments).toEqual(ENVIRONMENTS)
    expect(result.current.environmentsFailed).toBe(false)
    expect(result.current.error).toBeNull()
    expect(SET_PAGE).toHaveBeenCalled()
  })

  it('leaves a block raised by another surface alone', async () => {
    usePageBlockStore.getState().setBlock({
      owner: 'another-surface',
      label: 'sessions',
      detail: { message: 'stale' },
      retry: vi.fn().mockResolvedValue(undefined),
    })

    const { result } = renderData()

    await waitFor(() => expect(result.current.environments).toEqual(ENVIRONMENTS))
    expect(currentBlock().title).toBe('Could not load sessions')
  })
})

describe('useProfilesData - the primary read and a blocking read fail together', () => {
  it('shows only the full-page error state', async () => {
    mockFetchProfiles.mockRejectedValue(new Error('Network error'))
    mockFetchAllTags.mockRejectedValue(readFailure('Tags unavailable', '/profiles/tags'))
    mockFetchEnvironments.mockRejectedValue(envFailure('Environments unavailable'))

    const { result } = renderData()

    await waitFor(() => expect(result.current.error).toBe('Network error'))
    await waitFor(() => expect(result.current.environmentsFailed).toBe(true))
    expect(usePageBlockStore.getState().block).toBeNull()
  })

  it('blocks on the read that is still failing once the primary read recovers', async () => {
    mockFetchProfiles.mockRejectedValueOnce(new Error('Network error'))
    mockFetchAllTags.mockRejectedValue(readFailure('Tags unavailable', '/profiles/tags'))

    const { result } = renderData()
    await waitFor(() => expect(result.current.error).toBe('Network error'))
    expect(usePageBlockStore.getState().block).toBeNull()

    await act(async () => {
      await result.current.loadData()
    })

    expect(result.current.error).toBeNull()
    expect(currentBlock().title).toBe('Could not load tags')
  })
})

describe('useProfilesData - the primary read fails', () => {
  it('keeps the full-page error state and still loads environments', async () => {
    mockFetchProfiles.mockRejectedValue(new Error('Network error'))

    const { result } = renderData()

    await waitFor(() => expect(result.current.error).toBe('Network error'))
    expect(result.current.profiles).toEqual([])
    expect(result.current.environments).toEqual(ENVIRONMENTS)
    expect(result.current.environmentsFailed).toBe(false)
    expect(usePageBlockStore.getState().block).toBeNull()
  })

  it('falls back to a generic message when the failure is not an Error', async () => {
    mockFetchProfiles.mockRejectedValue('weird failure')

    const { result } = renderData()

    await waitFor(() => expect(result.current.error).toBe('Failed to load profiles'))
  })

  it('reaches the error state without waiting for the environments read', async () => {
    let releaseEnvironments: (environments: Environment[]) => void = () => {}
    mockFetchProfiles.mockRejectedValue(new Error('Network error'))
    mockFetchEnvironments.mockReturnValue(
      new Promise<Environment[]>((resolve) => {
        releaseEnvironments = resolve
      })
    )

    const { result } = renderData()

    await waitFor(() => expect(result.current.error).toBe('Network error'))
    expect(result.current.loading).toBe(false)

    await act(async () => {
      releaseEnvironments(ENVIRONMENTS)
    })
  })
})

describe('useProfilesData - the environments read fails', () => {
  it('blocks the page instead of reporting an empty list', async () => {
    mockFetchEnvironments.mockRejectedValue(envFailure('Environments unavailable'))

    const { result } = renderData()

    await waitFor(() => expect(result.current.environmentsFailed).toBe(true))
    expect(result.current.environments).toEqual([])

    const block = currentBlock()
    expect(block.title).toBe('Could not load environments')
    expect(block.detail).toEqual({
      method: 'GET',
      path: '/environments/names',
      status: 500,
      statusText: 'Internal Server Error',
      durationMs: 12,
      requestId: 'req-1',
      occurredAt: '2026-08-10T15:42:09.000Z',
      message: 'Environments unavailable',
    })
  })

  it('leaves the primary data intact', async () => {
    mockFetchEnvironments.mockRejectedValue(envFailure('Environments unavailable'))

    const { result } = renderData()

    await waitFor(() => expect(result.current.environmentsFailed).toBe(true))
    expect(result.current.profiles).toHaveLength(1)
    expect(result.current.profileTypes).toEqual(['database'])
    expect(result.current.error).toBeNull()
  })
})

describe('useProfilesData - retrying the environments read', () => {
  it('restores the environments and clears the block on success', async () => {
    mockFetchEnvironments.mockRejectedValueOnce(envFailure('Environments unavailable'))

    const { result } = renderData()
    await waitFor(() => expect(result.current.environmentsFailed).toBe(true))

    mockFetchEnvironments.mockResolvedValue(OTHER_ENVIRONMENTS)
    await act(async () => {
      await currentBlock().retry()
    })

    expect(result.current.environments).toEqual(OTHER_ENVIRONMENTS)
    expect(result.current.environmentsFailed).toBe(false)
    expect(usePageBlockStore.getState().block).toBeNull()
  })

  it('re-blocks with the newer failure and rejects when it fails again', async () => {
    mockFetchEnvironments.mockRejectedValue(envFailure('Environments unavailable'))

    const { result } = renderData()
    await waitFor(() => expect(result.current.environmentsFailed).toBe(true))

    const newer = envFailure('Still unavailable')
    mockFetchEnvironments.mockRejectedValue(newer)
    await act(async () => {
      await expect(currentBlock().retry()).rejects.toBe(newer)
    })

    expect(result.current.environmentsFailed).toBe(true)
    expect(currentBlock().detail.message).toBe('Still unavailable')
  })

  it('re-runs only the environments read', async () => {
    mockFetchEnvironments.mockRejectedValueOnce(envFailure('Environments unavailable'))

    renderData()
    await waitFor(() => expect(usePageBlockStore.getState().block).not.toBeNull())
    expect(mockFetchEnvironments).toHaveBeenCalledTimes(1)

    const profileCalls = mockFetchProfiles.mock.calls.length
    const typeCalls = mockFetchProfileTypes.mock.calls.length
    const tagCalls = mockFetchAllTags.mock.calls.length
    const pageCalls = SET_PAGE.mock.calls.length

    mockFetchEnvironments.mockResolvedValue(OTHER_ENVIRONMENTS)
    await act(async () => {
      await currentBlock().retry()
    })

    expect(mockFetchEnvironments).toHaveBeenCalledTimes(2)
    expect(mockFetchProfiles).toHaveBeenCalledTimes(profileCalls)
    expect(mockFetchProfileTypes).toHaveBeenCalledTimes(typeCalls)
    expect(mockFetchAllTags).toHaveBeenCalledTimes(tagCalls)
    expect(SET_PAGE).toHaveBeenCalledTimes(pageCalls)
  })
})

describe('useProfilesData - the profile types read fails', () => {
  it('blocks the page and keeps the profile list', async () => {
    mockFetchProfileTypes.mockRejectedValue(readFailure('Types unavailable', '/profiles/types'))

    const { result } = renderData()

    await waitFor(() => expect(currentBlock().title).toBe('Could not load profile types'))
    expect(result.current.profiles).toHaveLength(1)
    expect(result.current.error).toBeNull()
    expect(result.current.environmentsFailed).toBe(false)
    expect(currentBlock().detail.message).toBe('Types unavailable')
  })

  it('retries only the profile types read', async () => {
    mockFetchProfileTypes.mockRejectedValueOnce(readFailure('Types unavailable', '/profiles/types'))

    const { result } = renderData()
    await waitFor(() => expect(usePageBlockStore.getState().block).not.toBeNull())

    mockFetchProfileTypes.mockResolvedValue(['ssh'])
    await act(async () => {
      await currentBlock().retry()
    })

    expect(result.current.profileTypes).toEqual(['ssh'])
    expect(usePageBlockStore.getState().block).toBeNull()
    expect(mockFetchProfiles).toHaveBeenCalledTimes(1)
    expect(mockFetchAllTags).toHaveBeenCalledTimes(1)
    expect(mockFetchEnvironments).toHaveBeenCalledTimes(1)
  })
})

describe('useProfilesData - the tag read fails', () => {
  it('blocks the page and keeps the profile list', async () => {
    mockFetchAllTags.mockRejectedValue(readFailure('Tags unavailable', '/profiles/tags'))

    const { result } = renderData()

    await waitFor(() => expect(currentBlock().title).toBe('Could not load tags'))
    expect(result.current.profiles).toHaveLength(1)
    expect(result.current.error).toBeNull()
    expect(currentBlock().detail.message).toBe('Tags unavailable')
  })
})

describe('useProfilesData - several blocking reads fail together', () => {
  it('names both reads in the title', async () => {
    mockFetchAllTags.mockRejectedValue(readFailure('Tags unavailable', '/profiles/tags'))
    mockFetchEnvironments.mockRejectedValue(envFailure('Environments unavailable'))

    renderData()

    await waitFor(() => expect(currentBlock().title).toBe('Could not load tags and environments'))
  })

  it('names all three reads in the title', async () => {
    mockFetchProfileTypes.mockRejectedValue(readFailure('Types unavailable', '/profiles/types'))
    mockFetchAllTags.mockRejectedValue(readFailure('Tags unavailable', '/profiles/tags'))
    mockFetchEnvironments.mockRejectedValue(envFailure('Environments unavailable'))

    renderData()

    await waitFor(() =>
      expect(currentBlock().title).toBe('Could not load profile types, tags and environments')
    )
  })

  it('carries every failure in the details payload', async () => {
    mockFetchProfileTypes.mockRejectedValue(readFailure('Types unavailable', '/profiles/types'))
    mockFetchAllTags.mockRejectedValue(readFailure('Tags unavailable', '/profiles/tags'))

    renderData()

    await waitFor(() => expect(usePageBlockStore.getState().block).not.toBeNull())
    expect(currentBlock().detail).toEqual({
      message: [
        'profile types',
        'GET  /profiles/types',
        '503  Service Unavailable',
        '',
        'Types unavailable',
        '',
        'tags',
        'GET  /profiles/tags',
        '503  Service Unavailable',
        '',
        'Tags unavailable',
      ].join('\n'),
    })
  })

  it('narrows the block to the read that is still failing after a retry', async () => {
    mockFetchAllTags.mockRejectedValueOnce(readFailure('Tags unavailable', '/profiles/tags'))
    mockFetchEnvironments.mockRejectedValue(envFailure('Environments unavailable'))

    const { result } = renderData()
    await waitFor(() => expect(currentBlock().title).toBe('Could not load tags and environments'))

    mockFetchAllTags.mockResolvedValue(['recovered'])
    await act(async () => {
      await expect(currentBlock().retry()).rejects.toThrow('Environments unavailable')
    })

    expect(result.current.allTags).toEqual(['recovered'])
    expect(currentBlock().title).toBe('Could not load environments')
    expect(result.current.environmentsFailed).toBe(true)
    expect(mockFetchProfiles).toHaveBeenCalledTimes(1)
  })

  it('clears the block when every failed read recovers', async () => {
    mockFetchAllTags.mockRejectedValueOnce(readFailure('Tags unavailable', '/profiles/tags'))
    mockFetchEnvironments.mockRejectedValueOnce(envFailure('Environments unavailable'))

    const { result } = renderData()
    await waitFor(() => expect(currentBlock().title).toBe('Could not load tags and environments'))

    mockFetchAllTags.mockResolvedValue(['recovered'])
    mockFetchEnvironments.mockResolvedValue(OTHER_ENVIRONMENTS)
    await act(async () => {
      await currentBlock().retry()
    })

    expect(usePageBlockStore.getState().block).toBeNull()
    expect(result.current.allTags).toEqual(['recovered'])
    expect(result.current.environments).toEqual(OTHER_ENVIRONMENTS)
    expect(result.current.environmentsFailed).toBe(false)
  })
})
