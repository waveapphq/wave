/**
 * Log Store - REQ-3.4.2.7, REQ-3.7.2.5, REQ-3.7.2.6, REQ-3.7.2.8, REQ-5.2.1.4
 *
 * State management for console log entries, level filtering, pagination,
 * and real-time streaming during workflow execution.
 */

import { create } from 'zustand'
import { useDisplaySettingsStore } from '@/components/shared/console/display-settings-store'
import type { LogEntry } from '@/types/console'
import type { LogLevel } from '@/lib/log-levels'

// ============================================================================
// Types
// ============================================================================

export interface PaginationState {
  isLoading: boolean
  hasMore: boolean
  // Opaque, echoed back as sent: ephemeral pages carry a sequence number, tracked pages a string.
  cursor: string | number | null
}

export interface LogState {
  entries: LogEntry[]
  minLevel: LogLevel
  sessionId: string | null
  errorFilterActive: boolean
  pagination: PaginationState
  errorCount: number
  autoScrollEnabled: boolean
}

export interface LogActions {
  addEntry: (entry: LogEntry) => void
  addEntries: (entries: LogEntry[]) => void
  prependHistoricalEntries: (entries: LogEntry[]) => void
  setMinLevel: (level: LogLevel) => void
  setErrorFilterActive: (active: boolean) => void
  setAutoScrollEnabled: (enabled: boolean) => void
  setPaginationLoading: (loading: boolean) => void
  setPaginationHasMore: (hasMore: boolean) => void
  setPaginationCursor: (cursor: string | number | null) => void
  setSessionId: (sessionId: string | null) => void
  clearLogs: () => void
  handleLevelSwitch: (newLevel: LogLevel) => void
  getFilteredEntries: () => LogEntry[]
  getLogTopic: () => string | null
}

export type LogStore = LogState & LogActions

// ============================================================================
// Constants
// ============================================================================

const MAX_DISPLAY_ENTRIES = 10000

const LOG_LEVEL_HIERARCHY: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  FATAL: 4,
}

// ============================================================================
// Helpers
// ============================================================================

const isErrorLevel = (level: LogLevel): boolean => {
  return level === 'ERROR' || level === 'FATAL'
}

const countErrors = (entries: LogEntry[]): number => {
  return entries.filter((e) => isErrorLevel(e.level)).length
}

// Tracked entries carry a per-run seq; ephemeral entries carry a per-session
// sequence. Both counters restart, so neither can order the console on its own -
// a second workbench run would interleave its lines with the first run's.
const orderingValue = (entry: LogEntry): number | undefined =>
  entry.run_id === undefined ? entry.sequence : entry.seq

const sameOrderingDomain = (a: LogEntry, b: LogEntry): boolean => a.run_id === b.run_id

// Parsed once per entry: insertion scans the list and would otherwise re-parse
// the same timestamps on every arriving line.
const entryTimeCache = new WeakMap<LogEntry, number>()

const entryTime = (entry: LogEntry): number => {
  const cached = entryTimeCache.get(entry)
  if (cached !== undefined) {
    return cached
  }
  const parsed = Date.parse(entry.timestamp)
  entryTimeCache.set(entry, parsed)
  return parsed
}

const hasReadableTime = (entry: LogEntry): boolean => !Number.isNaN(entryTime(entry))

/** Negative when `a` belongs before `b`, positive when after, zero when neither can be placed first. */
const compareEntries = (a: LogEntry, b: LogEntry): number => {
  const aTime = entryTime(a)
  const bTime = entryTime(b)
  if (!Number.isNaN(aTime) && !Number.isNaN(bTime) && aTime !== bTime) {
    return Math.sign(aTime - bTime)
  }
  // Same instant (or an unparsable timestamp): the counter breaks the tie,
  // but only between entries that share one.
  if (!sameOrderingDomain(a, b)) {
    return 0
  }
  const aValue = orderingValue(a)
  const bValue = orderingValue(b)
  if (aValue === undefined || bValue === undefined) {
    return 0
  }
  return Math.sign(aValue - bValue)
}

/** The premise the backward scan needs: every timestamp parses and none goes backwards. */
const isTimeOrdered = (entries: LogEntry[]): boolean => {
  let previous = Number.NEGATIVE_INFINITY
  for (const entry of entries) {
    const time = entryTime(entry)
    if (Number.isNaN(time) || time < previous) {
      return false
    }
    previous = time
  }
  return true
}

