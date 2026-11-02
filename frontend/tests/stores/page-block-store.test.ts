/**
 * page-block-store - the one place that records which reads failed, who raised
 * each one, and whether a retry is in flight. A block belongs to its owner:
 * clearing one owner's read never removes another owner's, and the card names
 * every read that failed.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

import { usePageBlockStore, type PageBlockRead } from '@/stores/page-block-store'

function makeRead(overrides: Partial<PageBlockRead> = {}): PageBlockRead {
  return {
    owner: 'owner-a',
    label: 'environments',
    detail: { message: 'Internal Server Error' },
    retry: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

function currentBlock() {
  const { block } = usePageBlockStore.getState()
  if (!block) throw new Error('expected a block')
  return block
}

beforeEach(() => {
  usePageBlockStore.setState({ block: null, retrying: false, retiredOwners: new Set() })
})

describe('page-block-store', () => {
  it('starts with no block and no retry in flight', () => {
    const state = usePageBlockStore.getState()
    expect(state.block).toBeNull()
    expect(state.retrying).toBe(false)
  })

  it('names the read that failed', () => {
    const read = makeRead()
    usePageBlockStore.getState().setBlock(read)

    expect(currentBlock().title).toBe('Could not load environments')
    expect(currentBlock().reads).toEqual([read])
  })

  it('passes a single failure detail through untouched', () => {
    const read = makeRead()
    usePageBlockStore.getState().setBlock(read)

    expect(currentBlock().detail).toBe(read.detail)
  })

  it('names both reads when two of them failed', () => {
    usePageBlockStore.getState().setBlock(makeRead({ label: 'tags' }))
    usePageBlockStore.getState().setBlock(makeRead({ label: 'environments' }))

    expect(currentBlock().title).toBe('Could not load tags and environments')
  })

  it('names all three reads when three of them failed', () => {
    usePageBlockStore.getState().setBlock(makeRead({ label: 'profile types' }))
    usePageBlockStore.getState().setBlock(makeRead({ label: 'tags' }))
    usePageBlockStore.getState().setBlock(makeRead({ label: 'environments' }))

    expect(currentBlock().title).toBe('Could not load profile types, tags and environments')
  })

  it('names a read once when two owners read the same thing', () => {
    usePageBlockStore.getState().setBlock(makeRead({ owner: 'owner-a', label: 'system variables' }))
    usePageBlockStore.getState().setBlock(makeRead({ owner: 'owner-b', label: 'system variables' }))

    expect(currentBlock().title).toBe('Could not load system variables')
    expect(currentBlock().reads).toHaveLength(2)
  })

  it('lists every reason in the details, not just the first', () => {
    usePageBlockStore.getState().setBlock(
      makeRead({
        label: 'tags',
        detail: { method: 'GET', path: '/tags', status: 500, message: 'Tag store down' },
      })
    )
    usePageBlockStore
      .getState()
      .setBlock(makeRead({ label: 'environments', detail: { message: 'Network error' } }))

    expect(currentBlock().detail.message).toBe(
      ['tags', 'GET  /tags', '500', '', 'Tag store down', '', 'environments', 'Network error'].join(
        '\n'
      )
    )
  })

  it('keeps a second owner from replacing the first failure', () => {
    const first = makeRead({ owner: 'owner-a', label: 'tags' })
    const second = makeRead({ owner: 'owner-b', label: 'environments' })

    usePageBlockStore.getState().setBlock(first)
    usePageBlockStore.getState().setBlock(second)

    expect(currentBlock().reads).toEqual([first, second])
  })

  it('replaces the same read from the same owner with the newer failure, in place', () => {
    const other = makeRead({ owner: 'owner-b', label: 'environments' })
    const newer = makeRead({ owner: 'owner-a', label: 'tags', detail: { message: 'newer' } })

    usePageBlockStore.getState().setBlock(makeRead({ owner: 'owner-a', label: 'tags' }))
    usePageBlockStore.getState().setBlock(other)
    usePageBlockStore.getState().setBlock(newer)

    expect(currentBlock().reads).toEqual([newer, other])
  })

  it('treats a different read from the same owner as its own failure', () => {
    usePageBlockStore.getState().setBlock(makeRead({ owner: 'owner-a', label: 'tags' }))
    usePageBlockStore.getState().setBlock(makeRead({ owner: 'owner-a', label: 'environments' }))

    expect(currentBlock().reads).toHaveLength(2)
    expect(currentBlock().title).toBe('Could not load tags and environments')
  })

  it('clears only the reads of the owner that cleared', () => {
    const survivor = makeRead({ owner: 'owner-b', label: 'environments' })
    usePageBlockStore.getState().setBlock(makeRead({ owner: 'owner-a', label: 'tags' }))
    usePageBlockStore.getState().setBlock(survivor)

    usePageBlockStore.getState().clearBlock('owner-a')

    expect(currentBlock().reads).toEqual([survivor])
    expect(currentBlock().title).toBe('Could not load environments')
  })

  it('keeps the card up when only one of two owners of the same read succeeds', () => {
    const survivor = makeRead({ owner: 'owner-a', label: 'system variables' })
    usePageBlockStore.getState().setBlock(survivor)
    usePageBlockStore.getState().setBlock(makeRead({ owner: 'owner-b', label: 'system variables' }))

    usePageBlockStore.getState().clearBlock('owner-b')

    expect(currentBlock().reads).toEqual([survivor])
    expect(currentBlock().title).toBe('Could not load system variables')
  })

  it('clears only the named read when a label is given', () => {
    const survivor = makeRead({ owner: 'owner-a', label: 'environments' })
    usePageBlockStore.getState().setBlock(makeRead({ owner: 'owner-a', label: 'tags' }))
    usePageBlockStore.getState().setBlock(survivor)

    usePageBlockStore.getState().clearBlock('owner-a', 'tags')

    expect(currentBlock().reads).toEqual([survivor])
  })

  it('brings the page back when the last read clears', () => {
    usePageBlockStore.getState().setBlock(makeRead())
    usePageBlockStore.getState().setRetrying(true)

    usePageBlockStore.getState().clearBlock('owner-a')

    expect(usePageBlockStore.getState().block).toBeNull()
    expect(usePageBlockStore.getState().retrying).toBe(false)
  })

  it('leaves the block alone when the clearing owner raised nothing', () => {
    usePageBlockStore.getState().setBlock(makeRead({ owner: 'owner-a' }))
    const before = currentBlock()

    usePageBlockStore.getState().clearBlock('owner-b')

    expect(usePageBlockStore.getState().block).toBe(before)
  })

  it('drops every block when no owner is named', () => {
    usePageBlockStore.getState().setBlock(makeRead({ owner: 'owner-a', label: 'tags' }))
    usePageBlockStore.getState().setBlock(makeRead({ owner: 'owner-b', label: 'environments' }))
    usePageBlockStore.getState().setRetrying(true)

    usePageBlockStore.getState().clearBlock()

    expect(usePageBlockStore.getState().block).toBeNull()
    expect(usePageBlockStore.getState().retrying).toBe(false)
  })

  it('takes over a block that carries no reads of its own', () => {
    usePageBlockStore.setState({
      block: {
        title: 'Could not load something',
        detail: { message: 'seeded' },
        retry: vi.fn().mockResolvedValue(undefined),
      },
    })

    usePageBlockStore.getState().setBlock(makeRead())

    expect(currentBlock().title).toBe('Could not load environments')
    expect(currentBlock().reads).toHaveLength(1)
  })

  it('leaves a block that carries no reads alone when an owner clears', () => {
    const seeded = {
      title: 'Could not load something',
      detail: { message: 'seeded' },
      retry: vi.fn().mockResolvedValue(undefined),
    }
    usePageBlockStore.setState({ block: seeded })

    usePageBlockStore.getState().clearBlock('owner-a')

    expect(usePageBlockStore.getState().block).toBe(seeded)
  })

  it('toggles the retrying flag', () => {
    usePageBlockStore.getState().setRetrying(true)
    expect(usePageBlockStore.getState().retrying).toBe(true)
    usePageBlockStore.getState().setRetrying(false)
    expect(usePageBlockStore.getState().retrying).toBe(false)
  })

  it('setting a block leaves the retrying flag alone', () => {
    usePageBlockStore.getState().setRetrying(true)
    usePageBlockStore.getState().setBlock(makeRead())
    expect(usePageBlockStore.getState().retrying).toBe(true)
  })

  it('reruns every failed read when the block is retried', async () => {
    const tags = vi.fn().mockResolvedValue(undefined)
    const environments = vi.fn().mockResolvedValue(undefined)
    usePageBlockStore.getState().setBlock(makeRead({ label: 'tags', retry: tags }))
    usePageBlockStore.getState().setBlock(makeRead({ label: 'environments', retry: environments }))

    await currentBlock().retry()

    expect(tags).toHaveBeenCalledTimes(1)
    expect(environments).toHaveBeenCalledTimes(1)
  })

  it('reruns the others even when one read fails again, and reports the failure', async () => {
    const stillDown = new Error('Still down')
    const environments = vi.fn().mockResolvedValue(undefined)
    usePageBlockStore
      .getState()
      .setBlock(makeRead({ label: 'tags', retry: vi.fn().mockRejectedValue(stillDown) }))
    usePageBlockStore.getState().setBlock(makeRead({ label: 'environments', retry: environments }))

    await expect(currentBlock().retry()).rejects.toBe(stillDown)
    expect(environments).toHaveBeenCalledTimes(1)
  })

  it('keeps the retry callable off the stored block', async () => {
    const retry = vi.fn().mockResolvedValue(undefined)
    usePageBlockStore.getState().setBlock(makeRead({ retry }))

    await usePageBlockStore.getState().block?.retry()

    expect(retry).toHaveBeenCalledTimes(1)
  })
})

describe('owner lifecycle', () => {
  it('drops a failure reported by an owner whose surface is gone', () => {
    usePageBlockStore.getState().retireOwner('owner-a')

    usePageBlockStore.getState().setBlock(makeRead({ owner: 'owner-a' }))

    expect(usePageBlockStore.getState().block).toBeNull()
  })

  it('still takes a failure from an owner that never registered', () => {
    usePageBlockStore.getState().setBlock(makeRead({ owner: 'owner-never-seen' }))

    expect(currentBlock().title).toBe('Could not load environments')
  })

  it('retiring an owner takes its reads down and leaves the others up', () => {
    const survivor = makeRead({ owner: 'owner-b', label: 'environments' })
    usePageBlockStore.getState().setBlock(makeRead({ owner: 'owner-a', label: 'tags' }))
    usePageBlockStore.getState().setBlock(survivor)

    usePageBlockStore.getState().retireOwner('owner-a')

    expect(currentBlock().reads).toEqual([survivor])
    expect(currentBlock().title).toBe('Could not load environments')
  })

  it('retiring the last owner that raised anything brings the page back', () => {
    usePageBlockStore.getState().setBlock(makeRead({ owner: 'owner-a' }))
    usePageBlockStore.getState().setRetrying(true)

    usePageBlockStore.getState().retireOwner('owner-a')

    expect(usePageBlockStore.getState().block).toBeNull()
    expect(usePageBlockStore.getState().retrying).toBe(false)
  })

  it('retiring an owner that raised nothing leaves the card alone', () => {
    usePageBlockStore.getState().setBlock(makeRead({ owner: 'owner-a' }))
    const before = currentBlock()

    usePageBlockStore.getState().retireOwner('owner-b')

    expect(usePageBlockStore.getState().block).toBe(before)
    expect(usePageBlockStore.getState().retiredOwners.has('owner-b')).toBe(true)
  })

  it('lets a re-registered owner raise again', () => {
    usePageBlockStore.getState().retireOwner('owner-a')

    usePageBlockStore.getState().registerOwner('owner-a')
    usePageBlockStore.getState().setBlock(makeRead({ owner: 'owner-a' }))

    expect(currentBlock().title).toBe('Could not load environments')
    expect(usePageBlockStore.getState().retiredOwners.has('owner-a')).toBe(false)
  })

  it('registering an owner that was never retired changes nothing', () => {
    usePageBlockStore.getState().retireOwner('owner-a')
    const before = usePageBlockStore.getState().retiredOwners

    usePageBlockStore.getState().registerOwner('owner-b')

    expect(usePageBlockStore.getState().retiredOwners).toBe(before)
  })
})
