/**
 * Ownership REST client: the real ownershipApi module is mocked
 * away everywhere it is consumed, so this exercises its actual bodies - URL,
 * method, body shape, and the getOwnership holder-id query branch.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
vi.mock('@/lib/api', () => ({ apiClient: { get, post } }))

import { ownershipApi, isHeldByAnother } from '@/features/workbench/api/ownership'

beforeEach(() => {
  vi.clearAllMocks()
  get.mockResolvedValue({ data: { holder: null, watchers: 0, pending_takeover: null } })
  post.mockResolvedValue({ data: { ok: true } })
})

describe('ownershipApi', () => {
  it('getOwnership without a holder id omits the query and returns data', async () => {
    get.mockResolvedValue({ data: { holder: null, watchers: 4, pending_takeover: null } })

    const result = await ownershipApi.getOwnership()

    expect(get).toHaveBeenCalledWith('/workbench/ownership')
    expect(result.watchers).toBe(4)
  })

  it('getOwnership with a holder id adds the encoded query', async () => {
    await ownershipApi.getOwnership('tab 1')
    expect(get).toHaveBeenCalledWith('/workbench/ownership?holder_id=tab%201')
  })

  it('claim posts the holder id and label', async () => {
    await ownershipApi.claim('h1', 'Holder One')
    expect(post).toHaveBeenCalledWith('/workbench/ownership/claim', {
      holder_id: 'h1',
      holder_label: 'Holder One',
    })
  })

  it('heartbeat posts the holder id', async () => {
    await ownershipApi.heartbeat('h1')
    expect(post).toHaveBeenCalledWith('/workbench/ownership/heartbeat', { holder_id: 'h1' })
  })

  it('release posts the holder id', async () => {
    await ownershipApi.release('h1')
    expect(post).toHaveBeenCalledWith('/workbench/ownership/release', { holder_id: 'h1' })
  })

  it('requestTakeover posts the requester id and label', async () => {
    await ownershipApi.requestTakeover('r1', 'Requester One')
    expect(post).toHaveBeenCalledWith('/workbench/ownership/takeover', {
      requester_id: 'r1',
      requester_label: 'Requester One',
    })
  })

  it('approveTakeover posts the holder id', async () => {
    await ownershipApi.approveTakeover('h1')
    expect(post).toHaveBeenCalledWith('/workbench/ownership/takeover/approve', { holder_id: 'h1' })
  })

  it('denyTakeover posts the holder id', async () => {
    await ownershipApi.denyTakeover('h1')
    expect(post).toHaveBeenCalledWith('/workbench/ownership/takeover/deny', { holder_id: 'h1' })
  })

  it('forceTakeover posts the requester id and label', async () => {
    await ownershipApi.forceTakeover('r1', 'Requester One')
    expect(post).toHaveBeenCalledWith('/workbench/ownership/takeover/force', {
      requester_id: 'r1',
      requester_label: 'Requester One',
    })
  })

  it('cancelTakeover posts the requester id', async () => {
    await ownershipApi.cancelTakeover('r1')
    expect(post).toHaveBeenCalledWith('/workbench/ownership/takeover/cancel', { requester_id: 'r1' })
  })
})

describe('isHeldByAnother', () => {
  it('reads a conflict as the documented held-by-another answer', () => {
    expect(isHeldByAnother(Object.assign(new Error('held'), { status: 409 }))).toBe(true)
  })

  it('reads a server failure as a failure, not an answer', () => {
    expect(isHeldByAnother(Object.assign(new Error('down'), { status: 500 }))).toBe(false)
  })

  it('reads a rejection with no status as a failure', () => {
    expect(isHeldByAnother(new Error('Failed to fetch'))).toBe(false)
  })
})