// Scanning back from the tail only finds the same slot as a scan from index 0
// when the buffer is time-ordered; a strictly earlier entry then proves nothing
// to its left belongs after the arrival.
const insertionIndex = (entries: LogEntry[], entry: LogEntry, timeOrdered: boolean): number => {
  const arrivalTime = entryTime(entry)
  if (!timeOrdered || Number.isNaN(arrivalTime)) {
    const forward = entries.findIndex((existing) => compareEntries(existing, entry) > 0)
    return forward === -1 ? entries.length : forward
  }
  let index = entries.length
  for (let position = entries.length - 1; position >= 0; position -= 1) {
    const existing = entries[position]
    if (compareEntries(existing, entry) > 0) {
      index = position
    } else if (entryTime(existing) < arrivalTime) {
      break
    }
  }
  return index
}

// ============================================================================
// Held-entry index
// ============================================================================

interface EntryIndex {
  // Identity is the whole check, so a published entries array is never mutated in place.
  entries: LogEntry[]
  // Counted rather than a set: one batch can legitimately repeat an id.
  idCounts: Map<string, number>
  timeOrdered: boolean
}

const heldCount = (idCounts: Map<string, number>, id: string): number => idCounts.get(id) ?? 0

// An entry with no id takes no slot: its key would read as held and mask every later one.
const retainId = (idCounts: Map<string, number>, id: string): void => {
  if (!id) {
    return
  }
  idCounts.set(id, heldCount(idCounts, id) + 1)
}

const releaseId = (idCounts: Map<string, number>, id: string): void => {
  const remaining = heldCount(idCounts, id) - 1
  if (remaining > 0) {
    idCounts.set(id, remaining)
    return
  }
  idCounts.delete(id)
}

const buildIndex = (entries: LogEntry[]): EntryIndex => {
  const idCounts = new Map<string, number>()
  for (const entry of entries) {
    retainId(idCounts, entry.id)
  }
  return { entries, idCounts, timeOrdered: isTimeOrdered(entries) }
}

let entryIndex: EntryIndex | null = null

// Keyed on array identity, so entries replaced outside an action rebuild it.
const indexFor = (entries: LogEntry[]): EntryIndex => {
  const current = entryIndex
  if (current?.entries === entries) {
    return current
  }
  entryIndex = buildIndex(entries)
  return entryIndex
}

// Called before the first tally change, republished after the last: a throw between them rebuilds.
const detachIndex = (): void => {
  entryIndex = null
}

// ============================================================================
// Store
// ============================================================================

