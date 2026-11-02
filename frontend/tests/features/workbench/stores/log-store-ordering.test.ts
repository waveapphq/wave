/**
 * Log store insertion order (RUNM-10).
 *
 * Console entries are inserted in the run's own log-sequence order rather than
 * in arrival order, so a watcher's console and the holder's console render the
 * same rows in the same order and parity checks are deterministic.
 * Ephemeral sessions carry ``sequence``; tracked runs carry a per-run ``seq``
 * that restarts at 0 for every child test, so ordering never reaches across a
 * ``run_id`` boundary. Dedupe stays keyed on the entry id.
 *
 * Store under test:
 * frontend/src/features/workbench/stores/log-store.ts
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import type { LogEntry } from '@/types/console'

async function freshStore() {
  const { useLogStore } = await import('../../../../src/features/workbench/stores/log-store')
  useLogStore.getState().clearLogs()
  return useLogStore
}

function entry(id: string, overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    id,
    timestamp: '2026-07-28T10:00:00.000Z',
    level: 'INFO',
    message: id,
    source: 'Plugin',
    ...overrides,
  }
}

function messages(entries: readonly LogEntry[]): string[] {
  return entries.map((e) => e.message)
}

afterEach(() => {
  vi.resetModules()
})

describe('log store ordering - ephemeral sequence', () => {
  it('places an out-of-order arrival at its sequence position', async () => {
    const useLogStore = await freshStore()

    useLogStore.getState().addEntry(entry('a', { message: 'line-2', sequence: 2 }))
    useLogStore.getState().addEntry(entry('b', { message: 'line-0', sequence: 0 }))
    useLogStore.getState().addEntry(entry('c', { message: 'line-1', sequence: 1 }))

    expect(messages(useLogStore.getState().entries)).toEqual(['line-0', 'line-1', 'line-2'])
  })

  it('keeps already-ordered arrivals untouched', async () => {
    const useLogStore = await freshStore()

    for (let index = 0; index < 5; index += 1) {
      useLogStore.getState().addEntry(entry(`e${index}`, { message: `line-${index}`, sequence: index }))
    }

    expect(messages(useLogStore.getState().entries)).toEqual([
      'line-0',
      'line-1',
      'line-2',
      'line-3',
      'line-4',
    ])
  })

  it('orders a batch that arrives shuffled', async () => {
    const useLogStore = await freshStore()

    useLogStore.getState().addEntries([
      entry('c', { message: 'line-2', sequence: 2 }),
      entry('a', { message: 'line-0', sequence: 0 }),
      entry('b', { message: 'line-1', sequence: 1 }),
    ])

    expect(messages(useLogStore.getState().entries)).toEqual(['line-0', 'line-1', 'line-2'])
  })

  it('slots a late arrival into an already-populated buffer', async () => {
    const useLogStore = await freshStore()
    useLogStore.getState().addEntries([
      entry('a', { message: 'line-0', sequence: 0 }),
      entry('c', { message: 'line-2', sequence: 2 }),
    ])

    useLogStore.getState().addEntry(entry('b', { message: 'line-1', sequence: 1 }))

    expect(messages(useLogStore.getState().entries)).toEqual(['line-0', 'line-1', 'line-2'])
  })
})

describe('log store ordering - tracked seq', () => {
  it('orders entries of the same run by their per-run seq', async () => {
    const useLogStore = await freshStore()

    useLogStore.getState().addEntry(entry('a', { message: 'line-2', seq: 2, run_id: 'run-1' }))
    useLogStore.getState().addEntry(entry('b', { message: 'line-0', seq: 0, run_id: 'run-1' }))
    useLogStore.getState().addEntry(entry('c', { message: 'line-1', seq: 1, run_id: 'run-1' }))

    expect(messages(useLogStore.getState().entries)).toEqual(['line-0', 'line-1', 'line-2'])
  })

  it('never reorders across a run boundary when the next run restarts at zero', async () => {
    const useLogStore = await freshStore()
    useLogStore.getState().addEntries([
      entry('a', { message: 'run1-0', seq: 0, run_id: 'run-1' }),
      entry('b', { message: 'run1-1', seq: 1, run_id: 'run-1' }),
    ])

    useLogStore.getState().addEntry(entry('c', { message: 'run2-0', seq: 0, run_id: 'run-2' }))

    expect(messages(useLogStore.getState().entries)).toEqual(['run1-0', 'run1-1', 'run2-0'])
  })

  it('still orders within the second run after a run boundary', async () => {
    const useLogStore = await freshStore()
    useLogStore.getState().addEntries([
      entry('a', { message: 'run1-0', seq: 0, run_id: 'run-1' }),
      entry('b', { message: 'run2-1', seq: 1, run_id: 'run-2' }),
    ])

    useLogStore.getState().addEntry(entry('c', { message: 'run2-0', seq: 0, run_id: 'run-2' }))

    expect(messages(useLogStore.getState().entries)).toEqual(['run1-0', 'run2-0', 'run2-1'])
  })
})

describe('log store ordering - entries without a sequence', () => {
  it('appends entries that carry no ordering key', async () => {
    const useLogStore = await freshStore()

    useLogStore.getState().addEntry(entry('a', { message: 'first' }))
    useLogStore.getState().addEntry(entry('b', { message: 'second' }))

    expect(messages(useLogStore.getState().entries)).toEqual(['first', 'second'])
  })

  it('appends an unsequenced entry after sequenced ones', async () => {
    const useLogStore = await freshStore()
    useLogStore.getState().addEntry(entry('a', { message: 'line-5', sequence: 5 }))

    useLogStore.getState().addEntry(entry('b', { message: 'no-sequence' }))

    expect(messages(useLogStore.getState().entries)).toEqual(['line-5', 'no-sequence'])
  })

  it('treats sequence zero as a real ordering key, not a missing one', async () => {
    const useLogStore = await freshStore()
    useLogStore.getState().addEntry(entry('a', { message: 'line-1', sequence: 1 }))

    useLogStore.getState().addEntry(entry('b', { message: 'line-0', sequence: 0 }))

    expect(messages(useLogStore.getState().entries)).toEqual(['line-0', 'line-1'])
  })
})

describe('log store ordering - invariants that must survive', () => {
  it('still dedupes by entry id', async () => {
    const useLogStore = await freshStore()

    useLogStore.getState().addEntry(entry('same', { message: 'line-0', sequence: 0 }))
    useLogStore.getState().addEntry(entry('same', { message: 'line-0 again', sequence: 0 }))

    expect(useLogStore.getState().entries).toHaveLength(1)
    expect(messages(useLogStore.getState().entries)).toEqual(['line-0'])
  })

  it('still dedupes a batch against what is already buffered', async () => {
    const useLogStore = await freshStore()
    useLogStore.getState().addEntry(entry('a', { message: 'line-0', sequence: 0 }))

    useLogStore.getState().addEntries([
      entry('a', { message: 'line-0 again', sequence: 0 }),
      entry('b', { message: 'line-1', sequence: 1 }),
    ])

    expect(messages(useLogStore.getState().entries)).toEqual(['line-0', 'line-1'])
  })

  it('still counts errors after an out-of-order insertion', async () => {
    const useLogStore = await freshStore()

    useLogStore.getState().addEntry(entry('a', { message: 'boom', level: 'ERROR', sequence: 2 }))
    useLogStore.getState().addEntry(entry('b', { message: 'quiet', sequence: 0 }))
    useLogStore.getState().addEntry(entry('c', { message: 'fatal', level: 'FATAL', sequence: 1 }))

    expect(useLogStore.getState().errorCount).toBe(2)
  })

  it('still filters by level after reordering', async () => {
    const useLogStore = await freshStore()
    useLogStore.getState().addEntry(entry('a', { message: 'debug', level: 'DEBUG', sequence: 1 }))
    useLogStore.getState().addEntry(entry('b', { message: 'error', level: 'ERROR', sequence: 0 }))

    expect(messages(useLogStore.getState().getFilteredEntries())).toEqual(['error'])
  })

  it('clearing the buffer resets ordering state', async () => {
    const useLogStore = await freshStore()
    useLogStore.getState().addEntry(entry('a', { message: 'line-9', sequence: 9 }))

    useLogStore.getState().clearLogs()
    useLogStore.getState().addEntry(entry('b', { message: 'line-0', sequence: 0 }))

    expect(messages(useLogStore.getState().entries)).toEqual(['line-0'])
  })

  it('prepending history stays a prepend, not a re-sort', async () => {
    const useLogStore = await freshStore()
    useLogStore.getState().addEntry(entry('live', { message: 'live-0', sequence: 0 }))

    useLogStore.getState().prependHistoricalEntries([
      entry('old-1', { message: 'old-1', sequence: 41 }),
      entry('old-2', { message: 'old-2', sequence: 42 }),
    ])

    expect(messages(useLogStore.getState().entries)).toEqual(['old-1', 'old-2', 'live-0'])
  })
})

// The store looks for an arriving line's slot by walking back from the tail,
// because a line that belongs at the end is by far the common case. These
// pin the walk to the same answer a walk from index 0 gives, including the
// cases where two lines cannot be separated at all.

function at(second: number): string {
  return `2026-07-28T10:00:${String(second).padStart(2, '0')}.000Z`
}

function referenceValue(candidate: LogEntry): number | undefined {
  return candidate.run_id === undefined ? candidate.sequence : candidate.seq
}

/** The insertion the store used before the walk was reversed: first slot from index 0. */
function referenceSortsAfter(existing: LogEntry, arriving: LogEntry): boolean {
  const existingTime = Date.parse(existing.timestamp)
  const arrivingTime = Date.parse(arriving.timestamp)
  if (
    !Number.isNaN(existingTime) &&
    !Number.isNaN(arrivingTime) &&
    existingTime !== arrivingTime
  ) {
    return existingTime > arrivingTime
  }
  if (existing.run_id !== arriving.run_id) {
    return false
  }
  const existingValue = referenceValue(existing)
  const arrivingValue = referenceValue(arriving)
  return existingValue !== undefined && arrivingValue !== undefined && existingValue > arrivingValue
}

