/**
 * Every read that failed, keyed by the surface that raised it. One card is
 * composed over all of them, so clearing one owner's read never removes
 * another owner's.
 */

import { create } from 'zustand'
import { formatFailureDetail, type FailureDetail } from '@/lib/failure-detail'
import { joinLabels } from '@/lib/join-labels'

/** One failed read, as its owner reports it. */
export interface FailedRead {
  /** What did not load, e.g. 'environments'. Joined into the title, so it takes
   *  no leading article and no leading capital unless it is a product noun. */
  label: string
  detail: FailureDetail
  /** Re-runs ONLY this read. Resolves on success, rejects on failure. */
  retry: () => Promise<void>
}

/** A failed read once the store knows who raised it. Keyed by owner plus label. */
export interface PageBlockRead extends FailedRead {
  owner: string
}

/** What the card shows: composed over every failed read currently raised. */
export interface PageBlock {
  /** Names every read that failed, e.g. 'Could not load tags and environments'. */
  title: string
  detail: FailureDetail
  /** Re-runs every failed read. Rejects if any of them fails again. */
  retry: () => Promise<void>
  reads?: PageBlockRead[]
}

interface PageBlockState {
  block: PageBlock | null
  retrying: boolean
  /** Owners whose surface is gone; a retired owner's report is dropped. */
  retiredOwners: ReadonlySet<string>
  setBlock: (read: PageBlockRead) => void
  /** No owner clears every block; an owner clears its own, or one of its reads. */
  clearBlock: (owner?: string, label?: string) => void
  setRetrying: (retrying: boolean) => void
  registerOwner: (owner: string) => void
  retireOwner: (owner: string) => void
}

function composeTitle(reads: PageBlockRead[]): string {
  return `Could not load ${joinLabels([...new Set(reads.map((read) => read.label))])}`
}

function composeDetail(reads: PageBlockRead[]): FailureDetail {
  if (reads.length === 1) return reads[0].detail
  return {
    message: reads
      .map((read) => `${read.label}\n${formatFailureDetail(read.detail)}`)
      .join('\n\n'),
  }
}

async function retryAll(reads: PageBlockRead[]): Promise<void> {
  const results = await Promise.allSettled(reads.map((read) => read.retry()))
  const failed = results.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected'
  )
  if (failed) throw failed.reason
}

function compose(reads: PageBlockRead[]): PageBlock | null {
  if (reads.length === 0) return null
  return {
    title: composeTitle(reads),
    detail: composeDetail(reads),
    retry: () => retryAll(reads),
    reads,
  }
}

export const usePageBlockStore = create<PageBlockState>()((setState) => ({
  block: null,
  retrying: false,
  retiredOwners: new Set<string>(),

  setBlock: (read) =>
    setState((state) => {
      if (state.retiredOwners.has(read.owner)) return state
      const reads = state.block?.reads ?? []
      const index = reads.findIndex(
        (entry) => entry.owner === read.owner && entry.label === read.label
      )
      const next =
        index === -1 ? [...reads, read] : reads.map((entry, at) => (at === index ? read : entry))
      return { block: compose(next) }
    }),

  clearBlock: (owner, label) =>
    setState((state) => {
      if (owner === undefined) return { block: null, retrying: false }
      const reads = state.block?.reads ?? []
      const remaining = reads.filter(
        (entry) => entry.owner !== owner || (label !== undefined && entry.label !== label)
      )
      if (remaining.length === reads.length) return state
      const block = compose(remaining)
      return block === null ? { block, retrying: false } : { block }
    }),

  setRetrying: (retrying) => setState({ retrying }),

  // Only a provably retired owner is dropped, so an owner that never registered still reports.
  registerOwner: (owner) =>
    setState((state) => {
      if (!state.retiredOwners.has(owner)) return state
      const retiredOwners = new Set(state.retiredOwners)
      retiredOwners.delete(owner)
      return { retiredOwners }
    }),

  retireOwner: (owner) =>
    setState((state) => {
      const retiredOwners = new Set(state.retiredOwners).add(owner)
      const reads = state.block?.reads ?? []
      const remaining = reads.filter((entry) => entry.owner !== owner)
      if (remaining.length === reads.length) return { retiredOwners }
      const block = compose(remaining)
      return block === null ? { retiredOwners, block, retrying: false } : { retiredOwners, block }
    }),
}))