export const useLogStore = create<LogStore>((set, get) => ({
  // Initial state
  entries: [],
  minLevel: 'INFO',
  sessionId: null,
  errorFilterActive: false,
  pagination: {
    isLoading: false,
    hasMore: false, // Start with false - backend will tell us if there's more history
    cursor: null,
  },
  errorCount: 0,
  autoScrollEnabled: true,

  // Actions
  addEntry: (entry) => {
    set((state) => {
      // Deduplicate by entry id (UUID - always present). Tracked and
      // ephemeral log entries have different sequence schemas (per-run seq
      // restarts at 0 for every child test), so id is the only key that
      // survives mixing pushes and backfill paginations.
      const index = indexFor(state.entries)
      if (heldCount(index.idCounts, entry.id) > 0) {
        return state
      }

      const at = insertionIndex(state.entries, entry, index.timeOrdered)
      let newEntries =
        at === state.entries.length
          ? [...state.entries, entry]
          : [...state.entries.slice(0, at), entry, ...state.entries.slice(at)]
      let newErrorCount = state.errorCount

      // Update error count
      if (isErrorLevel(entry.level)) {
        newErrorCount += 1
      }

      const { idCounts } = index
      detachIndex()
      retainId(idCounts, entry.id)

      // Enforce display cap with FIFO eviction
      if (newEntries.length > MAX_DISPLAY_ENTRIES) {
        const evicted = newEntries[0]
        // Decrement error count if evicting an error
        if (isErrorLevel(evicted.level)) {
          newErrorCount -= 1
        }
        releaseId(idCounts, evicted.id)
        newEntries = newEntries.slice(1)
      }

      entryIndex = {
        entries: newEntries,
        idCounts,
        timeOrdered: index.timeOrdered && hasReadableTime(entry),
      }
      return {
        entries: newEntries,
        errorCount: newErrorCount,
      }
    })
  },

  addEntries: (entries) => {
    set((state) => {
      const index = indexFor(state.entries)
      const uniqueEntries = entries.filter((e) => heldCount(index.idCounts, e.id) === 0)

      if (uniqueEntries.length === 0) {
        return state
      }

      const { idCounts } = index
      const working = [...state.entries]
      let timeOrdered = index.timeOrdered
      detachIndex()
      for (const entry of uniqueEntries) {
        working.splice(insertionIndex(working, entry, timeOrdered), 0, entry)
        retainId(idCounts, entry.id)
        timeOrdered = timeOrdered && hasReadableTime(entry)
      }

      let newErrorCount = state.errorCount + countErrors(uniqueEntries)

      // Enforce display cap
      let evicted = 0
      while (working.length - evicted > MAX_DISPLAY_ENTRIES) {
        const dropped = working[evicted]
        if (isErrorLevel(dropped.level)) {
          newErrorCount -= 1
        }
        releaseId(idCounts, dropped.id)
        evicted += 1
      }
      const newEntries = evicted === 0 ? working : working.slice(evicted)

      entryIndex = { entries: newEntries, idCounts, timeOrdered }
      return {
        entries: newEntries,
        errorCount: newErrorCount,
      }
    })
  },

  prependHistoricalEntries: (entries) => {
    set((state) => {
      const index = indexFor(state.entries)
      const uniqueEntries = entries.filter((e) => heldCount(index.idCounts, e.id) === 0)

      if (uniqueEntries.length === 0) {
        return state
      }

      const { idCounts } = index
      let newEntries = [...uniqueEntries, ...state.entries]
      let newErrorCount = state.errorCount + countErrors(uniqueEntries)
      detachIndex()
      for (const entry of uniqueEntries) {
        retainId(idCounts, entry.id)
      }

      // Enforce display cap (remove from beginning if over)
      if (newEntries.length > MAX_DISPLAY_ENTRIES) {
        const overflow = newEntries.length - MAX_DISPLAY_ENTRIES
        const removed = newEntries.slice(0, overflow)
        newErrorCount -= countErrors(removed)
        for (const entry of removed) {
          releaseId(idCounts, entry.id)
        }
        newEntries = newEntries.slice(overflow)
      }

      // A history page lands ahead of held lines without being ordered against
      // them, so the buffer has to earn the backward scan's premise again.
      entryIndex = { entries: newEntries, idCounts, timeOrdered: isTimeOrdered(newEntries) }
      return {
        entries: newEntries,
        errorCount: newErrorCount,
      }
    })
  },

  setMinLevel: (level) => {
    set({ minLevel: level })
  },

  setErrorFilterActive: (active) => {
    set({ errorFilterActive: active })
  },

  setAutoScrollEnabled: (enabled) => {
    set({ autoScrollEnabled: enabled })
  },

  setPaginationLoading: (loading) => {
    set((state) => ({
      pagination: { ...state.pagination, isLoading: loading },
    }))
  },

  setPaginationHasMore: (hasMore) => {
    set((state) => ({
      pagination: { ...state.pagination, hasMore },
    }))
  },

  setPaginationCursor: (cursor) => {
    set((state) => ({
      pagination: { ...state.pagination, cursor },
    }))
  },

  setSessionId: (sessionId) => {
    // Only update the live session id used for routing and pagination - keep
    // existing entries on the panel. Ad-hoc Run/Debug Current spawns a new
    // session id per click; wiping entries each time would erase the user's
    // incremental-dev breadcrumb. Reset (workbench reset) explicitly calls
    // clearLogs to wipe.
    if (sessionId === get().sessionId) return
    set({
      sessionId,
      pagination: {
        isLoading: false,
        hasMore: false,
        cursor: null,
      },
    })
  },

  clearLogs: () => {
    const entries: LogEntry[] = []
    entryIndex = buildIndex(entries)
    set({
      entries,
      errorCount: 0,
      pagination: {
        isLoading: false,
        hasMore: false, // Backend will tell us if there's more history
        cursor: null,
      },
      errorFilterActive: false,
      autoScrollEnabled: true,
    })
  },

  handleLevelSwitch: (newLevel) => {
    const currentLevel = get().minLevel
    if (newLevel === currentLevel) {
      return
    }

    // Keep accumulated entries - level filtering is client-side (getFilteredEntries).
    // Wiping them here erased earlier runs' logs on every level change; the re-subscribe
    // at the new level backfills any finer entries (deduped by id).
    set({
      minLevel: newLevel,
      pagination: {
        isLoading: false,
        hasMore: false, // Backend will tell us if there's more history
        cursor: null,
      },
    })
  },

  getFilteredEntries: () => {
    const state = get()
    const { entries, minLevel, errorFilterActive } = state

    // Error filter overrides level filter
    if (errorFilterActive) {
      return entries.filter((e) => isErrorLevel(e.level))
    }

    // Filter by minimum level
    const minSeverity = LOG_LEVEL_HIERARCHY[minLevel]
    let filtered = entries.filter((e) => LOG_LEVEL_HIERARCHY[e.level] >= minSeverity)

    // System-log visibility is the shared per-browser preference
    if (!useDisplaySettingsStore.getState().settings.showSystemLogs) {
      filtered = filtered.filter((e) => e.source !== 'SYSTEM')
    }

    return filtered
  },

  getLogTopic: () => {
    const sessionId = get().sessionId
    if (!sessionId) {
      return null
    }
    return `log:${sessionId}`
  },
}))