function referenceInsert(held: LogEntry[], arriving: LogEntry): LogEntry[] {
  const index = held.findIndex((existing) => referenceSortsAfter(existing, arriving))
  if (index === -1) {
    return [...held, arriving]
  }
  return [...held.slice(0, index), arriving, ...held.slice(index)]
}

function referenceOrder(arrivals: LogEntry[], held: LogEntry[] = []): string[] {
  return messages(arrivals.reduce((ordered, arriving) => referenceInsert(ordered, arriving), held))
}

function randomFrom(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return state / 4294967296
  }
}

function arrivalSequence(seed: number, count: number, readableOnly: boolean): LogEntry[] {
  const next = randomFrom(seed)
  const arrivals: LogEntry[] = []
  for (let n = 0; n < count; n += 1) {
    const readable = readableOnly || next() > 0.2
    const run = ['run-a', 'run-b', ''][Math.floor(next() * 3)]
    const counter = next() > 0.2 ? Math.floor(next() * 4) : undefined
    const base: LogEntry = {
      id: `r${n}`,
      timestamp: readable ? at(Math.floor(next() * 4)) : 'not-a-timestamp',
      level: 'INFO',
      message: `r${n}`,
      source: 'Plugin',
    }
    arrivals.push(run === '' ? { ...base, sequence: counter } : { ...base, run_id: run, seq: counter })
  }
  return arrivals
}

