/**
 * Reads whose failure blocks the surface that started them. A failed read is
 * never substituted with a default, and a reason a primary failure hid is never
 * shown later: the read is run again, so every reason on the card is current.
 */

import { useEffect, useMemo, useRef } from 'react'
import { usePageBlock } from '@/hooks/use-page-block'
import { toFailureDetail } from '@/lib/failure-detail'
import type { FailedRead } from '@/stores/page-block-store'

export interface BlockingRead {
  /** What did not load, e.g. 'tags'. Unique within a surface; `FailedRead.label` states how it is worded. */
  label: string
  run: () => Promise<void>
  /** True once the caller no longer wants this read reported. */
  canceled?: () => boolean
}

/** Hands one failed read to the surface it blocks. */
export type ReportFailedRead = (failure: FailedRead) => void

/** Runs the read, reporting this attempt's own reason. Rejects with that reason
 *  so a Try Again knows the read is still failing. */
export async function runBlockingRead(
  read: BlockingRead,
  report: ReportFailedRead
): Promise<void> {
  try {
    await read.run()
  } catch (error_) {
    if (read.canceled?.() !== true) {
      report({
        label: read.label,
        detail: toFailureDetail(error_),
        retry: () => runBlockingRead(read, report),
      })
    }
    throw error_
  }
}

/** Starts a read nobody awaits; the report is its only outcome. */
export function startBlockingRead(read: BlockingRead, report: ReportFailedRead): void {
  void runBlockingRead(read, report).catch(() => {})
}

/** How the surface's own records read ended. */
export type PrimaryState = 'pending' | 'loaded' | 'failed'

export interface BlockingReads {
  /** Runs the reads concurrently. Never rejects. */
  load: (reads: readonly BlockingRead[]) => Promise<void>
  /** Starts the reads; each reports its own failure, so there is no outcome to await. */
  start: (reads: readonly BlockingRead[]) => void
}

interface BlockingReadsInternal extends BlockingReads {
  primaryChanged: (primary: PrimaryState) => void
}

interface FailedEntry {
  read: BlockingRead
  /** A failure not shown yet because the primary read had not settled. */
  withheld?: FailedRead
}

export function useBlockingReads(primary: PrimaryState): BlockingReads {
  const { blockPage, clearPageBlock } = usePageBlock()
  const primaryRef = useRef<PrimaryState>(primary)
  const failedRef = useRef(new Map<string, FailedEntry>())

  const api = useMemo<BlockingReadsInternal>(() => {
    function clearOnSuccess(read: BlockingRead): BlockingRead {
      return {
        label: read.label,
        canceled: read.canceled,
        run: async () => {
          await read.run()
          failedRef.current.delete(read.label)
          clearPageBlock(read.label)
        },
      }
    }

    function reportTo(read: BlockingRead): ReportFailedRead {
      return (failure) => {
        const state = primaryRef.current
        failedRef.current.set(read.label, {
          read,
          withheld: state === 'pending' ? failure : undefined,
        })
        if (state === 'loaded') blockPage(failure)
      }
    }

    function runOne(read: BlockingRead): Promise<void> {
      failedRef.current.delete(read.label)
      return runBlockingRead(clearOnSuccess(read), reportTo(read))
    }

    async function load(reads: readonly BlockingRead[]): Promise<void> {
      await Promise.allSettled(reads.map((read) => runOne(read)))
    }

    function start(reads: readonly BlockingRead[]): void {
      for (const read of reads) {
        failedRef.current.delete(read.label)
        startBlockingRead(clearOnSuccess(read), reportTo(read))
      }
    }

    function primaryFailed(): void {
      // The surface owns the failure now, so the reasons it hides are dropped:
      // the reads are kept and run again if it recovers.
      clearPageBlock()
      for (const entry of failedRef.current.values()) entry.withheld = undefined
    }

    function primaryLoaded(): void {
      const rerun: BlockingRead[] = []
      for (const entry of failedRef.current.values()) {
        if (entry.withheld === undefined) {
          rerun.push(entry.read)
          continue
        }
        blockPage(entry.withheld)
        entry.withheld = undefined
      }
      start(rerun)
    }

    function primaryChanged(next: PrimaryState): void {
      primaryRef.current = next
      if (next === 'failed') primaryFailed()
      else if (next === 'loaded') primaryLoaded()
    }

    return { load, start, primaryChanged }
  }, [blockPage, clearPageBlock])

  useEffect(() => {
    if (primaryRef.current !== primary) api.primaryChanged(primary)
  }, [api, primary])

  return api
}
