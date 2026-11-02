/**
 * Log Store Tests - REQ-3.4.2.7, REQ-3.7.2.5, REQ-3.7.2.6, REQ-3.7.2.8, REQ-5.2.1.4
 *
 * Tests for the log state management store that tracks execution logs,
 * level filtering, pagination, and real-time streaming.
 *
 * Contract:
 * - Console panel displays streaming log output during workflow execution
 * - Log entries are categorized by severity level (DEBUG, INFO, WARN, ERROR, FATAL)
 * - Filter logs by minimum level (shows selected level and above)
 * - 10,000 entry display cap with FIFO eviction
 * - Virtualized rendering for performance
 * - WebSocket integration for real-time streaming
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// Log level type for tests
type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL'

// Log entry structure (REQ-3.7.2.5)
interface LogEntry {
  id: string
  timestamp: string
  level: LogLevel
  message: string
  source: string
  blockId?: string
  // Absent on a payload that carries no counter at all.
  sequence?: number
  // Tracked-execution shape: a per-run counter plus its owning run.
  seq?: number
  run_id?: string
}

// Local test constants matching production values (these are module-private in log-store.ts)
const MAX_DISPLAY_ENTRIES = 10000
const PAGE_SIZE = 100
const LOG_LEVEL_HIERARCHY: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  FATAL: 4,
}

describe('Log Store', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-01-22T10:30:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
    vi.resetModules()
  })

  describe('Initial State', () => {
    it('starts with empty entries array', async () => {
      const { useLogStore } = await import('../../../../src/features/workbench/stores/log-store')
      const state = useLogStore.getState()

      expect(state.entries).toEqual([])
    })

    it('starts with INFO as default minimum level', async () => {
      const { useLogStore } = await import('../../../../src/features/workbench/stores/log-store')
      const state = useLogStore.getState()

      expect(state.minLevel).toBe('INFO')
    })

    it('starts with no session ID', async () => {
      const { useLogStore } = await import('../../../../src/features/workbench/stores/log-store')
      const state = useLogStore.getState()

      expect(state.sessionId).toBeNull()
    })

    it('starts with error filter disabled', async () => {
      const { useLogStore } = await import('../../../../src/features/workbench/stores/log-store')
      const state = useLogStore.getState()

      expect(state.errorFilterActive).toBe(false)
    })

    it('starts with pagination state (no history assumed until backend confirms)', async () => {
      const { useLogStore } = await import('../../../../src/features/workbench/stores/log-store')
      const state = useLogStore.getState()

      expect(state.pagination).toEqual({
        isLoading: false,
        hasMore: false, // Backend will set to true if there's historical data
        cursor: null,
      })
    })

    it('starts with zero error count', async () => {
      const { useLogStore } = await import('../../../../src/features/workbench/stores/log-store')
      const state = useLogStore.getState()

      expect(state.errorCount).toBe(0)
    })

    it('starts with auto-scroll enabled', async () => {
      const { useLogStore } = await import('../../../../src/features/workbench/stores/log-store')
      const state = useLogStore.getState()

      expect(state.autoScrollEnabled).toBe(true)
    })
  })

  describe('addEntry - Real-time Log Addition (REQ-5.2.1.4)', () => {
    it('adds log entry to entries array', async () => {
      const { useLogStore } = await import('../../../../src/features/workbench/stores/log-store')
      useLogStore.setState({ entries: [], errorCount: 0 })

      const entry: LogEntry = {
        id: 'log-1',
        timestamp: '2025-01-22T10:30:45.123Z',
        level: 'INFO',
        message: 'Test message',
        source: 'HTTP Client',
        sequence: 1,
      }

      useLogStore.getState().addEntry(entry)

      expect(useLogStore.getState().entries).toHaveLength(1)
      expect(useLogStore.getState().entries[0]).toEqual(entry)
    })

    it('appends new entries to the end (real-time at bottom)', async () => {
      const { useLogStore } = await import('../../../../src/features/workbench/stores/log-store')
      useLogStore.setState({ entries: [], errorCount: 0 })

      const entry1: LogEntry = {
        id: 'log-1',
        timestamp: '2025-01-22T10:30:45.123Z',
        level: 'INFO',
        message: 'First message',
        source: 'Source A',
        sequence: 1,
      }

      const entry2: LogEntry = {
        id: 'log-2',
        timestamp: '2025-01-22T10:30:46.000Z',
        level: 'INFO',
        message: 'Second message',
        source: 'Source B',
        sequence: 2,
      }

      useLogStore.getState().addEntry(entry1)
      useLogStore.getState().addEntry(entry2)

      const entries = useLogStore.getState().entries
      expect(entries[0].id).toBe('log-1')
      expect(entries[1].id).toBe('log-2')
    })

    it('increments error count for ERROR level entries', async () => {
      const { useLogStore } = await import('../../../../src/features/workbench/stores/log-store')
      useLogStore.setState({ entries: [], errorCount: 0 })

      const entry: LogEntry = {
        id: 'log-1',
        timestamp: '2025-01-22T10:30:45.123Z',
        level: 'ERROR',
        message: 'Error occurred',
        source: 'Assert',
        sequence: 1,
      }

      useLogStore.getState().addEntry(entry)

      expect(useLogStore.getState().errorCount).toBe(1)
    })

    it('increments error count for FATAL level entries', async () => {
      const { useLogStore } = await import('../../../../src/features/workbench/stores/log-store')
      useLogStore.setState({ entries: [], errorCount: 0 })

      const entry: LogEntry = {
        id: 'log-1',
        timestamp: '2025-01-22T10:30:45.123Z',
        level: 'FATAL',
        message: 'Fatal error',
        source: 'System',
        sequence: 1,
      }

      useLogStore.getState().addEntry(entry)

      expect(useLogStore.getState().errorCount).toBe(1)
    })

    it('does not increment error count for non-error levels', async () => {
      const { useLogStore } = await import('../../../../src/features/workbench/stores/log-store')
      useLogStore.setState({ entries: [], errorCount: 0 })

      const levels: LogLevel[] = ['DEBUG', 'INFO', 'WARN']
      let sequence = 1

      for (const level of levels) {
        useLogStore.getState().addEntry({
          id: `log-${sequence}`,
          timestamp: '2025-01-22T10:30:45.123Z',
          level,
          message: `${level} message`,
          source: 'Test',
          sequence: sequence++,
        })
      }

      expect(useLogStore.getState().errorCount).toBe(0)
    })

    it('deduplicates entries by id (UUID), not by sequence', async () => {
      // Tracked executions restart seq=0 for every child test, so the
      // store dedupes by entry.id (UUID) - not by the per-file sequence
      // number. Two entries that share a sequence but have distinct ids
      // represent different log lines (e.g., two different child runs)
      // and must both survive.
      const { useLogStore } = await import('../../../../src/features/workbench/stores/log-store')
      useLogStore.setState({ entries: [], errorCount: 0 })

      const entry: LogEntry = {
        id: 'log-1',
        timestamp: '2025-01-22T10:30:45.123Z',
        level: 'INFO',
        message: 'Duplicate test',
        source: 'Test',
        sequence: 1,
      }

      // Same id -> deduped to a single entry.
      useLogStore.getState().addEntry(entry)
      useLogStore.getState().addEntry({ ...entry })
      expect(useLogStore.getState().entries).toHaveLength(1)

      // Different id, same sequence -> both kept.
      useLogStore.getState().addEntry({ ...entry, id: 'log-1-other' })
      expect(useLogStore.getState().entries).toHaveLength(2)
    })
  })

  describe('Console ordering across runs', () => {
    // Every workbench run gets a fresh session, and each session restarts its
    // own sequence at 0. Ordering the console on that counter alone shuffled
    // the lines of consecutive runs together: every run's first line, then
    // every run's second line, and so on.
    const line = (
      id: string,
      timestamp: string,
      message: string,
      sequence: number,
      extra: Partial<LogEntry> = {},
    ): LogEntry => ({
      id,
      timestamp,
      level: 'INFO',
      message,
      source: 'SYSTEM',
      sequence,
      ...extra,
    })

    const run = (label: string, minuteSecond: string) => [
      line(`${label}-0`, `2026-08-01T18:${minuteSecond}.100Z`, `${label} started`, 0),
      line(`${label}-1`, `2026-08-01T18:${minuteSecond}.200Z`, `${label} waiting`, 1),
      line(`${label}-2`, `2026-08-01T18:${minuteSecond}.300Z`, `${label} gave up`, 2),
    ]

    const messagesAfter = async (entries: LogEntry[]) => {
      const { useLogStore } = await import('../../../../src/features/workbench/stores/log-store')
      useLogStore.setState({ entries: [], errorCount: 0 })
      for (const entry of entries) {
        useLogStore.getState().addEntry(entry)
      }
      return useLogStore.getState().entries.map((e) => e.message)
    }

    it('keeps a second run below the first instead of interleaving it', async () => {
      const first = run('run-a', '49:46')
      const second = run('run-b', '50:01')

      expect(await messagesAfter([...first, ...second])).toEqual([
        'run-a started',
        'run-a waiting',
        'run-a gave up',
        'run-b started',
        'run-b waiting',
        'run-b gave up',
      ])
    })

    it('keeps three runs in the order they happened', async () => {
      const entries = [...run('run-a', '49:46'), ...run('run-b', '50:01'), ...run('run-c', '50:12')]

      expect(await messagesAfter(entries)).toEqual([
        'run-a started',
        'run-a waiting',
        'run-a gave up',
        'run-b started',
        'run-b waiting',
        'run-b gave up',
        'run-c started',
        'run-c waiting',
        'run-c gave up',
      ])
    })

    it('places a late-arriving older line back where it belongs', async () => {
      // A backfill page can arrive after live lines from a newer run.
      const second = run('run-b', '50:01')
      const first = run('run-a', '49:46')

      expect(await messagesAfter([...second, ...first])).toEqual([
        'run-a started',
        'run-a waiting',
        'run-a gave up',
        'run-b started',
        'run-b waiting',
        'run-b gave up',
      ])
    })

    it('falls back to the sequence for lines that share an instant', async () => {
      const stamp = '2026-08-01T18:49:46.100Z'
      const entries = [
        line('same-2', stamp, 'third', 2),
        line('same-0', stamp, 'first', 0),
        line('same-1', stamp, 'second', 1),
      ]

      expect(await messagesAfter(entries)).toEqual(['first', 'second', 'third'])
    })

    it('orders tracked run entries by time before their per-run seq', async () => {
      const entries = [
        line('t-b0', '2026-08-01T18:50:01.100Z', 'run b first', 0, { run_id: 'run-b', seq: 0 }),
        line('t-a0', '2026-08-01T18:49:46.100Z', 'run a first', 0, { run_id: 'run-a', seq: 0 }),
        line('t-a1', '2026-08-01T18:49:46.200Z', 'run a second', 0, { run_id: 'run-a', seq: 1 }),
      ]

      expect(await messagesAfter(entries)).toEqual(['run a first', 'run a second', 'run b first'])
    })

    it('keeps arrival order when the timestamps cannot be read', async () => {
      const entries = [
        line('bad-0', 'not-a-timestamp', 'first', 0),
        line('bad-1', 'not-a-timestamp', 'second', 1),
      ]

      expect(await messagesAfter(entries)).toEqual(['first', 'second'])
    })

    it('keeps a line with an unreadable timestamp where it arrived', async () => {
      const entries = [
        line('good', '2026-08-01T18:49:46.100Z', 'readable', 0),
        line('bad', 'not-a-timestamp', 'unreadable', 1),
      ]

      expect(await messagesAfter(entries)).toEqual(['readable', 'unreadable'])
    })

    it('keeps arrival order for same-instant lines that carry no counter', async () => {
      const stamp = '2026-08-01T18:49:46.100Z'
      const entries = [
        { id: 'n-0', timestamp: stamp, level: 'INFO' as const, message: 'first', source: 'SYSTEM' },
        { id: 'n-1', timestamp: stamp, level: 'INFO' as const, message: 'second', source: 'SYSTEM' },
      ]

      expect(await messagesAfter(entries)).toEqual(['first', 'second'])
    })

    it('falls back to the per-run seq for tracked lines that share an instant', async () => {
      const stamp = '2026-08-01T18:49:46.100Z'
      const entries = [
        line('t-1', stamp, 'second', 0, { run_id: 'run-a', seq: 1 }),
        line('t-0', stamp, 'first', 0, { run_id: 'run-a', seq: 0 }),
      ]

      expect(await messagesAfter(entries)).toEqual(['first', 'second'])
    })

    it('never compares counters across two different runs at one instant', async () => {
      // A tracked run's seq and an ephemeral session's sequence are separate
      // counters; sharing a millisecond does not make them comparable.
      const stamp = '2026-08-01T18:49:46.100Z'
      const entries = [
        line('tracked', stamp, 'tracked line', 0, { run_id: 'run-a', seq: 9 }),
        line('ephemeral', stamp, 'ephemeral line', 0),
      ]

      expect(await messagesAfter(entries)).toEqual(['tracked line', 'ephemeral line'])
    })

    it('orders a batch the same way as one-by-one arrival', async () => {
      const { useLogStore } = await import('../../../../src/features/workbench/stores/log-store')
      useLogStore.setState({ entries: [], errorCount: 0 })

      useLogStore.getState().addEntries([...run('run-b', '50:01'), ...run('run-a', '49:46')])

      expect(useLogStore.getState().entries.map((e) => e.message)).toEqual([
        'run-a started',
        'run-a waiting',
        'run-a gave up',
        'run-b started',
        'run-b waiting',
        'run-b gave up',
      ])
    })
  })

  describe('Buffer Management - 10K Display Cap (REQ-3.7.2.8)', () => {
    it('enforces 10,000 entry display cap', async () => {
      const { useLogStore } = await import('../../../../src/features/workbench/stores/log-store')
      useLogStore.setState({ entries: [], errorCount: 0 })

      expect(MAX_DISPLAY_ENTRIES).toBe(10000)
    })

    it('evicts oldest entries when cap is exceeded (FIFO)', async () => {
      const { useLogStore } = await import('../../../../src/features/workbench/stores/log-store')

      // Pre-populate with max entries
      const initialEntries: LogEntry[] = []
      for (let i = 0; i < MAX_DISPLAY_ENTRIES; i++) {
        initialEntries.push({
          id: `log-${i}`,
          timestamp: `2025-01-22T10:30:${String(i % 60).padStart(2, '0')}.000Z`,
          level: 'INFO',
          message: `Message ${i}`,
          source: 'Test',
          sequence: i,
        })
      }
      useLogStore.setState({ entries: initialEntries, errorCount: 0 })

      // Add one more entry
      useLogStore.getState().addEntry({
        id: 'log-new',
        timestamp: '2025-01-22T10:31:00.000Z',
        level: 'INFO',
        message: 'New message',
        source: 'Test',
        sequence: MAX_DISPLAY_ENTRIES,
      })

      const entries = useLogStore.getState().entries
      expect(entries).toHaveLength(MAX_DISPLAY_ENTRIES)
      expect(entries[0].id).toBe('log-1') // log-0 was evicted
      expect(entries[entries.length - 1].id).toBe('log-new')
    })

    it('decrements error count when evicting error entries', async () => {
      const { useLogStore } = await import('../../../../src/features/workbench/stores/log-store')

      // Create entries with first one being an error
      const initialEntries: LogEntry[] = [
        {
          id: 'log-0',
          timestamp: '2025-01-22T10:30:00.000Z',
          level: 'ERROR',
          message: 'Error to be evicted',
          source: 'Test',
          sequence: 0,
        },
      ]
      for (let i = 1; i < MAX_DISPLAY_ENTRIES; i++) {
        initialEntries.push({
          id: `log-${i}`,
          timestamp: `2025-01-22T10:30:${String(i % 60).padStart(2, '0')}.000Z`,
          level: 'INFO',
          message: `Message ${i}`,
          source: 'Test',
          sequence: i,
        })
      }
      useLogStore.setState({ entries: initialEntries, errorCount: 1 })

      // Add new entry to trigger eviction
      useLogStore.getState().addEntry({
        id: 'log-new',
        timestamp: '2025-01-22T10:31:00.000Z',
        level: 'INFO',
        message: 'New message',
        source: 'Test',
        sequence: MAX_DISPLAY_ENTRIES,
      })

      expect(useLogStore.getState().errorCount).toBe(0)
    })
  })

  describe('prependHistoricalEntries - Pagination (REQ-3.7.2.8)', () => {
    it('prepends historical entries to the beginning', async () => {
      const { useLogStore } = await import('../../../../src/features/workbench/stores/log-store')

      const realTimeEntry: LogEntry = {
        id: 'log-realtime',
        timestamp: '2025-01-22T10:30:45.123Z',
        level: 'INFO',
        message: 'Real-time message',
        source: 'Test',
        sequence: 100,
      }
      useLogStore.setState({ entries: [realTimeEntry], errorCount: 0 })

      const historicalEntries: LogEntry[] = [
        {
          id: 'log-hist-1',
          timestamp: '2025-01-22T10:30:00.000Z',
          level: 'INFO',
          message: 'Historical 1',
          source: 'Test',
          sequence: 1,
        },
        {
          id: 'log-hist-2',
          timestamp: '2025-01-22T10:30:01.000Z',
          level: 'INFO',
          message: 'Historical 2',
          source: 'Test',
          sequence: 2,
        },
      ]

      useLogStore.getState().prependHistoricalEntries(historicalEntries)

      const entries = useLogStore.getState().entries
      expect(entries).toHaveLength(3)
      expect(entries[0].id).toBe('log-hist-1')
      expect(entries[1].id).toBe('log-hist-2')
      expect(entries[2].id).toBe('log-realtime')
    })

    it('updates error count for historical error entries', async () => {
      const { useLogStore } = await import('../../../../src/features/workbench/stores/log-store')
      useLogStore.setState({ entries: [], errorCount: 0 })

      const historicalEntries: LogEntry[] = [
        {
          id: 'log-hist-1',
          timestamp: '2025-01-22T10:30:00.000Z',
          level: 'ERROR',
          message: 'Historical error',
          source: 'Test',
          sequence: 1,
        },
        {
          id: 'log-hist-2',
          timestamp: '2025-01-22T10:30:01.000Z',
          level: 'FATAL',
          message: 'Historical fatal',
          source: 'Test',
          sequence: 2,
        },
      ]

      useLogStore.getState().prependHistoricalEntries(historicalEntries)

      expect(useLogStore.getState().errorCount).toBe(2)
    })

    it('deduplicates historical entries by id', async () => {
      // prependHistoricalEntries dedupes by entry.id (UUID). An incoming
      // historical entry whose id is already present in the buffer is
      // dropped; a different id is kept even if the sequence matches.
      const { useLogStore } = await import('../../../../src/features/workbench/stores/log-store')

      const existingEntry: LogEntry = {
        id: 'log-1',
        timestamp: '2025-01-22T10:30:45.123Z',
        level: 'INFO',
        message: 'Existing',
        source: 'Test',
        sequence: 1,
      }
      useLogStore.setState({ entries: [existingEntry], errorCount: 0 })

      // Same id -> dropped.
      useLogStore.getState().prependHistoricalEntries([{ ...existingEntry }])
      expect(useLogStore.getState().entries).toHaveLength(1)

      // Different id with the same sequence -> kept.
      useLogStore.getState().prependHistoricalEntries([
        { ...existingEntry, id: 'log-hist-1' },
      ])
      expect(useLogStore.getState().entries).toHaveLength(2)
    })

    it('respects display cap when prepending', async () => {
      const { useLogStore } = await import('../../../../src/features/workbench/stores/log-store')

      // Start near max capacity
      const entries: LogEntry[] = []
      for (let i = 0; i < MAX_DISPLAY_ENTRIES - 5; i++) {
        entries.push({
          id: `log-${i}`,
          timestamp: '2025-01-22T10:30:00.000Z',
          level: 'INFO',
          message: `Message ${i}`,
          source: 'Test',
          sequence: i + 100,
        })
      }
      useLogStore.setState({ entries, errorCount: 0 })

      // Try to prepend 10 entries (only 5 should fit)
      const historicalEntries: LogEntry[] = []
      for (let i = 0; i < 10; i++) {
        historicalEntries.push({
          id: `log-hist-${i}`,
          timestamp: '2025-01-22T10:29:00.000Z',
          level: 'INFO',
          message: `Historical ${i}`,
          source: 'Test',
          sequence: i,
        })
      }

      useLogStore.getState().prependHistoricalEntries(historicalEntries)

      expect(useLogStore.getState().entries.length).toBeLessThanOrEqual(MAX_DISPLAY_ENTRIES)
    })
  })

  describe('Level Filtering (REQ-3.7.2.6, REQ-3.7.2.8)', () => {
    it('setMinLevel updates minimum level', async () => {
      const { useLogStore } = await import('../../../../src/features/workbench/stores/log-store')
      useLogStore.setState({ minLevel: 'INFO' })

      useLogStore.getState().setMinLevel('DEBUG')

      expect(useLogStore.getState().minLevel).toBe('DEBUG')
    })

    it('getFilteredEntries returns all entries when level is DEBUG', async () => {
      const { useLogStore } = await import('../../../../src/features/workbench/stores/log-store')

      const entries: LogEntry[] = [
        { id: '1', timestamp: '', level: 'DEBUG', message: '', source: '', sequence: 1 },
        { id: '2', timestamp: '', level: 'INFO', message: '', source: '', sequence: 2 },
        { id: '3', timestamp: '', level: 'WARN', message: '', source: '', sequence: 3 },
        { id: '4', timestamp: '', level: 'ERROR', message: '', source: '', sequence: 4 },
        { id: '5', timestamp: '', level: 'FATAL', message: '', source: '', sequence: 5 },
      ]
      useLogStore.setState({ entries, minLevel: 'DEBUG', errorFilterActive: false, errorCount: 2 })

      const filtered = useLogStore.getState().getFilteredEntries()
      expect(filtered).toHaveLength(5)
    })

    it('getFilteredEntries returns INFO and above when level is INFO', async () => {
      const { useLogStore } = await import('../../../../src/features/workbench/stores/log-store')

      const entries: LogEntry[] = [
        { id: '1', timestamp: '', level: 'DEBUG', message: '', source: '', sequence: 1 },
        { id: '2', timestamp: '', level: 'INFO', message: '', source: '', sequence: 2 },
        { id: '3', timestamp: '', level: 'WARN', message: '', source: '', sequence: 3 },
        { id: '4', timestamp: '', level: 'ERROR', message: '', source: '', sequence: 4 },
        { id: '5', timestamp: '', level: 'FATAL', message: '', source: '', sequence: 5 },
      ]
      useLogStore.setState({ entries, minLevel: 'INFO', errorFilterActive: false, errorCount: 2 })

      const filtered = useLogStore.getState().getFilteredEntries()
      expect(filtered).toHaveLength(4)
      expect(filtered.map((e) => e.level)).toEqual(['INFO', 'WARN', 'ERROR', 'FATAL'])
    })

    it('getFilteredEntries returns WARN and above when level is WARN', async () => {
      const { useLogStore } = await import('../../../../src/features/workbench/stores/log-store')

      const entries: LogEntry[] = [
        { id: '1', timestamp: '', level: 'DEBUG', message: '', source: '', sequence: 1 },
        { id: '2', timestamp: '', level: 'INFO', message: '', source: '', sequence: 2 },
        { id: '3', timestamp: '', level: 'WARN', message: '', source: '', sequence: 3 },
        { id: '4', timestamp: '', level: 'ERROR', message: '', source: '', sequence: 4 },
        { id: '5', timestamp: '', level: 'FATAL', message: '', source: '', sequence: 5 },
      ]
      useLogStore.setState({ entries, minLevel: 'WARN', errorFilterActive: false, errorCount: 2 })

      const filtered = useLogStore.getState().getFilteredEntries()
      expect(filtered).toHaveLength(3)
      expect(filtered.map((e) => e.level)).toEqual(['WARN', 'ERROR', 'FATAL'])
    })

    it('getFilteredEntries returns ERROR and FATAL when level is ERROR', async () => {
      const { useLogStore } = await import('../../../../src/features/workbench/stores/log-store')

      const entries: LogEntry[] = [
        { id: '1', timestamp: '', level: 'DEBUG', message: '', source: '', sequence: 1 },
        { id: '2', timestamp: '', level: 'INFO', message: '', source: '', sequence: 2 },
        { id: '3', timestamp: '', level: 'WARN', message: '', source: '', sequence: 3 },
        { id: '4', timestamp: '', level: 'ERROR', message: '', source: '', sequence: 4 },
        { id: '5', timestamp: '', level: 'FATAL', message: '', source: '', sequence: 5 },
      ]
      useLogStore.setState({ entries, minLevel: 'ERROR', errorFilterActive: false, errorCount: 2 })

      const filtered = useLogStore.getState().getFilteredEntries()
      expect(filtered).toHaveLength(2)
      expect(filtered.map((e) => e.level)).toEqual(['ERROR', 'FATAL'])
    })

    it('getFilteredEntries returns only FATAL when level is FATAL', async () => {
      const { useLogStore } = await import('../../../../src/features/workbench/stores/log-store')

      const entries: LogEntry[] = [
        { id: '1', timestamp: '', level: 'DEBUG', message: '', source: '', sequence: 1 },
        { id: '2', timestamp: '', level: 'INFO', message: '', source: '', sequence: 2 },
        { id: '3', timestamp: '', level: 'WARN', message: '', source: '', sequence: 3 },
        { id: '4', timestamp: '', level: 'ERROR', message: '', source: '', sequence: 4 },
        { id: '5', timestamp: '', level: 'FATAL', message: '', source: '', sequence: 5 },
      ]
      useLogStore.setState({ entries, minLevel: 'FATAL', errorFilterActive: false, errorCount: 2 })

      const filtered = useLogStore.getState().getFilteredEntries()
      expect(filtered).toHaveLength(1)
      expect(filtered[0].level).toBe('FATAL')
    })
  })

  describe('Error Filter (REQ-3.4.2.7)', () => {
    it('setErrorFilterActive enables error-only filtering', async () => {
      const { useLogStore } = await import('../../../../src/features/workbench/stores/log-store')
      useLogStore.setState({ errorFilterActive: false })

      useLogStore.getState().setErrorFilterActive(true)

      expect(useLogStore.getState().errorFilterActive).toBe(true)
    })

    it('getFilteredEntries returns only errors when error filter is active', async () => {
      const { useLogStore } = await import('../../../../src/features/workbench/stores/log-store')

      const entries: LogEntry[] = [
        { id: '1', timestamp: '', level: 'INFO', message: '', source: '', sequence: 1 },
        { id: '2', timestamp: '', level: 'WARN', message: '', source: '', sequence: 2 },
        { id: '3', timestamp: '', level: 'ERROR', message: '', source: '', sequence: 3 },
        { id: '4', timestamp: '', level: 'FATAL', message: '', source: '', sequence: 4 },
      ]
      useLogStore.setState({ entries, minLevel: 'INFO', errorFilterActive: true, errorCount: 2 })

      const filtered = useLogStore.getState().getFilteredEntries()
      expect(filtered).toHaveLength(2)
      expect(filtered.map((e) => e.level)).toEqual(['ERROR', 'FATAL'])
    })

    it('error filter overrides level filter', async () => {
      const { useLogStore } = await import('../../../../src/features/workbench/stores/log-store')

      const entries: LogEntry[] = [
        { id: '1', timestamp: '', level: 'DEBUG', message: '', source: '', sequence: 1 },
        { id: '2', timestamp: '', level: 'INFO', message: '', source: '', sequence: 2 },
        { id: '3', timestamp: '', level: 'ERROR', message: '', source: '', sequence: 3 },
      ]
      // Even with DEBUG level, error filter should only show errors
      useLogStore.setState({ entries, minLevel: 'DEBUG', errorFilterActive: true, errorCount: 1 })

      const filtered = useLogStore.getState().getFilteredEntries()
      expect(filtered).toHaveLength(1)
      expect(filtered[0].level).toBe('ERROR')
    })

    it('buffers non-error logs while error filter is active', async () => {
      const { useLogStore } = await import('../../../../src/features/workbench/stores/log-store')
      useLogStore.setState({ entries: [], errorCount: 0, errorFilterActive: true })

      // Add entries while error filter is active
      useLogStore.getState().addEntry({
        id: 'log-1',
        timestamp: '2025-01-22T10:30:00.000Z',
        level: 'INFO',
        message: 'Info message',
        source: 'Test',
        sequence: 1,
      })
      useLogStore.getState().addEntry({
        id: 'log-2',
        timestamp: '2025-01-22T10:30:01.000Z',
        level: 'ERROR',
        message: 'Error message',
        source: 'Test',
        sequence: 2,
      })

      // All entries should be stored (not discarded)
      expect(useLogStore.getState().entries).toHaveLength(2)
      // But filtered view only shows errors
      expect(useLogStore.getState().getFilteredEntries()).toHaveLength(1)
    })

    it('reveals buffered non-error logs when filter is dismissed', async () => {
      const { useLogStore } = await import('../../../../src/features/workbench/stores/log-store')

      const entries: LogEntry[] = [
        { id: '1', timestamp: '', level: 'INFO', message: 'Buffered', source: '', sequence: 1 },
        { id: '2', timestamp: '', level: 'ERROR', message: 'Visible', source: '', sequence: 2 },
        { id: '3', timestamp: '', level: 'WARN', message: 'Buffered', source: '', sequence: 3 },
      ]
      useLogStore.setState({ entries, minLevel: 'INFO', errorFilterActive: true, errorCount: 1 })

      // Only error visible while filter active
      expect(useLogStore.getState().getFilteredEntries()).toHaveLength(1)

      // Dismiss error filter
      useLogStore.getState().setErrorFilterActive(false)

      // All entries at minLevel now visible
      expect(useLogStore.getState().getFilteredEntries()).toHaveLength(3)
    })
  })

  describe('System Log Filtering', () => {
    // Display settings live in the shared per-browser console store; the log
    // store reads the system-log flag from there. Seed the persisted preference
    // before importing the store so it rehydrates with the wanted flag.
    function setShowSystemLogs(show: boolean): void {
      localStorage.setItem(
        'wave-console-display-settings',
        JSON.stringify({
          state: {
            settings: {
              showTimestamps: true,
              showLevel: true,
              showSource: true,
              sourceWidth: 20,
              showSystemLogs: show,
              fontSize: 12,
            },
          },
          version: 1,
        })
      )
    }

    it('getFilteredEntries filters out SYSTEM source logs when showSystemLogs is false', async () => {
      setShowSystemLogs(false)
      const { useLogStore } = await import('../../../../src/features/workbench/stores/log-store')

      const entries: LogEntry[] = [
        { id: '1', timestamp: '', level: 'INFO', message: 'User log', source: 'HTTP Client', sequence: 1 },
        { id: '2', timestamp: '', level: 'INFO', message: 'System log', source: 'SYSTEM', sequence: 2 },
        { id: '3', timestamp: '', level: 'INFO', message: 'Another user log', source: 'Database', sequence: 3 },
        { id: '4', timestamp: '', level: 'DEBUG', message: 'System debug', source: 'SYSTEM', sequence: 4 },
      ]
      useLogStore.setState({
        entries,
        minLevel: 'DEBUG',
        errorFilterActive: false,
        errorCount: 0,
      })

      const filtered = useLogStore.getState().getFilteredEntries()
      expect(filtered).toHaveLength(2)
      expect(filtered.map((e) => e.source)).toEqual(['HTTP Client', 'Database'])
    })

    it('getFilteredEntries includes SYSTEM logs when showSystemLogs is true', async () => {
      setShowSystemLogs(true)
      const { useLogStore } = await import('../../../../src/features/workbench/stores/log-store')

      const entries: LogEntry[] = [
        { id: '1', timestamp: '', level: 'INFO', message: 'User log', source: 'HTTP Client', sequence: 1 },
        { id: '2', timestamp: '', level: 'INFO', message: 'System log', source: 'SYSTEM', sequence: 2 },
      ]
      useLogStore.setState({
        entries,
        minLevel: 'INFO',
        errorFilterActive: false,
        errorCount: 0,
      })

      const filtered = useLogStore.getState().getFilteredEntries()
      expect(filtered).toHaveLength(2)
    })

    it('system log filter applies after level filter', async () => {
      setShowSystemLogs(false)
      const { useLogStore } = await import('../../../../src/features/workbench/stores/log-store')

      const entries: LogEntry[] = [
        { id: '1', timestamp: '', level: 'DEBUG', message: 'Debug system', source: 'SYSTEM', sequence: 1 },
        { id: '2', timestamp: '', level: 'INFO', message: 'Info system', source: 'SYSTEM', sequence: 2 },
        { id: '3', timestamp: '', level: 'INFO', message: 'Info user', source: 'User', sequence: 3 },
      ]
      useLogStore.setState({
        entries,
        minLevel: 'INFO', // Filters out DEBUG
        errorFilterActive: false,
        errorCount: 0,
      })

      const filtered = useLogStore.getState().getFilteredEntries()
      // Should only have the INFO user log (DEBUG filtered by level, SYSTEM filtered by showSystemLogs)
      expect(filtered).toHaveLength(1)
      expect(filtered[0].id).toBe('3')
    })
  })

  describe('Auto-scroll Management', () => {
    it('setAutoScrollEnabled updates auto-scroll state', async () => {
      const { useLogStore } = await import('../../../../src/features/workbench/stores/log-store')
      useLogStore.setState({ autoScrollEnabled: true })

      useLogStore.getState().setAutoScrollEnabled(false)

      expect(useLogStore.getState().autoScrollEnabled).toBe(false)
    })

    it('auto-scroll can be re-enabled', async () => {
      const { useLogStore } = await import('../../../../src/features/workbench/stores/log-store')
      useLogStore.setState({ autoScrollEnabled: false })

      useLogStore.getState().setAutoScrollEnabled(true)

      expect(useLogStore.getState().autoScrollEnabled).toBe(true)
    })
  })

  describe('Pagination State', () => {
    it('setPaginationLoading updates loading state', async () => {
      const { useLogStore } = await import('../../../../src/features/workbench/stores/log-store')
      useLogStore.setState({
        pagination: { isLoading: false, hasMore: true, cursor: null },
      })

      useLogStore.getState().setPaginationLoading(true)

      expect(useLogStore.getState().pagination.isLoading).toBe(true)
    })

    it('setPaginationHasMore updates hasMore state', async () => {
      const { useLogStore } = await import('../../../../src/features/workbench/stores/log-store')
      useLogStore.setState({
        pagination: { isLoading: false, hasMore: true, cursor: null },
      })

      useLogStore.getState().setPaginationHasMore(false)

      expect(useLogStore.getState().pagination.hasMore).toBe(false)
    })

    it('setPaginationCursor updates cursor', async () => {
      const { useLogStore } = await import('../../../../src/features/workbench/stores/log-store')
      useLogStore.setState({
        pagination: { isLoading: false, hasMore: true, cursor: null },
      })

      useLogStore.getState().setPaginationCursor('cursor-123')

      expect(useLogStore.getState().pagination.cursor).toBe('cursor-123')
    })
  })

  describe('Pagination Constants', () => {
    it('uses PAGE_SIZE constant of ~100 entries', () => {
      expect(PAGE_SIZE).toBe(100)
    })
  })

  describe('Session Management', () => {
    it('setSessionId updates session ID', async () => {
      const { useLogStore } = await import('../../../../src/features/workbench/stores/log-store')
      useLogStore.setState({ sessionId: null })

      useLogStore.getState().setSessionId('session-123')

      expect(useLogStore.getState().sessionId).toBe('session-123')
    })

    it('clearLogs resets entries and error count', async () => {
      const { useLogStore } = await import('../../../../src/features/workbench/stores/log-store')
      useLogStore.setState({
        entries: [
          { id: '1', timestamp: '', level: 'ERROR', message: '', source: '', sequence: 1 },
        ],
        errorCount: 1,
      })

      useLogStore.getState().clearLogs()

      expect(useLogStore.getState().entries).toEqual([])
      expect(useLogStore.getState().errorCount).toBe(0)
    })

    it('clearLogs resets pagination state', async () => {
      const { useLogStore } = await import('../../../../src/features/workbench/stores/log-store')
      useLogStore.setState({
        entries: [],
        errorCount: 0,
        pagination: { isLoading: true, hasMore: true, cursor: 'old-cursor' },
      })

      useLogStore.getState().clearLogs()

      expect(useLogStore.getState().pagination).toEqual({
        isLoading: false,
        hasMore: false, // Backend will tell us if there's more history
        cursor: null,
      })
    })

    it('clearLogs disables error filter', async () => {
      const { useLogStore } = await import('../../../../src/features/workbench/stores/log-store')
      useLogStore.setState({
        entries: [],
        errorCount: 0,
        errorFilterActive: true,
      })

      useLogStore.getState().clearLogs()

      expect(useLogStore.getState().errorFilterActive).toBe(false)
    })

    it('clearLogs re-enables auto-scroll', async () => {
      const { useLogStore } = await import('../../../../src/features/workbench/stores/log-store')
      useLogStore.setState({
        entries: [],
        errorCount: 0,
        autoScrollEnabled: false,
      })

      useLogStore.getState().clearLogs()

      expect(useLogStore.getState().autoScrollEnabled).toBe(true)
    })

    it('changing session ID preserves entries (incremental dev: ad-hoc + Run All accumulate logs)', async () => {
      const { useLogStore } = await import('../../../../src/features/workbench/stores/log-store')
      const entries = [
        { id: '1', timestamp: '', level: 'INFO' as LogLevel, message: 'old log', source: '', sequence: 1 },
      ]
      useLogStore.setState({
        sessionId: 'old-session',
        entries,
        errorCount: 0,
      })

      useLogStore.getState().setSessionId('new-session')

      expect(useLogStore.getState().entries).toEqual(entries)
      expect(useLogStore.getState().sessionId).toBe('new-session')
    })

    it('setting same session ID does not clear logs', async () => {
      const { useLogStore } = await import('../../../../src/features/workbench/stores/log-store')
      const entries = [
        { id: '1', timestamp: '', level: 'INFO' as LogLevel, message: 'keep me', source: '', sequence: 1 },
      ]
      useLogStore.setState({
        sessionId: 'same-session',
        entries,
        errorCount: 0,
      })

      useLogStore.getState().setSessionId('same-session')

      expect(useLogStore.getState().entries).toEqual(entries)
    })
  })

  describe('Level Switch Flow (REQ-3.7.2.8)', () => {
    it('handleLevelSwitch keeps accumulated entries when the level changes', async () => {
      // Earlier runs' logs must NOT vanish on a level change -
      // filtering is client-side (getFilteredEntries).
      const { useLogStore } = await import('../../../../src/features/workbench/stores/log-store')
      const entries = [
        { id: '1', timestamp: '', level: 'INFO' as LogLevel, message: 'run-1', source: '', sequence: 1 },
        { id: '2', timestamp: '', level: 'ERROR' as LogLevel, message: 'run-2', source: '', sequence: 2 },
      ]
      useLogStore.setState({ entries, minLevel: 'INFO', errorCount: 1 })

      useLogStore.getState().handleLevelSwitch('DEBUG')

      expect(useLogStore.getState().entries).toEqual(entries)
      expect(useLogStore.getState().errorCount).toBe(1)
      expect(useLogStore.getState().minLevel).toBe('DEBUG')
    })

    it('handleLevelSwitch resets pagination for historical fetch', async () => {
      const { useLogStore } = await import('../../../../src/features/workbench/stores/log-store')
      useLogStore.setState({
        entries: [],
        errorCount: 0,
        minLevel: 'INFO',
        pagination: { isLoading: false, hasMore: false, cursor: 'old' },
      })

      useLogStore.getState().handleLevelSwitch('WARN')

      expect(useLogStore.getState().pagination).toEqual({
        isLoading: false,
        hasMore: false, // Backend will tell us if there's more history
        cursor: null,
      })
    })

    it('handleLevelSwitch does nothing if level is the same', async () => {
      const { useLogStore } = await import('../../../../src/features/workbench/stores/log-store')
      const entries = [
        { id: '1', timestamp: '', level: 'INFO' as LogLevel, message: '', source: '', sequence: 1 },
      ]
      useLogStore.setState({
        entries,
        minLevel: 'INFO',
        errorCount: 0,
      })

      useLogStore.getState().handleLevelSwitch('INFO')

      expect(useLogStore.getState().entries).toEqual(entries)
    })
  })

  describe('Log Topic Generation (REQ-5.2.1.4)', () => {
    it('getLogTopic returns correct topic format', async () => {
      const { useLogStore } = await import('../../../../src/features/workbench/stores/log-store')
      useLogStore.setState({ sessionId: 'session-abc-123' })

      const topic = useLogStore.getState().getLogTopic()

      expect(topic).toBe('log:session-abc-123')
    })

    it('getLogTopic returns null when no session', async () => {
      const { useLogStore } = await import('../../../../src/features/workbench/stores/log-store')
      useLogStore.setState({ sessionId: null })

      const topic = useLogStore.getState().getLogTopic()

      expect(topic).toBeNull()
    })
  })

  describe('Batch Operations', () => {
    it('addEntries adds multiple entries efficiently', async () => {
      const { useLogStore } = await import('../../../../src/features/workbench/stores/log-store')
      useLogStore.setState({ entries: [], errorCount: 0 })

      const newEntries: LogEntry[] = [
        { id: '1', timestamp: '', level: 'INFO', message: 'First', source: '', sequence: 1 },
        { id: '2', timestamp: '', level: 'ERROR', message: 'Second', source: '', sequence: 2 },
        { id: '3', timestamp: '', level: 'WARN', message: 'Third', source: '', sequence: 3 },
      ]

      useLogStore.getState().addEntries(newEntries)

      expect(useLogStore.getState().entries).toHaveLength(3)
      expect(useLogStore.getState().errorCount).toBe(1)
    })

    it('addEntries maintains order', async () => {
      const { useLogStore } = await import('../../../../src/features/workbench/stores/log-store')
      useLogStore.setState({ entries: [], errorCount: 0 })

      const newEntries: LogEntry[] = [
        { id: '1', timestamp: '', level: 'INFO', message: 'First', source: '', sequence: 1 },
        { id: '2', timestamp: '', level: 'INFO', message: 'Second', source: '', sequence: 2 },
      ]

      useLogStore.getState().addEntries(newEntries)

      const entries = useLogStore.getState().entries
      expect(entries[0].id).toBe('1')
      expect(entries[1].id).toBe('2')
    })

    it('addEntries enforces display cap with FIFO eviction', async () => {
      const { useLogStore } = await import('../../../../src/features/workbench/stores/log-store')

      // Pre-populate near max capacity
      const initialEntries: LogEntry[] = []
      for (let i = 0; i < MAX_DISPLAY_ENTRIES - 2; i++) {
        initialEntries.push({
          id: `log-${i}`,
          timestamp: '2025-01-22T10:30:00.000Z',
          level: 'INFO',
          message: `Message ${i}`,
          source: 'Test',
          sequence: i,
        })
      }
      useLogStore.setState({ entries: initialEntries, errorCount: 0 })

      // Add 5 more entries (should trigger eviction of 3)
      const newEntries: LogEntry[] = []
      for (let i = 0; i < 5; i++) {
        newEntries.push({
          id: `new-${i}`,
          timestamp: '2025-01-22T10:31:00.000Z',
          level: 'INFO',
          message: `New ${i}`,
          source: 'Test',
          sequence: MAX_DISPLAY_ENTRIES + i,
        })
      }

      useLogStore.getState().addEntries(newEntries)

      const entries = useLogStore.getState().entries
      expect(entries).toHaveLength(MAX_DISPLAY_ENTRIES)
      // First 3 original entries should be evicted
      expect(entries[0].id).toBe('log-3')
    })

    it('addEntries decrements error count when evicting errors', async () => {
      const { useLogStore } = await import('../../../../src/features/workbench/stores/log-store')

      // Create entries with first two being errors
      const initialEntries: LogEntry[] = [
        {
          id: 'log-0',
          timestamp: '2025-01-22T10:30:00.000Z',
          level: 'ERROR',
          message: 'Error 1 to be evicted',
          source: 'Test',
          sequence: 0,
        },
        {
          id: 'log-1',
          timestamp: '2025-01-22T10:30:01.000Z',
          level: 'FATAL',
          message: 'Error 2 to be evicted',
          source: 'Test',
          sequence: 1,
        },
      ]
      for (let i = 2; i < MAX_DISPLAY_ENTRIES - 1; i++) {
        initialEntries.push({
          id: `log-${i}`,
          timestamp: '2025-01-22T10:30:00.000Z',
          level: 'INFO',
          message: `Message ${i}`,
          source: 'Test',
          sequence: i,
        })
      }
      useLogStore.setState({ entries: initialEntries, errorCount: 2 })

      // Add 3 more entries (should evict the 2 errors)
      const newEntries: LogEntry[] = [
        {
          id: 'new-0',
          timestamp: '2025-01-22T10:31:00.000Z',
          level: 'INFO',
          message: 'New 0',
          source: 'Test',
          sequence: MAX_DISPLAY_ENTRIES,
        },
        {
          id: 'new-1',
          timestamp: '2025-01-22T10:31:01.000Z',
          level: 'INFO',
          message: 'New 1',
          source: 'Test',
          sequence: MAX_DISPLAY_ENTRIES + 1,
        },
        {
          id: 'new-2',
          timestamp: '2025-01-22T10:31:02.000Z',
          level: 'INFO',
          message: 'New 2',
          source: 'Test',
          sequence: MAX_DISPLAY_ENTRIES + 2,
        },
      ]

      useLogStore.getState().addEntries(newEntries)

      // Both error entries should be evicted, error count should be 0
      expect(useLogStore.getState().errorCount).toBe(0)
    })

    it('addEntries deduplicates by id, not sequence', async () => {
      // addEntries dedupes by entry.id. An incoming entry whose id is
      // already in the buffer is dropped even if the sequence differs;
      // an entry with a new id is appended even if its sequence
      // collides with an existing entry (tracked/ephemeral seq schemas
      // are not globally unique).
      const { useLogStore } = await import('../../../../src/features/workbench/stores/log-store')

      const existingEntry: LogEntry = {
        id: 'existing',
        timestamp: '2025-01-22T10:30:00.000Z',
        level: 'INFO',
        message: 'Existing',
        source: 'Test',
        sequence: 1,
      }
      useLogStore.setState({ entries: [existingEntry], errorCount: 0 })

      const newEntries: LogEntry[] = [
        // Same id as existing -> dropped.
        { id: 'existing', timestamp: '', level: 'INFO', message: 'Dup', source: '', sequence: 99 },
        // Duplicate sequence with existing but fresh id -> kept.
        { id: 'new', timestamp: '', level: 'INFO', message: 'New', source: '', sequence: 1 },
      ]

      useLogStore.getState().addEntries(newEntries)

      const entries = useLogStore.getState().entries
      expect(entries).toHaveLength(2)
      expect(entries[0].id).toBe('existing')
      expect(entries[1].id).toBe('new')
    })

    it('addEntries returns early when all entries share ids with the buffer', async () => {
      const { useLogStore } = await import('../../../../src/features/workbench/stores/log-store')

      const existingEntries: LogEntry[] = [
        { id: '1', timestamp: '', level: 'INFO', message: 'First', source: '', sequence: 1 },
        { id: '2', timestamp: '', level: 'INFO', message: 'Second', source: '', sequence: 2 },
      ]
      useLogStore.setState({ entries: existingEntries, errorCount: 0 })

      // All entries reuse existing ids -> all dropped, state unchanged.
      const duplicateEntries: LogEntry[] = [
        { id: '1', timestamp: '', level: 'ERROR', message: 'Dup 1', source: '', sequence: 9 },
        { id: '2', timestamp: '', level: 'ERROR', message: 'Dup 2', source: '', sequence: 9 },
      ]

      useLogStore.getState().addEntries(duplicateEntries)

      expect(useLogStore.getState().entries).toHaveLength(2)
      expect(useLogStore.getState().errorCount).toBe(0)
    })
  })

  describe('Held-entry id bookkeeping', () => {
    // The store answers "have I already got this line?" from a running tally
    // rather than by re-reading the buffer, so every path that changes the
    // buffer has to keep that tally honest.
    const line = (id: string, overrides: Partial<LogEntry> = {}): LogEntry => ({
      id,
      timestamp: '2025-01-22T10:30:00.000Z',
      level: 'INFO',
      message: id,
      source: 'Test',
      sequence: 1,
      ...overrides,
    })

    const filled = (count: number, from = 0): LogEntry[] => {
      const entries: LogEntry[] = []
      for (let i = from; i < from + count; i++) {
        entries.push(line(`log-${i}`, { sequence: i }))
      }
      return entries
    }

    it('dedupes against entries that were seeded without an action', async () => {
      const { useLogStore } = await import('../../../../src/features/workbench/stores/log-store')
      useLogStore.setState({ entries: [line('seeded')], errorCount: 0 })

      useLogStore.getState().addEntry(line('seeded', { message: 'again' }))

      expect(useLogStore.getState().entries).toHaveLength(1)
      expect(useLogStore.getState().entries[0].message).toBe('seeded')
    })

    it('does not let a line with no id mask the next one', async () => {
      const { useLogStore } = await import('../../../../src/features/workbench/stores/log-store')
      useLogStore.getState().clearLogs()
      const anonymous = (message: string, sequence: number): LogEntry => ({
        ...line('unused', { message, sequence }),
        id: undefined as unknown as string,
      })

      useLogStore.getState().addEntry(anonymous('first', 0))
      useLogStore.getState().addEntry(anonymous('second', 1))

      expect(useLogStore.getState().entries.map((e) => e.message)).toEqual(['first', 'second'])
    })

    it('lets an id back in once its entry has been evicted', async () => {
      const { useLogStore } = await import('../../../../src/features/workbench/stores/log-store')
      useLogStore.setState({ entries: filled(MAX_DISPLAY_ENTRIES), errorCount: 0 })

      // Pushes log-0 out of the buffer.
      useLogStore.getState().addEntry(
        line('pusher', { timestamp: '2025-01-22T10:31:00.000Z', sequence: MAX_DISPLAY_ENTRIES }),
      )
      expect(useLogStore.getState().entries.some((e) => e.id === 'log-0')).toBe(false)

      useLogStore.getState().addEntry(
        line('log-0', {
          message: 'back again',
          timestamp: '2025-01-22T10:31:01.000Z',
          sequence: MAX_DISPLAY_ENTRIES + 1,
        }),
      )

      const entries = useLogStore.getState().entries
      expect(entries[entries.length - 1].message).toBe('back again')
    })

    it('keeps dropping an id while another line still carries it', async () => {
      const { useLogStore } = await import('../../../../src/features/workbench/stores/log-store')
      // Two held lines share one id, so evicting the first must not forget it.
      useLogStore.setState({
        entries: [
          line('twin', { message: 'twin-a' }),
          line('twin', { message: 'twin-b' }),
          ...filled(MAX_DISPLAY_ENTRIES - 2, 2),
        ],
        errorCount: 0,
      })

      useLogStore.getState().addEntry(
        line('pusher', { timestamp: '2025-01-22T10:31:00.000Z', sequence: MAX_DISPLAY_ENTRIES }),
      )

      const afterEviction = useLogStore.getState().entries
      expect(afterEviction).toHaveLength(MAX_DISPLAY_ENTRIES)
      expect(afterEviction.filter((e) => e.id === 'twin')).toHaveLength(1)

      // The surviving twin still holds the id, so a third copy is refused.
      useLogStore.getState().addEntry(
        line('twin', {
          message: 'twin-c',
          timestamp: '2025-01-22T10:31:01.000Z',
          sequence: MAX_DISPLAY_ENTRIES + 1,
        }),
      )
      expect(useLogStore.getState().entries.some((e) => e.message === 'twin-c')).toBe(false)
    })

    it('forgets an id a history page could not fit in the buffer', async () => {
      const { useLogStore } = await import('../../../../src/features/workbench/stores/log-store')
      useLogStore.setState({ entries: filled(MAX_DISPLAY_ENTRIES - 1), errorCount: 0 })

      // Only one of the two history lines fits, and the cap trims from the front.
      useLogStore.getState().prependHistoricalEntries([
        line('page-0', { timestamp: '2025-01-22T10:29:00.000Z', sequence: 0 }),
        line('page-1', { timestamp: '2025-01-22T10:29:01.000Z', sequence: 1 }),
      ])

      const entries = useLogStore.getState().entries
      expect(entries).toHaveLength(MAX_DISPLAY_ENTRIES)
      expect(entries[0].id).toBe('page-1')
      expect(entries.some((e) => e.id === 'page-0')).toBe(false)

      useLogStore.getState().addEntry(
        line('page-0', {
          message: 'refetched',
          timestamp: '2025-01-22T10:31:00.000Z',
          sequence: MAX_DISPLAY_ENTRIES,
        }),
      )

      const readmitted = useLogStore.getState().entries
      expect(readmitted[readmitted.length - 1].message).toBe('refetched')
    })

    it('forgets ids a batch pushed out of the buffer', async () => {
      const { useLogStore } = await import('../../../../src/features/workbench/stores/log-store')
      useLogStore.setState({ entries: filled(MAX_DISPLAY_ENTRIES), errorCount: 0 })

      useLogStore.getState().addEntries([
        line('batch-0', { timestamp: '2025-01-22T10:31:00.000Z', sequence: MAX_DISPLAY_ENTRIES }),
        line('batch-1', {
          timestamp: '2025-01-22T10:31:01.000Z',
          sequence: MAX_DISPLAY_ENTRIES + 1,
        }),
      ])
      expect(useLogStore.getState().entries).toHaveLength(MAX_DISPLAY_ENTRIES)
      expect(useLogStore.getState().entries.some((e) => e.id === 'log-1')).toBe(false)

      useLogStore.getState().addEntry(
        line('log-1', {
          message: 'readmitted',
          timestamp: '2025-01-22T10:31:02.000Z',
          sequence: MAX_DISPLAY_ENTRIES + 2,
        }),
      )

      const entries = useLogStore.getState().entries
      expect(entries[entries.length - 1].message).toBe('readmitted')
    })

    it('lets a cleared id back in', async () => {
      const { useLogStore } = await import('../../../../src/features/workbench/stores/log-store')
      useLogStore.getState().clearLogs()
      useLogStore.getState().addEntry(line('once'))

      useLogStore.getState().clearLogs()
      useLogStore.getState().addEntry(line('once', { message: 'after clear' }))

      expect(useLogStore.getState().entries).toHaveLength(1)
      expect(useLogStore.getState().entries[0].message).toBe('after clear')
    })

    it('keeps both lines when one page repeats an id', async () => {
      const { useLogStore } = await import('../../../../src/features/workbench/stores/log-store')
      useLogStore.getState().clearLogs()

      useLogStore.getState().addEntries([
        line('repeat', { message: 'first', sequence: 0 }),
        line('repeat', { message: 'second', sequence: 1 }),
      ])

      expect(useLogStore.getState().entries.map((e) => e.message)).toEqual(['first', 'second'])
    })

    // A payload that is not an object at all reaches the store unvalidated and
    // throws mid-action. The tally must not keep the part it already applied.
    const malformed = 'garbage-from-the-wire' as unknown as LogEntry

    it('keeps a line usable after a malformed batch throws part way through', async () => {
      const { useLogStore } = await import('../../../../src/features/workbench/stores/log-store')
      useLogStore.getState().clearLogs()
      const good = line('good', { message: 'GOOD' })

      expect(() => useLogStore.getState().addEntries([good, malformed])).toThrow()
      expect(useLogStore.getState().entries).toEqual([])

      useLogStore.getState().addEntry(good)

      expect(useLogStore.getState().entries.map((e) => e.message)).toEqual(['GOOD'])
    })

    it('keeps a line usable after a malformed history page throws part way through', async () => {
      const { useLogStore } = await import('../../../../src/features/workbench/stores/log-store')
      useLogStore.getState().clearLogs()
      const good = line('good', { message: 'GOOD' })

      expect(() => useLogStore.getState().prependHistoricalEntries([good, malformed])).toThrow()
      expect(useLogStore.getState().entries).toEqual([])

      useLogStore.getState().addEntry(good)

      expect(useLogStore.getState().entries.map((e) => e.message)).toEqual(['GOOD'])
    })

    it('keeps a line usable after a malformed single line throws', async () => {
      const { useLogStore } = await import('../../../../src/features/workbench/stores/log-store')
      useLogStore.getState().clearLogs()
      const good = line('good', { message: 'GOOD' })
      useLogStore.getState().addEntry(good)

      expect(() => useLogStore.getState().addEntry(malformed)).toThrow()
      useLogStore.getState().addEntry(line('next', { message: 'NEXT' }))

      expect(useLogStore.getState().entries.map((e) => e.message)).toEqual(['GOOD', 'NEXT'])
    })

    it('refuses a line whose id is already held after an unreadable batch', async () => {
      const { useLogStore } = await import('../../../../src/features/workbench/stores/log-store')
      useLogStore.getState().clearLogs()

      useLogStore.getState().addEntries([
        line('bad-0', { timestamp: 'not-a-timestamp', sequence: 0 }),
        line('bad-1', { timestamp: 'not-a-timestamp', sequence: 1 }),
      ])
      useLogStore.getState().addEntry(line('bad-0', { message: 'duplicate' }))

      expect(useLogStore.getState().entries.map((e) => e.id)).toEqual(['bad-0', 'bad-1'])
    })
  })

  describe('LOG_LEVEL_HIERARCHY', () => {
    it('uses level hierarchy for filtering', () => {
      expect(LOG_LEVEL_HIERARCHY).toEqual({
        DEBUG: 0,
        INFO: 1,
        WARN: 2,
        ERROR: 3,
        FATAL: 4,
      })
    })

    it('higher levels have higher numeric values', () => {
      expect(LOG_LEVEL_HIERARCHY.DEBUG).toBeLessThan(LOG_LEVEL_HIERARCHY.INFO)
      expect(LOG_LEVEL_HIERARCHY.INFO).toBeLessThan(LOG_LEVEL_HIERARCHY.WARN)
      expect(LOG_LEVEL_HIERARCHY.WARN).toBeLessThan(LOG_LEVEL_HIERARCHY.ERROR)
      expect(LOG_LEVEL_HIERARCHY.ERROR).toBeLessThan(LOG_LEVEL_HIERARCHY.FATAL)
    })
  })
})