describe('log store ordering - the walk back from the tail', () => {
  it('appends a line that belongs after everything held', async () => {
    const useLogStore = await freshStore()
    useLogStore.getState().addEntries([
      entry('a', { message: 'first', timestamp: at(1) }),
      entry('b', { message: 'second', timestamp: at(2) }),
    ])

    useLogStore.getState().addEntry(entry('c', { message: 'third', timestamp: at(3) }))

    expect(messages(useLogStore.getState().entries)).toEqual(['first', 'second', 'third'])
  })

  it('slots a line that belongs in the middle', async () => {
    const useLogStore = await freshStore()
    useLogStore.getState().addEntries([
      entry('a', { message: 'first', timestamp: at(1) }),
      entry('c', { message: 'third', timestamp: at(3) }),
    ])

    useLogStore.getState().addEntry(entry('b', { message: 'second', timestamp: at(2) }))

    expect(messages(useLogStore.getState().entries)).toEqual(['first', 'second', 'third'])
  })

  it('slots a line that belongs at the very front', async () => {
    const useLogStore = await freshStore()
    useLogStore.getState().addEntries([
      entry('b', { message: 'second', timestamp: at(2) }),
      entry('c', { message: 'third', timestamp: at(3) }),
    ])

    useLogStore.getState().addEntry(entry('a', { message: 'first', timestamp: at(1) }))

    expect(messages(useLogStore.getState().entries)).toEqual(['first', 'second', 'third'])
  })

  it('inserts into an empty buffer', async () => {
    const useLogStore = await freshStore()

    useLogStore.getState().addEntry(entry('a', { message: 'only', timestamp: at(1) }))

    expect(messages(useLogStore.getState().entries)).toEqual(['only'])
  })

  it('places a line either side of a single held line', async () => {
    const useLogStore = await freshStore()
    useLogStore.getState().addEntry(entry('b', { message: 'held', timestamp: at(2) }))
    useLogStore.getState().addEntry(entry('a', { message: 'before', timestamp: at(1) }))
    useLogStore.getState().addEntry(entry('c', { message: 'after', timestamp: at(3) }))

    expect(messages(useLogStore.getState().entries)).toEqual(['before', 'held', 'after'])
  })

  it('leaves a line that cannot be separated from the tail behind it', async () => {
    const useLogStore = await freshStore()
    const arrivals = [
      entry('a', { message: 'first', timestamp: at(1), sequence: 3 }),
      entry('b', { message: 'second', timestamp: at(1), sequence: 3 }),
    ]
    for (const arriving of arrivals) {
      useLogStore.getState().addEntry(arriving)
    }

    expect(messages(useLogStore.getState().entries)).toEqual(referenceOrder(arrivals))
    expect(messages(useLogStore.getState().entries)).toEqual(['first', 'second'])
  })

  it('walks past lines it cannot separate to reach one that must come later', async () => {
    // The tail belongs to another run at the same instant, so it says nothing
    // about where the arrival goes; the line before it does.
    const useLogStore = await freshStore()
    const arrivals = [
      entry('tracked', { message: 'tracked-9', timestamp: at(1), run_id: 'run-a', seq: 9 }),
      entry('ephemeral', { message: 'ephemeral-0', timestamp: at(1), sequence: 0 }),
      entry('later', { message: 'tracked-5', timestamp: at(1), run_id: 'run-a', seq: 5 }),
    ]
    for (const arriving of arrivals) {
      useLogStore.getState().addEntry(arriving)
    }

    expect(messages(useLogStore.getState().entries)).toEqual(referenceOrder(arrivals))
    expect(messages(useLogStore.getState().entries)).toEqual([
      'tracked-5',
      'tracked-9',
      'ephemeral-0',
    ])
  })

  it('scans the whole buffer when the arriving timestamp cannot be read', async () => {
    const useLogStore = await freshStore()
    useLogStore.getState().addEntries([
      entry('a', { message: 'first', timestamp: at(1), sequence: 0 }),
      entry('b', { message: 'third', timestamp: at(2), sequence: 9 }),
    ])

    useLogStore
      .getState()
      .addEntry(entry('c', { message: 'second', timestamp: 'not-a-timestamp', sequence: 5 }))

    expect(messages(useLogStore.getState().entries)).toEqual(['first', 'second', 'third'])
  })

  it('scans the whole buffer when a held timestamp cannot be read', async () => {
    const useLogStore = await freshStore()
    useLogStore.setState({
      entries: [
        entry('unreadable', { message: 'unreadable-9', timestamp: 'not-a-timestamp', sequence: 9 }),
        entry('readable', { message: 'readable-0', timestamp: at(1), sequence: 0 }),
      ],
      errorCount: 0,
    })

    useLogStore.getState().addEntry(entry('c', { message: 'arriving-5', timestamp: at(2), sequence: 5 }))

    expect(messages(useLogStore.getState().entries)).toEqual([
      'arriving-5',
      'unreadable-9',
      'readable-0',
    ])
  })

  it('scans the whole buffer when held lines are not in time order', async () => {
    const useLogStore = await freshStore()
    useLogStore.setState({
      entries: [
        entry('late', { message: 'late', timestamp: at(3) }),
        entry('early', { message: 'early', timestamp: at(1) }),
      ],
      errorCount: 0,
    })

    useLogStore.getState().addEntry(entry('mid', { message: 'mid', timestamp: at(2) }))

    expect(messages(useLogStore.getState().entries)).toEqual(['mid', 'late', 'early'])
  })

  it('scans the whole buffer after a history page lands out of time order', async () => {
    const useLogStore = await freshStore()
    useLogStore.getState().addEntry(entry('live', { message: 'live', timestamp: at(5) }))

    useLogStore
      .getState()
      .prependHistoricalEntries([entry('page', { message: 'page', timestamp: at(9) })])
    useLogStore.getState().addEntry(entry('mid', { message: 'mid', timestamp: at(7) }))

    expect(messages(useLogStore.getState().entries)).toEqual(['mid', 'page', 'live'])
  })

  it('keeps walking back from the tail after a history page lands in time order', async () => {
    const useLogStore = await freshStore()
    useLogStore.getState().addEntry(entry('live', { message: 'live', timestamp: at(5) }))

    useLogStore
      .getState()
      .prependHistoricalEntries([entry('page', { message: 'page', timestamp: at(1) })])
    useLogStore.getState().addEntry(entry('next', { message: 'next', timestamp: at(7) }))

    expect(messages(useLogStore.getState().entries)).toEqual(['page', 'live', 'next'])
  })

  it('matches a scan from index 0 for every shuffled arrival sequence', async () => {
    const useLogStore = await freshStore()

    for (let seed = 1; seed <= 40; seed += 1) {
      const readableOnly = seed % 2 === 0
      const arrivals = arrivalSequence(seed, 20, readableOnly)
      useLogStore.getState().clearLogs()
      for (const arriving of arrivals) {
        useLogStore.getState().addEntry(arriving)
      }

      expect(messages(useLogStore.getState().entries)).toEqual(referenceOrder(arrivals))
    }
  })

  it('matches a scan from index 0 when a shuffled sequence arrives as one batch', async () => {
    const useLogStore = await freshStore()

    for (let seed = 101; seed <= 140; seed += 1) {
      const readableOnly = seed % 2 === 0
      const arrivals = arrivalSequence(seed, 20, readableOnly)
      useLogStore.getState().clearLogs()
      useLogStore.getState().addEntries(arrivals)

      expect(messages(useLogStore.getState().entries)).toEqual(referenceOrder(arrivals))
    }
  })

  it('matches a scan from index 0 when a shuffled batch lands on top of held lines', async () => {
    const useLogStore = await freshStore()

    for (let seed = 201; seed <= 240; seed += 1) {
      const held = arrivalSequence(seed, 8, seed % 2 === 0)
      const arrivals = arrivalSequence(seed + 1000, 12, seed % 2 === 0).map((arriving) => ({
        ...arriving,
        id: `${arriving.id}-late`,
      }))
      useLogStore.getState().clearLogs()
      useLogStore.getState().addEntries(held)
      useLogStore.getState().addEntries(arrivals)

      const expected = referenceOrder(
        arrivals,
        held.reduce((ordered, arriving) => referenceInsert(ordered, arriving), [] as LogEntry[]),
      )
      expect(messages(useLogStore.getState().entries)).toEqual(expected)
    }
  })
})
